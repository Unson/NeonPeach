// ===== Neon Peach UI: render layer =====
const $=(s,el=document)=>el.querySelector(s); const $$=(s,el=document)=>Array.from(el.querySelectorAll(s));
const esc=(s)=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const cap=(s)=>s.charAt(0).toUpperCase()+s.slice(1);
const UI={ page:'chain', lastPage:null, prevPage:'chain', encPage:0, banks:[], viewBank:0, target:null,
  midi:{on:false, inputs:[], outputs:[], outId:'', pcEnabled:true, clock:false, learn:null, maps:[]},
  io:{inputId:'', outputId:''}, toastT:null, scenePage:0, demoOn:false, holdT:null, holdFs:null, tapTimes:[],
  mIn:0, mOut:0, sig:0, beatOn:false, theme:16, modalClick:null, tNote:null, tc:0, tf:0, tunerMute:false };

// ---------- Palette: one neon per block family ----------
const CAT_COLOR={ Dynamics:'#46ffb4', Drive:'#ff6b3d', Amp:'#ffb23d', Clone:'#f2f5ff', Cab:'#ffe14f', EQ:'#bbff3d', Pitch:'#e14bff', Synth:'#ff3fa8', Filter:'#2ff5e3', Mod:'#a66bff', Delay:'#36b9ff', Reverb:'#7d8dff', Utility:'#cdc4e6', Routing:'#7ff0c8', Looper:'#ff4f70' };
Object.values(BLOCKS).forEach(d=>{ d.color=CAT_COLOR[d.cat]||'#ffffff'; });
const HUES=[['Peach',16],['Coral',2],['Hot pink',330],['Violet',272],['Ice',188],['Acid',92],['Gold',44]];

// ---------- Icons (24px line art) ----------
const DOT='fill="currentColor" stroke="none"';
const IS_APP=!!window.npDesktop;   // running as the desktop app
const ICO={
  chain:'<circle cx="5" cy="12" r="2.2"/><circle cx="19" cy="6" r="2.2"/><circle cx="19" cy="18" r="2.2"/><path d="M7.2 12H10l6.8-6M10 12l6.8 6"/>',
  grid:'<rect x="4" y="4" width="6.5" height="6.5" rx="1.5"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.5"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.5"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.5"/>',
  layers:'<path d="M12 3.5 21 8.5 12 13.5 3 8.5Z"/><path d="M3 12.5l9 5 9-5"/><path d="M3 16.5l9 5 9-5" opacity=".5"/>',
  stomp:'<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="3.5"/>',
  tuner:'<path d="M3.5 17a8.5 8.5 0 0 1 17 0"/><path d="M12 17l3.5-6"/><path d="M12 8.5V7M6.2 11.2l-1-1M17.8 11.2l1-1"/>',
  loop:'<path d="M17 3l3 3-3 3"/><path d="M4 11v-1a4 4 0 0 1 4-4h12"/><path d="M7 21l-3-3 3-3"/><path d="M20 13v1a4 4 0 0 1-4 4H4"/>',
  target:'<circle cx="12" cy="12" r="7.5"/><circle cx="12" cy="12" r="2.5"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>',
  match:'<path d="M2.5 12c2.4-5 4.8-5 7.2 0s4.8 5 7.2 0 3.2-3 4.6-1.5"/><path d="M2.5 18h19M2.5 6h19" opacity=".45"/>',
  plug:'<path d="M9 3v5M15 3v5"/><path d="M6.5 8h11v3a5.5 5.5 0 0 1-11 0Z"/><path d="M12 16.5V21"/>',
  midi:'<circle cx="12" cy="12" r="8.5"/><circle cx="7.6" cy="12.6" r="1.1" '+DOT+'/><circle cx="16.4" cy="12.6" r="1.1" '+DOT+'/><circle cx="9" cy="8.8" r="1.1" '+DOT+'/><circle cx="15" cy="8.8" r="1.1" '+DOT+'/><circle cx="12" cy="7.5" r="1.1" '+DOT+'/><path d="M10.5 18h3"/>',
  globe:'<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.6 2.4 3.8 5.2 3.8 8.5s-1.2 6.1-3.8 8.5M12 3.5C9.4 5.9 8.2 8.7 8.2 12s1.2 6.1 3.8 8.5"/>',
  help:'<circle cx="12" cy="12" r="8.5"/><path d="M9.6 9.3a2.5 2.5 0 1 1 3.4 2.4c-.7.3-1 .8-1 1.6v.4"/><circle cx="12" cy="16.7" r="1" '+DOT+'/>',
  comp:'<path d="M4 5l6 7-6 7M20 5l-6 7 6 7"/>',
  bolt:'<path d="M13.5 2.5 5 13.5h6.5l-1 8 8.5-11h-6.5Z"/>',
  amp:'<rect x="3" y="6" width="18" height="12" rx="2.5"/><circle cx="8" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="16" cy="12" r="1.6"/>',
  cab:'<rect x="4.5" y="3" width="15" height="18" rx="2.5"/><circle cx="12" cy="14" r="4"/><circle cx="12" cy="14" r="1" '+DOT+'/><circle cx="12" cy="6.8" r="1"/>',
  eq:'<path d="M6 4v8.5M6 16.5V20M12 4v2.5M12 10.5V20M18 4v10M18 18v2"/><path d="M3.8 14.5h4.4M9.8 8.5h4.4M15.8 16h4.4"/>',
  pitch:'<path d="M8 20V4M4.5 7.5 8 4l3.5 3.5M16 4v16M12.5 16.5 16 20l3.5-3.5"/>',
  saw:'<path d="M3 17 8 7v10l5-10v10l5-10v10l3-6"/>',
  filter:'<path d="M3 8.5h7.5c3.5 0 4.5 9 10.5 9"/>',
  sine:'<path d="M2.5 12c1.6-5.3 3.2-5.3 4.8 0s3.2 5.3 4.8 0 3.2-5.3 4.8 0 3.2 5.3 4.6 0"/>',
  dots:'<circle cx="5" cy="12" r="2.6"/><circle cx="12" cy="12" r="2" opacity=".7"/><circle cx="18.2" cy="12" r="1.5" opacity=".45"/>',
  waves:'<circle cx="4.5" cy="12" r="1.6" '+DOT+'/><path d="M8.5 8.5a5 5 0 0 1 0 7M12.5 5.5a9.5 9.5 0 0 1 0 13"/><path d="M16.5 3a13 13 0 0 1 0 18" opacity=".55"/>',
  util:'<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
  power:'<path d="M12 3.5v8"/><path d="M6.6 6.6a7.6 7.6 0 1 0 10.8 0"/>',
  left:'<path d="M14.5 5.5 8 12l6.5 6.5"/>',
  right:'<path d="M9.5 5.5 16 12l-6.5 6.5"/>',
  swap:'<path d="M7 4v15M3.5 15.5 7 19l3.5-3.5M17 20V5M13.5 8.5 17 5l3.5 3.5"/>',
  copy:'<rect x="8.5" y="8.5" width="11.5" height="11.5" rx="2"/><path d="M15.5 8.5V5.5a1.5 1.5 0 0 0-1.5-1.5H5.5A1.5 1.5 0 0 0 4 5.5V14a1.5 1.5 0 0 0 1.5 1.5h3"/>',
  trash:'<path d="M4 7h16M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13M10 11v5.5M14 11v5.5"/>',
  plus:'<path d="M12 5v14M5 12h14"/>',
  play:'<path d="M8 5.5v13l10.5-6.5Z" '+DOT+'/>',
  stop:'<rect x="6.5" y="6.5" width="11" height="11" rx="1.5" '+DOT+'/>',
  rec:'<circle cx="12" cy="12" r="6.5" '+DOT+'/>',
  undo:'<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
  reverse:'<path d="M20 12H5M10.5 6.5 5 12l5.5 5.5"/>',
  down:'<path d="M12 4v11M7 10.5l5 5 5-5M5 20h14"/>',
  up:'<path d="M12 16V5M7 9.5l5-5 5 5M5 20h14"/>',
  save:'<path d="M5 4h11l3 3v13H5Z"/><path d="M8.5 4v4.5h6V4M8 20v-6h8v6"/>',
  refresh:'<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 5v6h-6"/>',
  mic:'<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"/>',
  file:'<path d="M6 3h8l4 4v14H6Z"/><path d="M14 3v4h4"/>',
  x:'<path d="M6 6l12 12M18 6 6 18"/>',
  expand:'<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  wave:'<path d="M3 12h2l2-6 3 12 3-9 2 5 2-2h4"/>',
  clock:'<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  mute:'<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M15.5 9.5l5 5M20.5 9.5l-5 5"/>',
  gear:'<circle cx="12" cy="12" r="3"/><path d="M12 2.8v2.6M12 18.6v2.6M2.8 12h2.6M18.6 12h2.6M5.5 5.5l1.8 1.8M16.7 16.7l1.8 1.8M5.5 18.5l1.8-1.8M16.7 7.3l1.8-1.8"/><circle cx="12" cy="12" r="6.6"/>',
  spark:'<path d="M12 2.5l1.9 5.6 5.6 1.9-5.6 1.9L12 17.5l-1.9-5.6L4.5 10l5.6-1.9Z"/><path d="M18.5 15.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8Z"/>',
  drum:'<ellipse cx="12" cy="8" rx="8" ry="3"/><path d="M4 8v8c0 1.7 3.6 3 8 3s8-1.3 8-3V8"/><path d="M8.5 4.5 5 1.5M15.5 4.5 19 1.5"/>',
  stage:'<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/><circle cx="8.5" cy="10" r="1.6" '+DOT+'/><circle cx="12" cy="10" r="1.6" '+DOT+'/><circle cx="15.5" cy="10" r="1.6" '+DOT+'/>',
  search:'<circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5 21 21"/>',
  lens:'<circle cx="12" cy="12" r="8.5"/><path d="M14.4 3.8 9.6 12.2M20 10.6l-9.6.1M17 18.4l-4.8-8.4M9.6 20.2l4.8-8.4M4 13.4l9.6-.1M7 5.6l4.8 8.4"/>'
};
const CAT_ICON={ Dynamics:'comp', Drive:'bolt', Amp:'amp', Clone:'lens', Cab:'cab', EQ:'eq', Pitch:'pitch', Synth:'saw', Filter:'filter', Mod:'sine', Delay:'dots', Reverb:'waves', Utility:'util', Routing:'plug', Looper:'loop' };
function icon(n,cls=''){ return `<svg class="ico ${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICO[n]||''}</svg>`; }
// playing pages sit in the screen's rail; setup pages sit in the header
// Some pages share one button and show tabs at the top: Switches, Clone and Settings.
const GROUPS={ switches:{l:'Switches', i:'stomp', pages:[['scenes','Scenes','layers'],['stomp','Stomp','stomp']]},
  clone:{l:'Clone', i:'lens', pages:[['clone','Clone','lens'],['match','Tone Match','match']]},
  settings:{l:'Settings', i:'gear', pages:[['io','Audio','plug'],['outs','Outputs','plug'],['midi','MIDI','midi'],['global','Global','globe']]} };
