// ===== Neon Peach UI: Clone page, clone storage, training =====
// A clone is a copy of a pedal or plugin sound. It is either a neural model (NAM format) or an IR.

// ---------- wasm kernels (bytes are embedded by the build) ----------
function b64buf(s){ const b = atob(s), u = new Uint8Array(b.length); for(let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u.buffer; }
const NAM_WASM = b64buf(NAM_WASM_B64), TRAIN_WASM = b64buf(TRAIN_WASM_B64);
const KMOD = {nam: null, train: null};
async function kernels(){ if(!KMOD.nam){ KMOD.nam = await WebAssembly.compile(NAM_WASM); KMOD.train = await WebAssembly.compile(TRAIN_WASM); } return KMOD; }
function simdOK(){ try{ return WebAssembly.validate(new Uint8Array(NAM_WASM)); }catch(e){ return false; } }

// ---------- storage (IndexedDB, with memory as the fallback) ----------
const CDB = { db: null, failed: false,
  open(){ return new Promise(res => { if(CDB.db || CDB.failed || !window.indexedDB){ res(CDB.db); return; }
    let r; try{ r = indexedDB.open('neonpeach', 2); }catch(e){ CDB.failed = true; res(null); return; }
    r.onupgradeneeded = () => { const db = r.result; ['clones', 'takes', 'takeAudio', 'songs', 'songData'].forEach(n => { if(!db.objectStoreNames.contains(n)) db.createObjectStore(n, {keyPath: 'id'}); }); };
    r.onsuccess = () => { CDB.db = r.result; res(CDB.db); }; r.onerror = () => { CDB.failed = true; res(null); }; r.onblocked = () => { CDB.failed = true; res(null); }; }); },
  tx(mode, fn, store){ store = store || 'clones'; return CDB.open().then(db => new Promise((res, rej) => { if(!db){ res(null); return; } const t = db.transaction(store, mode), s = t.objectStore(store); const q = fn(s); t.oncomplete = () => res(q && q.result); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error); })); },
  all(){ return CDB.tx('readonly', s => s.getAll()).then(r => r || []); },
  put(rec){ const clean = Object.assign({}, rec); delete clean._desc; return CDB.tx('readwrite', s => s.put(clean)); },
  del(id){ return CDB.tx('readwrite', s => s.delete(id)); },
  // other stores: recorded takes and practice songs
  allIn(st){ return CDB.tx('readonly', s => s.getAll(), st).then(r => r || []); },
  getIn(st, id){ return CDB.tx('readonly', s => s.get(id), st); },
  putIn(st, rec){ return CDB.tx('readwrite', s => s.put(rec), st); },
  delIn(st, id){ return CDB.tx('readwrite', s => s.delete(id), st); }
};
NP.clones = [];
async function loadClones(){ try{ NP.clones = (await CDB.all()).sort((a, b) => a.made - b.made); }catch(e){ NP.clones = []; } refreshCloneBlocks(); if(UI.page === 'clone') renderPage(); }
function refreshCloneBlocks(){ [...NP.paths.A, ...NP.paths.B].forEach(b => { if(b.type === 'clone' || b.type === 'cab' || b.type === 'cab2') applyBlock(b); }); }
async function saveClone(rec){ const i = NP.clones.findIndex(c => c.id === rec.id); if(i >= 0) NP.clones[i] = rec; else NP.clones.push(rec);
  try{ await CDB.put(rec); }catch(e){ toast('This clone could not be saved in the browser. Export it to keep it.', 4200); }
  refreshCloneBlocks(); }
