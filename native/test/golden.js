// Renders each block in Chrome (OfflineAudioContext) and in the native engine with the same input, and compares them.
const { chromium } = require('playwright'); const fs = require('fs'), path = require('path'), vm = require('vm');
const NPDIR = '/home/claude/neonpeach', NAT = path.resolve(__dirname, '..');
const addon = require(path.join(NAT, 'build/linux-x64/npaudio.node')), makeNativeAudio = require(path.join(NAT, 'shim.js'));
const wsrc = ['namcore.js', 'worklets.js', 'worklets2.js'].map(f => fs.readFileSync(path.join(NPDIR, f), 'utf8')).join('\n');
const esrc = fs.readFileSync(path.join(NPDIR, 'engine.js'), 'utf8') + '\n' + fs.readFileSync(path.join(NPDIR, 'fx2.js'), 'utf8');
const SR = 48000, N = SR*2;
const only = process.argv[2] ? process.argv[2].split(',') : null;
// test input: plucked bass notes with harmonics, then a quiet tail
function signal(){ const x = new Float32Array(N); const notes = [[0, 55], [0.4, 82.4], [0.8, 110], [1.1, 41.2]]; let s = 7;
  for(const [t0, f] of notes){ const i0 = Math.round(t0*SR); for(let i = i0; i < Math.min(N, i0 + SR*0.9); i++){ const t = (i - i0)/SR; let v = 0; for(let h = 1; h < 12; h++) v += Math.sin(2*Math.PI*f*h*t)/(h*h*0.7 + 0.3); x[i] += 0.35*v*Math.exp(-t*3)*Math.min(1, t*400); } }
  for(let i = 0; i < 2000; i++){ s = (s*16807) % 2147483647; x[Math.round(1.5*SR) + i] += 0.2*(s/2147483647 - 0.5); } return x; }
const SEEDED = `(function(){ let s = 12345; Math.random = function(){ s = (s*16807) % 2147483647; return (s - 1)/2147483646; }; })();`;
const HARNESS = `
var NAM_WASM = null, UI = {}, window = (typeof window !== 'undefined') ? window : globalThis;
${esrc}
NP.globals = {geq:[0,0,0,0,0,0], master:0, inGain:0, pad:0, inCh:0, mute:0, mainOut:0, auxOut:1, auxSrc:0, auxLvl:0, mono:0};
function __build(type, params){ ${SEEDED} const b = createBlock(type, params||{}); return b; }
globalThis.__api = {NP, BLOCKS, createBlock, __build};`;
const SKIP = new Set(['clone', 'capture', 'fxloop', 'auxsend']);

(async () => {

  // native side
  const ctxOf = () => { const eng = new addon.Engine({sampleRate: SR, outChannels: 2}); const sh = makeNativeAudio({send: (ops) => eng.cmd(ops)}, {sampleRate: SR, offline: true, outChannels: 2}); sh.collectDescriptors(wsrc); return {eng, sh, ctx: new sh.NativeAudioContext()}; };
  function runNative(type){
    const {eng, sh, ctx} = ctxOf(); const sb = {console, Math: Object.create(Math), Float32Array, Float64Array, Int32Array, Uint8Array, Array, Object, Map, Set, JSON, String, Number, Error, Promise, globalThis: null, AudioWorkletNode: function(c, n, o){ return new sh.classes.NWorklet(c, n, o); }};
    sb.AudioWorkletNode.prototype = sh.classes.NWorklet.prototype; sb.globalThis = sb; vm.createContext(sb);
    vm.runInContext(HARNESS, sb); const A = sb.__api; A.NP.ctx = ctx; A.NP.bpm = 120;
    const b = A.__build(type); const src = ctx.createBufferSource(); const buf = ctx.createBuffer(1, N, SR); buf.getChannelData(0).set(signal()); src.buffer = buf; src.connect(b.input); b.output.connect(ctx.destination); src.start(0);
    sh.flush(); const out = []; const L = new Float32Array(N), R = new Float32Array(N);
    for(let off = 0; off < N; off += 4800){ const m = Math.min(4800, N - off); const r = eng.render(m, [], 128); L.set(r[0], off); R.set(r[1], off); const pk = eng.poll(); ctx._receive({frame: off + m, msgs: pk.msgs}); sh.flush(); }
    return [L, R]; }
  // Chrome side
  const browser = await chromium.launch(); const page = await browser.newPage(); await page.goto('file://' + path.join(__dirname, 'blank.html'));
  await page.evaluate(({wsrc, HARNESS}) => { window.__wurl = 'data:application/javascript;base64,' + btoa(unescape(encodeURIComponent(wsrc))); (0, eval)(HARNESS); }, {wsrc, HARNESS});
  const all = await page.evaluate(() => Object.keys(__api.BLOCKS));
  const list = all.filter(t => !SKIP.has(t) && (!only || only.includes(t)));
  const sig = Array.from(signal());
  const rows = [];
  for(const type of list){
    const ref = await page.evaluate(async ({type, sig, N, SR}) => { const c = new OfflineAudioContext(2, N, SR); await c.audioWorklet.addModule(window.__wurl); __api.NP.ctx = c; __api.NP.bpm = 120;
      const b = __api.__build(type); const s = c.createBufferSource(); const buf = c.createBuffer(1, N, SR); buf.getChannelData(0).set(sig); s.buffer = buf; s.connect(b.input); b.output.connect(c.destination); s.start(0);
      const r = await c.startRendering(); return [Array.from(r.getChannelData(0)), Array.from(r.getChannelData(1))]; }, {type, sig, N, SR});
    const nat = process.env.SELF ? await page.evaluate(async ({type, sig, N, SR}) => { const c = new OfflineAudioContext(2, N, SR); await c.audioWorklet.addModule(window.__wurl); __api.NP.ctx = c; __api.NP.bpm = 120;
      const b = __api.__build(type); const s = c.createBufferSource(); const buf = c.createBuffer(1, N, SR); buf.getChannelData(0).set(sig); s.buffer = buf; s.connect(b.input); b.output.connect(c.destination); s.start(0);
      const r = await c.startRendering(); return [Array.from(r.getChannelData(0)), Array.from(r.getChannelData(1))]; }, {type, sig, N, SR}) : runNative(type);
    let e = 0, p = 0, mx = 0; for(let c = 0; c < 2; c++) for(let i = 0; i < N; i++){ const d = ref[c][i] - nat[c][i]; e += d*d; p += ref[c][i]*ref[c][i]; mx = Math.max(mx, Math.abs(d)); }
    const snr = p > 0 ? 10*Math.log10(p/(e + 1e-30)) : (e < 1e-12 ? Infinity : -Infinity);
    rows.push([type, snr, mx, Math.sqrt(p/(2*N))]);
    console.log(type.padEnd(10), (isFinite(snr) ? snr.toFixed(1) : String(snr)).padStart(7) + ' dB', ' max diff ' + mx.toExponential(2), ' level ' + Math.sqrt(p/(2*N)).toFixed(3));
  }
  fs.writeFileSync(path.join(__dirname, 'golden-results.json'), JSON.stringify(rows));
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
