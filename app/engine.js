// ===== Neon Peach engine: audio graph, DSP helpers, block registry =====
'use strict';
const NP = { ctx:null, ready:false, blocks:{}, paths:{A:[],B:[]}, preset:null, bpm:120, mode:'preset', bank:0, slot:0, selected:null, tunerOn:false, meters:{in:0,out:0}, captures:[], irs:[], midiMaps:[], exp:{value:0, target:null}, globals:null, scene:-1 };
const MAX_BLOCKS = 24;
const SHAPER_LAT = 17.875;   // samples through np-shaper (two half-band stages each way), measured. Dry paths wait this long.
function shaperNode(ctx, curve){ return new AudioWorkletNode(ctx,'np-shaper',{outputChannelCount:[2], processorOptions:{curve: curve||makeCurve('clean',0)}}); }
function setCurve(node, key, make){ if(node._ck===key) return; node._ck=key; node.port.postMessage({curve: make()}); }
function compNode(ctx){ return new AudioWorkletNode(ctx,'np-comp',{outputChannelCount:[2]}); }
function wp(node,name,v){ const p=node.parameters.get(name); if(p) p.setTargetAtTime(v, NP.ctx.currentTime, 0.015); }
function uid(){ return Math.random().toString(36).slice(2,9); }
function dB(v){ return Math.pow(10, v/20); }
function clampN(v,a,b){ return Math.min(b,Math.max(a,v)); }
function now(){ return NP.ctx.currentTime; }
function setP(param, v, t=0.02){ const c=NP.ctx; param.cancelScheduledValues(c.currentTime); param.setTargetAtTime(v, c.currentTime, t); }

// ---------- FFT (radix-2, in place) ----------
function fft(re, im, inverse){
  const n=re.length; for(let i=1,j=0;i<n;i++){ let bit=n>>1; for(;j&bit;bit>>=1) j^=bit; j^=bit; if(i<j){ let t=re[i];re[i]=re[j];re[j]=t; t=im[i];im[i]=im[j];im[j]=t; } }
  for(let len=2;len<=n;len<<=1){ const ang=2*Math.PI/len*(inverse?1:-1); const wr=Math.cos(ang), wi=Math.sin(ang);
    for(let i=0;i<n;i+=len){ let cr=1,ci=0; for(let j=0;j<len/2;j++){ const ur=re[i+j],ui=im[i+j]; const vr=re[i+j+len/2]*cr-im[i+j+len/2]*ci, vi=re[i+j+len/2]*ci+im[i+j+len/2]*cr; re[i+j]=ur+vr; im[i+j]=ui+vi; re[i+j+len/2]=ur-vr; im[i+j+len/2]=ui-vi; const ncr=cr*wr-ci*wi; ci=cr*wi+ci*wr; cr=ncr; } } }
  if(inverse){ for(let i=0;i<n;i++){ re[i]/=n; im[i]/=n; } }
}
function nextPow2(n){ let p=1; while(p<n) p<<=1; return p; }

// ---------- Waveshaper curves ----------
function makeCurve(type, drive){ // drive 0..1
  const N=8192, c=new Float32Array(N); const g = 1 + Math.pow(drive,1.5)*120; // pre-gain 0..~42dB
  for(let i=0;i<N;i++){ let x=(i/(N-1))*2-1; x*=g; let y;
    switch(type){
      case 'clean': y = Math.tanh(x*0.6)/0.6; break;
      case 'micro': y = x>=0 ? Math.tanh(x*1.2)/1.2 : Math.tanh(x*0.85)/0.85; break; // B3K-ish asymmetric
      case 'vintage': y = Math.tanh(Math.tanh(x*0.7)*1.3); break;
      case 'alpha': y = x>=0 ? Math.min(1, x*1.4 - Math.pow(Math.max(0,x*1.4-0.6),2)*0.4) : Math.max(-1, x*1.1); y=clampN(y,-1,1); break;
      case 'omega': { const s=Math.tanh(x*1.6); y = s + 0.25*Math.sin(x*2.2)*Math.exp(-Math.abs(x)*0.5); y=clampN(y,-1,1); break; }
      case 'fuzz': y = clampN(x*3,-1,1); y = y*0.9 + 0.1*Math.sign(y); break;
      case 'od': y = x/(1+Math.abs(x)); break;
      case 'tube': { const k=0.4; y = (x+k)/(1+Math.abs(x+k)) - k/(1+k); break; }
      case 'hard': y = clampN(x,-1,1); break;
      case 'fold': { let v=x; while(v>1||v<-1){ v = v>1 ? 2-v : -2-v; } y=v; break; }
      case 'rect': { const r=Math.abs(Math.tanh(x*0.9)); y=Math.tanh((r*2-0.55)*1.6)*0.6+Math.tanh(x)*0.4; break; }
      case 'muff': y=Math.tanh(Math.tanh(x*2)*2.5)*0.95+0.05*Math.tanh(x*8); break;
      default: y=Math.tanh(x);
    }
    c[i]=y;
  }
  let mx=0; for(let i=0;i<N;i++) mx=Math.max(mx,Math.abs(c[i])); if(mx>1) for(let i=0;i<N;i++) c[i]/=mx;
  return c;
}

// ---------- IR generators ----------
const CABS = {
  '8x10 Fridge': {res:[[62,0.7,8],[115,0.4,5],[240,0.25,3]], lp:3400, lpN:3, air:0.08, bump:1500, bumpG:1.5},
  '4x10 Punch':  {res:[[70,0.6,7],[150,0.4,4],[330,0.25,3]], lp:4600, lpN:2, air:0.12, bump:2200, bumpG:2.5},
  '1x15 Flip':   {res:[[52,0.8,10],[105,0.4,5],[210,0.2,3]], lp:2600, lpN:3, air:0.05, bump:900, bumpG:1.5},
  '2x12 Mod':    {res:[[68,0.6,7],[180,0.35,4],[420,0.3,3]], lp:5200, lpN:2, air:0.15, bump:2800, bumpG:2},
  '1x12 Jazz':   {res:[[80,0.5,6],[200,0.35,4],[500,0.3,3]], lp:5800, lpN:2, air:0.18, bump:3200, bumpG:2},
  '2x10 Combo':  {res:[[75,0.55,6],[160,0.4,4],[380,0.25,3]], lp:4200, lpN:2, air:0.1, bump:1900, bumpG:2},
  '6x10 Tower':  {res:[[60,0.7,8],[125,0.4,5],[270,0.25,3]], lp:3800, lpN:3, air:0.09, bump:1700, bumpG:1.8},
  '1x18 Sub':    {res:[[45,0.9,12],[90,0.4,6],[160,0.15,3]], lp:1800, lpN:4, air:0.03, bump:600, bumpG:1}
};
const CAB_NAMES = Object.keys(CABS);
function genCabIR(ctx, cabName, seed=1){
  const m=CABS[cabName]||CABS['4x10 Punch'], sr=ctx.sampleRate, len=Math.floor(sr*0.09);
  const buf=ctx.createBuffer(2,len,sr);
  let s=seed*9301+49297;
  const rnd=()=>{ s=(s*9301+49297)%233280; return s/233280-0.5; };
  for(let ch=0;ch<2;ch++){
    const d=buf.getChannelData(ch);
    for(let i=0;i<len;i++){ const t=i/sr; let v=0;
      for(const [f,a,q] of m.res){ v += a*Math.sin(2*Math.PI*f*t)*Math.exp(-t*f/q*2.5); }
      v += m.bumpG*Math.sin(2*Math.PI*m.bump*t)*Math.exp(-t*m.bump/4*2.5)*0.15;
      v += rnd()*m.air*Math.exp(-t*900);
      if(i<40) v += Math.exp(-i/6)*1.5*(i===0?1:0.4);
      d[i]=v;
    }
    // lowpass passes
    for(let k=0;k<m.lpN;k++){ const a=1-Math.exp(-2*Math.PI*m.lp/sr); let z=0; for(let i=0;i<len;i++){ z+=a*(d[i]-z); d[i]=z; } }
    // gentle highpass to kill DC
    let z=0, y=0; const a=1-Math.exp(-2*Math.PI*35/sr); for(let i=0;i<len;i++){ z+=a*(d[i]-z); d[i]=d[i]-z; }
    let mx=0; for(let i=0;i<len;i++) mx=Math.max(mx,Math.abs(d[i])); if(mx>0) for(let i=0;i<len;i++) d[i]/=mx;
  }
  return buf;
}
function genReverbIR(ctx, type, decay, seed=7){
  const sr=ctx.sampleRate; const spec={ Room:{t:0.6,hf:3000,pre:0.005,dens:1}, Hall:{t:1.0,hf:2500,pre:0.02,dens:1}, Plate:{t:0.8,hf:7000,pre:0,dens:1.6}, Spring:{t:0.7,hf:2200,pre:0,dens:0.6,spring:true}, Cathedral:{t:1.3,hf:1800,pre:0.04,dens:1}, Shimmer:{t:1.1,hf:5000,pre:0.01,dens:1} }[type]||{t:1,hf:3000,pre:0.01,dens:1};
  const T=Math.max(0.1, decay*spec.t), len=Math.floor(sr*(T+spec.pre)), buf=ctx.createBuffer(2,len,sr);
  let s=seed*7919+13; const rnd=()=>{ s=(s*9301+49297)%233280; return s/233280-0.5; };
  for(let ch=0;ch<2;ch++){ const d=buf.getChannelData(ch); const pre=Math.floor(spec.pre*sr); let z=0;
    for(let i=pre;i<len;i++){ const t=(i-pre)/sr; const env=Math.exp(-3*t/T); const cutoff=spec.hf*Math.exp(-t/T*1.2)+200; const a=1-Math.exp(-2*Math.PI*cutoff/sr);
      let v=rnd()*env*(Math.random()<spec.dens?1:0.3); z+=a*(v-z); d[i]=z*2; }
    if(spec.spring){ for(let k=0;k<6;k++){ const f0=40+k*35, dur=0.25; const st=Math.floor(sr*(0.01+k*0.045)); for(let i=0;i<dur*sr && st+i<len;i++){ const t=i/sr; d[st+i]+= 0.35*Math.sin(2*Math.PI*(f0*t+2500*t*t))*Math.exp(-t*12)*(ch?-1:1); } } }
    let mx=0; for(let i=0;i<len;i++) mx=Math.max(mx,Math.abs(d[i])); if(mx>0) for(let i=0;i<len;i++) d[i]/=mx;
  }
  return buf;
}

// ---------- Parameter spec helpers ----------
const P = (l,min,max,def,u='',step=0)=>({l,min,max,def,u,step});
const E = (l,opts,def=0)=>({l,e:opts,def,min:0,max:opts.length-1,step:1});
const B = (l,def=0)=>({l,e:['Off','On'],def,min:0,max:1,step:1,bool:true});

// ---------- Block registry ----------
const BLOCKS = {};
function def(type, spec){ spec.type=type; BLOCKS[type]=spec; }
const CATS = ['Dynamics','Drive','Amp','Clone','Cab','EQ','Pitch','Synth','Filter','Mod','Delay','Reverb','Utility','Looper'];

