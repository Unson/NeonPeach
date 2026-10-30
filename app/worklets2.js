// ===== Neon Peach v2 worklets: zero-delay dynamics and drive, and the new effects =====
// The built-in compressor waits 6 ms before it acts, and the built-in 4x drive adds 4 ms.
// These do the same jobs with no wait (the drive adds 15 samples, about 0.3 ms).

// ---------- Compressor: feed-forward, no look-ahead, real sidechain high-pass, blend inside ----------
class CompProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors(){ const k='k-rate'; return [
    {name:'threshold', defaultValue:-20, minValue:-80, maxValue:0, automationRate:k},
    {name:'ratio', defaultValue:4, minValue:1, maxValue:100, automationRate:k},
    {name:'attack', defaultValue:8, minValue:0.05, maxValue:200, automationRate:k},
    {name:'release', defaultValue:120, minValue:5, maxValue:3000, automationRate:k},
    {name:'knee', defaultValue:6, minValue:0, maxValue:30, automationRate:k},
    {name:'makeup', defaultValue:0, minValue:-24, maxValue:36, automationRate:k},
    {name:'mix', defaultValue:1, minValue:0, maxValue:1, automationRate:k},
    {name:'schpf', defaultValue:20, minValue:10, maxValue:1000, automationRate:k},
    {name:'rms', defaultValue:0, minValue:0, maxValue:1, automationRate:k},
    {name:'auto', defaultValue:0, minValue:0, maxValue:1, automationRate:k} ]; }
  constructor(){ super(); onKill(this); this.env=0; this.hz=0; this.hx=0; this.ms=0; this.minGr=0; this.tick=0; }
  process(inputs, outputs, p){
    if(this.dead) return false; const inp=inputs[0], out=outputs[0]; if(!inp||!inp.length){ return true; }
    const n=inp[0].length, nc=out.length, T=p.threshold[0], R=Math.max(1,p.ratio[0]), W=p.knee[0], mk=Math.pow(10,(p.makeup[0]+p.auto[0]*0.6*Math.max(0,-T)*(1-1/R))/20), mix=p.mix[0], rms=p.rms[0]>0.5;   // auto: the same make-up gain the browser's own compressor adds, so old presets keep their level
    const aA=Math.exp(-1/(sampleRate*p.attack[0]/1000)), aR=Math.exp(-1/(sampleRate*p.release[0]/1000)), hp=Math.exp(-2*Math.PI*p.schpf[0]/sampleRate), aM=Math.exp(-1/(sampleRate*0.01));
    const sl=1/R-1;
    for(let i=0;i<n;i++){
      let s=0; for(let c=0;c<inp.length;c++) s+=inp[c][i]; s/=inp.length;
      const h=hp*(this.hz+s-this.hx); this.hx=s; this.hz=h;                 // one-pole high-pass on the detector only
      let lv; if(rms){ this.ms=aM*this.ms+(1-aM)*h*h; lv=Math.sqrt(this.ms)*1.414; } else lv=Math.abs(h);
      const x=20*Math.log10(lv+1e-9); let y;
      const d=x-T; if(2*d < -W) y=x; else if(W>0 && 2*Math.abs(d)<=W){ const q=d+W/2; y=x+sl*q*q/(2*W); } else y=T+d/R;
      const gr=y-x; this.env = gr<this.env ? aA*this.env+(1-aA)*gr : aR*this.env+(1-aR)*gr;
      if(this.env<this.minGr) this.minGr=this.env;
      const g=Math.pow(10,this.env/20)*mk, wet=g*mix+(1-mix);
      for(let c=0;c<nc;c++){ const src=inp[c]||inp[0]; out[c][i]=src[i]*wet; }
    }
    this.tick+=n; if(this.tick>sampleRate/30){ this.tick=0; this.port.postMessage({gr:this.minGr}); this.minGr=0; }
    return true; }
}

