// ===== Neon Peach 2.2: the bedroom kit =====
// Library (bulk import, search, favorites), a Browse picker for cabs and clones, a song player for practice,
// a recorder that keeps your clean bass for re-amping, a bar-locked looper, preset level matching,
// copy and paste for blocks, and share codes for presets.

Object.assign(ICO, {
  folder:'<path d="M3.5 7.5a2 2 0 0 1 2-2h4l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/>',
  star:'<path d="M12 3.6l2.6 5.3 5.8.8-4.2 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.2-4.1 5.8-.8z"/>',
  music:'<path d="M9 18V6l11-2v12"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="17.5" cy="16" r="2.5"/>',
  paste:'<rect x="6" y="4.5" width="12" height="16" rx="2"/><path d="M9.5 4.5V3.5h5v1"/><path d="M9.5 11h5M9.5 14.5h5"/>',
  share:'<circle cx="6" cy="12" r="2.4"/><circle cx="18" cy="6" r="2.4"/><circle cx="18" cy="18" r="2.4"/><path d="M8.2 11l7.6-4M8.2 13l7.6 4"/>',
  edit:'<path d="M4 20h4l10.5-10.5-4-4L4 16z"/><path d="M13 7l4 4"/>',
  level:'<path d="M5 19V9M10 19V5M15 19v-7M20 19v-4"/>'
});

// ---------- navigation: a Practice group, and Library under Clone ----------
GROUPS.play = {l: 'Practice', i: 'music', pages: [['practice', 'Songs', 'music'], ['record', 'Record', 'rec'], ['looper', 'Looper', 'loop'], ['drums', 'Beats', 'drum']]};
GROUPS.clone.pages.splice(1, 0, ['library', 'Library', 'folder']);
UI.groupLast.play = 'practice';
{ const i = RAIL.findIndex(p => p[0] === 'looper'); if(i >= 0) RAIL.splice(i, 2, ['@play']); }
PAGES.push(['practice'], ['record'], ['library']);

function fmtTime(s){ s = Math.max(0, s || 0); const m = Math.floor(s/60), r = s - m*60; return m + ':' + (r < 10 ? '0' : '') + r.toFixed(1); }
function niceName(f){ return f.replace(/\.[^.]+$/, '').replace(/[_]+/g, ' ').trim() || 'Untitled'; }

// ==================================================================== LIBRARY
UI.lib = {q: '', kind: 'all', busy: null};
function libMatches(c, q, kind){
  if(kind === 'fav' && !c.fav) return false;
  if(kind === 'ir' && c.kind !== 'ir') return false;
  if(kind === 'nam' && c.kind === 'ir') return false;
  if(!q) return true; const t = (c.name + ' ' + (c.folder || '') + ' ' + (c.note || '')).toLowerCase();
  return q.toLowerCase().split(/\s+/).filter(Boolean).every(w => t.includes(w)); }
function libSorted(list){ return list.slice().sort((a, b) => (b.fav ? 1 : 0) - (a.fav ? 1 : 0) || (a.folder || '').localeCompare(b.folder || '') || a.name.localeCompare(b.name)); }
function libRow(c, pick){
  const kind = c.kind === 'ir' ? 'Cab IR' : cloneKind(c);
  return `<div class="lib-row" data-lid="${c.id}"><button class="ib star ${c.fav ? 'on' : ''}" data-lfav="${c.id}" title="${c.fav ? 'Remove from' : 'Add to'} favorites" aria-label="Favorite ${esc(c.name)}" aria-pressed="${!!c.fav}">${icon('star')}</button>
    <div class="lib-main"><div class="lib-name">${esc(c.name)}</div><div class="lib-sub"><span class="lib-kind k-${c.kind === 'ir' ? 'ir' : 'nam'}">${kind}</span>${c.folder ? `<span>${icon('folder')}${esc(c.folder)}</span>` : ''}${c.note ? `<span>${esc(c.note)}</span>` : ''}</div></div>
    <div class="lib-act">${pick ? `<button class="sm primary" data-lpick="${c.id}">Use</button>` : `<button class="sm" data-luse="${c.id}">${icon('plus')}${c.kind === 'ir' ? 'Add cab' : 'Add'}</button><button class="ib" data-lren="${c.id}" title="Rename" aria-label="Rename ${esc(c.name)}">${icon('edit')}</button><button class="ib" data-lexp="${c.id}" title="Export" aria-label="Export ${esc(c.name)}">${icon('down')}</button><button class="ib danger" data-ldel="${c.id}" title="Delete" aria-label="Delete ${esc(c.name)}">${icon('trash')}</button>`}</div></div>`; }
function libListHTML(pick, kindLock){
  const L = UI.lib, kind = kindLock && L.kind !== 'fav' ? kindLock : L.kind;
  const all = NP.clones.filter(c => !kindLock || (kindLock === 'ir' ? c.kind === 'ir' : true));
  const list = libSorted(all.filter(c => libMatches(c, L.q, kind)));
  if(!NP.clones.length) return `<div class="empty-ed">${icon('folder')}<div><b>Your library is empty.</b>Add .nam amp and pedal models and .wav cab IRs. You can add a whole folder at once.</div></div>`;
  if(!list.length) return `<p class="dim lib-none">Nothing matches. Try fewer words.</p>`;
  const max = 300, more = list.length > max ? `<p class="dim">Showing ${max} of ${list.length}. Search to narrow it down.</p>` : '';
  return list.slice(0, max).map(c => libRow(c, pick)).join('') + more; }
function libFilters(kindLock){ const L = UI.lib, n = (f) => NP.clones.filter(c => libMatches(c, '', f)).length;
  const opts = kindLock === 'ir' ? [['all', 'All IRs'], ['fav', 'Favorites']] : [['all', 'All'], ['nam', 'Amps and pedals'], ['ir', 'Cab IRs'], ['fav', 'Favorites']];
  return `<div class="seg sm lib-f">${opts.map(([k, l]) => `<button class="${L.kind === k ? 'on' : ''}" data-lkind="${k}">${l} <i>${kindLock === 'ir' && k === 'all' ? n('ir') : kindLock === 'ir' && k === 'fav' ? NP.clones.filter(c => c.fav && c.kind === 'ir').length : n(k)}</i></button>`).join('')}</div>`; }
PAGE_RENDER.library = () => { const L = UI.lib;
  return `<div class="lead"><div class="lead-ico">${icon('folder')}</div><div><h3>Library</h3><p>All your amp and pedal models (.nam) and cab IRs (.wav) in one place. Add a whole folder at once. Star the ones you like. Free packs from sites like ToneHunt work here.</p></div></div>
  <section class="pane libp"><div class="lib-top"><div class="lib-search">${icon('search')}<input type="search" id="lsq" placeholder="Search by name or folder" value="${esc(L.q)}" aria-label="Search the library"></div>
    <button class="sm primary" id="libfolder">${icon('folder')}Add a folder</button><button class="sm" id="libfiles">${icon('up')}Add files</button></div>
    ${L.busy ? `<div class="lib-busy"><b>${esc(L.busy)}</b><div class="lbar"><i style="width:${(L.pct || 0).toFixed(1)}%"></i></div></div>` : ''}
    ${libFilters()}<div class="lib-list" id="liblist">${libListHTML(false)}</div></section>
  <p class="hint">Cab IRs go in a Cabinet or Dual Cab block. Models go in a Clone block. In those blocks, press Browse to pick from here.</p>`; };

// pick a folder (or many files) and bring in every .nam and .wav in it
function pickMany(folder){ return new Promise(res => { const i = document.createElement('input'); i.type = 'file'; i.multiple = true; if(folder){ i.webkitdirectory = true; i.setAttribute('webkitdirectory', ''); } else i.accept = '.nam,.json,.wav,audio/wav';
  i.onchange = () => res(Array.from(i.files || [])); i.click(); }); }