// --- Dynamics ---
def('comp', { name:'Super Squeeze', cat:'Dynamics', color:'#8ef',
  params:{ thr:P('Threshold',-60,0,-22,'dB'), ratio:P('Ratio',1,20,4,':1'), attack:P('Attack',0.1,100,8,'ms'), release:P('Release',10,1000,120,'ms'), knee:P('Knee',0,30,8,'dB'), makeup:P('Makeup',0,24,4,'dB'), blend:P('Blend',0,100,100,'%'), schpf:P('Ignore Lows',20,500,80,'Hz'), detect:E('Detect',['Peak','RMS'],0) }, gr:true,
  build(ctx,b){ const n=b.n; n.c=compNode(ctx); n.c.port.onmessage=e=>{ b.gr=e.data.gr; }; b.wetIn.connect(n.c).connect(b.wetOut); },
  apply(b){ const n=b.n,p=b.p; wp(n.c,'threshold',p.thr); wp(n.c,'ratio',p.ratio); wp(n.c,'attack',p.attack); wp(n.c,'release',p.release); wp(n.c,'knee',p.knee); wp(n.c,'makeup',p.makeup); wp(n.c,'mix',p.blend/100); wp(n.c,'schpf',p.schpf); wp(n.c,'rms',p.detect|0); wp(n.c,'auto',1); }
});
def('gate', { name:'Peach Gate', cat:'Dynamics', color:'#8ef',
  params:{ thr:P('Threshold',-90,0,-55,'dB'), attack:P('Attack',0.1,100,1,'ms'), release:P('Release',5,2000,120,'ms'), hold:P('Hold',0,1000,40,'ms'), range:P('Range',-90,0,-80,'dB') },
  build(ctx,b){ b.n.g=new AudioWorkletNode(ctx,'np-gate',{outputChannelCount:[2]}); b.wetIn.connect(b.n.g).connect(b.wetOut); },
  apply(b){ const g=b.n.g,p=b.p; g.parameters.get('threshold').value=p.thr; g.parameters.get('attack').value=p.attack; g.parameters.get('release').value=p.release; g.parameters.get('hold').value=p.hold; g.parameters.get('range').value=p.range; }
});
def('limiter', { name:'Brickwall', cat:'Dynamics', color:'#8ef',
  params:{ ceil:P('Ceiling',-20,0,-1,'dB'), release:P('Release',10,500,60,'ms'), gain:P('Input',0,24,0,'dB') },
  build(ctx,b){ const n=b.n; n.l=new AudioWorkletNode(ctx,'np-limit',{outputChannelCount:[2]}); n.l.port.onmessage=e=>{ b.gr=e.data.gr; }; b.wetIn.connect(n.l).connect(b.wetOut); },
  apply(b){ const n=b.n,p=b.p; wp(n.l,'input',p.gain); wp(n.l,'ceiling',p.ceil); wp(n.l,'release',p.release); }, gr:true
});

// --- Drive (shared builder) ---
const DRIVE_SHAPE={b3k:'micro',vintage:'vintage',alpha:'alpha',omega:'omega',ignis:'fuzz',od:'od',fold:'fold',tubepre:'tube',octfuzz:'rect'};
// the drive starts with its real curve, so there is no first moment with the wrong sound
function initCurve(node, shape, amt){ node._ck=shape+':'+amt; return node; }
function buildDrive(ctx,b){ const n=b.n; n.hp=ctx.createBiquadFilter(); n.hp.type='highpass'; n.hp.Q.value=0.7; n.att=ctx.createBiquadFilter(); n.att.type='highshelf'; n.att.frequency.value=2800; { const sh=DRIVE_SHAPE[b.type]||'od'; n.sh=initCurve(shaperNode(ctx, makeCurve(sh, b.p.drive/100)), sh, b.p.drive); } n.lp=ctx.createBiquadFilter(); n.lp.type='lowpass'; n.lp.Q.value=0.6; n.tone=ctx.createBiquadFilter(); n.tone.type='peaking'; n.tone.frequency.value=800; n.tone.Q.value=0.8; n.lvl=ctx.createGain(); n.dry=ctx.createGain(); n.dd=ctx.createDelay(0.01); n.dd.delayTime.value=SHAPER_LAT/ctx.sampleRate;
  n.dc=ctx.createBiquadFilter(); n.dc.type='highpass'; n.dc.frequency.value=12; n.dc.Q.value=0.5;   // the curve can make DC; this takes it out
  b.wetIn.connect(n.hp).connect(n.att).connect(n.sh).connect(n.dc).connect(n.lp).connect(n.tone).connect(n.lvl).connect(b.wetOut); b.wetIn.connect(n.dd).connect(n.dry).connect(b.wetOut); }
function applyDrive(b, shape){ const n=b.n,p=b.p; n.hp.frequency.value=p.grunt; n.att.gain.value=p.attack; setCurve(n.sh, shape+':'+p.drive, ()=>makeCurve(shape, p.drive/100)); n.lp.frequency.value=p.highcut; n.tone.gain.value=p.tone||0; const bl=p.blend/100; setP(n.lvl.gain,dB(p.level)*Math.sin(bl*Math.PI/2)*0.5); setP(n.dry.gain,Math.cos(bl*Math.PI/2)); }
const DRV = (l,min,max,def,u)=>P(l,min,max,def,u);
const driveParams = (grunt,attack,drive,tone)=>({ drive:DRV('Drive',0,100,drive,'%'), blend:DRV('Blend',0,100,60,'%'), level:DRV('Level',-24,24,0,'dB'), grunt:DRV('Grunt',40,400,grunt,'Hz'), attack:DRV('Attack',-6,12,attack,'dB'), tone:DRV('Tone',-12,12,tone,'dB'), highcut:DRV('High Cut',1500,12000,6500,'Hz') });
def('b3k', { name:'Microtubes B3K', cat:'Drive', color:'#f96', params:driveParams(100,3,55,0), build:buildDrive, apply(b){ applyDrive(b,'micro'); } });
def('vintage', { name:'Vintage Microtubes', cat:'Drive', color:'#f96', params:driveParams(80,0,45,-2), build:buildDrive, apply(b){ applyDrive(b,'vintage'); } });
def('alpha', { name:'Alpha Crunch', cat:'Drive', color:'#f96', params:driveParams(120,4,60,2), build:buildDrive, apply(b){ applyDrive(b,'alpha'); } });
def('omega', { name:'Omega Growl', cat:'Drive', color:'#f96', params:driveParams(90,2,65,-3), build:buildDrive, apply(b){ applyDrive(b,'omega'); } });
def('ignis', { name:'Ignissor Fuzz', cat:'Drive', color:'#f96', params:driveParams(70,0,70,0), build:buildDrive, apply(b){ applyDrive(b,'fuzz'); } });
def('od', { name:'Peach Overdrive', cat:'Drive', color:'#f96', params:driveParams(60,1,40,0), build:buildDrive, apply(b){ applyDrive(b,'od'); } });
def('fold', { name:'Wavefolder', cat:'Drive', color:'#f96', params:driveParams(50,0,30,0), build:buildDrive, apply(b){ applyDrive(b,'fold'); } });
def('tubepre', { name:'Tube Preamp', cat:'Drive', color:'#f96', params:driveParams(40,0,25,0), build:buildDrive, apply(b){ applyDrive(b,'tube'); } });

// --- Amps ---
const AMPS = { 'SVT Classic':{shape:'tube', lo:80, mid:500, hi:3000, pres:5000, sag:0.5}, 'Flip Top B15':{shape:'vintage', lo:60, mid:400, hi:2200, pres:4000, sag:0.7}, 'GK Lead':{shape:'od', lo:70, mid:800, hi:3500, pres:6000, sag:0.2}, 'Microtubes 900':{shape:'micro', lo:70, mid:500, hi:2800, pres:5500, sag:0.3}, 'Tone Hammer':{shape:'clean', lo:40, mid:900, hi:4000, pres:6000, sag:0.1}, 'Studio DI':{shape:'clean', lo:100, mid:1000, hi:5000, pres:8000, sag:0}, 'Super Bass 100':{shape:'tube', lo:100, mid:650, hi:2500, pres:4500, sag:0.6}, 'Kinetic Solid':{shape:'hard', lo:90, mid:700, hi:3200, pres:7000, sag:0.1} };
const AMP_NAMES=Object.keys(AMPS);
def('amp', { name:'Amp Head', cat:'Amp', color:'#fc6',
  params:{ model:E('Model',AMP_NAMES,0), gain:P('Gain',0,100,35,'%'), bass:P('Bass',-12,12,0,'dB'), mid:P('Mid',-12,12,0,'dB'), midf:P('Mid Freq',200,2000,500,'Hz'), treble:P('Treble',-12,12,0,'dB'), presence:P('Presence',-12,12,0,'dB'), master:P('Master',-24,12,0,'dB'), sag:P('Sag',0,100,40,'%') },
  build(ctx,b){ const n=b.n; n.g=ctx.createGain(); n.sag=compNode(ctx); n.sag.parameters.get('knee').value=10; n.sag.parameters.get('attack').value=5; n.sag.parameters.get('release').value=150; n.sag.parameters.get('auto').value=1; { const m=AMPS[AMP_NAMES[b.p.model]]||AMPS['SVT Classic']; n.sh=initCurve(shaperNode(ctx, makeCurve(m.shape, b.p.gain/100*0.8)), m.shape, b.p.gain); } n.lo=ctx.createBiquadFilter(); n.lo.type='lowshelf'; n.mid=ctx.createBiquadFilter(); n.mid.type='peaking'; n.mid.Q.value=0.9; n.hi=ctx.createBiquadFilter(); n.hi.type='highshelf'; n.pr=ctx.createBiquadFilter(); n.pr.type='highshelf'; n.m=ctx.createGain();
    b.wetIn.connect(n.g).connect(n.sag).connect(n.sh).connect(n.lo).connect(n.mid).connect(n.hi).connect(n.pr).connect(n.m).connect(b.wetOut); },
  apply(b){ const n=b.n,p=b.p,m=AMPS[AMP_NAMES[p.model]]; setP(n.g.gain,1); setCurve(n.sh, m.shape+':'+p.gain, ()=>makeCurve(m.shape, p.gain/100*0.8)); wp(n.sag,'threshold',-30+(1-p.sag/100)*30); wp(n.sag,'ratio',1+m.sag*p.sag/100*6); n.lo.frequency.value=m.lo; n.lo.gain.value=p.bass; n.mid.frequency.value=p.midf; n.mid.gain.value=p.mid; n.hi.frequency.value=m.hi; n.hi.gain.value=p.treble; n.pr.frequency.value=m.pres; n.pr.gain.value=p.presence; setP(n.m.gain,dB(p.master)*0.6); }
});
// --- Cab ---
def('cab', { name:'Cabinet', cat:'Cab', color:'#fc6',
  params:{ cab:E('Cab',CAB_NAMES,1), mic:E('Mic',['Dynamic','Condenser','Ribbon','DI Blend'],0), dist:P('Distance',0,100,20,'%'), lowcut:P('Low Cut',20,300,40,'Hz'), highcut:P('High Cut',2000,16000,9000,'Hz'), level:P('Level',-24,12,0,'dB') },
  build(ctx,b){ const n=b.n; n.cv=ctx.createConvolver(); n.hp=ctx.createBiquadFilter(); n.hp.type='highpass'; n.lp=ctx.createBiquadFilter(); n.lp.type='lowpass'; n.mic=ctx.createBiquadFilter(); n.mic.type='peaking'; n.mic.Q.value=1.2; n.prox=ctx.createBiquadFilter(); n.prox.type='lowshelf'; n.prox.frequency.value=150; n.di=ctx.createGain(); n.lvl=ctx.createGain(); n.cur=-1;
    b.wetIn.connect(n.cv).connect(n.hp).connect(n.lp).connect(n.mic).connect(n.prox).connect(n.lvl).connect(b.wetOut); b.wetIn.connect(n.di).connect(n.lvl); },
  apply(b){ const n=b.n,p=b.p; if(p.cab!==n.cur){ n.cur=p.cab; if(p.cab<CAB_NAMES.length){ n.cv.buffer=genCabIR(NP.ctx,CAB_NAMES[p.cab]); } else { const ir=NP.irs[p.cab-CAB_NAMES.length]; if(ir){ const buf=NP.ctx.createBuffer(1,ir.data.length,NP.ctx.sampleRate); buf.getChannelData(0).set(ir.data); n.cv.buffer=buf; } } }
    n.hp.frequency.value=p.lowcut; n.lp.frequency.value=p.highcut; const mic=p.mic; n.mic.frequency.value=[3500,8000,1200,3000][mic]; n.mic.gain.value=[3,5,-4,0][mic]; n.prox.gain.value=(1-p.dist/100)*4-1; setP(n.di.gain, mic===3?0.4:0); setP(n.lvl.gain,dB(p.level)); }
});
def('capture', { name:'Peach Capture', cat:'Amp', color:'#fc6',
  params:{ cap:E('Capture',['(none)'],0), input:P('Input',-24,24,0,'dB'), level:P('Level',-24,24,0,'dB'), ir:B('Use IR',1) },
  build(ctx,b){ const n=b.n; n.g=ctx.createGain(); n.sh=shaperNode(ctx); n.cv=ctx.createConvolver(); n.by=ctx.createGain(); n.cvg=ctx.createGain(); n.o=ctx.createGain(); n.cur=-1;
    b.wetIn.connect(n.g).connect(n.sh); n.sh.connect(n.cv).connect(n.cvg).connect(n.o); n.sh.connect(n.by).connect(n.o); n.o.connect(b.wetOut); },
  apply(b){ const n=b.n,p=b.p; const cap=NP.captures[p.cap-1]; if(p.cap!==n.cur){ n.cur=p.cap; if(cap){ n.sh._ck=null; setCurve(n.sh, 'cap'+p.cap, ()=>Float32Array.from(cap.curve)); const buf=NP.ctx.createBuffer(1,cap.ir.length,NP.ctx.sampleRate); buf.getChannelData(0).set(cap.ir); n.cv.buffer=buf; } else { setCurve(n.sh, 'clean', ()=>makeCurve('clean',0)); n.cv.buffer=null; } }
    setP(n.g.gain,dB(p.input)); setP(n.o.gain,dB(p.level)); const useIR=p.ir===1 && cap && n.cv.buffer; setP(n.cvg.gain,useIR?1:0); setP(n.by.gain,useIR?0:1); }
});

