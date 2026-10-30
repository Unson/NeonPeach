// v2 checks: new blocks make sound, Wizard, Beats, Stage, undo, ping, outputs. Saves screenshots.
const { chromium } = require('playwright'); const path=require('path'); const fs=require('fs');
const SHOTS=path.resolve(__dirname,'shots'); fs.mkdirSync(SHOTS,{recursive:true});
(async()=>{ const browser=await chromium.launch({args:['--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream','--autoplay-policy=no-user-gesture-required']});
  const ctx=await browser.newContext({permissions:['microphone'], viewport:{width:1440,height:900}}); const page=await ctx.newPage();
  const errs=[]; page.on('pageerror',e=>errs.push('PAGEERROR '+e.message+' '+(e.stack||'').split('\n')[1])); page.on('console',m=>{ if(m.type()==='error') errs.push('CONSOLE '+m.text()); });
  await page.goto('file://'+path.resolve(__dirname,'dist/neon-peach.html')); await page.click('#power'); await page.waitForSelector('#pedal',{state:'visible',timeout:15000}); await page.waitForTimeout(1200);
  const shot=async n=>{ await page.waitForTimeout(250); await page.screenshot({path:SHOTS+'/v2-'+n+'.png'}); };
  const log=[]; const ok=(c,m)=>log.push((c?'ok   ':'FAIL ')+m);
  // presets
  ok(await page.evaluate(()=>!!UI.banks[16]&&UI.banks[16].name==='Pop-Punk Punch'), 'new presets land in bank 3');
  // new blocks make sound, no NaN
  const snd=await page.evaluate(async()=>{ const res={}; if(UI.src) UI.src.disconnect(); toggleDemo(); for(const t of NEW_BLOCKS){ loadPreset(blankPreset()); const b=createBlock(t); NP.paths.A.push(b); rewire(); if(t==='freeze'){ setBypass(b,true); await new Promise(r=>setTimeout(r,400)); setBypass(b,false); }
      await new Promise(r=>setTimeout(r,500)); let pk=0, nan=false; const an=NP.rig.outAn, buf=new Float32Array(an.fftSize); for(let k=0;k<6;k++){ an.getFloatTimeDomainData(buf); for(const v of buf){ if(!isFinite(v)) nan=true; pk=Math.max(pk,Math.abs(v)); } await new Promise(r=>setTimeout(r,60)); } res[t]=nan?'NaN':pk.toFixed(3); } toggleDemo(); return res; });
  for(const [t,v] of Object.entries(snd)) ok(v!=='NaN' && (t==='fxloop'||+v>0.01), 'block '+t+' sounds (peak '+v+')');
  // chain delay: drives line up, paths line up
  const lat=await page.evaluate(async()=>{ gotoPreset(8); await new Promise(r=>setTimeout(r,200)); return {chain:chainLatency(), a:pathLat('A'), b:pathLat('B'), da:NP.rig.aDel.delayTime.value*NP.ctx.sampleRate, db:NP.rig.bDel.delayTime.value*NP.ctx.sampleRate}; });
  ok(Math.abs(Math.abs(lat.a-lat.b)-Math.abs(lat.da-lat.db))<1, 'crossover preset paths line up (A '+lat.a.toFixed(1)+' B '+lat.b.toFixed(1)+' pad A '+lat.da.toFixed(1)+' pad B '+lat.db.toFixed(1)+')');
  // chain page with scope
  await page.evaluate(()=>{ gotoPreset(1); go('chain'); toggleDemo(); NP.selected=NP.paths.A[0].id; renderPage(); renderEncoders(); }); await page.waitForTimeout(700);
  ok(await page.evaluate(()=>{ const c=document.querySelector('#scope'); const d=c.getContext('2d').getImageData(0,0,c.width,c.height).data; let n=0; for(let i=3;i<d.length;i+=4) if(d[i]>0) n++; return n>500; }), 'scope draws the waveform');
  ok(await page.evaluate(()=>{ const el=document.getElementById('grbar_'+NP.selected); return !!el && parseFloat(el.style.width)>0; }), 'compressor squeeze meter moves');
  await shot('chain-scope');
  // library search
  await page.evaluate(()=>{ showLibrary('A'); }); await page.fill('#libq','fuzz'); await page.waitForTimeout(150);
  ok(await page.evaluate(()=>[...document.querySelectorAll('.litem')].filter(x=>x.style.display!=='none').map(x=>x.dataset.lib).join()==='ignis,muff,octfuzz'), 'block search finds the fuzzes: '+await page.evaluate(()=>[...document.querySelectorAll('.litem')].filter(x=>x.style.display!=='none').map(x=>x.dataset.lib).join()));
  await shot('library-search'); await page.fill('#libq',''); await page.waitForTimeout(100); await shot('library');
  // insert after selected
  await page.evaluate(()=>{ closeModal(); gotoPreset(1); NP.selected=NP.paths.A[0].id; showLibrary('A'); document.querySelector('[data-lib="tilt"]').click(); });
  ok(await page.evaluate(()=>NP.paths.A[1].type==='tilt'), 'new block goes right after the picked one');
  // wizard
  await page.evaluate(()=>go('wizard')); await shot('wizard-empty');
  const wz=await page.evaluate(async()=>{ const out=[]; for(const s of WIZ){ document.querySelector(`[data-wiz="${s.id}"]`).click(); await new Promise(r=>setTimeout(r,80)); out.push(s.id+':'+NP.paths.A.length); } return out; });
  ok(wz.every(x=>+x.split(':')[1]>0), 'every Wizard style builds a chain ('+wz.length+')');
  await page.evaluate(()=>document.querySelector('[data-wiz="poppunk"]').click());
  const before=await page.evaluate(()=>NP.paths.A.find(b=>b.type==='mbdrive').p.drive);
  await page.evaluate(()=>{ const r=document.querySelector('#wm_dirt'); r.value=95; r.dispatchEvent(new Event('input',{bubbles:true})); }); await page.waitForTimeout(250);
  const after=await page.evaluate(()=>NP.paths.A.find(b=>b.type==='mbdrive').p.drive);
  ok(after>before, 'Dirt slider pushes the drive ('+before.toFixed(0)+' -> '+after.toFixed(0)+')'); await shot('wizard');
  // undo
  const u=await page.evaluate(async()=>{ go('chain'); const b=NP.paths.A[0]; await new Promise(r=>setTimeout(r,600)); const v0=b.p.ratio; setParam(b,'ratio',17); await new Promise(r=>setTimeout(r,600)); undo(); const v1=NP.paths.A[0].p.ratio; redo(); const v2=NP.paths.A[0].p.ratio; return [v0,v1,v2]; });
  ok(u[0]===u[1] && u[2]===17, 'undo and redo a knob ('+u.join(' -> ')+')');
  const u2=await page.evaluate(async()=>{ const n=NP.paths.A.length; const b=NP.paths.A[NP.paths.A.length-1]; keepRefs(()=>NP.paths.A.pop()); destroyBlock(b); rewire(); await new Promise(r=>setTimeout(r,600)); undo(); return [n, NP.paths.A.length]; });
  ok(u2[0]===u2[1], 'undo brings back a deleted block ('+u2.join(' -> ')+')');
  // beats
  await page.evaluate(()=>{ toggleDemo(); go('drums'); }); await shot('beats-stopped');
  const dr=await page.evaluate(async()=>{ setBpm(120); UI.dr.countIn=false; toggleDrums(); await new Promise(r=>setTimeout(r,1400)); const m=UI.dr.marks.length, now=document.querySelectorAll('.dcol.now').length; let lvl=0; for(let i=0;i<20;i++){ lvl=Math.max(lvl,NP.meters.out); await new Promise(r=>setTimeout(r,40)); } const an=NP.rig.outAn, bb=new Float32Array(an.fftSize); an.getFloatTimeDomainData(bb); const nan=bb.some(v=>!isFinite(v)); return {m, lvl, now, info:'master '+NP.rig.master.gain.value.toFixed(2)+' drums '+(NP.rig.drums&&NP.rig.drums.gain.value.toFixed(2))+' guard '+NP.cloneGuard+' nan '+nan+' chain '+NP.paths.A.map(x=>x.type)}; });
  ok(dr.m>8 && dr.lvl>0.01 && dr.now===1, 'beats play in time (steps '+dr.m+', out '+dr.lvl.toFixed(2)+', lit step '+dr.now+') '+dr.info); await shot('beats');
  const grid=await page.evaluate(()=>{ const t=UI.dr.marks.filter(x=>!x[2]).map(x=>x[0]); const d=[]; for(let i=1;i<t.length;i++) d.push(t[i]-t[i-1]); return d.every(x=>Math.abs(x-0.125)<1e-6); });
  ok(grid, 'beat steps are exactly a 16th apart at 120 bpm');
  await page.evaluate(()=>{ document.querySelector('[data-beat="funk"]').click(); }); await page.waitForTimeout(400);
  await page.evaluate(()=>toggleDrums());
  // stage
  await page.evaluate(()=>{ gotoPreset(16); openStage(); }); await page.waitForTimeout(400); await shot('stage');
  const st=await page.evaluate(()=>{ const n0=NP.slot; document.querySelector('[data-svstep="1"]').click(); const t=document.querySelector('.sv-title').textContent; return [n0, NP.slot, t, UI.banks[NP.bank*8+NP.slot].name]; });
  ok(st[1]===st[0]+1 && st[2]===st[3], 'stage mode steps presets ('+st[2]+')');
  await page.keyboard.press('Escape'); ok(await page.evaluate(()=>!UI.stage), 'Esc leaves stage mode');
  // ping with a fake 10 ms cable
  const pg=await page.evaluate(async()=>{ const d=NP.ctx.createDelay(1); d.delayTime.value=0.010; NP.rig.merge.connect(d).connect(NP.rig.inPre); const ms=await pingTest(); NP.rig.merge.disconnect(d); d.disconnect(); return ms; });
  ok(pg && Math.abs(pg-(10+128/48))<0.3, 'ping test reads a 10 ms loop (plus the 2.67 ms web audio adds to any loop) as '+(pg&&pg.toFixed(2))+' ms');
  const pg2=await page.evaluate(async()=>{ UI.pingMs=null; const ms=await pingTest(); return [ms, UI.pingMsg]; });
  ok(pg2[0]==null, 'ping with no loop gives a plain message');
  await page.evaluate(()=>go('io')); await shot('audio');
  await page.evaluate(()=>go('outs')); await shot('outputs');
  await page.evaluate(()=>{ NP.globals.mono=1; applyGlobals(); NP.globals.mono=0; NP.globals.auxSrc=2; applyGlobals(); NP.globals.auxSrc=0; applyGlobals(); });
  for(const p of ['scenes','stomp','clone','match','midi','global','help','presets','tuner','looper']){ await page.evaluate(p=>go(p),p); }
  await page.evaluate(()=>go('scenes')); await shot('switches');
  await page.evaluate(()=>go('presets')); await page.evaluate(()=>{ UI.viewBank=2; renderPage(); }); await shot('presets-bank3');
  // phone width
  await page.setViewportSize({width:390,height:844}); for(const p of ['wizard','drums','outs','io']){ await page.evaluate(p=>go(p),p); await page.waitForTimeout(200); const sw=await page.evaluate(()=>document.documentElement.scrollWidth-window.innerWidth); ok(sw<=0, p+': no sideways scroll on a phone ('+sw+' px)'); }
  await shot('phone-beats'); await page.evaluate(()=>openStage()); await shot('phone-stage'); await page.evaluate(()=>closeStage());
  // review fixes
  await page.setViewportSize({width:1440,height:900});
  await page.evaluate(()=>{ gotoPreset(1); go('chain'); NP.selected=NP.paths.A[0].id; renderPage(); }); await page.waitForTimeout(700);
  const rng=await page.$('input[data-pk="ratio"]'); await rng.focus(); const v0=await page.evaluate(()=>NP.paths.A[0].p.ratio);
  await page.evaluate(()=>{ const r=document.querySelector('input[data-pk="ratio"]'); r.value=15; r.dispatchEvent(new Event('input',{bubbles:true})); }); await page.waitForTimeout(700);
  await page.keyboard.press('Control+z'); await page.waitForTimeout(200);
  ok(await page.evaluate(()=>NP.paths.A[0].p.ratio)===v0, 'Ctrl+Z works right after dragging a slider ('+v0+')');
  const fl=await page.evaluate(()=>{ loadPreset(blankPreset()); const b=createBlock('fxloop'); NP.paths.A.push(b); rewire(); NP.selected=b.id; go('chain'); return [BLOCKS.fxloop.note(b), !!document.querySelector('.blknote')]; });
  ok(/no Out 3-4/.test(fl[0]) && fl[1], 'FX Loop explains when the interface has no spare jacks: '+fl[0]);
  const lk=await page.evaluate(async()=>{ loadPreset(blankPreset()); const b=createBlock('mbcomp'); NP.paths.A.push(b); rewire(); let n=0; b.n.c[0].port.onmessage=()=>n++; await new Promise(r=>setTimeout(r,300)); keepRefs(()=>NP.paths.A.pop()); destroyBlock(b); rewire(); b.n.c[0].port.onmessage=()=>n++; await new Promise(r=>setTimeout(r,200)); const n1=n; await new Promise(r=>setTimeout(r,500)); return n-n1; });
  ok(lk===0, 'removed Three Band Squeeze frees its compressors ('+lk+' msgs after)');
  const ax=await page.evaluate(async()=>{ gotoPreset(UI.banks.findIndex(p=>p&&p.name==='Stage Amp + DI (Aux)')); toggleDemo(); const an=NP.ctx.createAnalyser(); NP.rig.auxSplit.connect(an); const pk=()=>{ const b=new Float32Array(2048); an.getFloatTimeDomainData(b); let m=0; for(const v of b) m=Math.max(m,Math.abs(v)); return m; };
    await new Promise(r=>setTimeout(r,500)); let p0=0; for(let i=0;i<10;i++){ p0=Math.max(p0,pk()); await new Promise(r=>setTimeout(r,40)); } NP.globals.auxSrc=1; applyGlobals(); await new Promise(r=>setTimeout(r,300)); const g=NP.rig.auxSends.gain.value; NP.globals.auxSrc=0; applyGlobals(); toggleDemo(); return [p0,g]; });
  ok(ax[0]>0.05 && ax[0]<=0.9, 'Aux Send reaches Aux, held under the ceiling (peak '+ax[0].toFixed(2)+')'); ok(ax[1]<0.01, 'Aux Send blocks go quiet when Aux carries a copy of Main');
  ok(errs.length===0, 'no page errors'+(errs.length?': '+errs.join(' | '):''));
  console.log(log.join('\n')); console.log(log.some(l=>l.startsWith('FAIL'))?'SOME FAILED':'all passed'); await browser.close(); })();