async function importMany(files){
  files = files.filter(f => /\.(nam|wav)$/i.test(f.name)); if(!files.length){ toast('No .nam or .wav files there.', 2600); return; }
  const L = UI.lib, have = new Set(NP.clones.map(c => (c.folder || '') + '/' + c.name + '/' + c.kind)); let ok = 0, skip = 0, bad = 0;
  for(let i = 0; i < files.length; i++){ const f = files[i], rel = f.webkitRelativePath || '', parts = rel.split('/'); parts.pop(); const folder = parts.join(' / ');
    L.busy = `Adding ${i + 1} of ${files.length}: ${f.name}`; L.pct = 100*i/files.length; if(UI.page === 'library' && i % 3 === 0) renderPage();
    const name = niceName(f.name), isIR = /\.wav$/i.test(f.name);
    if(have.has(folder + '/' + name + '/' + (isIR ? 'ir' : 'nam'))){ skip++; continue; }
    try{
      let rec;
      if(isIR){ const buf = await NP.ctx.decodeAudioData(await f.arrayBuffer()), sr = buf.sampleRate, n = Math.min(buf.length, sr*2);
        if(buf.duration > 12){ bad++; continue; }   // a song, not an IR
        rec = await addIrClone(name, Float32Array.from(buf.getChannelData(0).subarray(0, n)), sr); }
      else rec = await addNamClone(name, await f.text());
      if(folder){ rec.folder = folder; await CDB.put(rec); }
      ok++;
    }catch(e){ bad++; }
    if(i % 8 === 7) await new Promise(r => setTimeout(r, 0)); }
  L.busy = null; refreshCloneBlocks(); if(UI.page === 'library' || UI.page === 'clone') renderPage();
  toast(`Added ${ok}${skip ? `, skipped ${skip} already here` : ''}${bad ? `, ${bad} could not be read` : ''}.`, 4200); }
async function libSave(c){ try{ await CDB.put(c); }catch(e){} }
function libRefreshList(){ const el = $('#liblist'); if(el) el.innerHTML = libListHTML(false); const f = $('.lib-f'); if(f) f.outerHTML = libFilters(); }

// the Browse picker used inside Cabinet, Dual Cab and Clone blocks
function openPicker(b, key){
  const ir = b.type !== 'clone', L = UI.lib; if(L.kind !== 'fav') L.kind = 'all';
  const html = () => `<h3>${ir ? 'Pick a cab IR' : 'Pick a model'}</h3><div class="lib-top"><div class="lib-search">${icon('search')}<input type="search" id="pkq" placeholder="Search" value="${esc(L.q)}" aria-label="Search"></div><button class="sm" id="pkadd">${icon('folder')}Add a folder</button></div>${libFilters(ir ? 'ir' : null)}<div class="lib-list pick" id="pklist">${libListHTML(true, ir ? 'ir' : null)}</div>`;
  openModal(`<div class="picker">${html()}</div>`, m => {
    const redraw = () => { $('#pklist', m).innerHTML = libListHTML(true, ir ? 'ir' : null); const f = $('.lib-f', m); if(f) f.outerHTML = libFilters(ir ? 'ir' : null); };
    $('#pkq', m).oninput = (e) => { L.q = e.target.value; redraw(); };
    UI.modalClick = (e) => { const x = e.target.closest('[data-lpick],[data-lfav],[data-lkind],#pkadd'); if(!x) return false;
      if(x.id === 'pkadd'){ pickMany(true).then(fs => importMany(fs)).then(() => { if($('#pklist', m)) redraw(); }); return true; }
      if(x.dataset.lkind){ L.kind = x.dataset.lkind; redraw(); return true; }
      if(x.dataset.lfav){ const c = NP.clones.find(y => y.id === x.dataset.lfav); if(c){ c.fav = !c.fav; libSave(c); redraw(); } return true; }
      const c = NP.clones.find(y => y.id === x.dataset.lpick); if(!c) return true;
      if(b.type === 'clone'){ b.p.cid = c.id; } else { const idk = {cab: 'irid', cabA: 'idA', cabB: 'idB'}[key]; b.p[idk] = c.id; }
      applyBlock(b); closeModal(); renderPage(); renderEncoders(); toast('Loaded ' + c.name, 1400); return true; }; }); }

// ==================================================================== STREAMER
// Plays long audio as a row of short buffers, a little ahead of time. This works the same in both audio engines,
// and a 5-minute song never has to be copied to the audio thread in one piece.
class Streamer {
  constructor(dest, pull, opt){ this.dest = dest; this.pull = pull; this.opt = opt || {}; this.srcs = []; this.marks = []; this.on = false; this.busy = false; this.seq = 0; this.ahead = this.opt.ahead || 0.7; }
  start(at){ const ctx = NP.ctx; if(this.on) this.stop(); this.on = true; this.seq++; this.t = Math.max(at || 0, ctx.currentTime + 0.06); this.ended = false; this.timer = setInterval(() => this.fill(), 40); this.fill(); }
  stop(when){ const ctx = NP.ctx; this.on = false; this.seq++; clearInterval(this.timer); const t = when || ctx.currentTime;
    this.srcs.forEach(s => { try{ s.stop(t); }catch(e){} }); this.srcs = []; this.marks = []; this.busy = false; }
  async fill(){ const ctx = NP.ctx; if(!this.on || this.busy) return;
    if(this.ended){ if(ctx.currentTime > this.t + 0.05){ this.on = false; clearInterval(this.timer); if(this.onend) this.onend(); } return; }
    if(this.t > ctx.currentTime + this.ahead) return;
    this.busy = true; const seq = this.seq; let r;
    try{ r = await this.pull(Math.round(ctx.sampleRate*(this.opt.chunk || 0.25))); }catch(e){ r = null; }
    if(seq !== this.seq){ return; } this.busy = false; if(!r){ this.ended = true; return; }
    if(r.n > 0){ const nc = r.ch.length, buf = ctx.createBuffer(nc, r.n, ctx.sampleRate); for(let c = 0; c < nc; c++) buf.getChannelData(c).set(r.ch[c]);
      const s = ctx.createBufferSource(); s.buffer = buf; s.connect(this.dest); if(this.t < ctx.currentTime) this.t = ctx.currentTime + 0.02; s.start(this.t);
      const dur = r.n/ctx.sampleRate; this.marks.push({t: this.t, dur, pos0: r.pos0, speed: r.speed || 1}); if(this.marks.length > 40) this.marks.shift();
      s.onended = () => { const i = this.srcs.indexOf(s); if(i >= 0) this.srcs.splice(i, 1); try{ s.disconnect(); }catch(e){} };
      this.srcs.push(s); this.t += dur; }
    if(r.wrap && this.onwrap) this.onwrap(this.t);
    if(r.end) this.ended = true;
    if(this.on) this.fill(); }
  // where the listener is right now, in source samples
  now(){ const t = NP.ctx.currentTime; let m = null; for(const x of this.marks) if(x.t <= t + 1e-4) m = x; if(!m) return this.marks.length ? this.marks[0].pos0 : null;
    return m.pos0 + Math.min(m.dur, t - m.t)*NP.ctx.sampleRate*m.speed; }
}
// a plain array source for takes and re-amping
function arraySource(ch, from, loop){ let pos = from || 0; const L = ch[0].length;
  return async (n) => { if(pos >= L){ if(!loop) return {n: 0, ch: [], end: true}; pos = 0; } const m = Math.min(n, L - pos), out = ch.map(x => x.slice(pos, pos + m)); const r = {n: m, ch: out, pos0: pos, speed: 1}; pos += m; if(pos >= L){ if(loop) r.wrap = true; else r.end = true; } return r; }; }

// ==================================================================== SONG PLAYER
const PL = {song: null, worker: null, seq: 0, wait: {}, playing: false, speed: 1, pitch: 0, cents: 0, loopOn: false, A: null, B: null, vol: 70, mode: 0, countIn: false,
  trainer: false, trStep: 5, trTo: 100, recent: [], pos: 0, peaks: null, bpm: 0, drag: null};
function plWorker(){ if(PL.worker) return PL.worker; const src = $('#stretch-worker-src').textContent;
  PL.worker = new Worker(URL.createObjectURL(new Blob([src], {type: 'application/javascript'})));
  PL.worker.onmessage = (e) => { const m = e.data; if(m.tempo !== undefined){ PL.bpm = m.tempo; if(UI.page === 'practice') renderPage(); return; } const w = PL.wait[m.seq]; if(w){ delete PL.wait[m.seq]; w(m); } };
  return PL.worker; }
