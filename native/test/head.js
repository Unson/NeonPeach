// Renders the Neon 900 head through the native engine with different settings and checks the sound makes sense.
// No browser needed. Run: node native/test/head.js
const fs = require('fs'), path = require('path'), vm = require('vm');
const NAT = path.resolve(__dirname, '..'), NPDIR = path.resolve(NAT, '../app');
const addon = require(process.env.NP_ADDON || path.join(NAT, 'build/linux-x64/npaudio.node')), makeNativeAudio = require(path.join(NAT, 'shim.js'));
const wsrc = ['namcore.js', 'worklets.js', 'worklets2.js', 'worklets_drive.js', 'worklets_dyn.js', 'worklets_mod.js', 'worklets_time.js'].map(f => fs.readFileSync(path.join(NPDIR, f), 'utf8')).join('\n');
const esrc = ['engine.js', 'fx2.js', 'amp2.js', 'pedals_drive.js', 'pedals_dyn.js', 'pedals_mod.js', 'pedals_time.js'].map(f => fs.readFileSync(path.join(NPDIR, f), 'utf8')).join('\n');
const SR = 48000, N = SR*2;
function signal(){ const x = new Float32Array(N); const notes = [[0, 55], [0.4, 82.4], [0.8, 110], [1.1, 41.2]];
  for(const [t0, f] of notes){ const i0 = Math.round(t0*SR); for(let i = i0; i < Math.min(N, i0 + SR*0.9); i++){ const t = (i - i0)/SR; let v = 0; for(let h = 1; h < 48; h++) v += Math.sin(2*Math.PI*f*h*t)/(h*0.9 + 0.1)*Math.exp(-t*h*0.12); x[i] += 0.35*v*Math.exp(-t*3)*Math.min(1, t*400); } }
  return x; }
const HARNESS = `
var NAM_WASM = null, UI = {}, window = (typeof window !== 'undefined') ? window : globalThis;
${esrc}
NP.globals = {geq:[0,0,0,0,0,0], master:0, inGain:0, pad:0, inCh:0, mute:0, mainOut:0, auxOut:1, auxSrc:0, auxLvl:0, mono:0};
globalThis.__api = {NP, BLOCKS, createBlock};`;
function render(type, params){
  const eng = new addon.Engine({sampleRate: SR, outChannels: 2}); const sh = makeNativeAudio({send: (ops) => eng.cmd(ops)}, {sampleRate: SR, offline: true, outChannels: 2}); sh.collectDescriptors(wsrc); const ctx = new sh.NativeAudioContext();
  const sb = {console, Math: Object.create(Math), Float32Array, Float64Array, Int32Array, Uint8Array, Array, Object, Map, Set, JSON, String, Number, Error, Promise, globalThis: null, AudioWorkletNode: function(c, n, o){ return new sh.classes.NWorklet(c, n, o); }};
  sb.AudioWorkletNode.prototype = sh.classes.NWorklet.prototype; sb.globalThis = sb; vm.createContext(sb); vm.runInContext(HARNESS, sb); const A = sb.__api; A.NP.ctx = ctx; A.NP.bpm = 120;
  const b = A.createBlock(type, params || {}); const src = ctx.createBufferSource(); const buf = ctx.createBuffer(1, N, SR); buf.getChannelData(0).set(signal()); src.buffer = buf; src.connect(b.input); b.output.connect(ctx.destination); src.start(0);
  sh.flush(); const L = new Float32Array(N);
  for(let off = 0; off < N; off += 4800){ const m = Math.min(4800, N - off); const r = eng.render(m, [], 128); L.set(r[0], off); const pk = eng.poll(); ctx._receive({frame: off + m, msgs: pk.msgs}); sh.flush(); }
  return L; }
function stats(x){ let pk = 0, e = 0, nan = false; for(const v of x.subarray(Math.round(0.1*SR))){ if(!isFinite(v)) nan = true; pk = Math.max(pk, Math.abs(v)); e += v*v; } return {pk, rms: Math.sqrt(e/(x.length - 0.1*SR)), nan}; }
// energy in dB in a few bands, from a plain DFT on a window in the middle of the second note
function bands(x){ const n = 8192, off = Math.round(0.41*SR), re = new Float64Array(n), im = new Float64Array(n); for(let i = 0; i < n; i++){ re[i] = x[off + i]*(0.5 - 0.5*Math.cos(2*Math.PI*i/n)); }
  const out = {}; const B = {low: [40, 160], lomid: [160, 700], himid: [700, 2500], high: [2500, 8000], fizz: [8000, 20000]};
  for(const [k, [f1, f2]] of Object.entries(B)){ let s = 0; for(let f = f1; f < f2; f += 11.72){ const w = 2*Math.PI*f/SR; let a = 0, b = 0; for(let i = 0; i < n; i += 1){ a += re[i]*Math.cos(w*i); b -= re[i]*Math.sin(w*i); } s += a*a + b*b; } out[k] = 10*Math.log10(s + 1e-12); } return out; }