const RAIL=[['chain','Chain','chain'],['presets','Presets','grid'],['wizard','Wizard','spark'],['@switches'],'|',['tuner','Tuner','tuner'],['looper','Looper','loop'],['drums','Beats','drum'],['@clone']];
const SYS=[['@settings'],['help','Help','help']];
const PAGES=[['chain'],['presets'],['wizard'],['scenes'],['stomp'],['tuner'],['looper'],['drums'],['clone'],['match'],['io'],['outs'],['midi'],['global'],['help']];
function groupOf(page){ for(const k in GROUPS) if(GROUPS[k].pages.some(p=>p[0]===page)) return k; return null; }
UI.groupLast={switches:'scenes', clone:'clone', settings:'io'};

// ---------- Formatting ----------
function trimNum(s){ return s.includes('.') ? s.replace(/0+$/,'').replace(/\.$/,'') : s; }
function sgn(v,d=0){ const a=Math.abs(v).toFixed(d); return (+a===0?'':(v>0?'+':'−'))+a; }
function fmtDb(v){ if(v<=-99.5) return 'Off'; if(Math.abs(v)<0.05) return '0 dB'; return sgn(v,1)+' dB'; }
function fmtHz(v){ return v>=1000 ? trimNum((v/1000).toFixed(v>=10000?1:2))+' kHz' : Math.round(v)+' Hz'; }
function fmtPan(v){ v=Math.round(v); return v===0?'Center':(v<0?'L ':'R ')+Math.abs(v); }
function fmtVal(spec,v){ if(spec.e) return spec.e[Math.round(v)] ?? ''; const u=spec.u||'';
  switch(u){
    case '%': return Math.round(v)+'%';
    case 'Hz': return fmtHz(v);
    case 'ms': return v>=1000 ? trimNum((v/1000).toFixed(2))+' s' : (v<10?trimNum(v.toFixed(1)):Math.round(v))+' ms';
    case 'dB': return fmtDb(v);
    case 's': return trimNum(v.toFixed(2))+' s';
    case ':1': return trimNum(v.toFixed(1))+':1';
    case 'st': return sgn(v)+' st';
    case 'c': return sgn(v)+' ¢';
    case 'x': return Math.round(v)+'×';
    default: return (spec.step||0)>=1 ? String(Math.round(v)) : (Math.abs(v)>=100?v.toFixed(0):Math.abs(v)>=10?v.toFixed(1):v.toFixed(2));
  } }

function toast(msg, ms=2000){ const t=$('#toast'); t.textContent=msg; t.classList.add('on'); clearTimeout(UI.toastT); UI.toastT=setTimeout(()=>t.classList.remove('on'),ms); }
function paramSpec(b,k){ const d=BLOCKS[b.type], s=d.params[k]; if(!s) return null;
  if(d.spec){ const o=d.spec(b,k,s); if(o) return o; }   // a block can rename or reshape a control from its settings
  if(b.type==='clone'&&k==='clone') return Object.assign({},s,{e:[b.p.cid&&cloneIndex(b.p.cid)<0?'(missing)':'(none)'].concat(NP.clones.map(c=>c.name)), max:NP.clones.length});
  if(b.type==='capture'&&k==='cap') return Object.assign({},s,{e:['(none)'].concat(NP.captures.map(c=>c.name)), max:NP.captures.length});
  const CK={cab:'irid', cabA:'idA', cabB:'idB'}; if((b.type==='cab'||b.type==='cab2')&&CK[k]){ const id=b.p[CK[k]], r=libIR(id), e=CAB_NAMES.concat(NP.irs.map(i=>i.name)); if(id) e.push(r?'★ '+r.name:'(IR not on this device)'); return Object.assign({},s,{e, max:e.length-1}); }
  return s; }
function setParam(b,k,v){ const s=paramSpec(b,k); if(!s||s.hidden) return; v=clampN(v,s.min,s.max); if(s.step) v=Math.round(v/s.step)*s.step; b.p[k]=v; { const CK={cab:'irid', cabA:'idA', cabB:'idB'}; if((b.type==='cab'||b.type==='cab2')&&CK[k]&&v<CAB_NAMES.length+NP.irs.length) b.p[CK[k]]=''; } if(b.type==='clone'&&k==='clone'){ const c=NP.clones[v-1]; b.p.cid=c?c.id:''; clearTimeout(UI.clT); UI.clT=setTimeout(()=>{ if(UI.page==='chain') renderPage(); renderEncoders(); },60); } applyBlock(b); if(k==='trails') setBypass(b,b.bypass,true); updateParamViews(b,k); }

// ---------- Block references that survive moves ----------
function refOf(b){ let i=NP.paths.A.indexOf(b); if(i>=0) return 'A'+i; i=NP.paths.B.indexOf(b); return i>=0?'B'+i:null; }
function refBlock(ref){ if(!ref) return null; const k=ref[0], i=parseInt(ref.slice(1)); return (NP.paths[k]||[])[i]||null; }
function keepRefs(fn){ const P=NP.preset;
  const st={}; ['A','B','C'].forEach(f=>st[f]=P.stomps[f].map(x=>({b:refBlock(x.ref),mode:x.mode})));
  const sc=P.scenes.map(s=>{ if(!s.data) return null; const m=new Map(); ['A','B'].forEach(k=>NP.paths[k].forEach((b,j)=>m.set(b,{p:s.data.params[k][j],by:s.data.bypass[k][j]}))); return m; });
  const ex=P.exp.target?refBlock(P.exp.target.ref):null;
  const mm=UI.midi.maps.map(m=>m.target.startsWith('byp:')?refBlock(m.target.slice(4)):(m.bid?NP.blocks[m.bid]:null));
  fn();
  ['A','B','C'].forEach(f=>{ P.stomps[f]=st[f].map(x=>({ref:x.b?refOf(x.b):null,mode:x.mode})).filter(x=>x.ref); });
  P.scenes.forEach((s,i)=>{ const m=sc[i]; if(!m) return; ['A','B'].forEach(k=>{ s.data.params[k]=NP.paths[k].map(b=>m.has(b)?m.get(b).p:null); s.data.bypass[k]=NP.paths[k].map(b=>m.has(b)?m.get(b).by:null); }); });
  if(P.exp.target){ const r=ex?refOf(ex):null; if(r) P.exp.target.ref=r; else P.exp.target=null; }
  UI.midi.maps.forEach((m,i)=>{ const b=mm[i]; if(!b) return; const r=refOf(b); if(!r) return; if(m.target.startsWith('byp:')) m.target='byp:'+r; else m.ref=r; });
}
function expBlock(){ const t=NP.preset&&NP.preset.exp.target; return t&&t.ref?refBlock(t.ref):null; }
function ensureB(){ const s=NP.preset.split; if(s.mode===3){ toast('Path B is off in "A only". Pick another split to hear it.', 3200); return; } if(s.bLvl<=-60){ s.bLvl=0; rewire(); toast('Path B turned up to 0 dB so you can hear it'); } }

// ---------- Storage ----------
const LS='neonpeach.v1';
function saveState(){ if(!NP.preset) return; try{ const st={ banks:UI.banks, bank:NP.bank, slot:NP.slot, globals:NP.globals, midi:{pcEnabled:UI.midi.pcEnabled, clock:UI.midi.clock, maps:UI.midi.maps, outId:UI.midi.outId}, io:UI.io, current:serializePreset(), mode:NP.mode, theme:UI.theme, tunerMute:UI.tunerMute }; localStorage.setItem(LS, JSON.stringify(st)); localStorage.setItem(LS+'.cap', JSON.stringify(NP.captures.map(c=>({name:c.name, curve:Array.from(c.curve), ir:Array.from(c.ir)})))); localStorage.setItem(LS+'.ir', JSON.stringify(NP.irs.map(i=>({name:i.name, data:Array.from(i.data)})))); }catch(e){ console.warn(e); toast('Could not save. Browser storage may be full.'); } }
function loadState(){ let st=null; try{ st=JSON.parse(localStorage.getItem(LS)||'null'); }catch(e){}
  try{ NP.captures=(JSON.parse(localStorage.getItem(LS+'.cap')||'[]')).map(c=>({name:c.name, curve:Float32Array.from(c.curve), ir:Float32Array.from(c.ir)})); }catch(e){ NP.captures=[]; }
  try{ NP.irs=(JSON.parse(localStorage.getItem(LS+'.ir')||'[]')).map(i=>({name:i.name, data:Float32Array.from(i.data)})); }catch(e){ NP.irs=[]; }
  NP.globals=Object.assign({geq:[0,0,0,0,0,0], master:0, inGain:0, pad:0, inCh:0, mute:0, tunerRef:440, trailsGlobal:1, mainOut:0, auxOut:1, auxSrc:0, auxLvl:0, mono:0, drumLvl:70}, st&&st.globals||{});
  if(st&&st.banks&&st.banks.length===128){ UI.banks=st.banks; } else { UI.banks=new Array(128).fill(null); factoryPresets().forEach((p,i)=>UI.banks[i]=p); }
  NP.bank=st&&st.bank||0; NP.slot=st&&st.slot||0; if(st&&st.midi) Object.assign(UI.midi, st.midi); if(st&&st.io) Object.assign(UI.io, st.io); NP.mode=st&&st.mode||'preset';
  UI.theme=(st&&typeof st.theme==='number'&&st.theme!==20)?st.theme:16; UI.tunerMute=!!(st&&st.tunerMute);
  return st; }

