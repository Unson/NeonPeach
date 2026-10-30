// Crash guard: if the app died while the native engine was starting, the next start leaves it off and says so.
const { _electron: electron } = require('playwright'); const fs = require('fs'), path = require('path'), os = require('os');
const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'nphome-')); const cfg = path.join(HOME, '.config', 'Neon Peach'); fs.mkdirSync(cfg, {recursive: true});
fs.writeFileSync(path.join(cfg, 'settings.json'), JSON.stringify({natPending: true}));
(async () => { const app = await electron.launch({executablePath: path.join(__dirname, 'node_modules/electron/dist/electron'), args: ['--no-sandbox', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', __dirname], env: Object.assign({}, process.env, {HOME, XDG_CONFIG_HOME: path.join(HOME, '.config')})});
  const win = await app.firstWindow(); await win.waitForLoadState('domcontentloaded');
  await win.evaluate(() => localStorage.setItem('neonpeach.v1.native', JSON.stringify({enabled: true, api: 'null', fakeInput: true}))); await win.reload(); await win.waitForLoadState('domcontentloaded');
  await win.click('#power'); await win.waitForSelector('#pedal', {state: 'visible', timeout: 20000}); await win.waitForTimeout(800);
  const r = await win.evaluate(() => ({native: !!UI.native, crashed: !!(NAT.info && NAT.info.crashed)})); await win.evaluate(() => go('io')); await win.waitForTimeout(200);
  const offer = await win.evaluate(() => !!document.querySelector('#naton'));
  const st = JSON.parse(fs.readFileSync ? '{}' : '{}'); void st;
  console.log((!r.native && r.crashed && offer ? 'ok   ' : 'FAIL ') + 'after a crash the engine stays off and offers to try again (native ' + r.native + ', offer ' + offer + ')');
  await win.evaluate(async () => { await npNative.reset(); }); const s = JSON.parse(fs.readFileSync(path.join(cfg, 'settings.json'), 'utf8'));
  console.log((s.nativeOff === false ? 'ok   ' : 'FAIL ') + 'trying again clears the guard');
  await app.evaluate(({app}) => app.exit(0)); })().catch(e => { console.error(e); process.exit(1); });
