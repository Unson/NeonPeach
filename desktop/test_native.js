// The desktop app on the native engine (test mode: no sound card, a quiet 110 Hz tone as the input).
const { _electron: electron } = require('playwright'); const fs = require('fs'), path = require('path'), os = require('os');
const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'nphome-'));
const out = []; const ok = (c, m) => out.push((c ? 'ok   ' : 'FAIL ') + m);
const EXE = process.argv[2] || path.join(__dirname, 'node_modules/electron/dist/electron'), APPDIR = process.argv[3] ? [] : [__dirname];
(async () => {
  const app = await electron.launch({executablePath: EXE, args: ['--no-sandbox', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', ...APPDIR], env: Object.assign({}, process.env, {HOME, XDG_CONFIG_HOME: path.join(HOME, '.config')})});
  const win = await app.firstWindow(); const errs = []; win.on('pageerror', e => errs.push(e.message)); win.on('console', m => { if(m.type() === 'error') errs.push('console: ' + m.text()); });
  await win.waitForLoadState('domcontentloaded');
  await win.evaluate(() => localStorage.setItem('neonpeach.v1.native', JSON.stringify({enabled: true, api: 'null', fakeInput: true, buffer: 64, rate: 48000})));
  await win.reload(); await win.waitForLoadState('domcontentloaded');
  await win.click('#power'); await win.waitForSelector('#pedal', {state: 'visible', timeout: 20000}); await win.waitForTimeout(1500);
  let r = await win.evaluate(() => ({native: !!UI.native, isNative: !!NP.ctx.isNative, sr: NP.ctx.sampleRate, input: UI.inputOk, inM: NP.meters.in, outM: NP.meters.out, dev: NAT.r && NAT.r.device, buf: NAT.r && NAT.r.buffer}));
  ok(r.native && r.isNative, 'the app runs on the native engine (' + r.dev + ', ' + r.buf + ' samples, ' + r.sr + ' Hz)');
  ok(r.input && r.inM > 0.02 && r.outM > 0.005, 'input reaches the output through the chain (in ' + r.inM.toFixed(3) + ', out ' + r.outM.toFixed(3) + ')');
  // every block type builds, plays and goes away
  r = await win.evaluate(async () => { const bad = []; for(const t of Object.keys(BLOCKS)){ try{ const b = createBlock(t); NP.paths.A.push(b); rewire(); NP.selected = b.id; renderPage(); for(const k in BLOCKS[t].params){ const s = BLOCKS[t].params[k]; if(s.hidden) continue; setParam(b, k, s.max); setParam(b, k, s.def); } setBypass(b, true); setBypass(b, false); await new Promise(r => setTimeout(r, 40)); keepRefs(() => NP.paths.A.pop()); destroyBlock(b); rewire(); }catch(e){ bad.push(t + ': ' + e.message); } } NP.selected = null; return bad; });
  ok(r.length === 0, 'all ' + await win.evaluate(() => Object.keys(BLOCKS).length) + ' block types work on the native engine' + (r.length ? ': ' + r.join(' | ') : ''));
  // presets and sound
  r = await win.evaluate(async () => { const lv = []; for(const i of [0, 1, 2, 7, 16, 17, 21, 25]){ if(!UI.banks[i]) continue; gotoPreset(i); await new Promise(r => setTimeout(r, 450)); lv.push(UI.banks[i].name + ' ' + NP.meters.out.toFixed(3)); } return lv; });
  ok(r.every(x => +x.split(' ').pop() > 0.001), 'presets play: ' + r.join(', '));
  // the delay readout and the low-delay panel
  await win.evaluate(() => go('io')); await win.waitForTimeout(300);
  r = await win.evaluate(() => ({panel: !!document.querySelector('.natpane'), chip: document.querySelector('.latchip b').textContent, L: latencyInfo()}));
  ok(r.panel, 'Settings > Audio shows the low-delay engine panel'); ok(r.L.chain < 3, 'chain adds ' + r.L.chain.toFixed(2) + ' ms; clock shows ' + r.chip + ' ms');
  await win.screenshot({path: path.join(__dirname, 'shot-native-io.png')});
  // beats, stage, recording, nodes stay under control
  r = await win.evaluate(async () => { const n0 = NAT.lastNodes; setBpm(160); UI.dr.countIn = false; toggleDrums(); await new Promise(r => setTimeout(r, 3000)); const o = NP.meters.out; toggleDrums(); return {o, marks: UI.dr.marks.length}; });
  ok(r.o > 0.01 && r.marks > 20, 'beats play natively (out ' + r.o.toFixed(3) + ')');
  const nodes = await new Promise(res => { win.evaluate(() => new Promise(r => { const f = (pk) => { if(pk.nodes != null){ r(pk.nodes); } }; npNative.onPacket(f); })).then(res); });
  await win.waitForTimeout(2500);
  const nodes2 = await win.evaluate(() => new Promise(r => npNative.onPacket(pk => r(pk.nodes))));
  ok(nodes2 < 800, 'old drum hits get freed (' + nodes + ' then ' + nodes2 + ' nodes)');
  r = await win.evaluate(async () => { let got = null; const saveOld = window.download; window.download = (blob, name) => { got = name + ' ' + blob.size; }; toggleRecord(); await new Promise(r => setTimeout(r, 1200)); toggleRecord(); await new Promise(r => setTimeout(r, 800)); window.download = saveOld; return got; });
  ok(r && +r.split(' ')[1] > 100000, 'recording the output works natively (' + r + ')');
  r = await win.evaluate(async () => { const ms = await pingTest(); return [ms, UI.pingMsg]; }); ok(r[0] == null, 'ping with no cable gives a plain message');
  r = await win.evaluate(() => { openStage(); const s = UI.stage; closeStage(); return s; }); ok(r, 'stage mode opens');
  // a .nam clone plays through the native neural engine
  const nam = fs.readFileSync('/home/claude/ref/NeuralAmpModelerCore/example_models/wavenet.nam', 'utf8');
  r = await win.evaluate(async (txt) => { const rec = await addNamClone('Native Test', txt); loadPreset(blankPreset()); const b = createBlock('clone'); NP.paths.A.push(b); rewire(); const i = NP.clones.findIndex(c => c.id === rec.id); setParam(b, 'clone', i + 1); await new Promise(r => setTimeout(r, 1500)); return {state: b.n.state, out: NP.meters.out}; }, nam);
  ok(r.state === 'ready' && r.out > 0.001, 'a .nam model plays on the native engine (' + r.state + ', out ' + r.out.toFixed(3) + ')');
  ok(errs.length === 0, 'no page errors' + (errs.length ? ': ' + errs.slice(0, 5).join(' | ') : ''));
  await win.screenshot({path: path.join(__dirname, 'shot-native.png')});
  await app.evaluate(({app}) => app.exit(0));
  console.log(out.join('\n')); console.log(out.some(l => l.startsWith('FAIL')) ? 'SOME FAILED' : 'all passed');
})().catch(e => { console.error(e); process.exit(1); });
