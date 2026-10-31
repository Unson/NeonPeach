// ===== Neon Peach v2 UI: Wizard, Beats, Stage, scope, delay readout, outputs, undo, new presets =====

// ---------- Delay (latency) readout ----------
// What you feel: the interface and driver (both ways), plus what the chain adds.
function latencyInfo(){ const c=NP.ctx; if(!c) return null; const out=((c.baseLatency||0)+(c.outputLatency||0))*1000;
  let inp=0; try{ const t=UI.stream&&UI.stream.getAudioTracks()[0], st=t&&t.getSettings&&t.getSettings(); if(st&&typeof st.latency==='number') inp=st.latency*1000; }catch(e){}
  const inpSaid=inp>0; if(!inp) inp=out*0.6;   // when the input side is not reported, guess it from the output side
  const chain=NP.preset?chainLatency()/c.sampleRate*1000:0; return {out, inp, inpSaid, chain, total:out+inp+chain, measured:UI.pingMs||null}; }
function latChip(){ const L=latencyInfo(); if(!L) return ''; const t=L.measured?L.measured+L.chain:L.total, cls=t<12?'ok':t<20?'mid':'bad';
  return `<button class="st-meta latchip ${cls}" data-page="io" title="${L.measured?'Measured':'Estimated'} time from string to speaker. Tap for details and a ping test.">${icon('clock')}<b>${L.measured?'':'≈'}${t.toFixed(1)}</b>ms</button>`; }
function updLatChip(){ if(!NP.ready) return; $$('.latchip').forEach(el=>{ const L=latencyInfo(), t=L.measured?L.measured+L.chain:L.total; el.querySelector('b').textContent=(L.measured?'':'≈')+t.toFixed(1); el.className='st-meta latchip '+(t<12?'ok':t<20?'mid':'bad'); }); }
setInterval(updLatChip, 1500);
function onRigChanged(){ updLatChip(); }

// Ping: plays a short chirp out of Main and listens on the input. Needs a cable from output to input, or a mic near the speaker.
function makeChirp(sr){ const n=Math.round(sr*0.03), x=new Float32Array(n); for(let i=0;i<n;i++){ const t=i/sr; x[i]=0.5*Math.sin(2*Math.PI*(300*t+(12000-300)/(2*0.03)*t*t))*Math.sin(Math.PI*i/n); } return x; }
async function pingTest(){ if(UI.pinging || captureBusy()) return; const ctx=NP.ctx, r=NP.rig, sr=ctx.sampleRate; UI.pinging=true; UI.pingMsg='Listening…'; if(UI.page==='io') renderPage();
  // one recorder hears both: left = what came back in, right = the chirp as it left. The gap between them is the round trip.
  const ch=makeChirp(sr), buf=ctx.createBuffer(1,ch.length,sr); buf.getChannelData(0).set(ch);
  const inSum=ctx.createGain(); inSum.channelCount=1; inSum.channelCountMode='explicit'; const mg=ctx.createChannelMerger(2), rec=new AudioWorkletNode(ctx,'np-recorder'), g=ctx.createGain();
  r.inPre.connect(inSum).connect(mg,0,0); g.connect(mg,0,1); mg.connect(rec);
  setP(r.master.gain,0,0.01); const mo=(NP.globals.mainOut|0)*2; g.connect(r.merge,0,mo); g.connect(r.merge,0,mo+1);
  const res=await new Promise(res=>{ rec.port.onmessage=e=>{ if(e.data.done) res(e.data); }; rec.port.postMessage({cmd:'start'});
    const s=ctx.createBufferSource(); s.buffer=buf; s.connect(g); s.start(ctx.currentTime+0.25); setTimeout(()=>rec.port.postMessage({cmd:'stop'}), 1000); });
  try{ r.inPre.disconnect(inSum); }catch(e){} rec.port.postMessage({cmd:'kill'}); g.disconnect(); mg.disconnect(); applyGlobals(); UI.pinging=false;
  const y=res.L, sent=res.R; let s0=-1; for(let i=0;i<sent.length;i++){ if(Math.abs(sent[i])>1e-4){ s0=i; break; } }
  let best=0, bi=-1, e=0; for(let i=0;i<y.length;i++) e+=y[i]*y[i]; const n=ch.length;
  if(s0>=0) for(let lag=s0;lag+n<y.length;lag++){ let c=0; for(let k=0;k<n;k+=2) c+=y[lag+k]*ch[k]; c=Math.abs(c); if(c>best){ best=c; bi=lag; } }
  const noise=Math.sqrt(e/Math.max(1,y.length)), strength=best/(noise*Math.sqrt(n/2)*0.5+1e-9), lagSec=(bi-s0)/sr;
  if(s0<0 || bi<0 || strength<6 || lagSec<0.0005 || lagSec>0.5){ UI.pingMs=null; UI.pingMsg='No clear echo came back. Connect an output to an input with a cable, or turn the speaker up near the mic, and try again.'; }
  else { UI.pingMs=lagSec*1000; UI.pingMsg=`Round trip: ${UI.pingMs.toFixed(1)} ms through your interface. With the chain, you hear about ${(UI.pingMs+chainLatency()/sr*1000).toFixed(1)} ms.`; }
  [...NP.paths.A,...NP.paths.B].filter(b=>b.type==='fxloop').forEach(applyBlock); alignPaths(); if(UI.page==='io') renderPage(); renderTop(); return UI.pingMs; }

// ---------- Windows: exclusive audio ----------
UI.appSet=null; if(window.npDesktop&&npDesktop.getSettings) npDesktop.getSettings().then(s=>{ UI.appSet=s||{}; if(UI.page==='io'&&NP.ready) renderPage(); }).catch(()=>{});
function latencyPane(){ const L=latencyInfo(); if(!L) return ''; const win=IS_APP&&window.npDesktop&&npDesktop.platform==='win32', ex=UI.appSet&&UI.appSet.exclusiveAudio;
  const row=(l,v,em)=>`<div class="lrow"><span>${l}</span><b>${v.toFixed(1)} ms</b>${em?`<em>${em}</em>`:''}</div>`;
  return `<section class="pane span2 latpane"><h4 class="pane-h">${icon('clock')}Delay from string to speaker<em>Under 10 ms feels instant. Over 20 ms feels late.</em></h4>
  <div class="lgrid"><div class="lrows">${L.measured?row('Interface, measured round trip',L.measured,'from the ping test'):row('Interface out',L.out,'reported by the system')+row('Interface in',L.inp,L.inpSaid?'reported by the system':'a guess. Run the ping test for the real number.')}${row('Neon Peach chain',L.chain,L.chain<1?'nothing to cut here':'drives add 0.4 ms each, Muff and Octave Fuzz 0.8')}<div class="lrow tot"><span>Total</span><b>${(L.measured?L.measured+L.chain:L.total).toFixed(1)} ms</b></div></div>
  <div class="ltips"><p><b>Cut the delay:</b> set your interface's buffer to 64 or 128 samples in its own control app. Set it to 48 kHz.</p>
  ${win?`<label class="tgl"><input type="checkbox" id="exclusive" ${ex?'checked':''}><span><b>Exclusive Windows audio</b> — Neon Peach takes over the output so Windows' mixer can't add its own buffer. Other apps go quiet while it runs. The app restarts to switch.</span></label>`:''}
  <div class="row wrap"><button class="sm ${UI.pinging?'rec':''}" id="pingbtn">${icon('waves')}${UI.pinging?'Listening…':'Measure it (ping test)'}</button><span class="dim">${esc(UI.pingMsg||'Patch an output into an input with a cable, then press. Or hold a mic near your speaker.')}</span></div></div></div></section>`; }

