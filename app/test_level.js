// Plays the demo riff through each factory preset and reports the output level, to compare builds.
const { chromium } = require('playwright'); const path=require('path');
const file=process.argv[2]||'dist/neon-peach.html';
(async()=>{ const browser=await chromium.launch({args:['--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream','--autoplay-policy=no-user-gesture-required']});
  const page=await (await browser.newContext({permissions:['microphone']})).newPage(); const errs=[]; page.on('pageerror',e=>errs.push(e.message));
  await page.goto('file://'+path.resolve(__dirname,file)); await page.click('#power'); await page.waitForSelector('#pedal',{state:'visible',timeout:15000}); await page.waitForTimeout(800);
  const r=await page.evaluate(async()=>{ const out=[]; if(UI.src) UI.src.disconnect(); NP.bpm=120; toggleDemo(); const an=NP.rig.outAn, buf=new Float32Array(an.fftSize);
    for(let i=0;i<16;i++){ gotoPreset(i); NP.bpm=120; await new Promise(r=>setTimeout(r,700)); let s=0,n=0; for(let k=0;k<40;k++){ an.getFloatTimeDomainData(buf); for(const v of buf){ s+=v*v; n++; } await new Promise(r=>setTimeout(r,45)); } out.push([UI.banks[i].name, (10*Math.log10(s/n+1e-12)).toFixed(1)]); }
    toggleDemo(); return out; });
  r.forEach(([n,d])=>console.log((d+' dB').padStart(9), n)); if(errs.length) console.log('ERRORS',errs); await browser.close(); })();
