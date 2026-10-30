// Tests for the clone pipeline: gradient check, alignment, IR check, and training on fake pedals.
// Usage: node tools/test_clone.js [quick]
'use strict';
const fs = require('fs'), path = require('path');
const C = require('../cloner.js'), NAM = require('../namcore.js'), wat = require('./wat2wasm.js');
let fails = 0; const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if(!c) fails++; };
const quick = process.argv.includes('quick');

function refLoss(P, H, x, y, warm, Tg, Ep, Er){ // float64 reference of the training loss (one lane)
  const G = 4*H, cols = H + 1, sg = v => 1/(1 + Math.exp(-v));
  let h = new Float64Array(H), c = new Float64Array(H); const yh = [];
  for(let t = 0; t < warm + Tg; t++){
    const a = new Float64Array(G);
    for(let r = 0; r < G; r++){ let s = P[G*cols + r] + P[r*cols]*x[t]; for(let k = 0; k < H; k++) s += P[r*cols + 1 + k]*h[k]; a[r] = s; }
    const hn = new Float64Array(H);
    for(let k = 0; k < H; k++){ const i = sg(a[k]), f = sg(a[H + k]), g = Math.tanh(a[2*H + k]), o = sg(a[3*H + k]); c[k] = f*c[k] + i*g; hn[k] = o*Math.tanh(c[k]); }
    h = hn;
    if(t >= warm){ let s = P[P.length - 1]; for(let k = 0; k < H; k++) s += P[G*cols + G + k]*h[k]; yh.push(s); }
  }
  let L = 0; const d = yh.map((v, i) => v - y[warm + i]);
  for(let t = 1; t < Tg; t++){ const e = d[t] - 0.85*d[t-1]; L += e*e/Ep + d[t]*d[t]/Er; }
  return L/(Tg - 1);
}
function onePole(x, fc, sr, hp){ const a = Math.exp(-2*Math.PI*fc/sr), y = new Float32Array(x.length); let s = 0; for(let i = 0; i < x.length; i++){ s = (1 - a)*x[i] + a*s; y[i] = hp ? x[i] - s : s; } return y; }
const pedals = {
  drive: (x, sr) => { const a = onePole(onePole(x, 25, sr, true), 3500, sr); return onePole(Float32Array.from(a, v => 0.5*Math.tanh(6*v)), 6000, sr); },
  fuzz: (x, sr) => { const a = onePole(x, 60, sr, true); return onePole(Float32Array.from(a, v => 0.6*(Math.tanh(12*v + 0.4) - Math.tanh(0.4))), 4000, sr); },
  comp: (x, sr) => { const y = new Float32Array(x.length), at = Math.exp(-1/(sr*0.004)), rl = Math.exp(-1/(sr*0.12)); let env = 0;
    for(let i = 0; i < x.length; i++){ const a = Math.abs(x[i]); env = a > env ? at*env + (1 - at)*a : rl*env + (1 - rl)*a; const lvl = 20*Math.log10(env + 1e-9), over = Math.max(0, lvl + 24); y[i] = x[i]*Math.pow(10, -over*0.75/20)*1.8; } return y; },
  verb: (x, sr) => { const r = C.rng(5), n = Math.round(sr*0.6), ir = new Float32Array(n); ir[0] = 0.6; for(let i = 1; i < n; i++) ir[i] = (r()*2 - 1)*0.03*Math.exp(-i/(sr*0.12));
    return Float32Array.from(onePole(C.convolve(x, ir).subarray(0, x.length), 2500, sr), v => v*0.5); }
};
function record(tone, fn, latency, noise){
  const y = fn(tone.x, tone.sr), out = new Float32Array(tone.x.length + latency), r = C.rng(99);
  out.set(y, latency); if(noise) for(let i = 0; i < out.length; i++) out[i] += noise*(r()*2 - 1);
  return out;
}