// ---------- Power on: the sign lights, then the rig ----------
async function powerOn(){ if(NP.ctx) return; const btn=$('#power'), lbl=$('#pwrlbl'), sign=$('#splash .sign'); btn.classList.add('busy'); lbl.textContent='Starting up…'; sign.classList.add('lit');
  const minWait=new Promise(r=>setTimeout(r,1000)); const AC=window.AudioContext||window.webkitAudioContext; let ctx;
  try{ ctx=new AC({latencyHint:'interactive', sampleRate:48000}); }catch(e){ ctx=new AC({latencyHint:'interactive'}); }
  NP.ctx=ctx; const code=$('#worklet-src').textContent;
  try{ await ctx.audioWorklet.addModule('data:application/javascript;base64,'+btoa(unescape(encodeURIComponent(code)))); }
  catch(e1){ try{ await ctx.audioWorklet.addModule(URL.createObjectURL(new Blob([code],{type:'application/javascript'}))); }
    catch(e2){ NP.ctx=null; try{ ctx.close(); }catch(e){} btn.classList.remove('busy'); sign.classList.remove('lit'); lbl.textContent='The audio engine could not start. Use a current Chrome, Edge or Firefox.'; return; } }
  buildRig(); const st=loadState(); applyTheme(); loadPreset(st&&st.current?st.current:UI.banks[0]); loadClones(); kernels().catch(()=>{}); UI.viewBank=NP.bank; UI.target=NP.bank*8+NP.slot; applyGlobals(); NP.ready=true; if(typeof v2Start==='function') v2Start();
  await minWait; $('#splash').style.display='none'; const pedal=$('#pedal'); pedal.style.display=''; pedal.classList.add('on-enter');
  render(); requestAnimationFrame(tick); window.addEventListener('keydown', onKey); setInterval(saveState, 15000); window.addEventListener('beforeunload', saveState);
  await openInput(); initMIDI(); }

async function openInput(){ try{ if(UI.stream){ UI.stream.getTracks().forEach(t=>t.stop()); UI.src&&UI.src.disconnect(); }
    const c={audio:{echoCancellation:false, noiseSuppression:false, autoGainControl:false, channelCount:2, latency:0}}; if(UI.io.inputId) c.audio.deviceId={exact:UI.io.inputId};
    UI.stream=await navigator.mediaDevices.getUserMedia(c); UI.src=NP.ctx.createMediaStreamSource(UI.stream); UI.src.connect(NP.rig.inPre); UI.inputOk=true; toast('Input open: '+(UI.stream.getAudioTracks()[0].label||'microphone'));
    if(NP.ctx.setSinkId && UI.io.outputId){ try{ await NP.ctx.setSinkId(UI.io.outputId); }catch(e){} }
  }catch(e){ UI.inputOk=false; toast('No audio input yet. Pick one on the I/O page, or play the demo riff there.', 4200); }
  if(UI.page==='io') renderPage(); }

// ---------- Render ----------
function render(){ renderTop(); renderNav(); renderPage(); renderEncoders(); renderFoot(); }
function renderTop(){ const p=NP.preset; const sc=NP.scene>=0?p.scenes[NP.scene]:null;
  $('#status').innerHTML=`<div class="st-mode m-${NP.mode}"><i></i>${cap(NP.mode)}</div><div class="st-num">${NP.bank+1}-${NP.slot+1}</div><div class="st-name"><span>${esc(p.name)}</span></div>${sc?`<div class="st-scene">${icon('layers')}${esc(sc.name)}</div>`:''}<div class="st-meta"><b>${Math.round(NP.bpm)}</b>bpm</div>${latChip()}${cloneChip()}`; }
function navItem(p){ if(p[0][0]==='@'){ const k=p[0].slice(1), g=GROUPS[k], on=groupOf(UI.page)===k; return [UI.groupLast[k], g.l, g.i, on]; } return [p[0], p[1], p[2], UI.page===p[0]]; }
function renderNav(){ $('#nav').innerHTML=RAIL.map(p=>{ if(p==='|') return '<div class="nav-sep"></div>'; const [id,l,ic,on]=navItem(p); return `<button class="tab ${on?'on':''}" data-page="${id}" aria-current="${on?'page':'false'}">${icon(ic)}<span>${l}</span></button>`; }).join('');
  $('#sysnav').innerHTML=`<button class="sbtn stagebtn" id="stagego" title="Stage mode: big switches for playing live (F)" aria-label="Stage mode">${icon('stage')}<span>Stage</span></button>`+SYS.map(p=>{ const [id,l,ic,on]=navItem(p); return `<button class="sbtn ${on?'on':''}" data-page="${id}" title="${l}" aria-label="${l}" aria-current="${on?'page':'false'}">${icon(ic)}<span>${l}</span></button>`; }).join(''); }
function subTabs(){ const g=groupOf(UI.page); if(!g) return ''; return `<div class="subtabs" role="tablist">${GROUPS[g].pages.map(([id,l,ic])=>`<button class="stab ${UI.page===id?'on':''}" data-page="${id}" role="tab" aria-selected="${UI.page===id}">${icon(ic)}${l}</button>`).join('')}</div>`; }
function renderPage(){ const el=$('#page'); if(!el) return; const same=UI.lastPage===UI.page; const st=same?el.scrollTop:0; const lanes={}; if(same) $$('.pblocks',el).forEach(x=>lanes[x.dataset.path]=x.scrollLeft);
  const fn=PAGE_RENDER[UI.page]; el.innerHTML=`<div class="pg pg-${UI.page} ${same?'':'enter'}">${subTabs()}${fn?fn():''}</div>`; el.scrollTop=st;
  $$('.pblocks',el).forEach(x=>{ if(lanes[x.dataset.path]) x.scrollLeft=lanes[x.dataset.path]; }); paintRanges(el); UI.lastPage=UI.page; }
function go(page){ const gk=groupOf(page); if(gk) UI.groupLast[gk]=page; if(page!=='tuner' && UI.page!=='tuner') UI.prevPage=page; if(UI.page==='clone' && page!=='clone') stopPreview(); UI.page=page; NP.tunerMute=(page==='tuner'&&UI.tunerMute); cloneGuardSync(); UI.tNote=null; if(page==='io') refreshDevices(); renderNav(); renderPage(); }
const PAGE_RENDER={};
function paintRange(el){ const mn=+el.min, mx=+el.max, v=+el.value; const f=(v-mn)/((mx-mn)||1); const z=(mn<0&&mx>0&&!el.dataset.uni)?(-mn)/(mx-mn):0; el.style.setProperty('--a',(Math.min(z,f)*100).toFixed(2)+'%'); el.style.setProperty('--b',(Math.max(z,f)*100).toFixed(2)+'%'); }
function paintRanges(root){ $$('input[type=range]',root).forEach(paintRange); }

// --- Chain page: lit tubes ---
function blockName(b){ const d=BLOCKS[b.type]; if(b.type==='clone'){ const c=NP.clones&&NP.clones[cloneIndex(b.p.cid)]; if(c) return c.name; } return d.name; }
function chip(b){ const d=BLOCKS[b.type], nm=blockName(b); return `<div class="blk chip ${b.bypass?'off':''} ${NP.selected===b.id?'sel':''}" data-bid="${b.id}" draggable="true" style="--c:${d.color}" title="${esc(nm)}"><div class="chip-top">${icon(CAT_ICON[d.cat])}<button class="led" data-tog="${b.id}" title="${b.bypass?'Turn on':'Bypass'}" aria-label="${b.bypass?'Turn on':'Bypass'} ${esc(d.name)}"></button></div><div class="chip-name">${esc(nm)}</div><div class="chip-cat">${d.cat}</div></div>`; }
PAGE_RENDER.chain=()=>{ const s=NP.preset.split, m=s.mode; const bOff = m===3 || (m!==2 && s.bLvl<=-60);
  const tag=(k)=>{ if(k==='A') return m===1?`A<em>lows below ${fmtHz(s.xo)}</em>`:m===2?'A<em>first</em>':'A';
    if(m===3) return 'B<em>off in A only</em>'; if(m===2) return 'B<em>after A</em>'; if(s.bLvl<=-60) return 'B<em>off. Tap to turn on.</em>'; return m===1?`B<em>highs above ${fmtHz(s.xo)}</em>`:'B'; };
  const tagEl=(k)=> k==='B'&&m!==3&&m!==2&&s.bLvl<=-60 ? `<button class="ltag" data-bon="1" title="Turn path B up to 0 dB">${tag(k)}</button>` : `<span class="ltag">${tag(k)}</span>`;
  const lane=(k)=>`<div class="lane lane-${k.toLowerCase()} ${k==='B'&&bOff?'muted':''}"><div class="pblocks" data-path="${k}">${tagEl(k)}${NP.paths[k].map(chip).join('')}<button class="addb" data-add="${k}" title="Add a block to path ${k}" aria-label="Add a block to path ${k}">${icon('plus')}</button>${clipGet()?`<button class="addb paste" data-paste="${k}" title="Paste the copied block at the end of path ${k}" aria-label="Paste into path ${k}">${icon('paste')}</button>`:''}</div></div>`;
  const b=NP.selected&&NP.blocks[NP.selected];
  return `<div class="stage" style="--sig:${UI.sig.toFixed(2)}"><canvas id="scope" aria-hidden="true"></canvas><div class="flow m${m} ${bOff&&m!==2?'b-off':''}"><div class="node n-in">IN</div><div class="lanes">${lane('A')}${lane('B')}</div><div class="node n-out">OUT</div></div></div>
  <div class="chain-cards">${b?blockEditor(b):`<div class="empty-ed">${icon('chain')}<div><b>Pick a block to edit it.</b>Tap + to add one. Drag blocks to move them. Tap the light on a block to turn it on or off.</div></div>`}${mixer()}</div>`; };