// ---------- Outputs ----------
PAGE_RENDER.outs=()=>{ const g=NP.globals, N=outChannels(), pairs=[]; for(let i=0;i*2+1<Math.max(N,8);i++) pairs.push(`Out ${i*2+1}-${i*2+2}`);
  const pairSel=(id,cur,skip)=>`<select id="${id}">${pairs.map((p,i)=>`<option value="${i}" ${cur===i?'selected':''} ${i*2+1>=N?'disabled':''}>${p}${i*2+1>=N?' (not on this interface)':''}</option>`).join('')}</select>`;
  return `<div class="grid2"><section class="pane"><h4 class="pane-h">Main out<em>Your full sound</em></h4><div class="field wide"><label for="omain">Jacks</label>${pairSel('omain',g.mainOut|0)}</div>
  <label class="tgl"><input type="checkbox" id="omono" ${g.mono?'checked':''}><span>Mono, for a PA or one speaker</span></label>
  <p class="dim" style="margin-top:10px">This interface has <b>${N}</b> output${N===1?'':'s'}. ${N<=2?'Aux and FX Loop need an interface with 4 or more outputs.':''}</p></section>
  <section class="pane"><h4 class="pane-h">Aux out<em>A second mix, like an amp on stage</em></h4><div class="field wide"><label for="oaux">Jacks</label>${pairSel('oaux',g.auxOut|0)}</div>
  <div class="field wide"><label>Sends</label><div class="seg sm">${['Aux Send blocks','Copy of Main','Dry bass (DI)'].map((t,i)=>`<button class="${(g.auxSrc|0)===i?'on':''}" data-auxsrc="${i}">${t}</button>`).join('')}</div></div>
  <div class="fields">${field('Aux level','oauxl',-60,12,0.5,g.auxLvl||0,fmtDb(g.auxLvl||0),false,true)}</div>
  <p class="dim">${NP.auxLive?'Aux is live.':'Aux is off: pick a pair this interface has, and not the same as Main.'} To feed a stage amp with no cab sound, add an <b>Aux Send</b> block before the Cabinet.</p></section>
  <section class="pane span2"><h4 class="pane-h">FX Loop<em>Put a real pedal in the middle of the chain</em></h4><p class="dim">Add an <b>FX Loop</b> block where you want the pedal. Run a cable from a spare output on your interface into the pedal. Run the pedal's output back into your interface's other input. Neon Peach plays your bass from Input 1 and hears the pedal on Input 2.</p></section></div>`; };

// ---------- Undo / redo ----------
UI.hist=[]; UI.fut=[]; UI.histKey=null; UI.histLast=null;
setInterval(()=>{ if(!NP.ready||UI.undoing) return; const key=NP.bank*8+NP.slot; let snap; try{ snap=JSON.stringify(serializePreset()); }catch(e){ return; }
  if(UI.histKey!==key){ UI.histKey=key; UI.hist=[]; UI.fut=[]; UI.histLast=snap; return; }
  if(snap!==UI.histLast){ UI.hist.push(UI.histLast); if(UI.hist.length>80) UI.hist.shift(); UI.fut=[]; UI.histLast=snap; } }, 450);
function applySnap(snap){ const d=JSON.parse(snap), same=['A','B'].every(k=>(d[k]||[]).length===NP.paths[k].length && d[k].every((x,i)=>x.type===NP.paths[k][i].type)); const selRef=NP.selected&&NP.blocks[NP.selected]?refOf(NP.blocks[NP.selected]):null;
  UI.undoing=true; if(same){ ['A','B'].forEach(k=>NP.paths[k].forEach((b,i)=>{ Object.assign(b.p,d[k][i].p); applyBlock(b); if(b.bypass!==!!d[k][i].bypass) setBypass(b,!!d[k][i].bypass); }));
    Object.assign(NP.preset.split,d.split); NP.preset.stomps=d.stomps; NP.preset.scenes=d.scenes; NP.preset.exp=d.exp; NP.preset.name=d.name; setBpm(d.bpm||NP.bpm); rewire(); }
  else { loadPreset(d); const b=refBlock(selRef); NP.selected=b?b.id:null; }
  UI.histLast=snap; UI.undoing=false; render(); }
