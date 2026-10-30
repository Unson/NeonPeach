// 2.2 checks: library import and browse, dual cab, gapless preset changes, bar-locked looper, song player,
// recorder and re-amp, level match, copy and paste, share codes, phaser. Saves screenshots.
const { chromium } = require('playwright'); const path = require('path'); const fs = require('fs');
const SHOTS = path.resolve(__dirname, 'shots'); fs.mkdirSync(SHOTS, {recursive: true});
const NAM = fs.readFileSync(process.env.NAMFILE || '/home/claude/ref/NeuralAmpModelerCore/example_models/my_model.nam', 'utf8');
(async () => { const browser = await chromium.launch({args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required']});
  const ctx = await browser.newContext({permissions: ['microphone'], viewport: {width: 1440, height: 900}}); const page = await ctx.newPage();
  const errs = []; page.on('pageerror', e => errs.push('PAGEERROR ' + e.message + ' ' + (e.stack || '').split('\n')[1])); page.on('console', m => { if(m.type() === 'error') errs.push('CONSOLE ' + m.text()); });
  await page.goto('file://' + path.resolve(__dirname, 'dist/neon-peach.html')); await page.click('#power'); await page.waitForSelector('#pedal', {state: 'visible', timeout: 15000}); await page.waitForTimeout(1200);
  const shot = async n => { await page.waitForTimeout(250); await page.screenshot({path: SHOTS + '/v22-' + n + '.png'}); };
  const log = []; const ok = (c, m) => { log.push((c ? 'ok   ' : 'FAIL ') + m); console.log((c ? 'ok   ' : 'FAIL ') + m); };
  const E = (f, a) => page.evaluate(f, a);
  await E(() => { window.sleep = (ms) => new Promise(r => setTimeout(r, ms)); window.peakFor = async (ms) => { const an = NP.rig.outAn, buf = new Float32Array(an.fftSize); let pk = 0, mn = 1e9, nan = false; const t0 = performance.now(); while(performance.now() - t0 < ms){ an.getFloatTimeDomainData(buf); let p = 0; for(const v of buf){ if(!isFinite(v)) nan = true; p = Math.max(p, Math.abs(v)); } pk = Math.max(pk, p); mn = Math.min(mn, p); await sleep(15); } return {pk, mn, nan}; };
    window.wavFile = (name, secs, f, rel) => { const sr = 48000, n = Math.round(sr*secs), x = new Float32Array(n); for(let i = 0; i < n; i++) x[i] = f(i, sr); const file = new File([encodeWav(x, x, sr)], name, {type: 'audio/wav'}); if(rel) Object.defineProperty(file, 'webkitRelativePath', {value: rel}); return file; }; });

  // ---- 1. library: bulk import, folders, duplicates, search, favorites
  let r = await E(async (nam) => { const ir = (i, sr) => Math.exp(-i/200)*(i % 7 === 0 ? 1 : -0.3);
    const files = [wavFile('Ampeg 8x10 SM57.wav', 0.2, ir, 'Packs/Ampeg/Ampeg 8x10 SM57.wav'), wavFile('Ampeg 8x10 Ribbon.wav', 0.2, ir, 'Packs/Ampeg/Ampeg 8x10 Ribbon.wav'), wavFile('Notes.txt.wav', 0.05, ir, 'Packs/Notes.txt.wav'),
      new File([nam], 'B15 Flip.nam', {type: ''}), new File(['hello'], 'readme.txt')];
    Object.defineProperty(files[3], 'webkitRelativePath', {value: 'Packs/Amps/B15 Flip.nam'});
    const before = NP.clones.length; await importMany(files); const after = NP.clones.length; await importMany(files.slice(0, 2)); const again = NP.clones.length;
    go('library'); UI.lib.q = 'ampeg'; renderPage(); const shown = document.querySelectorAll('#liblist .lib-row').length; UI.lib.q = ''; renderPage();
    const c = NP.clones.find(x => x.name === 'Ampeg 8x10 SM57'); document.querySelector(`[data-lfav="${c.id}"]`).click(); await sleep(100);
    const stored = (await CDB.all()).find(x => x.id === c.id);
    return {added: after - before, again: again - after, shown, folder: c.folder, fav: !!stored.fav, nam: NP.clones.some(x => x.kind === 'nam' && x.folder === 'Packs / Amps')}; }, NAM);
  ok(r.added === 4, 'a folder import brings in every .nam and .wav (' + r.added + ' of 4)');
  ok(r.again === 0, 'importing the same files twice skips them');
  ok(r.shown === 2, 'search "ampeg" finds the two Ampeg IRs (' + r.shown + ')');
  ok(r.folder === 'Packs / Ampeg' && r.nam, 'folder names are kept (' + r.folder + ')');
  ok(r.fav, 'a star is saved');
  await shot('library');

  // ---- 2. cab IRs from the library, the Browse picker, Dual Cab
  r = await E(async () => { loadPreset(blankPreset()); const b = createBlock('cab'); NP.paths.A.push(b); rewire(); NP.selected = b.id; go('chain'); renderPage();
    document.querySelector('[data-browse="cab"]').click(); await sleep(100); const rows = document.querySelectorAll('#pklist .lib-row').length;
    const ir = NP.clones.find(x => x.name === 'Ampeg 8x10 Ribbon'); document.querySelector(`[data-lpick="${ir.id}"]`).click(); await sleep(50);
    const spec = paramSpec(b, 'cab'), shown = spec.e[Math.round(b.p.cab)], len = b.n.cv.buffer && b.n.cv.buffer.length;
    setParam(b, 'cab', 2); const cleared = b.p.irid === '';
    const d = createBlock('cab2', {idA: ir.id, cabB: 3}); NP.paths.A.push(d); rewire(); toggleDemo(); await sleep(400); const s = await peakFor(400); toggleDemo();
    return {rows, shown, len, cleared, pk: s.pk, nan: s.nan, nameA: paramSpec(d, 'cabA').e[Math.round(d.p.cabA)]}; });
  ok(r.rows === 3, 'Browse in a Cabinet shows only cab IRs (' + r.rows + ')');
  ok(r.shown === '★ Ampeg 8x10 Ribbon' && r.len === 9600, 'picking an IR loads it into the cab (' + r.shown + ', ' + r.len + ' samples)');
  ok(r.cleared, 'picking a built-in cab lets go of the IR');
  ok(r.pk > 0.01 && !r.nan && r.nameA === '★ Ampeg 8x10 Ribbon', 'Dual Cab plays two cabs (peak ' + r.pk.toFixed(3) + ')');
  await shot('dualcab');

  // ---- 3. gapless preset changes and tails
  r = await E(async () => { const dl = {name: 'Echo', A: [{type: 'delay', p: {time: 400, fb: 60, mix: 60}, bypass: false}], B: []}, dry = {name: 'Dry', A: [{type: 'boost', p: {}, bypass: false}], B: []};
    loadPreset(dl); toggleDemo(); await sleep(1500); toggleDemo(); await sleep(150);
    loadPreset(dry); const tail = await peakFor(500); const retired = NP.retired.length;
    // switch while playing: the output never drops out
    toggleDemo(); await sleep(600); const res = []; for(let i = 0; i < 4; i++){ loadPreset(i % 2 ? dl : dry); res.push(await peakFor(120)); } toggleDemo();
    await sleep(200); const killed = NP.retired.length <= 1;
    return {tail: tail.pk, retired, minDuring: Math.min(...res.map(x => x.mn)), killed}; });
  ok(r.retired === 1 && r.tail > 0.01, 'delay echoes keep ringing after you change presets (peak ' + r.tail.toFixed(3) + ')');
  ok(r.minDuring > 0.002, 'no gap in the sound while switching presets (lowest peak ' + r.minDuring.toFixed(4) + ')');
  ok(r.killed, 'fast switching keeps only one old sound ringing');

  // ---- 4. looper locked to bars, and loops follow you to the next preset
  r = await E(async () => { loadPreset({name: 'L', A: [{type: 'looper', p: {}, bypass: false}], B: []}); setBpm(120); NP.globals.loopSnap = 1; const sr = NP.ctx.sampleRate, bar = 2*sr; toggleDemo();
    looperCmd('rec'); await sleep(1200); looperCmd('play'); const wait = findLooper().loopState.state; await sleep(1200); const s1 = Object.assign({}, findLooper().loopState);
    looperCmd('clear'); await sleep(50); looperCmd('rec'); await sleep(2300); looperCmd('play'); await sleep(100); const s2 = Object.assign({}, findLooper().loopState);
    toggleDemo(); const lb = findLooper(); loadPreset({name: 'Next', A: [{type: 'boost', p: {}, bypass: false}], B: []}); const kept = findLooper() === lb && lb.loopState.state !== 'empty';
    looperCmd('clear'); NP.globals.loopSnap = 0; return {wait, len1: s1.len/bar, st1: s1.state, len2: s2.len/bar, kept}; });
  ok(r.wait === 'rec' && r.len1 === 1 && r.st1 === 'play', 'stopping early keeps recording to the bar line (1 bar, ' + r.len1 + ')');
  ok(r.len2 === 1, 'stopping a little late trims to the bar (' + r.len2 + ' bar)');
  ok(r.kept, 'a recorded loop follows you to the next preset');
  r = await E(async () => { loadPreset({name: 'L', A: [{type: 'looper', p: {}, bypass: false}], B: []}); NP.globals.loopSnap = 1; drStart(); await sleep(300); looperCmd('rec'); await sleep(30); const st = findLooper().loopState.state; await sleep(2600); const st2 = findLooper().loopState.state; looperCmd('stop'); looperCmd('clear'); drStop(); NP.globals.loopSnap = 0; go('looper'); return {st, st2}; });
  ok(r.st === 'arm' && r.st2 === 'rec', 'with Beats playing, recording waits for bar 1 (' + r.st + ' then ' + r.st2 + ')');

  // ---- 5. song player
  r = await E(async () => { const f = wavFile('Test Song.wav', 12, (i, sr) => 0.3*Math.sin(2*Math.PI*110*i/sr)*(Math.floor(i/(sr/2)) % 2 ? 1 : 0.4)); await plLoadFile(f); await sleep(300);
    const sr = PL.song.sr; plPlay(0); await sleep(1000); const p1 = plPos()/sr; const a = await peakFor(300);
    PL.speed = 0.5; plRestart(); await sleep(100); const q0 = plPos(); await sleep(1000); const rate = (plPos() - q0)/sr;
    PL.speed = 1; PL.A = 4*sr; PL.B = 5*sr; PL.loopOn = true; plSyncLoop(); plPlay(PL.A); await sleep(2600); const inLoop = plPos()/sr;
    PL.pitch = 5; plRestart(); await sleep(500); const b = await peakFor(300); plPause(); await sleep(100); const paused = plPos(); await sleep(300); const still = plPos() === paused;
    await sleep(400); const songs = PL.recent.length;
    return {p1, pk: a.pk, rate, inLoop, pk2: b.pk, still, songs, tempoAsked: true}; });
  ok(r.p1 > 0.8 && r.p1 < 1.2 && r.pk > 0.05, 'a song plays (at ' + r.p1.toFixed(2) + ' s, peak ' + r.pk.toFixed(2) + ')');
  ok(Math.abs(r.rate - 0.5) < 0.08, 'half speed moves at half speed (' + r.rate.toFixed(2) + ' s per s)');
  ok(r.inLoop >= 3.95 && r.inLoop <= 5.05, 'the A-B loop wraps around (at ' + r.inLoop.toFixed(2) + ' s)');
  ok(r.pk2 > 0.05, 'a key change still plays');
  ok(r.still, 'pause holds the place');
  ok(r.songs >= 1, 'the song is kept in Your songs');
  await E(() => { go('practice'); }); await shot('practice');

  // ---- 6. recorder, takes and re-amp
  r = await E(async () => { loadPreset({name: 'Grit', A: [{type: 'b3k', p: {drive: 70}, bypass: false}], B: []}); toggleDemo(); recStart(); await sleep(1500); await recStop(); toggleDemo(); await sleep(100);
    const t = UI.rk.takes[0], a = await takeAudio(t.id); let diPk = 0; for(const v of a.di) diPk = Math.max(diPk, Math.abs(v));
    loadPreset({name: 'Clean', A: [{type: 'boost', p: {}, bypass: false}], B: []}); await takeReamp(t.id); const muted = NP.reamp; await sleep(2600); const t2 = UI.rk.takes[0];
    return {n: UI.rk.takes.length, dur: t.dur, diPk, muted, name: t2.name, dur2: t2.dur, back: !NP.reamp}; });
  ok(r.dur > 1.3 && r.dur < 1.7 && r.diPk > 0.01, 'a take keeps the clean bass (' + r.dur.toFixed(2) + ' s)');
  ok(r.muted && r.back, 'your live bass is muted while re-amping, and comes back after');
  ok(r.n === 2 && /re-amp: Clean/.test(r.name) && r.dur2 >= r.dur - 0.05 && r.dur2 < r.dur + 0.6, 'Re-amp makes a new take through the new preset (' + r.name + ', ' + (r.dur2 || 0).toFixed(2) + ' s)');
  await E(() => go('record')); await shot('record');

  // ---- 7. level match, copy and paste, share codes, phaser
  r = await E(async () => { loadPreset({name: 'Quiet', A: [{type: 'boost', p: {gain: 0}, bypass: false}], B: []}); NP.globals.lvlRef = null; toggleDemo(); await sleep(300); levelMatch(); await sleep(6400);
    const ref = NP.globals.lvlRef; NP.preset.split.aLvl = -9; rewire(); levelMatch(); await sleep(6400); toggleDemo(); return {ref, level: NP.preset.level}; });
  ok(r.ref != null && Math.abs(r.level - 9) < 1.5, 'Match level brings a quieter preset back up (set to +' + r.level + ' dB)');
  r = await E(async () => { loadPreset({name: 'Src', A: [{type: 'tilt', p: {tilt: 7}, bypass: false}], B: []}); blockCopy(NP.paths.A[0]); loadPreset(blankPreset()); NP.selected = null; go('chain'); renderPage();
    const btn = !!document.querySelector('[data-paste="B"]'); document.querySelector('[data-paste="B"]').click(); const b = NP.paths.B[0];
    const code = await presetCode(); const back = await presetFromCode('Here it is: ' + code + ' enjoy'); let bad = false; try{ await presetFromCode('NP1.zzzz'); }catch(e){ bad = true; }
    return {btn, type: b && b.type, tilt: b && b.p.tilt, code: code.length, same: back.B[0].p.tilt === 7, bad}; });
  ok(r.btn && r.type === 'tilt' && r.tilt === 7, 'a copied block pastes into another preset');
  ok(r.same && r.bad, 'a share code loads back the same preset, and a broken code is refused (' + r.code + ' chars)');
  r = await E(async () => { loadPreset({name: 'Ph', A: [{type: 'phaser', p: {fb: 80}, bypass: false}], B: []}); toggleDemo(); await sleep(500); const s = await peakFor(400); toggleDemo(); return s; });
  ok(r.pk > 0.01 && !r.nan, 'phaser with feedback plays (peak ' + r.pk.toFixed(3) + ')');

  // ---- 8. pages on a phone
  await page.setViewportSize({width: 390, height: 844});
  for(const p of ['library', 'practice', 'record', 'looper', 'chain']){ await E(p => go(p), p); await page.waitForTimeout(200); const sw = await E(() => document.documentElement.scrollWidth - innerWidth); ok(sw <= 0, p + ': no sideways scroll on a phone (' + sw + ' px)'); if(p !== 'chain') await shot('phone-' + p); }
  ok(!errs.length, 'no page errors' + (errs.length ? ': ' + errs.slice(0, 5).join(' | ') : ''));
  await browser.close(); const fails = log.filter(l => l.startsWith('FAIL')); console.log(fails.length ? fails.length + ' failed' : 'all passed'); process.exit(fails.length ? 1 : 0);
})();
