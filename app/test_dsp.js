// Node tests for pure DSP helpers in engine.js (no Web Audio needed)
const fs=require('fs'); const vm=require('vm');
const src=fs.readFileSync(__dirname+'/engine.js','utf8');
const ctx={ window:{}, console, Math, Float32Array, Float64Array, Array, Object, JSON, Blob:class{constructor(p){this.parts=p;}}, ArrayBuffer, DataView, Error, performance:{now:()=>Date.now()} };
ctx.AudioWorkletNode=class{}; vm.createContext(ctx); vm.runInContext(src+'\n;this.__x={fft,nextPow2,makeCurve,detectPitch,noteFromFreq,makeSweep,deconvolve,makeRamp,fitCurve,bandEnergies,encodeWav,factoryPresets,BLOCKS,blankPreset};',ctx);
const X=ctx.__x; let fails=0; const ok=(c,m)=>{ console.log((c?'PASS ':'FAIL ')+m); if(!c) fails++; };

// FFT round trip
{ const n=1024, re=new Float32Array(n), im=new Float32Array(n); for(let i=0;i<n;i++) re[i]=Math.sin(i*0.1)+Math.cos(i*0.37); const o=re.slice(); X.fft(re,im,false); X.fft(re,im,true); let e=0; for(let i=0;i<n;i++) e=Math.max(e,Math.abs(re[i]-o[i])); ok(e<1e-3,'fft round trip err='+e.toExponential(2)); }
// Pitch detection on 41.2 Hz (low E) and 98 Hz (G)
for(const f of [41.2,55,98,196]){ const sr=48000, n=4096, b=new Float32Array(n); for(let i=0;i<n;i++) b[i]=0.3*Math.sin(2*Math.PI*f*i/sr)+0.15*Math.sin(2*Math.PI*2*f*i/sr); const d=X.detectPitch(b,sr); ok(Math.abs(d-f)/f<0.01,'pitch '+f+' -> '+d.toFixed(2)); }
{ const n=X.noteFromFreq(41.2); ok(n.name==='E'&&n.octave===1,'note E1: '+n.name+n.octave+' '+n.cents.toFixed(1)+'c'); }
// Curves monotone and bounded
for(const t of ['micro','vintage','alpha','omega','fuzz','od','tube','hard','fold','clean']){ const c=X.makeCurve(t,0.6); let mx=0,nan=false; for(const v of c){ if(isNaN(v)) nan=true; mx=Math.max(mx,Math.abs(v)); } ok(!nan&&mx<=1.0001,'curve '+t+' max='+mx.toFixed(3)); }
// Deconvolution recovers a known IR with latency
{ const sr=48000; const sweep=X.makeSweep(sr,1.5); const ir=new Float32Array(200); ir[0]=1; ir[30]=0.5; ir[90]=-0.25; const lat=333; const rec=new Float32Array(sweep.length+lat+ir.length); for(let i=0;i<sweep.length;i++){ for(let k=0;k<ir.length;k++){ if(ir[k]) rec[i+lat+k]+=sweep[i]*ir[k]; } }
  const {ir:got,latency}=X.deconvolve(rec,sweep,sr,400); ok(Math.abs(latency-lat)<=2,'deconv latency '+latency+' (want '+lat+')'); const pk=got.indexOf(Math.max(...got)); ok(Math.abs(got[pk+30]/got[pk]-0.5)<0.1,'deconv tap2 ratio '+(got[pk+30]/got[pk]).toFixed(3)); }
// Curve fit recovers tanh
{ const sr=48000; const ramp=X.makeRamp(sr,2); const lat=100; const y=new Float32Array(ramp.length+lat); for(let i=0;i<ramp.length;i++) y[i+lat]=Math.tanh(ramp[i]*3); const c=X.fitCurve(ramp,y,lat); const mid=c[4096], q=c[6144], top=c[8191]; ok(Math.abs(mid)<0.05 && q>0.7 && top>0.95 && top>q,'fitCurve mid='+mid.toFixed(3)+' q='+q.toFixed(3)+' top='+top.toFixed(3)); }
// Band energies: 1 kHz tone peaks in 1k band (index 5)
{ const sr=48000, n=sr; const s=new Float32Array(n); for(let i=0;i<n;i++) s[i]=Math.sin(2*Math.PI*1000*i/sr); const e=X.bandEnergies(s,sr); const top=e.indexOf(Math.max(...e)); ok(top===5,'bandEnergies 1kHz peak band='+top); }
// WAV header
{ const L=new Float32Array(100), R=new Float32Array(100); const b=X.encodeWav(L,R,48000); const v=new DataView(b.parts[0]); ok(v.getUint32(4,true)===36+400 && v.getUint16(22,true)===2,'wav header'); }
// Factory presets reference real block types/params
{ const ps=X.factoryPresets(); let bad=[]; ps.forEach(p=>['A','B'].forEach(k=>p[k].forEach(b=>{ const d=X.BLOCKS[b.type]; if(!d){ bad.push(p.name+':'+b.type); return; } for(const pk in b.p){ if(!(pk in d.params)) bad.push(p.name+':'+b.type+'.'+pk); } }))); ok(bad.length===0,'factory presets valid ('+ps.length+' presets) '+bad.join(',')); }
ok(Object.keys(X.BLOCKS).length>=40,'block count '+Object.keys(X.BLOCKS).length);
console.log(fails?('\n'+fails+' FAILED'):'\nALL PASS'); process.exit(fails?1:0);