// --- Clone: a copied pedal or plugin (neural model or IR), made on the Clone page or loaded from a file ---
def('clone', { name:'Clone', cat:'Clone', color:'#f2f5ff',
  params:{ clone:E('Clone',['(none)'],0), cid:{l:'Clone id', def:'', hidden:true}, input:P('Input',-24,24,0,'dB'), level:P('Level',-36,12,0,'dB'), mix:P('Mix',0,100,100,'%'), lowcut:P('Low Cut',10,400,10,'Hz'), highcut:P('High Cut',2000,20000,20000,'Hz'), norm:B('Even out level',0) },
  build(ctx,b){ const n=b.n; n.inG=ctx.createGain(); n.nam=new AudioWorkletNode(ctx,'np-nam',{numberOfInputs:1, numberOfOutputs:1, outputChannelCount:[2], processorOptions:{wasm:NAM_WASM}});
    n.cv=ctx.createConvolver(); n.cv.normalize=false; n.namG=ctx.createGain(); n.cvG=ctx.createGain(); n.cvG.gain.value=0;
    n.hp=ctx.createBiquadFilter(); n.hp.type='highpass'; n.hp.Q.value=0.707; n.lp=ctx.createBiquadFilter(); n.lp.type='lowpass'; n.lp.Q.value=0.707; n.wet=ctx.createGain(); n.dry=ctx.createGain();
    b.wetIn.connect(n.inG); n.inG.connect(n.nam).connect(n.namG).connect(n.hp); n.inG.connect(n.cv).connect(n.cvG).connect(n.hp); n.hp.connect(n.lp).connect(n.wet).connect(b.wetOut); b.wetIn.connect(n.dry).connect(b.wetOut);
    n.state=''; n.loaded=null; n.nam.port.onmessage=e=>{ const m=e.data||{}; if(!m.state || m.id!==n.loaded) return;   // a message about a model we already left
      n.state=m.state; n.err=m.error||''; if(window.onCloneState) window.onCloneState(b); }; },
  apply(b){ applyClone(b); }
});

// --- EQ ---
def('peq', { name:'Parametric EQ', cat:'EQ', color:'#9f9',
  params:{ f1:P('Low Freq',30,300,70,'Hz'), g1:P('Low Gain',-15,15,0,'dB'), f2:P('LoMid Freq',100,1000,250,'Hz'), g2:P('LoMid Gain',-15,15,0,'dB'), q2:P('LoMid Q',0.3,8,1,''), f3:P('Mid Freq',300,3000,800,'Hz'), g3:P('Mid Gain',-15,15,0,'dB'), q3:P('Mid Q',0.3,8,1,''), f4:P('HiMid Freq',800,6000,2000,'Hz'), g4:P('HiMid Gain',-15,15,0,'dB'), q4:P('HiMid Q',0.3,8,1,''), f5:P('High Freq',2000,12000,5000,'Hz'), g5:P('High Gain',-15,15,0,'dB'), lvl:P('Level',-12,12,0,'dB') },
  build(ctx,b){ const n=b.n; n.f=[]; const types=['lowshelf','peaking','peaking','peaking','highshelf']; let prev=b.wetIn; for(let i=0;i<5;i++){ const f=ctx.createBiquadFilter(); f.type=types[i]; n.f.push(f); prev.connect(f); prev=f; } n.l=ctx.createGain(); prev.connect(n.l).connect(b.wetOut); },
  apply(b){ const n=b.n,p=b.p; const fs=[p.f1,p.f2,p.f3,p.f4,p.f5], gs=[p.g1,p.g2,p.g3,p.g4,p.g5], qs=[0.7,p.q2,p.q3,p.q4,0.7]; for(let i=0;i<5;i++){ n.f[i].frequency.value=fs[i]; n.f[i].gain.value=gs[i]; n.f[i].Q.value=qs[i]; } setP(n.l.gain,dB(p.lvl)); }
});
const GEQ_F=[31,63,125,250,500,1000,2000,4000,8000,16000];
def('geq', { name:'Graphic EQ', cat:'EQ', color:'#9f9',
  params:Object.fromEntries(GEQ_F.map((f,i)=>['b'+i, P(f>=1000?(f/1000)+'k':f+'',-12,12,0,'dB')]).concat([['lvl',P('Level',-12,12,0,'dB')]])),
  build(ctx,b){ const n=b.n; n.f=[]; let prev=b.wetIn; for(let i=0;i<10;i++){ const f=ctx.createBiquadFilter(); f.type='peaking'; f.frequency.value=GEQ_F[i]; f.Q.value=1.4; n.f.push(f); prev.connect(f); prev=f; } n.l=ctx.createGain(); prev.connect(n.l).connect(b.wetOut); },
  apply(b){ const n=b.n,p=b.p; for(let i=0;i<10;i++) n.f[i].gain.value=p['b'+i]; setP(n.l.gain,dB(p.lvl)); }
});
def('tone6', { name:'6-Band Tone Shaper', cat:'EQ', color:'#9f9',
  params:{ b70:P('70Hz',-12,12,0,'dB'), b180:P('180Hz',-12,12,0,'dB'), b500:P('500Hz',-12,12,0,'dB'), b1k:P('1kHz',-12,12,0,'dB'), b2k:P('2kHz',-12,12,0,'dB'), b5k:P('5kHz',-12,12,0,'dB'), lvl:P('Level',-12,12,0,'dB') },
  build(ctx,b){ const n=b.n; n.f=[]; const fs=[70,180,500,1000,2000,5000]; let prev=b.wetIn; fs.forEach((f0,i)=>{ const f=ctx.createBiquadFilter(); f.type=i===0?'lowshelf':(i===5?'highshelf':'peaking'); f.frequency.value=f0; f.Q.value=1; n.f.push(f); prev.connect(f); prev=f; }); n.l=ctx.createGain(); prev.connect(n.l).connect(b.wetOut); },
  apply(b){ const n=b.n,p=b.p; const g=[p.b70,p.b180,p.b500,p.b1k,p.b2k,p.b5k]; g.forEach((v,i)=>n.f[i].gain.value=v); setP(n.l.gain,dB(p.lvl)); }
});
def('cut', { name:'Low / High Cut', cat:'EQ', color:'#9f9',
  params:{ lo:P('Low Cut',20,500,30,'Hz'), hi:P('High Cut',1000,20000,12000,'Hz'), slope:E('Slope',['12dB','24dB'],0) },
  build(ctx,b){ const n=b.n; n.h1=ctx.createBiquadFilter(); n.h1.type='highpass'; n.h2=ctx.createBiquadFilter(); n.h2.type='highpass'; n.l1=ctx.createBiquadFilter(); n.l1.type='lowpass'; n.l2=ctx.createBiquadFilter(); n.l2.type='lowpass'; b.wetIn.connect(n.h1).connect(n.h2).connect(n.l1).connect(n.l2).connect(b.wetOut); },
  apply(b){ const n=b.n,p=b.p; [n.h1,n.h2].forEach(f=>f.frequency.value=p.lo); [n.l1,n.l2].forEach(f=>f.frequency.value=p.hi); const s=p.slope; n.h2.frequency.value=s?p.lo:10; n.l2.frequency.value=s?p.hi:22000; }
});

