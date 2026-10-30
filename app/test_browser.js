const { chromium } = require('playwright'); const path=require('path'); const fs=require('fs');
const SHOTS=path.resolve(__dirname,'shots'); fs.mkdirSync(SHOTS,{recursive:true});
(async()=>{
  const browser=await chromium.launch({args:['--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream','--autoplay-policy=no-user-gesture-required']});
  const ctx=await browser.newContext({permissions:['microphone'], viewport:{width:1440,height:900}, deviceScaleFactor:1}); const page=await ctx.newPage();
  const errs=[]; page.on('pageerror',e=>errs.push('PAGEERROR '+e.message+'\n'+(e.stack||'').split('\n').slice(0,3).join('\n'))); page.on('console',m=>{ if(m.type()==='error') errs.push('CONSOLE '+m.text()); });
  await page.goto('file://'+path.resolve(__dirname,'dist/neon-peach.html'));
  await page.waitForTimeout(400); await page.screenshot({path:SHOTS+'/00-splash.png'});
  await page.click('#power'); await page.waitForTimeout(350); await page.screenshot({path:SHOTS+'/01-ignite.png'});
  await page.waitForSelector('#pedal', {state:'visible', timeout:15000}); await page.waitForTimeout(900);
  const r=await page.evaluate(async()=>{
    const log=[]; const t=(n,f)=>{ try{ f(); log.push('ok '+n); }catch(e){ log.push('FAIL '+n+': '+e.message+' @ '+(e.stack||'').split('\n')[1]); } };
    log.push('ctx '+NP.ctx.state+' sr='+NP.ctx.sampleRate+' input='+!!UI.inputOk);
    for(const type of Object.keys(BLOCKS)){ t('block '+type, ()=>{ const b=createBlock(type); NP.paths.A.push(b); rewire(); NP.selected=b.id; renderPage(); renderEncoders(); const d=BLOCKS[type]; for(const k in d.params){ const s=d.params[k]; setParam(b,k,s.max); setParam(b,k,s.min); setParam(b,k,s.def); } for(let i=0;i<6;i++){ encoderDelta(i,2); encoderPress(i); } setBypass(b,true); setBypass(b,false); keepRefs(()=>{ NP.paths.A.pop(); }); destroyBlock(b); NP.selected=null; rewire(); }); }
    { const b=createBlock('looper'); NP.paths.A.push(b); rewire(); let n=0; b.n.l.port.addEventListener('message',()=>n++); await new Promise(r=>setTimeout(r,200));
      NP.paths.A.pop(); b.input.disconnect(); b.output.disconnect(); b.n.l.disconnect(); rewire(); await new Promise(r=>setTimeout(r,250)); const n1=n; await new Promise(r=>setTimeout(r,600));
      log.push('control: old-style removal still sends '+(n-n1)+' msgs in 600ms'); b.n.l.port.postMessage({cmd:'kill'}); delete NP.blocks[b.id]; }
    { const b=createBlock('looper'); NP.paths.A.push(b); rewire(); let n=0; b.n.l.port.addEventListener('message',()=>n++); await new Promise(r=>setTimeout(r,300)); const before=n; keepRefs(()=>{ NP.paths.A.splice(NP.paths.A.indexOf(b),1); }); destroyBlock(b); rewire(); await new Promise(r=>setTimeout(r,250)); const n1=n; await new Promise(r=>setTimeout(r,600)); log.push((n===n1&&before>0?'ok':'FAIL')+' removed looper goes silent (msgs before='+before+', after kill='+(n-n1)+')'); }
    for(let i=0;i<16;i++){ t('preset '+i, ()=>{ gotoPreset(i); }); }
    for(const p of PAGES){ if(p==='|') continue; t('page '+p[0], ()=>{ go(p[0]); }); }
    go('chain'); gotoPreset(1); NP.selected=NP.paths.A[1].id; renderPage(); renderEncoders();
    t('encoders', ()=>{ for(let i=0;i<6;i++){ encoderDelta(i,3); encoderDelta(i,-3); encoderPress(i); } });
    t('modes+foot', ()=>{ ['preset','scene','stomp'].forEach(m=>{ NP.mode=m; renderFoot(); for(let i=0;i<3;i++) footPress(i); }); NP.mode='preset'; renderFoot(); });
    t('stomp defaults', ()=>{ gotoPreset(1); if(!NP.preset.stomps.A.length) throw new Error('factory preset has no stomp A'); });
    t('scenes', ()=>{ NP.preset.scenes[0].data=captureScene(); recallScene(0); renderPage(); });
    t('split modes', ()=>{ for(let m=0;m<4;m++){ NP.preset.split.mode=m; rewire(); renderPage(); } NP.preset.split.mode=0; rewire(); });
    t('keepRefs move', ()=>{ gotoPreset(1); const A=NP.paths.A; const drive=A.find(b=>b.type==='b3k'); NP.preset.stomps.A=[{ref:refOf(drive),mode:'toggle'}]; NP.preset.scenes[2].data=captureScene(); drive.p.drive=11; NP.preset.scenes[2].data.params.A[A.indexOf(drive)].drive=77;
        keepRefs(()=>{ A.splice(A.indexOf(drive),1); A.unshift(drive); }); rewire();
        if(refBlock(NP.preset.stomps.A[0].ref)!==drive) throw new Error('stomp ref lost'); recallScene(2); if(drive.p.drive!==77) throw new Error('scene params lost: '+drive.p.drive); });
    t('keepRefs delete', ()=>{ const A=NP.paths.A; const victim=A[0]; keepRefs(()=>{ A.splice(0,1); }); destroyBlock(victim); rewire(); if(NP.preset.stomps.A.some(x=>refBlock(x.ref)===victim)) throw new Error('dangling'); });
    t('ensureB', ()=>{ loadPreset(blankPreset()); NP.preset.split.bLvl=-100; NP.paths.B.push(createBlock('chorus')); rewire(); ensureB(); if(NP.preset.split.bLvl!==0) throw new Error('B still muted'); });
    t('save/load', ()=>{ const s=serializePreset(); loadPreset(s); saveState(); const st=JSON.parse(localStorage.getItem(LS)); if(!st.banks||st.banks.length!==128) throw new Error('banks'); });
    t('tap/bpm', ()=>{ tapTempo(); setBpm(140); });
    t('exp', ()=>{ gotoPreset(1); const b=NP.paths.A[1]; const k=Object.keys(BLOCKS[b.type].params).find(k=>!BLOCKS[b.type].params[k].e); NP.preset.exp.target={ref:refOf(b),key:k}; applyExp(0.5); renderFoot(); const s=serializePreset(); loadPreset(s); if(!expBlock()) throw new Error('exp target lost after reload'); });
    t('library modal once', ()=>{ loadPreset(blankPreset()); showLibrary('A'); closeModal(); showLibrary('A'); const btn=document.querySelector('[data-lib="chorus"]'); btn.click(); if(NP.paths.A.length!==1) throw new Error('added '+NP.paths.A.length+' blocks'); });
    t('demo', ()=>{ toggleDemo(); });
    t('tuner', ()=>{ toggleTuner(); tunerTick(); toggleTuner(); });
    t('looper', ()=>{ go('looper'); if(!findLooper()){ NP.paths.A.push(createBlock('looper')); rewire(); } renderPage(); looperCmd('rec'); });
    await new Promise(r=>setTimeout(r,700));
    log.push('loopstate '+JSON.stringify(findLooper().loopState&&findLooper().loopState.state)+' ring='+document.querySelector('#lfill').style.strokeDasharray);
    t('looper stop', ()=>{ looperCmd('rec'); looperCmd('stop'); looperCmd('clear'); });
    t('match bars', ()=>{ UI.matchGains=[3,-2,0,5,-6,1,2,-1,0,4]; go('match'); });
    await new Promise(r=>setTimeout(r,900));
    log.push('meters in='+NP.meters.in.toFixed(3)+' out='+NP.meters.out.toFixed(3)+' sig='+UI.sig.toFixed(2)+' blocks='+totalBlocks());
    return log;
  });
  r.forEach(l=>console.log(l));
  // screenshots of every page with a rich preset
  const shot=async(name, fn)=>{ await page.evaluate(fn); await page.waitForTimeout(260); await page.screenshot({path:`${SHOTS}/${name}.png`}); };
  await page.evaluate(()=>{ gotoPreset(8); NP.selected=null; go('chain'); }); // Xover Dirt Up Top (dual path)
  await shot('10-chain-dual', ()=>{});
  await shot('11-chain-editor', ()=>{ gotoPreset(1); NP.selected=NP.paths.A[1].id; renderPage(); renderEncoders(); });
  await shot('12-chain-delay', ()=>{ gotoPreset(9); NP.selected=NP.paths.A.find(b=>b.type==='delay').id; NP.paths.A.find(b=>b.type==='comp').bypass||setBypass(NP.paths.A.find(b=>b.type==='comp'),true); renderPage(); renderEncoders(); });
  await shot('13-chain-series', ()=>{ gotoPreset(7); NP.preset.split.mode=2; rewire(); NP.selected=null; renderPage(); renderEncoders(); });
  for(const [i,pg] of ['presets','scenes','stomp','tuner','looper','clone','match','io','midi','global','help'].entries()){
    await shot(`2${i.toString(16)}-${pg}`, new Function(`gotoPreset(1); NP.preset.scenes[0].data=captureScene(); NP.preset.scenes[0].name='Verse'; NP.preset.scenes[1].data=captureScene(); NP.preset.scenes[1].name='Chorus'; recallScene(1); go('${pg}'); renderTop();`));
  }
  await shot('25b-looper-empty', ()=>{ gotoPreset(15); go('looper'); });
  await page.evaluate(()=>looperCmd('rec')); await page.waitForTimeout(1600); await page.screenshot({path:SHOTS+'/25c-looper-rec.png'});
  console.log((await page.evaluate(()=>document.querySelector('#lstate').textContent))==='Rec'?'ok looper shows Rec while recording':'FAIL looper label during rec: '+await page.evaluate(()=>document.querySelector('#lstate').textContent));
  await page.evaluate(()=>looperCmd('rec')); await page.waitForTimeout(700); await page.screenshot({path:SHOTS+'/25d-looper-play.png'});
  await page.evaluate(()=>looperCmd('clear'));
  await shot('30-library', ()=>{ go('chain'); showLibrary('B'); });
  await page.evaluate(()=>closeModal());
  await shot('31-scene-mode', ()=>{ NP.mode='scene'; renderTop(); renderFoot(); go('chain'); });
  await page.setViewportSize({width:1366,height:768}); await shot('39-1366', ()=>{ NP.mode='stomp'; renderTop(); renderFoot(); gotoPreset(9); go('chain'); });
  await shot('39b-1366-series', ()=>{ gotoPreset(7); NP.preset.split.mode=2; rewire(); for(let i=0;i<3;i++) NP.paths.B.push(createBlock(['chorus','delay','reverb'][i])); rewire(); go('chain'); renderTop(); });
  await page.setViewportSize({width:1100,height:820}); await shot('40-laptop', ()=>{ NP.mode='stomp'; renderTop(); renderFoot(); gotoPreset(1); go('chain'); });
  await page.setViewportSize({width:412,height:900}); await shot('50-mobile-chain', ()=>{ gotoPreset(1); NP.selected=NP.paths.A[1].id; go('chain'); renderEncoders(); });
  await page.screenshot({path:SHOTS+'/51-mobile-full.png', fullPage:true});
  await shot('52-mobile-presets', ()=>{ go('presets'); });
  console.log('\nERRORS:', errs.length? errs.join('\n') : 'none');
  await browser.close();
})().catch(e=>{ console.error('HARNESS FAIL', e); process.exit(1); });
