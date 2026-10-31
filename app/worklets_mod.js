// ===== Neon Peach 2.4 worklets: the mod pedal models =====
// Every processor here has a C++ twin in native/src/procs_mod.cpp. Keep them in step: the golden test compares them sample by sample.
// Why worklets for the flanger and phaser: their feedback must come back one sample later, like the real circuit. A feedback loop drawn
// with nodes comes back one render block later, and that block is 128 samples in Chrome but the device buffer in the native engine,
// so the comb peaks land in different places. Inside a worklet the loop is one sample long in both engines.

// ---------- BBD flanger: one delay line with the feedback, the BBD lowpass and a soft clip all inside the loop ----------
// model 0 Mistress: slow rounded sweep, dark BBD, feedback stops at 0.8. model 1 ADA: wider sweep, brighter, feedback up to 0.95.
// model 2 Through-Zero: the dry side waits Manual ms and the wet side sweeps across it. With Negative polarity they cancel at the crossing. That is the jet.
class FlangerProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors(){ const k='k-rate'; return [
    {name:'rate', defaultValue:0.3, minValue:0.02, maxValue:10, automationRate:k},
    {name:'depth', defaultValue:0.6, minValue:0, maxValue:1, automationRate:k},
    {name:'fb', defaultValue:0.5, minValue:-0.97, maxValue:0.97, automationRate:k},
    {name:'manual', defaultValue:2, minValue:0.1, maxValue:20, automationRate:k},
    {name:'mix', defaultValue:0.5, minValue:0, maxValue:1, automationRate:k},
    {name:'model', defaultValue:0, minValue:0, maxValue:2, automationRate:k},
    {name:'polarity', defaultValue:0, minValue:0, maxValue:1, automationRate:k} ]; }
  constructor(){ super(); onKill(this); this.S=8192; this.mask=this.S-1; this.buf=[new Float64Array(this.S), new Float64Array(this.S)]; this.dry=[new Float64Array(this.S), new Float64Array(this.S)];
    this.w=0; this.ph=0; this.lpz=[0,0]; this.cS=-1; }
  process(inputs, outputs, p){
    if(this.dead) return false; const inp=inputs[0], out=outputs[0]; if(!inp||!inp.length) return true;
    const n=inp[0].length, nc=Math.min(out.length,2), sr=sampleRate, model=p.model[0]|0;
    const fbMax=[0.8,0.95,0.85][model], lpHz=[6000,9000,10000][model], oct=p.depth[0]*[1.4,1.8,0][model], lin=model===2 ? p.depth[0]*0.95 : 0;
    const center=p.manual[0]*0.001*sr, a=1-Math.exp(-2*Math.PI*lpHz/sr), inc=p.rate[0]/sr;
    const fb=Math.max(-fbMax, Math.min(fbMax, p.fb[0])), mix=p.mix[0], wetG=mix*(1-0.5*Math.abs(fb))*(p.polarity[0]>0.5?-1:1), dryG=1-mix;
    if(this.cS<0) this.cS=center;   // first block: start at the real setting, no glide in from zero
    let w=this.w, ph=this.ph, cS=this.cS;
    for(let i=0;i<n;i++){
      ph+=inc; if(ph>=1) ph-=1; const tri=ph<0.5 ? 4*ph-1 : 3-4*ph; const lfo=model===0 ? tri*(1.5-0.5*tri*tri) : tri;   // the Mistress rounds the turnarounds
      cS+=(center-cS)*0.002;   // a Manual move glides, the LFO itself does not
      let del=model===2 ? cS*(1+lin*lfo) : cS*Math.pow(2, oct*lfo); if(del<2) del=2; let rp=w-del; if(rp<0) rp+=this.S; const ri=rp|0, rf=rp-ri, rj=(ri+1)&this.mask;
      let dd=cS; if(dd<2) dd=2; let dp=w-dd; if(dp<0) dp+=this.S; const di=dp|0, df=dp-di, dj=(di+1)&this.mask;
      for(let c=0;c<nc;c++){
        const b=this.buf[c], x=(inp[c]||inp[0])[i];
        const y=b[ri]*(1-rf)+b[rj]*rf; const z=this.lpz[c]+a*(y-this.lpz[c]); this.lpz[c]=z;   // the BBD lowpass sits inside the loop
        const v=x+fb*z; b[w]=Math.tanh(v*0.8)/0.8; this.dry[c][w]=x;                             // soft clip in the loop, like the compander
        const dry=model===2 ? this.dry[c][di]*(1-df)+this.dry[c][dj]*df : x;
        out[c][i]=dry*dryG+z*wetG; }
      w=(w+1)&this.mask; }
    this.w=w; this.ph=ph; this.cS=cS; return true; }
}

