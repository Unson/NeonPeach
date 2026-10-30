// Try training settings on fake pedals with a fixed time budget. Usage: node tools/sweep_train.js <secs> <pedal,...> <cfg,...>
'use strict';
const fs = require('fs'), path = require('path'), C = require('../cloner.js'), wat = require('./wat2wasm.js');
function onePole(x, fc, sr, hp){ const a = Math.exp(-2*Math.PI*fc/sr), y = new Float32Array(x.length); let s = 0; for(let i = 0; i < x.length; i++){ s = (1 - a)*x[i] + a*s; y[i] = hp ? x[i] - s : s; } return y; }
const pedals = {
  drive: (x, sr) => { const a = onePole(onePole(x, 25, sr, true), 3500, sr); return onePole(Float32Array.from(a, v => 0.5*Math.tanh(6*v)), 6000, sr); },
  fuzz: (x, sr) => { const a = onePole(x, 60, sr, true); return onePole(Float32Array.from(a, v => 0.6*(Math.tanh(12*v + 0.4) - Math.tanh(0.4))), 4000, sr); },
  comp: (x, sr) => { const y = new Float32Array(x.length), at = Math.exp(-1/(sr*0.004)), rl = Math.exp(-1/(sr*0.12)); let env = 0;
    for(let i = 0; i < x.length; i++){ const a = Math.abs(x[i]); env = a > env ? at*env + (1 - at)*a : rl*env + (1 - rl)*a; const lvl = 20*Math.log10(env + 1e-9), over = Math.max(0, lvl + 24); y[i] = x[i]*Math.pow(10, -over*0.75/20)*1.8; } return y; }
};
const CFG = {
  A: {H: 16, Tg: 2048, warm: 1024, lr0: 6e-3},
  B: {H: 16, Tg: 2048, warm: 1024, lr0: 1.5e-2},
  C: {H: 16, Tg: 1024, warm: 512, lr0: 1.5e-2},
  D: {H: 24, Tg: 1024, warm: 512, lr0: 1.5e-2},
  E: {H: 16, Tg: 1024, warm: 512, lr0: 3e-2},
  F: {H: 16, Tg: 512, warm: 512, lr0: 1.5e-2},
  G: {H: 24, Tg: 2048, warm: 1024, lr0: 1e-2},
  H: {H: 32, Tg: 1024, warm: 512, lr0: 1e-2},
  K: {H: 16, Tg: 1024, warm: 512, lr0: 2e-2},
  L: {H: 16, Tg: 1024, warm: 512, lr0: 1e-2},
  M: {H: 20, Tg: 1024, warm: 512, lr0: 1.5e-2},
  N: {H: 16, Tg: 1024, warm: 512, lr0: 2e-2, clip: 0.25},
  O: {H: 16, Tg: 1024, warm: 512, lr0: 2e-2, lanes: 2},
};
(async () => {
  const secs = +process.argv[2] || 45, pl = (process.argv[3] || 'drive,fuzz').split(','), cf = (process.argv[4] || 'A,B,C,D,E').split(',');
  const mod = new WebAssembly.Module(await wat(fs.readFileSync(path.join(__dirname, '..', 'wasm', 'lstmtrain.wat'), 'utf8')));
  const tone = C.makeTone(48000);
  for(const p of pl){
    const y = pedals[p](tone.x, 48000), s = C.slices(tone, y, 0);
    let ys = 0; for(const v of s.yT) ys += v*v; ys = Math.sqrt(ys/s.yT.length);
    const yT = Float32Array.from(s.yT, v => v/ys), yV = Float32Array.from(s.yV, v => v/ys), en = C.energies(yT);
    for(const c of cf){
      const o = CFG[c], cores = (o.lanes === 2 ? [1, 2] : [1, 2, 3, 4]).map(seed => C.TrainCore(mod, o.H, {x: s.xT, y: yT, Ep: en.Ep, Er: en.Er}, {warm: o.warm, Tg: o.Tg, seed}));
      const engines = cores.map(k => ({step: async P => k.step(P), val: async P => C.esr(k.predict(P, s.xValCtx, 4096), yV)}));
      // estimate steps for the time budget
      const t0 = Date.now(); for(let i = 0; i < 3; i++) await Promise.all(engines.map(e => e.step(C.initParams(o.H, 3))));
      const per = (Date.now() - t0)/3/1000, steps = secs > 500 ? secs : Math.max(50, Math.floor(secs/per));
      const hist = [];
      const out = await C.train({H: o.H, steps, lr0: o.lr0, lr1: o.lr0/15, clip: o.clip || 1, valEvery: Math.max(25, Math.floor(steps/8)), engines, progress: q => { if(q.esr != null) hist.push(q.esr.toFixed(3)); }});
      console.log(`${p.padEnd(6)} ${c} H${o.H} Tg${o.Tg} lr${o.lr0}  steps ${steps} (${(per*1000).toFixed(0)} ms)  best ${out.esr.toFixed(4)}  [${hist.join(' ')}]`);
    }
  }
})();
