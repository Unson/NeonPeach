// Neon Peach desktop app: window, menus, files, permissions.
'use strict';
const { app, BrowserWindow, Menu, ipcMain, shell, dialog, session, powerSaveBlocker, systemPreferences, screen } = require('electron');
const path = require('path');
const fs = require('fs');

const isMac = process.platform === 'darwin';
app.setName('Neon Peach');
// Sound starts without a click, and audio, timers and training keep running when the window is hidden.
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');

// ---------- app settings (userData/settings.json) ----------
const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');
function readSettings(){ try{ return JSON.parse(fs.readFileSync(settingsFile(), 'utf8')) || {}; }catch(e){ return {}; } }
function writeSettings(s){ try{ fs.mkdirSync(path.dirname(settingsFile()), {recursive: true}); fs.writeFileSync(settingsFile(), JSON.stringify(s, null, 2)); }catch(e){} }
const SETTINGS = readSettings();
// Windows: exclusive audio lets Neon Peach own the output, so the Windows mixer can't add its own buffer.
if(process.platform === 'win32' && SETTINGS.exclusiveAudio) app.commandLine.appendSwitch('enable-exclusive-audio');

let win = null, allowClose = false, rendererReady = false, acked = false, awakeId = null, relaunchAsk = null, relaunchArmed = null;
const pendingFiles = [];

