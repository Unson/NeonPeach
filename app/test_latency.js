// Measures the real delay through the chain for each factory preset: a click goes in, we find where it comes out.
const { chromium } = require('playwright'); const path=require('path');
const file=process.argv[2]||'dist/neon-peach.html';
(async()=>{ const browser=await chromium.launch({args:['--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream','--autoplay-policy=no-user-gesture-required']});
  const page=await (await browser.newContext({permissions:['microphone']})).newPage(); const errs=[]; page.on('pageerror',e=>errs.push(e.message));
  await page.goto('file://'+path.resolve(__dirname,file)); await page.click('#power'); await page.waitForSelector('#pedal',{state:'visible',timeout:15000}); await page.waitForTimeout(800);
  const r=await page.evaluate(async()=>{ const ctx=NP.ctx, r=NP.rig, out=[]; if(UI.src) UI.src.disconnect();
    async function measure(){ const mg=ctx.createChannelMerger(2), rec=new AudioWorkletNode(ctx,'np-recorder'), mono=ctx.createGain(); mono.channelCount=1; mono.channelCountMode='explicit';
      const buf=ctx.createBuffer(1,64,ctx.sampleRate); buf.getChannelData(0)[0]=0.25; const s=ctx.createBufferSource(); s.buffer=buf; const g=ctx.createGain();
      s.connect(g); g.connect(r.inGain); g.connect(mg,0,0); r.outGain.connect(mono).connect(mg,0,1); mg.connect(rec);
      const res=await new Promise(res=>{ rec.port.onmessage=e=>{ if(e.data.done) res(e.data); }; rec.port.postMessage({cmd:'start'}); s.start(ctx.currentTime+0.15); setTimeout(()=>rec.port.postMessage({cmd:'stop'}),600); });
      r.outGain.disconnect(mono); g.disconnect(); rec.port.postMessage({cmd:'kill'});
      const a=res.L, b=res.R; let i0=-1; for(let i=0;i<a.length;i++) if(Math.abs(a[i])>0.01){ i0=i; break; } let mx=0; for(let i=i0;i<i0+4800&&i<b.length;i++) mx=Math.max(mx,Math.abs(b[i])); let o=-1; for(let i=i0;i<b.length;i++) if(Math.abs(b[i])>mx*0.2){ o=i; break; }
      return i0<0||o<0?null:(o-i0)/ctx.sampleRate*1000; }
    for(let i=0;i<16;i++){ if(!UI.banks[i]) continue; gotoPreset(i); await new Promise(r=>setTimeout(r,250)); const ms=await measure(); out.push([UI.banks[i].name, ms==null?'n/a':ms.toFixed(2)]); }
    return out; });
  console.log(file); r.forEach(([n,ms])=>console.log((ms+' ms').padStart(10), n)); if(errs.length) console.log('ERRORS', errs); await browser.close(); })();
