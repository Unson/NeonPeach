// ===== Neon Peach 2.4 worklets: the dyn pedal models =====
// Every processor here has a C++ twin in native/src/procs_dyn.cpp. Keep them in step: the golden test compares them sample by sample.
// All of these add no delay. No look-ahead anywhere.

// One step of a 2-pole state-variable filter (Zavalishin TPT). st holds ic1, ic2 and gets lp, bp (raw, peak gain 1/k) and hp.
// g = tan(pi*fc/sr), k = 1/Q. A k just under zero makes it ring on its own.
function dynSvf(st, x, g, k){ const a1=1/(1+g*(g+k)), a2=g*a1, a3=g*a2, v3=x-st.ic2, v1=a1*st.ic1+a2*v3, v2=st.ic2+a2*st.ic1+a3*v3;
  st.ic1=2*v1-st.ic1; st.ic2=2*v2-st.ic2; st.lp=v2; st.bp=v1; st.hp=x-k*v1-v2; }
function dynSvfG(fc){ return Math.tan(Math.PI*clamp(fc,10,sampleRate*0.45)/sampleRate); }
// a gentle OTA-style input stage: tanh with the gain set so a 0.35 peak comes out at 0.35 again. As kd goes to zero it becomes a straight wire.
function dynOtaNrm(kd){ return 0.35/Math.tanh(0.35*kd); }
function dynOta(x, kd, nrm){ return Math.tanh(kd*x)*nrm; }

