/* Neon Peach neural core.
   Reads .nam model files (the open Neural Amp Modeler format) and plays them.
   The same file runs on the page, inside the audio worklet, and in Node tests. */
var NAMCore = (function(){
'use strict';
const BLOCK = 128;      // frames per call (the audio worklet render size)
const ROOM = 2048;      // frames of room in each history buffer before it rewinds
const FILM_KEYS = ['conv_pre_film','conv_post_film','input_mixin_pre_film','input_mixin_post_film','activation_pre_film','activation_post_film','layer1x1_post_film','head1x1_post_film'];

function fail(msg){ const e = new Error(msg); e.nam = true; throw e; }
function int(v, what){ const n = Number(v); if(!Number.isInteger(n) || n < 0) fail('This model file has a bad number for ' + what + '.'); return n; }
function num(v, d){ return v == null ? d : Number(v); }

// ---------------------------------------------------------------- activations
// Kind codes match the WebAssembly kernel: 1 tanh, 2 hardtanh, 3 fast tanh, 4 relu, 5 leaky relu,
// 6 sigmoid, 7 silu, 8 hardswish, 9 leaky hardtanh, 10 softsign.
const AK = {Tanh:1, Hardtanh:2, Fasttanh:3, ReLU:4, LeakyReLU:5, Sigmoid:6, SiLU:7, Hardswish:8, LeakyHardtanh:9, LeakyHardTanh:9, Softsign:10, PReLU:5};
function act(j){
  let type = j, o = {};
  if(j && typeof j === 'object' && !Array.isArray(j)){ type = j.type; o = j; }
  if(typeof type !== 'string' || !(type in AK)) fail('This model uses a part Neon Peach does not know yet (' + String(type) + ').');
  const r = {k:AK[type], a:0, b:0, c:0, d:0, slopes:null, name:type};
  if(type === 'LeakyReLU') r.a = num(o.negative_slope, 0.01);
  if(type === 'PReLU'){ if(Array.isArray(o.negative_slopes)) r.slopes = o.negative_slopes.map(Number); else r.a = num(o.negative_slope, 0.01); }
  if(r.k === 9){ r.a = num(o.min_val, -1); r.b = num(o.max_val, 1); r.c = num(o.min_slope, 0.01); r.d = num(o.max_slope, 0.01); }
  return r;
}
function actJS(k, x, a, b, c, d){
  switch(k){
    case 1: return Math.tanh(x);
    case 2: return x < -1 ? -1 : (x > 1 ? 1 : x);
    case 3: { const ax = Math.abs(x), x2 = x*x;
      return (x*(2.45550750702956 + 2.45550750702956*ax + (0.893229853513558 + 0.821226666969744*ax)*x2)) /
             (2.44506634652299 + (2.44506634652299 + x2)*Math.abs(x + 0.814642734961073*x*ax)); }
    case 4: return x > 0 ? x : 0;
    case 5: return x > 0 ? x : a*x;
    case 6: return 1/(1 + Math.exp(-x));
    case 7: return x/(1 + Math.exp(-x));
    case 8: { const t = x + 3; return x*(t < 0 ? 0 : (t > 6 ? 6 : t))/6; }
    case 9: return x < a ? (x - a)*c + a : (x > b ? (x - b)*d + b : x);
    case 10: return x/(1 + Math.abs(x));
    default: return x;
  }
}

// ---------------------------------------------------------------- reading files
function checkVersion(v){
  if(typeof v !== 'string' || !/^\d+\.\d+\.\d+$/.test(v)) fail('This file is not a model file Neon Peach can read (no version).');
  const p = v.split('.').map(Number);
  if(p[0] !== 0 || p[1] < 5) fail('This model file is too old to read (version ' + v + ').');
  if(p[1] > 7) fail('This model file is newer than Neon Peach can read (version ' + v + ').');
  return v;
}

function parseWaveNet(c){
  if(c.condition_dsp != null) fail('This model uses a side model (condition DSP). Neon Peach cannot play that yet.');
  if(num(c.in_channels, 1) !== 1) fail('This model takes more than one input. Neon Peach plays one-input models.');
  if(!Array.isArray(c.layers) || !c.layers.length) fail('This model has no layers.');
  const G = {none:0, gated:1, blended:2};
  const arrays = c.layers.map((L, ai) => {
    const C = int(L.channels, 'channels'), B = L.bottleneck == null ? C : int(L.bottleneck, 'bottleneck');
    const l1 = L.layer1x1 != null ? {on:!!L.layer1x1.active, g:int(L.layer1x1.groups, 'groups')} : {on:true, g:1};
    const h1 = L.head1x1 != null ? {on:!!L.head1x1.active, out:int(L.head1x1.out_channels, 'head size'), g:int(L.head1x1.groups, 'groups')} : {on:false, out:C, g:1};
    let H, hk = 1, hd = 1, hb = false;
    if(L.head != null){
      if(typeof L.head !== 'object') fail('This model has a broken head setting.');
      H = int(L.head.out_channels, 'head size');
      if('head_dilation' in L.head) hd = int(L.head.head_dilation, 'head dilation');
      hk = int(L.head.kernel_size, 'head kernel'); hb = !!L.head.bias;
    } else if(L.head_size != null){ H = int(L.head_size, 'head size'); hb = !!L.head_bias; }
    else fail('This model is missing its head setting.');
    if(hk < 1) fail('This model has a bad head kernel.');
    if(!Array.isArray(L.dilations) || !L.dilations.length) fail('This model has a layer group with no layers.');
    const dil = L.dilations.map(d => int(d, 'dilation')), n = dil.length;
    let ks;
    if(L.kernel_size != null && L.kernel_sizes != null) fail('This model sets the kernel size twice.');
    else if(L.kernel_sizes != null){ if(!Array.isArray(L.kernel_sizes) || L.kernel_sizes.length !== n) fail('This model has a bad kernel size list.'); ks = L.kernel_sizes.map(k => int(k, 'kernel size')); }
    else if(L.kernel_size != null){ ks = new Array(n).fill(int(L.kernel_size, 'kernel size')); }
    else fail('This model is missing its kernel size.');
    if(ks.some(k => k < 1)) fail('This model has a bad kernel size.');
    let acts;
    if(Array.isArray(L.activation)){ acts = L.activation.map(act); if(acts.length !== n) fail('This model has a bad activation list.'); }
    else { const a = act(L.activation); acts = new Array(n).fill(a); }
    let gm, sec;
    if(L.gating_mode != null){
      const modes = Array.isArray(L.gating_mode) ? L.gating_mode : new Array(n).fill(L.gating_mode);
      gm = modes.map(m => { if(!(m in G)) fail('This model has an unknown gating mode (' + m + ').'); return G[m]; });
      if(gm.length !== n) fail('This model has a bad gating list.');
      const sa = L.secondary_activation;
      if(Array.isArray(L.gating_mode) && Array.isArray(sa) && sa.length !== n) fail('This model has a bad secondary activation list.');
      sec = gm.map((m, i) => m === 0 ? null : (sa == null ? act('Sigmoid') : act(Array.isArray(sa) ? sa[i] : sa)));
    } else if(L.gated != null){ const g = !!L.gated; gm = new Array(n).fill(g ? 1 : 0); sec = gm.map(m => m ? act('Sigmoid') : null); }
    else { gm = new Array(n).fill(0); sec = new Array(n).fill(null); }
    for(const key of FILM_KEYS){
      const f = L[key]; if(f == null || f === false) continue;
      if(f === true || (typeof f === 'object' && f.active !== false)) fail('This model uses FiLM, which Neon Peach cannot play yet.');
    }
    if(L.slimmable && typeof L.slimmable === 'object' && L.slimmable.method && L.slimmable.method !== 'slice_channels_uniform') fail('This model uses a slim mode Neon Peach does not know.');
    const gIn = L.groups_input == null ? 1 : int(L.groups_input, 'groups'), gMix = L.groups_input_mixin == null ? 1 : int(L.groups_input_mixin, 'groups');
    return {inSize:int(L.input_size, 'input size'), cond:int(L.condition_size, 'condition size'), C, B, H, hk, hd, hb, gIn, gMix, l1, h1,
      layers: dil.map((d, i) => ({d, K:ks[i], act:acts[i], gate:gm[i], sec:sec[i]}))};
  });
  arrays.forEach((a, i) => {
    if(a.cond !== 1) fail('This model expects a side input. Neon Peach cannot play that yet.');
    if(i === 0 && a.inSize !== 1) fail('This model expects more than one input.');
    if(i > 0){
      const p = arrays[i-1];
      if(a.inSize !== p.C) fail('This model has layer groups that do not fit together.');
      if(a.C !== p.H) fail('This model has layer groups that do not fit together.');
      if((a.h1.on ? a.h1.out : a.B) !== p.H) fail('This model has head sizes that do not fit together.');
    }
  });
  let post = null;
  if(c.head != null){
    const hj = c.head, last = arrays[arrays.length-1].H;
    if(hj.in_channels != null && Number(hj.in_channels) !== last) fail('This model has a head that does not fit.');
    if(!Array.isArray(hj.kernel_sizes) || !hj.kernel_sizes.length) fail('This model has a bad head.');
    post = {inCh:last, ch:int(hj.channels, 'head channels'), out:int(hj.out_channels, 'head outputs'), ks:hj.kernel_sizes.map(k => int(k, 'head kernel')), act:act(hj.activation)};
    if(post.ks.some(k => k < 1)) fail('This model has a bad head kernel.');
  }
  const outCh = post ? post.out : arrays[arrays.length-1].H;
  if(outCh !== 1) fail('This model has ' + outCh + ' outputs. Neon Peach plays one-output models.');
  if(c.head_scale == null) fail('This model is missing its head scale.');
  return {arrays, post};
}
function countWaveNet(m){
  let n = 0;
  for(const a of m.arrays){
    n += a.inSize*a.C;
    const HO = a.h1.on ? a.h1.out : a.B;
    for(const l of a.layers){
      const Zc = l.gate ? 2*a.B : a.B;
      n += l.K*Zc*a.C/a.gIn + Zc;
      n += a.cond*Zc/a.gMix;
      if(a.l1.on) n += a.B*a.C/a.l1.g + a.C;
      if(a.h1.on) n += a.B*a.h1.out/a.h1.g + a.h1.out;
    }
    n += a.hk*a.H*HO + (a.hb ? a.H : 0);
  }
  if(m.post){ let cin = m.post.inCh; m.post.ks.forEach((k, i) => { const cout = i === m.post.ks.length-1 ? m.post.out : m.post.ch; n += k*cin*cout + cout; cin = cout; }); }
  return n + 1;
}
function prewarmWaveNet(m){
  let p = 1;
  for(const a of m.arrays){ for(const l of a.layers) p += l.d*(l.K-1); p += a.hd*(a.hk-1); }
  if(m.post) p += m.post.ks.reduce((s, k) => s + k - 1, 0);
  return p;
}

function parseLSTM(c){
  const m = {L:int(c.num_layers, 'layers'), I:int(c.input_size, 'input size'), H:int(c.hidden_size, 'hidden size')};
  if(num(c.in_channels, 1) !== 1 || m.I !== 1) fail('This model takes more than one input. Neon Peach plays one-input models.');
  if(num(c.out_channels, 1) !== 1) fail('This model has more than one output.');
  if(m.L < 1) fail('This model has no layers.');
  return m;
}
function countLSTM(m){ let n = 0; for(let l = 0; l < m.L; l++){ const I = l ? m.H : m.I; n += 4*m.H*(I + m.H) + 4*m.H + 2*m.H; } return n + m.H + 1; }

function parseConvNet(c){
  const m = {C:int(c.channels, 'channels'), dil:(c.dilations || []).map(d => int(d, 'dilation')), bn:!!c.batchnorm, act:act(c.activation), g:c.groups == null ? 1 : int(c.groups, 'groups')};
  if(num(c.in_channels, 1) !== 1 || num(c.out_channels, 1) !== 1) fail('This model has more than one input or output.');
  if(!m.dil.length) fail('This model has no layers.');
  return m;
}
function countConvNet(m){ let n = 0; m.dil.forEach((d, i) => { const cin = i ? m.C : 1; n += 2*m.C*cin/m.g + (m.bn ? 4*m.C + 1 : m.C); }); return n + m.C + 1; }

function parseLinear(c){
  const m = {rf:int(c.receptive_field, 'length'), bias:!!c.bias};
  if(num(c.in_channels, 1) !== 1 || num(c.out_channels, 1) !== 1) fail('This model has more than one input or output.');
  return m;
}

// Read one model object. Returns a plain description that can be posted to a worklet.
function readModel(j, depth){
  if(!j || typeof j !== 'object') fail('This is not a model file.');
  if(depth > 4) fail('This model nests too deep.');
  const version = checkVersion(j.version);
  const arch = j.architecture, c = j.config || {};
  const sr = j.sample_rate == null ? null : Number(j.sample_rate);
  const meta = (j.metadata && typeof j.metadata === 'object') ? j.metadata : {};
  if(arch === 'SlimmableContainer'){
    const subs = c.submodels;
    if(!Array.isArray(subs) || !subs.length) fail('This model holds no sizes.');
    for(let i = 1; i < subs.length; i++) if(!(Number(subs[i].max_value) > Number(subs[i-1].max_value))) fail('This model has its sizes out of order.');
    if(!(Number(subs[subs.length-1].max_value) >= 1)) fail('This model has no full size.');
    const d = readModel(subs[subs.length-1].model, depth + 1);   // full size, the same default NAM uses
    d.meta = Object.assign({}, d.meta, meta); if(d.sr == null) d.sr = sr; d.note = 'Playing the full-size version of this model.';
    return d;
  }
  if(arch === 'Sequential'){
    if(Array.isArray(j.weights) && j.weights.length) fail('This chained model has stray weights.');
    if(!Array.isArray(c.models) || !c.models.length) fail('This chained model is empty.');
    const models = c.models.map(x => readModel(x, depth + 1));
    let msr = sr; for(const x of models){ if(x.sr == null) continue; if(msr == null) msr = x.sr; else if(x.sr !== msr) fail('This chained model mixes sample rates.'); }
    return {arch, version, sr:msr, meta, models, prewarm:models.reduce((s, x) => s + x.prewarm, 0), macs:models.reduce((s, x) => s + x.macs, 0)};
  }
  if(!Array.isArray(j.weights) && !(j.weights instanceof Float32Array)) fail('This model file is missing its weights.');
  const w = Float32Array.from(j.weights);
  for(let i = 0; i < w.length; i++) if(!Number.isFinite(w[i])) fail('This model file has broken weights.');
  let cfg, need, prewarm, macs;
  if(arch === 'WaveNet'){ cfg = parseWaveNet(c); need = countWaveNet(cfg); prewarm = prewarmWaveNet(cfg); macs = need; }
  else if(arch === 'LSTM'){ cfg = parseLSTM(c); need = countLSTM(cfg); prewarm = Math.max(1, Math.floor(0.5*(sr || 48000))); macs = need; }
  else if(arch === 'ConvNet'){ cfg = parseConvNet(c); need = countConvNet(cfg); prewarm = 1 + cfg.dil.reduce((s, d) => s + d, 0); macs = need; }
  else if(arch === 'Linear'){ cfg = parseLinear(c); need = cfg.rf + (cfg.bias ? 1 : 0); prewarm = cfg.rf; macs = cfg.rf; }
  else fail('This model type (' + String(arch) + ') is not one Neon Peach can play.');
  if(w.length !== need) fail('This model file is damaged: it has ' + w.length + ' numbers but needs ' + need + '.');
  return {arch, version, sr, meta, cfg, w, prewarm, macs};
}
function parse(input){
  let j = input;
  if(typeof input === 'string'){ try{ j = JSON.parse(input); }catch(e){ fail('This file is not a model file. It could not be read.'); } }
  return readModel(j, 0);
}
function describe(d){
  if(d.arch === 'Sequential') return d.models.map(describe).join(' + ');
  const c = d.cfg;
  if(d.arch === 'WaveNet') return 'WaveNet ' + c.arrays.map(a => a.C).join('/') + ' ch, ' + c.arrays.reduce((s, a) => s + a.layers.length, 0) + ' layers';
  if(d.arch === 'LSTM') return 'LSTM ' + c.L + 'x' + c.H;
  if(d.arch === 'ConvNet') return 'ConvNet ' + c.C + ' ch';
  if(d.arch === 'Linear') return 'Impulse response, ' + c.rf + ' taps';
  return d.arch;
}

// ---------------------------------------------------------------- plain JS kernels (same math as the wasm ones)
function jsKernels(mem){
  let F = new Float32Array(mem);
  const K = {
    setMem(m){ F = new Float32Array(m); },
    conv(w, Kk, rows, cols, dil, x, xs, y, ys, n, bias, acc){
      w >>= 2; x >>= 2; xs >>= 2; y >>= 2; ys >>= 2;
      const mat = rows*cols, bo = bias >> 2;
      for(let r = 0; r < rows; r++){
        const yo = y + r*ys, b = bias ? F[bo + r] : 0;
        if(acc){ for(let t = 0; t < n; t++) F[yo+t] += b; } else { for(let t = 0; t < n; t++) F[yo+t] = b; }
        for(let k = 0; k < Kk; k++){
          const off = dil*(k + 1 - Kk), wo = w + k*mat + r*cols;
          for(let c = 0; c < cols; c++){
            const wv = F[wo + c]; if(wv === 0) continue;
            const xo = x + c*xs + off;
            for(let t = 0; t < n; t++) F[yo+t] += wv*F[xo+t];
          }
        }
      }
    },
    act(kind, y, rows, ys, n, a, b, c, d){
      if(!kind) return; y >>= 2; ys >>= 2;
      for(let r = 0; r < rows; r++){ const yo = y + r*ys; for(let t = 0; t < n; t++) F[yo+t] = actJS(kind, F[yo+t], a, b, c, d); }
    },
    ew(op, y, ys, x, xs, rows, n, s){
      y >>= 2; ys >>= 2; x >>= 2; xs >>= 2;
      for(let r = 0; r < rows; r++){
        const yo = y + r*ys, xo = x + r*xs;
        if(op === 0) for(let t = 0; t < n; t++) F[yo+t] += F[xo+t];
        else if(op === 1) for(let t = 0; t < n; t++) F[yo+t] *= F[xo+t];
        else if(op === 2) F.copyWithin(yo, xo, xo + n);
        else if(op === 3) for(let t = 0; t < n; t++) F[yo+t] *= s;
        else if(op === 4) F.fill(0, yo, yo + n);
        else if(op === 5) for(let t = 0; t < n; t++) F[yo+t] = F[xo+t]*s;
        else if(op === 6) for(let t = 0; t < n; t++){ const v = F[xo+t]; F[yo+t] *= 1 - v*v; }
      }
    },
    wgrad(dw, Kk, rows, cols, dil, x, xs, dy, dys, n){
      dw >>= 2; x >>= 2; xs >>= 2; dy >>= 2; dys >>= 2; const mat = rows*cols;
      for(let r = 0; r < rows; r++){ const yo = dy + r*dys;
        for(let k = 0; k < Kk; k++) for(let c = 0; c < cols; c++){ const xo = x + c*xs + dil*(k + 1 - Kk); let acc = 0;
          for(let t = 0; t < n; t++) acc += F[yo+t]*F[xo+t]; F[dw + k*mat + r*cols + c] += acc; } }
    },
    blend(y, ys, a, as, p, ps, rows, n){
      y >>= 2; ys >>= 2; a >>= 2; as >>= 2; p >>= 2; ps >>= 2;
      for(let r = 0; r < rows; r++){ const yo = y + r*ys, ao = a + r*as, po = p + r*ps;
        for(let t = 0; t < n; t++){ const al = F[ao+t]; F[yo+t] = al*F[yo+t] + (1 - al)*F[po+t]; } }
    }
  };
  return K;
}

// ---------------------------------------------------------------- planning (memory layout + op list)
function Arena(){
  this.top = 64; this.inits = []; this.hist = [];
}
Arena.prototype.alloc = function(floats){ const p = this.top; this.top += Math.ceil(Math.max(1, floats)*4/64)*64 + 64; return p; };
Arena.prototype.data = function(arr){ const p = this.alloc(arr.length); this.inits.push([p, arr]); return p; };
Arena.prototype.scratch = function(rows){ return {rows, lb:0, stride:BLOCK*4, base:this.alloc(rows*BLOCK), hist:false}; };
Arena.prototype.histBuf = function(rows, lb){ const b = {rows, lb, stride:(lb + ROOM)*4, base:0, hist:true}; b.base = this.alloc(rows*(lb + ROOM)); this.hist.push(b); return b; };

function reader(w){
  let i = 0;
  return {
    one(){ if(i >= w.length) fail('This model file is damaged: it ran out of numbers.'); return w[i++]; },
    many(n){ if(i + n > w.length) fail('This model file is damaged: it ran out of numbers.'); const s = w.subarray(i, i + n); i += n; return s; },
    done(){ return i === w.length; }, pos(){ return i; }
  };
}
// Read a (grouped) convolution in NAM order and expand it to dense matrices: out[k][row][col].
function dense(rd, K, rows, cols, groups, bias){
  if(rows % groups || cols % groups) fail('This model has a bad group count.');
  const w = new Float32Array(K*rows*cols), opg = rows/groups, ipg = cols/groups, mat = rows*cols;
  for(let g = 0; g < groups; g++) for(let i = 0; i < opg; i++) for(let j = 0; j < ipg; j++) for(let k = 0; k < K; k++)
    w[k*mat + (g*opg + i)*cols + g*ipg + j] = rd.one();
  return {w, b: bias ? Float32Array.from(rd.many(rows)) : null, K, rows, cols};
}

function planWaveNet(m, w, A, S, ops){
  const rd = reader(w), at = (b, row) => b.base + row*b.stride + (b.hist ? (b.lb + S.P)*4 : 0);
  let Zmax = 1, Bmax = 1;
  for(const a of m.arrays){ Bmax = Math.max(Bmax, a.B); for(const l of a.layers) Zmax = Math.max(Zmax, l.gate ? 2*a.B : a.B); }
  const cond = A.scratch(1), Z = A.scratch(Zmax), PRE = A.scratch(Bmax);
  const actOps = (aa, buf, row0, rows) => {
    if(aa.slopes && aa.slopes.length > 1){
      if(aa.slopes.length !== rows) fail('This model has the wrong number of PReLU slopes.');
      for(let r = 0; r < rows; r++){ const s = aa.slopes[r]; ops.push((K, n) => K.act(5, at(buf, row0 + r), 1, buf.stride, n, s, 0, 0, 0)); }
    } else {
      const s = aa.slopes ? aa.slopes[0] : aa.a;
      ops.push((K, n) => K.act(aa.k, at(buf, row0), rows, buf.stride, n, s, aa.b, aa.c, aa.d));
    }
  };
  const convOp = (cv, dil, X, Y, acc) => {
    const wp = A.data(cv.w), bp = cv.b ? A.data(cv.b) : 0, Kk = cv.K, rows = cv.rows, cols = cv.cols;
    ops.push((K, n) => K.conv(wp, Kk, rows, cols, dil, at(X, 0), X.stride, at(Y, 0), Y.stride, n, bp, acc));
  };
  let src = cond, prevHead = null;
  m.arrays.forEach((a, ai) => {
    const HO = a.h1.on ? a.h1.out : a.B;
    const lin = a.layers.map(l => A.histBuf(a.C, l.d*(l.K - 1)));
    const HA = A.histBuf(HO, a.hd*(a.hk - 1)), LO = A.scratch(a.C), HOUT = A.scratch(a.H);
    convOp(dense(rd, 1, a.C, a.inSize, 1, false), 0, src, lin[0], 0);            // rechannel
    if(ai === 0) ops.push((K, n) => K.ew(4, at(HA, 0), HA.stride, 0, 0, HO, n, 0));
    else { const ph = prevHead; ops.push((K, n) => K.ew(2, at(HA, 0), HA.stride, at(ph, 0), ph.stride, HO, n, 0)); }
    a.layers.forEach((l, li) => {
      const X = lin[li], Y = li + 1 < a.layers.length ? lin[li + 1] : LO, Zc = l.gate ? 2*a.B : a.B, B = a.B, C = a.C;
      convOp(dense(rd, l.K, Zc, a.C, a.gIn, true), l.d, X, Z, 0);                // dilated conv
      convOp(dense(rd, 1, Zc, a.cond, a.gMix, false), 0, cond, Z, 1);            // input mixin
      if(l.gate === 0) actOps(l.act, Z, 0, B);
      else if(l.gate === 1){ actOps(l.act, Z, 0, B); actOps(l.sec, Z, B, B); ops.push((K, n) => K.ew(1, at(Z, 0), Z.stride, at(Z, B), Z.stride, B, n, 0)); }
      else { ops.push((K, n) => K.ew(2, at(PRE, 0), PRE.stride, at(Z, 0), Z.stride, B, n, 0)); actOps(l.act, Z, 0, B); actOps(l.sec, Z, B, B);
        ops.push((K, n) => K.blend(at(Z, 0), Z.stride, at(Z, B), Z.stride, at(PRE, 0), PRE.stride, B, n)); }
      const l1 = a.l1.on ? dense(rd, 1, C, B, a.l1.g, true) : null;
      const h1 = a.h1.on ? dense(rd, 1, HO, B, a.h1.g, true) : null;
      if(h1) convOp(h1, 0, Z, HA, 1); else ops.push((K, n) => K.ew(0, at(HA, 0), HA.stride, at(Z, 0), Z.stride, B, n, 0));
      ops.push((K, n) => K.ew(2, at(Y, 0), Y.stride, at(X, 0), X.stride, C, n, 0)); // residual
      if(l1) convOp(l1, 0, Z, Y, 1);
    });
    convOp(dense(rd, a.hk, a.H, HO, 1, a.hb), a.hd, HA, HOUT, 0);                // head rechannel
    src = LO; prevHead = HOUT;
  });
  let out = prevHead;
  const postConvs = [];
  if(m.post){ let cin = m.post.inCh; m.post.ks.forEach((k, i) => { const cout = i === m.post.ks.length - 1 ? m.post.out : m.post.ch; postConvs.push(dense(rd, k, cout, cin, 1, true)); cin = cout; }); }
  const scale = rd.one();
  if(!rd.done()) fail('This model file is damaged: it has extra numbers.');
  if(m.post){
    let cin = m.post.inCh, prev = out;
    postConvs.forEach((cv, i) => {
      const X = A.histBuf(cin, cv.K - 1), p = prev, rows = cin;
      if(i === 0) ops.push((K, n) => K.ew(5, at(X, 0), X.stride, at(p, 0), p.stride, rows, n, scale));
      else ops.push((K, n) => K.ew(2, at(X, 0), X.stride, at(p, 0), p.stride, rows, n, 0));
      actOps(m.post.act, X, 0, rows);
      const Y = A.scratch(cv.rows); convOp(cv, 1, X, Y, 0); prev = Y; cin = cv.rows;
    });
    return {inBuf:cond, outBuf:prev, scale:1, at};
  }
  return {inBuf:cond, outBuf:out, scale, at};
}

function planConvNet(m, w, A, S, ops){
  const rd = reader(w), at = (b, row) => b.base + row*b.stride + (b.hist ? (b.lb + S.P)*4 : 0);
  const C = m.C, blocks = m.dil.map((d, i) => {
    const cin = i ? C : 1, cv = dense(rd, 2, C, cin, m.g, !m.bn);
    if(m.bn){
      const mean = rd.many(C), vr = rd.many(C), wt = rd.many(C), bs = rd.many(C), eps = rd.one(), b = new Float32Array(C);
      for(let o = 0; o < C; o++){ const sc = wt[o]/Math.sqrt(eps + vr[o]); b[o] = bs[o] - sc*mean[o]; for(let k = 0; k < 2; k++) for(let j = 0; j < cin; j++) cv.w[k*C*cin + o*cin + j] *= sc; }
      cv.b = b;
    }
    return {cv, d};
  });
  const hw = Float32Array.from(rd.many(C)), hb = Float32Array.from(rd.many(1));
  if(!rd.done()) fail('This model file is damaged: it has extra numbers.');
  const cond = A.scratch(1);
  const X0 = A.histBuf(1, blocks[0].d); let X = X0;
  ops.push((K, n) => K.ew(2, at(X0, 0), X0.stride, at(cond, 0), cond.stride, 1, n, 0));
  let last = null;
  blocks.forEach((b, i) => {
    const Y = i + 1 < blocks.length ? A.histBuf(C, blocks[i + 1].d) : A.scratch(C), x = X;
    const wp = A.data(b.cv.w), bp = A.data(b.cv.b), cin = b.cv.cols, d = b.d;
    ops.push((K, n) => K.conv(wp, 2, C, cin, d, at(x, 0), x.stride, at(Y, 0), Y.stride, n, bp, 0));
    const aa = m.act, s = aa.slopes ? aa.slopes[0] : aa.a;
    if(aa.slopes && aa.slopes.length > 1){ for(let r = 0; r < C; r++){ const sl = aa.slopes[r % aa.slopes.length]; ops.push((K, n) => K.act(5, at(Y, r), 1, Y.stride, n, sl, 0, 0, 0)); } }
    else ops.push((K, n) => K.act(aa.k, at(Y, 0), C, Y.stride, n, s, aa.b, aa.c, aa.d));
    X = Y; last = Y;
  });
  const OUT = A.scratch(1), hwp = A.data(hw), hbp = A.data(hb), L = last;
  ops.push((K, n) => K.conv(hwp, 1, 1, C, 0, at(L, 0), L.stride, at(OUT, 0), OUT.stride, n, hbp, 0));
  return {inBuf:cond, outBuf:OUT, scale:1, at};
}

// Recurrent and direct-convolution models run in plain JS on their own arrays.
function lstmStage(m, w){
  const rd = reader(w), H = m.H, layers = [];
  for(let l = 0; l < m.L; l++){
    const I = l ? H : m.I, cols = I + H;
    const W = Float32Array.from(rd.many(4*H*cols)), b = Float32Array.from(rd.many(4*H)), h0 = Float32Array.from(rd.many(H)), c0 = Float32Array.from(rd.many(H));
    layers.push({I, cols, W, b, h0, c0, xh:new Float32Array(cols), c:new Float32Array(H), g:new Float32Array(4*H)});
  }
  const hw = Float32Array.from(rd.many(H)), hb = rd.one();
  if(!rd.done()) fail('This model file is damaged: it has extra numbers.');
  const sig = x => 1/(1 + Math.exp(-x));
  const st = {
    reset(){ for(const L of layers){ L.xh.fill(0); L.xh.set(L.h0, L.I); L.c.set(L.c0); } },
    run(inp, out, n){
      for(let t = 0; t < n; t++){
        let x = inp[t];
        for(let l = 0; l < layers.length; l++){
          const L = layers[l], xh = L.xh, W = L.W, g = L.g, cols = L.cols, c = L.c;
          if(l === 0) xh[0] = x; else xh.set(layers[l-1].xh.subarray(layers[l-1].I), 0);
          for(let r = 0; r < 4*H; r++){ let s = L.b[r]; const o = r*cols; for(let j = 0; j < cols; j++) s += W[o + j]*xh[j]; g[r] = s; }
          for(let i = 0; i < H; i++){ c[i] = sig(g[H + i])*c[i] + sig(g[i])*Math.tanh(g[2*H + i]); }
          for(let i = 0; i < H; i++) xh[L.I + i] = sig(g[3*H + i])*Math.tanh(c[i]);
        }
        const h = layers[layers.length-1].xh, I = layers[layers.length-1].I; let y = hb;
        for(let i = 0; i < H; i++) y += hw[i]*h[I + i];
        out[t] = y;
      }
    }
  };
  st.reset();
  return st;
}
// The same LSTM on the wasm kernel: padded gate blocks and one strip for x and every hidden state.
function planLSTM(m, w, A){
  const rd = reader(w), H = m.H, Hp = (H + 3) & ~3, L = m.L, tab = new Int32Array(3*L), resets = [];
  const strip0 = new Float32Array(4 + L*Hp);
  for(let l = 0; l < L; l++){
    const I = l ? H : 1, cols = I + H, pc = l ? 2*Hp : 4 + Hp, xo = l ? 0 : 0, ho = l ? Hp : 4;
    const W = rd.many(4*H*cols), b = rd.many(4*H), h0 = rd.many(H), c0 = rd.many(H);
    const wT = new Float32Array(pc*4*Hp), bp = new Float32Array(4*Hp), cp = new Float32Array(Hp);
    for(let gate = 0; gate < 4; gate++) for(let i = 0; i < H; i++){
      const r = gate*H + i, pr = gate*Hp + i; bp[pr] = b[r];
      for(let j = 0; j < cols; j++){ const pj = j < I ? xo + j : ho + (j - I); wT[pj*4*Hp + pr] = W[r*cols + j]; }
    }
    cp.set(c0); strip0.set(h0, 4 + l*Hp);
    const cPtr = A.data(cp);
    tab[3*l] = A.data(wT); tab[3*l + 1] = A.data(bp); tab[3*l + 2] = cPtr;
    resets.push([cPtr, cp]);
  }
  const hw = new Float32Array(Hp); hw.set(rd.many(H)); const hb = rd.one();
  if(!rd.done()) fail('This model file is damaged: it has extra numbers.');
  const xh = A.data(strip0); resets.push([xh, strip0]);
  return {kind:'lstm', L, Hp, tab: A.data(tab), xh, g: A.alloc(4*Hp), hw: A.data(hw), hb, xin: A.alloc(BLOCK), yout: A.alloc(BLOCK), resets};
}
function linearStage(m, w){
  const rf = m.rf, ir = w.subarray(0, rf), bias = m.bias ? w[rf] : 0, hist = new Float32Array(rf + ROOM);
  let p = rf;
  return {
    reset(){ hist.fill(0); p = rf; },
    run(inp, out, n){
      if(p + n > hist.length){ hist.copyWithin(0, p - rf, p); p = rf; }
      hist.set(inp.subarray(0, n), p);
      for(let t = 0; t < n; t++){ let s = bias; const e = p + t; for(let k = 0; k < rf; k++) s += ir[k]*hist[e - k]; out[t] = s; }
      p += n;
    }
  };
}

// ---------------------------------------------------------------- building a player
// kern: {exports, memory} from an instantiated wasm module, or null for plain JS.
function build(desc, wasm){
  const A = new Arena(), S = {P:0}, stages = [];
  (function add(d){
    if(d.arch === 'Sequential'){ d.models.forEach(add); return; }
    if(d.arch === 'WaveNet' || d.arch === 'ConvNet'){
      const ops = [], io = (d.arch === 'WaveNet' ? planWaveNet : planConvNet)(d.cfg, d.w, A, S, ops);
      stages.push({kind:'graph', ops, io});
    } else if(d.arch === 'LSTM') stages.push(wasm ? planLSTM(d.cfg, d.w, A) : {kind:'js', st:lstmStage(d.cfg, d.w)});
    else if(d.arch === 'Linear') stages.push({kind:'js', st:linearStage(d.cfg, d.w)});
    else fail('This model type cannot be played.');
  })(desc);
  const bytes = A.top + 1024;
  let K, buffer;
  if(wasm){
    const mem = wasm.exports.mem, need = Math.ceil(bytes/65536) - mem.buffer.byteLength/65536;
    if(need > 0) mem.grow(need);
    buffer = mem.buffer; K = wasm.exports;
  } else { buffer = new ArrayBuffer(Math.ceil(bytes/65536)*65536); K = jsKernels(buffer); }
  const F = new Float32Array(buffer), U8 = new Uint8Array(buffer);
  const put = (p, arr) => U8.set(new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength), p);
  for(const [p, arr] of A.inits) put(p, arr);
  const hist = A.hist, tmp = new Float32Array(BLOCK);
  function block(inp, out, n){
    if(S.P + n > ROOM){
      for(const b of hist){ if(!b.lb) continue; const lb = b.lb, sp = S.P;
        for(let r = 0; r < b.rows; r++){ const o = (b.base + r*b.stride) >> 2; F.copyWithin(o, o + sp, o + sp + lb); } }
      S.P = 0;
    }
    let cur = inp;
    for(let si = 0; si < stages.length; si++){
      const s = stages[si], dst = si === stages.length - 1 ? out : tmp;
      if(s.kind === 'js'){ s.st.run(cur, dst, n); }
      else if(s.kind === 'lstm'){
        F.set(cur.subarray(0, n), s.xin >> 2);
        K.lstm_run(s.L, s.Hp, s.tab, s.xh, s.g, s.hw, s.hb, s.xin, s.yout, n);
        dst.set(F.subarray(s.yout >> 2, (s.yout >> 2) + n));
      } else {
        const io = s.io, ip = io.at(io.inBuf, 0) >> 2;
        F.set(cur.subarray(0, n), ip);
        const ops = s.ops; for(let i = 0; i < ops.length; i++) ops[i](K, n);
        const op = io.at(io.outBuf, 0) >> 2, sc = io.scale;
        for(let t = 0; t < n; t++) dst[t] = F[op + t]*sc;
      }
      cur = dst;
    }
    S.P += n;
  }
  const player = {
    desc, wasm: !!wasm, bytes,
    // n must be a multiple of 16 and at most 128
    process(inp, out, n){ block(inp, out, n); },
    reset(){
      for(const b of hist) F.fill(0, b.base >> 2, (b.base + b.rows*b.stride) >> 2);
      S.P = 0; for(const s of stages){ if(s.kind === 'js') s.st.reset(); if(s.kind === 'lstm') for(const [p, arr] of s.resets) put(p, arr); }
    },
    prewarmBlocks(){ return Math.ceil(desc.prewarm/BLOCK); },
    prewarm(){ const z = new Float32Array(BLOCK), o = new Float32Array(BLOCK); for(let i = 0, nb = player.prewarmBlocks(); i < nb; i++) block(z, o, BLOCK); }
  };
  player.reset();   // memory may be reused from an earlier player
  return player;
}

// Run a whole buffer through a player (offline). Pads to whole blocks.
function render(player, x){
  const n = x.length, out = new Float32Array(n), a = new Float32Array(BLOCK), b = new Float32Array(BLOCK);
  for(let i = 0; i < n; i += BLOCK){
    const m = Math.min(BLOCK, n - i); a.fill(0); a.set(x.subarray(i, i + m));
    player.process(a, b, BLOCK); out.set(b.subarray(0, m), i);
  }
  return out;
}

// On the page, big modules must be made with the async call. Workers and worklets can use instantiate().
async function instantiateAsync(mod){ const inst = await WebAssembly.instantiate(mod, {}); return {exports: (inst.instance || inst).exports, module: mod}; }
function instantiate(bytesOrModule){
  const mod = bytesOrModule instanceof WebAssembly.Module ? bytesOrModule : new WebAssembly.Module(bytesOrModule);
  const inst = new WebAssembly.Instance(mod, {});
  return {exports: inst.exports, module: mod};
}

// Build a .nam file (LSTM) from trained weights. layers: [{W,b,h0,c0}] in NAM order.
function lstmFile(net, info){
  const w = [];
  for(const L of net.layers){ for(const v of L.W) w.push(v); for(const v of L.b) w.push(v); for(const v of L.h0) w.push(v); for(const v of L.c0) w.push(v); }
  for(const v of net.hw) w.push(v); w.push(net.hb);
  const d = new Date();
  return {
    version: '0.5.4', architecture: 'LSTM',
    config: {input_size: 1, hidden_size: net.H, num_layers: net.layers.length},
    weights: w.map(v => Math.fround(v)),
    sample_rate: info.sr || 48000,
    metadata: Object.assign({
      date: {year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate(), hour: d.getHours(), minute: d.getMinutes(), second: d.getSeconds()},
      name: info.name || 'Neon Peach clone', modeled_by: 'Neon Peach', gear_type: info.gearType == null ? null : info.gearType, tone_type: info.toneType || null,
      loudness: info.loudness == null ? null : info.loudness,
      training: {settings: {source: 'neon-peach', ignore_checks: false}, validation_esr: info.esr == null ? null : info.esr}
    }, info.meta || {})
  };
}

function weightCount(arch, c){
  if(arch === 'WaveNet') return countWaveNet(parseWaveNet(c));
  if(arch === 'LSTM') return countLSTM(parseLSTM(c));
  if(arch === 'ConvNet') return countConvNet(parseConvNet(c));
  if(arch === 'Linear'){ const m = parseLinear(c); return m.rf + (m.bias ? 1 : 0); }
  fail('Unknown model type.');
}
return {BLOCK, ROOM, parse, describe, build, render, instantiate, instantiateAsync, jsKernels, actJS, lstmFile, weightCount, act};
})();
if(typeof module !== 'undefined' && module.exports) module.exports = NAMCore;
