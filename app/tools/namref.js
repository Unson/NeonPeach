// Slow, plain reference for .nam models. Whole signal at once, float64, written straight from the
// NAM core source (Layer::Process, LayerArray::ProcessInner, WaveNet::process, LSTMCell, ConvNet).
// Used only by tests, to check the fast player.
'use strict';
function actRef(a, x, row){
  const k = a.name;
  if(k === 'Tanh') return Math.tanh(x);
  if(k === 'Fasttanh'){ const ax = Math.abs(x), x2 = x*x; return (x*(2.45550750702956 + 2.45550750702956*ax + (0.893229853513558 + 0.821226666969744*ax)*x2))/(2.44506634652299 + (2.44506634652299 + x2)*Math.abs(x + 0.814642734961073*x*ax)); }
  if(k === 'Hardtanh') return Math.max(-1, Math.min(1, x));
  if(k === 'ReLU') return x > 0 ? x : 0;
  if(k === 'LeakyReLU') return x > 0 ? x : a.a*x;
  if(k === 'PReLU'){ const s = a.slopes ? a.slopes[row % a.slopes.length] : a.a; return x > 0 ? x : s*x; }
  if(k === 'Sigmoid') return 1/(1 + Math.exp(-x));
  if(k === 'SiLU') return x/(1 + Math.exp(-x));
  if(k === 'Hardswish'){ const t = Math.max(0, Math.min(6, x + 3)); return x*t/6; }
  if(k === 'LeakyHardtanh' || k === 'LeakyHardTanh'){ if(x < a.a) return (x - a.a)*a.c + a.a; if(x > a.b) return (x - a.b)*a.d + a.b; return x; }
  if(k === 'Softsign') return x/(1 + Math.abs(x));
  throw new Error('ref: unknown activation ' + k);
}
function makeReader(w){ let i = 0; return {one: () => { if(i >= w.length) throw new Error('ref: out of weights'); return w[i++]; }, left: () => w.length - i}; }
// Conv weights straight from the NAM loops: g, i, j, k
function readConv(rd, K, out, inn, groups, bias){
  const W = []; for(let k = 0; k < K; k++){ W.push([]); for(let o = 0; o < out; o++) W[k].push(new Float64Array(inn)); }
  const opg = out/groups, ipg = inn/groups;
  for(let g = 0; g < groups; g++) for(let i = 0; i < opg; i++) for(let j = 0; j < ipg; j++) for(let k = 0; k < K; k++) W[k][g*opg + i][g*ipg + j] = rd.one();
  const b = new Float64Array(out); if(bias) for(let o = 0; o < out; o++) b[o] = rd.one();
  return {W, b, K, out, inn};
}
function applyConv(cv, dil, X){ // X: rows of Float64Array(T)
  const T = X[0].length, Y = [];
  for(let o = 0; o < cv.out; o++){
    const y = new Float64Array(T).fill(cv.b[o]);
    for(let k = 0; k < cv.K; k++){ const sh = dil*(cv.K - 1 - k); const wr = cv.W[k][o];
      for(let i = 0; i < cv.inn; i++){ const wv = wr[i]; if(!wv) continue; const x = X[i]; for(let t = sh; t < T; t++) y[t] += wv*x[t - sh]; } }
    Y.push(y);
  }
  return Y;
}
const addRows = (A, B) => A.map((a, r) => a.map((v, t) => v + B[r][t]));
function wavenet(cfg, w, x){
  const rd = makeReader(w), T = x.length, cond = [Float64Array.from(x)];
  let layerIn = cond, headIn = null, lastHead = null;
  cfg.arrays.forEach((a, ai) => {
    const HO = a.h1.on ? a.h1.out : a.B;
    let X = applyConv(readConv(rd, 1, a.C, a.inSize, 1, false), 0, layerIn);
    let HA = ai === 0 ? Array.from({length: HO}, () => new Float64Array(T)) : headIn.map(r => Float64Array.from(r));
    for(const l of a.layers){
      const Zc = l.gate ? 2*a.B : a.B;
      const z = addRows(applyConv(readConv(rd, l.K, Zc, a.C, a.gIn, true), l.d, X), applyConv(readConv(rd, 1, Zc, 1, a.gMix, false), 0, cond));
      let top;
      if(l.gate === 0) top = z.map((r, i) => r.map(v => actRef(l.act, v, i)));
      else {
        top = [];
        for(let i = 0; i < a.B; i++){
          const p = z[i], s = z[a.B + i], o = new Float64Array(T);
          for(let t = 0; t < T; t++){ const av = actRef(l.act, p[t], i), sv = actRef(l.sec, s[t], i); o[t] = l.gate === 1 ? av*sv : sv*av + (1 - sv)*p[t]; }
          top.push(o);
        }
      }
      const l1 = a.l1.on ? readConv(rd, 1, a.C, a.B, a.l1.g, true) : null;
      const h1 = a.h1.on ? readConv(rd, 1, HO, a.B, a.h1.g, true) : null;
      HA = addRows(HA, h1 ? applyConv(h1, 0, top) : top);
      X = l1 ? addRows(X, applyConv(l1, 0, top)) : X;
    }
    const head = applyConv(readConv(rd, a.hk, a.H, HO, 1, a.hb), a.hd, HA);
    layerIn = X; headIn = head; lastHead = head;
  });
  let convs = [];
  if(cfg.post){ let cin = cfg.post.inCh; cfg.post.ks.forEach((k, i) => { const co = i === cfg.post.ks.length - 1 ? cfg.post.out : cfg.post.ch; convs.push(readConv(rd, k, co, cin, 1, true)); cin = co; }); }
  const scale = rd.one();
  if(rd.left()) throw new Error('ref: weights left over: ' + rd.left());
  if(!cfg.post) return lastHead[0].map(v => v*scale);
  let h = lastHead.map(r => r.map(v => v*scale));
  for(const cv of convs){ h = h.map((r, i) => r.map(v => actRef(cfg.post.act, v, i))); h = applyConv(cv, 1, h); }
  return h[0];
}
function lstm(cfg, w, x){
  const rd = makeReader(w), H = cfg.H, L = [];
  for(let l = 0; l < cfg.L; l++){ const I = l ? H : 1; const W = []; for(let r = 0; r < 4*H; r++){ const row = []; for(let j = 0; j < I + H; j++) row.push(rd.one()); W.push(row); }
    const b = []; for(let r = 0; r < 4*H; r++) b.push(rd.one()); const h = []; for(let i = 0; i < H; i++) h.push(rd.one()); const c = []; for(let i = 0; i < H; i++) c.push(rd.one()); L.push({I, W, b, h, c}); }
  const hw = []; for(let i = 0; i < H; i++) hw.push(rd.one()); const hb = rd.one();
  if(rd.left()) throw new Error('ref: weights left over');
  const sg = v => 1/(1 + Math.exp(-v)), out = new Float64Array(x.length);
  for(let t = 0; t < x.length; t++){
    let inp = [x[t]];
    for(const c of L){ const xh = inp.concat(c.h), g = c.W.map((row, r) => row.reduce((s, v, j) => s + v*xh[j], c.b[r]));
      for(let i = 0; i < H; i++) c.c[i] = sg(g[H + i])*c.c[i] + sg(g[i])*Math.tanh(g[2*H + i]);
      c.h = c.c.map((cv, i) => sg(g[3*H + i])*Math.tanh(cv)); inp = c.h; }
    out[t] = inp.reduce((s, v, i) => s + v*hw[i], hb);
  }
  return out;
}
function convnet(cfg, w, x){
  const rd = makeReader(w); let X = [Float64Array.from(x)];
  cfg.dil.forEach((d, i) => {
    const cin = i ? cfg.C : 1, cv = readConv(rd, 2, cfg.C, cin, cfg.g, !cfg.bn);
    let Y = applyConv(cv, d, X);
    if(cfg.bn){ const C = cfg.C, rm = [], rv = [], wt = [], bs = []; for(let o = 0; o < C; o++) rm.push(rd.one()); for(let o = 0; o < C; o++) rv.push(rd.one()); for(let o = 0; o < C; o++) wt.push(rd.one()); for(let o = 0; o < C; o++) bs.push(rd.one()); const eps = rd.one();
      Y = Y.map((r, o) => { const sc = wt[o]/Math.sqrt(eps + rv[o]), lc = bs[o] - sc*rm[o]; return r.map(v => v*sc + lc); }); }
    X = Y.map((r, o) => r.map(v => actRef(cfg.act, v, o)));
  });
  const hw = []; for(let i = 0; i < cfg.C; i++) hw.push(rd.one()); const hb = rd.one();
  if(rd.left()) throw new Error('ref: weights left over');
  return X[0].map((_, t) => X.reduce((s, r, i) => s + hw[i]*r[t], hb));
}
function linear(cfg, w, x){ const out = new Float64Array(x.length); for(let t = 0; t < x.length; t++){ let s = cfg.bias ? w[cfg.rf] : 0; for(let k = 0; k < cfg.rf && k <= t; k++) s += w[k]*x[t - k]; out[t] = s; } return out; }
function run(desc, x){
  if(desc.arch === 'Sequential'){ let y = x; for(const m of desc.models) y = Float32Array.from(run(m, y)); return y; }
  return ({WaveNet: wavenet, LSTM: lstm, ConvNet: convnet, Linear: linear})[desc.arch](desc.cfg, desc.w, x);
}
module.exports = {run};