function field(label,id,min,max,step,v,txt,dis,uni){ return `<div class="field ${dis?'dis':''}"><label for="${id}">${label}</label><input type="range" id="${id}" min="${min}" max="${max}" step="${step}" value="${v}" ${uni?'data-uni="1"':''} ${dis?'disabled':''}><output>${txt}</output></div>`; }
function mixer(){ const s=NP.preset.split, m=s.mode; const modes=[['Parallel','Both paths play at once'],['Crossover','Lows go to A, highs go to B'],['Series','A feeds into B'],['A only','Path B is off']];
  return `<section class="pane mixer"><h4 class="pane-h">Signal split<em>${modes[m][1]}</em></h4><div class="seg">${modes.map(([n,t],i)=>`<button class="${m===i?'on':''}" data-split="${i}" title="${t}">${n}</button>`).join('')}</div>
  <div class="fields">${field('Crossover','sp_xo',50,1500,5,s.xo,fmtHz(s.xo),m!==1)}${field('Path A','sp_a',-60,12,0.5,s.aLvl,fmtDb(s.aLvl),m===2,true)}${field('Path B','sp_b',-100,12,0.5,s.bLvl,fmtDb(s.bLvl),m===3,true)}${field('B pan','sp_pan',-100,100,1,s.bPan,fmtPan(s.bPan),m===3)}
  <div class="field ${m===3?'dis':''}"><label>B phase</label><div><button class="sm ${s.bPol?'on':''}" id="sp_pol">${s.bPol?'Flipped':'Normal'}</button></div><span></span></div>
  ${field('Preset level','sp_lvl',-24,12,0.5,NP.preset.level||0,fmtDb(NP.preset.level||0),false,true)}<div class="field"><label>Even out</label><div><button class="sm" id="lvlbtn" title="Play for 6 seconds. This preset is set to the same loudness as your other matched presets.">${UI.lvl?'Listening…':(NP.globals.lvlRef==null?'Set reference':'Match level')}</button></div><span></span></div></div></section>`; }
function visKeys(type){ const ps=BLOCKS[type].params; return Object.keys(ps).filter(k=>!ps[k].hidden); }
function blockEditor(b){ const d=BLOCKS[b.type]; const path=refOf(b)[0]; const rows=visKeys(b.type).map(k=>paramRow(b,k)).join('')+(b.type==='clone'?`<div class="prow wide cl-state" id="clstate_${b.id}">${cloneStateHTML(b)}</div>`:'');
  const brw=(k,l)=>`<button class="sm" data-browse="${k}">${icon('folder')}${l}</button>`;
  const extra = (b.type==='clone' ? brw('clone','Browse')+`<button class="sm" data-page-go="clone">${icon('lens')}Clone page</button>` : b.type==='cab' ? brw('cab','Browse IRs')+`<button class="sm" id="irload">${icon('up')}Load IR</button>` : b.type==='cab2' ? brw('cabA','Browse A')+brw('cabB','Browse B') : b.type==='looper' ? `<button class="sm" data-page-go="looper">${icon('loop')}Open looper</button>` : '')+`<button class="sm" data-bcopy="1" title="Copy this block (Ctrl+C). Paste it into any preset.">${icon('copy')}Copy</button>`;
  return `<section class="pane editor ${b.bypass?'is-off':''}" style="--c:${d.color}"><div class="ed-h"><div class="ed-id"><span class="ed-ico">${icon(CAT_ICON[d.cat])}</span><div><div class="ed-name">${esc(blockName(b))}</div><div class="ed-sub">${d.desc?esc(d.desc):d.cat+' block on path '+path}</div></div></div>
  <div class="ed-act"><button class="sm pwr ${b.bypass?'':'on'}" data-tog="${b.id}">${icon('power')}${b.bypass?'Off':'On'}</button><button class="ib" data-mv="-1" title="Move left" aria-label="Move left">${icon('left')}</button><button class="ib" data-mv="1" title="Move right" aria-label="Move right">${icon('right')}</button><button class="ib" data-swap="1" title="Move to path ${path==='A'?'B':'A'}" aria-label="Move to path ${path==='A'?'B':'A'}">${icon('swap')}</button><button class="ib" data-dup="1" title="Copy" aria-label="Copy block">${icon('copy')}</button><button class="ib danger" data-del="1" title="Delete" aria-label="Delete block">${icon('trash')}</button>${extra}</div></div>
  ${d.note&&d.note(b)?`<p class="blknote">${esc(d.note(b))}</p>`:''}${d.gr?`<div class="grm"><span>Squeeze</span><div class="grbar"><i id="grbar_${b.id}"></i></div><output id="grv_${b.id}">0 dB</output></div>`:''}<div class="params">${rows}</div></section>`; }
function paramRow(b,k){ const s=paramSpec(b,k), v=b.p[k];
  if(s.bool) return `<div class="prow bool"><span class="pl">${esc(s.l)}</span><button class="switch ${v?'on':''}" data-bool="${k}" data-pb="${b.id}" aria-pressed="${!!v}" aria-label="${esc(s.l)}"><i></i></button><span class="pv" id="pv_${b.id}_${k}">${v?'On':'Off'}</span></div>`;
  if(s.e && s.e.length<=4 && b.type!=='clone') return `<div class="prow wide"><span class="pl">${esc(s.l)}</span><div class="seg sm">${s.e.map((o,i)=>`<button class="${Math.round(v)===i?'on':''}" data-seg="${k}" data-pb="${b.id}" data-v="${i}" title="${esc(o)}">${esc(o)}</button>`).join('')}</div></div>`;
  if(s.e) return `<div class="prow wide"><span class="pl">${esc(s.l)}</span><select data-pk="${k}" data-pb="${b.id}" aria-label="${esc(s.l)}">${s.e.map((o,i)=>`<option value="${i}" ${Math.round(v)===i?'selected':''}>${esc(o)}</option>`).join('')}</select></div>`;
  const t=NP.preset.exp.target, isExp=t&&expBlock()===b&&t.key===k; const step=s.step||((s.max-s.min)/400);
  return `<div class="prow"><span class="pl" title="${esc(s.l)}">${esc(s.l)}</span><input type="range" data-pk="${k}" data-pb="${b.id}" min="${s.min}" max="${s.max}" step="${step}" value="${v}" aria-label="${esc(s.l)}"><span class="pv" id="pv_${b.id}_${k}">${fmtVal(s,v)}</span><button class="expb ${isExp?'on':''}" data-exp="${k}" title="${isExp?'Unlink from':'Link to'} the expression pedal">EXP</button></div>`; }
function updateParamViews(b,k){ const s=paramSpec(b,k); const v=b.p[k]; const pv=document.getElementById('pv_'+b.id+'_'+k); if(pv) pv.textContent=s.bool?(v?'On':'Off'):fmtVal(s,v);
  const inp=$(`input[data-pk="${k}"][data-pb="${b.id}"]`); if(inp&&document.activeElement!==inp){ inp.value=v; paintRange(inp); }
  const sel=$(`select[data-pk="${k}"][data-pb="${b.id}"]`); if(sel) sel.value=String(Math.round(v));
  $$(`[data-seg="${k}"][data-pb="${b.id}"]`).forEach(x=>x.classList.toggle('on', +x.dataset.v===Math.round(v)));
  const sw=$(`[data-bool="${k}"][data-pb="${b.id}"]`); if(sw){ sw.classList.toggle('on',!!v); sw.setAttribute('aria-pressed',String(!!v)); }
  refreshKnobs(); }

// --- Library ---
const NEW_BLOCKS=['head','raspberry'];
function showLibrary(path){ if(totalBlocks()>=MAX_BLOCKS){ toast('24 blocks is the limit. Delete one first.'); return; }
  const sel=selectedBlock&&selectedBlock(), after=sel&&refOf(sel)&&refOf(sel)[0]===path?sel:null;
  const groups=CATS.map(c=>{ const items=Object.values(BLOCKS).filter(d=>d.cat===c && (d.type!=='capture'||NP.captures.length)); if(!items.length) return ''; return `<div class="lgroup" data-cat="${c}" style="--c:${CAT_COLOR[c]}"><div class="lcat">${icon(CAT_ICON[c])}${c}</div><div class="litems">${items.map(d=>`<button class="litem" data-lib="${d.type}" data-q="${esc((d.name+' '+c+' '+(d.desc||'')).toLowerCase())}" title="${esc(d.desc||'')}"><b>${esc(d.name)}${NEW_BLOCKS.includes(d.type)?'<i class="newtag">new</i>':''}</b><span>${esc(d.desc||'')}</span></button>`).join('')}</div></div>`; }).join('');
  openModal(`<div class="m-h"><h3>Add a block</h3><span class="ptag p-${path.toLowerCase()}">Path ${path}</span>${after?`<span class="dim">Goes after ${esc(blockName(after))}</span>`:''}</div><label class="libsearch">${icon('search')}<input id="libq" placeholder="Search: fuzz, octave, chorus, clean…" aria-label="Search blocks" autocomplete="off"></label><div class="lib">${groups}</div>`, (m)=>{
    const q=$('#libq'); q.focus(); q.oninput=()=>{ const v=q.value.trim().toLowerCase(); $$('.litem',m).forEach(x=>x.style.display=!v||x.dataset.q.includes(v)?'':'none'); $$('.lgroup',m).forEach(g=>g.style.display=$$('.litem',g).some(x=>x.style.display!=='none')?'':'none'); };
    q.onkeydown=(e)=>{ if(e.key==='Enter'){ const f=$$('.litem',m).find(x=>x.style.display!=='none'); if(f) f.click(); } };
    UI.modalClick=(e)=>{ const t=e.target.closest('[data-lib]'); if(!t) return; const b=createBlock(t.dataset.lib); const arr=NP.paths[path];
      keepRefs(()=>{ if(after&&arr.includes(after)) arr.splice(arr.indexOf(after)+1,0,b); else arr.push(b); }); rewire(); NP.selected=b.id; UI.encPage=0; closeModal(); if(path==='B') ensureB(); render(); }; }); }
function openModal(html, init){ const m=$('#modal'); UI.modalClick=null; m.innerHTML=`<div class="mbox" role="dialog" aria-modal="true"><button class="mx" id="mclose" aria-label="Close">${icon('x')}</button>${html}</div>`; m.style.display='flex'; if(init) init(m); const f=m.querySelector('input, .litem, button.primary, button.danger'); if(f) f.focus(); }
function closeModal(){ const m=$('#modal'); m.style.display='none'; m.innerHTML=''; UI.modalClick=null; }

