// ===== Neon Peach: the native audio engine (desktop app only) =====
// When the desktop app ships the C++ engine, Neon Peach talks to the audio interface directly (ASIO on Windows,
// Core Audio on Mac). The page builds its sound exactly as before; nshim.js passes every call to the engine.
const NAT_KEY = 'neonpeach.v1.native';
const NAT = { prefs: null, info: null, r: null };
function natPrefs(){ if(NAT.prefs) return NAT.prefs; let p = null; try{ p = JSON.parse(localStorage.getItem(NAT_KEY) || 'null'); }catch(e){} NAT.prefs = Object.assign({enabled: true, api: '', out: null, in: null, firstIn: 0, buffer: 64, rate: 48000}, p || {}); return NAT.prefs; }
function natSave(){ try{ localStorage.setItem(NAT_KEY, JSON.stringify(NAT.prefs)); }catch(e){} }
const API_ORDER = ['asio', 'core', 'wasapi', 'alsa', 'pulse', 'jack', 'ds'];
function natPick(devs, p){
  const apis = [...new Set(devs.map(d => d.api))].sort((a, b) => API_ORDER.indexOf(a) - API_ORDER.indexOf(b));
  let api = apis.includes(p.api) ? p.api : (apis[0] || '');
  const list = devs.filter(d => d.api === api);
  const byName = (name, pick) => list.find(d => d.name === name && pick(d));
  let out = (p.outName && byName(p.outName, d => d.outs > 0)) || list.find(d => d.defaultOut && d.outs > 0) || list.find(d => d.outs > 0);
  let inp = api === 'asio' ? out : ((p.inName && byName(p.inName, d => d.ins > 0)) || list.find(d => d.defaultIn && d.ins > 0) || list.find(d => d.ins > 0));
  return {api, apis, out, inp, list}; }
async function natStart(){
  if(!window.npNative || !window.makeNativeAudio) return false;
  const p = natPrefs(); if(!p.enabled) return false;
  try{
    NAT.info = await npNative.info(); if(!NAT.info.available){ console.warn('native engine:', NAT.info.error); return false; }
    let cfg;
    if(p.api === 'null') cfg = {api: 'null', rate: p.rate, buffer: p.buffer, fakeInput: !!p.fakeInput};
    else { const pk = natPick(NAT.info.devices, p); if(!pk.out) return false; cfg = {api: pk.api, out: pk.out.id, in: pk.inp ? pk.inp.id : pk.out.id, firstIn: p.firstIn|0, rate: p.rate, buffer: p.buffer}; NAT.pick = pk; }
    const r = await npNative.open(cfg);
    if(!r || !r.ok){ NAT.err = r && r.error || 'The audio interface would not open.'; return false; }
    NAT.r = r; NAT.cfg = cfg;
    const sh = makeNativeAudio({send: (ops) => npNative.send(ops)}, {sampleRate: r.sampleRate, outChannels: r.outChannels, baseLatency: r.buffer/r.sampleRate, outputLatency: r.outLatency});
    sh.install(window); NAT.shim = sh;
    npNative.onPacket(pk => { if(NP.ctx && NP.ctx._receive) NP.ctx._receive(pk); if(pk.errors) console.warn('native:', pk.errors); });
    UI.native = true; return true;
  }catch(e){ console.warn('native engine failed', e); NAT.err = String(e && e.message || e); return false; } }

// power on: start the engine first, then the normal start-up builds everything on it
const _powerOn = powerOn;
powerOn = async function(){ if(NP.ctx) return; const lbl = $('#pwrlbl'); if(window.npNative && natPrefs().enabled){ if(lbl) lbl.textContent = 'Opening your audio interface…'; const ok = await natStart(); if(!ok && NAT.err) setTimeout(() => toast('Low-delay engine could not start (' + NAT.err + '). Using the browser engine.', 6000), 2500); } return _powerOn(); };

// input: the interface's jacks come straight in. No microphone prompt.
const _openInput = openInput;
openInput = async function(){ if(!UI.native) return _openInput();
  if(!UI.src){ UI.src = NP.ctx.createMediaStreamSource(null); UI.src.connect(NP.rig.inPre); }
  UI.inputOk = true; if(UI.page === 'io') renderPage(); };
const _refreshDevices = refreshDevices;
refreshDevices = async function(force){ if(!UI.native) return _refreshDevices(force); try{ NAT.info = await npNative.info(); if(force) toast('Device list updated'); if(UI.page === 'io') renderPage(); }catch(e){} };

// delay readout: the engine knows its own buffers
const _latencyInfo = latencyInfo;
latencyInfo = function(){ const L = _latencyInfo(); if(!L || !UI.native || !NAT.r) return L; const out = NAT.r.outLatency*1000, inp = NAT.r.inLatency*1000; L.out = out; L.inp = inp; L.inpSaid = true; L.total = out + inp + L.chain; return L; };

