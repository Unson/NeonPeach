// Runs the desktop app (Linux build of the same code) and checks the desktop features.
const { _electron: electron } = require('playwright'); const fs = require('fs'), path = require('path'), os = require('os');
const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'nphome-')); let DOCS = '';
const out = []; const ok = (c, m) => out.push((c ? 'ok   ' : 'FAIL ') + m);
const EXE = process.argv[2] || path.join(__dirname, 'node_modules/electron/dist/electron'), APPDIR = process.argv[3] ? [] : [__dirname];
const launch = () => electron.launch({executablePath: EXE, args: ['--no-sandbox', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', ...APPDIR], env: Object.assign({}, process.env, {HOME, XDG_CONFIG_HOME: path.join(HOME, '.config')})});
(async () => {
  let app = await launch(); let win = await app.firstWindow(); const errs = []; win.on('pageerror', e => errs.push(e.message));
  await win.waitForLoadState('domcontentloaded');
  DOCS = path.join(await app.evaluate(({app}) => app.getPath('documents')), 'Neon Peach');
  ok((await win.title()) === 'Neon Peach', 'window opens with the title Neon Peach');
  const menus = await app.evaluate(({Menu}) => Menu.getApplicationMenu().items.map(i => i.label));
  ok(['File', 'Edit', 'View', 'Audio', 'Window', 'Help'].every(l => menus.includes(l)), 'menus: ' + menus.join(', '));
  const send = (cmd) => app.evaluate(({BrowserWindow}, c) => BrowserWindow.getAllWindows()[0].webContents.send('np:menu', c), cmd);
  await send('power'); await win.waitForSelector('#pedal', {state: 'visible', timeout: 20000}); await win.waitForTimeout(1200);
  let r = await win.evaluate(() => ({input: UI.inputOk, app: IS_APP, cls: document.documentElement.classList.contains('desktop'), sr: NP.ctx.sampleRate}));
  ok(r.input && r.app && r.cls, `powered on from the menu, input open (${r.sr} Hz)`);
  await send('page:clone'); await win.waitForTimeout(200); ok(await win.evaluate(() => UI.page) === 'clone', 'View menu opens pages');
  // v2 menu commands
  await send('page:wizard'); await win.waitForTimeout(150); await win.evaluate(() => document.querySelector('[data-wiz="metal"]').click());
  ok(await win.evaluate(() => NP.preset.name) === 'Modern Clank', 'Wizard opens from the menu and builds a rig');
  await win.evaluate(() => { const b = NP.paths.A.find(x => x.type === 'comp'); setParam(b, 'ratio', 12); }); await win.waitForTimeout(700); await send('undo'); await win.waitForTimeout(200);
  ok(await win.evaluate(() => NP.paths.A.find(x => x.type === 'comp').p.ratio) !== 12, 'Edit > Undo undoes a knob');
  await send('drums'); await win.waitForTimeout(700); ok(await win.evaluate(() => UI.dr.on && UI.dr.marks.length > 0), 'Audio > Beat starts the drums'); await send('drums');
  await send('stage'); await win.waitForTimeout(300); ok(await win.evaluate(() => UI.stage && getComputedStyle(document.getElementById('stagev')).display === 'flex'), 'View > Stage Mode opens'); await send('stage');
  const set1 = await win.evaluate(async () => { await npDesktop.setSettings({exclusiveAudio: true, relaunch: false}); return npDesktop.getSettings(); });
  const sf = JSON.parse(fs.readFileSync(path.join(HOME, '.config', 'Neon Peach', 'settings.json'), 'utf8'));
  await win.evaluate(() => npDesktop.setSettings({exclusiveAudio: false, relaunch: false}));
  ok(set1.exclusiveAudio === true && sf.exclusiveAudio === true, 'the exclusive audio setting is saved for next start');
  ok(await win.evaluate(() => chainLatency() < 60), 'chain delay is tiny (' + await win.evaluate(() => (chainLatency()/48).toFixed(2)) + ' ms)');
  // files land in Documents/Neon Peach
  const nam = fs.readFileSync('/home/claude/ref/NeuralAmpModelerCore/example_models/wavenet.nam', 'utf8');
  await app.evaluate(({BrowserWindow}, f) => BrowserWindow.getAllWindows()[0].webContents.send('np:open-file', f), {name: 'Test Drive.nam', text: nam});
  await win.waitForTimeout(800);
  r = await win.evaluate(() => { const c = NP.clones.find(x => x.name === 'Test Drive' || x.from === 'file'); if(c) exportClone(c); return !!c; });
  ok(r, 'a .nam file opened from the computer loads into Clone');
  await win.evaluate(() => { const t = Cloner.makeTone(48000); download(new Blob([Cloner.wav24(t.x.subarray(0, 4800), 48000)], {type: 'audio/wav'}), 'neon-peach-test-tone.wav', 'Test Tones'); });
  await send('export-all'); await send('backup'); await win.waitForTimeout(1500);
  const list = d => { try{ return fs.readdirSync(path.join(DOCS, d)); }catch(e){ return []; } };
  ok(list('Clones').some(f => /\.nam$/.test(f)), 'clone export saved in Clones: ' + list('Clones').join(', '));
  ok(list('Presets').includes('neon-peach-presets.json') && list('Test Tones').length === 1, 'presets and test tone saved: ' + list('Presets').join(', ') + ' / ' + list('Test Tones').join(', '));
  const bk = list('Backups'); ok(bk.length === 1 && JSON.parse(fs.readFileSync(path.join(DOCS, 'Backups', bk[0]), 'utf8')).banks.length === 128, 'backup written: ' + bk.join(', '));
  r = await win.evaluate(async () => { download(new Blob(['x']), 'neon-peach-presets.json', 'Presets'); await new Promise(r => setTimeout(r, 300)); return document.getElementById('toast').textContent; });
  ok(list('Presets').includes('neon-peach-presets (2).json') && /Neon Peach/.test(r), 'no file is overwritten, and a toast says where it went: ' + r);
  // keyboard: Ctrl+1 opens Chain and does not press footswitch 1
  r = await win.evaluate(() => { const slot = NP.bank*8 + NP.slot; document.dispatchEvent(new KeyboardEvent('keydown', {key: '1', ctrlKey: true, bubbles: true})); return NP.bank*8 + NP.slot === slot; });
  ok(r, 'Ctrl+number does not press the footswitches');
  // keep awake while a clone works
  r = await win.evaluate(() => { setJob({stage: 'train', pct: 10, msg: '', from: 'plugin', name: 'x', stop(){}}); return true; });
  await win.waitForTimeout(200); const awake = await app.evaluate(({powerSaveBlocker}) => { for(let i = 0; i < 10; i++) if(powerSaveBlocker.isStarted(i)) return true; return false; });
  ok(awake, 'the computer stays awake while a clone works');
  // quitting while a clone works asks first
  await app.evaluate(({BrowserWindow}) => BrowserWindow.getAllWindows()[0].close()); await win.waitForTimeout(600);
  const asked = await win.evaluate(() => !!document.getElementById('cok') && /still working/.test(document.getElementById('modal').textContent));
  ok(asked, 'closing while a clone works asks first');
  await win.evaluate(() => { document.getElementById('cno').click(); setJob(null); });
  const st = path.join(HOME, '.config', 'Neon Peach', 'window.json');
  const closed = new Promise(res => app.on('close', res)); await app.evaluate(({BrowserWindow}) => BrowserWindow.getAllWindows()[0].close());
  await Promise.race([closed, new Promise(r => setTimeout(r, 6000))]);
  ok(fs.existsSync(st), 'window size is remembered');
  ok(errs.length === 0, 'no page errors' + (errs.length ? ': ' + errs.join(' | ') : ''));
  // second start: state and clones persist
  app = await launch(); win = await app.firstWindow(); await win.waitForLoadState('domcontentloaded'); await win.click('#power'); await win.waitForSelector('#pedal', {state: 'visible', timeout: 20000}); await win.waitForTimeout(800);
  r = await win.evaluate(() => NP.clones.length); ok(r >= 1, 'clones are still there after a restart (' + r + ')');
  await win.screenshot({path: path.join(__dirname, 'shot-app.png')});
  await app.evaluate(({app}) => app.exit(0));
  console.log(out.join('\n')); console.log(out.some(l => l.startsWith('FAIL')) ? 'SOME FAILED' : 'all passed');
})().catch(e => { console.error(e); process.exit(1); });