(async () => {
  const mod = new WebAssembly.Module(await wat(fs.readFileSync(path.join(__dirname, '..', 'wasm', 'lstmtrain.wat'), 'utf8')));
  const kmod = new WebAssembly.Module(await wat(fs.readFileSync(path.join(__dirname, '..', 'wasm', 'namkern.wat'), 'utf8')));
  // 1. gradient check against a float64 reference
  { const H = 3, warm = 0, Tg = 16, T = warm + Tg, r = C.rng(3); // warm 0: full backprop, so it must match exactly
    const x = Float32Array.from({length: T + 1}, () => r()*2 - 1), y = Float32Array.from({length: T + 1}, (_, i) => 0.5*Math.tanh(2*x[Math.max(0, i - 1)]));
    const P = C.initParams(H, 5); const Ep = 0.3, Er = 0.2;
    const core = C.TrainCore(mod, H, {x, y, Ep, Er}, {warm, Tg, seed: 1});
    const {loss, grad} = core.step(P);
    const L0 = refLoss(P, H, x, y, warm, Tg, Ep, Er);
    ok(Math.abs(loss - L0) < 1e-5*Math.max(1, L0), `loss matches reference (${loss.toFixed(6)} vs ${L0.toFixed(6)})`);
    let worst = 0;
    for(let i = 0; i < P.length; i++){
      const Pp = Float64Array.from(P), Pm = Float64Array.from(P), h = 1e-4; Pp[i] += h; Pm[i] -= h;
      const num = (refLoss(Pp, H, x, y, warm, Tg, Ep, Er) - refLoss(Pm, H, x, y, warm, Tg, Ep, Er))/(2*h);
      worst = Math.max(worst, Math.abs(num - grad[i])/Math.max(1e-3, Math.abs(num)));
    }
    ok(worst < 2e-3, `gradient check (${P.length} params), worst rel err ${worst.toExponential(2)}`);
  }
  // 2. the tone
  const tone = C.makeTone(48000);
  ok(Math.abs(tone.x.length/48000 - C.TONE_SECS) < 0.01, `test tone is ${(tone.x.length/48000).toFixed(1)} s`);
  let pk = 0; for(const v of tone.x) pk = Math.max(pk, Math.abs(v)); ok(pk < 1 && pk > 0.9, `tone peak ${pk.toFixed(3)}`);
  const w = C.wav24(tone.x, 48000); ok(w.byteLength === 44 + tone.x.length*3, 'wav file size');
  // 3. alignment + linear check on each fake pedal
  const res = {};
  for(const [name, fn] of Object.entries(pedals)){
    const lat = 311, rec = record(tone, fn, lat, 1e-4), a = C.analyze(tone, rec);
    res[name] = {rec, a};
    ok(a.problems.length === 0, `${name}: no problems (${a.problems.join(',')}) snr ${a.snr.toFixed(0)} dB`);
    ok(a.latency <= lat && a.latency >= lat - 3, `${name}: latency ${a.latency} (true ${lat})`);
    ok(a.slip === 0 || Math.abs(a.slip) <= 1, `${name}: end sweep lines up (slip ${a.slip}, end peak ${a.endPeak && a.endPeak.toFixed(2)})`);
    ok(a.isLinear === (name === 'verb'), `${name}: linear? ${a.isLinear} (plain-filter error ${a.linearEsr.toFixed(4)}, IR ${a.ir.length} samples)`);
  }
  // 3b. a take that slipped is caught: a dropout in the middle, and two clocks drifting apart
  { const base = res.drive.rec, at = Math.round(48000*30), gap = 256, drop = new Float32Array(base.length + gap); drop.set(base.subarray(0, at)); drop.set(base.subarray(at), at + gap);
    const a1 = C.analyze(tone, drop); ok(a1.problems.includes('slip') && a1.slip === gap, `a dropout of ${gap} samples is caught (slip ${a1.slip})`);
    const k = 1.0001, n = Math.floor(base.length/k), drift = new Float32Array(n); for(let i = 0; i < n; i++){ const p = i*k, j = Math.floor(p), fr = p - j; drift[i] = base[j]*(1 - fr) + (base[j + 1] || 0)*fr; }
    const a2 = C.analyze(tone, drift); ok(a2.problems.includes('slip'), `clock drift of 100 ppm is caught (slip ${a2.slip})`);
    const short = base.subarray(0, tone.seg.endAt); const a3 = C.analyze(tone, short); ok(a3.problems.includes('short') && !a3.problems.includes('slip'), 'a take cut before the end sweep is called short');
    const k2 = 1.000003, n2 = Math.floor(base.length/k2), d2 = new Float32Array(n2); for(let i = 0; i < n2; i++){ const p = i*k2, j = Math.floor(p), fr = p - j; d2[i] = base[j]*(1 - fr) + (base[j + 1] || 0)*fr; }
    const a5 = C.analyze(tone, d2); ok(a5.problems.includes('drift') && !a5.problems.includes('slip'), `a tiny drift (3 ppm) is a warning, not an error (slip ${a5.slip})`);
    for(const [nm, fn] of [['pure octave-up (rectifier)', x => Float32Array.from(x, v => 0.8*Math.abs(v))], ['octave fuzz blend', x => Float32Array.from(x, v => 0.5*Math.abs(v) + 0.3*v)]]){
      const y = record(tone, fn, 311, 1e-4), a6 = C.analyze(tone, y); ok(!a6.problems.includes('slip') && !a6.problems.includes('drift'), `${nm}: no false slip (slip ${a6.slip}, problems ${a6.problems.join(',') || 'none'})`); }
    const g = C.scaleTone(tone, 0.25), y = record(g, pedals.drive, 200, 1e-4), a4 = C.analyze(g, y); ok(!a4.problems.length && Math.abs(a4.slip) <= 1, `scaled tone lines up at both ends (latency ${a4.latency}, slip ${a4.slip})`); }
  // 4. training on fake pedals
  const plan = quick ? {drive: 300} : {drive: 900, fuzz: 900, comp: 900};
  for(const [name, steps] of Object.entries(plan)){
    const {rec, a} = res[name], s = C.slices(tone, rec, a.latency);
    let ys = 0; for(const v of s.yT) ys += v*v; ys = Math.sqrt(ys/s.yT.length);
    const yT = Float32Array.from(s.yT, v => v/ys), yV = Float32Array.from(s.yV, v => v/ys), en = C.energies(yT), H = 16;
    const cores = [1, 2].map(seed => C.TrainCore(mod, H, {x: s.xT, y: yT, Ep: en.Ep, Er: en.Er}, {warm: 512, Tg: 1024, seed}));
    const engines = cores.map(c => ({step: async P => c.step(P), val: async P => C.esr(c.predict(P, s.xValCtx, 4096), yV)}));
    const t0 = Date.now(); let lastLog = 0;
    const out = await C.train({H, steps, lr0: 2e-2, lr1: 1.3e-3, clip: 1, valEvery: 50, engines, progress: p => { if(p.esr != null && p.step - lastLog >= 100){ lastLog = p.step; console.log(`     ${name} step ${p.step} loss ${p.loss.toFixed(4)} check ${p.esr.toFixed(4)} ${p.secs.toFixed(0)}s`); } }});
    const secs = (Date.now() - t0)/1000;
    // export, reload through the NAM reader and play on the real-time kernel
    const file = (typeof NAM.lstmFile === 'function') ? NAM.lstmFile(C.toNet(out.P, H, ys), {name, sr: 48000, esr: out.esr}) : null;
    const d = NAM.parse(JSON.stringify(file)), pl = NAM.build(d, NAM.instantiate(kmod));
    const yp = NAM.render(pl, s.xValCtx).subarray(4096);
    const e2 = C.esr(yp, s.yV);
    ok(out.esr < (quick ? 0.2 : name === 'comp' ? 0.08 : 0.05), `${name}: trained ${steps} steps in ${secs.toFixed(0)} s (${(1000*secs/steps).toFixed(0)} ms/step), check error ${out.esr.toFixed(4)} = ${(100*(1 - out.esr)).toFixed(1)}% close`);
    ok(Math.abs(e2 - out.esr) < 0.01 + 0.2*out.esr, `${name}: exported .nam plays the same in the player (error ${e2.toFixed(4)})`);
  }
  console.log(fails ? fails + ' FAILED' : 'all passed');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