// ---------- Drive: 4x oversampled table shaper with antiderivative anti-aliasing ----------
// Two half-band stages up, the curve, two stages down. Only the non-zero taps are used.
function halfband(N, beta){ const M=(N-1)>>1, h=new Float64Array(N), I0=(x)=>{ let s=1,t=1; for(let k=1;k<40;k++){ t*=(x/2)/k; s+=t*t; } return s; }, b0=I0(beta); let sum=0;
  for(let n=0;n<N;n++){ const m=n-M, x=m/2, sinc=m===0?1:Math.sin(Math.PI*x)/(Math.PI*x), r=2*n/(N-1)-1; h[n]=0.5*sinc*I0(beta*Math.sqrt(Math.max(0,1-r*r)))/b0; sum+=h[n]; }
  for(let n=0;n<N;n++) h[n]/=sum; const taps=[]; for(let k=0;k<N;k+=2) taps.push(h[k]); return {M, taps:Float64Array.from(taps), center:h[M]}; }
class HB { // M must be odd: the even taps hold the filter, the centre tap is a plain delay
  constructor(d){ this.d=d; const T=d.taps.length; this.T=T; this.D=(d.M+1)>>1; this.L=Math.max(T,this.D+1);
    this.ux=new Float64Array(this.L*2); this.ui=0; this.ve=new Float64Array(this.L*2); this.vo=new Float64Array(this.L*2); this.vi=0; }
  up(x){ const L=this.L; this.ui=(this.ui+1)%L; this.ux[this.ui]=x; this.ux[this.ui+L]=x; const t=this.d.taps, base=this.ui+L; let a=0; for(let j=0;j<this.T;j++) a+=t[j]*this.ux[base-j];
    this.a=2*a; this.b=this.ux[base-(this.D-1)]*2*this.d.center; }
  down(e,o){ const L=this.L; this.vi=(this.vi+1)%L; this.ve[this.vi]=e; this.ve[this.vi+L]=e; this.vo[this.vi]=o; this.vo[this.vi+L]=o; const t=this.d.taps, base=this.vi+L; let y=0;
    for(let j=0;j<this.T;j++) y+=t[j]*this.vo[base-j]; return y+this.d.center*this.ve[base-(this.D-1)]; }
}
const HB1=halfband(31,8), HB2=halfband(15,6);
const SHAPER_LAT=17.875;   // samples of delay through the drive (about 0.37 ms), measured. Dry paths wait this long.
class ShaperProcessor extends AudioWorkletProcessor {
  constructor(o){ super(); onKill(this); const kill=this.port.onmessage; this.ch=[]; this.setCurve(o&&o.processorOptions&&o.processorOptions.curve||null);
    this.port.onmessage=(e)=>{ kill(e); const m=e.data; if(m&&m.curve) this.setCurve(m.curve); }; }
  setCurve(c){ if(!c){ c=new Float32Array([-1,1]); } const N=c.length, h=2/(N-1), F=new Float64Array(N); F[0]=0;
    for(let k=1;k<N;k++) F[k]=F[k-1]+(c[k-1]+c[k])*h/2;            // exact integral of the straight-line curve
    this.c=c; this.F=F; this.N=N; this.h=h; for(const s of this.ch) s.F0=this.Fi(s.x0); }
  f(x){ const c=this.c, N=this.N; if(x<=-1) return c[0]; if(x>=1) return c[N-1]; const t=(x+1)/this.h, k=Math.min(N-2,t|0), fr=t-k; return c[k]+(c[k+1]-c[k])*fr; }
  Fi(x){ const c=this.c, F=this.F, N=this.N, h=this.h; if(x<=-1) return c[0]*(x+1); if(x>=1) return F[N-1]+c[N-1]*(x-1);
    const t=(x+1)/h, k=Math.min(N-2,t|0), d=(t-k)*h, s=(c[k+1]-c[k])/h; return F[k]+c[k]*d+s*d*d/2; }
  shape(st,x){ const dx=x-st.x0; let y; if(Math.abs(dx)>1e-7){ const F1=this.Fi(x); y=(F1-st.F0)/dx; st.F0=F1; } else { y=this.f(0.5*(x+st.x0)); st.F0=this.Fi(x); } st.x0=x; return y; }
  process(inputs, outputs){
    if(this.dead) return false; const inp=inputs[0], out=outputs[0]; if(!inp||!inp.length){ for(const o of out) o.fill(0); return true; }
    const n=out[0].length;
    for(let c=0;c<out.length;c++){ const src=inp[c]||inp[0], o=out[c]; let st=this.ch[c]; if(!st){ st=this.ch[c]={u1:new HB(HB1), u2a:new HB(HB2), d2:new HB(HB2), d1:new HB(HB1), x0:0, F0:this.Fi(0)}; }
      const u1=st.u1, u2=st.u2a, d2=st.d2, d1=st.d1;
      for(let i=0;i<n;i++){
        u1.up(src[i]); const p=u1.a, q=u1.b;
        u2.up(p); const s0=this.shape(st,u2.a), s1=this.shape(st,u2.b); const e=d2.down(s0,s1);
        u2.up(q); const s2=this.shape(st,u2.a), s3=this.shape(st,u2.b); const od=d2.down(s2,s3);
        o[i]=d1.down(e,od); }
    }
    return true; }
}