// ---------- Super Squeeze: four compressor circuits ----------
// 0 OTA (Dyna Comp): feedback detector, gain smoothed in the linear domain (the cap on the OTA), ratio runs double, release three times the knob, a little CA3080 grit. Squashy sustain, pumps when pushed.
// 1 Opto (LA-2A): soft knee, attack no faster than 3 ms, two-stage release. A slow memory part charges while it squashes and lets go slowly after.
// 2 FET (1176): feedback detector, attack ten times faster than the knob, bites when pushed.
// 3 VCA: feed-forward, clean. The same math as np-comp, so old presets sound the same.
class PCompProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors(){ const k='k-rate'; return [
    {name:'threshold', defaultValue:-22, minValue:-80, maxValue:0, automationRate:k},
    {name:'ratio', defaultValue:4, minValue:1, maxValue:100, automationRate:k},
    {name:'attack', defaultValue:8, minValue:0.05, maxValue:200, automationRate:k},
    {name:'release', defaultValue:120, minValue:5, maxValue:3000, automationRate:k},
    {name:'knee', defaultValue:8, minValue:0, maxValue:30, automationRate:k},
    {name:'makeup', defaultValue:4, minValue:-24, maxValue:36, automationRate:k},
    {name:'mix', defaultValue:1, minValue:0, maxValue:1, automationRate:k},
    {name:'schpf', defaultValue:80, minValue:10, maxValue:1000, automationRate:k},
    {name:'rms', defaultValue:0, minValue:0, maxValue:1, automationRate:k},
    {name:'auto', defaultValue:1, minValue:0, maxValue:1, automationRate:k},
    {name:'type', defaultValue:3, minValue:0, maxValue:3, automationRate:k} ]; }
  constructor(){ super(); onKill(this); this.env=0; this.e2=0; this.gl=1; this.hz=0; this.hx=0; this.ms=0; this.minGr=0; this.tick=0; }
  process(inputs, outputs, p){
    if(this.dead) return false; const inp=inputs[0], out=outputs[0]; if(!inp||!inp.length) return true;
    const n=inp[0].length, nc=out.length, type=Math.round(p.type[0]), T=p.threshold[0], R0=Math.max(1,p.ratio[0]), mix=p.mix[0], rms=p.rms[0]>0.5;
    const R = type===0 ? 1+(R0-1)*2 : R0;                                   // the OTA squashes about twice as hard as its knob says
    const W = type===1 ? Math.max(p.knee[0],10) : p.knee[0];                 // the photocell always has a soft knee
    const mk=Math.pow(10,(p.makeup[0]+p.auto[0]*0.6*Math.max(0,-T)*(1-1/R0))/20);   // auto: the make-up the browser's own compressor added, so old presets keep their level
    let atkMs=p.attack[0], relMs=p.release[0]; if(type===1) atkMs=Math.max(atkMs,3); else if(type===2) atkMs*=0.1; else if(type===0) relMs*=3;
    const fb = type===0||type===2;                                           // these two listen to their own output
    const aA=Math.exp(-1/(sampleRate*atkMs/1000)), aR=Math.exp(-1/(sampleRate*relMs/1000)), hp=Math.exp(-2*Math.PI*p.schpf[0]/sampleRate), aM=Math.exp(-1/(sampleRate*0.01));
    const cA = fb ? Math.min(1-aA, 1/R) : 1-aA, cR=1-aR;                     // a feedback loop can only move so fast per sample and stay stable
    const cM=1-Math.exp(-1/(sampleRate*relMs*4/1000)), cM2=1-Math.exp(-1/(sampleRate*relMs*10/1000));   // opto memory: charges slowly, lets go slower
    const sl=1/R-1;
    for(let i=0;i<n;i++){
      let s=0; for(let c=0;c<inp.length;c++) s+=inp[c][i]; s/=inp.length;
      const h=hp*(this.hz+s-this.hx); this.hx=s; this.hz=h;                 // one-pole high-pass on the detector only
      let lv; if(rms){ this.ms=aM*this.ms+(1-aM)*h*h; lv=Math.sqrt(this.ms)*1.414; } else lv=Math.abs(h);
      if(fb) lv*=this.gl;                                                    // feedback: the detector hears the compressed sound
      const x=20*Math.log10(lv+1e-9); let y;
      const d=x-T; if(2*d < -W) y=x; else if(W>0 && 2*Math.abs(d)<=W){ const q=d+W/2; y=x+sl*q*q/(2*W); } else y=T+d/R;
      let tgt=y-x; if(fb) tgt*=R;                                            // in a feedback loop the law is steeper; the loop settles at the same ratio
      let env;
      if(type===0){ const gt=Math.pow(10,tgt/20); this.gl = gt<this.gl ? this.gl+cA*(gt-this.gl) : this.gl+cR*(gt-this.gl); env=20*Math.log10(this.gl); }   // linear domain: the cap on the OTA
      else if(type===1){ let e1=this.env-this.e2;
        if(tgt<this.env){ e1+=cA*(tgt-this.env); this.e2+=cM*(0.5*this.env-this.e2); }                                     // squashing: memory charges toward half the reduction
        else { this.e2+=cM2*(0.5*tgt-this.e2); const t1=Math.min(0,tgt-this.e2); e1+=cR*(t1-e1); }                          // letting go: the fast half first, the memory crawls back
        this.env=e1+this.e2; env=this.env; this.gl=Math.pow(10,env/20); }
      else { this.env = tgt<this.env ? this.env+cA*(tgt-this.env) : this.env+cR*(tgt-this.env); env=this.env; this.gl=Math.pow(10,env/20); }
      if(env<this.minGr) this.minGr=env;
      const g=this.gl*mk;
      for(let c=0;c<nc;c++){ const xx=(inp[c]||inp[0])[i]; let yy=xx*g; if(type===0) yy=Math.tanh(yy*0.4)/0.4; else if(type===2) yy=Math.tanh(yy*0.3)/0.3; out[c][i]=yy*mix+xx*(1-mix); }
    }
    this.tick+=n; if(this.tick>sampleRate/30){ this.tick=0; this.port.postMessage({gr:this.minGr}); this.minGr=0; }
    return true; }
}

