// Browser tests for Clone: kernels, loading .nam files into the block, playing them, training in workers, storage.
// Usage: node test_clone_browser.js <model.nam> ...
const { chromium } = require('playwright'); const path = require('path'); const fs = require('fs');
const SHOTS = path.resolve(__dirname, 'shots'); fs.mkdirSync(SHOTS, {recursive: true});
const models = process.argv.slice(2).map(f => ({name: path.basename(f).replace(/\.nam$/, ''), txt: fs.readFileSync(f, 'utf8')}));
(async () => {
  const browser = await chromium.launch({args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required']});
  const ctx = await browser.newContext({permissions: ['microphone'], viewport: {width: 1440, height: 900}, deviceScaleFactor: 1});
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', e => errs.push('PAGEERROR ' + e.message)); page.on('console', m => { if(m.type() === 'error') errs.push('CONSOLE ' + m.text()); });
  const out = []; const ok = (c, m) => { out.push((c ? 'ok   ' : 'FAIL ') + m); };
  async function power(){ await page.goto('file://' + path.resolve(__dirname, 'dist/neon-peach.html')); await page.click('#power'); await page.waitForSelector('#pedal', {state: 'visible', timeout: 15000}); await page.waitForTimeout(800); }
  await power();
  let r = await page.evaluate(async () => { const k = await kernels(); return {simd: simdOK(), nam: !!k.nam, train: !!k.train, sr: NP.ctx.sampleRate, input: UI.inputOk, clones: NP.clones.length, db: !!CDB.db}; });
  ok(r.simd && r.nam && r.train, 'wasm kernels compile on the page (simd ' + r.simd + ')'); ok(r.db, 'IndexedDB opens'); out.push('     context ' + r.sr + ' Hz, input ' + r.input);
  // 1. load .nam files, put each in a clone block, wait for the worklet to warm it up, listen to it
  for(const m of models){
    r = await page.evaluate(async ({name, txt}) => {
      try{ const rec = await addNamClone(name, txt); useClone(rec.id); const b = NP.blocks[NP.selected]; const t0 = performance.now();
        while(b.n.state !== 'ready' && b.n.state !== 'error' && performance.now() - t0 < 8000) await new Promise(r => setTimeout(r, 50));
        const warm = performance.now() - t0;
        if(!UI.demoOn) toggleDemo(); await new Promise(r => setTimeout(r, 1500)); const peak = NP.meters.out; toggleDemo();
        const res = {state: b.n.state, err: b.n.err, warm: Math.round(warm), peak, cid: b.p.cid === rec.id, idx: b.p.clone, note: rec.note};
        keepRefs(() => { NP.paths.A.splice(NP.paths.A.indexOf(b), 1); }); destroyBlock(b); NP.selected = null; rewire();
        return res; }catch(e){ return {state: 'throw', err: e.message}; } }, m);
    ok(r.state === 'ready' && r.cid && r.idx > 0, `${m.name}: plays in the Clone block (${r.note}, ready in ${r.warm} ms${r.err ? ', ' + r.err : ''})`);
    ok(r.peak > 0.01, `${m.name}: makes sound with the demo riff (peak ${r.peak && r.peak.toFixed(3)})`);
  }
  // 2. a bad file is refused with a plain message
  r = await page.evaluate(async () => { try{ await addNamClone('bad', '{"version":"0.5.4","architecture":"WaveNet","config":{},"weights":[]}'); return 'accepted'; }catch(e){ return e.message; } });
  ok(r !== 'accepted' && /model/i.test(r), 'broken model is refused: ' + r);
  // 3. train from a fake pedal, in workers, through the real page code
  await page.evaluate(() => { NP.selected = null; renderEncoders(); go('clone'); });
  await page.waitForTimeout(350); await page.screenshot({path: SHOTS + '/60-clone-pedal.png'});
  await page.evaluate(() => {
    QUALITY[0].secs = 12; UI.cl.quality = 0;
    const tone = Cloner.makeTone(48000), x = tone.x, y = new Float32Array(x.length + 480); let s1 = 0, s2 = 0;
    for(let i = 0; i < x.length; i++){ s1 += 0.2*(x[i] - s1); const v = 0.45*Math.tanh(5*s1); s2 += 0.5*(v - s2); y[i + 480] = s2; }
    const job = {stage: 'think', pct: 0, msg: '', from: 'plugin', name: 'Fake Drive'}; setJob(job);
    window.__t0 = performance.now(); finishJob(job, tone, y, {inTrim: 0});
  });
  await page.waitForFunction(() => UI.cl.job && UI.cl.job.stage === 'train' && UI.cl.job.pct > 35, null, {timeout: 60000});
  await page.waitForTimeout(250); await page.screenshot({path: SHOTS + '/62a-clone-training.png'});
  await page.waitForFunction(() => UI.cl.job && (UI.cl.job.stage === 'done' || UI.cl.job.stage === 'error'), null, {timeout: 120000});
  r = await page.evaluate(() => { const j = UI.cl.job; return {stage: j.stage, msg: j.msg, esr: j.esr, secs: (performance.now() - window.__t0)/1000, ab: !!(j.ab && j.ab.copy && j.ab.copy.length)}; });
  await page.waitForTimeout(300);
  ok(r.stage === 'done', `training finished in ${r.secs && r.secs.toFixed(1)} s: ${r.msg}`);
  ok(r.esr < 0.2, `trained clone is ${(100*(1 - r.esr)).toFixed(1)}% close after 12 s`);
  ok(r.ab, 'A/B audio is ready');
  await page.screenshot({path: SHOTS + '/62-clone-done.png'});
  r = await page.evaluate(async () => { const id = UI.cl.job.id, c = NP.clones.find(x => x.id === id); const d = NAMCore.parse(c.nam); useClone(id); const b = NP.blocks[NP.selected]; const t0 = performance.now();
    while(b.n.state !== 'ready' && performance.now() - t0 < 5000) await new Promise(r => setTimeout(r, 50)); renderPage(); await new Promise(r => setTimeout(r, 300)); return {arch: d.arch, n: d.w.length, state: b.n.state, workers: (navigator.hardwareConcurrency || 2)}; });
  ok(r.arch === 'WaveNet' && r.n === 3026 && r.state === 'ready', `trained clone is a NAM feather WaveNet (${r.n} weights) and plays in the block (cores ${r.workers})`);
  await page.screenshot({path: SHOTS + '/63-chain-clone.png'});
  // 4. an IR-like (linear) sound is saved as an IR
  r = await page.evaluate(async () => { const tone = Cloner.makeTone(48000), x = tone.x, y = new Float32Array(x.length + 100); let s = 0; for(let i = 0; i < x.length; i++){ s += 0.05*(x[i] - s); y[i + 100] = 0.7*s + 0.3*x[i]; }
    const job = {stage: 'think', pct: 0, msg: '', from: 'plugin', name: 'Fake EQ'}; setJob(job); await finishJob(job, tone, y, {inTrim: 0}); const j = UI.cl.job; const c = NP.clones.find(x => x.id === j.id); return {stage: j.stage, kind: c && c.kind, esr: j.esr}; });
  ok(r.stage === 'done' && r.kind === 'ir', `a pure filter becomes an IR clone (error ${r.esr && r.esr.toExponential(1)})`);
  // 4b. the live path, with a fake pedal in place of the interface: send level and interface trim are used
  r = await page.evaluate(async () => {
    const keep = window.playRecord;
    window.playRecord = async (signal, extra, onTick) => { if(onTick){ onTick(30, 66); onTick(0, 66); }
      const y = new Float32Array(signal.length + 48000); let s = 0; for(let i = 0; i < signal.length; i++){ s += 0.3*(signal[i] - s); y[i + 2400] = 0.5*Math.tanh(3*s); } return y; };
    UI.cl.sendDb = -6; UI.cl.rtDb = -3; QUALITY[0].secs = 8; UI.cl.quality = 0; setJob(null); UI.cl.mode = 'pedal'; go('clone');
    const nameEl = document.getElementById('clname'); if(nameEl) nameEl.value = 'Live Fake';
    const t0 = performance.now(); const iv = setInterval(() => { const j = UI.cl.job; if(j && j.stop && j.stage === 'train' && j.pct > 55){ j.stop(); clearInterval(iv); } }, 50);
    await startLive();
    window.playRecord = keep; clearInterval(iv);
    const j = UI.cl.job, c = j && NP.clones.find(x => x.id === j.id);
    return {stage: j && j.stage, msg: j && j.msg, esr: j && j.esr, name: c && c.name, trim: c && c.inTrim, secs: (performance.now() - t0)/1000}; });
  ok(r.stage === 'done' && r.name === 'Live Fake' && r.trim === 3, `live path works with a stand-in pedal (${r.secs && r.secs.toFixed(1)} s, trim ${r.trim} dB, ${r.msg})`);
  ok(r.esr < 0.9 && /stopped early/.test(r.msg), `stopping early keeps the best model so far (${(100*(1 - r.esr)).toFixed(1)}% close)`);
  // 4b2. no workers: training runs on the page, LSTM kind
  r = await page.evaluate(async () => { UI.cl.noWorkers = true; UI.cl.engine = 'lstm'; QUALITY[0].secs = 5; UI.cl.quality = 0;
    const tone = Cloner.makeTone(48000), x = tone.x, y = new Float32Array(x.length + 300); let s = 0; for(let i = 0; i < x.length; i++){ s += 0.25*(x[i] - s); y[i + 300] = 0.6*Math.tanh(2*s); }
    const job = {stage: 'think', pct: 0, msg: '', from: 'plugin', name: 'Page LSTM'}; setJob(job); await finishJob(job, tone, y, {inTrim: 0});
    UI.cl.noWorkers = false; UI.cl.engine = 'wave'; const j = UI.cl.job, c = NP.clones.find(x => x.id === j.id); return {stage: j.stage, esr: j.esr, arch: c && NAMCore.parse(c.nam).arch, msg: j.msg}; });
  ok(r.stage === 'done' && r.arch === 'LSTM', `training also runs without workers (LSTM, ${r.esr != null ? (100*(1 - r.esr)).toFixed(1) + '% close' : r.msg})`);
  // 4c. the send test and the interface measure run with the fake input device
  r = await page.evaluate(async () => { await sendTest(); const t = UI.cl.test; await measureInterface(); return {test: t && t.msg, rt: UI.cl.rtDb}; });
  ok(!!r.test, 'send test reports: ' + r.test);
  // 4d. safety: the chain is muted while a pedal may be patched in, and one Clone tone plays at a time
  r = await page.evaluate(async () => { const wait = ms => new Promise(r => setTimeout(r, ms));
    UI.cl.pedalUsed = false; setJob(null); UI.cl.mode = 'pedal'; go('clone'); await wait(300); const g1 = NP.cloneGuard, m1 = NP.rig.master.gain.value, chip = !!document.getElementById('stclone');
    UI.cl.mode = 'file'; renderPage(); cloneGuardSync(); const g2 = NP.cloneGuard; UI.cl.mode = 'pedal'; go('clone');
    UI.cl.pedalUsed = false; go('io'); const gio = NP.cloneGuard; go('chain'); await wait(1600); const g3 = NP.cloneGuard, m3 = NP.rig.master.gain.value;
    return {g1, m1, chip, g2, gio, g3, m3}; });
  ok(r.g1 === 1 && r.m1 < 0.01 && r.chip, `the chain is muted on the pedal tab (master ${r.m1.toFixed(3)}, chip shown)`);
  ok(r.gio === 1, 'the chain stays muted while you pick the interface on the I/O page');
  ok(r.g2 === 0 && r.g3 === 0 && r.m3 > 0.5, `if no tone was sent, the chain comes back on the other tabs and pages (master ${r.m3.toFixed(2)})`);
  r = await page.evaluate(async () => { const wait = ms => new Promise(r => setTimeout(r, ms));
    UI.cl.mode = 'pedal'; go('clone'); const p = sendTest(); await wait(350); const busy = UI.cl.busy, g = NP.cloneGuard;
    go('global'); applyGlobals(); NP.globals.mute = 1; applyGlobals(); await wait(250); const m = NP.rig.master.gain.value, o = NP.rig.outGain.gain.value; NP.globals.mute = 0;
    const slot = NP.bank*8 + NP.slot; NP.mode = 'preset'; footPress(1); gotoPreset((slot + 1) % 16); toggleTuner(); const moved = NP.bank*8 + NP.slot !== slot, tuner = UI.page === 'tuner';
    const t2 = measureInterface(); await p; await t2; const after = UI.cl.busy; go('chain'); await wait(100); const g4 = NP.cloneGuard;
    document.getElementById('stclone').click(); const modal = !!document.getElementById('cok'); if(modal) document.getElementById('cok').click(); await wait(1600);
    return {busy, g, m, o, moved, tuner, after, g4, modal, g5: NP.cloneGuard, m5: NP.rig.master.gain.value}; });
  ok(r.busy && r.g === 2 && r.m < 0.01 && r.o > 0.9, `while a test tone plays, page changes and mute do not unmute the chain or cut the tone (master ${r.m.toFixed(3)}, out ${r.o.toFixed(2)})`);
  ok(!r.moved && !r.tuner && !r.after, 'presets, footswitches, the tuner and a second tone wait for the test tone');
  ok(r.g4 === 1 && r.modal && r.g5 === 0 && r.m5 > 0.5, `after a tone went out, the chain stays muted on other pages until you say the loop is unplugged (master ${r.m5.toFixed(2)})`);
  r = await page.evaluate(async () => { const c = NP.clones.find(x => x.kind === 'ir'); setJob({stage: 'done', from: 'pedal', id: c.id, esr: 0.01, kindTxt: 'IR', msg: 'Saved.'}); UI.cl.pedalUsed = true;
    go('chain'); const g1 = NP.cloneGuard; go('clone'); const note = !!document.querySelector('.cl-job .cl-mute'); document.querySelector('.cl-job [data-cl="use"]').click();
    const modal = !!document.getElementById('cok'); if(modal) document.getElementById('cok').click(); const g2 = NP.cloneGuard, pg = UI.page;
    const b = NP.blocks[NP.selected]; if(b){ keepRefs(() => { NP.paths.A.splice(NP.paths.A.indexOf(b), 1); }); destroyBlock(b); NP.selected = null; rewire(); } setJob(null); return {g1, note, modal, g2, pg}; });
  ok(r.g1 === 1 && r.note && r.modal && r.g2 === 0 && r.pg === 'chain', 'after a pedal take the chain stays muted until you say the loop is unplugged');
  // 4d2. while a tone plays, the unplug dialog and the I/O controls wait
  r = await page.evaluate(async () => { const wait = ms => new Promise(r => setTimeout(r, ms)); setJob(null); UI.cl.mode = 'plugin'; go('clone');
    const p = captureRun(new Float32Array(24000), 0.2); await wait(150); const ch0 = NP.globals.inCh;
    afterPedal(() => {}); const modal = !!document.getElementById('cok'); go('io'); await wait(50); const jack = document.querySelector('[data-inch="1"]'); if(jack) jack.click(); const ch1 = NP.globals.inCh;
    await p; const g = NP.cloneGuard; go('chain'); const g2 = NP.cloneGuard; return {modal, same: ch0 === ch1, g, g2}; });
  ok(!r.modal && r.same && r.g === 1 && r.g2 === 1, 'during a tone the unplug dialog and the input jack wait, and the chain stays muted after');
  // 4d3. a pedal clone is driven the same no matter the app's input Gain; the preview follows the master as it moves
  r = await page.evaluate(async () => { const wait = ms => new Promise(r => setTimeout(r, ms)); const c = NP.clones.find(x => x.from === 'pedal' && x.kind === 'nam');
    useClone(c.id); const b = NP.blocks[NP.selected]; await wait(200); const in0 = b.n.inG.gain.value, w0 = b.n.wet.gain.value;
    NP.globals.inGain = 6; applyGlobals(); await wait(250); const in1 = b.n.inG.gain.value, w1 = b.n.wet.gain.value; NP.globals.inGain = 0; applyGlobals();
    keepRefs(() => { NP.paths.A.splice(NP.paths.A.indexOf(b), 1); }); destroyBlock(b); NP.selected = null; rewire();
    go('clone'); playBuffer(new Float32Array(48000), 48000, true); NP.globals.master = -20; applyGlobals(); await wait(250); const pg = UI.clSrcG ? UI.clSrcG.gain.value : -1; stopPreview(); NP.globals.master = 0; applyGlobals();
    return {inRatio: in1/in0, wetRatio: w1/w0, pg}; });
  ok(Math.abs(r.inRatio - 0.501) < 0.01 && Math.abs(r.wetRatio - 1.995) < 0.03, `a pedal clone undoes the input Gain going in and adds it back coming out (in x${r.inRatio.toFixed(3)}, out x${r.wetRatio.toFixed(3)})`);
  ok(Math.abs(r.pg - 0.09) < 0.005, `the A/B preview follows the master when it moves (gain ${r.pg.toFixed(3)})`);
  // 4d4. an upload that stops before the end of the tone is refused
  r = await page.evaluate(async () => { const tone = Cloner.makeTone(48000), n = tone.seg.endAt + 24000, y = Float32Array.from(tone.x.subarray(0, n), v => 0.5*Math.tanh(4*v));
    const keep = window.pickFile; window.pickFile = async () => new File([Cloner.wav24(y, 48000)], 'cut.wav', {type: 'audio/wav'}); setJob(null); UI.cl.mode = 'plugin'; go('clone'); await startUpload(); window.pickFile = keep;
    const j = UI.cl.job; setJob(null); return {stage: j && j.stage, msg: j && j.msg}; });
  ok(r.stage === 'error' && /stops before the end/.test(r.msg), 'an upload cut before the end is refused: ' + r.msg);
  // 4e. the take survives rewiring, and its length tells if the audio stalled
  r = await page.evaluate(async () => { const wait = ms => new Promise(r => setTimeout(r, ms)); const n = 48000; const p = captureRun(new Float32Array(n), 0.3);
    for(let i = 0; i < 5; i++){ await wait(120); rewire(); } const rec = await p; return {len: rec && rec.length, want: n + 0.3*48000}; });
  ok(r.len >= r.want, `the recording tap survives rewiring (${r.len} of ${r.want} samples)`);
  r = await page.evaluate(async () => { const keep = window.playRecord; window.playRecord = async signal => new Float32Array(signal.length >> 1);
    setJob(null); UI.cl.mode = 'pedal'; go('clone'); await startLive(); window.playRecord = keep; const j = UI.cl.job; return {stage: j && j.stage, msg: j && j.msg}; });
  ok(r.stage === 'error' && /cut short/.test(r.msg), 'a short take is refused: ' + r.msg);
  // 4f. a take that slipped in time is refused with a plain message
  r = await page.evaluate(async () => { const tone = Cloner.makeTone(48000), x = tone.x, y = new Float32Array(x.length + 2000); for(let i = 0; i < x.length; i++) y[i + 300 + (i > 48000*30 ? 512 : 0)] = 0.5*Math.tanh(4*x[i]);
    const job = {stage: 'think', pct: 0, msg: '', from: 'pedal', name: 'Slip'}; setJob(job); await finishJob(job, tone, y, {inTrim: 0}); const j = UI.cl.job; return {stage: j && j.stage, msg: j && j.msg}; });
  ok(r.stage === 'error' && /slipped/.test(r.msg), 'a take with a dropout is refused: ' + r.msg);
  // 4g. Stop works from the first moment of training, and nothing half-made is saved
  r = await page.evaluate(async () => { const tone = Cloner.makeTone(48000), x = tone.x, y = new Float32Array(x.length + 300); for(let i = 0; i < x.length; i++) y[i + 300] = 0.5*Math.tanh(4*x[i]);
    const job = {stage: 'think', pct: 0, msg: '', from: 'plugin', name: 'Stop Early'}; setJob(job); const p = finishJob(job, tone, y, {inTrim: 0});
    while(!(UI.cl.job && UI.cl.job.stage === 'train')) await new Promise(r => setTimeout(r, 5)); const had = typeof UI.cl.job.stop === 'function'; UI.cl.job.stop(); await p;
    return {had, job: UI.cl.job, n: NP.clones.filter(c => c.name === 'Stop Early').length}; });
  ok(r.had && r.job === null && r.n === 0, 'Stop works as soon as training shows, and nothing is saved');
  // 4h. the A/B preview stops when you leave the page or use the clone, and follows the master volume
  r = await page.evaluate(() => { setJob(null); UI.cl.mode = 'plugin'; go('clone'); NP.globals.master = -12; playBuffer(new Float32Array(48000), 48000, true); const g = UI.clSrcG.gain.value, on = !!UI.clSrc;
    go('chain'); const off1 = !UI.clSrc; go('clone'); playBuffer(new Float32Array(48000), 48000, true); const c = NP.clones.find(x => x.kind === 'ir'); useClone(c.id); const off2 = !UI.clSrc; NP.globals.master = 0; applyGlobals();
    const b = NP.blocks[NP.selected]; keepRefs(() => { NP.paths.A.splice(NP.paths.A.indexOf(b), 1); }); destroyBlock(b); NP.selected = null; rewire();
    return {g, on, off1, off2}; });
  ok(r.on && r.off1 && r.off2 && Math.abs(r.g - 0.9*Math.pow(10, -12/20)) < 1e-3, `the A/B preview stops on page change and on "Use it", and follows the master (gain ${r.g.toFixed(3)})`);
  // 4i. a late "ready" from the old model does not change the state of the new one
  r = await page.evaluate(async () => { const nam = NP.clones.find(c => c.kind === 'nam'), ir = NP.clones.find(c => c.kind === 'ir'); useClone(nam.id); const b = NP.blocks[NP.selected];
    setParam(b, 'clone', cloneIndex(ir.id) + 1); const s0 = b.n.state; await new Promise(r => setTimeout(r, 1500)); const res = {s0, state: b.n.state, loaded: b.n.loaded === ir.id};
    keepRefs(() => { NP.paths.A.splice(NP.paths.A.indexOf(b), 1); }); destroyBlock(b); NP.selected = null; rewire(); return res; });
  ok(r.s0 === 'ready' && r.state === 'ready' && r.loaded, `switching models fast keeps the right state (${r.s0} -> ${r.state})`);
  // 4j. IR resampling keeps the level, AIFF gets a plain answer, and the input jack picker passes the bass
  r = await page.evaluate(async () => { const x = new Float32Array(441).fill(0.01); let a = 0, b = 0; for(const v of x) a += v; for(const v of resampleIR(x, 44100, 48000)) b += v; let c = 0; for(const v of resampleIR(x, 44100, 22050)) c += v;
    const keep = window.pickFile; window.pickFile = async () => new File([new Uint8Array(64)], 'take.aiff'); setJob(null); UI.cl.mode = 'plugin'; go('clone'); await startUpload(); window.pickFile = keep; const j = UI.cl.job; setJob(null);
    const pk = []; for(const ch of [0, 1, 2]){ NP.globals.inCh = ch; applyGlobals(); await new Promise(r => setTimeout(r, 60)); const rec = await captureRun(new Float32Array(2400), 1.2); let p = 0; for(const v of rec) p = Math.max(p, Math.abs(v)); pk.push(p); }
    NP.globals.inCh = 0; applyGlobals(); go('io'); const picker = document.querySelectorAll('[data-inch]').length; return {up: b/a, down: c/a, aiff: j && j.msg, pk, picker}; });
  ok(Math.abs(r.up - 1) < 0.01 && Math.abs(r.down - 1) < 0.02, `IR resampling keeps the level (${r.up.toFixed(3)}, ${r.down.toFixed(3)})`);
  ok(/AIFF/.test(r.aiff || ''), 'AIFF gets a plain answer: ' + r.aiff);
  ok(r.picker === 3 && r.pk[0] > 0.001 && r.pk[2] > 0.001, `the input jack picker shows and passes the input (peaks ${r.pk.map(v => v.toFixed(3)).join(', ')})`);
  // 5. other page modes render
  for(const m of ['plugin', 'file']){ await page.evaluate(mm => { setJob(null); UI.cl.mode = mm; go('clone'); }, m); await page.waitForTimeout(350); await page.screenshot({path: SHOTS + '/61-clone-' + m + '.png'}); }
  // 6. clones survive a reload, and so does the muted chain while a pedal may be patched in
  const before = await page.evaluate(() => { loopFlag(true); return NP.clones.length; });
  await power();
  const after = await page.evaluate(async () => { await new Promise(r => setTimeout(r, 300)); return NP.clones.length; });
  r = await page.evaluate(async () => { const g = NP.cloneGuard, m = NP.rig.master.gain.value, chip = !!document.querySelector('#stclone[data-cl="unmute"]');
    document.getElementById('stclone').click(); const modal = !!document.getElementById('cok'); if(modal) document.getElementById('cok').click(); await new Promise(r => setTimeout(r, 1500));
    return {g, m, chip, modal, g2: NP.cloneGuard, m2: NP.rig.master.gain.value, flag: localStorage.getItem(LOOP_KEY)}; });
  ok(r.g === 1 && r.m < 0.01 && r.chip && r.modal && r.g2 === 0 && r.m2 > 0.5 && r.flag === null, `after a reload the chain starts muted until you say the loop is unplugged (master ${r.m.toFixed(2)} -> ${r.m2.toFixed(2)})`);
  ok(after === before && after >= models.length + 2, `clones survive a reload (${before} -> ${after})`);
  // 7. export makes a .nam file the reader accepts
  r = await page.evaluate(() => { const c = NP.clones.find(x => x.kind === 'nam' && x.from !== 'file'); let blob = null; const keep = window.download; window.download = (b, n) => { blob = {n, size: b.size}; }; exportClone(c); window.download = keep; return blob; });
  ok(r && /\.nam$/.test(r.n) && r.size > 1000, 'export gives a .nam file (' + (r && r.n) + ', ' + (r && r.size) + ' bytes)');
  await page.evaluate(() => { UI.cl.mode = 'file'; go('clone'); }); await page.waitForTimeout(350); await page.evaluate(() => { const p = document.getElementById('page'); p.scrollTop = p.scrollHeight; }); await page.waitForTimeout(100); await page.screenshot({path: SHOTS + '/64-clone-library.png', fullPage: false});
  // phone size
  await page.setViewportSize({width: 390, height: 844}); await page.evaluate(() => { setJob(null); UI.cl.mode = 'pedal'; go('clone'); }); await page.waitForTimeout(400);
  await page.screenshot({path: SHOTS + '/65-clone-mobile.png'});
  const wide = await page.evaluate(() => { const p = document.getElementById('page'); return p.scrollWidth - p.clientWidth; });
  ok(wide <= 1, 'no sideways scroll on a phone (' + wide + ' px)');
  ok(errs.length === 0, 'no page errors' + (errs.length ? ':\n  ' + errs.slice(0, 8).join('\n  ') : ''));
  console.log(out.join('\n')); console.log(out.some(l => l.startsWith('FAIL')) ? 'SOME FAILED' : 'all passed');
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