// ---------- Limiter: no look-ahead. Fast gain plus a soft safety clip at the ceiling ----------
class LimitProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors(){ const k='k-rate'; return [ {name:'ceiling', defaultValue:-1, minValue:-30, maxValue:0, automationRate:k}, {name:'release', defaultValue:80, minValue:5, maxValue:2000, automationRate:k}, {name:'input', defaultValue:0, minValue:-24, maxValue:36, automationRate:k} ]; }
  constructor(){ super(); onKill(this); this.env=0; this.minG=1; this.tick=0; }
  process(inputs, outputs, p){ if(this.dead) return false; const inp=inputs[0], out=outputs[0]; if(!inp||!inp.length){ for(const o of out) o.fill(0); return true; }
    const n=out[0].length, cl=Math.pow(10,p.ceiling[0]/20), gi=Math.pow(10,p.input[0]/20), rel=Math.exp(-1/(sampleRate*p.release[0]/1000)), atk=Math.exp(-1/(sampleRate*0.0004)), k=0.9*cl, r=cl-k;
    for(let i=0;i<n;i++){ let pk=0; for(let c=0;c<inp.length;c++){ const v=Math.abs(inp[c][i]*gi); if(v>pk) pk=v; }
      this.env = pk>this.env ? atk*this.env+(1-atk)*pk : rel*this.env+(1-rel)*pk; const g=this.env>cl ? cl/this.env : 1; if(g<this.minG) this.minG=g;
      for(let c=0;c<out.length;c++){ let v=(inp[c]||inp[0])[i]*gi*g; const a=Math.abs(v); if(a>k){ v=Math.sign(v)*(k+r*Math.tanh((a-k)/r)); } out[c][i]=v; } }
    this.tick+=n; if(this.tick>sampleRate/30){ this.tick=0; this.port.postMessage({gr:20*Math.log10(this.minG)}); this.minG=1; }
    return true; }
}