// ---------- Peach Gate: NS-2 style ----------
// Opens above Threshold, closes only once the sound falls Hysteresis dB under it and stays there for Hold. The detector is slow enough
// that a low note's own wobble never flips it. Decay 0 shuts the gate to Range; at 100 the gain follows the note down (4 dB for each dB under the close level).
class PGateProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors(){ const k='k-rate'; return [
    {name:'threshold', defaultValue:-55, minValue:-90, maxValue:0, automationRate:k},
    {name:'attack', defaultValue:1, minValue:0.1, maxValue:100, automationRate:k},
    {name:'release', defaultValue:120, minValue:5, maxValue:2000, automationRate:k},
    {name:'hold', defaultValue:40, minValue:0, maxValue:1000, automationRate:k},
    {name:'range', defaultValue:-80, minValue:-90, maxValue:0, automationRate:k},
    {name:'hyst', defaultValue:6, minValue:0, maxValue:20, automationRate:k},
    {name:'decay', defaultValue:0, minValue:0, maxValue:100, automationRate:k} ]; }
  constructor(){ super(); onKill(this); this.env=0; this.g=0; this.hold=0; this.open=false; }
  process(inputs, outputs, p){
    if(this.dead) return false; const inp=inputs[0], out=outputs[0]; if(!inp||!inp.length) return true;
    const n=inp[0].length, thrO=Math.pow(10,p.threshold[0]/20), cdB=p.threshold[0]-p.hyst[0], thrC=Math.pow(10,cdB/20), rdB=p.range[0], d=p.decay[0]/100;
    const envRel=Math.exp(-1/(sampleRate*0.06)), atk=Math.exp(-1/(sampleRate*p.attack[0]/1000)), rel=Math.exp(-1/(sampleRate*p.release[0]/1000)), holdS=sampleRate*p.hold[0]/1000;
    for(let i=0;i<n;i++){
      let a=0; for(let c=0;c<inp.length;c++){ const v=Math.abs(inp[c][i]); if(v>a) a=v; }
      this.env = a>this.env ? a : this.env*envRel;
      if(this.env>thrO){ this.open=true; this.hold=holdS; } else if(this.env<thrC){ if(this.hold>0) this.hold--; else this.open=false; }
      let tg; if(this.open) tg=1; else { const eDB=Math.max(rdB, Math.min(0, 4*(20*Math.log10(this.env+1e-9)-cdB))); tg=Math.pow(10,(rdB*(1-d)+eDB*d)/20); }
      this.g = tg>this.g ? tg+(this.g-tg)*atk : tg+(this.g-tg)*rel;
      for(let c=0;c<out.length;c++) out[c][i]=(inp[c]||inp[0])[i]*this.g;
    }
    return true; }
}

// ---------- Brickwall: no look-ahead. Fast gain plus a soft safety clip at the ceiling ----------
// Hard is the old limiter exactly. Soft eases in from 3 dB under the ceiling and, after a long squash, lets go up to three times slower.
class PLimitProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors(){ const k='k-rate'; return [ {name:'ceiling', defaultValue:-1, minValue:-30, maxValue:0, automationRate:k}, {name:'release', defaultValue:80, minValue:5, maxValue:2000, automationRate:k}, {name:'input', defaultValue:0, minValue:-24, maxValue:36, automationRate:k}, {name:'type', defaultValue:0, minValue:0, maxValue:1, automationRate:k} ]; }
  constructor(){ super(); onKill(this); this.env=0; this.minG=1; this.tick=0; this.hot=0; }
  process(inputs, outputs, p){ if(this.dead) return false; const inp=inputs[0], out=outputs[0]; if(!inp||!inp.length){ for(const o of out) o.fill(0); return true; }
    const n=out[0].length, cl=Math.pow(10,p.ceiling[0]/20), gi=Math.pow(10,p.input[0]/20), relMs=p.release[0], rel=Math.exp(-1/(sampleRate*relMs/1000)), atk=Math.exp(-1/(sampleRate*0.0004)), k=0.9*cl, r=cl-k, soft=p.type[0]>0.5;
    const cH=1-Math.exp(-1/(sampleRate*0.2)), cH2=1-Math.exp(-1/(sampleRate*1.0)), cdB=20*Math.log10(cl), W=6;
    for(let i=0;i<n;i++){ let pk=0; for(let c=0;c<inp.length;c++){ const v=Math.abs(inp[c][i]*gi); if(v>pk) pk=v; }
      let g;
      if(soft){ const rl=Math.exp(-1/(sampleRate*relMs*(1+2*this.hot)/1000)); this.env = pk>this.env ? atk*this.env+(1-atk)*pk : rl*this.env+(1-rl)*pk;
        const x=20*Math.log10(this.env+1e-9), dd=x-cdB; let y; if(2*dd < -W) y=x; else if(2*dd<=W){ const q=dd+W/2; y=x-q*q/(2*W); } else y=cdB;
        g=Math.pow(10,(y-x)/20); this.hot += g<0.999 ? cH*(1-this.hot) : -cH2*this.hot; }
      else { this.env = pk>this.env ? atk*this.env+(1-atk)*pk : rel*this.env+(1-rel)*pk; g=this.env>cl ? cl/this.env : 1; }
      if(g<this.minG) this.minG=g;
      for(let c=0;c<out.length;c++){ let v=(inp[c]||inp[0])[i]*gi*g; const a=Math.abs(v); if(a>k){ v=Math.sign(v)*(k+r*Math.tanh((a-k)/r)); } out[c][i]=v; } }
    this.tick+=n; if(this.tick>sampleRate/30){ this.tick=0; this.port.postMessage({gr:20*Math.log10(this.minG)}); this.minG=1; }
    return true; }
}

