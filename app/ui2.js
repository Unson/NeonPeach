// ===== Neon Peach UI: events, MIDI, I/O =====
function applyTheme(){ document.documentElement.style.setProperty('--hue', UI.theme); }
// In the desktop app, files go straight into the Neon Peach folder (kind picks the subfolder). In a browser, they download.
function download(blob,name,kind){ if(window.npDesktop){ blob.arrayBuffer().then(buf=>npDesktop.save(kind||'', name, buf)).then(r=>{ if(r&&r.shown) toast('Saved to '+r.shown, 3200); }).catch(()=>toast('Could not save '+name)); return; } const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=name; a.click(); setTimeout(()=>URL.revokeObjectURL(a.href),5000); }
function pickFile(accept){ return new Promise(res=>{ const i=document.createElement('input'); i.type='file'; i.accept=accept; i.onchange=()=>res(i.files[0]||null); i.click(); }); }
function prompt2(label, def, cb){ openModal(`<h3>${esc(label)}</h3><div class="row wrap"><input id="pin" value="${esc(def||'')}" maxlength="40" aria-label="${esc(label)}"><button class="primary" id="pok">Save name</button></div>`, ()=>{ const inp=$('#pin'); const ok=()=>{ const v=inp.value.trim(); closeModal(); if(v) cb(v); }; $('#pok').onclick=ok; inp.onkeydown=e=>{ if(e.key==='Enter') ok(); }; setTimeout(()=>inp.select(),0); }); }
function confirm2(msg, cb, yes='Yes, do it'){ openModal(`<h3>${esc(msg)}</h3><div class="row wrap"><button class="danger" id="cok">${esc(yes)}</button><button id="cno">Cancel</button></div>`, ()=>{ $('#cok').onclick=()=>{ closeModal(); cb(); }; $('#cno').onclick=closeModal; }); }
function selectedBlock(){ return NP.selected&&NP.blocks[NP.selected]; }