// ---------- Reverse delay: plays each slice backwards, two overlapping windows ----------
class RevDelayProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors(){ const k='k-rate'; return [ {name:'time', defaultValue:500, minValue:50, maxValue:2000, automationRate:k}, {name:'feedback', defaultValue:0.3, minValue:0, maxValue:0.95, automationRate:k}, {name:'mix', defaultValue:0.5, minValue:0, maxValue:1, automationRate:k} ]; }
  constructor(){ super(); onKill(this); this.S=Math.ceil(sampleRate*4.5); this.buf=[new Float32Array(this.S), new Float32Array(this.S)]; this.w=0; this.g=null; }
  // two grains, half a slice apart. Each keeps its own length until it ends, so a new time never makes a jump.
  process(inputs, outputs, p){ if(this.dead) return false; const inp=inputs[0], out=outputs[0], n=out[0].length, S=this.S;
    const L=Math.max(256,Math.floor(sampleRate*p.time[0]/1000)), fbk=p.feedback[0], mix=p.mix[0];
    if(!this.g) this.g=[{s:this.w,L,k:0},{s:this.w+(L>>1),L,k:L>>1}];
    const g0=this.g[0], g1=this.g[1];
    for(let i=0;i<n;i++){
      for(const g of this.g){ if(g.k>=g.L){ g.k=0; g.L=L; g.s=this.w; } }
      const w0=Math.sin(Math.PI*g0.k/g0.L)**2, w1=Math.sin(Math.PI*g1.k/g1.L)**2, r0=((g0.s-g0.k)%S+S)%S, r1=((g1.s-g1.k)%S+S)%S;
      for(let c=0;c<out.length;c++){ const b=this.buf[c&1], x=inp&&inp.length?(inp[c]||inp[0])[i]:0, y=b[r0]*w0+b[r1]*w1;
        b[this.w]=x+y*fbk; out[c][i]=x*(1-mix*0.5)+y*mix; }
      this.w=(this.w+1)%S; g0.k++; g1.k++; }
    return true; }
}

// ---------- Freeze: grabs a moment of sound and holds it as a smooth pad ----------
class FreezeProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors(){ const k='k-rate'; return [ {name:'level', defaultValue:1, minValue:0, maxValue:2, automationRate:k}, {name:'dry', defaultValue:1, minValue:0, maxValue:1, automationRate:k}, {name:'size', defaultValue:300, minValue:80, maxValue:1000, automationRate:k} ]; }
  constructor(){ super(); onKill(this); const kill=this.port.onmessage; this.R=Math.ceil(sampleRate*1.2); this.ring=new Float32Array(this.R); this.w=0; this.g=null; this.old=null; this.x=1; this.amp=0; this.tgt=0;
    this.port.onmessage=(e)=>{ kill(e); const m=e.data||{}; if(m.cmd==='grab') this.grab(); else if(m.cmd==='let') this.tgt=0; }; }
  grab(){ const L=Math.floor(sampleRate*Math.min(1, this.size||0.3)), g=new Float32Array(L); for(let i=0;i<L;i++) g[i]=this.ring[(this.w-L+i+this.R)%this.R];
    this.old=this.g; this.oldPh=this.ph; this.g=g; this.ph=[0,L/3|0,2*L/3|0]; this.x=0; this.tgt=1; }
  read(g,ph){ const L=g.length; let s=0; for(let j=0;j<3;j++){ const k=ph[j], w=0.5-0.5*Math.cos(2*Math.PI*k/L); s+=g[k]*w; ph[j]=(k+1)%L; } return s*(2/3); }
  process(inputs, outputs, p){ if(this.dead) return false; const inp=inputs[0], out=outputs[0], n=out[0].length; this.size=p.size[0]/1000; const lv=p.level[0], dry=p.dry[0], fade=1/(sampleRate*0.12);
    for(let i=0;i<n;i++){ let x=0; if(inp&&inp.length){ for(let c=0;c<inp.length;c++) x+=inp[c][i]; x/=inp.length; } this.ring[this.w]=x; this.w=(this.w+1)%this.R;
      this.amp+= (this.tgt-this.amp)*0.0005; let y=0;
      if(this.g){ y=this.read(this.g,this.ph); if(this.old&&this.x<1){ y=y*this.x+this.read(this.old,this.oldPh)*(1-this.x); this.x=Math.min(1,this.x+fade); if(this.x>=1) this.old=null; } }
      y*=this.amp*lv; for(let c=0;c<out.length;c++){ const src=inp&&inp.length?(inp[c]||inp[0])[i]:0; out[c][i]=src*dry+y; } }
    return true; }
}