function plGraph(){ const r = NP.rig, ctx = NP.ctx; if(r.song) return r.song;
  const g = r.song = {in: ctx.createGain(), gate: ctx.createGain(), s1: ctx.createBiquadFilter(), s2: ctx.createBiquadFilter(), l1: ctx.createBiquadFilter(), l2: ctx.createBiquadFilter(), vol: ctx.createGain()};
  g.s1.type = g.s2.type = 'lowshelf'; g.l1.type = g.l2.type = 'lowpass';
  g.in.connect(g.gate).connect(g.s1).connect(g.s2).connect(g.l1).connect(g.l2).connect(g.vol).connect(r.backing); setP(r.backing.gain, 1); plTone(); return g; }
function plTone(){ const g = NP.rig.song; if(!g) return; const m = PL.mode;
  [g.s1, g.s2].forEach(f => { f.frequency.value = 230; f.gain.value = m === 1 ? -16 : 0; });
  [g.l1, g.l2].forEach(f => { f.frequency.value = m === 2 ? 320 : 20000; f.Q.value = 0.707; });
  setP(g.vol.gain, Math.pow(PL.vol/100, 2)*(m === 2 ? 2 : 1)); }
function plPitch(){ return PL.pitch + PL.cents/100; }
function plLoop(){ return PL.loopOn && PL.A != null && PL.B != null && PL.B - PL.A > 2000 ? [PL.A, PL.B] : null; }
function plPull(n){ return new Promise(res => { const seq = ++PL.seq; PL.wait[seq] = res; PL.worker.postMessage({cmd: 'pull', seq, n}); }); }
function plSet(pos){ plWorker().postMessage({cmd: 'set', pos, speed: PL.speed, pitch: plPitch(), loop: plLoop()}); }
function plMakeStreamer(){ const st = new Streamer(plGraph().in, plPull, {chunk: 0.25, ahead: 0.6});
  st.onend = () => { PL.playing = false; PL.pos = 0; if(UI.page === 'practice') renderPage(); };
  st.onwrap = () => { if(PL.trainer && PL.speed*100 < PL.trTo - 0.01){ PL.speed = Math.min(PL.trTo, Math.round(PL.speed*100) + PL.trStep)/100; plSet(PL.A); setTimeout(() => { if(UI.page === 'practice') plPaintCtl(); }, 0); } };
  return st; }
function plPos(){ if(PL.playing && PL.st){ const p = PL.st.now(); if(p != null) return p; } return PL.pos; }
function plPlay(from){ if(!PL.song) return; const ctx = NP.ctx, g = plGraph(); if(!PL.st) PL.st = plMakeStreamer();
  let pos = from != null ? from : plPos(); const lp = plLoop(); if(lp && (pos < lp[0] || pos >= lp[1])) pos = lp[0]; if(pos >= PL.song.len - 100) pos = lp ? lp[0] : 0;
  const now = ctx.currentTime; g.gate.gain.cancelScheduledValues(now); g.gate.gain.setTargetAtTime(0, now, 0.004);
  let at = now + 0.05;
  if(PL.countIn && !PL.playing){ const beat = 60/NP.bpm; noiseBuf(ctx); for(let i = 0; i < 4; i++) hit('hat', at + i*beat, i === 0 ? 2 : 1); at += 4*beat; }
  PL.st.stop(now + 0.03); plSet(pos); PL.st.start(at); g.gate.gain.setTargetAtTime(1, at - 0.005, 0.003); PL.playing = true; PL.pos = pos; }
function plPause(){ if(!PL.playing) return; PL.pos = plPos(); const ctx = NP.ctx, g = NP.rig.song; g.gate.gain.setTargetAtTime(0, ctx.currentTime, 0.004); PL.st.stop(ctx.currentTime + 0.03); PL.playing = false; }
function plSeek(pos){ pos = clampN(pos, 0, PL.song ? PL.song.len - 1 : 0); if(PL.playing) plPlay(pos); else PL.pos = pos; plPaintWave(); }
function plRestart(){ if(PL.playing) plPlay(plPos()); }   // speed, pitch or loop changed
async function plLoadFile(f){ if(!f) return; if(!/audio|video/.test(f.type) && !/\.(mp3|wav|flac|ogg|m4a|aac|opus|webm|mp4)$/i.test(f.name)){ toast('Pick a song file: mp3, wav, flac, m4a or ogg.', 3000); return; }
  toast('Loading ' + f.name, 1200); const data = await f.arrayBuffer(); const id = 's' + Date.now().toString(36);
  const ok = await plOpen({id, name: niceName(f.name), made: Date.now(), loops: []}, data.slice(0));
  if(ok){ try{ await CDB.putIn('songData', {id, data}); await CDB.putIn('songs', PL.song.meta); }catch(e){} plRecent(); } }
async function plOpen(meta, data){
  let buf; try{ buf = await NP.ctx.decodeAudioData(data); }catch(e){ toast('That file could not be played. Try an mp3 or wav.', 3600); return false; }
  if(PL.playing) plPause(); const ch = []; for(let c = 0; c < Math.min(2, buf.numberOfChannels); c++) ch.push(Float32Array.from(buf.getChannelData(c)));
  meta.dur = buf.duration; PL.song = {meta, len: buf.length, sr: buf.sampleRate, name: meta.name}; PL.pos = 0; PL.A = PL.B = null; PL.loopOn = false; PL.bpm = 0;
  if(meta.last){ PL.speed = meta.last.speed || 1; PL.pitch = meta.last.pitch || 0; PL.cents = meta.last.cents || 0; }
  PL.peaks = plPeaks(ch, 1600); const w = plWorker(); w.postMessage({cmd: 'load', ch, sr: buf.sampleRate}, ch.map(x => x.buffer)); w.postMessage({cmd: 'tempo'});
  if(UI.page !== 'practice') go('practice'); else renderPage(); return true; }
function plPeaks(ch, W){ const L = ch[0].length, step = Math.max(1, Math.floor(L/W)), mn = new Float32Array(W), mx = new Float32Array(W);
  for(let i = 0; i < W; i++){ let a = 0, b = 0; for(let c = 0; c < ch.length; c++){ const x = ch[c]; for(let k = i*step, e = Math.min(L, k + step); k < e; k += 4){ const v = x[k]; if(v < a) a = v; if(v > b) b = v; } } mn[i] = a; mx[i] = b; }
  return {mn, mx, W}; }
async function plRecent(){ try{ PL.recent = (await CDB.allIn('songs')).sort((a, b) => (b.used || b.made) - (a.used || a.made)); }catch(e){ PL.recent = []; } if(UI.page === 'practice') renderPage(); }
async function plOpenRecent(id){ const meta = PL.recent.find(s => s.id === id); if(!meta) return; let d; try{ d = await CDB.getIn('songData', id); }catch(e){} if(!d){ toast('That song is gone. Load it again.'); return; }
  meta.used = Date.now(); if(await plOpen(meta, d.data.slice(0))){ CDB.putIn('songs', meta).catch(() => {}); } }
function plSaveMeta(){ const s = PL.song; if(!s) return; s.meta.last = {speed: PL.speed, pitch: PL.pitch, cents: PL.cents}; CDB.putIn('songs', s.meta).catch(() => {}); }

