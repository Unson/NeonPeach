const { chromium } = require('playwright'); const path=require('path');
(async()=>{ const b=await chromium.launch(); const p=await b.newPage(); await p.goto('file://'+path.join(__dirname,'blank.html'));
const r=await p.evaluate(async()=>{ const out={}; const sr=48000;
 async function run(build){ const c=new OfflineAudioContext(1,4800,sr); const buf=c.createBuffer(1,64,sr); buf.getChannelData(0)[0]=1; const s=c.createBufferSource(); s.buffer=buf; const o=build(c,s); o.connect(c.destination); s.start(0); const y=(await c.startRendering()).getChannelData(0); const pk=[]; for(let i=0;i<y.length;i++) if(Math.abs(y[i])>1e-3) pk.push(i+':'+y[i].toFixed(3)); return pk.slice(0,6).join(' '); }
 out.delayLoop=await run((c,s)=>{ const d=c.createDelay(1); d.delayTime.value=0.01; const fb=c.createGain(); fb.gain.value=0.5; s.connect(d); d.connect(fb).connect(d); return d; });
 out.target=await run((c,s)=>{ const d=c.createDelay(1); d.delayTime.setTargetAtTime(0.005,0,0.001); s.connect(d); return d; });
 out.delayLoopShort=await run((c,s)=>{ const d=c.createDelay(1); d.delayTime.value=0.001; const fb=c.createGain(); fb.gain.value=0.5; s.connect(d); d.connect(fb).connect(d); return d; });
 out.noDelayLoop=await run((c,s)=>{ const g1=c.createGain(); const g2=c.createGain(); g2.gain.value=0.5; s.connect(g1); g1.connect(g2).connect(g1); return g1; });
 
 return out; }); console.log(r); await b.close(); })();