const log = []; const ok = (c, m) => { log.push((c ? 'ok   ' : 'FAIL ') + m); if(!c) process.exitCode = 1; };
const baseY = render('head', {}), base = stats(baseY); let pk0 = 0; for(let i = 0; i < 0.1*SR; i++) pk0 = Math.max(pk0, Math.abs(baseY[i]));
ok(pk0 < 1.2, 'no loud first moment (peak in the first 100 ms ' + pk0.toFixed(3) + ')');
ok(!base.nan, 'no NaN');
ok(base.pk > 0.05 && base.pk < 1.2, 'default level is sane (peak ' + base.pk.toFixed(3) + ', rms ' + base.rms.toFixed(3) + ')');
const dry = stats(signal());
console.log('input peak', dry.pk.toFixed(3), 'rms', dry.rms.toFixed(3));
const clean = stats(render('head', {blend: 0, cab: 0})), dirty = stats(render('head', {blend: 100, drive: 90, cab: 0}));
ok(dirty.rms/dirty.pk > clean.rms/clean.pk, 'full drive is denser than clean (crest ' + (dirty.pk/dirty.rms).toFixed(2) + ' vs ' + (clean.pk/clean.rms).toFixed(2) + ')');
const bB3K = bands(render('head', {blend: 100, drive: 70, mod: 0, circuit: 0, cab: 0})), bVint = bands(render('head', {blend: 100, drive: 70, mod: 100, circuit: 0, cab: 0}));
const bAlpha = bands(render('head', {blend: 100, drive: 70, mod: 0, circuit: 1, cab: 0})), bOmega = bands(render('head', {blend: 100, drive: 70, mod: 100, circuit: 1, cab: 0}));
const diff = (a, b) => Math.max(...Object.keys(a).map(k => Math.abs(a[k] - b[k])));
ok(diff(bB3K, bVint) > 1.5, 'B3K and Vintage sound different (' + diff(bB3K, bVint).toFixed(1) + ' dB apart somewhere)');
ok(diff(bAlpha, bOmega) > 1.5, 'Alpha and Omega sound different (' + diff(bAlpha, bOmega).toFixed(1) + ' dB apart somewhere)');
ok(bVint.high - bVint.lomid < bB3K.high - bB3K.lomid, 'Vintage is darker than B3K');
const thin = bands(render('head', {blend: 100, drive: 60, grunt: 0, cab: 0})), fat = bands(render('head', {blend: 100, drive: 60, grunt: 2, cab: 0}));
ok(fat.low - fat.himid > thin.low - thin.himid + 1, 'Grunt Fat keeps more low end in the drive than Thin');
const att0 = bands(render('head', {blend: 100, drive: 20, attack: 0, cab: 0})), att2 = bands(render('head', {blend: 100, drive: 20, attack: 2, cab: 0}));
ok(att2.high - att2.low > att0.high - att0.low + 1, 'Attack Boost is brighter than Cut');
const bite = bands(render('head', {blend: 100, drive: 20, bite: 100, circuit: 1, cab: 0})), nobite = bands(render('head', {blend: 100, drive: 20, bite: 0, circuit: 1, cab: 0}));
ok(bite.high - bite.low > nobite.high - nobite.low + 1, 'Bite adds top');
const growl = bands(render('head', {blend: 100, drive: 20, growl: 100, circuit: 1, cab: 0})), nogrowl = bands(render('head', {blend: 100, drive: 20, growl: 0, circuit: 1, cab: 0}));
ok(growl.lomid - growl.low > nogrowl.lomid - nogrowl.low + 0.7, 'Growl adds low mids');
const eqUp = bands(render('head', {bass: 10, treble: -10, cab: 0})), eqDn = bands(render('head', {bass: -10, treble: 10, cab: 0}));
ok(eqUp.low - eqUp.high > eqDn.low - eqDn.high + 10, 'Bass and Treble move the sound');
const lm = bands(render('head', {lomid: 10, lomidf: 0, cab: 0})), lmN = bands(render('head', {lomid: -10, lomidf: 0, cab: 0}));
ok(lm.lomid - lmN.lomid > 8, 'Lo Mids knob works at 250 Hz');
const cabOn = bands(render('head', {cab: 1})), cabOff = bands(render('head', {cab: 0}));
ok(cabOn.fizz - cabOn.lomid < cabOff.fizz - cabOff.lomid - 6, 'the 8x10 cab takes the fizz off');
const quiet = stats(render('head', {input: -12, blend: 0, cab: 0})); ok(quiet.rms < clean.rms*0.5, 'Gain knob changes the level');
// ---- Melted Raspberry ----
const rY = render('raspberry', {}), r = stats(rY); let rpk0 = 0; for(let i = 0; i < 0.1*SR; i++) rpk0 = Math.max(rpk0, Math.abs(rY[i]));
ok(!r.nan, 'raspberry: no NaN'); ok(rpk0 < 1.2, 'raspberry: no loud first moment (' + rpk0.toFixed(3) + ')'); ok(r.pk > 0.05 && r.pk < 1.2, 'raspberry: default level is sane (peak ' + r.pk.toFixed(3) + ', rms ' + r.rms.toFixed(3) + ')');
const rc = bands(render('raspberry', {blend: 0, cab: 0})), rd = bands(render('raspberry', {blend: 100, drive: 100, cab: 0}));
ok(Math.abs(rc.low - rd.low) < 3 && rd.high - rc.high > 6, 'raspberry: lows stay clean while the highs get the drive (low ' + (rd.low - rc.low).toFixed(1) + ' dB, high +' + (rd.high - rc.high).toFixed(1) + ' dB)');
const rM = bands(render('raspberry', {blend: 100, drive: 70, mod: 0, circuit: 2, cab: 0})), rJ = bands(render('raspberry', {blend: 100, drive: 70, mod: 100, circuit: 2, cab: 0}));
ok(diff(rM, rJ) > 1.5, 'raspberry: Melt and Jam sound different (' + diff(rM, rJ).toFixed(1) + ' dB apart somewhere)');
const w0 = stats(render('raspberry', {blend: 100, drive: 0, warmth: 0, cab: 0})), w1 = stats(render('raspberry', {blend: 100, drive: 0, warmth: 100, cab: 0}));
ok(w1.rms/w1.pk > w0.rms/w0.pk + 0.01, 'raspberry: Warmth squashes the highs (crest ' + (w1.pk/w1.rms).toFixed(2) + ' vs ' + (w0.pk/w0.rms).toFixed(2) + ')');
const sq0 = stats(render('raspberry', {blend: 0, xo: 500, squeeze: 0, cab: 0})), sq1 = stats(render('raspberry', {blend: 0, xo: 500, squeeze: 100, cab: 0}));
ok(sq1.rms < sq0.rms*0.7, 'raspberry: Low Squeeze grips the lows (' + (20*Math.log10(sq1.rms/sq0.rms)).toFixed(1) + ' dB at full squeeze, same compressor as Split Grind)');
const e1 = bands(render('raspberry', {b0: 10, b5: -10, cab: 0})), e2 = bands(render('raspberry', {b0: -10, b5: 10, cab: 0}));
ok(e1.low - e1.high > e2.low - e2.high + 10, 'raspberry: 6-band EQ moves the sound');
const pr1 = bands(render('raspberry', {blend: 100, presence: 10, cab: 0})), pr0 = bands(render('raspberry', {blend: 100, presence: -10, cab: 0}));
ok(pr1.high - pr1.low > pr0.high - pr0.low + 4, 'raspberry: Presence works');
const ra1 = bands(render('raspberry', {air: 10, cab: 0})), ra0 = bands(render('raspberry', {air: -10, cab: 0}));
ok(ra1.fizz - ra1.low > ra0.fizz - ra0.low + 4, 'raspberry: Air works');
const rcab = bands(render('raspberry', {cab: 1})), rno = bands(render('raspberry', {cab: 0}));
ok(rcab.fizz - rcab.lomid < rno.fizz - rno.lomid - 6, 'raspberry: the cab takes the fizz off');
console.log(log.join('\n'));
console.log('levels: default peak', base.pk.toFixed(3), '| clean rms', clean.rms.toFixed(3), '| dirty rms', dirty.rms.toFixed(3));
console.log('b3k', JSON.stringify(bB3K, (k, v) => typeof v === 'number' ? +v.toFixed(1) : v)); console.log('vint', JSON.stringify(bVint, (k, v) => typeof v === 'number' ? +v.toFixed(1) : v));
console.log('alpha', JSON.stringify(bAlpha, (k, v) => typeof v === 'number' ? +v.toFixed(1) : v)); console.log('omega', JSON.stringify(bOmega, (k, v) => typeof v === 'number' ? +v.toFixed(1) : v));