// --- Pitch ---
def('octave', { name:'Sub Octave', cat:'Pitch', color:'#c9f',
  params:{ sub1:P('-1 Oct',0,100,70,'%'), sub2:P('-2 Oct',0,100,0,'%'), up:P('+1 Oct',0,100,0,'%'), dry:P('Dry',0,100,100,'%'), tone:P('Tone',100,4000,600,'Hz'), track:P('Tracking',100,800,300,'Hz') },
  build(ctx,b){ b.n.o=new AudioWorkletNode(ctx,'np-octave',{outputChannelCount:[2]}); b.wetIn.connect(b.n.o).connect(b.wetOut); },
  apply(b){ const o=b.n.o,p=b.p; o.parameters.get('sub1').value=p.sub1/100; o.parameters.get('sub2').value=p.sub2/100; o.parameters.get('up').value=p.up/100; o.parameters.get('dry').value=p.dry/100; o.parameters.get('tone').value=p.tone; o.parameters.get('track').value=p.track; }
});
def('pitch', { name:'Pitch Shift', cat:'Pitch', color:'#c9f',
  params:{ semi:P('Semitones',-24,24,-12,'st',1), cents:P('Cents',-100,100,0,'c'), mix:P('Mix',0,100,100,'%'), grain:P('Grain',15,150,40,'ms') },
  build(ctx,b){ b.n.p=new AudioWorkletNode(ctx,'np-pitch',{outputChannelCount:[2]}); b.wetIn.connect(b.n.p).connect(b.wetOut); },
  apply(b){ const o=b.n.p,p=b.p; o.parameters.get('semitones').value=p.semi; o.parameters.get('cents').value=p.cents; o.parameters.get('mix').value=p.mix/100; o.parameters.get('grain').value=p.grain; }
});
def('harm', { name:'Harmonizer', cat:'Pitch', color:'#c9f',
  params:{ v1:P('Voice 1',-24,24,7,'st',1), l1:P('Level 1',0,100,60,'%'), v2:P('Voice 2',-24,24,-12,'st',1), l2:P('Level 2',0,100,0,'%'), dry:P('Dry',0,100,100,'%'), spread:P('Spread',0,100,50,'%') },
  build(ctx,b){ const n=b.n; n.p1=new AudioWorkletNode(ctx,'np-pitch',{outputChannelCount:[2]}); n.p2=new AudioWorkletNode(ctx,'np-pitch',{outputChannelCount:[2]}); n.g1=ctx.createGain(); n.g2=ctx.createGain(); n.pan1=ctx.createStereoPanner(); n.pan2=ctx.createStereoPanner(); n.d=ctx.createGain();
    b.wetIn.connect(n.p1).connect(n.g1).connect(n.pan1).connect(b.wetOut); b.wetIn.connect(n.p2).connect(n.g2).connect(n.pan2).connect(b.wetOut); b.wetIn.connect(n.d).connect(b.wetOut); },
  apply(b){ const n=b.n,p=b.p; n.p1.parameters.get('semitones').value=p.v1; n.p2.parameters.get('semitones').value=p.v2; setP(n.g1.gain,p.l1/100); setP(n.g2.gain,p.l2/100); setP(n.d.gain,p.dry/100); n.pan1.pan.value=-p.spread/100; n.pan2.pan.value=p.spread/100; }
});
// --- Synth ---
def('synth', { name:'Peach Synth', cat:'Synth', color:'#f9c',
  params:{ wave:E('Wave',['Saw','Square','Pulse','Sine'],0), octave:P('Octave',-2,1,0,'',1), sub:P('Sub',0,100,30,'%'), detune:P('Detune',0,50,0,'c'), cutoff:P('Cutoff',60,8000,400,'Hz'), res:P('Reso',0.5,15,3,''), envamt:P('Env Amt',0,100,60,'%'), glide:P('Glide',0,500,20,'ms'), attack:P('Attack',1,300,5,'ms'), release:P('Release',10,1500,120,'ms'), mix:P('Mix',0,100,50,'%'), gate:P('Gate',-80,-10,-45,'dB') },
  build(ctx,b){ b.n.s=new AudioWorkletNode(ctx,'np-synth',{outputChannelCount:[2]}); b.wetIn.connect(b.n.s).connect(b.wetOut); },
  apply(b){ const s=b.n.s,p=b.p; const m={wave:p.wave,octave:p.octave,sub:p.sub/100,detune:p.detune,cutoff:p.cutoff,res:p.res,envamt:p.envamt/100,glide:p.glide,attack:p.attack,release:p.release,mix:p.mix/100,gate:p.gate}; for(const k in m) s.parameters.get(k).value=m[k]; }
});
// --- Filter ---
def('envf', { name:'Envelope Filter', cat:'Filter', color:'#9ff',
  params:{ sens:P('Sensitivity',0,100,50,'%'), fmin:P('Start Freq',40,2000,120,'Hz'), range:P('Range',0,100,70,'%'), q:P('Reso',0.5,20,4,''), attack:P('Attack',1,200,8,'ms'), decay:P('Decay',10,1500,180,'ms'), type:E('Type',['Low Pass','Band Pass','High Pass'],0), dir:E('Direction',['Up','Down'],0), mix:P('Mix',0,100,100,'%') },
  build(ctx,b){ b.n.e=new AudioWorkletNode(ctx,'np-envfilter',{outputChannelCount:[2]}); b.wetIn.connect(b.n.e).connect(b.wetOut); },
  apply(b){ const e=b.n.e,p=b.p; const m={sens:p.sens/100,fmin:p.fmin,range:p.range/100,q:p.q,attack:p.attack,decay:p.decay,type:p.type,dir:p.dir,mix:p.mix/100}; for(const k in m) e.parameters.get(k).value=m[k]; }
});
def('wah', { name:'Pedal Wah', cat:'Filter', color:'#9ff',
  params:{ pos:P('Position',0,100,50,'%'), q:P('Reso',0.5,15,5,''), fmin:P('Min Freq',100,1000,350,'Hz'), fmax:P('Max Freq',800,5000,2200,'Hz'), mix:P('Mix',0,100,100,'%') },
  build(ctx,b){ const n=b.n; n.f=ctx.createBiquadFilter(); n.f.type='bandpass'; n.w=ctx.createGain(); n.d=ctx.createGain(); b.wetIn.connect(n.f).connect(n.w).connect(b.wetOut); b.wetIn.connect(n.d).connect(b.wetOut); },
  apply(b){ const n=b.n,p=b.p; const f=p.fmin*Math.pow(p.fmax/p.fmin,p.pos/100); setP(n.f.frequency,f,0.01); n.f.Q.value=p.q; setP(n.w.gain,p.mix/100*2); setP(n.d.gain,1-p.mix/100); }
});
def('filter', { name:'Multi Filter', cat:'Filter', color:'#9ff',
  params:{ type:E('Type',['Low Pass','High Pass','Band Pass','Notch'],0), freq:P('Freq',40,12000,800,'Hz'), q:P('Reso',0.3,20,1,''), mix:P('Mix',0,100,100,'%') },
  build(ctx,b){ const n=b.n; n.f=ctx.createBiquadFilter(); n.w=ctx.createGain(); n.d=ctx.createGain(); b.wetIn.connect(n.f).connect(n.w).connect(b.wetOut); b.wetIn.connect(n.d).connect(b.wetOut); },
  apply(b){ const n=b.n,p=b.p; n.f.type=['lowpass','highpass','bandpass','notch'][p.type]; setP(n.f.frequency,p.freq,0.01); n.f.Q.value=p.q; setP(n.w.gain,p.mix/100); setP(n.d.gain,1-p.mix/100); }
});
// --- Modulation ---
function mkLFO(ctx, shape='sine'){ const o=ctx.createOscillator(); o.type=shape; o.start(); return o; }
def('chorus', { name:'Peach Chorus', cat:'Mod', color:'#9cf',
  params:{ rate:P('Rate',0.05,10,0.8,'Hz'), depth:P('Depth',0,100,40,'%'), mix:P('Mix',0,100,50,'%'), tone:P('Tone',500,12000,6000,'Hz'), voices:E('Voices',['2','3'],0) },
  build(ctx,b){ const n=b.n; n.lfo=mkLFO(ctx); n.lfo2=mkLFO(ctx,'triangle'); n.d1=ctx.createDelay(0.05); n.d2=ctx.createDelay(0.05); n.d3=ctx.createDelay(0.05); n.g1=ctx.createGain(); n.g2=ctx.createGain(); n.g3=ctx.createGain(); n.p1=ctx.createStereoPanner(); n.p1.pan.value=-0.6; n.p2=ctx.createStereoPanner(); n.p2.pan.value=0.6; n.p3=ctx.createStereoPanner(); n.lp=ctx.createBiquadFilter(); n.lp.type='lowpass'; n.wet=ctx.createGain(); n.dry=ctx.createGain(); n.v3=ctx.createGain();
    n.lfo.connect(n.g1).connect(n.d1.delayTime); n.lfo.connect(n.g2).connect(n.d2.delayTime); n.lfo2.connect(n.g3).connect(n.d3.delayTime);
    b.wetIn.connect(n.lp); n.lp.connect(n.d1).connect(n.p1).connect(n.wet); n.lp.connect(n.d2).connect(n.p2).connect(n.wet); n.lp.connect(n.d3).connect(n.v3).connect(n.p3).connect(n.wet); n.wet.connect(b.wetOut); b.wetIn.connect(n.dry).connect(b.wetOut); },
  apply(b){ const n=b.n,p=b.p; n.lfo.frequency.value=p.rate; n.lfo2.frequency.value=p.rate*0.73; const dp=p.depth/100*0.004; n.d1.delayTime.value=0.009; n.d2.delayTime.value=0.014; n.d3.delayTime.value=0.021; n.g1.gain.value=dp; n.g2.gain.value=-dp; n.g3.gain.value=dp*0.7; n.lp.frequency.value=p.tone; setP(n.v3.gain,p.voices?1:0); const m=p.mix/100; setP(n.wet.gain,m); setP(n.dry.gain,1-m*0.5); }
});
def('flanger', { name:'Flanger', cat:'Mod', color:'#9cf',
  params:{ rate:P('Rate',0.05,5,0.3,'Hz'), depth:P('Depth',0,100,60,'%'), fb:P('Feedback',-95,95,50,'%'), manual:P('Manual',0.5,8,2,'ms'), mix:P('Mix',0,100,50,'%') },
  build(ctx,b){ const n=b.n; n.lfo=mkLFO(ctx,'triangle'); n.d=ctx.createDelay(0.05); n.g=ctx.createGain(); n.fb=ctx.createGain(); n.wet=ctx.createGain(); n.dry=ctx.createGain(); n.lfo.connect(n.g).connect(n.d.delayTime); b.wetIn.connect(n.d).connect(n.wet).connect(b.wetOut); n.d.connect(n.fb).connect(n.d); b.wetIn.connect(n.dry).connect(b.wetOut); },
  apply(b){ const n=b.n,p=b.p; n.lfo.frequency.value=p.rate; n.d.delayTime.value=p.manual/1000+0.001; n.g.gain.value=p.depth/100*p.manual/1000; setP(n.fb.gain,p.fb/100); const m=p.mix/100; setP(n.wet.gain,m); setP(n.dry.gain,1-m*0.5); }
});
def('phaser', { name:'Phaser', cat:'Mod', color:'#9cf',
  params:{ rate:P('Rate',0.05,8,0.5,'Hz'), depth:P('Depth',0,100,70,'%'), center:P('Center',100,3000,600,'Hz'), stages:E('Stages',['4','6','8'],0), fb:P('Feedback',0,90,30,'%'), mix:P('Mix',0,100,50,'%') },
  build(ctx,b){ const n=b.n; n.lfo=mkLFO(ctx); n.g=ctx.createGain(); n.ap=[]; let prev=b.wetIn; n.inG=ctx.createGain(); prev=n.inG; b.wetIn.connect(n.inG); for(let i=0;i<8;i++){ const f=ctx.createBiquadFilter(); f.type='allpass'; f.Q.value=0.6; n.ap.push(f); n.g.connect(f.frequency); } n.taps=[ctx.createGain(),ctx.createGain(),ctx.createGain()]; n.fb=ctx.createGain(); n.wet=ctx.createGain(); n.dry=ctx.createGain();
    n.inG.connect(n.ap[0]); for(let i=1;i<8;i++) n.ap[i-1].connect(n.ap[i]); n.ap[3].connect(n.taps[0]); n.ap[5].connect(n.taps[1]); n.ap[7].connect(n.taps[2]); n.taps.forEach(t=>{ t.connect(n.wet); t.connect(n.fb); }); n.fb.connect(n.inG); n.wet.connect(b.wetOut); b.wetIn.connect(n.dry).connect(b.wetOut); n.lfo.connect(n.g); },
  apply(b){ const n=b.n,p=b.p; n.lfo.frequency.value=p.rate; n.ap.forEach((f,i)=>f.frequency.value=p.center*(1+i*0.15)); n.g.gain.value=p.center*p.depth/100*0.9; const s=p.stages; n.taps.forEach((t,i)=>t.gain.value=i===s?1:0); setP(n.fb.gain,p.fb/100*0.7); const m=p.mix/100; setP(n.wet.gain,m); setP(n.dry.gain,1-m*0.5); }
});
def('trem', { name:'Tremolo', cat:'Mod', color:'#9cf',
  params:{ rate:P('Rate',0.1,20,4,'Hz'), depth:P('Depth',0,100,60,'%'), shape:E('Shape',['Sine','Triangle','Square'],0), stereo:B('Stereo Pan',0) },
  build(ctx,b){ const n=b.n; n.lfo=mkLFO(ctx); n.g=ctx.createGain(); n.t=ctx.createGain(); n.pan=ctx.createStereoPanner(); n.pg=ctx.createGain(); n.lfo.connect(n.g).connect(n.t.gain); n.lfo.connect(n.pg).connect(n.pan.pan); b.wetIn.connect(n.t).connect(n.pan).connect(b.wetOut); },
  apply(b){ const n=b.n,p=b.p; n.lfo.frequency.value=p.rate; n.lfo.type=['sine','triangle','square'][p.shape]; const d=p.depth/100; n.t.gain.value=1-d/2; n.g.gain.value=d/2; n.pg.gain.value=p.stereo?0.9:0; }
});
def('vibrato', { name:'Vibrato', cat:'Mod', color:'#9cf',
  params:{ rate:P('Rate',0.5,12,5,'Hz'), depth:P('Depth',0,100,30,'%') },
  build(ctx,b){ const n=b.n; n.lfo=mkLFO(ctx); n.g=ctx.createGain(); n.d=ctx.createDelay(0.05); n.lfo.connect(n.g).connect(n.d.delayTime); b.wetIn.connect(n.d).connect(b.wetOut); },
  apply(b){ const n=b.n,p=b.p; n.lfo.frequency.value=p.rate; n.d.delayTime.value=0.006; n.g.gain.value=p.depth/100*0.004; }
});
def('rotary', { name:'Rotary Speaker', cat:'Mod', color:'#9cf',
  params:{ speed:E('Speed',['Slow','Fast'],0), drive:P('Drive',0,100,20,'%'), mix:P('Mix',0,100,70,'%'), xo:P('Crossover',200,1500,700,'Hz') },
  build(ctx,b){ const n=b.n; n.sh=ctx.createWaveShaper(); n.lp=ctx.createBiquadFilter(); n.lp.type='lowpass'; n.hp=ctx.createBiquadFilter(); n.hp.type='highpass'; n.lfoH=mkLFO(ctx); n.lfoL=mkLFO(ctx); n.dH=ctx.createDelay(0.05); n.gH=ctx.createGain(); n.panH=ctx.createStereoPanner(); n.pgH=ctx.createGain(); n.tL=ctx.createGain(); n.gL=ctx.createGain(); n.wet=ctx.createGain(); n.dry=ctx.createGain();
    b.wetIn.connect(n.sh); n.sh.connect(n.hp).connect(n.dH).connect(n.panH).connect(n.wet); n.sh.connect(n.lp).connect(n.tL).connect(n.wet); n.lfoH.connect(n.gH).connect(n.dH.delayTime); n.lfoH.connect(n.pgH).connect(n.panH.pan); n.lfoL.connect(n.gL).connect(n.tL.gain); n.wet.connect(b.wetOut); b.wetIn.connect(n.dry).connect(b.wetOut); },
  apply(b){ const n=b.n,p=b.p; n.sh.curve=makeCurve('tube',p.drive/100*0.5); n.lp.frequency.value=p.xo; n.hp.frequency.value=p.xo; const fast=p.speed===1; setP(n.lfoH.frequency,fast?6.5:0.8,0.5); setP(n.lfoL.frequency,fast?5.5:0.7,0.5); n.dH.delayTime.value=0.004; n.gH.gain.value=0.0015; n.pgH.gain.value=0.8; n.tL.gain.value=0.75; n.gL.gain.value=0.25; const m=p.mix/100; setP(n.wet.gain,m); setP(n.dry.gain,1-m); }
});
def('ring', { name:'Ring Mod', cat:'Mod', color:'#9cf',
  params:{ freq:P('Freq',20,2000,200,'Hz'), mix:P('Mix',0,100,50,'%'), shape:E('Shape',['Sine','Square'],0) },
  build(ctx,b){ const n=b.n; n.o=mkLFO(ctx); n.r=ctx.createGain(); n.r.gain.value=0; n.o.connect(n.r.gain); n.w=ctx.createGain(); n.d=ctx.createGain(); b.wetIn.connect(n.r).connect(n.w).connect(b.wetOut); b.wetIn.connect(n.d).connect(b.wetOut); },
  apply(b){ const n=b.n,p=b.p; n.o.frequency.value=p.freq; n.o.type=p.shape?'square':'sine'; setP(n.w.gain,p.mix/100); setP(n.d.gain,1-p.mix/100); }
});
def('crush', { name:'Bit Crusher', cat:'Mod', color:'#9cf',
  params:{ bits:P('Bits',2,16,8,'',1), rate:P('Downsample',1,64,1,'x',1), mix:P('Mix',0,100,100,'%') },
  build(ctx,b){ b.n.c=new AudioWorkletNode(ctx,'np-crusher',{outputChannelCount:[2]}); b.wetIn.connect(b.n.c).connect(b.wetOut); },
  apply(b){ const c=b.n.c,p=b.p; c.parameters.get('bits').value=p.bits; c.parameters.get('rate').value=p.rate; c.parameters.get('mix').value=p.mix/100; }
});
// --- Delay ---
const SYNC=['Free','1/4','1/8','1/8 dot','1/8 trip','1/16','1/4 dot','1/2'];
const SYNC_MUL=[0,1,0.5,0.75,1/3,0.25,1.5,2];
function delayTimeMs(p){ if(p.sync===0) return p.time; return 60000/NP.bpm*SYNC_MUL[p.sync]; }
def('delay', { name:'Delay', cat:'Delay', color:'#fd8',
  params:{ type:E('Type',['Digital','Tape','Analog','Ping Pong'],0), time:P('Time',10,2000,375,'ms'), sync:E('Sync',SYNC,0), fb:P('Feedback',0,100,35,'%'), mix:P('Mix',0,100,30,'%'), lowcut:P('Low Cut',20,1000,120,'Hz'), highcut:P('High Cut',500,12000,5000,'Hz'), mod:P('Wow',0,100,0,'%'), trails:B('Trails',1) },
  build(ctx,b){ const n=b.n; n.dL=ctx.createDelay(4); n.dR=ctx.createDelay(4); n.hp=ctx.createBiquadFilter(); n.hp.type='highpass'; n.lp=ctx.createBiquadFilter(); n.lp.type='lowpass'; n.fb=ctx.createGain(); n.gLL=ctx.createGain(); n.gLR=ctx.createGain(); n.fbR=ctx.createGain(); n.pL=ctx.createStereoPanner(); n.pR=ctx.createStereoPanner(); n.sat=ctx.createWaveShaper(); n.sat.curve=makeCurve('tube',0.05); n.lfo=mkLFO(ctx); n.mg=ctx.createGain(); n.wet=ctx.createGain(); n.inG=ctx.createGain(); b.wetDry=ctx.createGain();
    b.wetIn.connect(b.wetDry).connect(b.wetOut);
    b.wetIn.connect(n.inG).connect(n.dL); n.dL.connect(n.pL).connect(n.wet); n.dR.connect(n.pR).connect(n.wet);
    n.dL.connect(n.hp).connect(n.lp).connect(n.sat).connect(n.fb); n.fb.connect(n.gLL).connect(n.dL); n.fb.connect(n.gLR).connect(n.dR); n.dR.connect(n.fbR).connect(n.dL);
    n.lfo.connect(n.mg); n.mg.connect(n.dL.delayTime); n.mg.connect(n.dR.delayTime); n.wet.connect(b.wetOut); b.trailsWet=n.wet; b.trailsIn=n.inG; },
  apply(b){ const n=b.n,p=b.p; const t=Math.min(3.9, delayTimeMs(p)/1000); setP(n.dL.delayTime,t,0.05); setP(n.dR.delayTime,t,0.05); const pp=p.type===3; n.pL.pan.value=pp?-1:0; n.pR.pan.value=pp?1:0;
    const fb=p.fb/100*0.95; setP(n.fb.gain, pp?1:fb); setP(n.gLL.gain,pp?0:1); setP(n.gLR.gain,pp?1:0); setP(n.fbR.gain,pp?fb:0);
    const tape=p.type===1, analog=p.type===2; n.hp.frequency.value=p.lowcut; n.lp.frequency.value=analog?Math.min(p.highcut,2500):(tape?Math.min(p.highcut,4000):p.highcut); n.sat.curve=makeCurve('tube',tape?0.15:(analog?0.1:0.02)); n.lfo.frequency.value=tape?0.6:0.3; n.mg.gain.value=p.mod/100*0.0025; setP(n.wet.gain,p.mix/100*1.2); }
});
def('mdelay', { name:'Multi-Tap Delay', cat:'Delay', color:'#fd8',
  params:{ time:P('Time',10,2000,250,'ms'), sync:E('Sync',SYNC,0), taps:P('Taps',1,4,3,'',1), fb:P('Feedback',0,90,20,'%'), spread:P('Spread',0,100,60,'%'), mix:P('Mix',0,100,30,'%'), highcut:P('High Cut',500,12000,4000,'Hz'), trails:B('Trails',1) },
  build(ctx,b){ const n=b.n; n.d=[]; n.g=[]; n.p=[]; n.lp=ctx.createBiquadFilter(); n.lp.type='lowpass'; n.fb=ctx.createGain(); n.wet=ctx.createGain(); n.inG=ctx.createGain(); b.wetDry=ctx.createGain(); b.wetIn.connect(b.wetDry).connect(b.wetOut); b.wetIn.connect(n.inG); for(let i=0;i<4;i++){ const d=ctx.createDelay(8), g=ctx.createGain(), pan=ctx.createStereoPanner(); n.inG.connect(d).connect(g).connect(pan).connect(n.wet); n.d.push(d); n.g.push(g); n.p.push(pan); } n.d[0].connect(n.lp).connect(n.fb).connect(n.inG); n.wet.connect(b.wetOut); b.trailsWet=n.wet; b.trailsIn=n.inG; },
  apply(b){ const n=b.n,p=b.p; const t=Math.min(1.9,delayTimeMs(p)/1000); for(let i=0;i<4;i++){ setP(n.d[i].delayTime,t*(i+1),0.05); setP(n.g[i].gain, i<p.taps ? Math.pow(0.7,i) : 0); n.p[i].pan.value = (i%2?1:-1)*p.spread/100*(i/3); } n.lp.frequency.value=p.highcut; setP(n.fb.gain,p.fb/100); setP(n.wet.gain,p.mix/100); }
});
// --- Reverb ---
def('reverb', { name:'Reverb', cat:'Reverb', color:'#bdf',
  params:{ type:E('Type',['Room','Hall','Plate','Spring','Cathedral','Shimmer'],1), decay:P('Decay',0.2,8,2,'s'), predelay:P('Pre-Delay',0,200,10,'ms'), mix:P('Mix',0,100,25,'%'), lowcut:P('Low Cut',20,1000,150,'Hz'), highcut:P('High Cut',1000,16000,7000,'Hz'), shimmer:P('Shimmer',0,100,0,'%'), trails:B('Trails',1) },
  build(ctx,b){ const n=b.n; n.pre=ctx.createDelay(0.5); n.cv=ctx.createConvolver(); n.hp=ctx.createBiquadFilter(); n.hp.type='highpass'; n.lp=ctx.createBiquadFilter(); n.lp.type='lowpass'; n.wet=ctx.createGain(); n.sh=new AudioWorkletNode(ctx,'np-pitch',{outputChannelCount:[2]}); n.sh.parameters.get('semitones').value=12; n.shg=ctx.createGain(); n.shd=ctx.createDelay(0.1); n.shd.delayTime.value=0.03; n.inG=ctx.createGain(); n.key=''; b.wetDry=ctx.createGain(); b.wetIn.connect(b.wetDry).connect(b.wetOut);
    b.wetIn.connect(n.inG).connect(n.pre).connect(n.cv).connect(n.hp).connect(n.lp).connect(n.wet).connect(b.wetOut); n.lp.connect(n.sh).connect(n.shg).connect(n.shd).connect(n.pre); b.trailsWet=n.wet; b.trailsIn=n.inG; },
  apply(b){ const n=b.n,p=b.p; const key=p.type+':'+p.decay.toFixed(2); if(key!==n.key){ n.key=key; n.cv.buffer=genReverbIR(NP.ctx, ['Room','Hall','Plate','Spring','Cathedral','Shimmer'][p.type], p.decay); } n.pre.delayTime.value=p.predelay/1000; n.hp.frequency.value=p.lowcut; n.lp.frequency.value=p.highcut; setP(n.wet.gain,p.mix/100*1.5); setP(n.shg.gain, p.shimmer/100*0.5); }
});
// --- Utility ---
def('vol', { name:'Volume / Pan', cat:'Utility', color:'#ccc',
  params:{ gain:P('Gain',-60,24,0,'dB'), pan:P('Pan',-100,100,0,''), polarity:B('Invert',0), mute:B('Mute',0) },
  build(ctx,b){ const n=b.n; n.g=ctx.createGain(); n.p=ctx.createStereoPanner(); b.wetIn.connect(n.g).connect(n.p).connect(b.wetOut); },
  apply(b){ const n=b.n,p=b.p; setP(n.g.gain, p.mute?0:dB(p.gain)*(p.polarity?-1:1)); n.p.pan.value=p.pan/100; }
});
def('widen', { name:'Stereo Width', cat:'Utility', color:'#ccc',
  params:{ width:P('Width',0,200,100,'%'), delay:P('Haas',0,30,0,'ms'), mono:B('Mono Sum',0) },
  build(ctx,b){ const n=b.n; n.sp=ctx.createChannelSplitter(2); n.mg=ctx.createChannelMerger(2); n.d=ctx.createDelay(0.1); n.m=ctx.createGain(); n.s=ctx.createGain(); n.sInv=ctx.createGain(); n.sInv.gain.value=-1; n.mid=ctx.createGain(); n.side=ctx.createGain(); n.l=ctx.createGain(); n.r=ctx.createGain();
    b.wetIn.connect(n.sp); n.sp.connect(n.mid,0); n.sp.connect(n.mid,1); n.sp.connect(n.side,0); n.sp.connect(n.sInv,1); n.sInv.connect(n.side); n.mid.gain.value=0.5; n.side.gain.value=0.5;
    n.mid.connect(n.l); n.mid.connect(n.r); n.side.connect(n.s); n.s.connect(n.l); const sNeg=ctx.createGain(); sNeg.gain.value=-1; n.s.connect(sNeg).connect(n.r); n.l.connect(n.mg,0,0); n.r.connect(n.d).connect(n.mg,0,1); n.mg.connect(b.wetOut); },
  apply(b){ const n=b.n,p=b.p; setP(n.s.gain, p.mono?0:p.width/100); n.d.delayTime.value=p.delay/1000; }
});
def('boost', { name:'Clean Boost', cat:'Utility', color:'#ccc',
  params:{ gain:P('Boost',0,20,6,'dB'), lo:P('Low Cut',20,300,20,'Hz') },
  build(ctx,b){ const n=b.n; n.h=ctx.createBiquadFilter(); n.h.type='highpass'; n.g=ctx.createGain(); b.wetIn.connect(n.h).connect(n.g).connect(b.wetOut); },
  apply(b){ setP(b.n.g.gain,dB(b.p.gain)); b.n.h.frequency.value=b.p.lo; }
});
def('xover', { name:'Crossover Tilt', cat:'Utility', color:'#ccc',
  params:{ freq:P('Freq',60,1000,200,'Hz'), lows:P('Lows',-24,12,0,'dB'), highs:P('Highs',-24,12,0,'dB') },
  build(ctx,b){ const n=b.n; n.lp=ctx.createBiquadFilter(); n.lp.type='lowpass'; n.hp=ctx.createBiquadFilter(); n.hp.type='highpass'; n.lg=ctx.createGain(); n.hg=ctx.createGain(); b.wetIn.connect(n.lp).connect(n.lg).connect(b.wetOut); b.wetIn.connect(n.hp).connect(n.hg).connect(b.wetOut); },
  apply(b){ const n=b.n,p=b.p; n.lp.frequency.value=p.freq; n.hp.frequency.value=p.freq; setP(n.lg.gain,dB(p.lows)); setP(n.hg.gain,dB(p.highs)); }
});
// --- Looper ---
def('looper', { name:'Looper', cat:'Looper', color:'#f88',
  params:{ level:P('Loop Level',0,200,100,'%'), feedback:P('Overdub Decay',0,100,100,'%') },
  build(ctx,b){ b.n.l=new AudioWorkletNode(ctx,'np-looper',{outputChannelCount:[2]}); b.wetIn.connect(b.n.l).connect(b.wetOut); b.n.l.port.onmessage=(e)=>{ b.loopState=e.data; if(window.onLooperState) window.onLooperState(b); }; },
  apply(b){ b.n.l.parameters.get('level').value=b.p.level/100; b.n.l.parameters.get('feedback').value=b.p.feedback/100; }
});