// ---------- Envelope Filter: Mutron III / Q-Tron style ----------
// A fast peak follower (its own attack and decay) sweeps a 2-pole state-variable filter. Reso near the top lets it ring on its own, held
// to a modest level by damping that grows with the resonance (like the OTA running out of headroom). Gain drives the input stage.
class PEnvFProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors(){ const k='k-rate'; return [
    {name:'sens', defaultValue:0.5, minValue:0, maxValue:1, automationRate:k},
    {name:'fmin', defaultValue:120, minValue:40, maxValue:2000, automationRate:k},
    {name:'range', defaultValue:0.7, minValue:0, maxValue:1, automationRate:k},
    {name:'q', defaultValue:4, minValue:0.5, maxValue:20, automationRate:k},
    {name:'attack', defaultValue:8, minValue:1, maxValue:200, automationRate:k},
    {name:'decay', defaultValue:180, minValue:10, maxValue:1500, automationRate:k},
    {name:'type', defaultValue:0, minValue:0, maxValue:2, automationRate:k},
    {name:'dir', defaultValue:0, minValue:0, maxValue:1, automationRate:k},
    {name:'mix', defaultValue:1, minValue:0, maxValue:1, automationRate:k},
    {name:'gain', defaultValue:0, minValue:0, maxValue:100, automationRate:k} ]; }
  constructor(){ super(); onKill(this); this.env=0; this.sm=0; this.f=[{ic1:0,ic2:0,lp:0,bp:0,hp:0},{ic1:0,ic2:0,lp:0,bp:0,hp:0}]; }
  process(inputs, outputs, p){
    if(this.dead) return false; const inp=inputs[0], out=outputs[0]; if(!inp||!inp.length) return true;
    const n=inp[0].length, atk=Math.exp(-1/(sampleRate*p.attack[0]/1000)), dec=Math.exp(-1/(sampleRate*p.decay[0]/1000));
    const fmin=p.fmin[0], fmax=Math.min(fmin*Math.pow(40,p.range[0]), 9000), q=p.q[0], type=Math.round(p.type[0]), dir=p.dir[0], mix=p.mix[0], sens=Math.pow(10, p.sens[0]*3);
    const qn=q/20, k0=1/q-0.08*Math.pow(qn,8), kn=0.15*qn*qn;                 // damping: just under zero at the very top of Reso, so it can sing; kn is how fast loud ringing damps itself
    const drv=p.gain[0], kd=drv/100*6, nrm=drv>0?dynOtaNrm(kd):1;
    for(let i=0;i<n;i++){
      let a=0; for(let c=0;c<inp.length;c++){ const v=Math.abs(inp[c][i]); if(v>a) a=v; }
      this.env = a>this.env ? a+(this.env-a)*atk : a+(this.env-a)*dec;
      let e=clamp(this.env*sens*0.3,0,1); e=Math.sqrt(e); if(dir>0.5) e=1-e;
      const fc=fmin*Math.pow(fmax/fmin,e); this.sm += 0.02*(fc-this.sm);
      const g=dynSvfG(this.sm);
      for(let c=0;c<out.length;c++){ const x=(inp[c]||inp[0])[i], st=this.f[c<2?c:0]; const xd = drv>0 ? dynOta(x,kd,nrm) : x;
        dynSvf(st, xd, g, k0+kn*st.ic1*st.ic1);                             // the louder it rings, the more it damps itself
        const y = type===0?st.lp:(type===1?st.bp*1.5:st.hp);
        out[c][i]=y*mix + x*(1-mix); }
    }
    return true; }
}

