const path=require('path'); const addon=require('../build/linux-x64/npaudio.node'), mk=require('../shim.js');
function run(build){ const e=new addon.Engine({sampleRate:48000,outChannels:1}); const sh=mk({send:o=>e.cmd(o)},{sampleRate:48000,offline:true,outChannels:1}); const c=new sh.NativeAudioContext();
  const buf=c.createBuffer(1,64,48000); buf.getChannelData(0)[0]=1; const s=c.createBufferSource(); s.buffer=buf; const o=build(c,s); o.connect(c.destination); s.start(0); sh.flush();
  const y=e.render(4800,[],128)[0]; const pk=[]; for(let i=0;i<y.length;i++) if(Math.abs(y[i])>1e-3) pk.push(i+':'+y[i].toFixed(3)); return pk.slice(0,6).join(' '); }
console.log('delayLoop     ', run((c,s)=>{ const d=c.createDelay(1); d.delayTime.value=0.01; const fb=c.createGain(); fb.gain.value=0.5; s.connect(d); d.connect(fb).connect(d); return d; }));
console.log('delayLoopShort', run((c,s)=>{ const d=c.createDelay(1); d.delayTime.value=0.001; const fb=c.createGain(); fb.gain.value=0.5; s.connect(d); d.connect(fb).connect(d); return d; }));
console.log('noDelayLoop   ', run((c,s)=>{ const g1=c.createGain(); const g2=c.createGain(); g2.gain.value=0.5; s.connect(g1); g1.connect(g2).connect(g1); return g1; }));
console.log('target ramp   ', run((c,s)=>{ const d=c.createDelay(1); d.delayTime.setTargetAtTime(0.005,0,0.001); s.connect(d); return d; }));