// --- Presets ---
PAGE_RENDER.presets=()=>{ const vb=UI.viewBank; const bankHas=i=>UI.banks.slice(i*8,i*8+8).some(Boolean); const tgt=UI.target??(NP.bank*8+NP.slot);
  const banks=Array.from({length:16},(_,i)=>`<button class="bk ${vb===i?'on':''} ${bankHas(i)?'has':''}" data-bank="${i}" aria-label="Bank ${i+1}">${i+1}</button>`).join('');
  const slots=Array.from({length:8},(_,i)=>{ const idx=vb*8+i, p=UI.banks[idx]; const loaded=NP.bank===vb&&NP.slot===i; const dots=p?[...(p.A||[]),...(p.B||[])].map(bl=>`<i style="--c:${(BLOCKS[bl.type]||{}).color||'#888'}"></i>`).join(''):'';
    return `<button class="slot ${loaded?'on':''} ${tgt===idx?'cur':''} ${p?'':'empty'}" data-slot="${i}"><span class="sn">${vb+1}-${i+1}</span><span class="sname">${p?esc(p.name):'Empty slot'}</span><span class="sdots">${dots}</span></button>`; }).join('');
  const tb=Math.floor(tgt/8)+1, ts=tgt%8+1;
  return `<div class="banks-wrap"><span>Bank</span><div class="banks">${banks}</div></div><div class="slots">${slots}</div>
  <div class="grid2"><section class="pane"><h4 class="pane-h">Save this sound</h4><div class="row wrap"><input id="pname" value="${esc(NP.preset.name)}" placeholder="Preset name" maxlength="40" aria-label="Preset name"><button class="primary" id="psave">${icon('save')}Save to ${tb}-${ts}</button></div><div class="row wrap"><button class="sm" id="pnew">${icon('plus')}Start a blank preset</button><button class="sm danger" id="pclear">${icon('trash')}Clear slot ${tb}-${ts}</button></div></section>
  <section class="pane"><h4 class="pane-h">Backup<em>${IS_APP?'Saved on this computer, with automatic backups':'Presets live in this browser'}</em></h4><div class="row wrap"><button class="sm" id="pexport">${icon('down')}Export all</button><button class="sm" id="pexport1">${icon('down')}Export this preset</button><button class="sm" id="pimport">${icon('up')}Import</button></div><div class="row wrap"><button class="sm danger" id="pfactory">${icon('refresh')}Restore factory presets</button></div></section></div>
  <p class="hint">Tap a full slot to load it. Tap an empty slot to pick where Save puts your sound. In Preset mode, footswitch A goes back, B goes forward, and C taps the tempo.</p>`; };

// --- Scenes ---
PAGE_RENDER.scenes=()=>{ const pads=NP.preset.scenes.map((s,i)=>`<div class="pad ${NP.scene===i?'on':''} ${s.data?'':'empty'}"><button class="pad-b" data-scene="${i}" aria-label="Scene ${i+1}: ${esc(s.name)}"><span class="pad-n">${i+1}</span><span class="pad-s">${s.data?(NP.scene===i?'Playing':'Saved'):'Empty'}</span><span class="pad-t">${esc(s.name)}</span></button><div class="pad-a"><button class="xs" data-scsave="${i}">${icon('save')}Save</button><button class="xs" data-scname="${i}">Rename</button><button class="xs ib" data-scclear="${i}" title="Clear scene ${i+1}" aria-label="Clear scene ${i+1}">${icon('x')}</button></div></div>`).join('');
  return `<div class="pads">${pads}</div><p class="hint">A scene remembers which blocks are on and how every knob is set. Save your sound to a pad, then jump between pads with no gap. In Scene mode, footswitches A, B and C pick scenes. Hold A to reach the next three.</p>`; };

// --- Stomp ---
PAGE_RENDER.stomp=()=>{ const all=[...NP.paths.A.map((b,i)=>({b,ref:'A'+i})),...NP.paths.B.map((b,i)=>({b,ref:'B'+i}))];
  const cols=['A','B','C'].map(f=>{ const m=NP.preset.stomps[f];
    const rows=all.map(({b,ref})=>{ const d=BLOCKS[b.type], e=m.find(x=>x.ref===ref); return `<div class="srow" style="--c:${d.color}"><label class="tgl"><input type="checkbox" data-st="${f}" data-ref="${ref}" ${e?'checked':''}><span class="sname">${icon(CAT_ICON[d.cat])}<span>${esc(d.name)}</span></span></label>${e?`<select data-stmode="${f}" data-ref="${ref}" aria-label="What footswitch ${f} does to ${esc(d.name)}"><option value="toggle" ${e.mode==='toggle'?'selected':''}>Flip</option><option value="on" ${e.mode==='on'?'selected':''}>Turn on</option><option value="off" ${e.mode==='off'?'selected':''}>Turn off</option></select>`:`<span class="sref">Path ${ref[0]}</span>`}</div>`; }).join('');
    return `<section class="pane stompcol"><h4 class="pane-h"><span class="mini-fs">${f}</span>Footswitch ${f}<em class="r">${m.length} block${m.length===1?'':'s'}</em></h4>${rows||'<p class="dim">Add blocks on the Chain page first.</p>'}</section>`; }).join('');
  return `<div class="grid3">${cols}</div><p class="hint">In Stomp mode, each footswitch flips the blocks you pick here. One switch can flip many blocks at once, like a drive and a chorus together.</p>`; };

// --- Tuner ---
PAGE_RENDER.tuner=()=>`<div class="tuner"><div class="tstrip"><span class="tarrow" id="tflat" title="Flat">${icon('left')}</span><div class="tleds" id="tleds">${Array.from({length:25},(_,i)=>`<i class="${i===12?'mid':''}"></i>`).join('')}</div><span class="tarrow" id="tsharp" title="Sharp">${icon('right')}</span></div>
  <div class="tnote" id="tnote">–</div><div class="tread"><span id="tfreq">Play a string</span><span id="tcents"></span></div>
  <div class="tset"><div class="row"><label for="tref">A4 =</label><input type="number" id="tref" value="${NP.globals.tunerRef}" min="415" max="466"><span class="dim">Hz</span></div><label class="tgl"><input type="checkbox" id="tmute" ${UI.tunerMute?'checked':''}><span>Mute the output while tuning</span></label></div></div>`;
function tunerTick(){ const an=NP.rig.inAn; if(!UI.tbuf||UI.tbuf.length!==an.fftSize) UI.tbuf=new Float32Array(an.fftSize); an.getFloatTimeDomainData(UI.tbuf); const f=detectPitch(UI.tbuf,NP.ctx.sampleRate); const nn=$('#tnote'); if(!nn) return;
  if(f>0){ const n=noteFromFreq(f,NP.globals.tunerRef); if(UI.tNote!==n.midi){ UI.tNote=n.midi; UI.tc=n.cents; } else UI.tc=UI.tc*0.6+n.cents*0.4; const c=UI.tc, ac=Math.abs(c), st=ac<3?'ok':ac<12?'near':'off';
    nn.innerHTML=n.name+'<sub>'+n.octave+'</sub>'; nn.className='tnote '+st; $('#tfreq').textContent=f.toFixed(1)+' Hz'; $('#tcents').textContent=st==='ok'?'In tune':sgn(c)+' cents';
    const idx=Math.max(0,Math.min(24,12+Math.round(c/4))); const leds=$('#tleds').children; for(let i=0;i<25;i++){ const lit=st==='ok'?Math.abs(i-12)<=1:i===idx; leds[i].className=(i===12?'mid ':'')+(lit?'lit '+st:''); }
    $('#tflat').classList.toggle('lit', st!=='ok'&&c<0); $('#tsharp').classList.toggle('lit', st!=='ok'&&c>0); }
  else if(UI.tNote!==null){ UI.tNote=null; nn.textContent='–'; nn.className='tnote'; $('#tfreq').textContent='Play a string'; $('#tcents').textContent=''; $$('#tleds i').forEach((x,i)=>x.className=i===12?'mid':''); $('#tflat').classList.remove('lit'); $('#tsharp').classList.remove('lit'); } }

// --- Looper ---
const LOOP_LABEL={empty:'Empty',rec:'Rec',play:'Play',over:'Dub',stop:'Stopped'};
function findLooper(){ return [...NP.paths.A,...NP.paths.B].find(b=>b.type==='looper'); }
PAGE_RENDER.looper=()=>{ const lb=findLooper(); if(!lb) return `<div class="empty-ed">${icon('loop')}<div><b>There is no looper in this preset.</b>Add one to the end of path A to start looping.</div><button class="primary" id="addlooper">${icon('plus')}Add looper</button></div>`;
  const s=lb.loopState||{state:'empty',len:0,pos:0,sr:48000}; const pct=s.len?s.pos/s.len*100:(s.state==='rec'?100:0);
  return `<div class="looper st-${s.state}"><div class="lring"><svg viewBox="0 0 200 200" aria-hidden="true"><circle class="lr-track" cx="100" cy="100" r="88"/><circle class="lr-fill" id="lfill" cx="100" cy="100" r="88" pathLength="100" style="stroke-dasharray:${pct.toFixed(2)} 100"/></svg><div class="lr-in"><div class="lstate" id="lstate">${LOOP_LABEL[s.state]||s.state}</div><div class="ltime" id="ltime">${loopTime(s)}</div></div></div>
  <div class="lpads"><button class="lpad rec" data-loop="rec">${icon('rec')}Record / dub</button><button class="lpad play" data-loop="play">${icon('play')}Play</button><button class="lpad" data-loop="stop">${icon('stop')}Stop</button><button class="lpad" data-loop="undo">${icon('undo')}Undo</button><button class="lpad ${s.reverse?'on':''}" data-loop="reverse">${icon('reverse')}Reverse</button><button class="lpad ${s.half?'on':''}" data-loop="half"><b>½</b>Half speed</button><button class="lpad danger" data-loop="clear">${icon('trash')}Clear</button></div>
  <section class="pane loop-set"><div class="fields">${field('Loop level','llvl',0,200,1,lb.p.level,Math.round(lb.p.level)+'%',false,true)}${field('Dub fade','lfb',0,100,1,lb.p.feedback,Math.round(lb.p.feedback)+'%',false,true)}</div></section>
  <p class="hint">Loops run up to 3 minutes. Dub fade sets how much of the old loop stays each time you dub over it. Hold footswitch B in any mode to record. Keys: R records, S stops.</p></div>`; };