// ---------- Block lifecycle ----------
function createBlock(type, p, bypass){ const d=BLOCKS[type]; if(!d) throw new Error('unknown block '+type); const ctx=NP.ctx; const b={id:uid(), type, bypass:!!bypass, p:{}, n:{}}; for(const k in d.params){ b.p[k]=(p&&k in p)?p[k]:d.params[k].def; }
  b.input=ctx.createGain(); b.output=ctx.createGain(); b.dry=ctx.createGain(); b.wetIn=ctx.createGain(); b.wetOut=ctx.createGain();
  b.input.connect(b.dry).connect(b.output); b.input.connect(b.wetIn); b.wetOut.connect(b.output);
  d.build(ctx,b); d.apply(b); NP.blocks[b.id]=b; setBypass(b,b.bypass,true); return b; }
function setBypass(b,on,inst){ b.bypass=on; const t=inst?0.001:0.012; const trails = b.trailsWet && b.p.trails===1;
  setP(b.dry.gain,on?1:0,t);
  if(trails){ setP(b.trailsIn.gain,on?0:1,t); setP(b.wetDry.gain,on?0:1,t); setP(b.wetOut.gain,1,t); }
  else { setP(b.wetOut.gain,on?0:1,t); if(b.trailsIn){ setP(b.trailsIn.gain,1,t); setP(b.wetDry.gain,1,t); } }
  const d=BLOCKS[b.type]; if(d.onBypass) d.onBypass(b,on,inst); if(!inst && NP.rig && NP.preset && BLOCKS[b.type].lat) alignPaths(); }