// ---------- Pedal Wah: Cry Baby / Bass 105Q / Vox ----------
// The inductor wah: a resonant peak that sweeps, a low-pass behind it, and some gain at the peak. Swept per sample so pedal moves are smooth.
// The peak gets narrower toward the toe, like the real thing.
const DYN_WAH=[ {fs:1, qs:1, lpg:0.5, bpg:1.0, hpg:0, og:0.45}, {fs:0.75, qs:0.8, lpg:1.0, bpg:0.6, hpg:0, og:0.6}, {fs:1.15, qs:1.25, lpg:0.35, bpg:1.1, hpg:0.25, og:0.4} ];   // Cry Baby, Bass 105Q, Vox: sweep scale, width scale, how much low-pass / peak / top, output
class WahProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors(){ const k='k-rate'; return [
    {name:'pos', defaultValue:0.5, minValue:0, maxValue:1, automationRate:k},
    {name:'q', defaultValue:5, minValue:0.5, maxValue:15, automationRate:k},
    {name:'fmin', defaultValue:350, minValue:100, maxValue:1000, automationRate:k},
    {name:'fmax', defaultValue:2200, minValue:800, maxValue:5000, automationRate:k},
    {name:'mix', defaultValue:1, minValue:0, maxValue:1, automationRate:k},
    {name:'model', defaultValue:0, minValue:0, maxValue:2, automationRate:k} ]; }
  constructor(){ super(); onKill(this); this.ps=0.5; this.f=[{ic1:0,ic2:0,lp:0,bp:0,hp:0},{ic1:0,ic2:0,lp:0,bp:0,hp:0}]; }
  process(inputs, outputs, p){
    if(this.dead) return false; const inp=inputs[0], out=outputs[0]; if(!inp||!inp.length) return true;
    const n=inp[0].length, m=DYN_WAH[Math.max(0,Math.min(2,Math.round(p.model[0])))], pos=p.pos[0], q=p.q[0], fmin=p.fmin[0], fmax=Math.max(p.fmax[0],fmin*1.01), mix=p.mix[0], cp=1-Math.exp(-1/(sampleRate*0.004));
    for(let i=0;i<n;i++){
      this.ps += cp*(pos-this.ps);
      const fc=fmin*Math.pow(fmax/fmin,this.ps)*m.fs, g=dynSvfG(fc), k=1/(q*m.qs*(0.7+0.6*this.ps));
      for(let c=0;c<out.length;c++){ const x=(inp[c]||inp[0])[i], st=this.f[c<2?c:0]; dynSvf(st, x, g, k);
        const y=(st.lp*m.lpg + st.bp*m.bpg + st.hp*m.hpg)*m.og; out[c][i]=y*mix + x*(1-mix); }
    }
    return true; }
}