PAGE_RENDER.practice = () => { const s = PL.song;
  const recent = PL.recent.length ? `<section class="pane"><h4 class="pane-h">Your songs</h4><div class="pl-recent">${PL.recent.slice(0, 12).map(r => `<div class="pl-rs ${s && s.meta.id === r.id ? 'on' : ''}"><button class="sm" data-plopen="${r.id}">${icon('music')}${esc(r.name)}<em>${fmtTime(r.dur)}</em></button><button class="ib" data-pldel="${r.id}" title="Remove" aria-label="Remove ${esc(r.name)}">${icon('x')}</button></div>`).join('')}</div></section>` : '';
  if(!s) return `<div class="lead"><div class="lead-ico">${icon('music')}</div><div><h3>Play along with songs</h3><p>Load a song. Slow it down without changing the pitch. Change its key. Loop the hard part. Turn the song's bass down so you can play the line yourself.</p></div></div>
    <div class="pl-drop" id="pldrop">${icon('music')}<b>Drop a song here</b><span>mp3, wav, flac, m4a or ogg</span><button class="primary" id="plload">${icon('up')}Load a song</button></div>${recent}`;
  const lp = PL.A != null && PL.B != null, sr = s.sr;
  const loops = (s.meta.loops || []).map((l, i) => `<span class="pl-lp"><button class="sm ${lp && Math.abs(PL.A - l.a) < 10 && Math.abs(PL.B - l.b) < 10 ? 'on' : ''}" data-pllp="${i}">${esc(l.name)}</button><button class="ib xs" data-pllpdel="${i}" aria-label="Delete loop ${esc(l.name)}">${icon('x')}</button></span>`).join('');
  return `<section class="pane pl"><div class="pl-head"><div class="pl-title">${icon('music')}<b>${esc(s.name)}</b><em>${fmtTime(s.len/sr)}</em></div><button class="sm" id="plload">${icon('up')}Load another</button></div>
    <div class="pl-wave"><canvas id="plwave" aria-label="Song waveform. Click to jump. Drag to make a loop."></canvas></div>
    <div class="pl-tr"><button class="ib" data-plj="-5" title="Back 5 seconds" aria-label="Back 5 seconds">${icon('left')}</button><button class="pl-play ${PL.playing ? 'on' : ''}" id="plplay" aria-label="${PL.playing ? 'Pause' : 'Play'}">${icon(PL.playing ? 'stop' : 'play')}<span>${PL.playing ? 'Pause' : 'Play'}</span></button><button class="ib" data-plj="5" title="Ahead 5 seconds" aria-label="Ahead 5 seconds">${icon('right')}</button>
      <output id="pltime" class="pl-time">${fmtTime(plPos()/sr)}</output>
      <div class="pl-ab"><button class="sm" id="plA">Set A</button><button class="sm" id="plB">Set B</button><button class="sm ${PL.loopOn ? 'on' : ''}" id="plloop" ${lp ? '' : 'disabled'}>${icon('loop')}Loop ${lp ? fmtTime(PL.A/sr) + ' to ' + fmtTime(PL.B/sr) : 'off'}</button>${lp ? `<button class="sm" id="plsave">${icon('save')}Save loop</button><button class="ib" id="plclr" title="Clear the loop" aria-label="Clear the loop">${icon('x')}</button>` : ''}</div></div>
    ${loops ? `<div class="pl-loops">${loops}</div>` : ''}
    <div class="pl-ctl" id="plctl">${plCtlHTML()}</div></section>${recent}
  <p class="hint">Drag across the waveform to loop a part. Keys: Space plays and pauses, [ sets A, ] sets B, L turns the loop on and off. Speed Trainer starts slow and speeds up a little each time the loop comes around.</p>`; };
function plCtlHTML(){ const s = PL.song;
  return `<div class="fields">${field('Speed', 'plspd', 40, 125, 1, Math.round(PL.speed*100), Math.round(PL.speed*100) + '%')}${field('Key', 'plkey', -12, 12, 1, PL.pitch, (PL.pitch > 0 ? '+' : '') + PL.pitch + ' st')}${field('Fine tune', 'plcent', -50, 50, 1, PL.cents, (PL.cents > 0 ? '+' : '') + PL.cents + ' ¢')}${field('Song volume', 'plvol', 0, 100, 1, PL.vol, PL.vol + '%', false, true)}</div>
    <div class="pl-row"><span class="pl-l">Song bass</span><div class="seg sm">${['As is', 'Turn it down', 'Bass only'].map((l, i) => `<button class="${PL.mode === i ? 'on' : ''}" data-plmode="${i}">${l}</button>`).join('')}</div></div>
    <div class="pl-row"><span class="pl-l">Before play</span><button class="sm ${PL.countIn ? 'on' : ''}" id="plcount">Count in 4 at ${Math.round(NP.bpm)} bpm</button>
      ${PL.bpm ? `<span class="pl-bpm">Song tempo about <b>${Math.round(PL.bpm*PL.speed)}</b> bpm</span><button class="sm" id="plbpm">Use it</button><button class="xs" data-plx="2">×2</button><button class="xs" data-plx="0.5">÷2</button>` : s ? '<span class="dim">Finding the tempo…</span>' : ''}</div>
    <div class="pl-row"><span class="pl-l">Speed Trainer</span><button class="sm ${PL.trainer ? 'on' : ''}" id="pltrain">${PL.trainer ? 'On' : 'Off'}</button><span class="dim">Each loop goes ${PL.trStep}% faster, up to ${PL.trTo}%.</span><select id="pltrstep" aria-label="Trainer step">${[2, 5, 10].map(v => `<option value="${v}" ${PL.trStep === v ? 'selected' : ''}>+${v}%</option>`).join('')}</select><select id="pltrto" aria-label="Trainer goal">${[80, 90, 100, 110, 120].map(v => `<option value="${v}" ${PL.trTo === v ? 'selected' : ''}>to ${v}%</option>`).join('')}</select></div>`; }
function plPaintCtl(){ const el = $('#plctl'); if(el){ el.innerHTML = plCtlHTML(); paintRanges(el); } }
function plPaintWave(){ const cv = $('#plwave'); if(!cv || !PL.song || !PL.peaks) return; const dpr = window.devicePixelRatio || 1, w = cv.clientWidth, h = cv.clientHeight; if(!w) return;
  if(cv.width !== Math.round(w*dpr)){ cv.width = Math.round(w*dpr); cv.height = Math.round(h*dpr); }
  const g = cv.getContext('2d'), P = PL.peaks, L = PL.song.len, X = (s) => s/L*w; g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, h);
  const cs = getComputedStyle(document.documentElement), peach = cs.getPropertyValue('--peach').trim() || '#ff9a66';
  if(PL.A != null && PL.B != null){ g.fillStyle = PL.loopOn ? 'rgba(49,240,255,.14)' : 'rgba(255,255,255,.06)'; g.fillRect(X(PL.A), 0, X(PL.B) - X(PL.A), h); }
  if(PL.drag && PL.drag.moved){ const a = Math.min(PL.drag.a, PL.drag.b), b = Math.max(PL.drag.a, PL.drag.b); g.fillStyle = 'rgba(49,240,255,.2)'; g.fillRect(X(a), 0, X(b) - X(a), h); }
  const pos = plPos(), px = X(pos), mid = h/2;
  for(let x = 0; x < w; x++){ const i = Math.floor(x/w*P.W), a = P.mn[i], b = P.mx[i]; g.fillStyle = x < px ? peach : '#3a4658'; g.fillRect(x, mid - b*mid*0.95, 1, Math.max(1, (b - a)*mid*0.95)); }
  [[PL.A, 'A'], [PL.B, 'B']].forEach(([v, t]) => { if(v == null) return; g.fillStyle = '#31f0ff'; g.fillRect(X(v) - 1, 0, 2, h); g.font = '600 11px Saira, sans-serif'; g.fillText(t, X(v) + 4, 12); });
  g.fillStyle = '#fff'; g.fillRect(px - 1, 0, 2, h); g.shadowBlur = 0;
  const tm = $('#pltime'); if(tm) tm.textContent = fmtTime(pos/PL.song.sr); }
(function plTick(){ if(UI.page === 'practice' && PL.song && (PL.playing || PL.drag)) plPaintWave(); requestAnimationFrame(plTick); })();
function plWaveSample(e){ const cv = $('#plwave'), r = cv.getBoundingClientRect(); return clampN((e.clientX - r.left)/r.width, 0, 1)*PL.song.len; }

// ==================================================================== RECORDER AND RE-AMP
// Every take keeps two things: your clean bass (DI), and the finished sound you heard.
// Re-amp plays the clean bass back through any preset, so you can change your tone after you play.
UI.rk = {on: false, t0: 0, takes: [], play: null, reamp: null, loopDI: null};
function recGrab(node){ return new Promise(res => { const prev = node.port.onmessage; node.port.onmessage = (e) => { if(e.data && e.data.done){ node.port.onmessage = prev; res(e.data); } }; node.port.postMessage({cmd: 'stop'}); }); }
async function takesLoad(){ try{ UI.rk.takes = (await CDB.allIn('takes')).sort((a, b) => b.made - a.made); }catch(e){ UI.rk.takes = []; } if(UI.page === 'record') renderPage(); }
function recStart(){ const r = NP.rig, k = UI.rk; if(k.on || k.reamp) return; if(UI.recOn){ toast('The other recorder is running. Stop it first.'); return; }
  r.recDI.port.postMessage({cmd: 'start'}); r.rec.port.postMessage({cmd: 'start'}); k.on = true; k.t0 = NP.ctx.currentTime; renderPage(); }