function loopTime(s){ if(!s.sr) return ''; return s.state==='rec'?(s.pos/s.sr).toFixed(1)+' s':s.len?(s.pos/s.sr).toFixed(1)+' / '+(s.len/s.sr).toFixed(1)+' s':'0.0 s'; }
window.onLooperState=(b)=>{ if(UI.page!=='looper' || b!==findLooper()) return; const s=b.loopState, root=$('.looper'); if(!root) return; root.className='looper st-'+s.state; $('#lstate').textContent=LOOP_LABEL[s.state]||s.state;
  const pct=s.len?s.pos/s.len*100:(s.state==='rec'?100:0); $('#lfill').style.strokeDasharray=pct.toFixed(2)+' 100'; $('#ltime').textContent=loopTime(s);
  const r=$('[data-loop="reverse"]'), h=$('[data-loop="half"]'); if(r) r.classList.toggle('on',!!s.reverse); if(h) h.classList.toggle('on',!!s.half); };

// --- Tone Match ---
PAGE_RENDER.match=()=>`<div class="lead"><div class="lead-ico">${icon('match')}</div><div><h3>Tone Match</h3><p>Sound more like a record you love. It sets an EQ to close the gap.</p></div></div>
  <div class="steps"><div class="step ${UI.matchRef?'done':''}"><b>1</b><div>Load a song or bass track you like.<button class="sm" id="mref">${icon('file')}Load reference</button><span class="stat" id="mrefstat">${UI.matchRefName?esc(UI.matchRefName):'No file yet'}</span></div></div>
  <div class="step ${UI.matchMe?'done':''}"><b>2</b><div>Play your bass for 5 seconds.<button class="sm" id="mme">${icon('mic')}Listen to me</button><span class="stat" id="mmestat">${UI.matchMe?'Got it':''}</span></div></div>
  <div class="step"><b>3</b><div>Set how strong the match is, then apply it.<div class="field"><label for="mstr">Strength</label><input type="range" id="mstr" min="0" max="100" value="${UI.matchStr??80}" data-uni="1"><output>${UI.matchStr??80}%</output></div><button class="primary" id="mapply">Apply match</button></div></div></div>
  <div id="mresult">${UI.matchGains?matchBars(UI.matchGains):''}</div>`;
function matchBars(g){ return `<section class="pane"><h4 class="pane-h">Your match<em>Cyan bands go up. Pink bands go down.</em></h4><div class="eqbars">${g.map((v,i)=>{ const h=Math.min(50,Math.abs(v)/12*50), f=GEQ_F[i]; return `<div class="eqb"><output>${sgn(v,1)}</output><div class="area"><div class="zero"></div><div class="bar ${v<0?'neg':''}" style="${v<0?'top':'bottom'}:50%;height:${h.toFixed(1)}%"></div></div><span>${f>=1000?(f/1000)+'k':f}</span></div>`; }).join('')}</div></section>`; }

// --- I/O ---
PAGE_RENDER.io=()=>{ const ins=(UI.devices||[]).filter(d=>d.kind==='audioinput'), outs=(UI.devices||[]).filter(d=>d.kind==='audiooutput');
  const opt=(list,cur,dflt)=>`<option value="">${dflt}</option>`+list.filter(d=>d.deviceId&&d.deviceId!=='default').map((d,i)=>`<option value="${esc(d.deviceId)}" ${cur===d.deviceId?'selected':''}>${esc(d.label||('Device '+(i+1)))}</option>`).join('');
  const ctx=NP.ctx; const lat=((ctx.baseLatency||0)+(ctx.outputLatency||0))*1000; const bl=UI.btLevel??70;
  const devSection = typeof nativeDeviceSection==='function' && UI.native ? nativeDeviceSection() : `<section class="pane span2"><h4 class="pane-h">Audio devices</h4><div class="grid2"><div class="field wide"><label for="indev">Input</label><select id="indev">${opt(ins,UI.io.inputId,'System default')}</select></div><div class="field wide"><label for="outdev">Output</label><select id="outdev" ${ctx.setSinkId?'':'disabled'}>${opt(outs,UI.io.outputId,'System default')}</select></div></div>
  <div class="chips"><span class="ichip ${UI.inputOk?'ok':'bad'}"><i class="ldot"></i>${UI.inputOk?'Input open':'No input'}</span><span class="ichip ${ctx.state==='running'?'ok':'bad'}"><i class="ldot"></i>Engine ${ctx.state==='running'?'running':ctx.state}</span><span class="ichip">${icon('wave')}${trimNum((ctx.sampleRate/1000).toFixed(1))} kHz</span><span class="ichip">${icon('clock')}Output ${lat.toFixed(1)} ms</span><span class="ichip">${outChannels()} outputs</span><button class="sm" id="devrefresh">${icon('refresh')}Refresh list</button></div>${typeof nativeOffer==='function'?nativeOffer():''}</section>`;
  return `<div class="grid2">${latencyPane()}${devSection}
  <section class="pane"><h4 class="pane-h">Input level</h4><div class="field wide"><label>Your bass is in</label><div class="seg sm" role="group" aria-label="Input jack">${['Input 1','Input 2','Both'].map((t,i)=>`<button class="${(NP.globals.inCh|0)===i?'on':''}" data-inch="${i}" aria-pressed="${(NP.globals.inCh|0)===i}">${t}</button>`).join('')}</div></div><p class="dim" style="margin:4px 0 10px">Pick the jack your bass is plugged into. The bass is mono, so Neon Peach plays it on both sides.</p><div class="fields">${field('Gain','ingain',-24,24,0.5,NP.globals.inGain,fmtDb(NP.globals.inGain))}</div><label class="tgl"><input type="checkbox" id="inpad" ${NP.globals.pad?'checked':''}><span>−6 dB pad, for hot basses</span></label></section>
  <section class="pane"><h4 class="pane-h">Demo riff</h4><p class="dim" style="margin-bottom:12px">A built-in bass riff. Use it to try sounds with no bass plugged in.</p><button class="${UI.demoOn?'on':''}" id="demo">${icon(UI.demoOn?'stop':'play')}${UI.demoOn?'Stop the demo riff':'Play the demo riff'}</button></section>
  <section class="pane"><h4 class="pane-h">Backing track<em>${UI.btName?esc(UI.btName):'No file loaded'}</em></h4><div class="row wrap"><button class="sm" id="btload">${icon('file')}Load a file</button><button class="sm ${UI.btPlaying?'on':''}" id="btplay">${icon(UI.btPlaying?'stop':'play')}${UI.btPlaying?'Stop':'Play'}</button></div><div class="fields" style="margin-top:8px">${field('Level','btlvl',0,100,1,bl,bl+'%',false,true)}</div></section>
  <section class="pane"><h4 class="pane-h">Record the output</h4><p class="dim" style="margin-bottom:12px">Saves everything you hear as a stereo WAV file.</p><button class="${UI.recOn?'rec':''}" id="recbtn">${icon(UI.recOn?'stop':'rec')}${UI.recOn?'Stop and save the WAV':'Start recording'}</button></section></div>`; };

// --- MIDI ---
const MIDI_TARGETS=[['fsA','Footswitch A'],['fsB','Footswitch B'],['fsC','Footswitch C'],['exp','Expression pedal'],['tap','Tap tempo'],['tuner','Tuner on/off'],['prev','Previous preset'],['next','Next preset'],['scene','Scene 1 to 8 (by value)'],['mute','Mute'],['drums','Beats start/stop'],['stage','Stage mode on/off']];
PAGE_RENDER.midi=()=>{ const m=UI.midi; const ins=m.inputs.length?m.inputs.map(i=>`<div class="list-row"><span>${esc(i.name)}</span></div>`).join(''):'<p class="dim">No MIDI devices found.</p>';
  const maps=m.maps.length?m.maps.map((x,i)=>`<div class="mrow"><span class="cc">CC ${x.cc}</span><span class="dim">Ch ${x.ch+1}</span><span class="to">${esc(x.label)}</span><button class="xs danger ib" data-mdel="${i}" title="Remove" aria-label="Remove CC ${x.cc}">${icon('x')}</button></div>`).join(''):'<p class="dim">No knobs or pedals are linked yet.</p>';
  const bt=[...NP.paths.A.map((b,i)=>['byp:A'+i,'Turn on/off: '+BLOCKS[b.type].name+' (path A)']),...NP.paths.B.map((b,i)=>['byp:B'+i,'Turn on/off: '+BLOCKS[b.type].name+' (path B)'])];
  const sel=NP.selected&&NP.blocks[NP.selected]; const pt=sel?visKeys(sel.type).map(k=>['prm:'+k, BLOCKS[sel.type].name+': '+BLOCKS[sel.type].params[k].l]):[];
  return `<div class="grid2"><section class="pane"><h4 class="pane-h">Devices</h4><div class="chips" style="margin:0 0 10px"><span class="ichip ${m.on?'ok':'bad'}"><i class="ldot"></i>${m.on?'MIDI is on':'No MIDI here. Use Chrome or Edge.'}</span></div>${ins}
  <label class="tgl"><input type="checkbox" id="mpc" ${m.pcEnabled?'checked':''}><span>Program Change picks presets</span></label><label class="tgl"><input type="checkbox" id="mclock" ${m.clock?'checked':''}><span>Follow the MIDI clock tempo</span></label>
  <div class="field wide" style="margin-top:6px"><label for="mout">Send to</label><select id="mout"><option value="">Nothing</option>${(m.outputs||[]).map(o=>`<option value="${esc(o.id)}" ${m.outId===o.id?'selected':''}>${esc(o.name)}</option>`).join('')}</select></div></section>
  <section class="pane"><h4 class="pane-h">Link a control</h4><p class="dim" style="margin-bottom:12px">Pick what to control. Press Learn. Then move a knob or pedal on your MIDI gear.</p><div class="row wrap"><select id="mtarget" aria-label="What to control">${MIDI_TARGETS.concat(bt).concat(pt).map(([v,l])=>`<option value="${esc(v)}">${esc(l)}</option>`).join('')}</select><button class="${m.learn?'rec':'primary'}" id="mlearn">${m.learn?'Move a control now…':'Learn'}</button></div><p class="dim" style="margin-top:12px">To link a block's knobs, pick the block on the Chain page first.</p></section>
  <section class="pane span2"><h4 class="pane-h">Linked controls</h4>${maps}</section></div>`; };

