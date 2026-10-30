// How hard the native engine works: renders each factory preset at a 64-sample buffer and reports the share of real time used.
const fs = require('fs'), path = require('path'), vm = require('vm');
const NPDIR = '/home/claude/neonpeach'; const addon = require('../build/linux-x64/npaudio.node'), mk = require('../shim.js');
const wsrc = ['namcore.js', 'worklets.js', 'worklets2.js'].map(f => fs.readFileSync(path.join(NPDIR, f), 'utf8')).join('\n');
const src = fs.readFileSync(path.join(NPDIR, 'engine.js'), 'utf8') + '\n' + fs.readFileSync(path.join(NPDIR, 'fx2.js'), 'utf8');
const SR = 48000, SEC = 6, Q = +(process.argv[2] || 64);
function setup(){ const eng = new addon.Engine({sampleRate: SR, outChannels: 2}); const sh = mk({send: o => eng.cmd(o)}, {sampleRate: SR, offline: true}); sh.collectDescriptors(wsrc); const ctx = new sh.NativeAudioContext();
  const sb = {console, Math, Float32Array, Float64Array, Int32Array, Uint8Array, Array, Object, Map, Set, JSON, String, Number, Error, Promise, NAM_WASM: null, UI: {}, AudioWorkletNode: function(c, n, o){ return new sh.classes.NWorklet(c, n, o); }};
  sb.AudioWorkletNode.prototype = sh.classes.NWorklet.prototype; sb.globalThis = sb; sb.window = sb; vm.createContext(sb);
  vm.runInContext(src + `\nNP.globals={geq:[0,0,0,0,0,0],master:0,inGain:0,pad:0,inCh:0,mute:0,mainOut:0,auxOut:1,auxSrc:0,auxLvl:0,mono:0}; this.__api={NP,buildRig,loadPreset,factoryPresets,applyGlobals};`, sb);
  const A = sb.__api; A.NP.ctx = ctx; A.buildRig(); return {eng, sh, ctx, A}; }
// the v2 presets come from the UI file; build them by evaluating the Wizard part there
const lines = [];
const base = setup(); const presets = base.A.factoryPresets();
for(const p of presets){
  const {eng, sh, A} = setup(); A.loadPreset(p); A.applyGlobals(); sh.flush();
  const inp = new Float32Array(SR); for(let i = 0; i < SR; i++) inp[i] = 0.3*Math.sin(2*Math.PI*55*i/SR)*Math.exp(-(i % 24000)/12000);
  eng.render(SR/2, [inp, inp], Q);   // warm up
  const t0 = process.hrtime.bigint(); for(let s = 0; s < SEC; s++) eng.render(SR, [inp, inp], Q); const ms = Number(process.hrtime.bigint() - t0)/1e6;
  lines.push([p.name, ms/(SEC*1000)*100]);
}
lines.sort((a, b) => b[1] - a[1]); for(const [n, pct] of lines) console.log(pct.toFixed(1).padStart(5) + '% of real time  ' + n);