// ---------- the Neon Peach folder (in Documents) ----------
const KINDS = ['Presets', 'Clones', 'Recordings', 'Test Tones', 'Backups'];
const home = () => path.join(app.getPath('documents'), 'Neon Peach');
function folder(kind){ const p = KINDS.includes(kind) ? path.join(home(), kind) : home(); fs.mkdirSync(p, {recursive: true}); return p; }
function guessKind(name){ if(/\.nam$/i.test(name)) return 'Clones'; if(/test-tone/i.test(name)) return 'Test Tones'; if(/\.json$/i.test(name)) return 'Presets'; if(/\.wav$/i.test(name)) return 'Recordings'; return ''; }
function cleanName(n){ const s = String(n).replace(/[\\/:*?"<>|\x00-\x1f]+/g, '_').replace(/^[.\s]+/, '').trim().slice(0, 120); return s || 'file'; }
function freePath(dir, name){ const ext = path.extname(name), base = name.slice(0, name.length - ext.length); let p = path.join(dir, name), i = 2; while(fs.existsSync(p)) p = path.join(dir, `${base} (${i++})${ext}`); return p; }
function shown(p){ const rel = path.relative(app.getPath('home'), p); return (rel.startsWith('..') ? p : rel).split(path.sep).join(' › '); }
function openHome(){ fs.mkdirSync(home(), {recursive: true}); KINDS.forEach(k => fs.mkdirSync(path.join(home(), k), {recursive: true})); shell.openPath(home()); }

// ---------- window size and place, remembered ----------
const stateFile = () => path.join(app.getPath('userData'), 'window.json');
function loadWinState(){ try{ const s = JSON.parse(fs.readFileSync(stateFile(), 'utf8'));
    const area = screen.getDisplayMatching({x: s.x | 0, y: s.y | 0, width: s.width | 0, height: s.height | 0}).workArea;
    const onScreen = s.x + 80 < area.x + area.width && s.y + 40 < area.y + area.height && s.x + s.width > area.x + 80 && s.y >= area.y - 20;
    return onScreen ? s : {width: s.width, height: s.height, maximized: s.maximized}; }catch(e){ return {}; } }
function saveWinState(){ if(!win || win.isDestroyed()) return; try{ const b = win.getNormalBounds(); fs.writeFileSync(stateFile(), JSON.stringify(Object.assign(b, {maximized: win.isMaximized()}))); }catch(e){} }

// ---------- .nam files opened from the computer ----------
function queueOpen(p){ if(typeof p !== 'string' || !/\.nam$/i.test(p)) return;
  try{ const st = fs.statSync(p); if(!st.isFile() || st.size > 40e6) return; pendingFiles.push({name: path.basename(p), text: fs.readFileSync(p, 'utf8')}); }catch(e){ return; }
  flushFiles(); }
function flushFiles(){ if(!win || win.isDestroyed() || !rendererReady) return; while(pendingFiles.length) win.webContents.send('np:open-file', pendingFiles.shift()); }
app.on('open-file', (e, p) => { e.preventDefault(); queueOpen(p); if(win){ if(win.isMinimized()) win.restore(); win.focus(); } });   // macOS

const gotLock = app.requestSingleInstanceLock();   // one Neon Peach at a time: a second launch focuses the first
if(!gotLock) app.quit();
else app.on('second-instance', (_e, argv) => { argv.slice(1).forEach(queueOpen); if(win){ if(win.isMinimized()) win.restore(); win.show(); win.focus(); } });

// ---------- menus ----------
const send = (cmd) => { if(win && !win.isDestroyed()){ win.webContents.send('np:menu', cmd); if(win.isMinimized()) win.restore(); win.focus(); } };
function readmePath(){ const p = app.isPackaged ? path.join(process.resourcesPath, 'README.txt') : path.join(__dirname, 'README.txt'); return p; }
function about(){ dialog.showMessageBox(win, {type: 'none', title: 'About Neon Peach', message: 'Neon Peach ' + app.getVersion(), detail: 'Bass effects workstation with a pedal and plugin cloner.\nYour files are in ' + home(), buttons: ['OK'], icon: path.join(__dirname, 'app', 'icon.png')}); }
function buildMenu(){
  const page = (label, p, key) => ({label, accelerator: key, click: () => send('page:' + p)});
  const t = [];
  if(isMac) t.push({label: 'Neon Peach', submenu: [{role: 'about'}, {type: 'separator'}, {label: 'Settings…', accelerator: 'Cmd+,', click: () => send('page:global')}, {type: 'separator'},
    {role: 'services'}, {type: 'separator'}, {role: 'hide'}, {role: 'hideOthers'}, {role: 'unhide'}, {type: 'separator'}, {role: 'quit'}]});
  t.push({label: 'File', submenu: [
    {label: 'Power On', accelerator: 'CmdOrCtrl+Enter', click: () => send('power')},
    {type: 'separator'},
    {label: 'Load a .nam or .wav Clone…', accelerator: 'CmdOrCtrl+O', click: () => send('load-clone')},
    {label: 'Import Presets…', accelerator: 'CmdOrCtrl+Shift+O', click: () => send('import')},
    {label: 'Export All Presets and Clones', accelerator: 'CmdOrCtrl+E', click: () => send('export-all')},
    {label: 'Back Up Now', accelerator: 'CmdOrCtrl+S', click: () => send('backup')},
    {label: 'Tone Wizard…', accelerator: 'CmdOrCtrl+N', click: () => send('page:wizard')},
    {type: 'separator'},
    {label: 'Open the Neon Peach Folder', accelerator: 'CmdOrCtrl+Shift+F', click: openHome},
    ...(isMac ? [] : [{type: 'separator'}, {label: 'Settings', accelerator: 'Ctrl+,', click: () => send('page:global')}, {type: 'separator'}, {role: 'quit', label: 'Exit'}])]});
  t.push({label: 'Edit', submenu: [
    {label: 'Undo', accelerator: 'CmdOrCtrl+Z', click: () => send('undo')},
    {label: 'Redo', accelerator: isMac ? 'Cmd+Shift+Z' : 'Ctrl+Y', click: () => send('redo')},
    {type: 'separator'}, {role: 'cut'}, {role: 'copy'}, {role: 'paste'}, {role: 'selectAll'}]});
  t.push({label: 'View', submenu: [
    page('Chain', 'chain', 'CmdOrCtrl+1'), page('Presets', 'presets', 'CmdOrCtrl+2'), page('Tone Wizard', 'wizard', 'CmdOrCtrl+3'), page('Scenes', 'scenes', 'CmdOrCtrl+4'), page('Stomp', 'stomp'),
    page('Tuner', 'tuner', 'CmdOrCtrl+5'), page('Looper', 'looper', 'CmdOrCtrl+6'), page('Beats', 'drums', 'CmdOrCtrl+7'), page('Clone', 'clone', 'CmdOrCtrl+8'), page('Tone Match', 'match', 'CmdOrCtrl+9'),
    {type: 'separator'}, {label: 'Stage Mode', accelerator: 'CmdOrCtrl+Shift+L', click: () => send('stage')},
    {type: 'separator'}, page('Audio Settings', 'io', 'CmdOrCtrl+I'), page('Outputs', 'outs'), page('MIDI', 'midi'), page('Global', 'global'),
    {type: 'separator'}, {role: 'togglefullscreen'}, {role: 'resetZoom'}, {role: 'zoomIn'}, {role: 'zoomOut'}]});
  t.push({label: 'Audio', submenu: [
    {label: 'Tuner', accelerator: 'CmdOrCtrl+T', click: () => send('tuner')},
    {label: 'Mute Everything', accelerator: 'CmdOrCtrl+Shift+M', click: () => send('mute')},
    {label: 'Record the Output', accelerator: 'CmdOrCtrl+R', click: () => send('record')},
    {label: 'Demo Riff', accelerator: 'CmdOrCtrl+D', click: () => send('demo')},
    {label: 'Start or Stop the Beat', accelerator: 'CmdOrCtrl+B', click: () => send('drums')},
    {label: 'Measure the Delay (Ping Test)', click: () => send('ping')},
    {type: 'separator'}, page('Audio Settings…', 'io'),
    ...(process.platform === 'win32' ? [{label: 'Exclusive Windows Audio (restarts)', type: 'checkbox', checked: !!SETTINGS.exclusiveAudio, click: (item) => { const on = item.checked; item.checked = !on; setExclusive(on); }}] : [])]});
  t.push({role: 'windowMenu'});
  t.push({role: 'help', submenu: [page('How Neon Peach Works', 'help'), {label: 'Read Me', click: () => shell.openPath(readmePath())}, {label: 'Open the Neon Peach Folder', click: openHome},
    ...(isMac ? [] : [{type: 'separator'}, {label: 'About Neon Peach', click: about}])]});
  Menu.setApplicationMenu(Menu.buildFromTemplate(t));
}

// ---------- the window ----------
function createWindow(){
  const st = loadWinState();
  win = new BrowserWindow({
    width: Math.max(820, st.width || 1440), height: Math.max(600, st.height || 900), x: st.x, y: st.y, minWidth: 820, minHeight: 600,
    backgroundColor: '#0a0612', title: 'Neon Peach', show: false, icon: path.join(__dirname, 'app', 'icon.png'),
    webPreferences: {preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true, nodeIntegration: false, backgroundThrottling: false, spellcheck: false}
  });
  if(st.maximized) win.maximize();
  win.once('ready-to-show', () => win.show());
  win.webContents.on('did-start-loading', () => { rendererReady = false; });
  // Links open in the web browser. The app never leaves its own page.
  win.webContents.setWindowOpenHandler(({url}) => { if(/^https?:\/\//i.test(url)) shell.openExternal(url); return {action: 'deny'}; });
  win.webContents.on('will-navigate', (e, url) => { if(url !== win.webContents.getURL()) e.preventDefault(); });
  win.on('resize', saveWinState); win.on('move', saveWinState);
  // Closing asks the page to save and back up first, and to check that no clone is still learning.
  win.on('close', (e) => { saveWinState(); if(allowClose){ if(relaunchArmed) commitRelaunch(); return; } e.preventDefault();
    relaunchArmed = relaunchAsk; relaunchAsk = null;   // a restart only counts for the close it asked for. A cancelled close drops it.
    if(!rendererReady){ allowClose = true; win.close(); return; }
    acked = false; win.webContents.send('np:want-close');
    setTimeout(() => { if(!acked && win && !win.isDestroyed()){ allowClose = true; win.close(); } }, 4000); });   // the page did not answer: close anyway
  win.on('closed', () => { win = null; });
  win.loadFile(path.join(__dirname, 'app', 'index.html'));
}

// ---------- requests from the page ----------
ipcMain.handle('np:save', (_e, kind, name, buf) => {
  const dir = folder(KINDS.includes(kind) ? kind : guessKind(name)), p = freePath(dir, cleanName(name));
  fs.writeFileSync(p, Buffer.from(buf)); return {path: p, shown: shown(p)}; });
ipcMain.handle('np:backup', (_e, json) => {
  const dir = folder('Backups'), now = new Date(), day = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`, p = path.join(dir, `neon-peach-backup-${day}.json`);
  fs.writeFileSync(p + '.tmp', json); fs.renameSync(p + '.tmp', p);   // a crash mid-write can't spoil the last good backup
  const old = fs.readdirSync(dir).filter(f => /^neon-peach-backup-\d{4}-\d\d-\d\d\.json$/.test(f)).sort();   // keep the newest 14 days
  old.slice(0, Math.max(0, old.length - 14)).forEach(f => { try{ fs.unlinkSync(path.join(dir, f)); }catch(e){} });
  return {path: p, shown: shown(p)}; });
ipcMain.on('np:keep-awake', (_e, on) => {
  if(on && awakeId == null) awakeId = powerSaveBlocker.start('prevent-app-suspension');
  else if(!on && awakeId != null){ powerSaveBlocker.stop(awakeId); awakeId = null; } });
ipcMain.on('np:ready', () => { rendererReady = true; flushFiles(); });

// ---------- the native audio engine (C++): ASIO / Core Audio / WASAPI, no browser audio in the way ----------
let NAT = null, natEng = null, natTimer = null, natLast = 0, natErr = '';
function natLib(){
  if(NAT || natErr) return NAT;
  const dir = app.isPackaged ? path.join(process.resourcesPath, 'native') : path.join(__dirname, 'native');
  const f = path.join(dir, process.platform + '-' + process.arch, 'npaudio.node');
  try{ NAT = require(f); }catch(e){ natErr = String(e && e.message || e); }
  return NAT; }
ipcMain.handle('np:nat-info', () => { const L = natLib(); if(!L) return {available: false, error: natErr};
  let devices = []; try{ devices = L.devices(); }catch(e){} return {available: true, devices, platform: process.platform}; });
ipcMain.handle('np:nat-open', (_e, cfg) => { const L = natLib(); if(!L) return {ok: false, error: natErr || 'The native engine is not here.'};
  try{ if(!natEng) natEng = new L.Engine({sampleRate: (cfg && cfg.rate) || 48000, outChannels: 2});
    const r = natEng.open(cfg || {}); startNatPoll(); return r; }catch(e){ return {ok: false, error: String(e && e.message || e)}; } });
ipcMain.on('np:nat-cmd', (_e, ops) => { if(natEng) try{ natEng.cmd(ops); }catch(e){ console.error(e); } });
ipcMain.handle('np:nat-close', () => { if(natEng) try{ natEng.close(); }catch(e){} return true; });
function startNatPoll(){ if(natTimer) return; natTimer = setInterval(() => { if(!natEng || !win || win.isDestroyed()) return; let pk; try{ pk = natEng.poll(); }catch(e){ return; }
  const t = Date.now(); if(pk.msgs.length || pk.errors || t - natLast > 20){ natLast = t; win.webContents.send('np:nat-pk', pk); } }, 5); }
app.on('will-quit', () => { if(natTimer) clearInterval(natTimer); if(natEng) try{ natEng.close(); }catch(e){} });
ipcMain.handle('np:get-settings', () => ({exclusiveAudio: !!SETTINGS.exclusiveAudio}));
ipcMain.handle('np:set-settings', (_e, s) => { s = s || {}; if('exclusiveAudio' in s) setExclusive(!!s.exclusiveAudio, s.relaunch !== false); return true; });
function setExclusive(on, relaunch = true){ if(!relaunch){ SETTINGS.exclusiveAudio = !!on; writeSettings(SETTINGS); return; }
  // the page gets the normal close first (it saves and backs up). Only when the window really closes is the setting written and the app restarted.
  relaunchAsk = {exclusiveAudio: !!on}; if(win && !win.isDestroyed()) win.close(); else { relaunchArmed = relaunchAsk; commitRelaunch(); app.exit(0); } }
function commitRelaunch(){ const r = relaunchArmed; relaunchArmed = null; if(!r) return; SETTINGS.exclusiveAudio = r.exclusiveAudio; writeSettings(SETTINGS); app.relaunch(); }
ipcMain.on('np:close-ack', () => { acked = true; });
ipcMain.on('np:close-now', () => { allowClose = true; if(win && !win.isDestroyed()) win.close(); });

app.whenReady().then(async () => {
  if(!gotLock) return;
  const ses = session.defaultSession;
  // Allowed: the audio input (no camera), MIDI, choosing the output, full screen. Nothing else.
  const ok = new Set(['midi', 'midiSysex', 'fullscreen', 'speaker-selection', 'clipboard-sanitized-write']);
  ses.setPermissionRequestHandler((_wc, perm, cb, details) => cb(perm === 'media' ? !((details && details.mediaTypes) || []).includes('video') : ok.has(perm)));
  ses.setPermissionCheckHandler((_wc, perm) => perm === 'media' || ok.has(perm));
  // Any download the page starts still lands in the Neon Peach folder.
  ses.on('will-download', (_e, item) => { const n = cleanName(item.getFilename()); item.setSavePath(freePath(folder(guessKind(n)), n)); });
  if(isMac){ app.setAboutPanelOptions({applicationName: 'Neon Peach', applicationVersion: app.getVersion(), credits: 'Bass effects workstation with a pedal and plugin cloner.'});
    try{ if(systemPreferences.getMediaAccessStatus('microphone') !== 'granted') await systemPreferences.askForMediaAccess('microphone'); }catch(e){} }
  buildMenu();
  createWindow();
  process.argv.slice(1).forEach(queueOpen);   // Windows: a .nam file double-clicked to start the app
});
app.on('window-all-closed', () => app.quit());
app.on('activate', () => { if(!win) createWindow(); });