function applyBlock(b){ BLOCKS[b.type].apply(b); }
function destroyBlock(b){ try{ const d=BLOCKS[b.type]; if(d.destroy) d.destroy(b); }catch(e){} try{ b.input.disconnect(); b.output.disconnect(); for(const k in b.n){ const x=b.n[k];
      if(typeof AudioWorkletNode!=='undefined' && x instanceof AudioWorkletNode){ try{ x.port.onmessage=null; x.port.postMessage({cmd:'kill'}); }catch(e){} } // let the audio thread free it
      if(x&&x.disconnect) try{x.disconnect();}catch(e){} if(x&&x.stop) try{x.stop();}catch(e){} if(Array.isArray(x)) x.forEach(y=>{ if(typeof AudioWorkletNode!=='undefined' && y instanceof AudioWorkletNode){ try{ y.port.onmessage=null; y.port.postMessage({cmd:'kill'}); }catch(e){} } try{y.disconnect();}catch(e){} }); } }catch(e){} delete NP.blocks[b.id]; }
function totalBlocks(){ return NP.paths.A.length+NP.paths.B.length; }

// ---------- Rig graph ----------
function buildRig(){ const ctx=NP.ctx, r=NP.rig={};
  r.inPre=ctx.createGain(); r.inPre.channelCount=2; r.inPre.channelCountMode='explicit'; r.inPre.channelInterpretation='speakers';
  r.inSplit=ctx.createChannelSplitter(2); r.inSelL=ctx.createGain(); r.inSelR=ctx.createGain(); r.inSelR.gain.value=0;
  r.inMono=ctx.createGain(); r.inMono.channelCount=1; r.inMono.channelCountMode='explicit'; r.inMono.channelInterpretation='speakers';
  r.inPre.connect(r.inSplit); r.inSplit.connect(r.inSelL,0); r.inSplit.connect(r.inSelR,1); r.inSelL.connect(r.inMono); r.inSelR.connect(r.inMono);
  r.inGain=ctx.createGain(); r.inMono.connect(r.inGain); r.inAn=ctx.createAnalyser(); r.inAn.fftSize=4096; r.inGain.connect(r.inAn);
  r.xoLP=ctx.createBiquadFilter(); r.xoLP.type='lowpass'; r.xoLP.Q.value=0.5; r.xoHP=ctx.createBiquadFilter(); r.xoHP.type='highpass'; r.xoHP.Q.value=0.5;
  r.aIn=ctx.createGain(); r.bIn=ctx.createGain(); r.aOut=ctx.createGain(); r.bOut=ctx.createGain(); r.aLvl=ctx.createGain(); r.bLvl=ctx.createGain(); r.bPan=ctx.createStereoPanner(); r.bPol=ctx.createGain(); r.sum=ctx.createGain();
  r.aLvl.connect(r.sum); r.bLvl.connect(r.bPan).connect(r.bPol).connect(r.sum);
  r.geq=[]; let prev=r.sum; const gf=[60,180,500,1200,3000,8000]; gf.forEach((f,i)=>{ const q=ctx.createBiquadFilter(); q.type=i===0?'lowshelf':(i===5?'highshelf':'peaking'); q.frequency.value=f; q.Q.value=1; r.geq.push(q); prev.connect(q); prev=q; });
  r.master=ctx.createGain(); r.outAn=ctx.createAnalyser(); r.outAn.fftSize=2048; r.lim=new AudioWorkletNode(ctx,'np-limit',{outputChannelCount:[2]}); r.lim.parameters.get('ceiling').value=-1; r.lim.parameters.get('release').value=80; r.lim.parameters.get('input').value=1.1;   /* the old built-in limiter added about 1 dB of make-up; keep the same loudness */ r.lim.port.onmessage=e=>{ NP.meters.lim=e.data.gr; }; r.outGain=ctx.createGain();
  prev.connect(r.master).connect(r.lim).connect(r.outGain).connect(r.outAn);
  // outputs: main pair, aux pair, and up to 8 channels for FX loop sends
  r.mono=ctx.createGain(); r.mono.channelCount=1; r.mono.channelCountMode='explicit'; r.monoUp=ctx.createGain();
  r.mainSel=ctx.createGain(); r.outGain.connect(r.mainSel); r.mainSplit=ctx.createChannelSplitter(2); r.mainSel.connect(r.mainSplit);
  r.aux=ctx.createGain(); r.auxLvl=ctx.createGain(); r.auxSplit=ctx.createChannelSplitter(2); r.auxLim=new AudioWorkletNode(ctx,'np-limit',{outputChannelCount:[2]}); r.auxLim.parameters.get('ceiling').value=-1; r.aux.connect(r.auxLvl).connect(r.auxLim).connect(r.auxSplit);   // Aux gets its own safety limiter
  r.auxSends=ctx.createGain(); r.auxSends.connect(r.aux);   // Aux Send blocks feed this; it is on only when Aux is set to carry them
  r.auxDry=ctx.createGain(); r.auxDry.gain.value=0; r.auxCopy=ctx.createGain(); r.auxCopy.gain.value=0; r.auxDry.connect(r.aux); r.auxCopy.connect(r.aux); r.outGain.connect(r.auxCopy);
  r.merge=ctx.createChannelMerger(8); r.merge.connect(ctx.destination);
  r.rec=new AudioWorkletNode(ctx,'np-recorder'); r.outGain.connect(r.rec);
  r.inMeter=new AudioWorkletNode(ctx,'np-meter'); r.inGain.connect(r.inMeter); r.inMeter.port.onmessage=e=>{ NP.meters.in=e.data; };
  r.outMeter=new AudioWorkletNode(ctx,'np-meter'); r.outGain.connect(r.outMeter); r.outMeter.port.onmessage=e=>{ NP.meters.out=e.data; };
  r.backing=ctx.createGain(); r.backing.connect(r.master);
  r.demo=ctx.createGain(); r.demo.connect(r.inGain);
  r.inGain.connect(r.auxDry);
  r.aDel=ctx.createDelay(0.1); r.bDel=ctx.createDelay(0.1); r.aDel.delayTime.value=0; r.bDel.delayTime.value=0;
  routeOutputs();
}
// The interface decides how many outputs there are. Main and Aux each take a pair.
function outChannels(){ const d=NP.ctx.destination; return Math.max(2, Math.min(8, d.maxChannelCount||2)); }
function routeOutputs(force){ const r=NP.rig, ctx=NP.ctx, d=ctx.destination, g=NP.globals||{}, N=outChannels();
  const key=[N,g.mainOut|0,g.auxOut|0,g.mono|0].join(); setP(r.auxSends.gain, (g.auxSrc|0)===0?1:0); if(!force && r.routeKey===key){ setP(r.auxDry.gain, (g.auxSrc|0)===2?1:0); setP(r.auxCopy.gain, (g.auxSrc|0)===1?1:0); setP(r.auxLvl.gain, dB(g.auxLvl||0)); return; } r.routeKey=key;
  try{ d.channelCount=N; d.channelCountMode='explicit'; d.channelInterpretation='discrete'; }catch(e){}
  try{ r.mainSplit.disconnect(); }catch(e){} try{ r.auxSplit.disconnect(); }catch(e){}
  const mp=Math.min((g.mainOut|0)*2, N-2), ap=(g.auxOut|0)*2;
  r.mainSel.channelCount=g.mono?1:2; r.mainSel.channelCountMode='explicit'; r.mainSel.channelInterpretation='speakers';
  if(g.mono){ r.mainSplit.connect(r.merge,0,mp); r.mainSplit.connect(r.merge,0,mp+1); } else { r.mainSplit.connect(r.merge,0,mp); r.mainSplit.connect(r.merge,1,mp+1); }
  NP.auxLive = ap>=2 && ap+1<N && ap!==mp;
  if(NP.auxLive){ r.auxSplit.connect(r.merge,0,ap); r.auxSplit.connect(r.merge,1,ap+1); }
  const src=g.auxSrc|0; setP(r.auxDry.gain, src===2?1:0); setP(r.auxCopy.gain, src===1?1:0); setP(r.auxLvl.gain, dB(g.auxLvl||0)); }