// ---------- Phaser: first-order allpass stages, swept in octaves, with one-sample feedback ----------
// model 0 Phase 90: matched stages, triangle sweep, light feedback. model 1 Small Stone: rounder, wider sweep; Color adds regeneration.
// model 2 Univibe: the four stages sit at different frequencies, and the LFO is a lamp seen by photocells: dim most of the time, a sharp flash once a cycle.
class PhaserProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors(){ const k='k-rate'; return [
    {name:'rate', defaultValue:0.5, minValue:0.02, maxValue:12, automationRate:k},
    {name:'depth', defaultValue:0.7, minValue:0, maxValue:1, automationRate:k},
    {name:'center', defaultValue:600, minValue:50, maxValue:5000, automationRate:k},
    {name:'stages', defaultValue:4, minValue:2, maxValue:8, automationRate:k},
    {name:'fb', defaultValue:0.3, minValue:0, maxValue:1, automationRate:k},
    {name:'mix', defaultValue:0.5, minValue:0, maxValue:1, automationRate:k},
    {name:'model', defaultValue:0, minValue:0, maxValue:2, automationRate:k},
    {name:'color', defaultValue:0, minValue:0, maxValue:1, automationRate:k} ]; }
  constructor(){ super(); onKill(this); this.x1=[new Float64Array(8), new Float64Array(8)]; this.y1=[new Float64Array(8), new Float64Array(8)]; this.a=new Float64Array(8); this.yp=[0,0]; this.ph=0; this.lamp=0; this.cC=-1; }
  process(inputs, outputs, p){
    if(this.dead) return false; const inp=inputs[0], out=outputs[0]; if(!inp||!inp.length) return true;
    const n=inp[0].length, nc=Math.min(out.length,2), sr=sampleRate, model=p.model[0]|0, st=Math.max(2,Math.min(8,Math.round(p.stages[0]/2)*2)), center=p.center[0], inc=p.rate[0]/sr;
    const oct=p.depth[0]*(model===1?2.0:1.6), g=Math.min(0.92, p.fb[0]*0.8+(model===1&&p.color[0]>0.5?0.7:0));
    // mix: dry and wet add up to one, so mix 50 gives the deepest notches; the whole thing is pulled back a little as mix rises because allpass chains grow peaks
    const mix=p.mix[0], trim=1-0.25*mix, wetG=mix*(1-0.5*g)*trim, dryG=(1-mix)*trim;
    const aUp=1-Math.exp(-1/(sr*0.003)), aDn=1-Math.exp(-1/(sr*0.04)), fmax=sr*0.45;
    const R=model===2 ? [0.3,1,3.2,10,0.3,1,3.2,10] : [1,1,1,1,1,1,1,1];
    if(this.cC<0) this.cC=center;
    let ph=this.ph, lamp=this.lamp, cC=this.cC; const a=this.a;
    for(let i=0;i<n;i++){
      ph+=inc; if(ph>=1) ph-=1; cC+=(center-cC)*0.002;
      let l; if(model===2){ const u=(1+Math.sin(2*Math.PI*ph))/2, bb=u*u*u; lamp+=(bb-lamp)*(bb>lamp?aUp:aDn); l=2.4*lamp-0.9; if(l>1) l=1; }
      else { const tri=ph<0.5 ? 4*ph-1 : 3-4*ph; l=model===1 ? tri*(1.5-0.5*tri*tri) : tri; }
      const sw=Math.pow(2, oct*l);
      for(let s=0;s<st;s++){ let f=cC*R[s]*sw; if(f>fmax) f=fmax; if(f<20) f=20; const t=Math.tan(Math.PI*f/sr); a[s]=(t-1)/(t+1); }
      for(let c=0;c<nc;c++){ const x=(inp[c]||inp[0])[i], X=this.x1[c], Y=this.y1[c]; let v=x+g*this.yp[c];
        for(let s=0;s<st;s++){ const y=a[s]*v+X[s]-a[s]*Y[s]; X[s]=v; Y[s]=y; v=y; }
        this.yp[c]=v; out[c][i]=x*dryG+v*wetG; } }
    this.ph=ph; this.lamp=lamp; this.cC=cC; return true; }
}

// ---------- Bit crusher 2: the old crusher plus a lowpass before and after the downsampler, so it can do clean lo-fi as well as harsh ----------
class Crusher2Processor extends AudioWorkletProcessor {
  static get parameterDescriptors(){ return [
    {name:'bits', defaultValue:8, minValue:2, maxValue:16},
    {name:'rate', defaultValue:1, minValue:1, maxValue:64},
    {name:'mix', defaultValue:1, minValue:0, maxValue:1},
    {name:'filter', defaultValue:0, minValue:0, maxValue:1} ]; }
  constructor(){ super(); this.cnt=0; this.hold=[0,0]; this.z=new Float64Array(16); onKill(this); }   // z: pre and post filter state, 4 doubles each, per channel
  process(inputs, outputs, p){
    if(this.dead) return false; const inp=inputs[0], out=outputs[0]; if(!inp||!inp.length) return true;
    const n=inp[0].length, steps=Math.pow(2,p.bits[0]), rate=p.rate[0]|0, mix=p.mix[0], filt=p.filter[0]>0.5, z=this.z;
    // Butterworth lowpass a little under the new Nyquist (half the downsampled rate)
    const w0=2*Math.PI*Math.min(0.42/rate, 0.45), sn=Math.sin(w0), cs=Math.cos(w0), al=sn/(2*0.7071), a0=1+al;
    const b0=(1-cs)/2/a0, b1=(1-cs)/a0, a1=-2*cs/a0, a2=(1-al)/a0;
    for(let i=0;i<n;i++){
      this.cnt++; const take = this.cnt>=rate; if(take) this.cnt=0;
      for(let c=0;c<out.length;c++){
        let x=(inp[c]||inp[0])[i]; const k=c&1, o=k*8;
        if(filt){ const y=b0*x+b1*z[o]+b0*z[o+1]-a1*z[o+2]-a2*z[o+3]; z[o+1]=z[o]; z[o]=x; z[o+3]=z[o+2]; z[o+2]=y; x=y; }
        if(take) this.hold[k]=Math.round(x*steps)/steps;
        let h=this.hold[k];
        if(filt){ const y=b0*h+b1*z[o+4]+b0*z[o+5]-a1*z[o+6]-a2*z[o+7]; z[o+5]=z[o+4]; z[o+4]=h; z[o+7]=z[o+6]; z[o+6]=y; h=y; }
        out[c][i]=h*mix + x*(1-mix);
      }
    }
    return true;
  }
}

registerProcessor('np-flanger', FlangerProcessor);
registerProcessor('np-phaser', PhaserProcessor);
registerProcessor('np-crusher2', Crusher2Processor);