const BUFS = [16, 32, 48, 64, 96, 128, 192, 256, 512];
function nativeDeviceSection(){
  const p = natPrefs(), r = NAT.r || {}, devs = (NAT.info && NAT.info.devices) || [], pk = natPick(devs, p);
  const apiName = (a) => (devs.find(d => d.api === a) || {}).apiName || a;
  const devOpt = (cur, need) => pk.list.filter(d => d[need] > 0).map(d => `<option value="${esc(d.name)}" ${cur && cur.name === d.name ? 'selected' : ''}>${esc(d.name)} (${d[need]} ${need === 'ins' ? 'in' : 'out'})</option>`).join('');
  const inCount = pk.inp ? pk.inp.ins : 2, pairs = []; for(let i = 0; i < Math.max(1, inCount); i += 2) pairs.push(i);
  const asio = pk.api === 'asio';
  return `<section class="pane span2 natpane"><h4 class="pane-h">${icon('bolt')}Low-delay engine<em>Neon Peach talks to your interface directly${asio ? ' through its ASIO driver' : ''}</em></h4>
  <div class="chips" style="margin:0 0 12px"><span class="ichip ok"><i class="ldot"></i>${esc(r.device || '')}</span><span class="ichip">${esc(apiName(r.api) || r.api || '')}</span><span class="ichip">${icon('wave')}${trimNum(((r.sampleRate || 48000)/1000).toFixed(1))} kHz</span><span class="ichip">${r.buffer || ''} samples</span><span class="ichip">${r.outChannels || 2} outputs</span></div>
  <div class="grid2"><div class="field wide"><label for="natapi">Driver</label><select id="natapi">${pk.apis.map(a => `<option value="${a}" ${a === pk.api ? 'selected' : ''}>${esc(apiName(a))}${a === 'asio' ? ' (lowest delay)' : ''}</option>`).join('')}</select></div>
  <div class="field wide"><label for="natout">${asio ? 'Interface' : 'Output'}</label><select id="natout">${devOpt(pk.out, 'outs')}</select></div>
  ${asio ? '' : `<div class="field wide"><label for="natin">Input</label><select id="natin">${devOpt(pk.inp, 'ins')}</select></div>`}
  <div class="field wide"><label for="natpair">Jacks in</label><select id="natpair">${pairs.map(i => `<option value="${i}" ${(p.firstIn|0) === i ? 'selected' : ''}>Inputs ${i + 1}${inCount > i + 1 ? '-' + (i + 2) : ''}</option>`).join('')}</select></div>
  <div class="field wide"><label for="natbuf">Buffer</label><select id="natbuf">${BUFS.map(b => `<option value="${b}" ${p.buffer === b ? 'selected' : ''}>${b} samples (${(b/(r.sampleRate || 48000)*1000).toFixed(1)} ms)</option>`).join('')}</select></div>
  <div class="field wide"><label for="natrate">Sample rate</label><select id="natrate">${[44100, 48000, 88200, 96000].map(x => `<option value="${x}" ${p.rate === x ? 'selected' : ''}>${trimNum((x/1000).toFixed(1))} kHz${x === 48000 ? ' (best for clones)' : ''}</option>`).join('')}</select></div></div>
  <div class="row wrap" style="margin-top:12px"><button class="primary" id="natapply">${icon('refresh')}Apply</button><button class="sm" id="devrefresh">${icon('refresh')}Refresh list</button><button class="sm" id="natoff">Use the browser engine instead</button></div>
  <p class="dim" style="margin-top:10px">Smaller buffers mean less delay. If you hear clicks, go one size up. ${asio ? '' : 'For the lowest delay on Windows, install your interface\'s ASIO driver from its maker.'}</p></section>`; }
function nativeOffer(){ if(!window.npNative) return ''; const p = natPrefs(); return p.enabled ? `<p class="dim" style="margin-top:10px">${esc(NAT.err ? 'The low-delay engine could not start: ' + NAT.err : 'The low-delay engine is not running.')}</p>` : `<div class="row wrap" style="margin-top:10px"><button class="sm primary" id="naton">${icon('bolt')}Use the low-delay engine</button></div>`; }

document.addEventListener('DOMContentLoaded', () => { const pedal = $('#pedal');
  pedal.addEventListener('click', async (e) => { const t = e.target.closest('#natapply, #natoff, #naton'); if(!t) return; const p = natPrefs();
    if(t.id === 'natoff' || t.id === 'naton'){ p.enabled = t.id === 'naton'; natSave(); confirm2(p.enabled ? 'Switch to the low-delay engine? Neon Peach restarts its sound.' : 'Switch to the browser engine? Neon Peach restarts its sound.', () => { try{ saveState(); }catch(err){} location.reload(); }, 'Restart sound'); return; }
    // apply device settings
    const v = (id) => { const el = document.getElementById(id); return el ? el.value : null; };
    const api = v('natapi'); if(api !== p.api){ p.api = api; p.outName = null; p.inName = null; } else { p.outName = v('natout'); p.inName = v('natin') || p.outName; }
    p.firstIn = +(v('natpair') || 0); p.buffer = +(v('natbuf') || 64); const rate = +(v('natrate') || 48000);
    const pk = natPick((NAT.info && NAT.info.devices) || [], p); if(!pk.out){ toast('No output device for that driver.'); return; }
    if(rate !== (NAT.r && NAT.r.sampleRate)){ p.rate = rate; natSave(); confirm2('Changing the sample rate restarts Neon Peach\'s sound. Your presets are saved first.', () => { try{ saveState(); }catch(err){} location.reload(); }, 'Restart sound'); return; }
    natSave(); toast('Opening ' + pk.out.name + '…', 1500);
    const r = await npNative.open({api: pk.api, out: pk.out.id, in: pk.inp ? pk.inp.id : pk.out.id, firstIn: p.firstIn, rate, buffer: p.buffer});
    if(!r || !r.ok){ toast('That did not open: ' + (r && r.error || 'unknown error'), 5000); return; }
    if(r.fresh){ try{ saveState(); }catch(err){} location.reload(); return; }
    NAT.r = r; NP.ctx._outChannels = r.outChannels; NP.ctx.baseLatency = r.buffer/r.sampleRate; NP.ctx.outputLatency = r.outLatency; UI.pingMs = null; routeOutputs(true); renderPage(); renderTop(); toast('Now using ' + r.device + ', ' + r.buffer + ' samples', 2500); });
  pedal.addEventListener('change', (e) => { if(e.target.id === 'natapi'){ const p = natPrefs(); p.api = e.target.value; p.outName = p.inName = null; NAT.prefs = p; renderPage(); } });
});