async function recStop(name, extra){ const r = NP.rig, k = UI.rk; if(!k.on) return; k.on = false;
  const [di, mix] = await Promise.all([recGrab(r.recDI), recGrab(r.rec)]); const n = Math.min(di.L.length, mix.L.length), lead = extra && extra.lead ? Math.min(n, extra.lead) : 0;
  if(n - lead < mix.sr*0.3){ toast('Too short to keep.'); renderPage(); return; }
  const id = 't' + Date.now().toString(36), num = (k.takes.length ? Math.max(...k.takes.map(t => t.num || 0)) : 0) + 1;
  const meta = {id, num, name: name || 'Take ' + num, made: Date.now(), sr: mix.sr, dur: (n - lead)/mix.sr, preset: NP.preset.name, bpm: Math.round(NP.bpm)};
  const audio = {id, di: di.L.slice(lead, n), L: mix.L.slice(lead, n), R: mix.R.slice(lead, n)};
  try{ await CDB.putIn('takeAudio', audio); await CDB.putIn('takes', meta); }catch(e){ toast('Could not keep the take here. Save it as a file now.', 4000); }
  k.takes.unshift(meta); k.cache = audio; renderPage(); toast(meta.name + ' kept', 1400); }
async function takeAudio(id){ const k = UI.rk; if(k.cache && k.cache.id === id) return k.cache; const a = await CDB.getIn('takeAudio', id); if(a) k.cache = a; return a; }
function takeStopPlay(){ const k = UI.rk; if(k.play){ k.play.st.stop(); k.play = null; } if(k.loopDI){ k.loopDI.stop(); k.loopDI = null; reampMute(false); } }
async function takePlay(id, what){ const k = UI.rk; const was = k.play && k.play.id === id && k.play.what === what; takeStopPlay(); if(was){ renderPage(); return; }
  const a = await takeAudio(id); if(!a) return; const ch = what === 'di' ? [a.di] : [a.L, a.R];
  const st = new Streamer(NP.rig.outGain, arraySource(ch, 0, false)); st.onend = () => { if(k.play && k.play.st === st){ k.play = null; renderPage(); } }; st.start(); k.play = {id, what, st}; renderPage(); }
function reampMute(on){ NP.reamp = !!on; applyGlobals(); }
// play a clean take through the chain on a loop, so you can turn knobs on a part you already played
async function takeLoopDI(id){ const k = UI.rk; const was = k.loopDI && k.loopDI.id === id; takeStopPlay(); if(was){ renderPage(); return; }
  const a = await takeAudio(id); if(!a) return; reampMute(true); const st = new Streamer(NP.rig.demo, arraySource([a.di], 0, true)); st.id = id; st.start(); k.loopDI = st; renderPage(); }