// Delay a block adds, in samples. Parallel paths get padded so they stay in line.
function blockLat(b){ if(b.bypass) return 0; const l=BLOCKS[b.type].lat; return typeof l==='function'?l(b):(l||0); }
function pathLat(k){ return NP.paths[k].reduce((a,b)=>a+blockLat(b),0); }
function chainLatency(){ const s=NP.preset.split, a=pathLat('A'), b=pathLat('B'); return s.mode===2?a+b:(s.mode===3?a:Math.max(a,b)); }
function alignPaths(){ const r=NP.rig, s=NP.preset.split, sr=NP.ctx.sampleRate; let da=0, db=0; if(s.mode===0||s.mode===1){ const a=pathLat('A'), b=pathLat('B'); if(a>b) db=a-b; else da=b-a; }
  setP(r.aDel.delayTime, da/sr, 0.005); setP(r.bDel.delayTime, db/sr, 0.005); }
function rewire(){ const r=NP.rig, s=NP.preset.split; const ctx=NP.ctx;
  r.inGain.disconnect(); r.inGain.connect(r.inAn); r.inGain.connect(r.inMeter); r.xoLP.disconnect(); r.xoHP.disconnect(); r.aIn.disconnect(); r.bIn.disconnect(); r.aOut.disconnect(); r.bOut.disconnect();
  r.aDel.disconnect(); r.bDel.disconnect(); r.aOut.connect(r.aDel).connect(r.aLvl); r.bOut.connect(r.bDel).connect(r.bLvl);
  const mode=s.mode; // 0 parallel, 1 crossover, 2 series, 3 A only
  if(mode===1){ r.inGain.connect(r.xoLP).connect(r.aIn); r.inGain.connect(r.xoHP).connect(r.bIn); r.xoLP.frequency.value=s.xo; r.xoHP.frequency.value=s.xo; }
  else if(mode===2){ r.inGain.connect(r.aIn); r.aOut.disconnect(); r.aOut.connect(r.bIn); }
  else if(mode===3){ r.inGain.connect(r.aIn); }
  else { r.inGain.connect(r.aIn); r.inGain.connect(r.bIn); }
  const chain=(inp,list,out)=>{ let prev=inp; list.forEach(b=>{ b.output.disconnect(); prev.connect(b.input); prev=b.output; }); prev.connect(out); };
  chain(r.aIn, NP.paths.A, r.aOut); chain(r.bIn, NP.paths.B, r.bOut);
  setP(r.aLvl.gain, dB(s.aLvl)); setP(r.bLvl.gain, mode===3?0:dB(s.bLvl)); r.bPan.pan.value=s.bPan/100; setP(r.bPol.gain, s.bPol?-1:1);
  alignPaths(); if(typeof onRigChanged==='function') onRigChanged();
}
function applyGlobals(){ const rk=NP.rig.routeKey+':'+(NP.globals.inCh|0); routeOutputs(); if(NP.lastLoopKey!==rk){ NP.lastLoopKey=rk; if(NP.preset) [...NP.paths.A,...NP.paths.B].filter(b=>b.type==='fxloop').forEach(b=>BLOCKS.fxloop.apply(b)); } const g=NP.globals, r=NP.rig, cg=NP.cloneGuard|0, ch=g.inCh|0, now=NP.ctx.currentTime; r.geq.forEach((q,i)=>q.gain.value=g.geq[i]);
  if(NP.guardWas && !cg) NP.guardOff=now;   // the Clone guard just let go: fade the chain back in over about a second
  setP(r.master.gain, cg?0:dB(g.master), !cg && NP.guardOff!=null && now-NP.guardOff<1.2 ? 0.4 : 0.02); NP.guardWas=cg;
  const inTrim=dB(g.inGain)*(g.pad?0.5:1); setP(r.inGain.gain,inTrim); setP(r.inSelL.gain, ch===0?1:ch===2?0.5:0); setP(r.inSelR.gain, ch===1?1:ch===2?0.5:0);
  setP(r.outGain.gain, cg===2?1:(g.mute||NP.tunerMute)?0:1);
  if(typeof UI!=='undefined' && UI.clSrcG) setP(UI.clSrcG.gain, 0.9*dB(Math.min(0,g.master)));   // the Clone A/B preview follows the master
  if(NP.lastInTrim!==inTrim){ NP.lastInTrim=inTrim; if(typeof refreshCloneBlocks==='function') refreshCloneBlocks(); } }   // pedal clones undo the input gain

// ---------- Preset model ----------
function blankPreset(name='Init'){ return { name, bpm:120, split:{mode:0,xo:200,aLvl:0,bLvl:-100,bPan:0,bPol:0}, A:[], B:[], scenes:Array.from({length:8},(_,i)=>({name:'Scene '+(i+1), data:null})), stomps:{A:[],B:[],C:[]}, exp:{target:null,min:0,max:100} }; }
function serializeBlock(b){ return {type:b.type, bypass:b.bypass, p:{...b.p}, ir:b.customIRName||null}; }
function serializePreset(){ const p=NP.preset; return { name:p.name, bpm:NP.bpm, split:{...p.split}, A:NP.paths.A.map(serializeBlock), B:NP.paths.B.map(serializeBlock), scenes:p.scenes.map(s=>({name:s.name,data:s.data?JSON.parse(JSON.stringify(s.data)):null})), stomps:JSON.parse(JSON.stringify(p.stomps)), exp:{...p.exp} }; }
function loadPreset(data){ const d=data?JSON.parse(JSON.stringify(data)):blankPreset();
  ['A','B'].forEach(k=>{ NP.paths[k].forEach(destroyBlock); NP.paths[k]=[]; });
  NP.preset={ name:d.name||'Init', split:Object.assign({mode:0,xo:200,aLvl:0,bLvl:-100,bPan:0,bPol:0},d.split||{}), scenes:(d.scenes&&d.scenes.length===8)?d.scenes:blankPreset().scenes, stomps:Object.assign({A:[],B:[],C:[]},d.stomps||{}), exp:Object.assign({target:null,min:0,max:100},d.exp||{}) };
  if(NP.preset.exp.target && !NP.preset.exp.target.ref) NP.preset.exp.target=null;
  NP.bpm=d.bpm||120;
  ['A','B'].forEach(k=>{ (d[k]||[]).forEach(bd=>{ if(BLOCKS[bd.type]) NP.paths[k].push(createBlock(bd.type,bd.p,bd.bypass)); }); });
  NP.selected=null; rewire(); NP.scene=-1; }
function captureScene(){ return { bypass:{A:NP.paths.A.map(b=>b.bypass),B:NP.paths.B.map(b=>b.bypass)}, params:{A:NP.paths.A.map(b=>({...b.p})),B:NP.paths.B.map(b=>({...b.p}))}, split:{...NP.preset.split} }; }
function recallScene(i){ const s=NP.preset.scenes[i]; if(!s||!s.data) return false; const d=s.data; ['A','B'].forEach(k=>{ NP.paths[k].forEach((b,j)=>{ if(d.params[k][j]){ Object.assign(b.p,d.params[k][j]); applyBlock(b); } if(d.bypass[k][j]!=null) setBypass(b,d.bypass[k][j]); }); }); if(d.split){ Object.assign(NP.preset.split,d.split); rewire(); } NP.scene=i; return true; }

