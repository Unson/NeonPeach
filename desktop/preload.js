// Neon Peach desktop: the small, safe bridge between the app page and the computer.
// The page gets window.npDesktop. It can save files into the Neon Peach folder, write backups,
// keep the computer awake while a clone learns, and hear menu commands. Nothing else.
'use strict';
const { contextBridge, ipcRenderer } = require('electron');

const on = (ch, fn) => { ipcRenderer.on(ch, (_e, data) => { try{ fn(data); }catch(err){ console.error(err); } }); };

contextBridge.exposeInMainWorld('npDesktop', {
  platform: process.platform,
  save: (kind, name, buf) => ipcRenderer.invoke('np:save', String(kind || ''), String(name || 'file'), buf),
  backup: (json) => ipcRenderer.invoke('np:backup', String(json)),
  keepAwake: (on) => ipcRenderer.send('np:keep-awake', !!on),
  closeNow: () => ipcRenderer.send('np:close-now'),
  ready: () => ipcRenderer.send('np:ready'),
  getSettings: () => ipcRenderer.invoke('np:get-settings'),
  setSettings: (s) => ipcRenderer.invoke('np:set-settings', {exclusiveAudio: !!(s && s.exclusiveAudio), relaunch: !(s && s.relaunch === false)}),
  onMenu: (fn) => on('np:menu', fn),
  onOpenFile: (fn) => on('np:open-file', fn),
  onWantClose: (fn) => on('np:want-close', () => { ipcRenderer.send('np:close-ack'); fn(); })
});

// the native audio engine: the page's audio graph is mirrored there and runs on the audio interface
contextBridge.exposeInMainWorld('npNative', {
  info: () => ipcRenderer.invoke('np:nat-info'),
  reset: () => ipcRenderer.invoke('np:nat-reset'),
  open: (cfg) => ipcRenderer.invoke('np:nat-open', cfg),
  close: () => ipcRenderer.invoke('np:nat-close'),
  send: (ops) => ipcRenderer.send('np:nat-cmd', ops),
  onPacket: (fn) => on('np:nat-pk', fn)
});