// ---------- Talk box: three formant filters that slide between vowels ----------
const VOWELS=[[[800,1150,2900],[0,-6,-32]],[[400,1600,2700],[0,-24,-30]],[[350,1900,2800],[0,-20,-30]],[[450,800,2830],[0,-11,-30]],[[325,700,2530],[0,-16,-35]]];
class VowelProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors(){ const k='k-rate'; return [ {name:'mode', defaultValue:0, minValue:0, maxValue:2, automationRate:k}, {name:'pos', defaultValue:0.5, minValue:0, maxValue:1, automationRate:k}, {name:'sens', defaultValue:0.5, minValue:0, maxValue:1, automationRate:k}, {name:'rate', defaultValue:1, minValue:0.05, maxValue:10, automationRate:k}, {name:'q', defaultValue:8, minValue:1, maxValue:30, automationRate:k}, {name:'mix', defaultValue:1, minValue:0, maxValue:1, automationRate:k}, {name:'from', defaultValue:0, minValue:0, maxValue:4, automationRate:k}, {name:'to', defaultValue:4, minValue:0, maxValue:4, automationRate:k} ]; }
  constructor(){ super(); onKill(this); this.f=[[new SVF(),new SVF(),new SVF()],[new SVF(),new SVF(),new SVF()]]; this.env=0; this.ph=0; this.m=0; }
  process(inputs, outputs, p){ if(this.dead) return false; const inp=inputs[0], out=outputs[0], n=out[0].length; if(!inp||!inp.length){ for(const o of out) o.fill(0); return true; }
    const mode=Math.round(p.mode[0]), sens=p.sens[0], q=p.q[0], mix=p.mix[0], a=Math.round(p.from[0]), b=Math.round(p.to[0]); const ea=lpCoef(80), er=Math.exp(-1/(sampleRate*0.15));
    let x0=0; for(let c=0;c<inp.length;c++) x0+=Math.abs(inp[c][0]);
    for(let i=0;i<n;i++){ let ab=0; for(let c=0;c<inp.length;c++) ab+=Math.abs(inp[c][i]); ab/=inp.length; this.env = ab>this.env ? this.env+(ab-this.env)*ea : this.env*er;
      if((i&15)===0){ let m; if(mode===0) m=Math.min(1, this.env*(2+sens*40)); else if(mode===1){ this.ph=(this.ph+16*p.rate[0]/sampleRate)%1; m=0.5-0.5*Math.cos(2*Math.PI*this.ph); } else m=p.pos[0];
        this.m=m; const t=a+(b-a)*m, k=Math.min(3,Math.floor(t)), fr=t-k, V0=VOWELS[Math.max(0,Math.min(4,k))], V1=VOWELS[Math.max(0,Math.min(4,k+1))];
        this.F=[0,1,2].map(j=>V0[0][j]+(V1[0][j]-V0[0][j])*fr); this.G=[0,1,2].map(j=>Math.pow(10,(V0[1][j]+(V1[1][j]-V0[1][j])*fr)/20)); }
      for(let c=0;c<out.length;c++){ const x=(inp[c]||inp[0])[i], fs=this.f[c&1]; let y=0; for(let j=0;j<3;j++) y+=fs[j].run(x, this.F[j], q*(j?1.4:1)).bp*this.G[j]; out[c][i]=x*(1-mix)+y*mix*2.2; } }
    return true; }
}