function undo(){ if(!UI.hist.length){ toast('Nothing to undo'); return; } UI.fut.push(UI.histLast); applySnap(UI.hist.pop()); toast('Undo'); }
function redo(){ if(!UI.fut.length){ toast('Nothing to redo'); return; } UI.hist.push(UI.histLast); applySnap(UI.fut.pop()); toast('Redo'); }
function isTextField(el){ if(!el) return false; if(el.tagName==='TEXTAREA') return true; return el.tagName==='INPUT' && ['text','search','number','email','url','password',''].includes((el.getAttribute('type')||'').toLowerCase()); }
window.addEventListener('keydown', e=>{ if(!NP.ready||window.npDesktop) return; if(isTextField(e.target)) return; if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'){ e.preventDefault(); if(e.shiftKey) redo(); else undo(); } else if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='y'){ e.preventDefault(); redo(); } });

// ---------- Tone Wizard ----------
// Each style builds a full rig. The five sliders then push it around.
const WIZ=[
  {id:'poppunk', n:'Pop-Punk Punch', d:'Bright pick attack, tight grind, sits on top of loud guitars.', c:'#ff5fa2', bpm:172, A:()=>[['comp',{thr:-24,ratio:4,attack:6,blend:85}],['mbdrive',{xo:220,drive:45,shape:1,squeeze:45,attack:5,mid:3,highs:-3}],['amp',{model:0,gain:30,mid:2,treble:2}],['cab',{cab:1,mic:0}],['tone6',{b500:-2,b2k:2}]]},
  {id:'metal', n:'Modern Clank', d:'Djent-style: clean, solid lows and a metallic, gnarly top.', c:'#31f0ff', bpm:140, A:()=>[['gate',{thr:-58}],['comp',{thr:-26,ratio:5,attack:4}],['mbdrive',{xo:300,drive:72,shape:2,squeeze:60,attack:8,mid:4,highcut:7500}],['peq',{f2:500,g2:-3,f4:2500,g4:4}],['amp',{model:3,gain:28}],['cab',{cab:3,highcut:8000}]]},
  {id:'motown', n:'Motown Thump', d:'Flatwounds, foam mute, big round notes.', c:'#ffb23d', bpm:100, A:()=>[['comp',{thr:-20,ratio:3,attack:25}],['tone6',{b70:3,b2k:-4,b5k:-6}],['amp',{model:1,gain:35,treble:-3}],['cab',{cab:2,mic:2}],['cut',{lo:35,hi:4000}]]},
  {id:'funk', n:'Funk Slap', d:'Scooped and snappy, with an auto-wah on footswitch A.', c:'#46ffb4', bpm:104, A:()=>[['comp',{thr:-28,ratio:6,attack:2,release:80}],['envf',{sens:55,q:6},1],['tone6',{b70:4,b500:-4,b5k:4}],['amp',{model:4,gain:15}],['cab',{cab:1,mic:1}],['chorus',{mix:18,rate:0.5}]], stomps:{A:'envf'}},
  {id:'synth', n:'Synthwave', d:'A saw-wave synth bass that follows you, with a sub under it.', c:'#e14bff', bpm:110, A:()=>[['comp',{thr:-22,ratio:4}],['synth',{wave:0,sub:40,cutoff:600,envamt:65,mix:70}],['octave',{sub1:35,dry:100}],['chorus',{mix:28}],['delay',{type:3,sync:3,fb:30,mix:14}],['amp',{model:5}],['cab',{cab:3}]]},
  {id:'doom', n:'Doom Fuzz Wall', d:'Slow, huge fuzz with a clean sub path under it.', c:'#ff6b3d', bpm:62, A:()=>[['muff',{sustain:82,tone:40,mids:2,blend:85}],['amp',{model:0,gain:55,bass:3}],['cab',{cab:0,highcut:6000}],['reverb',{type:0,mix:10}]], B:()=>[['cut',{lo:30,hi:220}],['comp',{thr:-22,ratio:4}]], split:{mode:0,aLvl:-1,bLvl:-4}},
  {id:'dub', n:'Dub Reggae', d:'Deep, dark and round. Tape echo on footswitch C.', c:'#bbff3d', bpm:75, A:()=>[['comp',{thr:-22,ratio:3,attack:20}],['tone6',{b70:5,b1k:-4,b2k:-6,b5k:-8}],['amp',{model:1,gain:25}],['cab',{cab:7}],['cut',{lo:30,hi:1600}],['delay',{type:1,sync:3,fb:50,mix:28,mod:25},1]], stomps:{C:'delay'}},
  {id:'jazz', n:'Warm Jazz', d:'Woody and soft, a little room around it.', c:'#7d8dff', bpm:120, A:()=>[['comp',{thr:-18,ratio:2,attack:30}],['tubepre',{drive:15,blend:60}],['amp',{model:1,gain:20,treble:-3}],['cab',{cab:4,mic:2}],['reverb',{type:0,mix:12,decay:1.2}]]},
  {id:'indie', n:'Post-Punk Chorus', d:'Bright, wide chorus bass that plays the melody.', c:'#a66bff', bpm:132, A:()=>[['comp',{thr:-22,ratio:4}],['od',{drive:28,blend:40}],['chorus',{rate:0.6,depth:55,mix:45,voices:1}],['amp',{model:4,gain:20,treble:3}],['cab',{cab:5}],['delay',{sync:2,fb:20,mix:12}]]},
  {id:'ambient', n:'Ambient Swells', d:'Notes fade in and float. Freeze holds a pad on footswitch A.', c:'#2ff5e3', bpm:80, A:()=>[['swell',{thr:-44,attack:600}],['chorus',{mix:35}],['revdelay',{sync:1,fb:35,mix:30}],['reverb',{type:5,decay:5.5,mix:55,shimmer:45}],['freeze',{level:90},1]], stomps:{A:'freeze'}},
  {id:'grunge', n:'Grunge Grind', d:'Mid-heavy, dirty, a bit out of control.', c:'#ff8a3d', bpm:118, A:()=>[['comp',{thr:-20,ratio:3}],['omega',{drive:55,blend:65,grunt:100}],['amp',{model:6,gain:45,mid:3}],['cab',{cab:1}]]},
  {id:'talk', n:'Talk Box Funk', d:'Your bass says "wow". Dig in harder to open it up.', c:'#ff3fa8', bpm:100, A:()=>[['comp',{thr:-24,ratio:4,attack:5}],['vowel',{mode:0,from:3,to:0,sens:60,q:10}],['octave',{sub1:45,dry:100}],['amp',{model:2,gain:25}],['cab',{cab:1}]]},
  {id:'stoner', n:'Octave Fuzz Rock', d:'Ringing octave fuzz. Play high on the neck.', c:'#ffe14f', bpm:126, A:()=>[['octfuzz',{drive:72,blend:80}],['amp',{model:6,gain:40}],['cab',{cab:6}],['reverb',{type:3,mix:12}]]},
  {id:'chop', n:'Glitch Chop', d:'Stutter cuts in time with the tempo. Tap the tempo to steer it.', c:'#36b9ff', bpm:128, A:()=>[['comp',{thr:-22,ratio:4}],['b3k',{drive:50,blend:60}],['stutter',{mode:0,div:2,duty:55},1],['amp',{model:3,gain:25}],['cab',{cab:3}],['delay',{type:3,sync:2,fb:25,mix:15}]], stomps:{A:'stutter'}},
  {id:'clean', n:'Studio DI Clean', d:'Clean, even and honest. A good place to start.', c:'#cdc4e6', bpm:120, A:()=>[['comp',{thr:-20,ratio:3}],['tone6',{b70:2,b2k:1}],['amp',{model:5,gain:20}],['cab',{cab:1}]]},
  {id:'m900', n:'Microtubes 900', d:'The Neon 900 on its Microtubes circuit. Tight grind, bright pick attack.', c:'#ffb347', bpm:150, A:()=>[['comp',{thr:-24,ratio:4,attack:6,blend:80}],['head',{circuit:0,drive:55,blend:60,mod:15,grunt:1,attack:2,tone:1,himid:2,treble:2,cab:1}]]},
  {id:'rasp', n:'Melted Raspberry', d:'Clean lows under a creamy, melted top. The Raspberry circuit at Melt.', c:'#ff5c8a', bpm:128, A:()=>[['comp',{thr:-22,ratio:3,attack:10,blend:80}],['raspberry',{circuit:2,drive:55,blend:65,mod:20,warmth:45,xo:180,squeeze:45,presence:2,b1:1,b4:1,air:1,cab:4}]]},
  {id:'ao900', n:'Alpha·Omega Wall', d:'The Neon 900 on Alpha·Omega. Mod leans to Omega for a raw, fuzzy wall.', c:'#ff6a4d', bpm:120, A:()=>[['gate',{thr:-56}],['head',{circuit:1,drive:70,blend:70,mod:65,grunt:2,growl:45,bite:30,tone:-1,bass:2,lomid:-2,lomidf:1,cab:1}]]}];
UI.wiz={id:null, m:{dirt:0.5, bright:0.5, low:0.5, space:0.2, squash:0.5}};
const WIZ_M=[['dirt','Dirt','How much grit'],['bright','Bright','Dark to sparkly'],['low','Low end','Thin to huge'],['squash','Squash','Loose to even'],['space','Space','Dry to dreamy']];
function wizBuild(style, m){ const p=blankPreset(style.n); p.bpm=style.bpm; const mk=(list)=>list.map(([t,pp,by])=>({type:t,p:Object.assign({},pp||{}),bypass:!!by}));
  p.A=mk(style.A()); p.B=style.B?mk(style.B()):[]; if(style.split) Object.assign(p.split,style.split);
  const all=[...p.A,...p.B], dd=(m.dirt-0.5), br=(m.bright-0.5), lo=(m.low-0.5), sq=m.squash;
  all.forEach(b=>{ const d=BLOCKS[b.type], q=b.p, def=(k)=>q[k]??d.params[k].def;
    if(d.cat==='Drive'){ if('drive' in d.params) q.drive=clampN(def('drive')+dd*70,0,100); if('sustain' in d.params) q.sustain=clampN(def('sustain')+dd*50,0,100); }
    if(b.type==='amp'){ q.gain=clampN(def('gain')+dd*40,0,100); q.treble=clampN(def('treble')+br*12,-12,12); q.bass=clampN(def('bass')+lo*10,-12,12); }
    if(b.type==='head'){ q.drive=clampN(def('drive')+dd*60,0,100); q.blend=clampN(def('blend')+dd*40,0,100); q.treble=clampN(def('treble')+br*10,-12,12); q.bass=clampN(def('bass')+lo*10,-12,12); q.sag=clampN(def('sag')+(sq-0.5)*50,0,100); }
    if(b.type==='raspberry'){ q.drive=clampN(def('drive')+dd*60,0,100); q.blend=clampN(def('blend')+dd*40,0,100); q.b5=clampN(def('b5')+br*8,-12,12); q.air=clampN(def('air')+br*6,-12,12); q.lows=clampN(def('lows')+lo*8,-24,12); q.b0=clampN(def('b0')+lo*6,-12,12); q.squeeze=clampN(def('squeeze')+(sq-0.5)*60,0,100); }
    if(b.type==='cab'){ q.highcut=clampN(def('highcut')*Math.pow(2,br*1.6),2000,16000); }
    if(b.type==='comp'){ q.ratio=clampN(1+sq*7,1,20); q.thr=clampN(-10-sq*22,-60,0); }
    if(b.type==='mbdrive'){ q.lows=clampN(def('lows')+lo*10,-24,12); q.squeeze=clampN(def('squeeze')+(sq-0.5)*60,0,100); }
    if(b.type==='reverb') q.mix=clampN(def('mix')+(m.space-0.2)*60,0,100);
    if(b.type==='delay'||b.type==='revdelay') q.mix=clampN(def('mix')+(m.space-0.2)*40,0,100); });
  if(m.space>0.3 && !all.some(b=>b.type==='reverb')) p.A.push({type:'reverb',p:{type:1,decay:1.5+m.space*3,mix:(m.space-0.3)*55},bypass:false});
  if(Math.abs(br)>0.05 || Math.abs(lo)>0.05) p.A.push({type:'tilt',p:{tilt:br*10,center:700},bypass:false});
  const st=style.stomps||{}; ['A','B','C'].forEach(f=>{ if(st[f]){ const i=p.A.findIndex(b=>b.type===st[f]); if(i>=0) p.stomps[f]=[{ref:'A'+i,mode:'toggle'}]; } });
  if(!p.stomps.A.length){ const i=p.A.findIndex(b=>BLOCKS[b.type].cat==='Drive'); if(i>=0) p.stomps.A=[{ref:'A'+i,mode:'toggle'}]; }
  if(!p.stomps.C.length){ const i=p.A.findIndex(b=>['Delay','Reverb'].includes(BLOCKS[b.type].cat)); if(i>=0) p.stomps.C=[{ref:'A'+i,mode:'toggle'}]; }
  return p; }
function wizApply(live){ const st=WIZ.find(w=>w.id===UI.wiz.id); if(!st) return; const p=wizBuild(st, UI.wiz.m);
  const same=['A','B'].every(k=>p[k].length===NP.paths[k].length && p[k].every((x,i)=>x.type===NP.paths[k][i].type));
  if(live && same){ ['A','B'].forEach(k=>NP.paths[k].forEach((b,i)=>{ Object.assign(b.p, p[k][i].p); applyBlock(b); })); }
  else { const bpm=NP.bpm; loadPreset(p); if(UI.wizKeepBpm) setBpm(bpm); }
  renderTop(); renderEncoders(); renderFoot(); }
PAGE_RENDER.wizard=()=>{ const w=UI.wiz, cur=WIZ.find(x=>x.id===w.id);
  return `<div class="lead wizlead"><div class="lead-ico">${icon('spark')}</div><div><h3>Tone Wizard</h3><p>Pick a style. Neon Peach builds the whole rig for it. Then push the five sliders until it feels right. ${UI.inputOk?'':'No bass plugged in? Press <b>Hear it</b> to use the demo riff.'}</p></div>
  <div class="wizact"><button class="${UI.demoOn?'on':''}" id="wizdemo">${icon(UI.demoOn?'stop':'play')}${UI.demoOn?'Stop':'Hear it'}</button><button id="wizrand">${icon('spark')}Surprise me</button></div></div>
  <div class="wizgrid">${WIZ.map(s=>`<button class="wcard ${w.id===s.id?'on':''}" data-wiz="${s.id}" style="--c:${s.c}"><b>${esc(s.n)}</b><span>${esc(s.d)}</span><em>${s.bpm} bpm</em></button>`).join('')}</div>
  <section class="pane wizmacro ${cur?'':'dis'}"><h4 class="pane-h">${cur?esc(cur.n):'Pick a style first'}<em>${cur?'Every slider changes the real knobs in the chain':''}</em></h4>
  <div class="macros">${WIZ_M.map(([k,l,t])=>`<div class="macro"><label for="wm_${k}">${l}</label><input type="range" id="wm_${k}" data-macro="${k}" min="0" max="100" value="${Math.round(w.m[k]*100)}" data-uni="1" ${cur?'':'disabled'}><span>${t}</span></div>`).join('')}</div>
  <div class="row wrap"><button class="primary" id="wizkeep" ${cur?'':'disabled'}>${icon('save')}Keep it: save to a preset slot</button><button class="sm" data-page-go="chain">${icon('chain')}See the chain</button><label class="tgl"><input type="checkbox" id="wizbpm" ${UI.wizKeepBpm?'checked':''}><span>Keep my tempo</span></label></div></section>`; };

// ---------- Peach Beats: a drum machine that follows the tempo ----------
const DV=['kick','snare','hat','open','clap','tom','crash'], DV_L=['Kick','Snare','Hat','Open hat','Clap','Tom','Crash'];
const BEATS={
  rock:{n:'Rock', p:{kick:'x.......x.x.....', snare:'....x.......x...', hat:'x.x.x.x.x.x.x.x.'}},
  poppunk:{n:'Pop-Punk', p:{kick:'x.....x.x.......', snare:'....x.......x...', open:'x.x.x.x.x.x.x.x.'}, bpm:172},
  punk:{n:'Punk Skank', p:{kick:'x...x...x...x...', snare:'..x...x...x...x.', hat:'x.x.x.x.x.x.x.x.'}, bpm:190},
  funk:{n:'Funk', p:{kick:'x.....x...x..x..', snare:'....x..o.o..x..o', hat:'xoxoxoxoxoxoxoxo'}, sw:0.12, bpm:100},
  hiphop:{n:'Boom Bap', p:{kick:'x......x..x.....', snare:'....x.......x...', hat:'x.x.x.x.x.x.x.x.'}, sw:0.22, bpm:90},
  metal:{n:'Double Kick', p:{kick:'xxxxxxxxxxxxxxxx', snare:'....x.......x...', crash:'x...x...x...x...'}, bpm:150},
  reggae:{n:'One Drop', p:{kick:'........x.......', snare:'........o.......', hat:'x.o.x.o.x.o.x.o.'}, sw8:0.3, bpm:75},
  disco:{n:'Disco', p:{kick:'x...x...x...x...', snare:'....x.......x...', open:'..x...x...x...x.', hat:'x...x...x...x...'}, bpm:118},
  shuffle:{n:'Shuffle', p:{kick:'x.......x.......', snare:'....x.......x...', hat:'x.x.x.x.x.x.x.x.'}, sw8:0.33, bpm:110},
  motown:{n:'Motown', p:{kick:'x.....x.x.......', snare:'....x.......x...', clap:'....x.......x...', hat:'x.x.x.x.x.x.x.x.'}, bpm:104},
  half:{n:'Half Time', p:{kick:'x.........x.....', snare:'........x.......', hat:'x.x.x.x.x.x.x.x.'}, bpm:140},
  four:{n:'Four on the Floor', p:{kick:'x...x...x...x...', clap:'....x.......x...', open:'..x...x...x...x.'}, bpm:124} };
UI.dr={style:'rock', on:false, fill:4, countIn:true, swing:null, grid:null, step:-1, bar:0};
function drGrid(style){ const p=BEATS[style].p; return DV.map(v=>Array.from(p[v]||'................').map(c=>c==='x'?2:c==='o'?1:0)); }
function drLoad(){ try{ const s=JSON.parse(localStorage.getItem(LS+'.beats')||'null'); if(s){ Object.assign(UI.dr,{style:s.style||'rock', fill:s.fill??4, countIn:s.countIn!==false, swing:s.swing??null, my:s.my||null}); } }catch(e){} UI.dr.grid=UI.dr.style==='my'&&UI.dr.my?UI.dr.my.map(r=>r.slice()):drGrid(BEATS[UI.dr.style]?UI.dr.style:'rock'); }
function drSave(){ try{ localStorage.setItem(LS+'.beats', JSON.stringify({style:UI.dr.style, fill:UI.dr.fill, countIn:UI.dr.countIn, swing:UI.dr.swing, my:UI.dr.my||null})); }catch(e){} }
let NOISE=null; function noiseBuf(ctx){ if(NOISE&&NOISE.sampleRate===ctx.sampleRate) return NOISE; const n=ctx.sampleRate, b=ctx.createBuffer(1,n,ctx.sampleRate), d=b.getChannelData(0); let s=1; for(let i=0;i<n;i++){ s=(s*16807)%2147483647; d[i]=s/1073741823.5-1; } return NOISE=b; }
function drumBus(){ const r=NP.rig; if(!r.drums){ r.drums=NP.ctx.createGain(); r.drums.connect(r.master); } setP(r.drums.gain, Math.pow((NP.globals.drumLvl??70)/100,2)*0.9); return r.drums; }
function hit(v, t, vel){ const ctx=NP.ctx, out=drumBus(), g=ctx.createGain(); g.connect(out); const a=vel===1?0.5:1; const nz=(f0,type,q)=>{ const s=ctx.createBufferSource(); s.buffer=noiseBuf(ctx); const f=ctx.createBiquadFilter(); f.type=type; f.frequency.value=f0; f.Q.value=q||0.7; s.connect(f).connect(g); return s; };
  const env=(peak,dec)=>{ g.gain.setValueAtTime(0,t); g.gain.linearRampToValueAtTime(peak*a,t+0.002); g.gain.exponentialRampToValueAtTime(0.0008,t+dec); };
  if(v==='kick'){ const o=ctx.createOscillator(); o.frequency.setValueAtTime(160,t); o.frequency.exponentialRampToValueAtTime(42,t+0.13); o.connect(g); env(1.1,0.42); o.start(t); o.stop(t+0.45);
    const c=ctx.createBufferSource(); c.buffer=noiseBuf(ctx); const f=ctx.createBiquadFilter(); f.type='highpass'; f.frequency.value=2500; const cg=ctx.createGain(); c.connect(f).connect(cg).connect(out); cg.gain.setValueAtTime(0.25*a,t); cg.gain.exponentialRampToValueAtTime(0.001,t+0.012); c.start(t,Math.random()*0.5); c.stop(t+0.02); }
  else if(v==='snare'){ const s=nz(1900,'bandpass',0.7); env(0.75,0.2); s.start(t,Math.random()*0.5); s.stop(t+0.22); const o=ctx.createOscillator(), og=ctx.createGain(); o.type='triangle'; o.frequency.setValueAtTime(200,t); o.frequency.exponentialRampToValueAtTime(160,t+0.06); o.connect(og).connect(out); og.gain.setValueAtTime(0.45*a,t); og.gain.exponentialRampToValueAtTime(0.001,t+0.09); o.start(t); o.stop(t+0.1); }
  else if(v==='hat'){ const s=nz(8000,'highpass'); env(0.28,0.045); s.start(t,Math.random()*0.5); s.stop(t+0.06); if(UI.dr.openSrc){ try{ UI.dr.openG.gain.cancelScheduledValues(t); UI.dr.openG.gain.setTargetAtTime(0,t,0.008); }catch(e){} } }
  else if(v==='open'){ const s=nz(7000,'highpass'); env(0.22,0.32); s.start(t,Math.random()*0.5); s.stop(t+0.34); UI.dr.openSrc=s; UI.dr.openG=g; }
  else if(v==='clap'){ const s=nz(1300,'bandpass',1.2); g.gain.setValueAtTime(0,t); [0,0.011,0.022].forEach(d=>{ g.gain.setValueAtTime(0.7*a,t+d); g.gain.exponentialRampToValueAtTime(0.08,t+d+0.009); }); g.gain.exponentialRampToValueAtTime(0.001,t+0.16); s.start(t,Math.random()*0.5); s.stop(t+0.18); }
  else if(v==='tom'){ const o=ctx.createOscillator(); o.frequency.setValueAtTime(130,t); o.frequency.exponentialRampToValueAtTime(85,t+0.25); o.connect(g); env(0.8,0.32); o.start(t); o.stop(t+0.34); }
  else if(v==='crash'){ const s=nz(5200,'highpass'); env(0.3,1.4); s.start(t,Math.random()*0.3); s.stop(t+1.45); } }
function drStepDur(){ return 60/NP.bpm/4; }
function drTick(){ const ctx=NP.ctx, d=UI.dr; if(!d.on) return; const ahead=ctx.currentTime+0.12;
  while(d.next<ahead){ const st=d.stepN%16, bar=Math.floor(d.stepN/16), dur=drStepDur(), sty=BEATS[d.style]||{}, swing=d.swing??(sty.sw||0), sw8=sty.sw8||0;
    let t=d.next; if(swing&&st%2===1) t+=swing*dur; if(sw8&&st%4===2) t+=sw8*dur*2;
    if(d.counting){ if(st%4===0) hit('hat',t,st===0?2:1); }
    else { const fill=d.fill&&((bar+1)%d.fill===0)&&st>=8; const g=d.grid;
      if(fill){ if(st===8||st===10) hit('tom',t,2); if(st>=12) hit('snare',t,st===13?1:2); if(st===8) hit('kick',t,2); }
      else DV.forEach((v,i)=>{ const x=g[i][st]; if(x) hit(v,t,x); });
      if(st===0 && (bar===0 || (d.fill&&bar%d.fill===0)) && !g[6][0]) hit('crash',t,2); }
    d.marks.push([t,st,d.counting]); d.next+=dur; d.stepN++; if(d.counting&&d.stepN>=16){ d.counting=false; d.stepN=0; } }
  if(d.marks.length>64) d.marks.splice(0,d.marks.length-64); }
function drStart(){ const d=UI.dr, ctx=NP.ctx; if(d.on) return; noiseBuf(ctx); const beat=60/NP.bpm; d.next=Math.ceil((ctx.currentTime+0.08)/beat)*beat; d.stepN=0; d.counting=!!d.countIn; d.marks=[]; d.on=true; d.timer=setInterval(drTick,25); drTick(); }
function drStop(){ const d=UI.dr; d.on=false; clearInterval(d.timer); d.step=-1; if(UI.page==='drums') drPaint(); }
function toggleDrums(){ if(!NP.ready) return; if(UI.dr.on) drStop(); else drStart(); if(UI.page==='drums') renderPage(); toast(UI.dr.on?'Beats playing':'Beats stopped', 1000); }
function drPaint(){ const d=UI.dr, ctx=NP.ctx; let cur=-1, cnt=false; if(d.on&&d.marks){ for(const [t,st,c] of d.marks){ if(t<=ctx.currentTime+0.005){ cur=st; cnt=c; } } }
  if(cur!==d.step||cnt!==d.cnt){ d.step=cur; d.cnt=cnt; $$('.dcol').forEach((c,i)=>c.classList.toggle('now', !cnt&&i===cur)); const ci=$('#dcount'); if(ci) ci.classList.toggle('on',cnt); } }
PAGE_RENDER.drums=()=>{ const d=UI.dr; if(!d.grid) drLoad(); const sty=BEATS[d.style];
  const rows=DV.map((v,i)=>`<div class="drow"><span class="dlab">${DV_L[i]}</span><div class="dcells">${d.grid[i].map((x,j)=>`<button class="dcell v${x} ${j%4===0?'beat':''}" data-dc="${i}:${j}" aria-label="${DV_L[i]} step ${j+1}"></button>`).join('')}</div></div>`).join('');
  const cols=`<div class="dsteps">${Array.from({length:16},(_,j)=>`<i class="dcol ${j===d.step?'now':''}">${j%4===0?j/4+1:''}</i>`).join('')}</div>`;
  return `<div class="beats"><div class="bhead"><button class="bigplay ${d.on?'on':''}" id="drplay" aria-label="${d.on?'Stop':'Play'} the beat">${icon(d.on?'stop':'play')}</button>
  <div class="btempo"><b id="drbpm">${Math.round(NP.bpm)}</b><span>bpm</span><button class="sm" id="drtap">Tap</button>${sty&&sty.bpm?`<button class="xs" id="drbpmset">Use ${sty.bpm}</button>`:''}</div>
  <div class="bset"><div class="field"><label for="drlvl">Level</label><input type="range" id="drlvl" min="0" max="100" value="${NP.globals.drumLvl??70}" data-uni="1"><output>${NP.globals.drumLvl??70}%</output></div>
  <div class="field"><label for="drsw">Swing</label><input type="range" id="drsw" min="0" max="40" value="${Math.round(((d.swing??(sty&&sty.sw))||0)*100)}" data-uni="1"><output>${Math.round(((d.swing??(sty&&sty.sw))||0)*100)}%</output></div>
  <div class="row"><span class="dim">Fill every</span><div class="seg sm">${[[0,'Off'],[4,'4 bars'],[8,'8 bars']].map(([v,l])=>`<button class="${d.fill===v?'on':''}" data-drfill="${v}">${l}</button>`).join('')}</div><label class="tgl"><input type="checkbox" id="drcount" ${d.countIn?'checked':''}><span>Count in</span></label><i id="dcount" class="dcount">1 2 3 4</i></div></div></div>
  <div class="bstyles">${Object.entries(BEATS).map(([k,s])=>`<button class="bchip ${d.style===k?'on':''}" data-beat="${k}">${esc(s.n)}</button>`).join('')}<button class="bchip ${d.style==='my'?'on':''}" data-beat="my" ${d.my?'':'disabled'} title="${d.my?'Your saved beat':'Edit the grid, then save it here'}">My Beat</button></div>
  <section class="pane dgrid">${cols}${rows}<div class="row wrap" style="margin-top:12px"><button class="sm" id="drsavemy">${icon('save')}Save as My Beat</button><button class="sm" id="drclear">${icon('trash')}Clear grid</button><span class="dim">Tap a square: loud, then soft, then off. The beat follows the tempo. Tap the tempo with Space or footswitch C. Press B to start and stop.</span></div></section></div>`; };

// ---------- Stage mode: big and readable from across a room ----------
UI.stage=false;
function openStage(){ if(!NP.ready) return; UI.stage=true; let el=$('#stagev'); if(!el){ el=document.createElement('div'); el.id='stagev'; $('#pedal').appendChild(el); } el.style.display='flex'; renderStage(); if(document.documentElement.requestFullscreen && !document.fullscreenElement) document.documentElement.requestFullscreen().catch(()=>{}); }
function closeStage(){ UI.stage=false; const el=$('#stagev'); if(el) el.style.display='none'; if(document.fullscreenElement) document.exitFullscreen().catch(()=>{}); }
function renderStage(){ const el=$('#stagev'); if(!el||!UI.stage) return; const p=NP.preset, sc=NP.scene>=0?p.scenes[NP.scene]:null;
  const fs=[0,1,2].map(i=>{ const f=fsInfo(i); return `<div class="sfs"><div class="sfs-name ${f.lit?'lit':''}">${esc(f.name)}</div><div class="sfs-sub">${esc(f.sub)}</div><button class="fsw big ${f.lit?'lit':''}" data-fs="${i}" aria-label="Footswitch ${'ABC'[i]}: ${esc(f.name)}"><span class="fsw-ring"></span><span class="fsw-nut"></span><span class="fsw-cap"></span></button><kbd>${i+1}</kbd></div>`; }).join('');
  el.innerHTML=`<canvas id="stscope" aria-hidden="true"></canvas><div class="sv-top"><div class="sv-mode m-${NP.mode}">${cap(NP.mode)} mode</div><div class="sv-tune" id="svtune">–</div><button class="sv-x" id="stagex" aria-label="Leave stage mode">${icon('x')}<span>Esc</span></button></div>
  <div class="sv-mid"><button class="sv-arrow" data-svstep="-1" aria-label="Previous preset">${icon('left')}</button><div class="sv-name"><div class="sv-num">${NP.bank+1}-${NP.slot+1}</div><div class="sv-title">${esc(p.name)}</div><div class="sv-scene">${sc?esc(sc.name):'&nbsp;'}</div></div><button class="sv-arrow" data-svstep="1" aria-label="Next preset">${icon('right')}</button></div>
  <div class="sv-info"><span class="sv-bpm"><i id="svbeat"></i><b>${Math.round(NP.bpm)}</b> bpm</span><span>${latChip()}</span><span class="sv-dr ${UI.dr.on?'on':''}" id="svdr">${icon('drum')}${UI.dr.on?'Beat on':'Beat off'}</span><span class="sv-modes">${['preset','scene','stomp'].map(x=>`<button class="${NP.mode===x?'on':''}" data-mode="${x}">${x}</button>`).join('')}</span></div>
  <div class="sv-fs">${fs}</div>`; }

// ---------- Live scope behind the chain, and in stage mode ----------
function drawScope(cv, an, opt){ if(!cv||!an) return; const dpr=Math.min(2,window.devicePixelRatio||1), W=cv.clientWidth, H=cv.clientHeight; if(!W||!H) return; if(cv.width!==Math.round(W*dpr)){ cv.width=Math.round(W*dpr); cv.height=Math.round(H*dpr); }
  const g=cv.getContext('2d'); g.setTransform(dpr,0,0,dpr,0,0); g.clearRect(0,0,W,H); const n=an.fftSize; if(!UI.scopeBuf||UI.scopeBuf.length!==n) UI.scopeBuf=new Float32Array(n); const b=UI.scopeBuf; an.getFloatTimeDomainData(b);
  let s=0; for(let i=1;i<n/2;i++){ if(b[i-1]<=0&&b[i]>0){ s=i; break; } } const len=Math.min(n-s, opt.len||1024); let pk=0; for(let i=0;i<len;i++) pk=Math.max(pk,Math.abs(b[s+i])); const k=(H*0.42)/Math.max(0.08,pk);
  const css=getComputedStyle(document.documentElement); const col=opt.color||css.getPropertyValue('--peach').trim()||'#ff9a6a';
  g.lineJoin='round'; g.beginPath(); for(let i=0;i<len;i++){ const x=i/(len-1)*W, y=H/2-b[s+i]*k; if(i) g.lineTo(x,y); else g.moveTo(x,y); }
  g.globalAlpha=0.16*(opt.alpha||1); g.strokeStyle=col; g.lineWidth=9; g.stroke(); g.globalAlpha=0.35*(opt.alpha||1); g.lineWidth=4; g.stroke(); g.globalAlpha=0.95*(opt.alpha||1); g.lineWidth=1.6; g.strokeStyle='#fff3ea'; g.stroke(); g.globalAlpha=1;
  if(opt.bars){ if(!UI.specBuf||UI.specBuf.length!==an.frequencyBinCount) UI.specBuf=new Uint8Array(an.frequencyBinCount); an.getByteFrequencyData(UI.specBuf); const sp=UI.specBuf, nb=48, sr=NP.ctx.sampleRate;
    for(let j=0;j<nb;j++){ const f0=30*Math.pow(16000/30,j/nb), f1=30*Math.pow(16000/30,(j+1)/nb), a=Math.floor(f0/sr*2*sp.length), z=Math.max(a+1,Math.floor(f1/sr*2*sp.length)); let m=0; for(let q=a;q<z&&q<sp.length;q++) m=Math.max(m,sp[q]); const h=m/255*H*0.5, x=j/nb*W;
      g.fillStyle=col; g.globalAlpha=0.18; g.fillRect(x+1,H-h,W/nb-2,h); } g.globalAlpha=1; } }
let lastScope=0;
function v2Frame(ts){ if(NP.ready){ if(ts-lastScope>33){ lastScope=ts; const an=NP.rig.outAn;
      if(UI.stage){ drawScope($('#stscope'), an, {len:1800, bars:true, alpha:0.8}); const L=$('#svbeat'); if(L) L.classList.toggle('on', UI.beatOn); stageTune(); }
      else if(UI.page==='chain') drawScope($('#scope'), an, {len:1400, alpha:0.55});
      if(UI.page==='drums') drPaint();
      const b=NP.selected&&NP.blocks[NP.selected]; if(b&&BLOCKS[b.type].gr){ const el=document.getElementById('grbar_'+b.id); if(el){ const gr=Math.max(-24,Math.min(0,b.gr||0)); el.style.width=(-gr/24*100).toFixed(1)+'%'; const o=document.getElementById('grv_'+b.id); if(o) o.textContent=(gr>-0.05?'0':gr.toFixed(1))+' dB'; } } } }
  requestAnimationFrame(v2Frame); }
requestAnimationFrame(v2Frame);
function stageTune(){ if(UI.tsf=(UI.tsf|0)+1, UI.tsf%3) return; const an=NP.rig.inAn; if(!UI.tbuf||UI.tbuf.length!==an.fftSize) UI.tbuf=new Float32Array(an.fftSize); an.getFloatTimeDomainData(UI.tbuf); const f=detectPitch(UI.tbuf,NP.ctx.sampleRate), el=$('#svtune'); if(!el) return;
  if(f>0){ const n=noteFromFreq(f,NP.globals.tunerRef), c=n.cents, ok=Math.abs(c)<4; el.innerHTML=`<b class="${ok?'ok':''}">${n.name}<sub>${n.octave}</sub></b><i style="--c:${Math.max(-50,Math.min(50,c)).toFixed(1)}"></i><span>${ok?'in tune':sgn(c)+'¢'}</span>`; } else if(el.textContent!=='–') el.textContent='–'; }

// ---------- New factory presets (banks 3 and 4) ----------
function factoryPresetsV2(){ const out=WIZ.map(s=>wizBuild(s,{dirt:0.5,bright:0.5,low:0.5,space:s.id==='ambient'?0.6:0.2,squash:0.5}));
  const mk=(name,A,B,split,bpm)=>{ const p=blankPreset(name); p.A=A.map(([t,pp,by])=>({type:t,p:pp||{},bypass:!!by})); p.B=(B||[]).map(([t,pp,by])=>({type:t,p:pp||{},bypass:!!by})); if(split) Object.assign(p.split,split); if(bpm) p.bpm=bpm;
    const i=p.A.findIndex(b=>['Drive','Pitch','Synth','Filter','Mod'].includes(BLOCKS[b.type].cat)); if(i>=0) p.stomps.A=[{ref:'A'+i,mode:'toggle'}]; const j=p.A.findIndex(b=>['Delay','Reverb'].includes(BLOCKS[b.type].cat)); if(j>=0) p.stomps.C=[{ref:'A'+j,mode:'toggle'}]; return p; };
  out.push(mk('Three Band Studio',[['mbcomp',{}],['amp',{model:5,gain:20}],['cab',{cab:1}]]));
  out.push(mk('Doubler Wide Lead',[['comp',{thr:-22}],['od',{drive:35,blend:55}],['doubler',{width:90,mix:55}],['amp',{model:4}],['cab',{cab:5}],['reverb',{type:2,mix:15}]]));
  out.push(mk('Reverse Dream',[['comp',{}],['chorus',{mix:30}],['revdelay',{sync:1,fb:45,mix:50}],['reverb',{type:1,decay:3.5,mix:35}]],null,null,90));
  out.push(mk('Stage Amp + DI (Aux)',[['comp',{thr:-22,ratio:4}],['b3k',{drive:45,blend:55}],['auxsend',{}],['amp',{model:3,gain:30}],['cab',{cab:1}]]));
  out.push(mk('Pedal in the Loop',[['comp',{}],['fxloop',{}],['amp',{model:0,gain:30}],['cab',{cab:0}]]));
  return out.slice(0,24); }
function installV2Presets(force){ const list=factoryPresetsV2(); let put=0; list.forEach((p,i)=>{ const idx=16+i; if(force||!UI.banks[idx]){ UI.banks[idx]=JSON.parse(JSON.stringify(p)); put++; } }); return put; }
// 2.3: four Neon 900 presets go into bank 6 (empty slots only), once
function factoryPresetsV23(){ const mk=(name,A,bpm)=>{ const p=blankPreset(name); p.A=A.map(([t,pp,by])=>({type:t,p:pp||{},bypass:!!by})); if(bpm) p.bpm=bpm; const i=p.A.findIndex(b=>b.type==='head'); if(i>=0) p.stomps.A=[{ref:'A'+i,mode:'toggle'}]; const j=p.A.findIndex(b=>['Delay','Reverb'].includes(BLOCKS[b.type].cat)); if(j>=0) p.stomps.C=[{ref:'A'+j,mode:'toggle'}]; return p; };
  return [ mk('900 B3K Grind',[['comp',{thr:-24,ratio:4,attack:6,blend:85}],['head',{circuit:0,drive:60,blend:65,mod:0,grunt:1,attack:2,tone:2,himid:3,himidf:1,treble:1,cab:1}]],150),
    mk('900 Vintage Warm',[['comp',{thr:-20,ratio:3,attack:20}],['head',{circuit:0,drive:40,blend:55,mod:100,grunt:2,attack:1,tone:-3,bass:2,lomid:2,lomidf:0,treble:-2,sag:45,cab:3}]],110),
    mk('900 Alpha Punch',[['gate',{thr:-58}],['comp',{thr:-26,ratio:5,attack:4}],['head',{circuit:1,drive:65,blend:70,mod:0,grunt:1,attack:2,bite:50,tone:1,lomid:-3,lomidf:1,himid:3,himidf:2,cab:4}]],140),
    mk('900 Omega Doom',[['head',{circuit:1,drive:85,blend:80,mod:100,grunt:2,growl:70,bite:20,tone:-2,bass:3,highcut:5500,sag:60,cab:1}],['reverb',{type:0,mix:10}]],62) ]; }
function factoryPresetsV231(){ const mk=(name,A,bpm)=>{ const p=blankPreset(name); p.A=A.map(([t,pp,by])=>({type:t,p:pp||{},bypass:!!by})); if(bpm) p.bpm=bpm; const i=p.A.findIndex(b=>b.type==='raspberry'); if(i>=0) p.stomps.A=[{ref:'A'+i,mode:'toggle'}]; const j=p.A.findIndex(b=>['Delay','Reverb'].includes(BLOCKS[b.type].cat)); if(j>=0) p.stomps.C=[{ref:'A'+j,mode:'toggle'}]; return p; };
  return [ mk('Raspberry Melt',[['comp',{thr:-22,ratio:3,attack:10,blend:80}],['raspberry',{circuit:2,drive:55,blend:65,mod:15,warmth:50,xo:180,squeeze:45,presence:2,b1:1,b4:1,air:1,cab:4}]],128),
    mk('Raspberry Jam',[['gate',{thr:-58}],['raspberry',{circuit:2,drive:75,blend:75,mod:85,warmth:30,xo:220,squeeze:55,attack:2,bite:35,presence:3,b2:-2,b4:2,b5:2,cab:1}],['reverb',{type:0,mix:8}]],150) ]; }
function installOnce(list, from){ let put=0, idx=from; list.forEach(p=>{ while(idx<128 && UI.banks[idx]) idx++; if(idx<128){ UI.banks[idx]=JSON.parse(JSON.stringify(p)); idx++; put++; } }); return put; }
function v231Upgrade(){ try{ if(!localStorage.getItem(LS+'.v231')){ const n=installOnce(factoryPresetsV231(), 40); localStorage.setItem(LS+'.v231','1'); if(n) setTimeout(()=>toast(n+' Melted Raspberry presets in bank 6.', 4500), 2800); saveState(); } }catch(e){} }
function installV23Presets(){ let put=0, idx=40; factoryPresetsV23().forEach(p=>{ while(idx<128 && UI.banks[idx]) idx++; if(idx<128){ UI.banks[idx]=JSON.parse(JSON.stringify(p)); idx++; put++; } }); return put; }
function v23Upgrade(){ try{ if(!localStorage.getItem(LS+'.v23')){ const n=installV23Presets(); localStorage.setItem(LS+'.v23','1'); if(n) setTimeout(()=>toast(n+' new Neon 900 amp presets in bank 6. Find the head under Amp in the block picker.', 4500), 2200); saveState(); } }catch(e){} }
function v2Upgrade(){ try{ if(!localStorage.getItem(LS+'.v2')){ const n=installV2Presets(false); localStorage.setItem(LS+'.v2','1'); if(n) setTimeout(()=>toast(n+' new presets in banks 3 to 5. Try the Wizard and Beats pages too.', 4500), 1600); saveState(); } }catch(e){} }

// ---------- Events for the new pages ----------
document.addEventListener('DOMContentLoaded', ()=>{ const pedal=$('#pedal');
  pedal.addEventListener('click', e=>{ const c=(s)=>e.target.closest(s); let x;
    if(x=c('#stagego')){ openStage(); return; }
    if(x=c('#stagex')){ closeStage(); return; }
    if(x=c('[data-svstep]')){ stepPreset(+x.dataset.svstep); renderStage(); return; }
    if(x=c('#svdr')){ toggleDrums(); renderStage(); return; }
    if(x=c('#pingbtn')){ pingTest(); return; }
    if(x=c('[data-auxsrc]')){ NP.globals.auxSrc=+x.dataset.auxsrc; applyGlobals(); renderPage(); return; }
    if(x=c('[data-wiz]')){ UI.wiz.id=x.dataset.wiz; const st=WIZ.find(w=>w.id===UI.wiz.id); wizApply(false); renderPage(); toast(st.n+' is ready. Play!', 1500); return; }
    if(x=c('#wizrand')){ const st=WIZ[Math.floor(Math.random()*WIZ.length)]; UI.wiz.id=st.id; WIZ_M.forEach(([k])=>UI.wiz.m[k]=Math.round((0.15+Math.random()*0.7)*100)/100); wizApply(false); renderPage(); toast('Surprise: '+st.n, 1500); return; }
    if(x=c('#wizdemo')){ toggleDemo(); renderPage(); return; }
    if(x=c('#wizkeep')){ go('presets'); setTimeout(()=>{ const i=$('#pname'); if(i){ i.focus(); i.select(); } toast('Pick a slot, name it, then press Save.', 3000); },50); return; }
    if(x=c('#drplay')){ toggleDrums(); return; }
    if(x=c('#drtap')){ tapTempo(); const b=$('#drbpm'); if(b) b.textContent=Math.round(NP.bpm); return; }
    if(x=c('#drbpmset')){ const s=BEATS[UI.dr.style]; if(s&&s.bpm) setBpm(s.bpm); renderPage(); return; }
    if(x=c('[data-beat]')){ const k=x.dataset.beat; UI.dr.style=k; UI.dr.swing=null; UI.dr.grid=k==='my'&&UI.dr.my?UI.dr.my.map(r=>r.slice()):drGrid(k); drSave(); renderPage(); return; }
    if(x=c('[data-drfill]')){ UI.dr.fill=+x.dataset.drfill; drSave(); renderPage(); return; }
    if(x=c('[data-dc]')){ const [i,j]=x.dataset.dc.split(':').map(Number), g=UI.dr.grid; g[i][j]=g[i][j]===0?2:g[i][j]===2?1:0; x.className='dcell v'+g[i][j]+(j%4===0?' beat':''); if(!UI.dr.on&&g[i][j]) hit(DV[i],NP.ctx.currentTime+0.01,g[i][j]); return; }
    if(x=c('#drsavemy')){ UI.dr.my=UI.dr.grid.map(r=>r.slice()); UI.dr.style='my'; drSave(); renderPage(); toast('Saved as My Beat'); return; }
    if(x=c('#drclear')){ UI.dr.grid=DV.map(()=>new Array(16).fill(0)); renderPage(); return; }
  });
  pedal.addEventListener('input', e=>{ const t=e.target, id=t.id; const out=(txt)=>{ const o=t.parentElement.querySelector('output'); if(o) o.textContent=txt; };
    if(t.dataset.macro){ UI.wiz.m[t.dataset.macro]=t.value/100; clearTimeout(UI.wizT); UI.wizT=setTimeout(()=>wizApply(true),60); return; }
    if(id==='oauxl'){ NP.globals.auxLvl=+t.value; applyGlobals(); out(fmtDb(+t.value)); return; }
    if(id==='drlvl'){ NP.globals.drumLvl=+t.value; drumBus(); out(t.value+'%'); return; }
    if(id==='drsw'){ UI.dr.swing=t.value/100; drSave(); out(t.value+'%'); return; } });
  pedal.addEventListener('change', e=>{ const t=e.target, id=t.id;
    if(id==='omain'){ NP.globals.mainOut=+t.value; applyGlobals(); renderPage(); return; }
    if(id==='oaux'){ NP.globals.auxOut=+t.value; applyGlobals(); renderPage(); return; }
    if(id==='omono'){ NP.globals.mono=t.checked?1:0; applyGlobals(); return; }
    if(id==='drcount'){ UI.dr.countIn=t.checked; drSave(); return; }
    if(id==='wizbpm'){ UI.wizKeepBpm=t.checked; return; }
    if(id==='exclusive'){ if(!window.npDesktop||!npDesktop.setSettings) return; const on=t.checked; t.checked=!on; confirm2(on?'Turn on exclusive Windows audio? Neon Peach restarts. Other apps go quiet while it runs.':'Turn off exclusive Windows audio? Neon Peach restarts.', ()=>{ try{ saveState(); }catch(err){} npDesktop.setSettings({exclusiveAudio:on, relaunch:true}); }, 'Restart now'); return; } });
  window.addEventListener('keydown', e=>{ if(!NP.ready) return; const tg=e.target.tagName; if(tg==='INPUT'||tg==='TEXTAREA'||tg==='SELECT') return; if(e.ctrlKey||e.metaKey||e.altKey) return;
    if(UI.stage && e.key==='Escape'){ closeStage(); return; } if($('#modal').style.display==='flex') return; const k=e.key.toLowerCase();
    if(k==='f'){ if(UI.stage) closeStage(); else openStage(); } else if(k==='b'){ toggleDrums(); if(UI.stage) renderStage(); } }, true);
});
// keep stage mode up to date when presets, modes or footswitches change
const _renderFoot=renderFoot; renderFoot=function(){ _renderFoot(); if(UI.stage) renderStage(); };
const _renderTop=renderTop; renderTop=function(){ _renderTop(); if(UI.stage) renderStage(); };

// ---------- Start-up for v2: called once the rig is on ----------
function v2Start(){ drLoad(); v2Upgrade(); v23Upgrade(); v231Upgrade();
  // exclusive audio safety: if the engine clock does not move, turn exclusive mode back off and restart
  if(window.npDesktop && UI.appSet===null){ setTimeout(v2Watch, 1500); } else v2Watch(); }
function v2Watch(){ if(!(window.npDesktop&&npDesktop.setSettings&&UI.appSet&&UI.appSet.exclusiveAudio)) return; const t0=NP.ctx.currentTime;
  setTimeout(()=>{ if(NP.ctx.currentTime-t0<0.5){ toast('Exclusive audio did not start on this device. Switching it off and restarting.', 5000); setTimeout(()=>npDesktop.setSettings({exclusiveAudio:false, relaunch:true}), 2500); } }, 3000); }
