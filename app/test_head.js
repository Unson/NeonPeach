// 2.3 checks: the Neon 900 head shows up, makes sound, its controls render, the Wizard and bank 6 have it. Saves screenshots.
const { chromium } = require('playwright'); const path=require('path'); const fs=require('fs');
const SHOTS=path.resolve(__dirname,'shots'); fs.mkdirSync(SHOTS,{recursive:true});
(async()=>{ const browser=await chromium.launch({args:['--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream','--autoplay-policy=no-user-gesture-required']});
  const ctx=await browser.newContext({permissions:['microphone'], viewport:{width:1440,height:900}}); const page=await ctx.newPage();
  const errs=[]; page.on('pageerror',e=>errs.push('PAGEERROR '+e.message+' '+(e.stack||'').split('\n')[1])); page.on('console',m=>{ if(m.type()==='error') errs.push('CONSOLE '+m.text()); });
  await page.goto('file://'+path.resolve(__dirname,'dist/neon-peach.html')); await page.click('#power'); await page.waitForSelector('#pedal',{state:'visible',timeout:15000}); await page.waitForTimeout(1500);
  const shot=async n=>{ await page.waitForTimeout(250); await page.screenshot({path:SHOTS+'/head-'+n+'.png'}); };
  const log=[]; const ok=(c,m)=>log.push((c?'ok   ':'FAIL ')+m);
  ok(await page.evaluate(()=>!!BLOCKS.head && BLOCKS.head.cat==='Amp'), 'head block is registered under Amp');
  ok(await page.evaluate(()=>UI.banks.slice(40,48).filter(p=>p&&p.name.startsWith('900 ')).length===4), 'four 900 presets landed in bank 6');
  // it makes sound in the browser engine, on both circuits, with and without the cab
  const snd=await page.evaluate(async()=>{ const res={}; if(UI.src) UI.src.disconnect(); toggleDemo();
    for(const [name,pp] of [['micro',{circuit:0,drive:60,blend:70,cab:0}],['vint',{circuit:0,mod:100,drive:60,blend:70,cab:1}],['alpha',{circuit:1,drive:60,blend:70,cab:0}],['omega',{circuit:1,mod:100,drive:80,blend:80,cab:1}]]){
      loadPreset(blankPreset()); const b=createBlock('head',pp); NP.paths.A.push(b); rewire(); await new Promise(r=>setTimeout(r,500));
      let pk=0, nan=false; const an=NP.rig.outAn, buf=new Float32Array(an.fftSize); for(let k=0;k<6;k++){ an.getFloatTimeDomainData(buf); for(const v of buf){ if(!isFinite(v)) nan=true; pk=Math.max(pk,Math.abs(v)); } await new Promise(r=>setTimeout(r,60)); } res[name]=nan?'NaN':pk.toFixed(3); }
    toggleDemo(); return res; });
  for(const [t,v] of Object.entries(snd)) ok(v!=='NaN' && +v>0.01, 'head '+t+' sounds (peak '+v+')');
  // the editor: Era label on Microtubes, Mod label on Alpha·Omega, the note changes too
  await page.evaluate(()=>{ loadPreset(blankPreset()); const b=createBlock('head'); NP.paths.A.push(b); rewire(); NP.selected=b.id; go('chain'); renderPage(); renderEncoders(); });
  await page.waitForTimeout(300);
  ok(await page.evaluate(()=>!![...document.querySelectorAll('.editor .pl')].find(x=>x.textContent==='Era')), 'Microtubes circuit shows the Era knob');
  ok(await page.evaluate(()=>(document.querySelector('.editor .blknote')||{}).textContent.includes('B3K')), 'the note explains Era');
  ok(await page.evaluate(()=>[...document.querySelectorAll('.editor .seg button')].some(x=>x.textContent==='Fat')), 'Grunt switch renders as buttons');
  ok(await page.evaluate(()=>!!document.querySelector('.editor select')), 'Cab list renders as a menu');
  await shot('editor-microtubes');
  await page.evaluate(()=>{ const b=NP.blocks[NP.selected]; b.p.circuit=1; applyBlock(b); renderPage(); renderEncoders(); }); await page.waitForTimeout(300);
  ok(await page.evaluate(()=>!![...document.querySelectorAll('.editor .pl')].find(x=>x.textContent==='Mod')), 'Alpha·Omega circuit shows the Mod knob');
  ok(await page.evaluate(()=>(document.querySelector('.editor .blknote')||{}).textContent.includes('Omega')), 'the note explains Mod');
  await shot('editor-alphaomega');
  // the block picker lists it with the new tag
  await page.evaluate(()=>showLibrary('A')); await page.waitForTimeout(200);
  ok(await page.evaluate(()=>{ const x=document.querySelector('.litem[data-lib="head"]'); return !!x && !!x.querySelector('.newtag'); }), 'picker lists the head as new');
  await page.fill('#libq','darkglass'); await page.waitForTimeout(150);
  ok(await page.evaluate(()=>[...document.querySelectorAll('.litem')].filter(x=>x.style.display!=='none').map(x=>x.dataset.lib).join()==='head'), 'searching "darkglass" finds the head');
  await shot('picker'); await page.evaluate(()=>closeModal());
  // the Wizard builds the two new styles
  const wiz=await page.evaluate(()=>{ const out={}; for(const id of ['m900','ao900']){ UI.wiz.id=id; wizApply(false); out[id]=NP.paths.A.map(b=>b.type).join('>')+' head:'+(NP.paths.A.find(b=>b.type==='head')||{p:{}}).p.circuit; } return out; });
  ok(wiz.m900.includes('head') && wiz.m900.endsWith('head:0'), 'Wizard: Microtubes 900 builds ('+wiz.m900+')');
  ok(wiz.ao900.includes('head') && wiz.ao900.endsWith('head:1'), 'Wizard: Alpha·Omega Wall builds ('+wiz.ao900+')');
  const dirt=await page.evaluate(()=>{ UI.wiz.id='m900'; UI.wiz.m.dirt=0.95; wizApply(true); const d=NP.paths.A.find(b=>b.type==='head').p.drive; UI.wiz.m.dirt=0.5; return d; });
  ok(dirt>80, 'Wizard Dirt slider pushes the head drive ('+dirt+')');
  await page.evaluate(()=>{ go('wizard'); renderPage(); }); await shot('wizard');
  // a preset from bank 6 loads and plays
  await page.evaluate(()=>{ gotoPreset(40); go('chain'); renderPage(); }); await page.waitForTimeout(300);
  ok(await page.evaluate(()=>NP.preset.name==='900 B3K Grind' && NP.paths.A.some(b=>b.type==='head')), 'bank 6 preset loads');
  await shot('preset');
  // save and reload: the head survives a round trip through JSON
  const rt=await page.evaluate(()=>{ const s=serializePreset(); loadPreset(s); const h=NP.paths.A.find(b=>b.type==='head'); return h && h.p.circuit===0 && h.p.cab===1; });
  ok(rt, 'preset round trip keeps the head settings');
  // ---- Melted Raspberry ----
  ok(await page.evaluate(()=>!!BLOCKS.raspberry && BLOCKS.raspberry.cat==='Amp'), 'raspberry block is registered under Amp');
  ok(await page.evaluate(()=>UI.banks.slice(40,48).filter(p=>p&&p.name.startsWith('Raspberry ')).length===2), 'two Raspberry presets landed in bank 6');
  const rs=await page.evaluate(async()=>{ const res={}; if(UI.src) UI.src.disconnect(); toggleDemo();
    for(const [name,pp] of [['melt',{circuit:2,drive:60,blend:70,cab:0}],['jam',{circuit:2,mod:100,drive:70,blend:80,cab:1}],['micro',{circuit:0,drive:60,cab:4}]]){
      loadPreset(blankPreset()); const b=createBlock('raspberry',pp); NP.paths.A.push(b); rewire(); await new Promise(r=>setTimeout(r,500));
      let pk=0, nan=false; const an=NP.rig.outAn, buf=new Float32Array(an.fftSize); for(let k=0;k<6;k++){ an.getFloatTimeDomainData(buf); for(const v of buf){ if(!isFinite(v)) nan=true; pk=Math.max(pk,Math.abs(v)); } await new Promise(r=>setTimeout(r,60)); } res[name]=nan?'NaN':pk.toFixed(3); }
    toggleDemo(); return res; });
  for(const [t,v] of Object.entries(rs)) ok(v!=='NaN' && +v>0.01, 'raspberry '+t+' sounds (peak '+v+')');
  await page.evaluate(()=>{ loadPreset(blankPreset()); const b=createBlock('raspberry'); NP.paths.A.push(b); rewire(); NP.selected=b.id; go('chain'); renderPage(); renderEncoders(); }); await page.waitForTimeout(300);
  ok(await page.evaluate(()=>(document.querySelector('.editor .blknote')||{}).textContent.includes('Melt')), 'raspberry note explains Melt and Jam');
  ok(await page.evaluate(()=>[...document.querySelectorAll('.editor .pl')].filter(x=>['70','180','400','1k','2.5k','6k','Air','Split at','Warmth'].includes(x.textContent)).length===9), 'raspberry controls render');
  await shot('editor-raspberry');
  const rw=await page.evaluate(()=>{ UI.wiz.id='rasp'; wizApply(false); return NP.paths.A.map(b=>b.type).join('>'); });
  ok(rw.includes('raspberry'), 'Wizard: Melted Raspberry builds ('+rw+')');
  await page.evaluate(()=>{ gotoPreset(44); }); await page.waitForTimeout(300);
  ok(await page.evaluate(()=>NP.preset.name==='Raspberry Melt' && NP.paths.A.some(b=>b.type==='raspberry')), 'bank 6 Raspberry preset loads');
  console.log(log.join('\n')); if(errs.length) console.log('ERRORS:\n'+errs.join('\n')); else console.log('no page errors');
  await browser.close(); process.exitCode = log.some(l=>l.startsWith('FAIL'))||errs.length ? 1 : 0; })().catch(e=>{ console.error(e); process.exit(1); });
