// Every block: it builds in the browser engine, makes sound with no NaN, and its editor renders. Saves a few screenshots.
const { chromium } = require('playwright'); const path=require('path'); const fs=require('fs');
const SHOTS=path.resolve(__dirname,'shots'); fs.mkdirSync(SHOTS,{recursive:true});
(async()=>{ const browser=await chromium.launch({args:['--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream','--autoplay-policy=no-user-gesture-required']});
  const ctx=await browser.newContext({permissions:['microphone'], viewport:{width:1440,height:900}}); const page=await ctx.newPage();
  const errs=[]; page.on('pageerror',e=>errs.push('PAGEERROR '+e.message+' '+(e.stack||'').split('\n')[1])); page.on('console',m=>{ if(m.type()==='error') errs.push('CONSOLE '+m.text()); });
  await page.goto('file://'+path.resolve(__dirname,'dist/neon-peach.html')); await page.click('#power'); await page.waitForSelector('#pedal',{state:'visible',timeout:15000}); await page.waitForTimeout(1500);
  const log=[]; const ok=(c,m)=>log.push((c?'ok   ':'FAIL ')+m);
  const types=await page.evaluate(()=>Object.keys(BLOCKS).filter(t=>!['clone','capture','fxloop','auxsend'].includes(t)));
  for(const t of types){
    const r=await page.evaluate(async(t)=>{ if(UI.src) UI.src.disconnect(); if(!UI.demoOn) toggleDemo(); loadPreset(blankPreset()); const b=createBlock(t); NP.paths.A.push(b); rewire(); NP.selected=b.id; go('chain'); renderPage(); renderEncoders();
      if(t==='freeze'){ setBypass(b,true); await new Promise(r=>setTimeout(r,400)); setBypass(b,false); }
      await new Promise(r=>setTimeout(r,600)); let pk=0, nan=false; const an=NP.rig.outAn, buf=new Float32Array(an.fftSize); for(let k=0;k<6;k++){ an.getFloatTimeDomainData(buf); for(const v of buf){ if(!isFinite(v)) nan=true; pk=Math.max(pk,Math.abs(v)); } await new Promise(r=>setTimeout(r,60)); }
      const rows=document.querySelectorAll('.editor .prow').length, want=Object.values(BLOCKS[t].params).filter(p=>!p.hidden).length; return {pk:pk.toFixed(3), nan, rows, want}; }, t);
    ok(!r.nan && +r.pk>0.01 && r.rows>=r.want, t.padEnd(10)+' sounds (peak '+r.pk+') and shows '+r.rows+'/'+r.want+' controls');
    if(['comp','delay','reverb','chorus','rotary','od','tubepre','octave'].includes(t)){ await page.waitForTimeout(200); await page.screenshot({path:SHOTS+'/all-'+t+'.png'}); } }
  // bank 3 presets still load and play (old presets on the new blocks)
  const pre=await page.evaluate(async()=>{ const out=[]; for(let i=16;i<40;i++){ if(!UI.banks[i]) continue; gotoPreset(i); await new Promise(r=>setTimeout(r,500)); let pk=0, nan=false; const an=NP.rig.outAn, buf=new Float32Array(an.fftSize); for(let k=0;k<4;k++){ an.getFloatTimeDomainData(buf); for(const v of buf){ if(!isFinite(v)) nan=true; pk=Math.max(pk,Math.abs(v)); } await new Promise(r=>setTimeout(r,60)); } out.push([UI.banks[i].name, pk.toFixed(2), nan]); } toggleDemo(); return out; });
  for(const [n,pk,nan] of pre) ok(!nan && +pk>0.01 && +pk<1.5, 'preset '+n+' plays (peak '+pk+')');
  console.log(log.join('\n')); if(errs.length) console.log('ERRORS:\n'+errs.join('\n')); else console.log('no page errors');
  await browser.close(); process.exitCode = log.some(l=>l.startsWith('FAIL'))||errs.length ? 1 : 0; })().catch(e=>{ console.error(e); process.exit(1); });
