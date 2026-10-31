// Shared test helpers: render any block through the native engine, offline, and measure what came out.
// Usage: const {render, stats, bands, signal, SR, N} = require('./lib'); const y = render('b3k', {drive: 70});
const fs = require('fs'), path = require('path'), vm = require('vm');
const NAT = path.resolve(__dirname, '..'), NPDIR = path.resolve(NAT, '../app');
const addon = require(process.env.NP_ADDON || path.join(NAT, 'build/linux-x64/npaudio.node')), makeNativeAudio = require(path.join(NAT, 'shim.js'));
const wsrc = ['namcore.js', 'worklets.js', 'worklets2.js', 'worklets_drive.js', 'worklets_dyn.js', 'worklets_mod.js', 'worklets_time.js'].map(f => fs.readFileSync(path.join(NPDIR, f), 'utf8')).join('\n');
const esrc = ['engine.js', 'fx2.js', 'amp2.js', 'pedals_drive.js', 'pedals_dyn.js', 'pedals_mod.js', 'pedals_time.js'].map(f => fs.readFileSync(path.join(NPDIR, f), 'utf8')).join('\n');
const SR = 48000, N = SR*2;
// A picked bass line: four notes with lots of harmonics that fade first, then silence. opts: {bright: 0..1 (how slowly the harmonics fade), level}
function signal(opts){ opts = opts || {}; const x = new Float32Array(N); const notes = opts.notes || [[0, 55], [0.4, 82.4], [0.8, 110], [1.1, 41.2]], hf = opts.bright == null ? 0.12 : 0.6 - 0.48*opts.bright, lv = opts.level == null ? 0.35 : opts.level;
  for(const [t0, f] of notes){ const i0 = Math.round(t0*SR); for(let i = i0; i < Math.min(N, i0 + SR*0.9); i++){ const t = (i - i0)/SR; let v = 0; for(let h = 1; h < 48; h++) v += Math.sin(2*Math.PI*f*h*t)/(h*0.9 + 0.1)*Math.exp(-t*h*hf); x[i] += lv*v*Math.exp(-t*3)*Math.min(1, t*400); } }
  return x; }
function sine(f, lv, dur){ const x = new Float32Array(N); for(let i = 0; i < Math.min(N, Math.round((dur || 2)*SR)); i++) x[i] = (lv == null ? 0.3 : lv)*Math.sin(2*Math.PI*f*i/SR); return x; }
function impulse(){ const x = new Float32Array(N); x[100] = 1; return x; }
const HARNESS = `
var NAM_WASM = null, UI = {}, window = (typeof window !== 'undefined') ? window : globalThis;
${esrc}
NP.globals = {geq:[0,0,0,0,0,0], master:0, inGain:0, pad:0, inCh:0, mute:0, mainOut:0, auxOut:1, auxSrc:0, auxLvl:0, mono:0};
globalThis.__api = {NP, BLOCKS, createBlock, applyBlock, setBypass};`;
// Renders `type` with `params` and returns the left channel (Float32Array of N samples). input: a Float32Array, default signal().
// opts.steps: [[timeSec, params]] changes knobs part way through. opts.stereo: true returns [L, R].
function render(type, params, input, opts){ opts = opts || {}; input = input || signal();
  const eng = new addon.Engine({sampleRate: SR, outChannels: 2}); const sh = makeNativeAudio({send: (ops) => eng.cmd(ops)}, {sampleRate: SR, offline: true, outChannels: 2}); sh.collectDescriptors(wsrc); const ctx = new sh.NativeAudioContext();
  const sb = {console, Math: Object.create(Math), Float32Array, Float64Array, Int32Array, Uint8Array, Array, Object, Map, Set, JSON, String, Number, Error, Promise, globalThis: null, AudioWorkletNode: function(c, n, o){ return new sh.classes.NWorklet(c, n, o); }};
  sb.AudioWorkletNode.prototype = sh.classes.NWorklet.prototype; sb.globalThis = sb; vm.createContext(sb); vm.runInContext(HARNESS, sb); const A = sb.__api; A.NP.ctx = ctx; A.NP.bpm = 120;
  const b = A.createBlock(type, params || {}); const src = ctx.createBufferSource(); const buf = ctx.createBuffer(1, N, SR); buf.getChannelData(0).set(input); src.buffer = buf; src.connect(b.input); b.output.connect(ctx.destination); src.start(0);
  sh.flush(); const L = new Float32Array(N), R = new Float32Array(N); const steps = (opts.steps || []).slice();
  for(let off = 0; off < N; off += 4800){ while(steps.length && steps[0][0]*SR <= off){ const [, pp] = steps.shift(); Object.assign(b.p, pp); A.applyBlock(b); sh.flush(); }
    const m = Math.min(4800, N - off); const r = eng.render(m, [], 128); L.set(r[0], off); R.set(r[1], off); const pk = eng.poll(); ctx._receive({frame: off + m, msgs: pk.msgs}); sh.flush(); }
  return opts.stereo ? [L, R] : L; }
// peak, rms and NaN check, skipping the first `skip` seconds (default 0.1, the settle time)
function stats(x, skip){ const s = Math.round((skip == null ? 0.1 : skip)*SR); let pk = 0, e = 0, nan = false; for(let i = s; i < x.length; i++){ const v = x[i]; if(!isFinite(v)) nan = true; pk = Math.max(pk, Math.abs(v)); e += v*v; } return {pk, rms: Math.sqrt(e/(x.length - s)), nan}; }
// energy in dB in five bands, measured over 8192 samples from `at` seconds (default 0.41, the start of the second note)
function bands(x, at){ const n = 8192, off = Math.round((at == null ? 0.41 : at)*SR), re = new Float64Array(n); for(let i = 0; i < n; i++){ re[i] = x[off + i]*(0.5 - 0.5*Math.cos(2*Math.PI*i/n)); }
  const out = {}; const B = {low: [40, 160], lomid: [160, 700], himid: [700, 2500], high: [2500, 8000], fizz: [8000, 20000]};
  for(const [k, [f1, f2]] of Object.entries(B)){ let s = 0; for(let f = f1; f < f2; f += 11.72){ const w = 2*Math.PI*f/SR; let a = 0, b = 0; for(let i = 0; i < n; i++){ a += re[i]*Math.cos(w*i); b -= re[i]*Math.sin(w*i); } s += a*a + b*b; } out[k] = 10*Math.log10(s + 1e-12); } return out; }
// rms over a time window
function rmsAt(x, a, b){ let e = 0; const i0 = Math.round(a*SR), i1 = Math.round(b*SR); for(let i = i0; i < i1; i++) e += x[i]*x[i]; return Math.sqrt(e/(i1 - i0)); }
// level of one frequency in dB (plain DFT over a window), for sine tests
function toneLevel(x, f, at, len){ const n = len || 8192, off = Math.round((at == null ? 0.5 : at)*SR), w = 2*Math.PI*f/SR; let a = 0, b = 0; for(let i = 0; i < n; i++){ const v = x[off + i]*(0.5 - 0.5*Math.cos(2*Math.PI*i/n)); a += v*Math.cos(w*i); b -= v*Math.sin(w*i); } return 20*Math.log10(2*Math.sqrt(a*a + b*b)/n*2 + 1e-12); }
function checker(){ const log = []; const ok = (c, m) => { log.push((c ? 'ok   ' : 'FAIL ') + m); if(!c) process.exitCode = 1; }; return {ok, done(){ console.log(log.join('\n')); }}; }
module.exports = {render, stats, bands, rmsAt, toneLevel, signal, sine, impulse, checker, SR, N};
