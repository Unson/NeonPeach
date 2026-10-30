/* Neon Peach "Clone": copies the sound of a pedal or a plugin.
   It makes the test tone, lines the recording up, checks if the sound is a plain filter (an IR),
   and if not, trains a small neural model (an LSTM, saved in the NAM format).
   This file runs on the page and inside the training workers. */
var Cloner = (function(){
'use strict';
const TONE_VERSION = 2;
const TONE_SECS = 0.5 + 5 + 4 + 45 + 0.5 + 10 + 1 + 5 + 1.5;   // lead-in, sweep, IR room, training, gap, check, gap, the same sweep again, tail

function rng(seed){ let s = (seed >>> 0) || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s/4294967296; }; }
const dB = d => Math.pow(10, d/20);
function nextPow2(n){ let p = 1; while(p < n) p <<= 1; return p; }
function fft(re, im, inv){
  const n = re.length;
  for(let i = 1, j = 0; i < n; i++){ let bit = n >> 1; for(; j & bit; bit >>= 1) j ^= bit; j ^= bit; if(i < j){ let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; } }
  for(let len = 2; len <= n; len <<= 1){
    const ang = 2*Math.PI/len*(inv ? 1 : -1), wr = Math.cos(ang), wi = Math.sin(ang), h = len >> 1;
    for(let i = 0; i < n; i += len){ let cr = 1, ci = 0;
      for(let j = 0; j < h; j++){ const a = i + j, b = a + h, vr = re[b]*cr - im[b]*ci, vi = re[b]*ci + im[b]*cr;
        re[b] = re[a] - vr; im[b] = im[a] - vi; re[a] += vr; im[a] += vi; const t = cr*wr - ci*wi; ci = cr*wi + ci*wr; cr = t; } }
  }
  if(inv) for(let i = 0; i < n; i++){ re[i] /= n; im[i] /= n; }
}
// Linear convolution of a with b (FFT). Returns length a.length + b.length - 1.
function convolve(a, b){
  const n = a.length + b.length - 1, N = nextPow2(n);
  const ar = new Float64Array(N), ai = new Float64Array(N), br = new Float64Array(N), bi = new Float64Array(N);
  ar.set(a); br.set(b); fft(ar, ai, false); fft(br, bi, false);
  for(let i = 0; i < N; i++){ const r = ar[i]*br[i] - ai[i]*bi[i], m = ar[i]*bi[i] + ai[i]*br[i]; ar[i] = r; ai[i] = m; }
  fft(ar, ai, true);
  return Float32Array.from(ar.subarray(0, n));
}

// ---------------------------------------------------------------- the test tone
function sweep(sr, secs, amp){
  const n = Math.round(sr*secs), s = new Float32Array(n), f1 = 20, f2 = Math.min(20000, sr*0.45);
  const L = secs/Math.log(f2/f1), K = 2*Math.PI*f1*L, fade = Math.round(sr*0.03);
  for(let i = 0; i < n; i++){ const t = i/sr; s[i] = amp*Math.sin(K*(Math.exp(t/L) - 1)); }
  for(let i = 0; i < fade; i++){ const g = 0.5 - 0.5*Math.cos(Math.PI*i/fade); s[i] *= g; s[n-1-i] *= g; }
  return s;
}
// Karplus-Strong bass string
function pluck(out, p, len, f, vel, bright, sr, r){
  const P = Math.max(2, Math.round(sr/f)), buf = new Float32Array(P);
  let lp = 0, m = 0, pk = 0; const a = 0.08 + 0.85*bright;
  for(let i = 0; i < P; i++){ lp += a*((r()*2 - 1) - lp); buf[i] = lp; m += lp; }
  m /= P; for(let i = 0; i < P; i++){ buf[i] -= m; pk = Math.max(pk, Math.abs(buf[i])); }
  const g = vel/(pk || 1), loss = 0.996 + 0.0038*r(), relAt = Math.round(len*0.88);
  let idx = 0;
  for(let i = 0; i < len && p + i < out.length; i++){
    const cur = buf[idx], nx = buf[idx + 1 === P ? 0 : idx + 1];
    const env = i < relAt ? 1 : Math.max(0, 1 - (i - relAt)/(len - relAt));
    out[p + i] += g*cur*env;
    buf[idx] = loss*(0.5*cur + 0.5*nx);
    idx = idx + 1 === P ? 0 : idx + 1;
  }
}
function pink(out, p, len, lvl, r){
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0; const fade = Math.min(400, len >> 2);
  for(let i = 0; i < len && p + i < out.length; i++){
    const w = r()*2 - 1;
    b0 = 0.99886*b0 + w*0.0555179; b1 = 0.99332*b1 + w*0.0750759; b2 = 0.96900*b2 + w*0.1538520;
    b3 = 0.86650*b3 + w*0.3104856; b4 = 0.55000*b4 + w*0.5329522; b5 = -0.7616*b5 - w*0.0168980;
    const v = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w*0.5362)*0.11; b6 = w*0.115926;
    const e = Math.min(1, i/fade, (len - i)/fade);
    out[p + i] += lvl*v*e*3;
  }
}
// A mix of bass notes, level ramps, noise, chirps, chords and gaps.
function content(sr, n, seed){
  const r = rng(seed), out = new Float32Array(n), notes = [];
  for(let m = 28; m <= 60; m++) notes.push(440*Math.pow(2, (m - 69)/12));
  const note = () => notes[Math.floor(r()*notes.length)];
  let p = Math.round(sr*0.05);
  while(p < n){
    const pick = r(); let len;
    if(pick < 0.44){
      len = Math.round(sr*(0.2 + r()*1.5));
      const vel = dB(-34 + 34*Math.pow(r(), 0.55)), bright = r();
      pluck(out, p, len, note(), vel, bright, sr, r);
      if(r() < 0.22) pluck(out, p + Math.round(len*0.3*r()), Math.round(len*0.7), note(), vel*0.7, bright, sr, r);
    } else if(pick < 0.57){
      len = Math.round(sr*(1 + r()*2));
      const f = [41.2, 55, 82.4, 110, 146.8, 220, 330, 440, 880, 1760][Math.floor(r()*10)], top = -0.5 - 8*r(), low = -54, up = r() < 0.7;
      for(let i = 0; i < len && p + i < n; i++){ const fr = i/len, d = up ? low + (top - low)*fr : top + (low - top)*fr; out[p + i] += dB(d)*Math.sin(2*Math.PI*f*i/sr); }
    } else if(pick < 0.67){
      len = Math.round(sr*(0.3 + r()*1.1));
      pink(out, p, len, dB([-36, -24, -14, -7][Math.floor(r()*4)]), r);
    } else if(pick < 0.76){
      len = Math.round(sr*(0.3 + r()*0.7));
      const f0 = 30 + r()*90, f1 = 400 + r()*5000, a = dB(-30 + 28*r()); let ph = 0;
      for(let i = 0; i < len && p + i < n; i++){ const f = f0*Math.pow(f1/f0, i/len); ph += 2*Math.PI*f/sr; out[p + i] += a*Math.sin(ph)*Math.min(1, i/200, (len - i)/200); }
    } else if(pick < 0.86){
      len = Math.round(sr*(0.4 + r()*0.8));
      const fa = note(), fb = fa*[1.5, 2, 1.25, 3, 1.335][Math.floor(r()*5)], a = dB(-26 + 24*r());
      for(let i = 0; i < len && p + i < n; i++){ const e = Math.min(1, i/300, (len - i)/300); out[p + i] += a*0.5*e*(Math.sin(2*Math.PI*fa*i/sr) + Math.sin(2*Math.PI*fb*i/sr)); }
    } else len = Math.round(sr*(0.05 + r()*0.4));
    p += len;
  }
  let pk = 0; for(let i = 0; i < n; i++) pk = Math.max(pk, Math.abs(out[i]));
  const g = 0.95/(pk || 1); for(let i = 0; i < n; i++) out[i] *= g;
  return out;
}
const toneCache = {};
function makeTone(sr){
  if(toneCache[sr]) return toneCache[sr];
  const S = t => Math.round(t*sr), seg = {}; let p = S(0.5);
  const sw = sweep(sr, 5, dB(-9));
  seg.sweepAt = p; seg.sweepLen = sw.length; p += sw.length; seg.irRoom = S(4); p += seg.irRoom;
  const tr = content(sr, S(45), 1234567); seg.trainAt = p; seg.trainLen = tr.length; p += tr.length + S(0.5);
  const va = content(sr, S(10), 7654321); seg.valAt = p; seg.valLen = va.length; p += va.length + S(1);
  const es = sw; seg.endAt = p; seg.endLen = es.length; p += es.length + S(1.5);   // the same sweep at the end shows if the timing slipped
  const x = new Float32Array(p); x.set(sw, seg.sweepAt); x.set(tr, seg.trainAt); x.set(va, seg.valAt); x.set(es, seg.endAt);
  return (toneCache[sr] = {x, sr, seg, sweep: sw, endSweep: es, version: TONE_VERSION});
}
// the tone as sent at a send level (the sweeps are scaled too, so the IR comes out right)
function scaleTone(t, g){ return Object.assign({}, t, {x: Float32Array.from(t.x, v => v*g), sweep: Float32Array.from(t.sweep, v => v*g), endSweep: t.endSweep ? Float32Array.from(t.endSweep, v => v*g) : null}); }