async function takeReamp(id){ const k = UI.rk; if(k.on || k.reamp) return; takeStopPlay(); const t = k.takes.find(x => x.id === id), a = await takeAudio(id); if(!a || !t) return;
  reampMute(true); const r = NP.rig; r.recDI.port.postMessage({cmd: 'start'}); r.rec.port.postMessage({cmd: 'start'}); k.on = true; const sent = NP.ctx.currentTime;
  const st = new Streamer(r.demo, arraySource([a.di], 0, false)); k.reamp = {st, id, dur: t.dur}; const at = sent + 0.15; st.start(at);
  st.onend = () => setTimeout(async () => { const tail = Math.min(4, sectionTail(NP.paths.A, NP.paths.B)); await new Promise(res => setTimeout(res, tail*1000));
      k.reamp = null; reampMute(false); await recStop(t.name.replace(/ \(re-amp.*$/, '') + ' (re-amp: ' + NP.preset.name + ')', {lead: Math.max(0, Math.round((at - sent - 0.01)*NP.ctx.sampleRate))}); }, 50);
  renderPage(); }
function takeCancelReamp(){ const k = UI.rk; if(!k.reamp) return; k.reamp.st.stop(); k.reamp = null; reampMute(false); const r = NP.rig; recGrab(r.recDI); recGrab(r.rec); k.on = false; renderPage(); toast('Re-amp stopped'); }
async function takeSave(id, what){ const t = UI.rk.takes.find(x => x.id === id), a = await takeAudio(id); if(!a || !t) return; const safe = t.name.replace(/[^\w\- ()]+/g, '_').trim();
  if(what === 'di') download(encodeWav(a.di, a.di, t.sr), safe + ' - clean DI.wav', 'Recordings'); else download(encodeWav(a.L, a.R, t.sr), safe + '.wav', 'Recordings'); }
async function takeDelete(id){ const k = UI.rk; takeStopPlay(); k.takes = k.takes.filter(t => t.id !== id); if(k.cache && k.cache.id === id) k.cache = null; try{ await CDB.delIn('takes', id); await CDB.delIn('takeAudio', id); }catch(e){} renderPage(); }
PAGE_RENDER.record = () => { const k = UI.rk, busy = k.on || k.reamp;
  const row = (t) => { const pl = k.play && k.play.id === t.id, lp = k.loopDI && k.loopDI.id === t.id;
    return `<div class="take ${pl || lp ? 'on' : ''}"><div class="tk-main"><div class="tk-name">${esc(t.name)}</div><div class="tk-sub">${fmtTime(t.dur)} · ${esc(t.preset || '')} · ${t.bpm || ''} bpm · ${new Date(t.made).toLocaleString([], {month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'})}</div></div>
    <div class="tk-act"><button class="sm ${pl && k.play.what === 'mix' ? 'on' : ''}" data-tkplay="${t.id}" ${busy ? 'disabled' : ''}>${icon(pl && k.play.what === 'mix' ? 'stop' : 'play')}Play</button><button class="sm ${pl && k.play.what === 'di' ? 'on' : ''}" data-tkdi="${t.id}" ${busy ? 'disabled' : ''} title="Hear the clean bass with no effects">Clean</button>
      <button class="sm ${lp ? 'on' : ''}" data-tkloop="${t.id}" ${busy ? 'disabled' : ''} title="Play the clean bass through this preset on a loop while you turn knobs">${icon('loop')}Tweak</button><button class="sm" data-tkre="${t.id}" ${busy ? 'disabled' : ''} title="Record the clean bass through this preset as a new take">${icon('refresh')}Re-amp</button>
      <button class="ib" data-tksave="${t.id}" title="Save as a WAV file" aria-label="Save ${esc(t.name)}">${icon('down')}</button><button class="ib" data-tksavedi="${t.id}" title="Save the clean DI as a WAV file" aria-label="Save clean DI">DI</button><button class="ib" data-tkren="${t.id}" title="Rename" aria-label="Rename">${icon('edit')}</button><button class="ib danger" data-tkdel="${t.id}" title="Delete" aria-label="Delete ${esc(t.name)}">${icon('trash')}</button></div></div>`; };
  return `<div class="lead"><div class="lead-ico">${icon('rec')}</div><div><h3>Record</h3><p>Every take keeps your clean bass too. Later, press Re-amp to put that same playing through a different preset. Press Tweak to loop it while you dial in a sound.</p></div></div>
  <section class="pane rk"><div class="rk-big"><button class="rk-btn ${k.on && !k.reamp ? 'on' : ''}" id="rkgo" ${k.reamp ? 'disabled' : ''} aria-label="${k.on ? 'Stop recording' : 'Record'}">${icon(k.on && !k.reamp ? 'stop' : 'rec')}</button>
    <div><div class="rk-state" id="rkstate">${k.reamp ? 'Re-amping through ' + esc(NP.preset.name) : k.on ? 'Recording' : 'Ready'}</div><div class="rk-time" id="rktime">${k.on ? fmtTime(NP.ctx.currentTime - k.t0) : '0:00.0'}</div>
    <div class="dim">Records what you hear, songs and Beats included. The clean take is only your bass. Key: Shift+R.</div>${k.reamp ? '<button class="sm danger" id="rkcancel">Stop re-amp</button>' : ''}</div></div></section>
  <section class="pane"><h4 class="pane-h">Takes<em>${k.takes.length ? (IS_APP ? 'Saved on this computer' : 'Kept in this browser') : ''}</em></h4>${k.takes.length ? k.takes.map(row).join('') : '<p class="dim">No takes yet.</p>'}</section>`; };
setInterval(() => { const k = UI.rk; if(UI.page === 'record' && k.on){ const el = $('#rktime'); if(el) el.textContent = fmtTime(NP.ctx.currentTime - k.t0); } }, 100);

// ==================================================================== LOOPER: lock to the tempo
LOOP_LABEL.arm = 'Waiting for bar 1';
function drNextBar(){ const d = UI.dr; if(!d || !d.on) return null; const dur = drStepDur(); let k = d.counting ? 16 - d.stepN : (16 - d.stepN % 16) % 16; let t = d.next + k*dur; if(t - NP.ctx.currentTime < 0.08) t += 16*dur; return t; }
const _looperCmd = looperCmd;
looperCmd = function(cmd){ const lb = findLooper(); if(!lb){ _looperCmd(cmd); return; } const g = NP.globals, sr = NP.ctx.sampleRate, msg = {cmd};
  if(cmd === 'rec' || cmd === 'stop' || cmd === 'play'){ msg.bar = g.loopSnap ? Math.round(4*60/NP.bpm*sr) : 0;
    const st = lb.loopState && lb.loopState.state; if(cmd === 'rec' && g.loopSnap && (!st || st === 'empty')){ const t = drNextBar(); if(t != null) msg.at = Math.round(t*sr); } }
  lb.n.l.port.postMessage(msg); };
{ const orig = PAGE_RENDER.looper; PAGE_RENDER.looper = () => { const h = orig(); if(!findLooper()) return h; const g = NP.globals, s = findLooper().loopState || {};
  const bars = s.len && s.bar ? Math.round(s.len/s.bar) : 0;
  return h.replace('<section class="pane loop-set">', `<section class="pane loop-snap"><div class="pl-row"><span class="pl-l">Lock to tempo</span><button class="sm ${g.loopSnap ? 'on' : ''}" id="loopsnap">${g.loopSnap ? 'On' : 'Off'}</button><span class="dim">${g.loopSnap ? `Loops snap to whole bars at ${Math.round(NP.bpm)} bpm. With Beats playing, recording starts on bar 1.${bars ? ' This loop is ' + bars + ' bar' + (bars === 1 ? '' : 's') + '.' : ''}` : 'The loop is as long as you play.'}</span></div></section><section class="pane loop-set">`); }; }

// ==================================================================== PRESET LEVEL: match loudness by ear-weighted level
function lvlTap(){ const r = NP.rig, ctx = NP.ctx; if(r.lvlAn) return; r.lvlHp = ctx.createBiquadFilter(); r.lvlHp.type = 'highpass'; r.lvlHp.frequency.value = 60; r.lvlSh = ctx.createBiquadFilter(); r.lvlSh.type = 'highshelf'; r.lvlSh.frequency.value = 1500; r.lvlSh.gain.value = 4;
  r.lvlAn = ctx.createAnalyser(); r.lvlAn.fftSize = 2048; r.sum.connect(r.lvlHp).connect(r.lvlSh).connect(r.lvlAn); }
function levelMatch(){ if(UI.lvl) return; lvlTap(); const r = NP.rig, bo = new Float32Array(2048), bi = new Float32Array(4096); let so = 0, si = 0, n = 0, ticks = 0;
  UI.lvl = {left: 6}; renderPage(); toast('Play like you normally do for 6 seconds', 2600);
  const t = setInterval(() => { r.lvlAn.getFloatTimeDomainData(bo); r.inAn.getFloatTimeDomainData(bi); let a = 0, b = 0; for(let i = 0; i < bo.length; i++) a += bo[i]*bo[i]; for(let i = 0; i < bi.length; i++) b += bi[i]*bi[i]; a /= bo.length; b /= bi.length;
    if(b > 1e-5){ so += a; si += b; n++; } ticks++; UI.lvl.left = Math.max(0, 6 - ticks*0.05); const el = $('#lvlbtn'); if(el) el.textContent = 'Listening… ' + Math.ceil(UI.lvl.left) + ' s';
    if(ticks >= 120){ clearInterval(t); UI.lvl = null;
      if(n < 30){ toast('Not enough playing heard. Try again and play the whole time.', 3600); renderPage(); return; }
      const ratio = 10*Math.log10(so/si), g = NP.globals, p = NP.preset;
      if(g.lvlRef == null){ g.lvlRef = ratio; toast('This preset is now the reference. Match your other presets to it.', 4200); }
      else { const ch = clampN((p.level || 0) + (g.lvlRef - ratio), -24, 12); p.level = Math.round(ch*2)/2; rewire(); toast('Preset level set to ' + fmtDb(p.level) + '. Save the preset to keep it.', 3600); }
      saveState(); renderPage(); } }, 50); }

// ==================================================================== COPY AND PASTE BLOCKS
function clipGet(){ try{ return JSON.parse(localStorage.getItem(LS + '.clip') || 'null'); }catch(e){ return null; } }
function blockCopy(b){ if(!b) return; try{ localStorage.setItem(LS + '.clip', JSON.stringify({type: b.type, p: Object.assign({}, b.p), bypass: b.bypass})); }catch(e){} toast(blockName(b) + ' copied. Paste it into any preset.', 2200); if(UI.page === 'chain') renderPage(); }
function blockPaste(path){ const c = clipGet(); if(!c || !BLOCKS[c.type]) { toast('Copy a block first.'); return; } if(totalBlocks() >= MAX_BLOCKS){ toast('24 blocks is the limit. Delete one first.'); return; }
  const sel = selectedBlock(), nb = createBlock(c.type, c.p, c.bypass); let k = path, at;
  if(!k && sel){ const ref = refOf(sel); k = ref[0]; at = NP.paths[k].indexOf(sel) + 1; } if(!k) k = 'A'; if(at == null){ at = NP.paths[k].length; const li = NP.paths[k].findIndex(x => x.type === 'looper'); if(li >= 0) at = li; }
  keepRefs(() => { NP.paths[k].splice(at, 0, nb); }); rewire(); NP.selected = nb.id; renderPage(); renderEncoders(); renderTop(); toast(blockName(nb) + ' pasted', 1400); }

// ==================================================================== SHARE CODES
async function zip(str, inflate){ const cs = inflate ? new DecompressionStream('deflate-raw') : new CompressionStream('deflate-raw'); const blob = inflate ? new Blob([str]) : new Blob([new TextEncoder().encode(str)]);
  return new Uint8Array(await new Response(blob.stream().pipeThrough(cs)).arrayBuffer()); }
function b64u(u){ let s = ''; for(let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
function unb64u(s){ s = s.replace(/-/g, '+').replace(/_/g, '/'); while(s.length % 4) s += '='; const b = atob(s), u = new Uint8Array(b.length); for(let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; }
async function presetCode(){ return 'NP1.' + b64u(await zip(JSON.stringify(serializePreset()))); }
async function presetFromCode(code){ const m = /NP1\.([A-Za-z0-9_-]+)/.exec(code || ''); if(!m) throw new Error('bad'); const u = await zip(unb64u(m[1]), true); const d = JSON.parse(new TextDecoder().decode(u)); if(!d || !Array.isArray(d.A)) throw new Error('bad'); return d; }
async function shareCopy(){ const code = await presetCode();
  openModal(`<h3>Share code for "${esc(NP.preset.name)}"</h3><p class="dim">Send this text to a friend. They paste it in Neon Peach on the Presets page.</p><textarea id="shcode" readonly rows="5" class="code">${esc(code)}</textarea><div class="row wrap"><button class="primary" id="shcp">${icon('copy')}Copy</button></div>`, m => {
    $('#shcp', m).onclick = () => { const t = $('#shcode', m); t.select(); let ok = false; try{ ok = document.execCommand('copy'); }catch(e){} if(navigator.clipboard) navigator.clipboard.writeText(code).then(() => toast('Copied', 1200), () => { if(!ok) toast('Select the text and copy it'); }); else toast(ok ? 'Copied' : 'Select the text and copy it', 1200); }; }); }
function shareLoad(){ openModal(`<h3>Load a share code</h3><textarea id="shin" rows="5" class="code" placeholder="Paste a code that starts with NP1."></textarea><div class="row wrap"><button class="primary" id="shgo">Load it</button></div>`, m => {
  $('#shgo', m).onclick = async () => { try{ const d = await presetFromCode($('#shin', m).value); closeModal(); loadPreset(d); render(); const miss = [...NP.paths.A, ...NP.paths.B].some(b => (b.type === 'clone' && b.p.cid && cloneIndex(b.p.cid) < 0) || (b.type === 'cab' && b.p.irid && !libIR(b.p.irid))); toast('Loaded "' + NP.preset.name + '". Save it to a slot to keep it.' + (miss ? ' It uses a clone or IR you do not have.' : ''), 4200); }
    catch(e){ toast('That code did not work. Copy the whole thing.', 3200); } }; }); }
{ const orig = PAGE_RENDER.presets; PAGE_RENDER.presets = () => orig() + `<section class="pane share"><h4 class="pane-h">Share<em>Trade presets as a short code</em></h4><div class="row wrap"><button class="sm" id="shout">${icon('share')}Get a code for this preset</button><button class="sm" id="shin2">${icon('paste')}Load a code</button></div></section>`; }

// ==================================================================== EVENTS
document.addEventListener('DOMContentLoaded', () => {
  const pedal = $('#pedal');
  pedal.addEventListener('click', e => { if(!NP.ready) return; let x; const c = (s) => (x = e.target.closest(s));
    // library
    if(c('#libfolder')){ pickMany(true).then(importMany); return; }
    if(c('#libfiles')){ pickMany(false).then(importMany); return; }
    if(c('[data-lkind]')){ UI.lib.kind = x.dataset.lkind; libRefreshList(); return; }
    if(c('[data-lfav]')){ const cl = NP.clones.find(y => y.id === x.dataset.lfav); if(cl){ cl.fav = !cl.fav; libSave(cl); libRefreshList(); } return; }
    if(c('[data-luse]')){ const cl = NP.clones.find(y => y.id === x.dataset.luse); if(!cl) return;
      if(cl.kind !== 'ir'){ useClone(cl.id); return; }
      if(totalBlocks() >= MAX_BLOCKS){ toast('24 blocks is the limit. Delete one first.'); return; }
      const ex = [...NP.paths.A, ...NP.paths.B].find(b => b.type === 'cab'); if(ex){ ex.p.irid = cl.id; applyBlock(ex); NP.selected = ex.id; go('chain'); renderEncoders(); toast(cl.name + ' is in your Cabinet block', 1800); return; }
      const nb = createBlock('cab', {irid: cl.id}); const L = NP.paths.A; let at = L.length; const li = L.findIndex(b => b.type === 'looper'); if(li >= 0) at = li; keepRefs(() => L.splice(at, 0, nb)); rewire(); NP.selected = nb.id; go('chain'); renderEncoders(); renderTop(); toast(cl.name + ' added to path A', 1800); return; }
    if(c('[data-lren]')){ const cl = NP.clones.find(y => y.id === x.dataset.lren); if(cl) prompt2('Rename', cl.name, v => { if(!v.trim()) return; cl.name = v.trim(); libSave(cl); renderPage(); }); return; }
    if(c('[data-lexp]')){ const cl = NP.clones.find(y => y.id === x.dataset.lexp); if(cl) exportClone(cl); return; }
    if(c('[data-ldel]')){ const cl = NP.clones.find(y => y.id === x.dataset.ldel); if(cl) confirm2('Delete ' + cl.name + '? Presets that use it will fall back to a built-in sound.', () => deleteClone(cl.id).then(() => renderPage()), 'Delete'); return; }
    // blocks
    if(c('[data-browse]')){ const b = selectedBlock(); if(b) openPicker(b, x.dataset.browse); return; }
    if(c('[data-bcopy]')){ blockCopy(selectedBlock()); return; }
    if(c('[data-paste]')){ blockPaste(x.dataset.paste); return; }
    if(c('#lvlbtn')){ levelMatch(); return; }
    // song player
    if(c('#plload')){ pickFile('audio/*,video/mp4,.mp3,.wav,.flac,.m4a,.ogg,.opus').then(plLoadFile); return; }
    if(c('#plplay')){ if(PL.playing) plPause(); else plPlay(); renderPage(); return; }
    if(c('[data-plj]')){ plSeek(plPos() + (+x.dataset.plj)*PL.song.sr*PL.speed); return; }
    if(c('#plA')){ PL.A = plPos(); if(PL.B != null && PL.B <= PL.A) PL.B = null; if(PL.B != null){ PL.loopOn = true; plSyncLoop(); } renderPage(); return; }
    if(c('#plB')){ const p = plPos(); if(PL.A == null || p <= PL.A + 2000){ toast('Set A first, then let it play to the end of the part.', 2600); return; } PL.B = p; PL.loopOn = true; plSyncLoop(); renderPage(); return; }
    if(c('#plloop')){ PL.loopOn = !PL.loopOn; plSyncLoop(); renderPage(); return; }
    if(c('#plclr')){ PL.A = PL.B = null; PL.loopOn = false; plSyncLoop(); renderPage(); return; }
    if(c('#plsave')){ const s = PL.song; prompt2('Name this loop', 'Part ' + ((s.meta.loops || []).length + 1), v => { (s.meta.loops = s.meta.loops || []).push({name: v.trim() || 'Loop', a: PL.A, b: PL.B}); plSaveMeta(); renderPage(); }); return; }
    if(c('[data-pllp]')){ const l = PL.song.meta.loops[+x.dataset.pllp]; if(l){ PL.A = l.a; PL.B = l.b; PL.loopOn = true; plSyncLoop(); if(PL.playing) plPlay(l.a); else PL.pos = l.a; renderPage(); } return; }
    if(c('[data-pllpdel]')){ PL.song.meta.loops.splice(+x.dataset.pllpdel, 1); plSaveMeta(); renderPage(); return; }
    if(c('[data-plmode]')){ PL.mode = +x.dataset.plmode; plGraph(); plTone(); plPaintCtl(); return; }
    if(c('#plcount')){ PL.countIn = !PL.countIn; plPaintCtl(); return; }
    if(c('#plbpm')){ setBpm(Math.round(PL.bpm*PL.speed)); plPaintCtl(); toast('Tempo set to ' + Math.round(NP.bpm) + ' bpm. Delays and Beats follow it.', 2600); return; }
    if(c('[data-plx]')){ PL.bpm = clampN(PL.bpm*(+x.dataset.plx), 30, 300); plPaintCtl(); return; }
    if(c('#pltrain')){ PL.trainer = !PL.trainer; if(PL.trainer){ if(!plLoop()){ toast('Make a loop first. Drag across the waveform.', 2800); PL.trainer = false; } else { PL.speed = Math.max(0.4, Math.min(PL.speed, (PL.trTo - 4*PL.trStep)/100)); plRestart(); } } plPaintCtl(); return; }
    if(c('[data-plopen]')){ plOpenRecent(x.dataset.plopen); return; }
    if(c('[data-pldel]')){ const id = x.dataset.pldel; CDB.delIn('songs', id).then(() => CDB.delIn('songData', id)).catch(() => {}); PL.recent = PL.recent.filter(s => s.id !== id); renderPage(); return; }
    // recorder
    if(c('#rkgo')){ if(UI.rk.on) recStop(); else recStart(); return; }
    if(c('#rkcancel')){ takeCancelReamp(); return; }
    if(c('[data-tkplay]')){ takePlay(x.dataset.tkplay, 'mix'); return; }
    if(c('[data-tkdi]')){ takePlay(x.dataset.tkdi, 'di'); return; }
    if(c('[data-tkloop]')){ takeLoopDI(x.dataset.tkloop); return; }
    if(c('[data-tkre]')){ takeReamp(x.dataset.tkre); return; }
    if(c('[data-tksave]')){ takeSave(x.dataset.tksave, 'mix'); return; }
    if(c('[data-tksavedi]')){ takeSave(x.dataset.tksavedi, 'di'); return; }
    if(c('[data-tkren]')){ const t = UI.rk.takes.find(y => y.id === x.dataset.tkren); if(t) prompt2('Rename take', t.name, v => { if(!v.trim()) return; t.name = v.trim(); CDB.putIn('takes', t).catch(() => {}); renderPage(); }); return; }
    if(c('[data-tkdel]')){ const id = x.dataset.tkdel, t = UI.rk.takes.find(y => y.id === id); if(t) confirm2('Delete ' + t.name + '?', () => takeDelete(id), 'Delete'); return; }
    // looper and sharing
    if(c('#loopsnap')){ NP.globals.loopSnap = NP.globals.loopSnap ? 0 : 1; saveState(); renderPage(); return; }
    if(c('#shout')){ shareCopy(); return; }
    if(c('#shin2')){ shareLoad(); return; }
  });
  pedal.addEventListener('input', e => { const t = e.target, id = t.id; if(!id) return; const out = (v) => { const o = t.parentElement.querySelector('output'); if(o) o.textContent = v; };
    if(id === 'lsq'){ UI.lib.q = t.value; const el = $('#liblist'); if(el) el.innerHTML = libListHTML(false); return; }
    if(id === 'sp_lvl'){ NP.preset.level = +t.value; rewire(); out(fmtDb(+t.value)); return; }
    if(id === 'plspd'){ PL.speed = +t.value/100; out(t.value + '%'); clearTimeout(PL.rt); PL.rt = setTimeout(() => { plRestart(); plSaveMeta(); }, 180); const b = $('.pl-bpm b'); if(b) b.textContent = Math.round(PL.bpm*PL.speed); return; }
    if(id === 'plkey'){ PL.pitch = +t.value; out((PL.pitch > 0 ? '+' : '') + PL.pitch + ' st'); clearTimeout(PL.rt); PL.rt = setTimeout(() => { plRestart(); plSaveMeta(); }, 180); return; }
    if(id === 'plcent'){ PL.cents = +t.value; out((PL.cents > 0 ? '+' : '') + PL.cents + ' ¢'); clearTimeout(PL.rt); PL.rt = setTimeout(() => { plRestart(); plSaveMeta(); }, 180); return; }
    if(id === 'plvol'){ PL.vol = +t.value; out(t.value + '%'); plGraph(); plTone(); return; }
  });
  pedal.addEventListener('change', e => { const id = e.target.id; if(id === 'pltrstep') PL.trStep = +e.target.value; else if(id === 'pltrto') PL.trTo = +e.target.value; else return; plPaintCtl(); });
  // waveform: click to jump, drag to loop
  pedal.addEventListener('pointerdown', e => { if(e.target.id !== 'plwave' || !PL.song) return; e.target.setPointerCapture(e.pointerId); const p = plWaveSample(e); PL.drag = {a: p, b: p, x: e.clientX, moved: false}; });
  pedal.addEventListener('pointermove', e => { const d = PL.drag; if(!d || e.target.id !== 'plwave') return; d.b = plWaveSample(e); if(Math.abs(e.clientX - d.x) > 6) d.moved = true; });
  pedal.addEventListener('pointerup', e => { const d = PL.drag; if(!d) return; PL.drag = null;
    if(d.moved){ const a = Math.min(d.a, d.b), b = Math.max(d.a, d.b); if(b - a > PL.song.sr*0.25){ PL.A = Math.round(a); PL.B = Math.round(b); PL.loopOn = true; plSyncLoop(); if(PL.playing) plPlay(PL.A); else PL.pos = PL.A; renderPage(); return; } }
    plSeek(d.a); });
  // drop a song or a pile of models on the page
  pedal.addEventListener('dragover', e => { if((UI.page === 'practice' || UI.page === 'library') && e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files')) e.preventDefault(); });
  pedal.addEventListener('drop', e => { if(!(UI.page === 'practice' || UI.page === 'library') || !e.dataTransfer || !e.dataTransfer.files.length) return; e.preventDefault();
    const fs = Array.from(e.dataTransfer.files); if(UI.page === 'practice') plLoadFile(fs[0]); else importMany(fs); });
  // keys
  window.addEventListener('keydown', e => { if(!NP.ready || isTextField(e.target) || e.target.tagName === 'SELECT') return; if($('#modal').style.display === 'flex') return; if(e.ctrlKey || e.metaKey || e.altKey) return; const k = e.key;
    if(e.shiftKey && k.toLowerCase() === 'r'){ e.preventDefault(); e.stopImmediatePropagation(); if(UI.rk.on && !UI.rk.reamp) recStop(); else recStart(); if(UI.page !== 'record') toast(UI.rk.on ? 'Recording a take' : 'Take kept', 1200); return; }
    if(UI.page !== 'practice' || !PL.song) return;
    if(k === ' '){ if(e.target.tagName === 'BUTTON') return; e.preventDefault(); e.stopImmediatePropagation(); if(PL.playing) plPause(); else plPlay(); renderPage(); }
    else if(k === '['){ e.stopImmediatePropagation(); $('#plA') && $('#plA').click(); }
    else if(k === ']'){ e.stopImmediatePropagation(); $('#plB') && $('#plB').click(); }
    else if(k.toLowerCase() === 'l'){ e.stopImmediatePropagation(); if(PL.A != null && PL.B != null){ PL.loopOn = !PL.loopOn; plSyncLoop(); renderPage(); } } }, true);
  document.addEventListener('copy', e => { if(UI.page !== 'chain' || isTextField(document.activeElement) || String(window.getSelection() || '')) return; const b = selectedBlock(); if(!b) return; e.preventDefault(); blockCopy(b); });
  document.addEventListener('paste', e => { if(UI.page !== 'chain' || isTextField(document.activeElement) || !clipGet()) return; e.preventDefault(); blockPaste(); });
  window.addEventListener('resize', () => { if(UI.page === 'practice') plPaintWave(); });
});
function plSyncLoop(){ if(!PL.worker) return; const lp = plLoop(); PL.worker.postMessage({cmd: 'loop', loop: lp}); if(PL.playing && lp){ const p = plPos(); if(p < lp[0] || p >= lp[1]) plPlay(lp[0]); } }
// draw the waveform after each render of the practice page; load saved lists once the rig is up
{ const orig = renderPage; renderPage = function(){ orig(); if(UI.page === 'practice') requestAnimationFrame(plPaintWave); }; }
{ const wait = setInterval(() => { if(!NP.ready) return; clearInterval(wait); plRecent(); takesLoad(); }, 300); }

// ---------- Help and Global additions ----------
{ const orig = PAGE_RENDER.help; PAGE_RENDER.help = () => orig() + `<section class="pane"><h4 class="pane-h">Practice at home</h4>
  <p><b class="t-peach">Songs:</b> load a song, drag across it to loop a part, slow it down, change its key. "Turn it down" cuts the song's bass so you can play the line.</p>
  <p><b class="t-peach">Record:</b> each take keeps your clean bass. Re-amp it through any preset later. Tweak loops it while you turn knobs.</p>
  <p><b class="t-peach">Library:</b> add a whole folder of .nam models and cab IRs at once. Star your favorites. Press Browse in a Cabinet or Clone block to pick one.</p>
  <p><b class="t-peach">Even levels:</b> on the Chain page, press Match level and play for 6 seconds. Do it on each preset and they all come out the same loudness.</p>
  <p><b class="t-peach">Sharing:</b> Presets › Share gives a short code. A friend pastes it to get your preset.</p></section>`; }
{ const orig = PAGE_RENDER.global; PAGE_RENDER.global = () => { const g = NP.globals; return orig() + `<section class="pane"><h4 class="pane-h">Changing presets</h4><div class="pl-row"><span class="pl-l">Echo tails</span><button class="sm ${g.trailsGlobal !== 0 ? 'on' : ''}" id="tailsg">${g.trailsGlobal !== 0 ? 'Ring out' : 'Cut off'}</button><span class="dim">${g.trailsGlobal !== 0 ? 'Delay and reverb keep ringing after you switch.' : 'The old sound stops right away.'} A loop you recorded always comes with you.</span></div></section>`; }; }
document.addEventListener('DOMContentLoaded', () => { $('#pedal').addEventListener('click', e => { if(e.target.closest('#tailsg')){ NP.globals.trailsGlobal = NP.globals.trailsGlobal === 0 ? 1 : 0; saveState(); renderPage(); } }); });
