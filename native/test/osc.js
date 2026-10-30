const { chromium } = require('playwright'); const path=require('path'); const addon=require('../build/linux-x64/npaudio.node'), mk=require('../shim.js');
const cases=[['sine',0.8],['sine',440],['triangle',0.73],['square',110],['sawtooth',55],['triangle',110],['sine',2000]]; const N=48000;
function nat(type,f){ const e=new addon.Engine({sampleRate:48000,outChannels:1}); const sh=mk({send:o=>e.cmd(o)},{sampleRate:48000,offline:true,outChannels:1}); const c=new sh.NativeAudioContext(); const o=c.createOscillator(); o.type=type; o.frequency.value=f; o.connect(c.destination); o.start(); sh.flush(); return e.render(N,[],128)[0]; }
(async()=>{ const b=await chromium.launch(); const p=await b.newPage(); await p.goto('file://'+path.join(__dirname,'blank.html'));
for(const [t,f] of cases){ const ref=await p.evaluate(async([t,f,N])=>{ const c=new OfflineAudioContext(1,N,48000); const o=c.createOscillator(); o.type=t; o.frequency.value=f; o.connect(c.destination); o.start(); return Array.from((await c.startRendering()).getChannelData(0)); },[t,f,N]);
  const x=nat(t,f); let e=0,pw=0,mx=0; for(let i=0;i<N;i++){ const d=ref[i]-x[i]; e+=d*d; pw+=ref[i]*ref[i]; mx=Math.max(mx,Math.abs(d)); }
  let rp=0,xp=0; for(let i=0;i<N;i++){ rp=Math.max(rp,Math.abs(ref[i])); xp=Math.max(xp,Math.abs(x[i])); }
  console.log(t.padEnd(9), String(f).padStart(5), 'SNR', (10*Math.log10(pw/e)).toFixed(1), 'peak ref', rp.toFixed(4), 'nat', xp.toFixed(4), 'first', ref.slice(0,3).map(v=>v.toFixed(5)).join(','), '|', Array.from(x.slice(0,3)).map(v=>v.toFixed(5)).join(',')); }
await b.close(); })();