// 24-bit mono WAV
function wav24(x, sr){
  const n = x.length, buf = new ArrayBuffer(44 + n*3), v = new DataView(buf);
  const w = (o, s) => { for(let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); v.setUint32(4, 36 + n*3, true); w(8, 'WAVE'); w(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, sr, true); v.setUint32(28, sr*3, true); v.setUint16(32, 3, true); v.setUint16(34, 24, true); w(36, 'data'); v.setUint32(40, n*3, true);
  for(let i = 0, o = 44; i < n; i++, o += 3){ let s = Math.round(Math.max(-1, Math.min(1, x[i]))*8388607); if(s < 0) s += 16777216; v.setUint8(o, s & 255); v.setUint8(o + 1, (s >> 8) & 255); v.setUint8(o + 2, (s >> 16) & 255); }
  return buf;
}
// 32-bit float mono WAV (for IR export). Uses the full float header (fmt with cbSize, plus a fact chunk).
function wavF32(x, sr){
  const n = x.length, buf = new ArrayBuffer(58 + n*4), v = new DataView(buf);
  const w = (o, s) => { for(let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); v.setUint32(4, 50 + n*4, true); w(8, 'WAVE');
  w(12, 'fmt '); v.setUint32(16, 18, true); v.setUint16(20, 3, true); v.setUint16(22, 1, true); v.setUint32(24, sr, true); v.setUint32(28, sr*4, true); v.setUint16(32, 4, true); v.setUint16(34, 32, true); v.setUint16(36, 0, true);
  w(38, 'fact'); v.setUint32(42, 4, true); v.setUint32(46, n, true);
  w(50, 'data'); v.setUint32(54, n*4, true);
  for(let i = 0; i < n; i++) v.setFloat32(58 + i*4, x[i], true);
  return buf;
}

// ---------------------------------------------------------------- lining up and checking the recording
// rec: what came back (same sample rate as the tone, starting at the same moment it was sent).
function analyze(tone, rec, opt){
  const {seg, sweep: sw, sr} = tone, out = {problems: []};
  let pk = 0, clip = 0; for(let i = 0; i < rec.length; i++){ const a = Math.abs(rec[i]); if(a > pk) pk = a; if(a > 0.999) clip++; }
  out.peak = pk;
  if(pk < 1e-4){ out.problems.push('silent'); return out; }
  if(clip > sr*0.002) out.problems.push('clipping');
  const maxLat = (opt && opt.maxLat) || Math.round(sr*0.75);
  // Deconvolve with the sweep: IR = rec / sweep, inside the band the sweep covers (soft edges, so it does not ring).
  // The window must end before the response to the training part starts, or that sound leaks into the IR.
  const deconv = (len, at, swp) => {
    const N = nextPow2(len + swp.length), rr = new Float64Array(N), ri = new Float64Array(N), sr_ = new Float64Array(N), si = new Float64Array(N);
    for(let i = 0; i < len; i++){ const j = at + i; rr[i] = j < rec.length ? rec[j] : 0; }
    sr_.set(swp); fft(rr, ri, false); fft(sr_, si, false);
    let mx = 0; for(let i = 0; i < N; i++) mx = Math.max(mx, sr_[i]*sr_[i] + si[i]*si[i]);
    const top = Math.min(20000, sr*0.45), eps = mx*1e-5;
    const band = f => f < 3 ? 0 : f < 10 ? 0.5 - 0.5*Math.cos(Math.PI*(f - 3)/7) : f < top*0.8 ? 1 : f < top ? 0.5 + 0.5*Math.cos(Math.PI*(f - top*0.8)/(top*0.2)) : 0;
    for(let i = 0; i < N; i++){
      const wgt = band((i <= N/2 ? i : N - i)*sr/N);
      if(!wgt){ rr[i] = 0; ri[i] = 0; continue; }
      const a = rr[i], b = ri[i], c = sr_[i], d = si[i], den = c*c + d*d + eps;
      rr[i] = wgt*(a*c + b*d)/den; ri[i] = wgt*(b*c - a*d)/den;
    }
    fft(rr, ri, true);
    return rr;
  };
  const first = deconv(sw.length + maxLat, seg.sweepAt, sw);
  let p0 = 0, pv0 = 0; for(let i = 0; i < maxLat; i++){ const a = Math.abs(first[i]); if(a > pv0){ pv0 = a; p0 = i; } }
  const rr = deconv(Math.min(sw.length + seg.irRoom + p0, seg.trainAt - seg.sweepAt + p0), seg.sweepAt, sw);
  let p = 0, pv = 0; for(let i = 0; i < maxLat; i++){ const a = Math.abs(rr[i]); if(a > pv){ pv = a; p = i; } }
  // noise level of the IR well after the peak tells us if we found a real peak
  let nz = 0, nc = 0; for(let i = p + Math.round(sr*2); i < Math.min(rr.length, p + Math.round(sr*3)); i++){ nz += rr[i]*rr[i]; nc++; }
  nz = Math.sqrt(nz/Math.max(1, nc));
  out.snr = 20*Math.log10(pv/(nz || 1e-12));
  if(out.snr < 12){ out.problems.push('noalign'); }
  let on = p; for(let i = p; i >= Math.max(0, p - 400); i--){ if(Math.abs(rr[i]) >= 0.2*pv) on = i; }
  out.latency = Math.max(0, on - 1);
  // The end sweep is the same sweep again, so a steady pedal answers it the same way, distortion and all. If that answer lands
  // somewhere else, the take slipped: a dropout, or two clocks drifting apart. The search stays within 0.1 s, so the distortion
  // images an exponential sweep makes (0.5 s early and more) are not mistaken for it.
  if(tone.endSweep && seg.endAt && !out.problems.includes('noalign')){
    const es = tone.endSweep, D = Math.round(sr*0.1);
    if(seg.endAt + seg.endLen + out.latency + Math.round(sr*0.05) <= rec.length){
      const re = deconv(seg.endLen + out.latency + D + Math.round(sr*0.25), seg.endAt, es), lo = Math.max(0, out.latency - D), hi = out.latency + D;
      let q = lo, qv = 0; for(let i = lo; i < hi; i++){ const a = Math.abs(re[i]); if(a > qv){ qv = a; q = i; } }
      let on2 = q; for(let i = q; i >= Math.max(0, q - 400); i--){ if(Math.abs(re[i]) >= 0.2*qv) on2 = i; }
      out.latEnd = Math.max(0, on2 - 1); out.endPeak = qv/pv;
      out.slip = qv < 0.25*pv ? null : out.latEnd - out.latency;
      if(out.slip === null || Math.abs(out.slip) > 48) out.problems.push('slip');   // a dropout loses a whole audio block (128 samples) or more
      else if(Math.abs(out.slip) > 2) out.problems.push('drift');                  // small: clocks drifting a little, or a pedal that moves (phaser, vibrato)
    } else out.problems.push('short');   // the take ends before the end sweep, so the timing can't be checked
  }
  // the impulse response, trimmed where it falls under the noise (or 60 dB down)
  const maxIr = Math.min(seg.irRoom - Math.round(sr*0.1), Math.round(sr*4)), ir = new Float32Array(maxIr);
  for(let i = 0; i < maxIr; i++) ir[i] = rr[out.latency + i];
  const win = Math.round(sr*0.01), floor = Math.max(pv*1e-4, nz*3); let end = Math.round(sr*0.1);
  for(let i = 0; i + win < maxIr; i += win){ let e = 0; for(let j = i; j < i + win; j++) e = Math.max(e, Math.abs(ir[j])); if(e > floor) end = i + win; }
  end = Math.min(maxIr, Math.max(Math.round(sr*0.1), end + win*2));
  const fade = Math.min(Math.round(sr*0.02), end >> 2);
  for(let i = 0; i < fade; i++) ir[end - 1 - i] *= i/fade;
  out.ir = ir.slice(0, end);
  // how well does a plain filter (IR) explain the check section?
  const L = out.ir.length, xs = tone.x.subarray(Math.max(0, seg.valAt - L), seg.valAt + seg.valLen);
  const pre = seg.valAt - Math.max(0, seg.valAt - L), pred = convolve(xs, out.ir);
  // compare inside the band the sweep measured well (35 Hz to 15 kHz), in the frequency domain
  const M = nextPow2(seg.valLen), er = new Float64Array(M), ei = new Float64Array(M), yr = new Float64Array(M), yi = new Float64Array(M);
  for(let i = 0; i < seg.valLen; i++){ const j = seg.valAt + out.latency + i, y = j < rec.length ? rec[j] : 0; yr[i] = y; er[i] = pred[pre + i] - y; }
  fft(er, ei, false); fft(yr, yi, false);
  const k0 = Math.ceil(35*M/sr), k1 = Math.floor(Math.min(15000, sr*0.4)*M/sr);
  let num = 0, den = 0; for(let k = k0; k <= k1; k++){ num += er[k]*er[k] + ei[k]*ei[k]; den += yr[k]*yr[k] + yi[k]*yi[k]; }
  out.linearEsr = den > 0 ? num/den : 1;
  out.isLinear = out.linearEsr < 0.006;
  let gainNum = 0, gainDen = 0; for(let i = 0; i < seg.valLen; i++){ const j = seg.valAt + out.latency + i, y = j < rec.length ? rec[j] : 0; gainNum += y*y; gainDen += tone.x[seg.valAt + i]**2; }
  out.gainDb = 10*Math.log10((gainNum + 1e-20)/(gainDen + 1e-20));
  return out;
}
// Cut out aligned training and check parts. Removes DC.
function slices(tone, rec, latency){
  const {seg} = tone, get = (at, len) => { const y = new Float32Array(len); for(let i = 0; i < len; i++){ const j = at + latency + i; y[i] = j < rec.length ? rec[j] : 0; } return y; };
  const yT = get(seg.trainAt, seg.trainLen), yV = get(seg.valAt, seg.valLen);
  let m = 0; for(const v of yT) m += v; m /= yT.length;
  for(let i = 0; i < yT.length; i++) yT[i] -= m; for(let i = 0; i < yV.length; i++) yV[i] -= m;
  return {sr: tone.sr, xT: tone.x.subarray(seg.trainAt, seg.trainAt + seg.trainLen), yT, xV: tone.x.subarray(seg.valAt, seg.valAt + seg.valLen), yV,
    xValCtx: tone.x.subarray(seg.valAt - 4096, seg.valAt + seg.valLen)};
}

// ---------------------------------------------------------------- training core (one worker)
// Params, flat: W (4H x (1+H), row-major, input column first), b (4H), hw (H), hb.
function paramCount(H){ return 4*H*(H + 1) + 4*H + H + 1; }
function initParams(H, seed){
  const r = rng(seed), n = paramCount(H), P = new Float32Array(n), k = 1/Math.sqrt(H), G = 4*H, cols = H + 1;
  for(let i = 0; i < G*cols; i++) P[i] = (r()*2 - 1)*k;
  for(let i = 0; i < G; i++) P[G*cols + i] = (r()*2 - 1)*k + (i >= H && i < 2*H ? 1 : 0);
  for(let i = 0; i < H; i++) P[G*cols + G + i] = (r()*2 - 1)*k*0.5;
  P[n - 1] = 0;
  return P;
}
function TrainCore(mod, H, data, opt){
  const K = (opt.inst || new WebAssembly.Instance(mod, {})).exports, mem = K.mem;
  const warm = opt.warm, Tg = opt.Tg, T = warm + Tg, G = 4*H, cols = H + 1, nP = paramCount(H);
  let top = 64; const al = b => { const p = top; top += Math.ceil(b/64)*64; return p; };
  const pW = al(G*cols*4), pb = al(G*4), phw = al(H*4), pX = al(T*16), pS = al((Tg + 1)*7*H*16), pYh = al(Tg*16), pDY = al(Tg*16);
  const pa = al(G*16), phc = al(H*16), pcc = al(H*16), pdW = al(G*cols*16), pdb = al(G*16), pdhw = al(H*16), pdhb = al(16), pda = al(G*16), pdc = al(H*16), pdhn = al(H*16);
  const gradStart = pdW, gradEnd = pdhn + H*16;
  let F;
  const ensure = bytes => { const need = Math.ceil(bytes/65536) - mem.buffer.byteLength/65536; if(need > 0) mem.grow(need); F = new Float32Array(mem.buffer); };
  ensure(top);
  const {x, y, Ep, Er} = data, r = rng(opt.seed || 1);
  let hb = 0;
  function setParams(P){
    F.set(P.subarray(0, G*cols), pW >> 2); F.set(P.subarray(G*cols, G*cols + G), pb >> 2); F.set(P.subarray(G*cols + G, G*cols + G + H), phw >> 2); hb = P[nP - 1];
  }
  function step(P){
    setParams(P);
    const starts = [0, 0, 0, 0].map(() => Math.floor(r()*(x.length - T)));
    const xo = pX >> 2;
    for(let l = 0; l < 4; l++){ const s = starts[l]; for(let t = 0; t < T; t++) F[xo + t*4 + l] = x[s + t]; }
    K.fwd(pW, pb, phw, hb, H, pX, T, warm, pS, pYh, pa, phc, pcc, 1);
    // loss: pre-emphasized error over pre-emphasized energy, plus plain error over plain energy
    const yo = pYh >> 2, dyo = pDY >> 2, N = 4*(Tg - 1);
    let loss = 0, lp = 0;
    const e = new Float64Array(4*Tg), d = new Float64Array(4*Tg);
    for(let l = 0; l < 4; l++){ const s = starts[l] + warm;
      for(let t = 0; t < Tg; t++){ d[t*4 + l] = F[yo + t*4 + l] - y[s + t]; }
      for(let t = 1; t < Tg; t++){ const ev = d[t*4 + l] - 0.85*d[(t - 1)*4 + l]; e[t*4 + l] = ev; lp += ev*ev/Ep; loss += ev*ev/Ep + d[t*4 + l]*d[t*4 + l]/Er; } }
    for(let l = 0; l < 4; l++) for(let t = 0; t < Tg; t++){
      const en = t + 1 < Tg ? e[(t + 1)*4 + l] : 0, ec = t >= 1 ? e[t*4 + l] : 0, dc = t >= 1 ? d[t*4 + l] : 0;
      F[dyo + t*4 + l] = (2/N)*((ec - 0.85*en)/Ep + dc/Er);
    }
    F.fill(0, gradStart >> 2, gradEnd >> 2);
    K.bwd(pW, phw, H, pX, warm, Tg, pS, pDY, pdW, pdb, pdhw, pdhb, pda, pdc, pdhn);
    const g = new Float32Array(nP), sum = (p, n, off) => { const o = p >> 2; for(let i = 0; i < n; i++){ const k = o + i*4; g[off + i] = F[k] + F[k + 1] + F[k + 2] + F[k + 3]; } };
    sum(pdW, G*cols, 0); sum(pdb, G, G*cols); sum(pdhw, H, G*cols + G); sum(pdhb, 1, nP - 1);
    return {loss: loss/N, grad: g};
  }
  // Predict a long signal: four lanes each take a quarter, warmed up on the samples before it.
  let pBig = 0, bigT = 0;
  function predict(P, xs, ctx){
    setParams(P);
    const n = xs.length - ctx, c = Math.ceil(n/4), wv = ctx, TT = wv + c;
    if(TT > bigT){ bigT = TT; top = Math.max(top, gradEnd); pBig = al(TT*16*2 + 64); ensure(top); }
    const pXb = pBig, pYb = pBig + TT*16, xo = pXb >> 2;
    for(let l = 0; l < 4; l++){ const s = ctx + l*c - wv; for(let t = 0; t < TT; t++){ const j = s + t; F[xo + t*4 + l] = (j >= 0 && j < xs.length && (j < ctx + (l + 1)*c)) ? xs[j] : 0; } }
    K.fwd(pW, pb, phw, hb, H, pXb, TT, wv, pS, pYb, pa, phc, pcc, 0);
    const out = new Float32Array(n), yo = pYb >> 2;
    for(let l = 0; l < 4; l++) for(let t = 0; t < c; t++){ const i = l*c + t; if(i < n) out[i] = F[yo + t*4 + l]; }
    return out;
  }
  return {step, predict, nP};
}
function esr(yh, y){ let a = 0, b = 0; for(let i = 0; i < y.length; i++){ const e = yh[i] - y[i]; a += e*e; b += y[i]*y[i]; } return b > 0 ? a/b : 1; }
function energies(y){ let er = 0, ep = 0; for(let i = 1; i < y.length; i++){ er += y[i]*y[i]; const v = y[i] - 0.85*y[i-1]; ep += v*v; } return {Er: er/(y.length - 1) + 1e-12, Ep: ep/(y.length - 1) + 1e-12}; }

// ---------------------------------------------------------------- WaveNet trainer (the NAM "A1" family)
// These are the same shapes the official NAM trainer makes, so the files load in NAM players and pedals.
const WAVE_ARCH = {nano: [4, 2, 2], feather: [8, 4, 4], lite: [12, 6, 6], standard: [16, 8, 8]};
function waveConfig(name){
  const a = WAVE_ARCH[name] || WAVE_ARCH.feather, std = name === 'standard';
  const d1 = std ? [1, 2, 4, 8, 16, 32, 64, 128, 256, 512] : [1, 2, 4, 8, 16, 32, 64];
  const d2 = std ? [1, 2, 4, 8, 16, 32, 64, 128, 256, 512] : [128, 256, 512, 1, 2, 4, 8, 16, 32, 64, 128, 256, 512];
  return {layers: [
    {input_size: 1, condition_size: 1, channels: a[0], head_size: a[2], kernel_size: 3, dilations: d1, activation: 'Tanh', gated: false, head_bias: false},
    {input_size: a[0], condition_size: 1, channels: a[1], head_size: 1, kernel_size: 3, dilations: d2, activation: 'Tanh', gated: false, head_bias: true}],
    head: null, head_scale: 0.02};
}
// The weight list in NAM order, as tensors. Dense layout of a conv is [k][row][col]; NAM order is (row, col, k).
function waveLayout(cfg){
  const T = []; let off = 0; const add = o => { o.off = off; off += o.n; T.push(o); return o; };
  cfg.layers.forEach((L, a) => {
    const C = L.channels, I = L.input_size, H = L.head_size, K = L.kernel_size;
    add({a, kind: 'R', K: 1, rows: C, cols: I, n: C*I});
    L.dilations.forEach((d, l) => {
      add({a, l, kind: 'W', K, rows: C, cols: C, d, n: K*C*C}); add({a, l, kind: 'b', K: 1, rows: C, cols: 1, n: C});
      add({a, l, kind: 'M', K: 1, rows: C, cols: 1, n: C});
      add({a, l, kind: 'P', K: 1, rows: C, cols: C, n: C*C}); add({a, l, kind: 'p', K: 1, rows: C, cols: 1, n: C});
    });
    add({a, kind: 'Q', K: 1, rows: H, cols: C, n: H*C}); if(L.head_bias) add({a, kind: 'q', K: 1, rows: H, cols: 1, n: H});
  });
  add({kind: 'scale', K: 1, rows: 1, cols: 1, n: 1});
  return {T, n: off};
}
function waveInit(cfg, seed){
  const r = rng(seed), lay = waveLayout(cfg), P = new Float32Array(lay.n);
  for(const t of lay.T){
    if(t.kind === 'scale'){ P[t.off] = cfg.head_scale; continue; }
    const fan = t.kind === 'b' || t.kind === 'p' || t.kind === 'q' ? (t.kind === 'b' ? cfg.layers[t.a].channels*3 : cfg.layers[t.a].channels) : t.cols*t.K;
    const k = 1/Math.sqrt(fan); for(let i = 0; i < t.n; i++) P[t.off + i] = (r()*2 - 1)*k;
  }
  return P;
}
function waveRF(cfg){ return 1 + cfg.layers.reduce((s, L) => s + L.dilations.reduce((q, d) => q + d*(L.kernel_size - 1), 0), 0); }
// One worker's WaveNet trainer. Uses the playback kernel module (conv, act, ew, wgrad).
function WaveCore(mod, cfg, data, opt){
  const Kx = (opt.inst || new WebAssembly.Instance(mod, {})).exports, mem = Kx.mem;
  const lay = waveLayout(cfg), nP = lay.n, RF = waveRF(cfg);
  const T = opt.T || 8192, Tw = Math.ceil((RF - 1)/16)*16, N = Tw + T, B = opt.batch || 1;
  const maxD = Math.max(...cfg.layers.map(L => Math.max(...L.dilations)*(L.kernel_size - 1)));
  const MB = Math.ceil(maxD/16)*16 + 16, MA = MB, stride = (MB + N + MA)*4;
  let top = 64; const al = b => { const p = top; top += Math.ceil(b/64)*64 + 64; return p; };
  const buf = rows => { const base = al(rows*stride); return {rows, at: r => base + r*stride + MB*4}; };
  for(const t of lay.T){ if(t.kind === 'scale') continue; t.w = al(t.n*4); t.g = al(t.n*4); if(t.kind === 'W' || t.kind === 'P' || t.kind === 'Q' || t.kind === 'R') t.wt = al(t.n*4); }
  const get = (a, l, kind) => lay.T.find(t => t.a === a && t.l === l && t.kind === kind);
  const xb = buf(1), ones = buf(1);
  const arrays = cfg.layers.map((L, a) => {
    const C = L.channels, H = L.head_size, nl = L.dilations.length;
    return {C, H, I: L.input_size, nl, X: Array.from({length: nl + 1}, () => buf(C)), A: [null].concat(Array.from({length: nl}, () => buf(C))), S: buf(C), h: buf(H), dh: buf(H),
      R: get(a, undefined, 'R'), Q: get(a, undefined, 'Q'), q: get(a, undefined, 'q'),
      layers: L.dilations.map((d, l) => ({d, W: get(a, l, 'W'), b: get(a, l, 'b'), M: get(a, l, 'M'), P: get(a, l, 'P'), p: get(a, l, 'p')}))};
  });
  const Cmax = Math.max(...arrays.map(A => A.C)), dXa = buf(Cmax), dXb = buf(Cmax), dA = buf(Cmax), dS = buf(Cmax);
  const need = Math.ceil(top/65536) - mem.buffer.byteLength/65536; if(need > 0) mem.grow(need);
  const F = new Float32Array(mem.buffer);
  { const o = ones.at(0) >> 2; F.fill(1, o, o + N); }
  const {x, y, Ep, Er} = data, r = rng(opt.seed || 1);
  function scatter(P){
    for(const t of lay.T){ if(t.kind === 'scale') continue;
      const w = t.w >> 2, K = t.K, R = t.rows, Cc = t.cols, mat = R*Cc;
      for(let i = 0; i < R; i++) for(let j = 0; j < Cc; j++) for(let k = 0; k < K; k++) F[w + k*mat + i*Cc + j] = P[t.off + (i*Cc + j)*K + k];
      if(t.wt){ const wt = t.wt >> 2; for(let k = 0; k < K; k++) for(let i = 0; i < R; i++) for(let j = 0; j < Cc; j++) F[wt + k*mat + j*R + i] = F[w + k*mat + i*Cc + j]; }
      F.fill(0, t.g >> 2, (t.g >> 2) + t.n);
    }
  }
  function gather(){
    const g = new Float32Array(nP);
    for(const t of lay.T){ if(t.kind === 'scale') continue; const gg = t.g >> 2, K = t.K, R = t.rows, Cc = t.cols, mat = R*Cc;
      for(let i = 0; i < R; i++) for(let j = 0; j < Cc; j++) for(let k = 0; k < K; k++) g[t.off + (i*Cc + j)*K + k] = F[gg + k*mat + i*Cc + j]; }
    return g;
  }
  function forward(){
    arrays.forEach((A, a) => {
      const C = A.C, U = a ? arrays[a - 1].X[arrays[a - 1].nl] : xb;
      Kx.conv(A.R.w, 1, C, A.I, 0, U.at(0), stride, A.X[0].at(0), stride, N, 0, 0);
      if(a === 0) Kx.ew(4, A.S.at(0), stride, 0, 0, C, N, 0); else Kx.ew(2, A.S.at(0), stride, arrays[a - 1].h.at(0), stride, C, N, 0);
      A.layers.forEach((Ly, i) => { const l = i + 1, Z = A.A[l];
        Kx.conv(Ly.W.w, Ly.W.K, C, C, Ly.d, A.X[l - 1].at(0), stride, Z.at(0), stride, N, Ly.b.w, 0);
        Kx.conv(Ly.M.w, 1, C, 1, 0, xb.at(0), stride, Z.at(0), stride, N, 0, 1);
        Kx.act(1, Z.at(0), C, stride, N, 0, 0, 0, 0);
        Kx.ew(0, A.S.at(0), stride, Z.at(0), stride, C, N, 0);
        Kx.ew(2, A.X[l].at(0), stride, A.X[l - 1].at(0), stride, C, N, 0);
        Kx.conv(Ly.P.w, 1, C, C, 0, Z.at(0), stride, A.X[l].at(0), stride, N, Ly.p.w, 1);
      });
      Kx.conv(A.Q.w, 1, A.H, C, 0, A.S.at(0), stride, A.h.at(0), stride, N, A.q ? A.q.w : 0, 0);
    });
  }
  function backward(){
    let dX = dXa, dU = dXb;
    for(let a = arrays.length - 1; a >= 0; a--){
      const A = arrays[a], C = A.C, H = A.H;
      Kx.wgrad(A.Q.g, 1, H, C, 0, A.S.at(0), stride, A.dh.at(0), stride, N);
      if(A.q) Kx.wgrad(A.q.g, 1, H, 1, 0, ones.at(0), stride, A.dh.at(0), stride, N);
      Kx.conv(A.Q.wt, 1, C, H, 0, A.dh.at(0), stride, dS.at(0), stride, N, 0, 0);
      if(a === arrays.length - 1) Kx.ew(4, dX.at(0), stride, 0, 0, C, N, 0);
      for(let i = A.nl - 1; i >= 0; i--){ const Ly = A.layers[i], l = i + 1, Z = A.A[l];
        Kx.wgrad(Ly.P.g, 1, C, C, 0, Z.at(0), stride, dX.at(0), stride, N);
        Kx.wgrad(Ly.p.g, 1, C, 1, 0, ones.at(0), stride, dX.at(0), stride, N);
        Kx.ew(2, dA.at(0), stride, dS.at(0), stride, C, N, 0);
        Kx.conv(Ly.P.wt, 1, C, C, 0, dX.at(0), stride, dA.at(0), stride, N, 0, 1);
        Kx.ew(6, dA.at(0), stride, Z.at(0), stride, C, N, 0);
        Kx.wgrad(Ly.W.g, Ly.W.K, C, C, Ly.d, A.X[l - 1].at(0), stride, dA.at(0), stride, N);
        Kx.wgrad(Ly.b.g, 1, C, 1, 0, ones.at(0), stride, dA.at(0), stride, N);
        Kx.wgrad(Ly.M.g, 1, C, 1, 0, xb.at(0), stride, dA.at(0), stride, N);
        Kx.conv(Ly.W.wt, Ly.W.K, C, C, -Ly.d, dA.at(0), stride, dX.at(0), stride, N, 0, 1);
      }
      const U = a ? arrays[a - 1].X[arrays[a - 1].nl] : xb;
      Kx.wgrad(A.R.g, 1, C, A.I, 0, U.at(0), stride, dX.at(0), stride, N);
      if(a > 0){
        Kx.conv(A.R.wt, 1, A.I, C, 0, dX.at(0), stride, dU.at(0), stride, N, 0, 0);
        Kx.ew(2, arrays[a - 1].dh.at(0), stride, dS.at(0), stride, arrays[a - 1].H, N, 0);
        const t = dX; dX = dU; dU = t;
      }
    }
  }
  const hs = cfg.head_scale, last = arrays[arrays.length - 1];
  function lossAt(s, scale){ // forward on the clip that ends at s+T, then write dLoss/dh into the last head grad row
    const xo = xb.at(0) >> 2; for(let t = 0; t < N; t++){ const j = s - Tw + t; F[xo + t] = j >= 0 ? x[j] : 0; }
    forward();
    const ho = last.h.at(0) >> 2, go = last.dh.at(0) >> 2, M = T - 1;
    const d = new Float64Array(T); let L = 0;
    for(let t = 0; t < T; t++) d[t] = hs*F[ho + Tw + t] - y[s + t];
    F.fill(0, go, go + N);
    let enext = 0;
    for(let t = T - 1; t >= 0; t--){
      const e = t >= 1 ? d[t] - 0.85*d[t - 1] : 0;
      if(t >= 1) L += e*e/Ep + d[t]*d[t]/Er;
      const g = (2/M)*((e - 0.85*enext)/Ep + (t >= 1 ? d[t]/Er : 0));
      F[go + Tw + t] = hs*g*scale; enext = e;
    }
    return L/M;
  }
  function step(P){
    scatter(P); let loss = 0;
    for(let b = 0; b < B; b++){ const s = Tw + Math.floor(r()*(x.length - T - Tw)); loss += lossAt(s, 1/B)/B; backward(); }
    return {loss, grad: gather()};
  }
  function lossOnly(P, s){ scatter(P); return lossAt(s, 1); }
  function gradAt(P, s){ scatter(P); const L = lossAt(s, 1); backward(); return {loss: L, grad: gather()}; }
  return {step, nP, lossOnly, gradAt, T, Tw, RF};
}
// Training works on output divided by ys. Put ys back into the last head so the file plays at the real level.
function waveScaleOut(cfg, P, ys){
  const out = Float32Array.from(P), lay = waveLayout(cfg), last = cfg.layers.length - 1;
  for(const t of lay.T) if(t.a === last && (t.kind === 'Q' || t.kind === 'q')) for(let i = 0; i < t.n; i++) out[t.off + i] *= ys;
  return out;
}
function waveFile(cfg, P, info){
  const w = Array.from(P, v => Math.fround(v)); w[w.length - 1] = cfg.head_scale;
  const d = new Date();
  return {version: '0.5.4', architecture: 'WaveNet', config: cfg, weights: w, sample_rate: info.sr || 48000,
    metadata: Object.assign({
      date: {year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate(), hour: d.getHours(), minute: d.getMinutes(), second: d.getSeconds()},
      name: info.name || 'Neon Peach clone', modeled_by: 'Neon Peach', gear_type: info.gearType == null ? null : info.gearType, gear_make: null, gear_model: null, tone_type: null,
      loudness: info.loudness == null ? null : info.loudness, input_level_dbu: null, output_level_dbu: null,
      training: {settings: {source: 'neon-peach', architecture: info.arch || null}, validation_esr: info.esr == null ? null : info.esr}
    }, info.meta || {})};
}

// ---------------------------------------------------------------- the trainer (runs on the page)
// engines: objects with async step(P) -> {loss, grad} and async val(P) -> esr. Adam with a cosine schedule.
async function train(o){
  const H = o.H, P = o.init || initParams(H, o.seed || 7), nP = P.length;
  const m = new Float64Array(nP), v = new Float64Array(nP), steps = o.steps, E = o.engines;
  let best = {esr: Infinity, P: Float32Array.from(P), step: 0}, t = 0;
  const lrAt = s => { const w = Math.min(1, (s + 1)/30); return w*(o.lr1 + 0.5*(o.lr0 - o.lr1)*(1 + Math.cos(Math.PI*s/steps))); };
  const t0 = Date.now(), curve = []; let lastVal = -1, done = 0;
  for(let s = 0; s < steps; s++){
    if(o.cancelled && o.cancelled()) break;
    done = s + 1;
    const res = await Promise.all(E.map(e => e.step(P)));
    const g = new Float64Array(nP); let loss = 0;
    for(const r of res){ loss += r.loss/res.length; for(let i = 0; i < nP; i++) g[i] += r.grad[i]/res.length; }
    let nrm = 0; for(let i = 0; i < nP; i++) nrm += g[i]*g[i]; nrm = Math.sqrt(nrm);
    if(!Number.isFinite(nrm)) continue;
    const sc = nrm > o.clip ? o.clip/nrm : 1, lr = lrAt(s); t++;
    const c1 = 1 - Math.pow(0.9, t), c2 = 1 - Math.pow(0.999, t);
    for(let i = 0; i < nP; i++){ const gi = g[i]*sc; m[i] = 0.9*m[i] + 0.1*gi; v[i] = 0.999*v[i] + 0.001*gi*gi; P[i] -= lr*(m[i]/c1)/(Math.sqrt(v[i]/c2) + 1e-8); }
    curve.push(loss);
    const last = s === steps - 1;
    if(last || (s + 1) % o.valEvery === 0){
      const e = await E[0].val(P); lastVal = s;
      if(e < best.esr) best = {esr: e, P: Float32Array.from(P), step: s};
      if(o.progress) o.progress({step: s + 1, steps, loss, esr: e, best: best.esr, secs: (Date.now() - t0)/1000});
    } else if(o.progress && (s & 3) === 0) o.progress({step: s + 1, steps, loss, best: best.esr, secs: (Date.now() - t0)/1000});
  }
  if(done && lastVal !== done - 1){ const e = await E[0].val(P); if(e < best.esr) best = {esr: e, P: Float32Array.from(P), step: done - 1}; }
  return {P: best.P, esr: best.esr, step: best.step, curve, steps: done};
}
// Turn trained params into NAM weights. ys is the output scale used in training.
function toNet(P, H, ys){
  const G = 4*H, cols = H + 1;
  return {H, layers: [{W: P.subarray(0, G*cols), b: P.subarray(G*cols, G*cols + G), h0: new Float32Array(H), c0: new Float32Array(H)}],
    hw: Float32Array.from(P.subarray(G*cols + G, G*cols + G + H), v => v*ys), hb: P[paramCount(H) - 1]*ys};
}

// ---------------------------------------------------------------- worker side
// One message handler for both model kinds. The page sends the kernel bytes, the data and the settings once.
// m.mod / m.inst / m.valInst may be given on the page, where big modules cannot be made synchronously.
function makeLearner(m){
  const mod = m.mod || new WebAssembly.Module(m.wasm), data = {x: m.xT, y: m.yT, Ep: m.Ep, Er: m.Er};
  if(m.kind === 'wave'){
    const core = WaveCore(mod, m.cfg, data, {T: m.T || 8192, seed: m.seed, batch: m.batch || 1, inst: m.inst});
    let vk = m.valInst ? {exports: m.valInst.exports} : null;   // one player memory, reused for every check
    const val = m.xV ? P => { if(!vk) vk = NAMCore.instantiate(mod);
      return esr(NAMCore.render(NAMCore.build(NAMCore.parse(waveFile(m.cfg, P, {sr: 48000})), vk), m.xV).subarray(m.ctx), m.yV); } : null;
    return {step: core.step, val};
  }
  const core = TrainCore(mod, m.H, data, {warm: m.warm || 512, Tg: m.Tg || 1024, seed: m.seed, inst: m.inst});
  return {step: core.step, val: m.xV ? P => esr(core.predict(P, m.xV, m.ctx), m.yV) : null};
}
if(typeof self !== 'undefined' && typeof WorkerGlobalScope !== 'undefined' && self instanceof WorkerGlobalScope){
  let L = null;
  self.onmessage = (ev) => {
    const m = ev.data;
    try{
      if(m.cmd === 'init'){ L = makeLearner(m); self.postMessage({id: m.id, ok: true}); }
      else if(m.cmd === 'step'){ const r = L.step(m.P); self.postMessage({id: m.id, loss: r.loss, grad: r.grad}, [r.grad.buffer]); }
      else if(m.cmd === 'val'){ self.postMessage({id: m.id, esr: L.val(m.P)}); }
    }catch(e){ self.postMessage({id: m.id, error: String(e && e.message || e)}); }
  };
}

return {makeLearner, TONE_VERSION, TONE_SECS, makeTone, scaleTone, content, sweep, wav24, wavF32, analyze, slices, convolve, paramCount, initParams, TrainCore, train, toNet, esr, energies, rng, WAVE_ARCH, waveConfig, waveLayout, waveInit, waveRF, WaveCore, waveFile, waveScaleOut};
})();
if(typeof module !== 'undefined' && module.exports) module.exports = Cloner;