document.addEventListener('DOMContentLoaded', ()=>{
  $('#power').onclick=powerOn;
  $('#modal').addEventListener('click', e=>{ if(e.target.id==='modal' || e.target.closest('#mclose')){ closeModal(); return; } if(UI.modalClick) UI.modalClick(e); });
  const pedal=$('#pedal');

  // ---- clicks ----
  pedal.addEventListener('click', e=>{ const c=(s)=>e.target.closest(s); let x;
    if(x=c('[data-page]')){ go(x.dataset.page); return; }
    if(x=c('[data-page-go]')){ go(x.dataset.pageGo); return; }
    if(x=c('.fsw')){ if(e.detail===0) footPress(+x.dataset.fs); return; }   // keyboard press on a footswitch
    if(x=c('[data-bon]')){ NP.preset.split.bLvl=0; rewire(); renderPage(); refreshKnobs(); toast('Path B is on at 0 dB'); return; }
    if(x=c('[data-tog]')){ const b=NP.blocks[x.dataset.tog]; if(!b) return; setBypass(b,!b.bypass); renderPage(); renderFoot(); return; }
    if(x=c('.blk')){ NP.selected=x.dataset.bid; UI.encPage=0; renderPage(); renderEncoders(); return; }
    if(x=c('[data-add]')){ showLibrary(x.dataset.add); return; }
    if(x=c('[data-seg]')){ const b=NP.blocks[x.dataset.pb]; if(b) setParam(b,x.dataset.seg,+x.dataset.v); return; }
    if(x=c('[data-bool]')){ const b=NP.blocks[x.dataset.pb]; if(b) setParam(b,x.dataset.bool,b.p[x.dataset.bool]?0:1); return; }
    if(x=c('[data-split]')){ const s=NP.preset.split, v=+x.dataset.split; s.mode=v; if((v===1||v===2)&&s.bLvl<=-60){ s.bLvl=0; toast('Path B turned up to 0 dB so you can hear it'); } rewire(); renderPage(); refreshKnobs(); return; }
    if(x=c('[data-inch]')){ if(captureBusy()) return; NP.globals.inCh=+x.dataset.inch; applyGlobals(); renderPage(); toast(['Using input 1','Using input 2','Mixing inputs 1 and 2'][NP.globals.inCh]); return; }
    if(x=c('[data-mode]')){ NP.mode=x.dataset.mode; renderTop(); renderFoot(); return; }
    if(x=c('[data-hue]')){ UI.theme=+x.dataset.hue; applyTheme(); renderPage(); return; }
    if(x=c('[data-mv]')){ const b=selectedBlock(); if(!b) return; const path=refOf(b)[0], arr=NP.paths[path]; const i=arr.indexOf(b), j=i+parseInt(x.dataset.mv); if(j<0||j>=arr.length) return; keepRefs(()=>{ arr.splice(i,1); arr.splice(j,0,b); }); rewire(); renderPage(); return; }
    if(x=c('[data-swap]')){ const b=selectedBlock(); if(!b) return; const from=refOf(b)[0], to=from==='A'?'B':'A'; keepRefs(()=>{ NP.paths[from].splice(NP.paths[from].indexOf(b),1); NP.paths[to].push(b); }); rewire(); if(to==='B') ensureB(); renderPage(); return; }
    if(x=c('[data-dup]')){ const b=selectedBlock(); if(!b) return; if(totalBlocks()>=MAX_BLOCKS){ toast('24 blocks is the limit. Delete one first.'); return; } const path=refOf(b)[0]; const nb=createBlock(b.type,b.p,b.bypass); keepRefs(()=>{ NP.paths[path].splice(NP.paths[path].indexOf(b)+1,0,nb); }); rewire(); NP.selected=nb.id; renderPage(); renderEncoders(); renderTop(); return; }
    if(x=c('[data-del]')){ const b=selectedBlock(); if(!b) return; keepRefs(()=>{ ['A','B'].forEach(k=>{ const i=NP.paths[k].indexOf(b); if(i>=0) NP.paths[k].splice(i,1); }); }); destroyBlock(b); NP.selected=null; rewire(); renderPage(); renderEncoders(); renderTop(); renderFoot(); return; }
    if(x=c('[data-exp]')){ const b=selectedBlock(); if(!b) return; const k=x.dataset.exp, cur=NP.preset.exp.target; if(cur&&expBlock()===b&&cur.key===k){ NP.preset.exp.target=null; toast('Expression pedal unlinked'); } else { NP.preset.exp.target={ref:refOf(b),key:k}; toast('Expression pedal now moves '+BLOCKS[b.type].params[k].l); } renderPage(); renderFoot(); return; }
    if(x=c('#sp_pol')){ NP.preset.split.bPol=NP.preset.split.bPol?0:1; rewire(); renderPage(); return; }
    if(x=c('#irload')){ loadIRFile(); return; }
    // presets
    if(x=c('[data-bank]')){ UI.viewBank=+x.dataset.bank; renderPage(); return; }
    if(x=c('[data-slot]')){ const idx=UI.viewBank*8+(+x.dataset.slot); UI.target=idx; if(UI.banks[idx]) gotoPreset(idx); else { renderPage(); toast('Empty slot picked. Press Save to put your sound here.', 2600); } return; }
    if(x=c('#psave')){ const idx=UI.target??(NP.bank*8+NP.slot); NP.preset.name=$('#pname').value.trim()||'My preset'; UI.banks[idx]=serializePreset(); NP.bank=Math.floor(idx/8); NP.slot=idx%8; saveState(); toast('Saved to '+(NP.bank+1)+'-'+(NP.slot+1)); render(); return; }
    if(x=c('#pnew')){ loadPreset(blankPreset()); render(); toast('Blank preset ready. Save it to a slot to keep it.'); return; }
    if(x=c('#pclear')){ const idx=UI.target??(NP.bank*8+NP.slot); confirm2('Clear slot '+(Math.floor(idx/8)+1)+'-'+(idx%8+1)+'?', ()=>{ UI.banks[idx]=null; saveState(); renderPage(); toast('Slot cleared'); }, 'Clear slot'); return; }
    if(x=c('#pexport')){ download(new Blob([fullBackup()],{type:'application/json'}),'neon-peach-presets.json','Presets'); toast('Exported all presets and clones'); return; }
    if(x=c('#pexport1')){ download(new Blob([JSON.stringify({neonpeach:1, preset:serializePreset()})],{type:'application/json'}), (NP.preset.name||'preset').replace(/[^\w-]+/g,'_')+'.json','Presets'); toast('Exported '+NP.preset.name); return; }
    if(x=c('#pimport')){ pickFile('.json').then(f=>{ if(!f) return; f.text().then(txt=>{ try{ const d=JSON.parse(txt);
        if(d.banks&&d.banks.length===128){ confirm2('Replace all 128 slots with this file?', ()=>{ UI.banks=d.banks; if(d.captures) NP.captures=d.captures.map(c=>({name:c.name,curve:Float32Array.from(c.curve),ir:Float32Array.from(c.ir)})); if(d.irs) NP.irs=d.irs.map(i=>({name:i.name,data:Float32Array.from(i.data)})); saveState(); restoreClones(d.clones).then(n=>{ renderPage(); toast('Imported all presets'+(n?' and '+n+' clone'+(n===1?'':'s'):'')); }); }, 'Replace all'); }
        else if(d.preset){ loadPreset(d.preset); render(); toast('Preset loaded. Save it to a slot to keep it.'); }
        else toast('That file is not a Neon Peach preset file.'); }catch(err){ toast('That file could not be read.'); } }); }); return; }
    if(x=c('#pfactory')){ confirm2('Put the factory presets back in banks 1 to 4? Your other banks stay as they are.', ()=>{ factoryPresets().forEach((p,i)=>UI.banks[i]=p); installV2Presets(true); saveState(); renderPage(); toast('Factory presets restored'); }, 'Restore'); return; }
    // scenes
    if(x=c('[data-scene]')){ const i=+x.dataset.scene; if(recallScene(i)){ renderTop(); renderPage(); renderFoot(); refreshKnobs(); } else toast('Scene '+(i+1)+' is empty. Press Save under it to store your sound.', 2800); return; }
    if(x=c('[data-scsave]')){ const i=+x.dataset.scsave; NP.preset.scenes[i].data=captureScene(); NP.scene=i; renderTop(); renderPage(); renderFoot(); toast('Saved scene '+(i+1)); return; }
    if(x=c('[data-scname]')){ const i=+x.dataset.scname; prompt2('Name scene '+(i+1), NP.preset.scenes[i].name, v=>{ NP.preset.scenes[i].name=v; renderTop(); renderPage(); renderFoot(); }); return; }
    if(x=c('[data-scclear]')){ const i=+x.dataset.scclear; NP.preset.scenes[i].data=null; if(NP.scene===i) NP.scene=-1; renderTop(); renderPage(); renderFoot(); return; }
    // looper
    if(x=c('[data-loop]')){ looperCmd(x.dataset.loop); return; }
    if(x=c('#addlooper')){ if(totalBlocks()>=MAX_BLOCKS){ toast('24 blocks is the limit. Delete one first.'); return; } NP.paths.A.push(createBlock('looper')); rewire(); renderPage(); renderTop(); return; }
    // old captures and IRs (listed on the Clone page)
    if(x=c('[data-capir]')){ const cp=NP.captures[+x.dataset.capir]; NP.irs.push({name:cp.name+' IR', data:Float32Array.from(cp.ir)}); saveState(); renderPage(); toast('Added to the Cabinet list'); return; }
    if(x=c('[data-capdel]')){ NP.captures.splice(+x.dataset.capdel,1); saveState(); renderPage(); return; }
    if(x=c('[data-irdel]')){ NP.irs.splice(+x.dataset.irdel,1); saveState(); renderPage(); return; }
    // tone match
    if(x=c('#mref')){ pickFile('audio/*').then(async f=>{ if(!f) return; try{ const buf=await NP.ctx.decodeAudioData(await f.arrayBuffer()); const d=buf.getChannelData(0).subarray(0, Math.min(buf.length, buf.sampleRate*30)); UI.matchRef=bandEnergies(d, buf.sampleRate); UI.matchRefName=f.name; renderPage(); }catch(err){ toast('That audio file could not be read.'); } }); return; }
    if(x=c('#mme')){ analyzeMe(); return; }
    if(x=c('#mapply')){ applyMatch(); return; }
    // io
    if(x=c('#devrefresh')){ refreshDevices(true); return; }
    if(x=c('#demo')){ toggleDemo(); renderPage(); return; }
    if(x=c('#btload')){ pickFile('audio/*').then(async f=>{ if(!f) return; try{ UI.btBuf=await NP.ctx.decodeAudioData(await f.arrayBuffer()); UI.btName=f.name; renderPage(); }catch(err){ toast('That audio file could not be read.'); } }); return; }
    if(x=c('#btplay')){ toggleBacking(); renderPage(); return; }
    if(x=c('#recbtn')){ toggleRecord(); return; }
    // midi
    if(x=c('#mlearn')){ if(UI.midi.learn){ UI.midi.learn=null; } else { const v=$('#mtarget').value, sel=selectedBlock(); UI.midi.learn={target:v, label:$('#mtarget option:checked').textContent, bid:v.startsWith('prm:')&&sel?sel.id:null, ref:v.startsWith('prm:')&&sel?refOf(sel):null, type:v.startsWith('prm:')&&sel?sel.type:null}; } renderPage(); return; }
    if(x=c('[data-mdel]')){ UI.midi.maps.splice(+x.dataset.mdel,1); saveState(); renderPage(); return; }
    // global
    if(x=c('#gsave')){ saveState(); toast('Saved'); return; }
    if(x=c('#greset')){ confirm2('Erase all presets, captures and settings? This cannot be undone.', ()=>{ localStorage.removeItem(LS); localStorage.removeItem(LS+'.cap'); localStorage.removeItem(LS+'.ir'); window.removeEventListener('beforeunload', saveState); location.reload(); }, 'Erase everything'); return; }
    if(x=c('#gfs')){ if(document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen().catch(()=>toast('Full screen is not allowed here')); return; }
    // knobs + console
    if(x=c('#encprev')){ const t=encoderTargets(); UI.encPage=(UI.encPage-1+t.pages)%t.pages; renderEncoders(); return; }
    if(x=c('#encnext')){ const t=encoderTargets(); UI.encPage=(UI.encPage+1)%t.pages; renderEncoders(); return; }
    if(x=c('#tapbtn')){ tapTempo(); return; }
  });

  // ---- sliders + fields ----
  pedal.addEventListener('input', e=>{ const t=e.target, id=t.id; if(t.type==='range') paintRange(t);
    const out=(txt)=>{ const o=t.parentElement.querySelector('output'); if(o) o.textContent=txt; };
    if(t.dataset.pk){ const b=NP.blocks[t.dataset.pb]; if(b) setParam(b,t.dataset.pk,parseFloat(t.value)); return; }
    if(id==='sp_xo'){ NP.preset.split.xo=+t.value; rewire(); out(fmtHz(+t.value)); refreshKnobs(); return; }
    if(id==='sp_a'){ NP.preset.split.aLvl=+t.value; rewire(); out(fmtDb(+t.value)); refreshKnobs(); return; }
    if(id==='sp_b'){ NP.preset.split.bLvl=+t.value; rewire(); out(fmtDb(+t.value)); refreshKnobs(); return; }
    if(id==='sp_pan'){ NP.preset.split.bPan=+t.value; rewire(); out(fmtPan(+t.value)); return; }
    if(id==='exp'){ applyExp(t.value/100); return; }
    if(id==='ingain'){ NP.globals.inGain=+t.value; applyGlobals(); out(fmtDb(+t.value)); refreshKnobs(); return; }
    if(id==='gmaster'){ NP.globals.master=+t.value; applyGlobals(); out(fmtDb(+t.value)); refreshKnobs(); return; }
    if(t.dataset.geq!==undefined){ const i=+t.dataset.geq; NP.globals.geq[i]=+t.value; applyGlobals(); $('#geqv'+i).textContent=fmtDb(+t.value); return; }
    if(id==='gtheme'){ UI.theme=+t.value; applyTheme(); $$('.sw').forEach(s=>s.classList.toggle('on', +s.dataset.hue===UI.theme)); return; }
    if(id==='llvl'||id==='lfb'){ const lb=findLooper(); if(lb){ setParam(lb, id==='llvl'?'level':'feedback', +t.value); out(Math.round(+t.value)+'%'); } return; }
    if(id==='btlvl'){ UI.btLevel=+t.value; setP(NP.rig.backing.gain, UI.btLevel/100); out(t.value+'%'); return; }
    if(id==='mstr'){ UI.matchStr=+t.value; out(t.value+'%'); return; }
    if(id==='tref'){ NP.globals.tunerRef=clampN(+t.value||440,415,466); return; }
  });
  pedal.addEventListener('change', e=>{ const t=e.target, id=t.id;
    if(t.dataset.pk&&t.tagName==='SELECT'){ const b=NP.blocks[t.dataset.pb]; if(b) setParam(b,t.dataset.pk,parseInt(t.value)); return; }
    if(id==='sp_xo'||id==='sp_b'){ renderPage(); return; }   // lane labels and the muted tube follow these
    if(t.dataset.st){ const f=t.dataset.st, ref=t.dataset.ref, m=NP.preset.stomps[f]; const i=m.findIndex(x=>x.ref===ref); if(t.checked&&i<0) m.push({ref,mode:'toggle'}); else if(!t.checked&&i>=0) m.splice(i,1); renderPage(); renderFoot(); return; }
    if(t.dataset.stmode){ const e2=NP.preset.stomps[t.dataset.stmode].find(x=>x.ref===t.dataset.ref); if(e2) e2.mode=t.value; return; }
    if(id==='indev'){ if(captureBusy()){ t.value=UI.io.inputId; return; } UI.io.inputId=t.value; openInput(); return; }
    if(id==='outdev'){ if(captureBusy()){ t.value=UI.io.outputId; return; } UI.io.outputId=t.value; if(NP.ctx.setSinkId) NP.ctx.setSinkId(t.value||'').catch(()=>toast('Could not switch to that output')); return; }
    if(id==='inpad'){ NP.globals.pad=t.checked?1:0; applyGlobals(); return; }
    if(id==='gmute'){ NP.globals.mute=t.checked?1:0; applyGlobals(); return; }
    if(id==='tmute'){ UI.tunerMute=t.checked; NP.tunerMute=(UI.page==='tuner'&&UI.tunerMute); applyGlobals(); return; }
    if(id==='tref'){ t.value=NP.globals.tunerRef; return; }
    if(id==='mpc'){ UI.midi.pcEnabled=t.checked; return; }
    if(id==='mclock'){ UI.midi.clock=t.checked; return; }
    if(id==='mout'){ UI.midi.outId=t.value; return; }
  });

  // ---- knob drag (in-place updates keep pointer capture) ----
  let drag=null;
  pedal.addEventListener('pointerdown', e=>{ const k=e.target.closest('.knob'); if(!k||k.classList.contains('empty')) return; drag={i:+k.dataset.enc, y:e.clientY, moved:false, fine:e.shiftKey}; try{ k.setPointerCapture(e.pointerId); }catch(err){} e.preventDefault(); });
  pedal.addEventListener('pointermove', e=>{ if(!drag) return; const dy=drag.y-e.clientY; if(Math.abs(dy)>=3){ drag.moved=true; encoderDelta(drag.i, dy/3*0.5, drag.fine||e.shiftKey); drag.y=e.clientY; } });
  const endDrag=()=>{ if(!drag) return; if(!drag.moved) encoderPress(drag.i); drag=null; };
  pedal.addEventListener('pointerup', endDrag); pedal.addEventListener('pointercancel', ()=>{ drag=null; });
  pedal.addEventListener('wheel', e=>{ const k=e.target.closest('.knob'); if(!k||k.classList.contains('empty')) return; e.preventDefault(); encoderDelta(+k.dataset.enc, e.deltaY<0?1:-1, e.shiftKey); }, {passive:false});

  // ---- footswitch tap vs hold ----
  pedal.addEventListener('pointerdown', e=>{ const f=e.target.closest('.fsw'); if(!f) return; const i=+f.dataset.fs; f.classList.add('down'); clearTimeout(UI.holdT); UI.holdFs=i;
    UI.holdT=setTimeout(()=>{ UI.holdT=null; UI.holdFs=null; f.classList.remove('down'); footHold(i); }, 600); });
  pedal.addEventListener('pointerup', e=>{ const f=e.target.closest('.fsw'); if(!f||UI.holdFs===null) return; f.classList.remove('down'); if(UI.holdT){ clearTimeout(UI.holdT); UI.holdT=null; const i=UI.holdFs; UI.holdFs=null; footPress(i); } });
  const cancelFs=(e)=>{ if(!e.target.classList||!e.target.classList.contains('fsw')) return; e.target.classList.remove('down'); if(UI.holdT){ clearTimeout(UI.holdT); UI.holdT=null; } UI.holdFs=null; };
  pedal.addEventListener('pointercancel', cancelFs); pedal.addEventListener('pointerleave', cancelFs, true);

  // ---- drag blocks between spots and paths ----
  let dragB=null;
  pedal.addEventListener('dragstart', e=>{ const b=e.target.closest('.blk'); if(!b) return; dragB=b.dataset.bid; b.classList.add('dragging'); e.dataTransfer.effectAllowed='move'; try{ e.dataTransfer.setData('text/plain',dragB); }catch(err){} });
  pedal.addEventListener('dragend', ()=>{ dragB=null; $$('.chip.dragging').forEach(x=>x.classList.remove('dragging')); });
  pedal.addEventListener('dragover', e=>{ if(dragB&&e.target.closest('.pblocks')) e.preventDefault(); });
  pedal.addEventListener('drop', e=>{ if(!dragB) return; const row=e.target.closest('.pblocks'); if(!row) return; e.preventDefault(); const b=NP.blocks[dragB]; dragB=null; if(!b) return; const to=row.dataset.path, from=refOf(b)[0]; const over=e.target.closest('.blk');
    keepRefs(()=>{ ['A','B'].forEach(k=>{ const i=NP.paths[k].indexOf(b); if(i>=0) NP.paths[k].splice(i,1); }); const arr=NP.paths[to]; if(over&&over.dataset.bid!==b.id){ const j=arr.indexOf(NP.blocks[over.dataset.bid]); arr.splice(j<0?arr.length:j,0,b); } else arr.push(b); });
    rewire(); if(to==='B'&&from!=='B') ensureB(); renderPage(); });
});

// everything a full backup holds: all 128 slots, old captures, cab IRs and clones
function fullBackup(){ return JSON.stringify({neonpeach:1, banks:UI.banks, captures:NP.captures.map(c=>({name:c.name,curve:Array.from(c.curve),ir:Array.from(c.ir)})), irs:NP.irs.map(i=>({name:i.name,data:Array.from(i.data)})), clones:clonesForBackup()}); }
function onKey(e){ if(e.ctrlKey||e.metaKey||e.altKey) return; if(e.target.tagName==='INPUT'||e.target.tagName==='SELECT'||e.target.tagName==='TEXTAREA') return; if($('#modal').style.display==='flex'){ if(e.key==='Escape') closeModal(); return; } const k=e.key.toLowerCase();
  if(k==='1'||k==='2'||k==='3'){ footPress(parseInt(k)-1); } else if(k===' '){ if(e.target.tagName==='BUTTON') return; e.preventDefault(); tapTempo(); } else if(k==='t'){ toggleTuner(); } else if(k==='r'){ looperCmd('rec'); } else if(k==='s'){ looperCmd('stop'); } else if(k==='m'){ cycleMode(); } }

// ---------- Devices / IO ----------
async function refreshDevices(force){ try{ if(force||!UI.devices){ UI.devices=await navigator.mediaDevices.enumerateDevices(); if(UI.page==='io') renderPage(); if(force) toast('Device list updated'); } }catch(e){} }
function toggleDemo(){ if(UI.demoOn){ UI.demoOn=false; clearInterval(UI.demoTimer); return; } UI.demoOn=true; const ctx=NP.ctx; const riff=[[41.2,0.5],[41.2,0.25],[49,0.25],[55,0.5],[41.2,0.5],[61.7,0.25],[55,0.25],[49,0.5],[41.2,0.5],[41.2,0.25],[49,0.25],[55,0.5],[73.4,0.5],[61.7,0.25],[55,0.25],[49,0.5]]; let next=ctx.currentTime+0.1, idx=0;
  const sched=()=>{ while(next<ctx.currentTime+0.6 && UI.demoOn){ const [f,dur]=riff[idx%riff.length]; idx++; const beat=60/Math.max(60,Math.min(160,NP.bpm)); const d=dur*beat*2; const o=ctx.createOscillator(); o.type='sawtooth'; o.frequency.value=f; const o2=ctx.createOscillator(); o2.type='triangle'; o2.frequency.value=f*2; const lp=ctx.createBiquadFilter(); lp.type='lowpass'; lp.Q.value=2; lp.frequency.setValueAtTime(2200,next); lp.frequency.exponentialRampToValueAtTime(300,next+0.25); const g=ctx.createGain(); g.gain.setValueAtTime(0,next); g.gain.linearRampToValueAtTime(0.35,next+0.006); g.gain.exponentialRampToValueAtTime(0.12,next+d*0.6); g.gain.exponentialRampToValueAtTime(0.001,next+d*0.95); const g2=ctx.createGain(); g2.gain.value=0.3; o.connect(lp); o2.connect(g2).connect(lp); lp.connect(g).connect(NP.rig.demo); o.start(next); o2.start(next); o.stop(next+d); o2.stop(next+d); next+=d; } };
  sched(); UI.demoTimer=setInterval(sched,200); }
function toggleBacking(){ if(UI.btPlaying){ UI.btPlaying=false; try{ UI.btSrc.stop(); }catch(e){} return; } if(!UI.btBuf){ toast('Load an audio file first'); return; } const s=NP.ctx.createBufferSource(); s.buffer=UI.btBuf; s.loop=true; s.connect(NP.rig.backing); setP(NP.rig.backing.gain,(UI.btLevel??70)/100); s.start(); UI.btSrc=s; UI.btPlaying=true; }
function toggleRecord(){ const r=NP.rig.rec; if(UI.recOn){ r.port.onmessage=(e)=>{ if(e.data.done){ download(encodeWav(e.data.L,e.data.R,e.data.sr),'neon-peach-'+new Date().toISOString().slice(0,19).replace(/[:T]/g,'-')+'.wav','Recordings'); toast('Recording saved'); } }; r.port.postMessage({cmd:'stop'}); UI.recOn=false; } else { r.port.postMessage({cmd:'start'}); UI.recOn=true; toast('Recording'); } renderPage(); }
async function loadIRFile(){ const f=await pickFile('.wav,audio/wav'); if(!f) return; const b=selectedBlock(); try{ const buf=await NP.ctx.decodeAudioData(await f.arrayBuffer()); const n=Math.min(buf.length, Math.floor(NP.ctx.sampleRate*0.25)); const d=Float32Array.from(buf.getChannelData(0).subarray(0,n)); let mx=0; d.forEach(v=>mx=Math.max(mx,Math.abs(v))); if(mx>0) for(let i=0;i<n;i++) d[i]/=mx; NP.irs.push({name:f.name.replace(/\.wav$/i,''), data:d}); saveState(); if(b&&b.type==='cab'){ setParam(b,'cab',CAB_NAMES.length+NP.irs.length-1); renderPage(); } toast('IR loaded: '+f.name); }catch(e){ toast('That file could not be read as an IR.'); } }

// ---------- Capture ----------
// ---------- Tone match ----------
function analyzeMe(){ const say=(t)=>{ const s=$('#mmestat'); if(s) s.textContent=t; }; say('Listening for 5 seconds. Play now.'); const ctx=NP.ctx; const rec=new AudioWorkletNode(ctx,'np-recorder'); NP.rig.outGain.connect(rec);
  rec.port.onmessage=(e)=>{ if(e.data.done){ NP.rig.outGain.disconnect(rec); rec.port.postMessage({cmd:'kill'}); UI.matchMe=bandEnergies(e.data.L, e.data.sr); if(UI.page==='match') renderPage(); } }; rec.port.postMessage({cmd:'start'}); setTimeout(()=>rec.port.postMessage({cmd:'stop'}),5000); }
function applyMatch(){ if(!UI.matchRef||!UI.matchMe){ toast('Do steps 1 and 2 first'); return; } const str=(UI.matchStr??80)/100; const ref=UI.matchRef, me=UI.matchMe; const refMean=ref.reduce((a,b)=>a+b)/10, meMean=me.reduce((a,b)=>a+b)/10; const g=ref.map((r,i)=>clampN((r-refMean)-(me[i]-meMean),-12,12)*str);
  let geq=[...NP.paths.A,...NP.paths.B].find(b=>b.type==='geq'&&b.matched); if(!geq){ if(totalBlocks()>=MAX_BLOCKS){ toast('24 blocks is the limit. Delete one first.'); return; } geq=createBlock('geq'); geq.matched=true; NP.paths.A.push(geq); rewire(); }
  g.forEach((v,i)=>geq.p['b'+i]=Math.round(v*2)/2); applyBlock(geq); NP.selected=geq.id; UI.matchGains=g.map((v,i)=>geq.p['b'+i]); renderTop(); renderEncoders(); renderPage(); toast('Match applied. A Graphic EQ block now holds it.'); }

// ---------- MIDI ----------
function initMIDI(){ if(!navigator.requestMIDIAccess) return; navigator.requestMIDIAccess({sysex:false}).then(acc=>{ UI.midi.on=true; UI.midi.access=acc; const hook=()=>{ UI.midi.inputs=Array.from(acc.inputs.values()); UI.midi.outputs=Array.from(acc.outputs.values()); UI.midi.inputs.forEach(i=>{ i.onmidimessage=onMIDI; }); if(UI.page==='midi') renderPage(); }; hook(); acc.onstatechange=hook; }).catch(()=>{}); }
let clockTicks=0, clockT0=0;
function onMIDI(e){ const [s,d1,d2]=e.data; const type=s&0xf0, ch=s&0x0f;
  if(s===0xF8){ if(!UI.midi.clock) return; clockTicks++; if(clockTicks===1) clockT0=performance.now(); if(clockTicks>=24){ setBpm(60000/(performance.now()-clockT0)); clockTicks=0; } return; }
  if(type===0xC0){ if(UI.midi.pcEnabled) gotoPreset(d1); return; }
  if(type!==0xB0) return;
  if(UI.midi.learn){ const L=UI.midi.learn; UI.midi.maps=UI.midi.maps.filter(m=>!(m.cc===d1&&m.ch===ch)); UI.midi.maps.push({cc:d1, ch, target:L.target, label:L.label, bid:L.bid, ref:L.ref, type:L.type}); UI.midi.learn=null; saveState(); toast('Linked CC '+d1+' to '+L.label); if(UI.page==='midi') renderPage(); return; }
  UI.midi.maps.filter(m=>m.cc===d1&&m.ch===ch).forEach(m=>midiAction(m, d2)); }
function midiAction(m, v){ const on=v>=64, t=m.target;
  if(t==='exp'){ applyExp(v/127); const el=$('#exp'); if(el){ el.value=Math.round(v/127*100); paintRange(el); } return; }
  if(t==='scene'){ const i=Math.min(7,Math.floor(v/16)); if(recallScene(i)){ renderTop(); renderFoot(); if(UI.page==='chain'||UI.page==='scenes') renderPage(); } return; }
  if(t.startsWith('prm:')){ let b=NP.blocks[m.bid]; if(!b){ const r=refBlock(m.ref); if(r&&r.type===m.type) b=r; } if(!b) return; const k=t.slice(4), s=paramSpec(b,k); if(!s) return; setParam(b,k, s.min+(s.max-s.min)*v/127); return; }
  if(!on) return;
  if(t==='fsA') footPress(0); else if(t==='fsB') footPress(1); else if(t==='fsC') footPress(2); else if(t==='tap') tapTempo(); else if(t==='tuner') toggleTuner(); else if(t==='prev') stepPreset(-1); else if(t==='next') stepPreset(1); else if(t==='mute'){ NP.globals.mute=NP.globals.mute?0:1; applyGlobals(); } else if(t==='drums'){ toggleDrums(); } else if(t==='stage'){ if(UI.stage) closeStage(); else openStage(); }
  else if(t.startsWith('byp:')){ const b=refBlock(t.slice(4)); if(b){ setBypass(b,!b.bypass); if(UI.page==='chain') renderPage(); renderFoot(); } } }
function sendPC(idx){ if(!UI.midi.outId||!UI.midi.access) return; const o=UI.midi.access.outputs.get(UI.midi.outId); if(o) o.send([0xC0, idx&0x7f]); }
