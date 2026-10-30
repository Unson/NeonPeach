// WaveNet trainer tests: gradient check against the plain reference, speed, and a short training run.
// Usage: node tools/test_wave.js [train]
'use strict';
const fs = require('fs'), path = require('path');
const C = require('../cloner.js'), NAM = require('../namcore.js'), REF = require('./namref.js'), wat = require('./wat2wasm.js');
let fails = 0; const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if(!c) fails++; };
function refLoss(cfg, P, x, y, s, Tw, T, Ep, Er){
  const desc = NAM.parse({version: '0.5.4', architecture: 'WaveNet', config: cfg, weights: Array.from(P)});
  const xs = new Float32Array(Tw + T); for(let t = 0; t < Tw + T; t++){ const j = s - Tw + t; xs[t] = j >= 0 ? x[j] : 0; }
  const out = REF.run(desc, xs), d = new Float64Array(T);
  for(let t = 0; t < T; t++) d[t] = out[Tw + t] - y[s + t];
  let L = 0; for(let t = 1; t < T; t++){ const e = d[t] - 0.85*d[t - 1]; L += e*e/Ep + d[t]*d[t]/Er; }
  return L/(T - 1);
}
(async () => {
  const mod = new WebAssembly.Module(await wat(fs.readFileSync(path.join(__dirname, '..', 'wasm', 'namkern.wat'), 'utf8')));
  // 1. gradient check on a tiny two-array WaveNet
  for(const C0 of [3, 4]){ const cfg = {layers: [
      {input_size: 1, condition_size: 1, channels: C0, head_size: 2, kernel_size: 3, dilations: [1, 2], activation: 'Tanh', gated: false, head_bias: false},
      {input_size: C0, condition_size: 1, channels: 2, head_size: 1, kernel_size: 3, dilations: [4, 1], activation: 'Tanh', gated: false, head_bias: true}], head: null, head_scale: 0.5};
    const r = C.rng(9), n = 400, x = Float32Array.from({length: n}, () => r()*2 - 1), y = Float32Array.from({length: n}, (_, i) => 0.4*Math.tanh(2*x[Math.max(0, i - 1)]));
    const P = C.waveInit(cfg, 3), Ep = 0.4, Er = 0.3, core = C.WaveCore(mod, cfg, {x, y, Ep, Er}, {T: 64, seed: 1});
    const s = 100, g = core.gradAt(P, s), L0 = refLoss(cfg, P, x, y, s, core.Tw, core.T, Ep, Er);
    ok(Math.abs(g.loss - L0) < 1e-5*Math.max(1, L0), `wave (${C0} ch) loss matches the reference (${g.loss.toFixed(6)} vs ${L0.toFixed(6)})`);
    let worst = 0, wi = -1;
    for(let i = 0; i < P.length - 1; i++){ const Pp = Float64Array.from(P), Pm = Float64Array.from(P), h = 1e-4; Pp[i] += h; Pm[i] -= h;
      const num = (refLoss(cfg, Pp, x, y, s, core.Tw, core.T, Ep, Er) - refLoss(cfg, Pm, x, y, s, core.Tw, core.T, Ep, Er))/(2*h);
      const e = Math.abs(num - g.grad[i])/Math.max(2e-3, Math.abs(num)); if(e > worst){ worst = e; wi = i; } }
    ok(worst < 5e-3, `wave (${C0} ch) gradient check over ${P.length - 1} weights, worst rel err ${worst.toExponential(2)} (at ${wi})`);
  }
  // 2. speed per training clip for each size, and the file it writes plays back
  const tone = C.makeTone(48000);
  function onePole(x, fc, sr, hp){ const a = Math.exp(-2*Math.PI*fc/sr), y = new Float32Array(x.length); let s = 0; for(let i = 0; i < x.length; i++){ s = (1 - a)*x[i] + a*s; y[i] = hp ? x[i] - s : s; } return y; }
  const drive = (x, sr) => { const a = onePole(onePole(x, 25, sr, true), 3500, sr); return onePole(Float32Array.from(a, v => 0.5*Math.tanh(6*v)), 6000, sr); };
  const rec = drive(tone.x, 48000), sl = C.slices(tone, rec, 0);
  let ys = 0; for(const v of sl.yT) ys += v*v; ys = Math.sqrt(ys/sl.yT.length);
  const yT = Float32Array.from(sl.yT, v => v/ys), yV = Float32Array.from(sl.yV, v => v/ys), en = C.energies(yT);
  for(const name of ['nano', 'feather', 'lite', 'standard']){
    const cfg = C.waveConfig(name), core = C.WaveCore(mod, cfg, {x: sl.xT, y: yT, Ep: en.Ep, Er: en.Er}, {T: 8192, seed: 1});
    const P = C.waveInit(cfg, 1); core.step(P); const t0 = process.hrtime.bigint(); for(let i = 0; i < 3; i++) core.step(P);
    const ms = Number(process.hrtime.bigint() - t0)/3e6;
    const f = C.waveFile(cfg, P, {sr: 48000}), d = NAM.parse(JSON.stringify(f));
    console.log(`     ${name.padEnd(8)} ${String(P.length).padStart(6)} weights, rf ${core.RF}, ${ms.toFixed(0)} ms per 8192-sample clip (+${core.Tw} warm-up)  -> ${NAM.describe(d)}`);
  }
  // 3. short training run (feather) on the fake drive
  if(process.argv.includes('train')){
    for(const name of (process.argv[5] || 'nano,feather').split(',')){
      const cfg = C.waveConfig(name), cores = [1, 2].map(seed => C.WaveCore(mod, cfg, {x: sl.xT, y: yT, Ep: en.Ep, Er: en.Er}, {T: 8192, seed}));
      const kmod = mod, valDesc = P => NAM.parse(C.waveFile(cfg, P, {sr: 48000}));
      const engines = cores.map(c => ({step: async P => c.step(P), val: async P => { const pl = NAM.build(valDesc(P), NAM.instantiate(kmod)); return C.esr(NAM.render(pl, sl.xValCtx).subarray(4096), yV); }}));
      const steps = +(process.argv[3] || 300), t0 = Date.now(), hist = [];
      const out = await C.train({H: 0, init: C.waveInit(cfg, 7), steps, lr0: +(process.argv[4] || 4e-3), lr1: +(process.argv[4] || 4e-3)/10, clip: 1, valEvery: Math.max(25, Math.floor(steps/8)), engines,
        progress: p => { if(p.esr != null) hist.push(p.esr.toFixed(4)); }});
      console.log(`     ${name}: ${steps} steps in ${((Date.now() - t0)/1000).toFixed(0)} s, best check error ${out.esr.toFixed(4)} [${hist.join(' ')}]`);
    }
  }
  console.log(fails ? fails + ' FAILED' : 'all passed');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