// --- Global ---
PAGE_RENDER.global=()=>{ const g=NP.globals; const f=['60','180','500','1.2k','3k','8k'];
  return `<div class="grid2"><section class="pane span2"><h4 class="pane-h">Room EQ<em>Shapes the final sound for the room. It sits after everything else.</em></h4><div class="geq">${f.map((l,i)=>`<div class="gband"><output id="geqv${i}">${fmtDb(g.geq[i])}</output><div class="vfader"><input type="range" data-geq="${i}" min="-12" max="12" step="0.5" value="${g.geq[i]}" aria-label="${l} Hz"></div><span>${l}</span></div>`).join('')}</div></section>
  <section class="pane"><h4 class="pane-h">Output</h4><div class="fields">${field('Master','gmaster',-60,12,0.5,g.master,fmtDb(g.master),false,true)}</div><label class="tgl"><input type="checkbox" id="gmute" ${g.mute?'checked':''}><span>Mute everything</span></label></section>
  <section class="pane"><h4 class="pane-h">Glow color</h4><div class="swatches">${HUES.map(([n,h])=>`<button class="sw ${Math.round(UI.theme)===h?'on':''}" data-hue="${h}" style="--h:${h}"><i></i>${n}</button>`).join('')}</div><div class="fields">${field('Fine tune','gtheme',0,360,1,UI.theme,'',false,true).replace('type="range"','type="range" class="hue"')}</div></section>
  <section class="pane"><h4 class="pane-h">System</h4><div class="row wrap"><button class="sm" id="gsave">${icon('save')}Save now</button><button class="sm" id="gfs">${icon('expand')}Full screen</button><button class="sm danger" id="greset">${icon('trash')}Erase everything</button></div></section>
  <section class="pane"><h4 class="pane-h">Keyboard</h4><div class="keys"><span><kbd>1</kbd><kbd>2</kbd><kbd>3</kbd>Footswitches</span><span><kbd>Space</kbd>Tap tempo</span><span><kbd>T</kbd>Tuner</span><span><kbd>M</kbd>Next mode</span><span><kbd>R</kbd>Loop record</span><span><kbd>S</kbd>Loop stop</span><span><kbd>B</kbd>Beats</span><span><kbd>F</kbd>Stage mode</span><span><kbd>Ctrl</kbd><kbd>Z</kbd>Undo</span></div></section></div>`; };

// --- Help ---
const HELP_FEAT=[['Drive','Eleven drives, including Split Grind (clean lows, dirty highs), Peach Muff and Octave Fuzz.'],['Amp','The Neon 900 and Melted Raspberry: Darkglass-style heads with Microtubes and Alpha·Omega drive. Plus eight classic amp heads with sag.'],['Clone','Copy any pedal or plugin, or load .nam and IR files. Exports .nam files too.'],['Cab','Eight cabs, four mic types, and your own IR files.'],['Dynamics','Compressor with blend, three-band compressor, gate, limiter and Auto Swell. None of them add delay.'],['EQ','Parametric, 10-band graphic, a 6-band shaper, cuts, and Tone Match.'],['Pitch','Sub octave, pitch shift and a two-voice harmonizer.'],['Synth','Peach Synth follows the notes you play. Freeze holds a note as a pad.'],['Filter','Envelope filter, pedal wah, Talk Box and a multi filter.'],['Mod','Chorus, flanger, phaser, tremolo, vibrato, rotary, ring mod, bit crusher, Doubler and Stutter.'],['Delay','Digital, tape, analog, ping pong, multi-tap and reverse. Tempo sync and trails.'],['Routing','FX Loop for real pedals. Aux Send for a stage amp.'],['Reverb','Room, hall, plate, spring, cathedral and shimmer.'],['Looper','Three minutes. Dub, undo, reverse and half speed.']];
PAGE_RENDER.help=()=>`<div class="lead"><div class="lead-ico">${icon('help')}</div><div><h3>How Neon Peach works</h3><p>Plug your bass into an audio interface. On the I/O page, pick the interface and the jack your bass is in. Build a chain on two paths. Save it as a preset. Then play it live with the footswitches.</p></div></div>
  <div class="feat">${HELP_FEAT.map(([c,t])=>`<div class="fcard" style="--c:${CAT_COLOR[c]}">${icon(CAT_ICON[c])}<b>${c}</b><span>${t}</span></div>`).join('')}</div>
  <div class="grid2"><section class="pane"><h4 class="pane-h">The three modes</h4><p><b class="t-cyan">Preset:</b> A goes back, B goes forward, C taps the tempo.</p><p><b class="t-pink">Scene:</b> A, B and C jump between scenes.</p><p><b class="t-peach">Stomp:</b> A, B and C flip the blocks you pick.</p><p>Hold C in any mode for the tuner. Hold B to record a loop.</p></section>
  <section class="pane"><h4 class="pane-h">Tips</h4><p>New here? Open the Wizard. Pick a style and it builds the whole rig.</p><p>Set your interface to its smallest buffer size. That cuts the lag. The clock in the top bar shows the total.</p>${IS_APP?'<p>Everything saves on this computer. Backups go to Documents › Neon Peach › Backups every few minutes.</p>':'<p>Chrome and Edge work best. They also support MIDI.</p><p>Everything saves in this browser. Export your presets now and then to keep a backup.</p>'}</section></div>`;

// ---------- Knobs ----------
const KARC='M 21.72 78.28 A 40 40 0 1 1 78.28 78.28';
const KTICKS=(()=>{ let d=''; for(let i=0;i<=10;i++){ const a=(135+i*27)*Math.PI/180, c=Math.cos(a), s=Math.sin(a); d+=`M${(50+46*c).toFixed(2)} ${(50+46*s).toFixed(2)}L${(50+49.5*c).toFixed(2)} ${(50+49.5*s).toFixed(2)}`; } return d; })();
const EMPTY_KNOB=`<div class="knob empty" aria-hidden="true"><div class="kring"><svg viewBox="0 0 100 100"><path class="ktick" d="${KTICKS}"/><path class="ktrack" d="${KARC}"/></svg><div class="kcap"><i></i></div></div><div class="kl">&nbsp;</div><div class="kv">&nbsp;</div></div>`;
function encoderTargets(){ const b=NP.selected&&NP.blocks[NP.selected]; if(b){ const keys=visKeys(b.type); const pages=Math.ceil(keys.length/6); UI.encPage=Math.min(UI.encPage,pages-1); return {b, keys:keys.slice(UI.encPage*6,UI.encPage*6+6), pages}; }
  return {b:null, keys:['inGain','master','aLvl','bLvl','bpm','xo'], pages:1}; }
const GLOBAL_ENC={ inGain:{l:'Input',min:-24,max:24,u:'dB',def:0,get:()=>NP.globals.inGain,set:v=>{NP.globals.inGain=v;applyGlobals();}}, master:{l:'Master',min:-60,max:12,u:'dB',def:0,uni:true,get:()=>NP.globals.master,set:v=>{NP.globals.master=v;applyGlobals();}}, aLvl:{l:'Path A',min:-60,max:12,u:'dB',def:0,uni:true,get:()=>NP.preset.split.aLvl,set:v=>{NP.preset.split.aLvl=v;rewire();}}, bLvl:{l:'Path B',min:-100,max:12,u:'dB',def:0,uni:true,get:()=>NP.preset.split.bLvl,set:v=>{NP.preset.split.bLvl=v;rewire();}}, bpm:{l:'Tempo',min:40,max:300,u:'',step:1,def:120,uni:true,get:()=>NP.bpm,set:v=>{setBpm(v);}}, xo:{l:'Crossover',min:50,max:1500,u:'Hz',def:200,uni:true,get:()=>NP.preset.split.xo,set:v=>{NP.preset.split.xo=v;rewire();}} };
function knobGeom(spec,v){ const f=clampN((v-spec.min)/((spec.max-spec.min)||1),0,1); const bip=!spec.e&&!spec.uni&&spec.min<0&&spec.max>0; const z=bip?(-spec.min)/(spec.max-spec.min):0; const lo=Math.min(z,f), hi=Math.max(z,f); return {da:`${((hi-lo)*100).toFixed(2)} 200`, off:(-lo*100).toFixed(2), ang:-135+f*270}; }
function knobHTML(i,k,spec,v){ const g=knobGeom(spec,v); return `<div class="knob" data-enc="${i}" data-key="${k}" title="${esc(spec.l)}: drag up or down. Tap to reset." role="slider" aria-label="${esc(spec.l)}" aria-valuetext="${esc(fmtVal(spec,v))}"><div class="kring"><svg viewBox="0 0 100 100" aria-hidden="true"><path class="ktick" d="${KTICKS}"/><path class="ktrack" d="${KARC}" pathLength="100"/><path class="kval" d="${KARC}" pathLength="100" style="stroke-dasharray:${g.da};stroke-dashoffset:${g.off}"/></svg><div class="kcap"><i style="transform:rotate(${g.ang.toFixed(1)}deg)"></i></div></div><div class="kl">${esc(spec.l)}</div><div class="kv">${fmtVal(spec,v)}</div></div>`; }
function encSig(t){ return (t.b?t.b.id:'g')+':'+UI.encPage+':'+t.keys.join(','); }
function renderEncoders(){ const el=$('#encoders'); if(!el) return; const t=encoderTargets(); el.style.setProperty('--kc', t.b?BLOCKS[t.b.type].color:'var(--peach)'); el.dataset.sig=encSig(t);
  const knobs=[]; for(let i=0;i<6;i++){ const k=t.keys[i]; if(!k){ knobs.push(EMPTY_KNOB); continue; } const spec=t.b?paramSpec(t.b,k):GLOBAL_ENC[k]; knobs.push(knobHTML(i,k,spec,t.b?t.b.p[k]:spec.get())); }
  const d=t.b&&BLOCKS[t.b.type]; const title=t.b?`${icon(CAT_ICON[d.cat])}<b>${esc(blockName(t.b))}</b>${t.pages>1?`<em>page ${UI.encPage+1} of ${t.pages}</em>`:''}`:`${icon('globe')}<b>Rig controls</b><em>Pick a block to put its knobs here</em>`;
  el.innerHTML=`<div class="encs">${knobs.join('')}</div><div class="encbar"><button class="ib sm" id="encprev" ${t.pages>1?'':'disabled'} aria-label="Previous knob page">${icon('left')}</button><div class="enc-title">${title}</div><button class="ib sm" id="encnext" ${t.pages>1?'':'disabled'} aria-label="Next knob page">${icon('right')}</button></div>`; }
