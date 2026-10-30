// ===== Neon Peach: desktop app glue =====
// Runs only inside the desktop app, where the preload script provides window.npDesktop. In a browser this file does nothing.
(function(){
  const D = window.npDesktop; if(!D) return;
  document.documentElement.classList.add('desktop');
  const whenReady = (fn) => { if(NP.ready){ fn(); return; } const t = setInterval(() => { if(NP.ready){ clearInterval(t); fn(); } }, 400); };
  const needPower = () => { if(NP.ready) return false; toast('Press the power button first.'); return true; };

  // ---- menu commands ----
  const pages = ['chain', 'presets', 'wizard', 'scenes', 'stomp', 'tuner', 'looper', 'drums', 'clone', 'match', 'io', 'outs', 'midi', 'global', 'help'];
  D.onMenu(cmd => {
    if(cmd === 'power'){ const b = document.getElementById('power'); if(b && !NP.ctx) b.click(); return; }
    if(cmd === 'undo' || cmd === 'redo'){ if(isTextField(document.activeElement)){ document.execCommand(cmd); return; } if(needPower()) return; if(cmd === 'undo') undo(); else redo(); return; }
    if(cmd.startsWith('page:')){ const p = cmd.slice(5); if(needPower() || !pages.includes(p)) return; closeModal(); if(UI.stage) closeStage(); go(p); return; }
    if(needPower()) return;
    if(cmd === 'load-clone'){ importCloneFile(); return; }
    if(cmd === 'import'){ closeModal(); go('presets'); const b = document.getElementById('pimport'); if(b) b.click(); return; }
    if(cmd === 'export-all'){ closeModal(); go('presets'); const b = document.getElementById('pexport'); if(b) b.click(); return; }
    if(cmd === 'record'){ toggleRecord(); return; }
    if(cmd === 'mute'){ NP.globals.mute = NP.globals.mute ? 0 : 1; applyGlobals(); renderFoot(); toast(NP.globals.mute ? 'Everything muted' : 'Sound on'); return; }
    if(cmd === 'tuner'){ toggleTuner(); return; }
    if(cmd === 'demo'){ toggleDemo(); if(UI.page === 'io') renderPage(); toast(UI.demoOn ? 'Demo riff playing' : 'Demo riff stopped'); return; }
    if(cmd === 'backup'){ backup(true); return; }
    if(cmd === 'stage'){ if(UI.stage) closeStage(); else openStage(); return; }
    if(cmd === 'drums'){ toggleDrums(); if(UI.stage) renderStage(); return; }
    if(cmd === 'ping'){ closeModal(); go('io'); pingTest(); return; }
  });

  // ---- backups: a copy of every preset and clone in the Neon Peach folder, every few minutes when something changed ----
  let last = '';
  function backup(loud){ if(!NP.ready) return Promise.resolve(); let json; try{ json = fullBackup(); }catch(e){ return Promise.resolve(); }
    if(!loud && json === last) return Promise.resolve();
    return D.backup(json).then(r => { last = json; if(loud && r) toast('Backup saved to ' + r.shown, 3600); }).catch(() => { if(loud) toast('The backup could not be saved.'); }); }
  whenReady(() => { setTimeout(() => backup(false), 20000); setInterval(() => backup(false), 5*60*1000); });

  // ---- closing: save, back up, and don't lose a clone that is still learning ----
  D.onWantClose(() => {
    if(!NP.ready){ D.closeNow(); return; }
    try{ saveState(); }catch(e){}
    backup(false).then(() => {
      if((UI.cl && UI.cl.busy) || cloneRunning()) confirm2('Clone is still working. Quit anyway? This clone will be lost.', () => D.closeNow(), 'Quit');
      else D.closeNow(); }); });

  // ---- a .nam file opened from the computer (double-click, or dropped on the app icon) ----
  D.onOpenFile(f => whenReady(async () => {
    try{ const rec = await addNamClone(f.name.replace(/\.nam$/i, ''), f.text); go('clone'); toast('Loaded ' + rec.name + '. Press Use to add it to the chain.', 3600); }
    catch(e){ toast(e && e.nam ? e.message : 'That file could not be read.', 4200); } }));
  D.ready();
})();