// ---------- Stutter: tempo-locked gate or slice repeat ----------
class StutterProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors(){ const k='k-rate'; return [ {name:'bpm', defaultValue:120, minValue:30, maxValue:300, automationRate:k}, {name:'div', defaultValue:4, minValue:1, maxValue:16, automationRate:k}, {name:'mode', defaultValue:0, minValue:0, maxValue:1, automationRate:k}, {name:'duty', defaultValue:0.5, minValue:0.05, maxValue:0.95, automationRate:k}, {name:'mix', defaultValue:1, minValue:0, maxValue:1, automationRate:k} ]; }
  constructor(){ super(); onKill(this); this.S=Math.ceil(sampleRate*9); this.buf=[new Float32Array(this.S),new Float32Array(this.S)]; /* room for 3 slices of a quarter note at 30 bpm */ this.w=0; this.slot=-1; this.st=0; this.g=0; this.tape=1; this.tp=0; }
  process(inputs, outputs, p){ if(this.dead) return false; const inp=inputs[0], out=outputs[0], n=out[0].length; const bpm=p.bpm[0], div=p.div[0], mode=Math.round(p.mode[0]), duty=p.duty[0], mix=p.mix[0];
    const spb=sampleRate*60/bpm/div*4/4; const t0=currentTime*sampleRate; const sm=1-Math.exp(-1/(sampleRate*0.0015));
    for(let i=0;i<n;i++){ const t=t0+i, slot=Math.floor(t/spb), ph=(t/spb)%1;
      for(let c=0;c<out.length;c++){ const x=inp&&inp.length?(inp[c]||inp[0])[i]:0; this.buf[c&1][this.w]=x; }
      if(slot!==this.slot){ this.slot=slot; if(mode===1 && (slot%4===0)) this.st=this.w; }
      let tgt=1; if(mode===0) tgt=ph<duty?1:0; this.g+= (tgt-this.g)*sm;
      for(let c=0;c<out.length;c++){ const b=this.buf[c&1], x=inp&&inp.length?(inp[c]||inp[0])[i]:0; let y;
        if(mode===0) y=x*this.g;
        else { const L=Math.max(64,Math.floor(spb*duty)), k=Math.floor(ph*spb); const w=Math.min(1,k/64,(L-k)/64); y = k<L ? b[(this.st+k)%this.S]*Math.max(0,w) : 0; }
        out[c][i]=x*(1-mix)+y*mix; }
      this.w=(this.w+1)%this.S; }
    return true; }
}

// ---------- Auto swell: fades each new note in, like a volume pedal ----------
class SwellProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors(){ const k='k-rate'; return [ {name:'thr', defaultValue:-40, minValue:-80, maxValue:-10, automationRate:k}, {name:'attack', defaultValue:400, minValue:20, maxValue:3000, automationRate:k} ]; }
  constructor(){ super(); onKill(this); this.env=0; this.g=0; this.quiet=0; this.armed=true; }
  process(inputs, outputs, p){ if(this.dead) return false; const inp=inputs[0], out=outputs[0], n=out[0].length; if(!inp||!inp.length){ for(const o of out) o.fill(0); return true; }
    const thr=Math.pow(10,p.thr[0]/20), up=1/(sampleRate*p.attack[0]/1000), er=Math.exp(-1/(sampleRate*0.02));
    for(let i=0;i<n;i++){ let a=0; for(let c=0;c<inp.length;c++){ const v=Math.abs(inp[c][i]); if(v>a) a=v; } this.env=a>this.env?a:this.env*er;
      if(this.env<thr*0.5){ if(++this.quiet>sampleRate*0.04){ this.armed=true; this.g=Math.max(0,this.g-1/(sampleRate*0.03)); } } else this.quiet=0;
      if(this.env>thr){ if(this.armed && this.g>0.98) this.armed=false; this.g=Math.min(1,this.g+up); }
      const gg=this.g*this.g; for(let c=0;c<out.length;c++) out[c][i]=(inp[c]||inp[0])[i]*gg; }
    return true; }
}

registerProcessor('np-comp', CompProcessor);
registerProcessor('np-shaper', ShaperProcessor);
registerProcessor('np-limit', LimitProcessor);
registerProcessor('np-revdelay', RevDelayProcessor);
registerProcessor('np-freeze', FreezeProcessor);
registerProcessor('np-vowel', VowelProcessor);
registerProcessor('np-stutter', StutterProcessor);
registerProcessor('np-swell', SwellProcessor);