// ---------- Tuner (autocorrelation) ----------
const NOTE_NAMES=['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
function detectPitch(buf, sr){ const n=buf.length; let rms=0; for(let i=0;i<n;i++) rms+=buf[i]*buf[i]; rms=Math.sqrt(rms/n); if(rms<0.004) return -1;
  const minP=Math.floor(sr/400), maxP=Math.floor(sr/27); let best=-1, bestC=0; const N=n>>1;
  for(let p=minP;p<=maxP;p++){ let c=0; for(let i=0;i<N;i++) c+=buf[i]*buf[i+p]; if(c>bestC){ bestC=c; best=p; } }
  if(best<0) return -1;
  let e=0; for(let i=0;i<N;i++) e+=buf[i]*buf[i]; if(bestC/e<0.5) return -1;
  // octave fix: take the shortest period whose correlation is a local peak near the best
  for(let p=minP+1;p<best;p++){ let c=0; for(let i=0;i<N;i++) c+=buf[i]*buf[i+p]; if(c>=bestC*0.85){ let cm=0, cp=0; for(let i=0;i<N;i++){ cm+=buf[i]*buf[i+p-1]; cp+=buf[i]*buf[i+p+1]; } if(c>=cm&&c>=cp){ best=p; bestC=c; break; } } }
  // parabolic refine
  const c=(p)=>{ let s=0; for(let i=0;i<N;i++) s+=buf[i]*buf[i+p]; return s; }; const a=c(best-1), b=bestC, d=c(best+1); const shift=(a-d)/(2*(a-2*b+d)||1); return sr/(best+shift); }
function noteFromFreq(f, ref=440){ const m=12*Math.log2(f/ref)+69; const r=Math.round(m); return {name:NOTE_NAMES[((r%12)+12)%12], octave:Math.floor(r/12)-1, cents:(m-r)*100, midi:r}; }

// ---------- Capture math ----------
function makeSweep(sr, dur, f1=20, f2=20000){ const n=Math.floor(sr*dur), s=new Float32Array(n); const K=dur*f1/Math.log(f2/f1), L=dur/Math.log(f2/f1); for(let i=0;i<n;i++){ const t=i/sr; s[i]=0.5*Math.sin(2*Math.PI*K*(Math.exp(t/L)-1)); } for(let i=0;i<sr*0.02;i++){ s[i]*=i/(sr*0.02); s[n-1-i]*=i/(sr*0.02); } return s; }
function deconvolve(rec, sweep, sr, irLen){ const N=nextPow2(rec.length+sweep.length); const re=new Float32Array(N), im=new Float32Array(N), sre=new Float32Array(N), sim=new Float32Array(N); re.set(rec); sre.set(sweep); fft(re,im,false); fft(sre,sim,false);
  let mx=0; for(let i=0;i<N;i++){ const m=sre[i]*sre[i]+sim[i]*sim[i]; if(m>mx) mx=m; } const eps=mx*1e-4;
  for(let i=0;i<N;i++){ const a=re[i],b=im[i],c=sre[i],d=sim[i]; const den=c*c+d*d+eps; re[i]=(a*c+b*d)/den; im[i]=(b*c-a*d)/den; }
  fft(re,im,true); // find peak (latency)
  let pk=0,pi=0; for(let i=0;i<Math.min(N,sr);i++){ if(Math.abs(re[i])>pk){ pk=Math.abs(re[i]); pi=i; } }
  const start=Math.max(0,pi-8); const ir=re.slice(start,start+irLen); for(let i=0;i<Math.min(200,irLen);i++) ir[irLen-1-i]*=i/200; let m=0; for(let i=0;i<irLen;i++) m=Math.max(m,Math.abs(ir[i])); if(m>0) for(let i=0;i<irLen;i++) ir[i]/=m; return {ir, latency:pi}; }
function makeRamp(sr, dur, f=110){ const n=Math.floor(sr*dur), s=new Float32Array(n); for(let i=0;i<n;i++){ const t=i/sr; s[i]=Math.sin(2*Math.PI*f*t)*Math.min(1,t/dur*1.05); } return s; }
function fitCurve(x, y, latency){ const bins=256, sum=new Float64Array(bins), cnt=new Float64Array(bins); const n=Math.min(x.length, y.length-latency); for(let i=0;i<n;i++){ const xi=x[i], yi=y[i+latency]; const k=Math.min(bins-1,Math.max(0,Math.round((xi+1)/2*(bins-1)))); sum[k]+=yi; cnt[k]++; }
  const c=new Float32Array(bins); let last=0; for(let k=0;k<bins;k++){ c[k]=cnt[k]>0?sum[k]/cnt[k]:last; last=c[k]; } // fill holes from both sides
  for(let k=bins-1;k>=0;k--){ if(cnt[k]===0 && k<bins-1) c[k]=c[k+1]; }
  let mx=0; for(let k=0;k<bins;k++) mx=Math.max(mx,Math.abs(c[k])); const out=new Float32Array(8192); for(let i=0;i<8192;i++){ const pos=i/8191*(bins-1); const k=Math.floor(pos), f=pos-k; out[i]=(c[k]*(1-f)+c[Math.min(bins-1,k+1)]*f)/(mx||1); }
  // smooth
  for(let pass=0;pass<3;pass++){ for(let i=1;i<8191;i++) out[i]=(out[i-1]+out[i]*2+out[i+1])/4; } out[4096]=0; return out; }
function bandEnergies(samples, sr){ const N=4096, re=new Float32Array(N), im=new Float32Array(N); const acc=new Float64Array(10); let frames=0; for(let off=0; off+N<=samples.length; off+=N){ for(let i=0;i<N;i++){ re[i]=samples[off+i]*(0.5-0.5*Math.cos(2*Math.PI*i/N)); im[i]=0; } fft(re,im,false); frames++; for(let k=1;k<N/2;k++){ const f=k*sr/N; const m=re[k]*re[k]+im[k]*im[k]; const bi=Math.round(Math.log2(f/31.25)); if(bi>=0&&bi<10) acc[bi]+=m; } } return Array.from(acc,(v)=>10*Math.log10(v/(frames||1)+1e-12)); }
function encodeWav(L,R,sr){ const n=L.length, buf=new ArrayBuffer(44+n*4), v=new DataView(buf); const w=(o,s)=>{ for(let i=0;i<s.length;i++) v.setUint8(o+i,s.charCodeAt(i)); }; w(0,'RIFF'); v.setUint32(4,36+n*4,true); w(8,'WAVE'); w(12,'fmt '); v.setUint32(16,16,true); v.setUint16(20,1,true); v.setUint16(22,2,true); v.setUint32(24,sr,true); v.setUint32(28,sr*4,true); v.setUint16(32,4,true); v.setUint16(34,16,true); w(36,'data'); v.setUint32(40,n*4,true); for(let i=0;i<n;i++){ v.setInt16(44+i*4, Math.max(-1,Math.min(1,L[i]))*32767, true); v.setInt16(46+i*4, Math.max(-1,Math.min(1,R[i]))*32767, true); } return new Blob([buf],{type:'audio/wav'}); }

// ---------- Factory presets ----------
function factoryPresets(){ const mk=(name, A, B, split, bpm)=>{ const p=blankPreset(name); p.A=A.map(([t,pp,by])=>({type:t,p:pp||{},bypass:!!by})); p.B=(B||[]).map(([t,pp,by])=>({type:t,p:pp||{},bypass:!!by})); if(split) Object.assign(p.split,split); if(bpm) p.bpm=bpm;
    // ready-to-stomp: A = drive/pitch/synth, B = mod/filter/EQ, C = delay/reverb/looper
    const pick=(cats)=>{ for(const k of ['A','B']){ const i=p[k].findIndex(bl=>cats.includes((BLOCKS[bl.type]||{}).cat)); if(i>=0) return k+i; } return null; };
    [['A',['Drive','Pitch','Synth']],['B',['Mod','Filter','EQ']],['C',['Delay','Reverb','Looper']]].forEach(([f,cats])=>{ const r=pick(cats); if(r) p.stomps[f]=[{ref:r,mode:'toggle'}]; });
    return p; };
  return [
    mk('Studio DI Clean', [['comp',{thr:-20,ratio:3}],['tone6',{b70:2,b2k:1}],['amp',{model:5,gain:20}],['cab',{cab:1}]]),
    mk('B3K Grind', [['comp',{thr:-24,ratio:4}],['b3k',{drive:60,blend:65,level:2}],['amp',{model:3,gain:30}],['cab',{cab:0}]]),
    mk('Alpha-Omega Doom', [['gate',{thr:-50}],['omega',{drive:80,blend:75,grunt:110}],['amp',{model:0,gain:45,bass:3}],['cab',{cab:0,highcut:6000}]]),
    mk('Vintage Flip Top', [['comp',{thr:-18,ratio:2.5,attack:20}],['vintage',{drive:35,blend:50}],['amp',{model:1,gain:40,mid:2}],['cab',{cab:2,mic:2}]]),
    mk('Mr Miller Slap', [['comp',{thr:-28,ratio:6,attack:2,release:80}],['tone6',{b70:4,b500:-4,b5k:4}],['amp',{model:4,gain:15}],['cab',{cab:1,mic:1}],['chorus',{mix:25,rate:0.5}]]),
    mk('Octave Funk', [['octave',{sub1:80,dry:100}],['envf',{sens:60,q:6}],['comp',{thr:-22,ratio:4}],['amp',{model:2,gain:25}],['cab',{cab:1}]]),
    mk('Peach Synth Bass', [['synth',{wave:0,sub:40,cutoff:300,envamt:70,mix:65}],['comp',{thr:-20,ratio:4}],['chorus',{mix:20}],['amp',{model:5}],['cab',{cab:3}]]),
    mk('Fuzz Wall (Dual Rig)', [['ignis',{drive:80,blend:100,grunt:60}],['amp',{model:6,gain:50}],['cab',{cab:0}]], [['comp',{thr:-22}],['cut',{lo:30,hi:400}],['amp',{model:5}]], {mode:0,aLvl:-2,bLvl:0}),
    mk('Xover Dirt Up Top', [['cut',{lo:30,hi:12000}],['amp',{model:5}],['cab',{cab:2}]], [['b3k',{drive:70,blend:100}],['amp',{model:3,gain:35}],['cab',{cab:1}]], {mode:1,xo:180,aLvl:0,bLvl:-1}),
    mk('Dub Delay', [['comp',{thr:-20}],['amp',{model:0,gain:30}],['cab',{cab:0}],['delay',{type:1,sync:3,fb:55,mix:40,mod:30}],['reverb',{type:3,mix:20}]], [], null, 140),
    mk('Ambient Swell', [['comp',{thr:-25,ratio:3}],['pitch',{semi:12,mix:40}],['chorus',{mix:40}],['delay',{type:3,sync:2,fb:50,mix:45}],['reverb',{type:5,decay:5,mix:60,shimmer:50}]], [], null, 90),
    mk('Tube Pre + Boost', [['tubepre',{drive:30,blend:100}],['boost',{gain:4}],['peq',{g1:2,g3:-2,g5:1}],['amp',{model:0,gain:35}],['cab',{cab:6}]]),
    mk('Rotary Lead', [['od',{drive:50,blend:80}],['rotary',{speed:0,mix:80}],['amp',{model:2}],['cab',{cab:4}],['reverb',{type:1,mix:20}]]),
    mk('Lo-Fi Crush', [['crush',{bits:6,rate:6,mix:70}],['filter',{type:0,freq:1500,q:3}],['amp',{model:7}],['cab',{cab:5}]]),
    mk('Harmony Pad', [['harm',{v1:7,l1:50,v2:12,l2:30,spread:80}],['reverb',{type:4,decay:4,mix:40}]]),
    mk('Looper Jam', [['comp'],['amp',{model:5}],['cab',{cab:1}],['looper']])
  ]; }