function refreshKnobs(){ const el=$('#encoders'); if(!el) return; const t=encoderTargets(); if(el.dataset.sig!==encSig(t)){ renderEncoders(); return; }
  t.keys.forEach((k,i)=>{ const kn=el.querySelector(`.knob[data-enc="${i}"]`); if(!kn) return; const spec=t.b?paramSpec(t.b,k):GLOBAL_ENC[k]; const v=t.b?t.b.p[k]:spec.get(); const g=knobGeom(spec,v); const kv=kn.querySelector('.kval');
    kv.style.strokeDasharray=g.da; kv.style.strokeDashoffset=g.off; kn.querySelector('.kcap i').style.transform=`rotate(${g.ang.toFixed(1)}deg)`; const txt=fmtVal(spec,v); kn.querySelector('.kv').textContent=txt; kn.setAttribute('aria-valuetext',txt); }); }
function encoderDelta(i, delta, fine){ const t=encoderTargets(); const k=t.keys[i]; if(!k) return;
  if(t.b){ const s=paramSpec(t.b,k); const step=s.e?1:(s.step||(s.max-s.min)/100); setParam(t.b,k, t.b.p[k]+delta*step*(fine?0.2:1)); }
  else { const s=GLOBAL_ENC[k]; const step=s.step||(s.max-s.min)/100; s.set(clampN(s.get()+delta*step*(fine?0.2:1),s.min,s.max)); refreshKnobs(); renderTop(); if(UI.page==='chain') renderPage(); } }
function encoderPress(i){ const t=encoderTargets(); const k=t.keys[i]; if(!k) return;
  if(t.b){ const s=paramSpec(t.b,k); if(s.e) setParam(t.b,k,(Math.round(t.b.p[k])+1)%s.e.length); else setParam(t.b,k,s.def); }
  else { const s=GLOBAL_ENC[k]; s.set(s.def); refreshKnobs(); renderTop(); if(UI.page==='chain') renderPage(); } }

// ---------- Footswitches + console ----------
const METER_SEGS=14;
function fsInfo(i){ const m=NP.mode;
  if(m==='preset') return [{name:'Back',sub:'Last preset'},{name:'Forward',sub:'Hold to loop'},{name:'Tap',sub:'Hold for tuner'}][i];
  if(m==='scene'){ const idx=UI.scenePage*3+i; if(idx>7) return {name:'—',sub:'Hold A for more'}; const s=NP.preset.scenes[idx]; const nm=s.name==='Scene '+(idx+1)?'Saved':s.name; return {name:'Scene '+(idx+1), sub:s.data?nm:'Empty', lit:NP.scene===idx}; }
  const f='ABC'[i], mm=NP.preset.stomps[f]; const names=mm.map(x=>{ const b=refBlock(x.ref); return b?BLOCKS[b.type].name:null; }).filter(Boolean);
  return {name:'Stomp '+f, sub:names.length?names[0]+(names.length>1?' +'+(names.length-1):''):'Not set', lit:mm.length>0&&mm.every(x=>{ const b=refBlock(x.ref); return b&&!b.bypass; })}; }
function renderFoot(){ const m=NP.mode; const sw=[0,1,2].map(i=>{ const f=fsInfo(i); return `<div class="fsw-wrap"><div class="fsw-strip ${f.lit?'lit':''}"><div class="fsw-name">${esc(f.name)}</div><div class="fsw-sub" title="${esc(f.sub)}">${esc(f.sub)}</div></div><button class="fsw ${f.lit?'lit':''}" data-fs="${i}" aria-label="Footswitch ${'ABC'[i]}: ${esc(f.name)}"><span class="fsw-ring"></span><span class="fsw-nut"></span><span class="fsw-cap"></span></button><div class="fsw-key">${'ABC'[i]}</div></div>`; }).join('');
  const eb=expBlock(), et=NP.preset.exp.target; const expTxt=eb&&et?`${BLOCKS[eb.type].name}: ${(BLOCKS[eb.type].params[et.key]||{}).l||et.key}`:'Not linked. Tap EXP on a knob.'; const segs='<i></i>'.repeat(METER_SEGS);
  $('#foot').innerHTML=`<div class="stomps m-${m}">${sw}</div><div class="console"><div class="seg modes" role="group" aria-label="Footswitch mode">${['preset','scene','stomp'].map(x=>`<button class="mode-${x} ${m===x?'on':''}" data-mode="${x}" aria-pressed="${m===x}"><i></i>${x}</button>`).join('')}</div>
  <div class="console-row"><button class="tap" id="tapbtn" title="Tap tempo (Space)"><i class="tapled ${UI.beatOn?'on':''}" id="tapled"></i><b id="tapv">${Math.round(NP.bpm)}</b><span>Tap bpm</span></button>
  <div class="expw"><div class="row"><label for="exp">Exp</label><input type="range" id="exp" min="0" max="100" value="${Math.round(NP.exp.value*100)}" data-uni="1"></div><span class="exp-t" title="${esc(expTxt)}">${esc(expTxt)}</span></div>
  <div class="meters" title="Input and output level"><div class="meter" id="min">${segs}</div><div class="meter" id="mout">${segs}</div><span>In</span><span>Out</span></div></div></div>`;
  paintRanges($('#foot')); }
function footPress(i){ const m=NP.mode; if(captureBusy()) return;
  if(m==='preset'){ if(i===0) stepPreset(-1); else if(i===1) stepPreset(1); else tapTempo(); return; }
  if(m==='scene'){ const idx=UI.scenePage*3+i; if(idx>7) return; if(recallScene(idx)) toast(NP.preset.scenes[idx].name); else toast('Scene '+(idx+1)+' is empty. Save it on the Scenes page.'); }
  else { const f='ABC'[i], mm=NP.preset.stomps[f]; if(!mm.length){ toast('Footswitch '+f+' has no blocks. Pick some on the Stomp page.', 3000); return; }
    const allOn=mm.every(x=>{ const b=refBlock(x.ref); return b&&!b.bypass; }); mm.forEach(x=>{ const b=refBlock(x.ref); if(!b) return; if(x.mode==='on') setBypass(b,false); else if(x.mode==='off') setBypass(b,true); else setBypass(b,allOn); }); }
  renderTop(); renderFoot(); if(['chain','scenes','stomp'].includes(UI.page)) renderPage(); }
function footHold(i){ if(i===2){ toggleTuner(); return; } if(i===1){ looperCmd('rec'); return; }
  if(NP.mode==='scene'){ UI.scenePage=(UI.scenePage+1)%3; renderFoot(); toast('Footswitches now pick scenes '+(UI.scenePage*3+1)+' to '+Math.min(8,UI.scenePage*3+3)); } }
function cycleMode(){ const ms=['preset','scene','stomp']; NP.mode=ms[(ms.indexOf(NP.mode)+1)%3]; renderTop(); renderFoot(); }
function stepPreset(d){ let idx=NP.bank*8+NP.slot; for(let k=0;k<128;k++){ idx=(idx+d+128)%128; if(UI.banks[idx]) break; } gotoPreset(idx); }
function gotoPreset(idx){ if(captureBusy()) return; const p=UI.banks[idx]; if(!p){ toast('That slot is empty'); return; } NP.bank=Math.floor(idx/8); NP.slot=idx%8; UI.viewBank=NP.bank; UI.target=idx; loadPreset(p); sendPC(idx); render(); }
function setBpm(v){ NP.bpm=clampN(v,40,300); [...NP.paths.A,...NP.paths.B].forEach(b=>{ if(b.p.sync!==undefined) applyBlock(b); }); const t=$('#tapv'); if(t) t.textContent=Math.round(NP.bpm); renderTop(); if(!NP.selected) refreshKnobs(); }
function tapTempo(){ const t=performance.now(); UI.tapTimes=UI.tapTimes.filter(x=>t-x<2500); UI.tapTimes.push(t); if(UI.tapTimes.length>=2){ const d=[]; for(let i=1;i<UI.tapTimes.length;i++) d.push(UI.tapTimes[i]-UI.tapTimes[i-1]); setBpm(60000/(d.reduce((a,b)=>a+b)/d.length)); } toast(Math.round(NP.bpm)+' bpm', 900); }
function toggleTuner(){ if(captureBusy()) return; if(UI.page==='tuner') go(UI.prevPage||'chain'); else go('tuner'); }
function looperCmd(cmd){ const lb=findLooper(); if(!lb){ toast('Add a looper first. Open the Looper page to add one.', 3000); return; } lb.n.l.port.postMessage({cmd}); }
function applyExp(v){ NP.exp.value=v; const t=NP.preset.exp.target, b=expBlock(); if(!t||!b) return; const s=paramSpec(b,t.key); if(!s) return; setParam(b,t.key, s.min+(s.max-s.min)*(NP.preset.exp.min/100+(NP.preset.exp.max-NP.preset.exp.min)/100*v)); }

// ---------- Animation tick ----------
function setMeter(el,peak){ const db=peak>1e-5?20*Math.log10(peak):-100; const n=Math.max(0,Math.min(METER_SEGS,Math.round((db+42)/42*METER_SEGS))); if(el._n===n) return; el._n=n; const c=el.children; for(let i=0;i<c.length;i++) c[i].className=i<n?'on':''; }
function tick(){ UI.mIn=Math.max(NP.meters.in, UI.mIn*0.86); UI.mOut=Math.max(NP.meters.out, UI.mOut*0.86);
  const mi=$('#min'), mo=$('#mout'); if(mi) setMeter(mi,UI.mIn); if(mo) setMeter(mo,UI.mOut);
  const sig=Math.min(1, Math.sqrt(UI.mIn*2.2)); if(Math.abs(sig-UI.sig)>0.03||(sig===0&&UI.sig!==0)){ UI.sig=sig; const stg=$('.stage'); if(stg) stg.style.setProperty('--sig', sig.toFixed(2)); }
  const on=((NP.ctx.currentTime*NP.bpm/60)%1)<0.14; if(on!==UI.beatOn){ UI.beatOn=on; const l=$('#tapled'); if(l) l.classList.toggle('on',on); const c=$('.fsw[data-fs="2"]'); if(c) c.classList.toggle('beat', on&&NP.mode==='preset'); }
  if(UI.page==='tuner' && (UI.tf++%3===0)) tunerTick();
  requestAnimationFrame(tick); }