// ---------- Multi Filter: clean SVF or a Moog-style ladder ----------
// SVF: 2-pole, LP/HP/BP/Notch. For LP and HP the Reso knob is in dB like the old biquad, so old presets sound the same.
// Ladder: four one-pole stages with tanh in each, 2x oversampled, feedback from the last stage. Near max Reso it sings on its own.
class LadderProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors(){ const k='k-rate'; return [
    {name:'type', defaultValue:0, minValue:0, maxValue:3, automationRate:k},
    {name:'freq', defaultValue:800, minValue:40, maxValue:12000, automationRate:k},
    {name:'q', defaultValue:1, minValue:0.3, maxValue:20, automationRate:k},
    {name:'mix', defaultValue:1, minValue:0, maxValue:1, automationRate:k},
    {name:'model', defaultValue:0, minValue:0, maxValue:1, automationRate:k},
    {name:'drive', defaultValue:0, minValue:0, maxValue:100, automationRate:k} ]; }
  constructor(){ super(); onKill(this); this.sf=800; this.f=[{ic1:0,ic2:0,lp:0,bp:0,hp:0},{ic1:0,ic2:0,lp:0,bp:0,hp:0}]; this.l=[{s1:0,s2:0,s3:0,s4:0,t1:0,t2:0,t3:0,t4:0,s4p:0,u:0},{s1:0,s2:0,s3:0,s4:0,t1:0,t2:0,t3:0,t4:0,s4p:0,u:0}]; }
  process(inputs, outputs, p){
    if(this.dead) return false; const inp=inputs[0], out=outputs[0]; if(!inp||!inp.length) return true;
    const n=inp[0].length, type=Math.round(p.type[0]), freq=p.freq[0], q=p.q[0], mix=p.mix[0], ladder=p.model[0]>0.5, drv=p.drive[0], kd=drv/100*6, nrm=drv>0?dynOtaNrm(kd):1, cf=1-Math.exp(-1/(sampleRate*0.002));
    const kS = 1/(type<2 ? Math.pow(10,q/20) : q);                           // SVF damping
    const r=clamp((q-0.3)/19.7,0,1), kL=4.2*r, comp=1+kL*0.35;               // ladder feedback and the bass it gives back
    for(let i=0;i<n;i++){
      this.sf += cf*(freq-this.sf);
      for(let c=0;c<out.length;c++){ const x=(inp[c]||inp[0])[i]; const xd = drv>0 ? dynOta(x,kd,nrm) : x; let y;
        if(ladder){ const L=this.l[c<2?c:0], fc=clamp(this.sf,20,sampleRate*0.22), gL=1-Math.exp(-Math.PI*fc/sampleRate);   // two half-steps per sample
          for(let s=0;s<2;s++){ const u=xd-kL*0.5*(L.s4+L.s4p); L.u=u; L.s4p=L.s4; const t0=Math.tanh(u);
            L.s1+=gL*(t0-L.t1); L.t1=Math.tanh(L.s1); L.s2+=gL*(L.t1-L.t2); L.t2=Math.tanh(L.s2); L.s3+=gL*(L.t2-L.t3); L.t3=Math.tanh(L.s3); L.s4+=gL*(L.t3-L.t4); L.t4=Math.tanh(L.s4); }
          y = type===0 ? L.s4 : type===1 ? L.u-4*L.s1+6*L.s2-4*L.s3+L.s4 : type===2 ? 4*(L.s2-2*L.s3+L.s4) : L.u-2*L.s1+2*L.s2; y*=comp; }   // Oberheim pole mixing for the other shapes
        else { const st=this.f[c<2?c:0]; dynSvf(st, xd, dynSvfG(this.sf), kS); y = type===0 ? st.lp : type===1 ? st.hp : type===2 ? kS*st.bp : xd-kS*st.bp; }
        out[c][i]=y*mix + x*(1-mix); }
    }
    return true; }
}

registerProcessor('np-pcomp', PCompProcessor);
registerProcessor('np-pgate', PGateProcessor);
registerProcessor('np-plimit', PLimitProcessor);
registerProcessor('np-penvf', PEnvFProcessor);
registerProcessor('np-wah', WahProcessor);
registerProcessor('np-ladder', LadderProcessor);