async function deleteClone(id){ NP.clones = NP.clones.filter(c => c.id !== id); try{ await CDB.del(id); }catch(e){} refreshCloneBlocks(); }
function newCloneId(){ return 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
function cloneDesc(c){ if(!c._desc){ Object.defineProperty(c, '_desc', {value: NAMCore.parse(c.nam), writable: true, enumerable: false, configurable: true}); } return c._desc; }
function cloneKind(c){ return c.kind === 'ir' ? 'IR' : c.from === 'file' ? 'NAM file' : 'Neural'; }
function closeTxt(esr){ return esr == null || !isFinite(esr) ? '' : Math.min(99.99, 100*Math.max(0, 1 - esr)).toFixed(esr < 0.01 ? 2 : 1) + '%'; }

// ---------- the Clone block (engine side) ----------
function cloneIndex(id){ return id ? NP.clones.findIndex(c => c.id === id) : -1; }
function applyClone(b){ const n = b.n, p = b.p;
  const idx = cloneIndex(p.cid), c = idx >= 0 ? NP.clones[idx] : null;
  p.clone = idx + 1;
  const key = c ? c.id : '';
  if(n.loaded !== key) loadCloneInto(b, c);
  // A pedal clone was recorded before the app's input Gain and pad. Undo them going in and add them back coming out,
  // so the copy is driven like the real pedal by your bass, and the rest of the chain still hears your Gain setting.
  const g = NP.globals || {}, trim = c && c.from === 'pedal' ? dB(g.inGain || 0)*(g.pad ? 0.5 : 1) : 1;
  setP(n.inG.gain, dB(p.input + (c && c.inTrim ? c.inTrim : 0))/trim);
  const norm = p.norm && c && c.loudness != null && isFinite(c.loudness) ? dB(Math.max(-24, Math.min(24, -18 - c.loudness))) : 1;
  setP(n.wet.gain, dB(p.level)*norm*trim*p.mix/100); setP(n.dry.gain, 1 - p.mix/100);
  n.hp.frequency.value = p.lowcut; n.lp.frequency.value = p.highcut; }
function loadCloneInto(b, c){ const n = b.n; n.loaded = c ? c.id : ''; n.err = '';
  if(!c){ n.nam.port.postMessage({cmd: 'clear'}); n.cv.buffer = null; setP(n.cvG.gain, 0); setP(n.namG.gain, 1); n.state = ''; return; }
  if(c.kind === 'ir'){
    const sr = NP.ctx.sampleRate, ir = c.sr && c.sr !== sr ? resampleIR(c.ir, c.sr, sr) : c.ir;
    const buf = NP.ctx.createBuffer(1, ir.length, sr); buf.getChannelData(0).set(ir); n.cv.normalize = false; n.cv.buffer = buf;
    n.nam.port.postMessage({cmd: 'clear'}); setP(n.namG.gain, 0); setP(n.cvG.gain, 1); n.state = 'ready'; return; }
  try{ const d = cloneDesc(c); n.cv.buffer = null; setP(n.cvG.gain, 0); setP(n.namG.gain, 1); n.state = 'loading'; n.nam.port.postMessage({cmd: 'model', desc: d, id: c.id}); }
  catch(e){ n.state = 'error'; n.err = e.message; n.nam.port.postMessage({cmd: 'clear'}); } }
function resampleIR(x, from, to){ const n = Math.max(1, Math.round(x.length*to/from)), y = new Float32Array(n), r = from/to, g = from/to;
  for(let i = 0; i < n; i++){ const p = i*r, k = Math.floor(p), f = p - k; y[i] = g*((x[k] || 0)*(1 - f) + (x[k + 1] || 0)*f); } return y; }
window.onCloneState = (b) => { if(UI.page === 'chain' && NP.selected === b.id){ const el = document.getElementById('clstate_' + b.id); if(el) el.innerHTML = cloneStateHTML(b); } };
function cloneStateHTML(b){ const n = b.n, c = NP.clones[cloneIndex(b.p.cid)];
  if(b.p.cid && !c) return `<span class="t-pink">This preset uses a clone that is not on this device.</span>`;
  if(!c) return `<span class="dim">Pick a clone above, or make one on the Clone page.</span>`;
  const bits = [cloneKind(c)]; if(c.esr != null) bits.push(closeTxt(c.esr) + ' close'); if(c.note) bits.push(c.note);
  const sr = c.kind === 'ir' ? null : (cloneDescSafe(c) || {}).sr;
  const warn = sr && sr !== NP.ctx.sampleRate ? ` <span class="t-pink">Made for ${trimNum((sr/1000).toFixed(1))} kHz. It may sound a little off here.</span>` : '';
  const st = n.state === 'loading' ? ' · <span class="t-cyan">warming up…</span>' : n.state === 'error' ? ` · <span class="t-pink">${esc(n.err || 'Could not load')}</span>` : '';
  return `<span class="dim">${esc(bits.join(' · '))}</span>${st}${warn}`; }
function cloneDescSafe(c){ try{ return cloneDesc(c); }catch(e){ return null; } }

// ---------- page state ----------
UI.cl = { mode: 'pedal', sendDb: -12, quality: 1, engine: 'wave', rtDb: null, job: null, test: null, busy: false, pedalUsed: false, setup: false };
const LOOP_KEY = LS + '.loop';   // set when a Clone tone goes out, cleared when you say the pedal loop is unplugged
function loopFlag(on){ UI.cl.pedalUsed = !!on; try{ if(on) localStorage.setItem(LOOP_KEY, '1'); else localStorage.removeItem(LOOP_KEY); }catch(e){} }
try{ UI.cl.pedalUsed = localStorage.getItem(LOOP_KEY) === '1'; }catch(e){}
NP.cloneGuard = UI.cl.pedalUsed ? 1 : 0;   // in force before the input opens
const QUALITY = [ {name: 'Quick', H: 16, arch: 'feather', secs: 60}, {name: 'Good', H: 16, arch: 'feather', secs: 150}, {name: 'Best', H: 20, arch: 'standard', secs: 300} ];
function aperture(cls){ let blades = ''; for(let i = 0; i < 6; i++){ const a = i*Math.PI/3, b = a + Math.PI*0.58, R = 44, r = 15;
    blades += `<path d="M${(50 + R*Math.cos(a)).toFixed(1)} ${(50 + R*Math.sin(a)).toFixed(1)} L${(50 + r*Math.cos(b)).toFixed(1)} ${(50 + r*Math.sin(b)).toFixed(1)}"/>`; }
  return `<svg class="aperture ${cls || ''}" viewBox="0 0 100 100" aria-hidden="true"><circle class="ap-ring" cx="50" cy="50" r="46"/><circle class="ap-ring2" cx="50" cy="50" r="40"/><g class="ap-blades">${blades}</g><circle class="ap-core" cx="50" cy="50" r="7"/></svg>`; }

PAGE_RENDER.clone = () => { const s = UI.cl, j = s.job, busy = j && (j.stage === 'record' || j.stage === 'think' || j.stage === 'train'); if(s.mode === 'pedal') s.setup = true;
  const modes = [['pedal', 'Copy a pedal', 'Play test tones through your pedal and copy what comes back.', 'stomp'], ['plugin', 'Copy a plugin', 'Run a test tone through any plugin in your music app.', 'file'], ['file', 'Load a file', 'Bring in a .nam model or a .wav IR.', 'up']];
  const lead = `<div class="lead cl-lead"><div class="cl-eye ${busy ? 'busy ' + j.stage : ''}">${aperture()}</div><div><h3>Clone</h3><p>Copy the sound of a pedal or a plugin. Then play the copy here, like any other block.</p>${simdOK() ? '' : '<p class="t-pink">This browser is missing a speed feature (WebAssembly SIMD). Clones will be slow here. Use a current Chrome, Edge, Firefox or Safari.</p>'}</div></div>`;
  const pick = `<div class="cl-modes" role="tablist">${modes.map(([k, t, d, ic]) => `<button class="cl-mode ${s.mode === k ? 'on' : ''}" data-cl="mode" data-v="${k}" role="tab" aria-selected="${s.mode === k}" ${j || s.busy ? 'disabled' : ''}>${icon(ic)}<b>${t}</b><span>${d}</span></button>`).join('')}</div>`;
  return lead + pick + (j ? jobHTML(j) : '') + (j ? '' : modeHTML(s.mode)) + libraryHTML(); };

function qualityHTML(){ const e = UI.cl.engine;
  return `<div class="field wide cl-q"><label>How long to learn</label><div class="seg sm">${QUALITY.map((q, i) => `<button class="${UI.cl.quality === i ? 'on' : ''}" data-cl="quality" data-v="${i}">${q.name} · ${q.secs < 120 ? q.secs + ' s' : trimNum((q.secs/60).toFixed(1)) + ' min'}</button>`).join('')}</div></div>
  <div class="field wide cl-q"><label>Model type</label><div class="seg sm"><button class="${e !== 'lstm' ? 'on' : ''}" data-cl="engine" data-v="wave" title="The standard NAM shape. Plays in the NAM plugin and in NAM pedals.">NAM standard</button><button class="${e === 'lstm' ? 'on' : ''}" data-cl="engine" data-v="lstm" title="Learns faster. Plays in the NAM plugin.">Fast LSTM</button></div></div>`; }
function modeHTML(m){ const s = UI.cl;
  if(m === 'pedal'){
    const rt = s.rtDb == null ? 'Not measured. That is fine.' : 'Measured: ' + sgn(s.rtDb, 1) + ' dB';
    const t = s.test;
    return `<div class="steps cl-steps">
      <div class="step"><b>1</b><div><span>Plug the interface <em>output</em> into the pedal <em>input</em>. Plug the pedal <em>output</em> into the interface <em>input</em>.</span>${cableArt()}<span class="dim">Turn your speakers down. The test tone is loud. A re-amp box makes fuzz pedals copy truer.</span><span class="cl-mute">${icon('mute')}Your chain is muted now, so the pedal loop can't squeal.</span></div></div>
      <div class="step"><b>2</b><div><span>Set how hard to hit the pedal. Press <em>Test</em> and watch the light.</span>${field('Send', 'clsend', -36, 0, 0.5, s.sendDb, fmtDb(s.sendDb), false, true)}
        <div class="row wrap"><button class="sm" data-cl="test" ${s.busy ? 'disabled' : ''}>${icon('play')}Test</button><span class="cl-meter ${t ? t.cls : ''}" id="cltest"><i></i>${t ? esc(t.msg) : 'Return level shows here'}</span></div>
        <span class="dim">Aim for a strong return with no clipping. Bass players: set it close to how hard your bass hits the pedal.</span></div></div>
      <div class="step"><b>3</b><div><span>Optional: measure your interface. Patch the output straight to the input with no pedal, then press <em>Measure</em>.</span><div class="row wrap"><button class="sm" data-cl="measure" ${s.busy ? 'disabled' : ''}>${icon('wave')}Measure</button><span class="stat" id="clrt">${rt}</span></div><span class="dim">This makes the copy react to your bass the same way the pedal does.</span></div></div>
    </div>
    <section class="pane cl-go">${qualityHTML()}<div class="row wrap"><input id="clname" value="${esc(s.name || 'My Pedal')}" maxlength="40" aria-label="Clone name" placeholder="Name"><button class="primary big" data-cl="go" ${s.busy ? 'disabled' : ''}>${icon('lens')}Clone it</button><span class="stat">Recording takes about a minute. Then Neon Peach learns the sound.</span></div>
    <p class="hint">Works best on drives, fuzz, boosts, compressors, EQs, preamps and cabs. Moving sounds like chorus, phaser and tremolo change over time, so they do not copy well.</p></section>`; }
  if(m === 'plugin'){
    return `<div class="steps cl-steps">
      <div class="step"><b>1</b><div><span>Get the test tone. It is a ${Math.round(Cloner.TONE_SECS)} second WAV file at 48 kHz.</span><button class="sm" data-cl="tone">${icon('down')}Download test tone</button></div></div>
      <div class="step"><b>2</b><div><span>In your music app, put the tone on a track with only your plugin on it. Export the track at <em>48 kHz</em>. Start the export at the very start of the tone.</span><span class="dim">Turn off anything on the master bus.</span></div></div>
      <div class="step"><b>3</b><div><span>Bring the result back here with <em>Upload result</em>. Neon Peach lines it up and learns the sound.</span><span class="dim">Plugins that only change the tone (EQ, cab, reverb) become an IR right away.</span></div></div>
    </div>
    <section class="pane cl-go">${qualityHTML()}<div class="row wrap"><input id="clname" value="${esc(s.name || 'My Plugin')}" maxlength="40" aria-label="Clone name" placeholder="Name"><button class="primary big" data-cl="upload">${icon('up')}Upload result</button><span class="stat">A WAV or FLAC file, with the whole tone in it.</span></div></section>`; }
  return `<section class="pane cl-load"><div class="row wrap"><button class="primary" data-cl="import">${icon('up')}Load .nam or .wav</button><span class="stat">Neural Amp Modeler files (.nam) and impulse responses (.wav) both work.</span></div>
    <p class="hint" style="margin-top:12px">Neon Peach plays WaveNet, LSTM and ConvNet models, the A2 and slim kinds too. Big models use more of your computer. If the sound crackles, pick a lighter model.</p></section>`; }

function cableArt(){ return `<svg class="cl-cable" viewBox="0 0 280 86" aria-hidden="true">
  <rect class="cc-box" x="4" y="12" width="84" height="52" rx="9"/><text x="46" y="31">Interface</text><text class="cc-l" x="74" y="47">out</text><text class="cc-l" x="74" y="59">in</text>
  <rect class="cc-ped" x="176" y="12" width="68" height="52" rx="10"/><text x="210" y="43">Pedal</text><text class="cc-l" x="188" y="28">in</text><text class="cc-l" x="232" y="28">out</text>
  <path class="cc-out" d="M88 44 C130 44 140 22 176 22"/><path class="cc-in" d="M244 22 C276 22 276 80 210 80 C140 80 120 56 88 56"/>
  <circle class="cc-j" cx="88" cy="44" r="3"/><circle class="cc-j" cx="88" cy="56" r="3"/><circle class="cc-j" cx="176" cy="22" r="3"/><circle class="cc-j" cx="244" cy="22" r="3"/></svg>`; }

function jobHTML(j){
  const pct = Math.max(0, Math.min(100, j.pct || 0));
  if(j.stage === 'error') return `<section class="pane cl-job err"><h4 class="pane-h">Clone stopped</h4><p id="clmsg">${esc(j.msg)}</p><div class="row wrap"><button class="sm" data-cl="dismiss">OK</button></div></section>`;
  if(j.stage === 'done'){ const c = NP.clones.find(x => x.id === j.id);
    return `<section class="pane cl-job done"><div class="cl-done"><div class="cl-score"><b>${closeTxt(j.esr) || '—'}</b><span>how close</span></div><div class="cl-done-r">
      <h4 class="pane-h">${esc(c ? c.name : 'Clone')} is ready<em>${esc(j.kindTxt || '')}</em></h4><p class="dim">${esc(j.msg || '')}</p>${UI.cl.pedalUsed ? `<span class="cl-mute">${icon('mute')}Your chain stays muted while the pedal is patched in.</span>` : ''}
      <div class="row wrap">${j.ab ? `<button class="sm ${UI.clPlay === 'real' ? 'on' : ''}" data-cl="hear" data-v="real">${icon('play')}Hear the real one</button><button class="sm ${UI.clPlay === 'copy' ? 'on' : ''}" data-cl="hear" data-v="copy">${icon('play')}Hear the copy</button>${UI.clPlay ? `<button class="sm" data-cl="hear" data-v="">${icon('stop')}Stop</button>` : ''}` : ''}</div>
      <div class="row wrap"><button class="primary" data-cl="use" data-id="${j.id}">${icon('plus')}Use it in the chain</button><button class="sm" data-cl="dismiss">Clone another</button></div></div></div></section>`; }
  const head = j.stage === 'record' ? 'Listening to your pedal' : j.stage === 'think' ? 'Lining it up' : 'Learning the sound';
  const stop = j.stage === 'train' ? `<button class="sm" data-cl="stop">${icon('stop')}Stop now and keep the best</button>` : j.stage === 'record' ? `<button class="sm" data-cl="cancel">${icon('x')}Cancel</button>` : '';
  return `<section class="pane cl-job run"><h4 class="pane-h">${head}<em id="clpct">${Math.round(pct)}%</em></h4><div class="cl-bar"><i id="clbar" style="width:${pct.toFixed(1)}%"></i></div>
    <div class="row wrap cl-live"><span id="clmsg">${esc(j.msg || '')}</span><span class="cl-close" id="clclose">${j.esr != null ? 'How close: <b>' + closeTxt(j.esr) + '</b>' : ''}</span>${stop}</div></section>`; }

function libraryHTML(){ const list = NP.clones.slice().reverse();
  const rows = list.length ? list.map(c => { const d = c.kind === 'ir' ? null : cloneDescSafe(c), heavy = d && d.macs > 15000;
    return `<div class="list-row cl-row"><span class="cl-nm"><b>${esc(c.name)}</b><em>${esc(cloneKind(c))}${c.esr != null ? ' · ' + closeTxt(c.esr) + ' close' : ''}${c.note ? ' · ' + esc(c.note) : ''}${heavy ? ' · heavy' : ''}</em></span>
      <button class="xs" data-cl="use" data-id="${c.id}" title="Add to the chain">${icon('plus')}Use</button><button class="xs" data-cl="rename" data-id="${c.id}">Rename</button><button class="xs" data-cl="export" data-id="${c.id}" title="Save as a file">${icon('down')}Export</button><button class="xs danger ib" data-cl="del" data-id="${c.id}" title="Delete" aria-label="Delete ${esc(c.name)}">${icon('trash')}</button></div>`; }).join('')
    : '<p class="dim">No clones yet. Copy a pedal or a plugin, or load a file.</p>';
  const old = NP.captures.length ? `<section class="pane"><h4 class="pane-h">Older captures<em>Made with the old capture tool</em></h4>${NP.captures.map((c, i) => `<div class="list-row"><span>${esc(c.name)}</span><button class="xs" data-capir="${i}">${icon('cab')}Use IR in cabs</button><button class="xs danger ib" data-capdel="${i}" title="Delete" aria-label="Delete ${esc(c.name)}">${icon('trash')}</button></div>`).join('')}</section>` : '';
  const irs = NP.irs.length ? `<section class="pane"><h4 class="pane-h">Your cab IRs</h4>${NP.irs.map((c, i) => `<div class="list-row"><span>${esc(c.name)}</span><button class="xs danger ib" data-irdel="${i}" title="Delete" aria-label="Delete ${esc(c.name)}">${icon('trash')}</button></div>`).join('')}</section>` : '';
  return `<section class="pane cl-lib"><h4 class="pane-h">Your clones<em>${CDB.failed ? 'Not saved here. Export to keep them.' : IS_APP ? 'Saved on this computer' : 'Kept in this browser'}</em></h4>${rows}</section>${old || irs ? `<div class="grid2">${old}${irs}</div>` : ''}`; }

// live progress without a full re-render
function jobUpdate(){ const j = UI.cl.job; if(!j) return;
  const st = document.getElementById('stclone'); if(st) st.querySelector('span').textContent = cloneChipText();
  if(UI.page !== 'clone') return;
  const bar = document.getElementById('clbar'); if(!bar){ renderPage(); return; }
  bar.style.width = j.pct.toFixed(1) + '%'; document.getElementById('clpct').textContent = Math.round(j.pct) + '%';
  document.getElementById('clmsg').textContent = j.msg || '';
  document.getElementById('clclose').innerHTML = j.esr != null ? 'How close: <b>' + closeTxt(j.esr) + '</b>' : ''; }
function setJob(j){ UI.cl.job = j; cloneGuardSync(); renderTop(); if(UI.page === 'clone') renderPage(); if(window.npDesktop) npDesktop.keepAwake(cloneRunning()); }
function cloneRunning(){ const j = UI.cl && UI.cl.job; return !!(j && /record|think|train/.test(j.stage)); }
function cloneChipText(){ const j = UI.cl.job; return cloneRunning() ? (j.stage === 'train' ? 'Cloning ' + Math.round(j.pct) + '%' : j.stage === 'record' ? 'Recording' : 'Cloning') : 'Chain muted'; }
function cloneChip(){ const run = cloneRunning(), g = NP.cloneGuard | 0; if(!run && !g) return '';
  const tip = run ? 'Clone is working. Open the Clone page to see it.' : 'The chain is muted because a pedal may be patched in for Clone. Press to turn it back on.';
  return `<button class="st-clone${g ? ' muted' : ''}" id="stclone" ${run ? 'data-page="clone"' : 'data-cl="unmute"'} title="${tip}">${icon(run ? 'lens' : 'mute', run ? '' : 'still')}<span>${cloneChipText()}</span>${run && g ? icon('mute', 'still') : ''}</button>`; }

// ---------- the guard: a pedal patched in for Clone must not feed back ----------
// The pedal sits in a loop: interface out -> pedal -> interface in. If the chain plays the input back out, the loop squeals.
// 2 = a Clone tone is playing (test, measure, the take). 1 = chain muted. 0 = normal.
function cloneGuardWanted(){ const s = UI.cl, j = s.job;
  if(s.busy) return 2;
  if(s.pedalUsed) return 1;   // a tone went into a pedal (this visit or before a reload): muted until you say the loop is unplugged
  if(UI.page === 'clone' && s.mode === 'pedal') return 1;                 // setting up: the loop may be patched in already
  if(s.setup && (UI.page === 'io' || UI.page === 'help')) return 1;       // still setting up: picking the interface, reading help
  return 0; }
function cloneGuardSync(){ const s = UI.cl, was = NP.cloneGuard | 0; if(!['clone', 'io', 'outs', 'help'].includes(UI.page)) s.setup = false;
  const g = cloneGuardWanted(); NP.cloneGuard = g; applyGlobals(); if(was !== g) renderTop(); }
// Before the chain plays again after a pedal take, ask for the loop to be unplugged.
function afterPedal(fn){ const s = UI.cl; if(s.busy){ captureBusy(); return; } if(!s.pedalUsed && !s.setup){ fn(); return; }
  openModal(`<h3>Unplug the pedal loop first</h3><p class="dim" style="margin:6px 0 14px">Take the cables out of the interface output and input. Plug your bass back in. Then the chain turns back on.</p><div class="row wrap"><button class="primary" id="cok">${icon('plug')}Done, turn the chain on</button><button id="cno">Cancel</button></div>`,
    () => { $('#cok').onclick = () => { closeModal(); if(s.busy){ captureBusy(); return; } loopFlag(false); s.setup = false; cloneGuardSync(); fn(); }; $('#cno').onclick = closeModal; }); }
function captureBusy(){ if(UI.cl && UI.cl.busy){ toast('Clone is playing its test tone. Wait for it to end.', 2600); return true; } return false; }
function busyButtons(){ const s = UI.cl; $$('[data-cl="test"],[data-cl="measure"],[data-cl="go"],[data-cl="mode"],[data-cl="use"]').forEach(b => { b.disabled = !!s.busy || (b.dataset.cl === 'mode' && !!s.job); }); }
// Every Clone tone goes through here: the chain stays muted, presets and the tuner wait, and only one tone plays at a time.
async function captureRun(signal, extra, onTick){ const s = UI.cl; s.busy = true; loopFlag(true);
  if(UI.demoOn) toggleDemo(); if(UI.btPlaying) toggleBacking(); stopPreview(); cloneGuardSync(); busyButtons();
  try{ return await playRecord(signal, extra, onTick); } finally { s.busy = false; cloneGuardSync(); busyButtons(); } }

// ---------- audio helpers ----------
// Play a mono signal straight out while recording the raw mono input (the jack picked on the I/O page, before the input gain).
// The tap sits on the input stage, which rewiring the chain never touches. Resolves with the take, or null if cancelled.
// A take shorter than asked for means the audio stalled; the caller checks the length.
function playRecord(signal, extra, onTick){ return new Promise(res => { const ctx = NP.ctx, r = NP.rig;
  const buf = ctx.createBuffer(1, signal.length, ctx.sampleRate); buf.getChannelData(0).set(signal);
  const s = ctx.createBufferSource(); s.buffer = buf; s.connect(r.outGain);
  const rec = new AudioWorkletNode(ctx, 'np-recorder', {channelCount: 1, channelCountMode: 'explicit'}); r.inMono.connect(rec);
  let done = false, settled = false, cancelled = false, timer = null;
  const settle = v => { if(settled) return; settled = true; try{ r.inMono.disconnect(rec); }catch(err){} rec.port.postMessage({cmd: 'kill'}); res(cancelled ? null : v); };
  const finish = () => { if(done) return; done = true; clearInterval(timer); playRecord.cancel = null; try{ s.stop(); }catch(e){} try{ s.disconnect(); }catch(e){}
    rec.port.postMessage({cmd: 'stop'}); setTimeout(() => settle(new Float32Array(0)), 4000); };   // no answer from the audio thread: treat it as an empty take
  rec.port.onmessage = (e) => { if(e.data && e.data.done) settle(e.data.L); };
  const dur = signal.length/ctx.sampleRate, t0 = ctx.currentTime + 0.15, w0 = performance.now();
  rec.port.postMessage({cmd: 'start'}); s.start(t0);
  timer = setInterval(() => { const left = t0 + dur + extra - ctx.currentTime; if(onTick) onTick(Math.max(0, left), dur + extra);
    if(left <= 0 || performance.now() - w0 > (dur + extra + 0.15)*1000 + 5000) finish(); }, 200);   // the wall clock is the backstop if the audio clock stalls
  playRecord.cancel = () => { cancelled = true; finish(); }; }); }
// The A/B preview. It follows the master volume (never louder than 0 dB) and the mute, and goes through the limiter.
function playBuffer(x, sr, loop){ stopPreview(); const ctx = NP.ctx, r = NP.rig, b = ctx.createBuffer(1, x.length, sr || ctx.sampleRate); b.getChannelData(0).set(x);
  const s = ctx.createBufferSource(); s.buffer = b; s.loop = !!loop; const g = ctx.createGain(); g.gain.value = 0.9*dB(Math.min(0, NP.globals.master));
  s.connect(g).connect(r.lim); s.start(); UI.clSrc = s; UI.clSrcG = g;
  s.onended = () => { if(UI.clSrc === s){ stopPreview(); if(UI.page === 'clone') renderPage(); } }; }
function stopPreview(){ const s = UI.clSrc, g = UI.clSrcG; UI.clSrc = null; UI.clSrcG = null; UI.clPlay = null; if(s){ try{ s.stop(); }catch(e){} } if(g){ try{ g.disconnect(); }catch(e){} } }

// ---------- send test and interface measure ----------
async function sendTest(){ if(UI.cl.busy || cloneRunning()) return; if(!UI.inputOk){ toast('No input is open. Pick your interface on the I/O page.', 3200); return; }
  const sr = NP.ctx.sampleRate, x = Cloner.content(sr, Math.round(sr*2.5), 4242), g = dB(UI.cl.sendDb); for(let i = 0; i < x.length; i++) x[i] *= g;
  UI.cl.test = {cls: 'run', msg: 'Playing…'}; const el = $('#cltest'); if(el){ el.className = 'cl-meter run'; el.lastChild.textContent = 'Playing…'; }
  const rec = await captureRun(x, 0.4);
  let pk = 0; if(rec) for(const v of rec) pk = Math.max(pk, Math.abs(v)); const db = 20*Math.log10(pk + 1e-9);
  UI.cl.test = pk < 1e-3 ? {cls: 'bad', msg: 'Nothing came back. Check the cables and the input on the I/O page.'} : pk > 0.98 ? {cls: 'bad', msg: 'Clipping at ' + db.toFixed(1) + ' dB. Turn the send down, or the input knob on your interface.'} : db < -30 ? {cls: 'low', msg: 'Very quiet: ' + db.toFixed(1) + ' dB. Turn the send up, or the input knob on your interface.'} : {cls: 'ok', msg: 'Good: return peaks at ' + db.toFixed(1) + ' dB.'};
  if(UI.page === 'clone') renderPage(); }
async function measureInterface(){ if(UI.cl.busy || cloneRunning()) return; if(!UI.inputOk){ toast('No input is open. Pick your interface on the I/O page.', 3200); return; }
  const sr = NP.ctx.sampleRate, n = Math.round(sr*1.5), x = new Float32Array(n); for(let i = 0; i < n; i++) x[i] = 0.25*Math.sin(2*Math.PI*220*i/sr)*Math.min(1, i/2000, (n - i)/2000);
  const el = $('#clrt'); if(el) el.textContent = 'Measuring…'; const rec = await captureRun(x, 0.4);
  let pk = 0; if(rec) for(const v of rec) pk = Math.max(pk, Math.abs(v));
  if(pk < 1e-3){ if(el) el.textContent = 'Nothing came back. Patch output to input and try again.'; return; }
  if(pk > 0.98){ if(el) el.textContent = 'Clipping. Turn down the input knob on your interface and try again.'; return; }
  UI.cl.rtDb = 20*Math.log10(pk/0.25); if(UI.page === 'clone') renderPage(); }

// ---------- the clone job ----------
async function startLive(){ if(UI.cl.busy || cloneRunning()) return;
  if(!UI.inputOk){ toast('No input is open. Pick your interface on the I/O page.', 3200); return; }
  const name = (($('#clname') || {}).value || '').trim() || 'My Pedal'; UI.cl.name = name;
  const sr = NP.ctx.sampleRate, tone = Cloner.makeTone(sr), sent = Cloner.scaleTone(tone, dB(UI.cl.sendDb));
  const job = {stage: 'record', pct: 0, msg: 'Starting…', from: 'pedal', name}; setJob(job);
  const rec = await captureRun(sent.x, 1.0, (left, total) => { job.pct = 100*(1 - left/total); job.msg = Math.ceil(left) + ' s left. Keep it quiet.'; jobUpdate(); });
  if(!rec){ setJob(null); toast('Clone cancelled'); return; }
  if(rec.length < sent.x.length + Math.round(sr*0.5)){ setJob({stage: 'error', from: 'pedal', msg: 'The recording was cut short. The audio stopped for a moment. Keep this tab open and in front until the tone ends, then try again.'}); return; }
  await finishJob(job, sent, rec, {inTrim: UI.cl.rtDb == null ? 0 : -UI.cl.rtDb}); }
async function startUpload(){ if(UI.cl.busy || cloneRunning()) return; const f = await pickFile('.wav,.flac,audio/wav,audio/x-wav,audio/flac'); if(!f) return;
  if(/\.(aif|aiff|aifc)$/i.test(f.name)){ setJob({stage: 'error', from: 'plugin', msg: 'AIFF files do not open in most browsers. Export the track as a WAV file instead.'}); return; }
  const name = (($('#clname') || {}).value || '').trim() || f.name.replace(/\.[^.]+$/, ''); UI.cl.name = name;
  const job = {stage: 'think', pct: 0, msg: 'Reading the file…', from: 'plugin', name}; setJob(job);
  try{
    const data = await f.arrayBuffer(), sr = 48000;
    const oc = new (window.OfflineAudioContext || window.webkitOfflineAudioContext)(1, sr, sr);
    let buf; try{ buf = await oc.decodeAudioData(data); }catch(e){ throw new Error('This file could not be read. Export the track as a 48 kHz WAV file and try again.'); }
    const tone = Cloner.makeTone(sr);
    if(buf.length < tone.x.length*0.9) throw new Error('This file is too short. Export the whole test tone, from start to end.');
    const pad = sr, rec = new Float32Array(buf.length + pad);   // a second of room in case the export started late
    for(let c = 0; c < buf.numberOfChannels; c++){ const d = buf.getChannelData(c); for(let i = 0; i < d.length; i++) rec[pad + i] += d[i]/buf.numberOfChannels; }
    await finishJob(job, tone, rec, {inTrim: 0, maxLat: Math.round(sr*3)});
  }catch(e){ setJob({stage: 'error', from: 'plugin', msg: e.message || 'That file could not be read.'}); } }

async function finishJob(job, tone, rec, opt){
  job.stage = 'think'; job.pct = 100; job.msg = 'Lining up the recording…'; setJob(job);
  await new Promise(r => setTimeout(r, 30));
  const a = Cloner.analyze(tone, rec, opt.maxLat ? {maxLat: opt.maxLat} : undefined), recUse = rec;
  if(a.problems.includes('silent')){ setJob({stage: 'error', from: job.from, msg: job.from === 'pedal' ? 'Nothing came back from the pedal. Check the cables, the pedal power, and the input on the I/O page.' : 'The file is silent.'}); return; }
  if(a.problems.includes('noalign')){ setJob({stage: 'error', from: job.from, msg: 'The recording could not be lined up with the test tone. ' + (job.from === 'pedal' ? 'Check the cables and try a stronger send level.' : 'Export the whole tone at 48 kHz, starting at the very start.')}); return; }
  if(a.problems.includes('slip')){ const ms = a.slip == null ? 0 : Math.abs(a.slip)/tone.sr*1000;
    setJob({stage: 'error', from: job.from, msg: job.from === 'pedal' ? 'The timing slipped during the recording' + (ms ? ' (by ' + (ms < 10 ? ms.toFixed(1) : Math.round(ms)) + ' ms)' : '') + '. That happens when the computer gets busy, or when the input and output are two different devices. Close other apps and tabs, then try again. A bigger buffer size on your interface helps too. Pedals with vibrato or other moving sounds can cause this as well.' : 'The file does not line up with the test tone from start to end. Export at 48 kHz, and do not stretch, cut or trim the tone.'}); return; }
  if(a.problems.includes('short')){ setJob({stage: 'error', from: job.from, msg: job.from === 'pedal' ? 'The recording stopped before the tone ended. Try again.' : 'This file stops before the end of the test tone. Export the whole tone, from the very start to the very end.'}); return; }
  const drift = a.problems.includes('drift') ? ' The timing moved a little during the take (' + (Math.abs(a.slip)/tone.sr*1000).toFixed(2) + ' ms). If the copy sounds off, close other apps and try again.' : '';
  const warn = (a.problems.includes('clipping') ? ' The return clipped a little. A lower send level may sound better.' : '') + drift;
  const base = {id: newCloneId(), name: job.name, made: Date.now(), from: job.from, inTrim: opt.inTrim || 0};
  if(a.isLinear){
    const rec2 = Object.assign(base, {kind: 'ir', ir: a.ir, sr: tone.sr, esr: a.linearEsr, note: (a.ir.length/tone.sr*1000).toFixed(0) + ' ms IR'});
    await saveClone(rec2);
    const s = Cloner.slices(tone, recUse, a.latency), copy = Cloner.convolve(s.xV, a.ir).subarray(0, s.xV.length);
    setJob({stage: 'done', from: job.from, id: rec2.id, esr: a.linearEsr, kindTxt: 'Saved as an IR', msg: 'This sound is a filter (EQ, cab or reverb), so it was saved as an impulse response. It copies it exactly.' + warn, ab: {real: s.yV, copy, sr: tone.sr}});
    return; }
  // train a neural model
  const s = Cloner.slices(tone, recUse, a.latency);
  let ys = 0; for(const v of s.yT) ys += v*v; ys = Math.sqrt(ys/s.yT.length) || 1;
  const yT = Float32Array.from(s.yT, v => v/ys), yV = Float32Array.from(s.yV, v => v/ys), en = Cloner.energies(yT);
  const wave = UI.cl.engine !== 'lstm', q = QUALITY[UI.cl.quality] || QUALITY[1];
  const spec = wave ? {kind: 'wave', cfg: Cloner.waveConfig(q.arch), T: 8192} : {kind: 'lstm', H: q.H, warm: 512, Tg: 1024};
  let stop = false; job.stop = () => { stop = true; };   // ready before the Stop button shows
  job.stage = 'train'; job.pct = 0; job.msg = 'Starting the learners…'; job.esr = null; setJob(job);
  let engines;
  try{ engines = await makeEngines(spec, s, yT, yV, en); }catch(e){ setJob({stage: 'error', from: job.from, msg: 'Training could not start here: ' + e.message}); return; }
  if(stop){ engines.close(); setJob(null); toast('Stopped before it learned anything. Nothing was saved.', 3600); return; }
  try{
    // time a few steps to fit the time budget
    const P0 = wave ? Cloner.waveInit(spec.cfg, 7) : Cloner.initParams(spec.H, 7), t0 = performance.now();
    for(let i = 0; i < 2; i++) await Promise.all(engines.list.map(e => e.step(P0)));
    const per = (performance.now() - t0)/2000, steps = Math.max(40, Math.round(q.secs/Math.max(0.004, per)));
    const t1 = performance.now();
    const out = await Cloner.train({H: spec.H, init: P0, steps, lr0: wave ? 1e-2 : 2e-2, lr1: wave ? 8e-4 : 1.3e-3, clip: 1, valEvery: Math.max(10, Math.round(steps/25)), engines: engines.list, cancelled: () => stop,
      progress: p => { job.pct = 100*p.step/p.steps; if(p.esr != null) job.esr = p.best; const left = (performance.now() - t1)/1000/p.step*(p.steps - p.step);
        job.msg = 'Step ' + p.step + ' of ' + p.steps + ' · about ' + fmtLeft(left) + ' left'; jobUpdate(); }});
    if(stop && out.step < 20){ engines.close(); setJob(null); toast('Stopped before it learned anything. Nothing was saved.', 3600); return; }
    let esr = out.esr, P = out.P;
    if(!isFinite(esr)) esr = await engines.list[0].val(P);
    engines.close();
    const info = {name: job.name, sr: tone.sr, esr, arch: wave ? q.arch : 'lstm', gearType: job.from === 'pedal' ? 'pedal' : null};
    const file = wave ? Cloner.waveFile(spec.cfg, Cloner.waveScaleOut(spec.cfg, P, ys), info) : NAMCore.lstmFile(Cloner.toNet(P, spec.H, ys), info);
    // play it back on the real-time kernel for the A/B and the loudness
    const km = await kernels(), d = NAMCore.parse(file), pl = NAMCore.build(d, await NAMCore.instantiateAsync(km.nam));
    const copy = NAMCore.render(pl, s.xValCtx).subarray(4096); let e2 = 0; for(const v of copy) e2 += v*v; const loud = 10*Math.log10(e2/copy.length + 1e-12);
    esr = Cloner.esr(copy, s.yV);   // the score on the whole 10 second check
    file.metadata.loudness = loud; file.metadata.training.validation_esr = esr;
    const note = wave ? 'NAM ' + q.arch : 'LSTM ' + spec.H;
    const rec2 = Object.assign(base, {kind: 'nam', nam: JSON.stringify(file), esr, loudness: loud, note});
    await saveClone(rec2);
    const tip = stop && esr > 0.03 ? ' It stopped early, so the copy is rough. Let it learn longer next time.' : esr > 0.15 ? ' This sound is hard to copy. If it moves over time (chorus, phaser, tremolo) it will not copy well.' : esr > 0.05 ? (wave ? ' Good, not perfect. Try "Best". For compressors, try the Fast LSTM type.' : ' Good, not perfect. Try "Best" for a closer copy.') : '';
    const where = wave ? 'Export it as a .nam file to play it in the NAM plugin or a NAM pedal.' : 'Export it as a .nam file to play it in the NAM plugin.';
    setJob({stage: 'done', from: job.from, id: rec2.id, esr, kindTxt: wave ? 'NAM ' + q.arch + ' model' : 'LSTM model', msg: 'Saved. ' + where + tip + warn, ab: {real: s.yV, copy, sr: tone.sr}});
  }catch(e){ engines && engines.close(); setJob({stage: 'error', from: job.from, msg: 'Training stopped: ' + (e.message || e)}); } }
function tone48(s){ return s.sr || 48000; }
function fmtLeft(s){ s = Math.max(0, Math.round(s)); return s >= 60 ? Math.floor(s/60) + ':' + String(s % 60).padStart(2, '0') : s + ' s'; }

// Training workers, one per spare core. Falls back to the page if workers cannot start.
async function makeEngines(spec, s, yT, yV, en){
  const cores = navigator.hardwareConcurrency || 2, n = Math.max(1, Math.min(8, cores - (cores >= 4 ? 2 : 1))), km = await kernels(), src = $('#clone-worker-src').textContent;   // leave room for the audio
  const base = Object.assign({cmd: 'init', wasm: spec.kind === 'wave' ? NAM_WASM : TRAIN_WASM, xT: s.xT, yT, Ep: en.Ep, Er: en.Er}, spec);
  const vn = Math.min(yV.length, Math.round(tone48(s)*5)), valData = {xV: s.xValCtx.subarray(0, 4096 + vn), yV: yV.subarray(0, vn), ctx: 4096};   // quick checks use 5 s; the final score uses all 10
  const mk = () => { try{ return new Worker(URL.createObjectURL(new Blob([src], {type: 'application/javascript'}))); }catch(e){}
    try{ return new Worker('data:application/javascript;base64,' + btoa(unescape(encodeURIComponent(src)))); }catch(e){} return null; };
  const rpc = (w) => { let id = 0; const wait = new Map();
    w.onmessage = e => { const m = e.data, f = wait.get(m.id); if(!f) return; wait.delete(m.id); if(m.error) f.rej(new Error(m.error)); else f.res(m); };
    w.onerror = e => { e.preventDefault && e.preventDefault(); for(const f of wait.values()) f.rej(new Error('a training worker failed')); wait.clear(); };
    return (msg, tr) => new Promise((res, rej) => { const i = ++id; wait.set(i, {res, rej}); w.postMessage(Object.assign({id: i}, msg), tr || []); }); };
  const workers = [];
  try{
    if(UI.cl.noWorkers) throw new Error('workers off');
    for(let i = 0; i < n; i++){ const w = mk(); if(!w) throw new Error('no workers'); workers.push(w); }
    const calls = workers.map(rpc);
    await Promise.race([Promise.all(calls.map((call, i) => call(Object.assign({}, base, {seed: i + 1}, i === 0 ? valData : {})))),
      new Promise((_, rej) => setTimeout(() => rej(new Error('workers did not start')), 10000))]);
    return {workers: n, list: calls.map((call, i) => ({step: P => call({cmd: 'step', P}).then(m => ({loss: m.loss, grad: m.grad})), val: i === 0 ? (P => call({cmd: 'val', P}).then(m => m.esr)) : null})),
      close(){ workers.forEach(w => w.terminate()); }};
  }catch(e){
    workers.forEach(w => w.terminate());
    // on the page: slower, but it works
    const mod = spec.kind === 'wave' ? km.nam : km.train, inst = await WebAssembly.instantiate(mod, {}), valInst = await WebAssembly.instantiate(km.nam, {});
    const L = Cloner.makeLearner(Object.assign({}, base, {mod, inst, valInst, seed: 1}, valData));
    const pause = () => new Promise(r => setTimeout(r, 0));
    return {workers: 0, list: [{step: async P => { await pause(); return L.step(P); }, val: async P => { await pause(); return L.val(P); }}], close(){}};
  } }

// ---------- backups: clones ride along with "Export all" presets ----------
function clonesForBackup(){ return NP.clones.map(c => { const o = Object.assign({}, c); delete o.heavy; if(c.ir) o.ir = Array.from(c.ir); return o; }); }
async function restoreClones(list){ let n = 0; if(!Array.isArray(list)) return 0;
  for(const c of list){ if(!c || !c.id || NP.clones.some(x => x.id === c.id)) continue;
    try{ const rec = Object.assign({}, c); if(rec.kind === 'ir'){ rec.ir = Float32Array.from(rec.ir || []); if(!rec.ir.length) continue; } else NAMCore.parse(rec.nam);
      await saveClone(rec); n++; }catch(e){} }
  return n; }

// ---------- import, export, use ----------
async function addIrClone(name, ir, sr, note){ const rec = {id: newCloneId(), name, kind: 'ir', ir, sr, made: Date.now(), from: 'file', esr: null, note: note || (ir.length/sr*1000).toFixed(0) + ' ms IR'}; await saveClone(rec); return rec; }
async function addNamClone(name, txt){ const d = NAMCore.parse(txt);
  if(d.arch === 'Linear') return addIrClone(name, Float32Array.from(d.w.subarray(0, d.cfg.rf)), d.sr || NP.ctx.sampleRate, d.cfg.rf + ' tap IR');
  const meta = d.meta || {}, ve = meta.training && meta.training.validation_esr;
  const rec = {id: newCloneId(), name: (typeof meta.name === 'string' && meta.name.trim()) || name, kind: 'nam', nam: txt, made: Date.now(), from: 'file', esr: typeof ve === 'number' ? ve : null,
    loudness: typeof meta.loudness === 'number' ? meta.loudness : null, note: NAMCore.describe(d)};
  await saveClone(rec); rec.heavy = d.macs > 15000; return rec; }
async function importCloneFile(){ const f = await pickFile('.nam,.json,.wav,audio/wav'); if(!f) return;
  const name = f.name.replace(/\.[^.]+$/, '');
  try{
    if(/\.wav$/i.test(f.name) || /audio/.test(f.type)){
      const buf = await NP.ctx.decodeAudioData(await f.arrayBuffer()), sr = NP.ctx.sampleRate, n = Math.min(buf.length, sr*10);
      await addIrClone(name, Float32Array.from(buf.getChannelData(0).subarray(0, n)), sr); toast('Loaded IR: ' + name); }
    else { const rec = await addNamClone(name, await f.text());
      if(rec.heavy) toast('Loaded. This is a heavy model. If the sound crackles, pick a lighter one.', 4200); else toast('Loaded: ' + rec.name); }
    if(UI.page === 'clone') renderPage();
  }catch(e){ toast(e.nam ? e.message : 'That file could not be read.', 4200); } }
function exportClone(c){ const safe = c.name.replace(/[^\w\- ]+/g, '_').trim() || 'clone';
  if(c.kind === 'ir'){ download(new Blob([Cloner.wavF32(c.ir, c.sr || NP.ctx.sampleRate)], {type: 'audio/wav'}), safe + '.wav', 'Clones'); toast('Exported ' + safe + '.wav'); return; }
  download(new Blob([c.nam], {type: 'application/json'}), safe + '.nam', 'Clones'); toast('Exported ' + safe + '.nam'); }
function useClone(id){ stopPreview(); const c = NP.clones.find(x => x.id === id); if(!c){ toast('That clone is gone.'); if(UI.page === 'clone') renderPage(); return; } if(totalBlocks() >= MAX_BLOCKS){ toast('24 blocks is the limit. Delete one first.'); return; }
  // your own clones keep the real level; loaded files are evened out like the NAM plugin does
  const b = createBlock('clone', {cid: id, norm: c.from === 'file' && c.loudness != null ? 1 : 0}); const L = NP.paths.A; let at = L.length; const li = L.findIndex(x => x.type === 'looper'); if(li >= 0) at = li;
  keepRefs(() => { L.splice(at, 0, b); }); rewire(); NP.selected = b.id; UI.encPage = 0; go('chain'); renderTop(); renderEncoders(); toast(c.name + ' added to path A'); }

// ---------- events ----------
document.addEventListener('DOMContentLoaded', () => {
  const pedal = $('#pedal');
  pedal.addEventListener('click', e => { const x = e.target.closest('[data-cl]'); if(!x || x.disabled) return; const a = x.dataset.cl, s = UI.cl;
    if(a === 'mode'){ s.mode = x.dataset.v; if(s.mode !== 'pedal') s.setup = false; renderPage(); cloneGuardSync(); return; }
    if(a === 'unmute'){ if(UI.page === 'clone' && s.mode === 'pedal'){ toast('The chain stays muted on this tab, so a patched-in pedal can\'t squeal.', 3400); return; } afterPedal(() => {}); return; }
    if(a === 'quality'){ s.quality = +x.dataset.v; $$('[data-cl="quality"]').forEach(b => b.classList.toggle('on', b === x)); return; }
    if(a === 'engine'){ s.engine = x.dataset.v; $$('[data-cl="engine"]').forEach(b => b.classList.toggle('on', b === x)); return; }
    if(a === 'test'){ sendTest(); return; }
    if(a === 'measure'){ measureInterface(); return; }
    if(a === 'go'){ startLive(); return; }
    if(a === 'tone'){ const t = Cloner.makeTone(48000); download(new Blob([Cloner.wav24(t.x, 48000)], {type: 'audio/wav'}), 'neon-peach-test-tone.wav', 'Test Tones'); toast('Test tone saved'); return; }
    if(a === 'upload'){ startUpload(); return; }
    if(a === 'import'){ importCloneFile(); return; }
    if(a === 'cancel'){ if(playRecord.cancel) playRecord.cancel(); return; }
    if(a === 'stop'){ if(s.job && s.job.stop) s.job.stop(); x.disabled = true; x.lastChild.textContent = 'Stopping…'; return; }
    if(a === 'dismiss'){ stopPreview(); setJob(null); return; }
    if(a === 'hear'){ const j = s.job, v = x.dataset.v; if(!v || UI.clPlay === v){ stopPreview(); renderPage(); return; } if(!j || !j.ab) return; playBuffer(v === 'real' ? j.ab.real : j.ab.copy, j.ab.sr, true); UI.clPlay = v; renderPage(); return; }
    if(a === 'use'){ const id = x.dataset.id; afterPedal(() => useClone(id)); return; }
    if(a === 'export'){ const c = NP.clones.find(y => y.id === x.dataset.id); if(c) exportClone(c); return; }
    if(a === 'rename'){ const c = NP.clones.find(y => y.id === x.dataset.id); if(c) prompt2('Rename clone', c.name, v => { c.name = v; saveClone(c).then(() => { renderPage(); }); }); return; }
    if(a === 'del'){ const c = NP.clones.find(y => y.id === x.dataset.id); if(c) confirm2('Delete ' + c.name + '? Presets that use it will play it clean.', () => { deleteClone(c.id).then(() => renderPage()); }, 'Delete'); return; }
  });
  pedal.addEventListener('input', e => { const t = e.target; if(t.id === 'clsend'){ UI.cl.sendDb = +t.value; const o = t.parentElement.querySelector('output'); if(o) o.textContent = fmtDb(+t.value); } });
});
