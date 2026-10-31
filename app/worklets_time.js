// ===== Neon Peach 2.4 worklets: the time pedal models =====
// Every processor here has a C++ twin in native/src/procs_time.cpp. Keep them in step: the golden test compares them sample by sample.
// np-delay: the four delay machines. np-taps: the multi-tap. np-verb: an 8-line feedback delay network reverb with a spring mode. np-oc2: a Boss OC-2 style sub octave. np-pitch2: a two-grain shifter that splices where the waves line up.

// The next prime at or above n. Delay lines with prime lengths never share a ring.
function primeAbove(n){ n=Math.max(2,Math.round(n)); for(;;n++){ let ok=true; for(let d=2;d*d<=n;d++){ if(n%d===0){ ok=false; break; } } if(ok) return n; } }
// A delay line read with linear interpolation. d is the delay in samples (fractional), w the write index, S the size.
function tapRead(b, w, d, S){ let r=w-d; if(r<0) r+=S; const i0=r|0, f=r-i0; let i1=i0+1; if(i1>=S) i1-=S; return b[i0]*(1-f)+b[i1]*f; }

// Deterministic noise: the same seed in both engines gives the same hiss.
function lcg(s){ return (Math.imul(s,1664525)+1013904223)>>>0; }

// ---------- Delay: four machines in one processor ----------
// The feedback loop lives in here, not in the node graph, so both engines repeat at exactly the same time.
// Digital: clean, with an optional 12-bit / 12 kHz lo-fi in the loop. Tape (EP-3 / RE-201): wow (0.42 Hz) and flutter (5.7 Hz) on the
// read head, a head bump at 110 Hz, tape saturation and hiss in the loop, highs that fade a little more each pass. Analog (DM-2 / Memory
// Man): a bucket-brigade chip with 4096 stages, so the clock slows and the anti-alias filter closes as the time grows; the repeats are
// sampled at that clock, soft clipped to one side, and get darker and grainier. Ping Pong: the digital machine bouncing left and right.
class DelayProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors(){ const k='k-rate'; return [
    {name:'type', defaultValue:0, minValue:0, maxValue:3, automationRate:k}, {name:'time', defaultValue:375, minValue:1, maxValue:3900, automationRate:k},
    {name:'fb', defaultValue:0.35, minValue:0, maxValue:1, automationRate:k}, {name:'lowcut', defaultValue:120, minValue:20, maxValue:1000, automationRate:k},
    {name:'highcut', defaultValue:5000, minValue:500, maxValue:12000, automationRate:k}, {name:'mod', defaultValue:0, minValue:0, maxValue:1, automationRate:k},
    {name:'age', defaultValue:0.25, minValue:0, maxValue:1, automationRate:k}, {name:'lofi', defaultValue:0, minValue:0, maxValue:1, automationRate:k} ]; }
  constructor(){ super(); onKill(this); this.S=Math.ceil(sampleRate*4.2); this.buf=[new Float32Array(this.S), new Float32Array(this.S)]; this.w=0; this.d=-1; this.ph1=0; this.ph2=0; this.seed=22222;
    this.hp=[0,0,0,0]; this.lp=[0,0,0,0,0,0,0,0,0,0]; this.bump=[new SVF(), new SVF()]; this.dc=[0,0]; this.acc=[0,0]; this.hold=[0,0]; this.cnt=0; this.qh=[0,0]; }
  process(inputs, outputs, p){
    if(this.dead) return false; const inp=inputs[0], out=outputs[0], n=out[0].length, S=this.S, sr=sampleRate, has=inp&&inp.length;
    const type=Math.round(p.type[0]), tape=type===1, analog=type===2, pp=type===3, age=p.age[0], mod=p.mod[0], lofi=p.lofi[0], ms=p.time[0];
    const target=Math.min(S-sr*0.3, ms*sr/1000); if(this.d<0) this.d=target; const dc=1-Math.exp(-1/(sr*0.05));
    const fbg=p.fb[0]*(tape||analog?1:0.95);
    // the loop filters: low cut (2 poles), high cut (2 poles, 2 more for analog, 1 more for tape), head bump, the BBD clock, tape hiss
    const chp=lpCoef(p.lowcut[0]), bw=analog ? Math.min(p.highcut[0], clamp(900000/ms,700,7000)) : p.highcut[0], clp=lpCoef(bw), clp2=lpCoef(tape?5500-2500*age:bw);
    const bumpG=tape?Math.pow(10,2.5*(0.5+age)/20)-1:0, clk=clamp(4096*1000/(2*ms),2500,40000)/sr, grit=analog?0.15+0.5*age:0, hiss=tape?0.0004*age:(analog?0.00015*age:0);
    const sg=tape?1+0.5*age:1, kt=tape?0.6+1.4*age:1, kb=0.8+1.5*age, bb=0.1+0.2*age, tb=Math.tanh(kb*bb), nb=kb*(1-tb*tb);
    const f1=tape?0.42:(analog?0.6:0.3), f2=tape?5.7:(analog?7.1:0.3), D1=mod*sr*(tape?0.0035*(0.6+0.8*age):(analog?0.002:0.0025)), D2=mod*sr*(tape?0.00014*(0.5+age):(analog?0.00006:0));
    const r1=2*Math.PI*f1/sr, r2=2*Math.PI*f2/sr, hp=this.hp, lp=this.lp, buf=this.buf;
    for(let i=0;i<n;i++){
      const xL=has?inp[0][i]:0, xR=has?(inp[1]||inp[0])[i]:0;
      this.d+=dc*(target-this.d); this.ph1+=r1; if(this.ph1>2*Math.PI) this.ph1-=2*Math.PI; this.ph2+=r2; if(this.ph2>2*Math.PI) this.ph2-=2*Math.PI;
      const tri=Math.abs(this.ph2/Math.PI-1)*2-1, rd=clamp(this.d+D1*Math.sin(this.ph1)+D2*tri, 1, S-2);
      const tL=tapRead(buf[0], this.w, rd, S), tR=tapRead(buf[1], this.w, rd, S);
      this.cnt++; const take=this.cnt>=4; if(take) this.cnt=0;
      // what goes onto the tape: the input plus the repeat coming round. Ping pong: the left side gets the input and the right side's repeat, the right side gets the left's.
      const pre0=pp ? 0.5*(xL+xR)+fbg*tR : xL+fbg*tL, pre1=pp ? tL : xR+fbg*tR;
      for(let c=0;c<2;c++){ let y=c?pre1:pre0; const o=c*2, o5=c*5;
        hp[o]+=chp*(y-hp[o]); y-=hp[o]; hp[o+1]+=chp*(y-hp[o+1]); y-=hp[o+1];                     // low cut
        if(analog){ this.acc[c]+=clk; if(this.acc[c]>=1){ this.acc[c]-=1; this.hold[c]=y; } y=y*(1-grit)+this.hold[c]*grit; }   // sampled at the BBD clock; the filters below smooth the steps
        lp[o5]+=clp*(y-lp[o5]); lp[o5+1]+=clp*(lp[o5]-lp[o5+1]); y=lp[o5+1];                        // high cut
        if(analog){ lp[o5+2]+=clp*(y-lp[o5+2]); lp[o5+3]+=clp*(lp[o5+2]-lp[o5+3]); y=lp[o5+3]; }     // the BBD filter tracks the clock: two more poles
        if(tape){ lp[o5+4]+=clp2*(y-lp[o5+4]); y=lp[o5+4]; y+=bumpG*this.bump[c].run(y,110,0.9).bp/0.9; }   // worn tape loses its top; the head bump
        if(!tape && !analog && lofi>0){ if(take) this.qh[c]=Math.round(y*2048)/2048; y=y*(1-lofi)+this.qh[c]*lofi; }            // 12 bits at 12 kHz
        if(hiss>0){ this.seed=lcg(this.seed); y+=(this.seed/4294967296-0.5)*hiss; }
        if(tape){ const u=y*sg; y=Math.tanh(kt*u)/(kt*sg); } else if(analog){ y=(Math.tanh(kb*(y+bb))-tb)/nb; } else { y=y/Math.pow(1+Math.pow(Math.abs(y)/1.2,8),0.125); }   // the machine's own clip
        this.dc[c]+=0.0005*(y-this.dc[c]); y-=this.dc[c];
        buf[c][this.w]=y; }
      this.w++; if(this.w>=S) this.w=0;
      out[0][i]=tL; if(out[1]) out[1][i]=tR;
    }
    return true; }
}

// ---------- Multi-tap: four taps off one line, feedback from the first ----------
const TAPS_MUL=[[1,2,3,4],[0.75,1.5,2.25,3],[2/3,4/3,2,8/3],[1,1.618,2.618,4.236]];
class TapsProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors(){ const k='k-rate'; return [
    {name:'time', defaultValue:250, minValue:1, maxValue:2000, automationRate:k}, {name:'fb', defaultValue:0.2, minValue:0, maxValue:0.95, automationRate:k},
    {name:'highcut', defaultValue:4000, minValue:500, maxValue:12000, automationRate:k}, {name:'spread', defaultValue:0.6, minValue:0, maxValue:1, automationRate:k},
    {name:'taps', defaultValue:3, minValue:1, maxValue:4, automationRate:k}, {name:'pattern', defaultValue:0, minValue:0, maxValue:3, automationRate:k} ]; }
  constructor(){ super(); onKill(this); this.S=Math.ceil(sampleRate*8.7); this.buf=new Float32Array(this.S); this.w=0; this.d=[-1,-1,-1,-1]; this.g=[-1,-1,-1,-1]; this.lp=0; }
  process(inputs, outputs, p){
    if(this.dead) return false; const inp=inputs[0], out=outputs[0], n=out[0].length, S=this.S, sr=sampleRate, has=inp&&inp.length;
    const mul=TAPS_MUL[Math.round(p.pattern[0])]||TAPS_MUL[0], taps=Math.round(p.taps[0]), fb=p.fb[0], clp=lpCoef(p.highcut[0]), dc=1-Math.exp(-1/(sr*0.05)), gc=1-Math.exp(-1/(sr*0.01)), spread=p.spread[0];
    const tg=[0,0,0,0], td=[0,0,0,0], pL=[0,0,0,0], pR=[0,0,0,0];
    for(let k=0;k<4;k++){ td[k]=Math.min(S-4, p.time[0]*sr/1000*mul[k]); tg[k]=k<taps?Math.pow(0.7,k):0; if(this.d[k]<0){ this.d[k]=td[k]; this.g[k]=tg[k]; } const pan=(k%2?1:-1)*spread*(k/3), a=(pan+1)*Math.PI/4; pL[k]=Math.cos(a); pR[k]=Math.sin(a); }
    const b=this.buf, d=this.d, g=this.g;
    for(let i=0;i<n;i++){
      const x=has?(inp.length>1?0.5*(inp[0][i]+inp[1][i]):inp[0][i]):0; let oL=0, oR=0, t0=0;
      for(let k=0;k<4;k++){ d[k]+=dc*(td[k]-d[k]); g[k]+=gc*(tg[k]-g[k]); const v=tapRead(b, this.w, d[k], S); if(k===0) t0=v; oL+=v*g[k]*pL[k]; oR+=v*g[k]*pR[k]; }
      this.lp+=clp*(t0-this.lp); b[this.w]=x+fb*this.lp; this.w++; if(this.w>=S) this.w=0;
      out[0][i]=oL; if(out[1]) out[1][i]=oR;
    }
    return true; }
}

// ---------- Reverb: feedback delay network, plus a spring tank ----------
// Six types. Room, Hall, Plate, Cathedral and Shimmer run 8 delay lines mixed by a Householder matrix, with a one-pole damper in each
// line, two lines slowly modulated, four diffusion allpasses on each input, early reflections tapped off the pre-delay. Spring runs three
// springs: a loop with a chain of stretched allpasses, so every echo chirps. Decay is RT60 in seconds: the time the tail takes to fall 60 dB.
// Per type: delay lines (ms), early taps (ms), early level, diffusion amount, damping (Hz), modulation depth (samples), input low cut (Hz), output level
const VERB_T=[
  {l:[13.7,17.9,21.1,25.3,29.9,34.7,39.1,44.3], er:[5.1,8.3,12.7,17.3,22.9,28.1], erg:0.9, dg:0.55, damp:6500, mod:5, hp:60, og:0.11},
  {l:[31.7,39.1,46.3,55.9,63.1,71.3,79.9,89.7], er:[11.3,17.9,24.1,31.7,39.3,47.1], erg:0.3, dg:0.72, damp:4000, mod:11, hp:45, og:0.14},
  {l:[9.7,12.1,14.3,17.9,21.1,24.7,28.3,33.1], er:[], erg:0, dg:0.8, damp:11000, mod:9, hp:80, og:0.05},
  {l:[13.7,17.9,21.1,25.3,29.9,34.7,39.1,44.3], er:[], erg:0, dg:0, damp:3000, mod:0, hp:90, og:0.8},
  {l:[59.3,71.9,83.1,97.7,109.3,121.1,137.9,149.3], er:[19.3,29.7,41.1,53.9,67.3,79.1], erg:0.25, dg:0.82, damp:1300, mod:14, hp:40, og:0.09},
  {l:[31.7,39.1,46.3,55.9,63.1,71.3,79.9,89.7], er:[11.3,17.9,24.1,31.7,39.3,47.1], erg:0.3, dg:0.72, damp:5000, mod:11, hp:45, og:0.13} ];
// The three springs: loop delay (ms), allpass stages, stretch (samples), allpass amount, loop low pass (Hz)
const SPRINGS=[{d:31,m:48,k:8,a:0.55,lp:3600},{d:37,m:56,k:9,a:0.57,lp:3000},{d:44,m:64,k:10,a:0.6,lp:2600}];   // a positive coefficient makes highs arrive later: the chirp rises, like a real spring
const AP_MS=[4.76,3.59,12.7,9.3];   // input diffusion allpass lengths (Dattorro); the right side runs 7% longer
class VerbProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors(){ const k='k-rate'; return [ {name:'type', defaultValue:1, minValue:0, maxValue:5, automationRate:k}, {name:'decay', defaultValue:2, minValue:0.2, maxValue:8, automationRate:k}, {name:'predelay', defaultValue:10, minValue:0, maxValue:200, automationRate:k}, {name:'damp', defaultValue:7000, minValue:500, maxValue:20000, automationRate:k} ]; }
  constructor(){ super(); onKill(this); const sr=sampleRate;
    this.SZ=16384; this.PS=32768; this.AS=2048; this.SS=8192;
    this.line=[]; for(let i=0;i<8;i++) this.line.push(new Float32Array(this.SZ)); this.w=0; this.L=new Float64Array(8); this.g=new Float64Array(8); this.lp=new Float64Array(8);
    this.pre=[new Float32Array(this.PS), new Float32Array(this.PS)]; this.pw=0;
    this.ap=[]; for(let i=0;i<8;i++) this.ap.push(new Float32Array(this.AS)); this.apL=new Int32Array(8); for(let i=0;i<8;i++) this.apL[i]=Math.min(this.AS-2, Math.round(sr*AP_MS[i&3]/1000*(i<4?1:1.07))); this.aw=0;
    this.hpz=[0,0]; this.ph=[0,0]; this.erT=new Float64Array(6); this.erN=0;
    // springs
    this.sp=SPRINGS.map(s=>({ buf:new Float32Array(this.SS), xs:new Float64Array(s.m*s.k), ys:new Float64Array(s.m*s.k), q:0, w:0, lp:0, hp:0, d:Math.min(this.SS-4, Math.round(sr*s.d/1000)), g:0, c:1-Math.exp(-2*Math.PI*s.lp/sr) }));
    this.dz=new Float64Array(8); this.type=-1; this.T60=-1; this.damp=-1; this.tune(1, 2, 7000); }
  // Set the line lengths and loop gains for a type. Changing type clears the lines, so the old space does not bleed into the new one.
  tune(type, T60, damp){ const sr=sampleRate; const t=VERB_T[type]||VERB_T[1];
    if(type!==this.type){ this.type=type; for(const b of this.line) b.fill(0); for(const s of this.sp){ s.buf.fill(0); s.xs.fill(0); s.ys.fill(0); s.lp=0; s.hp=0; } for(const b of this.ap) b.fill(0); this.hpz[0]=this.hpz[1]=0;
      for(let i=0;i<8;i++) this.L[i]=Math.min(this.SZ-40, primeAbove(sr*t.l[i]/1000)); this.erN=t.er.length; for(let i=0;i<this.erN;i++) this.erT[i]=sr*t.er[i]/1000; }
    // Decay is RT60 for the body of the sound (around 400 Hz): each line's gain makes up for what its damper takes there, so highs die sooner, like a real room
    const dmp=Math.min(t.damp, damp), c=1-Math.exp(-2*Math.PI*dmp/sr), comp=Math.sqrt(1+Math.pow(400/t.damp,2));
    for(let i=0;i<8;i++){ this.g[i]=Math.min(0.995, Math.pow(10, -3*this.L[i]/(sr*T60))*comp); this.lp[i]=c; }
    // a spring's loop is its delay plus the allpass chain, whose group delay is about half its length for the lows
    for(let j=0;j<3;j++){ const s=SPRINGS[j], S=this.sp[j]; const len=S.d+s.m*s.k*0.5, k=Math.sqrt(1+Math.pow(400/s.lp,2)); S.g=Math.min(0.995, Math.pow(10, -3*len/(sr*T60))*k); }
    this.hpc=1-Math.exp(-2*Math.PI*t.hp/sr); this.erg=t.erg; this.dg=t.dg; this.og=t.og; this.mod=t.mod; this.T60=T60; this.damp=damp; }
  process(inputs, outputs, p){
    if(this.dead) return false; const inp=inputs[0], out=outputs[0], n=out[0].length; const has=inp&&inp.length;
    const type=Math.round(p.type[0]), T60=p.decay[0], damp=p.damp[0]; if(type!==this.type||T60!==this.T60||damp!==this.damp) this.tune(type, T60, damp);
    const sr=sampleRate, SZ=this.SZ, PS=this.PS, AS=this.AS, pd=Math.min(PS-4, p.predelay[0]*sr/1000), line=this.line, L=this.L, g=this.g, lpc=this.lp, ap=this.ap, apL=this.apL, pre=this.pre;
    const r1=2*Math.PI*0.31/sr, r2=2*Math.PI*0.47/sr, mod=this.mod, erg=this.erg, dg=this.dg, og=this.og, hpc=this.hpc, spring=type===3;
    for(let i=0;i<n;i++){
      const xL=has?inp[0][i]:0, xR=has?(inp[1]||inp[0])[i]:0;
      pre[0][this.pw]=xL; pre[1][this.pw]=xR; this.pw++; if(this.pw>=PS) this.pw=0;
      const aL=tapRead(pre[0], this.pw, pd+1, PS), aR=tapRead(pre[1], this.pw, pd+1, PS);
      let oL=0, oR=0;
      if(spring){
        const x=0.5*(aL+aR); let s0=0, s1=0, s2=0;
        for(let j=0;j<3;j++){ const s=SPRINGS[j], S=this.sp[j], K=s.k, M=s.m, a=s.a;
          // the loop: what comes round from the far end, low passed and low cut, times the decay gain
          let z=S.buf[(S.w-S.d+this.SS)%this.SS]; S.lp+=S.c*(z-S.lp); z=S.lp; S.hp+=hpc*(z-S.hp); z-=S.hp;
          let v=x*0.5+z*S.g;
          // the spring itself: M stretched allpasses. Highs take longer to get through, so each echo chirps.
          const q=S.q, xs=S.xs, ys=S.ys; for(let m=0;m<M;m++){ const ix=m*K+q, xd=xs[ix], yd=ys[ix]; const y=a*(v-yd)+xd; xs[ix]=v; ys[ix]=y; v=y; }
          S.q=q+1; if(S.q>=K) S.q=0; S.buf[S.w]=v; S.w++; if(S.w>=this.SS) S.w=0;
          if(j===0) s0=v; else if(j===1) s1=v; else s2=v; }
        oL=(s0+0.5*s2)*og*0.8; oR=(s1+0.5*s2)*og*0.8;
      } else {
        // early reflections, straight off the pre-delay line, left and right turn about
        let eL=0, eR=0; for(let j=0;j<this.erN;j++){ const v=tapRead(pre[j&1], this.pw, pd+1+this.erT[j], PS)*(0.7-0.08*j); if(j&1) eR+=v; else eL+=v; }
        // input low cut, then four diffusion allpasses a side
        this.hpz[0]+=hpc*(aL-this.hpz[0]); this.hpz[1]+=hpc*(aR-this.hpz[1]); let dL=aL-this.hpz[0], dR=aR-this.hpz[1];
        for(let j=0;j<4;j++){ const b=ap[j], rd=(this.aw-apL[j]+AS)%AS, z=b[rd]; const y=z-dg*dL; b[this.aw]=dL+dg*z; dL=y; }
        for(let j=4;j<8;j++){ const b=ap[j], rd=(this.aw-apL[j]+AS)%AS, z=b[rd]; const y=z-dg*dR; b[this.aw]=dR+dg*z; dR=y; }
        this.aw++; if(this.aw>=AS) this.aw=0;
        // read the eight lines; lines 2 and 5 wander a little so nothing rings like metal
        this.ph[0]+=r1; if(this.ph[0]>2*Math.PI) this.ph[0]-=2*Math.PI; this.ph[1]+=r2; if(this.ph[1]>2*Math.PI) this.ph[1]-=2*Math.PI;
        const m2=mod*Math.sin(this.ph[0]), m5=mod*Math.sin(this.ph[1]);
        const r0=tapRead(line[0],this.w,L[0],SZ), rr1=tapRead(line[1],this.w,L[1],SZ), rr2=tapRead(line[2],this.w,L[2]+m2,SZ), r3=tapRead(line[3],this.w,L[3],SZ), r4=tapRead(line[4],this.w,L[4],SZ), r5=tapRead(line[5],this.w,L[5]+m5,SZ), r6=tapRead(line[6],this.w,L[6],SZ), r7=tapRead(line[7],this.w,L[7],SZ);
        oL=(eL*erg + (r0-rr2+r4-r6))*og; oR=(eR*erg + (rr1-r3+r5-r7))*og;
        // damp each line, scale by its decay gain, mix with the Householder matrix, add the input, write back
        const d=this.dz; d[0]+=lpc[0]*(r0-d[0]); d[1]+=lpc[1]*(rr1-d[1]); d[2]+=lpc[2]*(rr2-d[2]); d[3]+=lpc[3]*(r3-d[3]); d[4]+=lpc[4]*(r4-d[4]); d[5]+=lpc[5]*(r5-d[5]); d[6]+=lpc[6]*(r6-d[6]); d[7]+=lpc[7]*(r7-d[7]);
        const v0=d[0]*g[0], v1=d[1]*g[1], v2=d[2]*g[2], v3=d[3]*g[3], v4=d[4]*g[4], v5=d[5]*g[5], v6=d[6]*g[6], v7=d[7]*g[7];
        const s=(v0+v1+v2+v3+v4+v5+v6+v7)*0.25, iL=dL*0.5, iR=dR*0.5;
        line[0][this.w]=v0-s+iL; line[1][this.w]=v1-s-iL; line[2][this.w]=v2-s+iL; line[3][this.w]=v3-s-iL; line[4][this.w]=v4-s+iR; line[5][this.w]=v5-s-iR; line[6][this.w]=v6-s+iR; line[7][this.w]=v7-s-iR;
        this.w++; if(this.w>=SZ) this.w=0;
      }
      out[0][i]=oL; if(out[1]) out[1][i]=oR;
    }
    return true; }
}

// ---------- Sub octave: a Boss OC-2 ----------
// The input is low passed so mainly the fundamental is left. A comparator with hysteresis turns that into a square at the note's pitch.
// Two flip-flops divide it by 2 and by 4. The OC-2 trick: the sub is not the square itself. The square switches the sign of the filtered
// input, so the sub carries the note's own dynamics and dies when the note dies. -2 Oct switches the -1 Oct signal the same way.
// The up octave is the filtered input rectified, with its DC taken out.
class OC2Processor extends AudioWorkletProcessor {
  static get parameterDescriptors(){ return [
    {name:'sub1', defaultValue:0.7, minValue:0, maxValue:1}, {name:'sub2', defaultValue:0, minValue:0, maxValue:1}, {name:'up', defaultValue:0, minValue:0, maxValue:1},
    {name:'dry', defaultValue:1, minValue:0, maxValue:1}, {name:'tone', defaultValue:600, minValue:100, maxValue:4000}, {name:'track', defaultValue:300, minValue:100, maxValue:800} ]; }
  constructor(){ super(); onKill(this); this.l1=0; this.l2=0; this.l3=0; this.l4=0; this.env=0; this.cmp=-1; this.ff1=1; this.ff2=1; this.cnt=0; this.hold=0; this.s1=0; this.s2=0; this.s3=0; this.s4=0; this.u1=0; this.u2=0; this.udc=0; this.flips=0; }
  process(inputs, outputs, p){
    if(this.dead) return false; const inp=inputs[0], out=outputs[0]; if(!inp||!inp.length) return true;
    const n=inp[0].length, sr=sampleRate, track=p.track[0], tone=p.tone[0];
    const ct=lpCoef(track), cto=lpCoef(tone), cto2=lpCoef(tone*0.5), cup=lpCoef(Math.min(tone*4,6000)), cdc=lpCoef(40), envA=lpCoef(80), envR=Math.exp(-1/(sr*0.06)), minHold=0.4*sr/track, gate=0.002;
    const sub1=p.sub1[0]*1.6, sub2=p.sub2[0]*1.5, up=p.up[0]*1.6, dry=p.dry[0];
    for(let i=0;i<n;i++){
      const x = inp.length>1 ? (inp[0][i]+inp[1][i])*0.5 : inp[0][i];
      // two poles for the signal that gets switched, four for the one the comparator watches
      this.l1+=ct*(x-this.l1); this.l2+=ct*(this.l1-this.l2); this.l3+=ct*(this.l2-this.l3); this.l4+=ct*(this.l3-this.l4);
      const f=this.l2, c=this.l4, a=Math.abs(c); this.env = a>this.env ? this.env+envA*(a-this.env) : this.env*envR;
      const h=0.08*this.env; this.hold++;
      // the comparator arms when the wave goes well below zero, and fires on the next upward zero crossing. Hysteresis keeps harmonics from firing it twice.
      if(this.cmp<0){ if(c<-h) this.cmp=0; } else if(this.cmp===0){ if(c>0){ this.cmp=1; if(this.hold>minHold && this.env>gate){ this.hold=0; this.ff1=-this.ff1; this.cnt++; if(this.cnt&1) this.ff2=-this.ff2; this.flips++; } } }
      else if(c<-h) this.cmp=0;
      // -1 oct: the filtered input, flipped by the first divider, then rounded off by the tone filter
      const o1=c*this.ff1; this.s1+=cto*(o1-this.s1); this.s2+=cto*(this.s1-this.s2);
      // -2 oct: the rectified signal switched by the second divider. A square that breathes with the note; the tone filter rounds it.
      const o2=a*this.ff2; this.s3+=cto2*(o2-this.s3); this.s4+=cto2*(this.s3-this.s4);
      // +1 oct: full wave rectify the filtered input, take out the DC, round it off
      let u=Math.abs(f); this.udc+=cdc*(u-this.udc); u-=this.udc; this.u1+=cup*(u-this.u1); this.u2+=cup*(this.u1-this.u2);
      const y = x*dry + this.s2*sub1 + this.s4*sub2 + this.u2*up;
      for(let c2=0;c2<out.length;c2++) out[c2][i]=y;
    }
    return true; }
}

// ---------- Pitch shifter: two grains that splice where the waves line up ----------
// Two read heads walk through a delay line at the pitch ratio, each under a raised-cosine window, half a window apart, so the windows
// add up to one. When a head reaches the end of its window it jumps back. Instead of jumping to a fixed spot, it tries a range of spots
// and picks the one where the recent past lines up best with what the other head has been reading (a short correlation search, WSOLA style).
// On a steady note the splice then lands a whole number of periods away and the warble is gone. Grain sets the window; up shifts use a
// shorter window so the delay stays short. A new note comes out within about half a window.
class Pitch2Processor extends AudioWorkletProcessor {
  static get parameterDescriptors(){ return [
    {name:'semitones', defaultValue:0, minValue:-24, maxValue:24}, {name:'cents', defaultValue:0, minValue:-100, maxValue:100},
    {name:'mix', defaultValue:1, minValue:0, maxValue:1}, {name:'grain', defaultValue:40, minValue:15, maxValue:150} ]; }
  constructor(){ super(); onKill(this); this.S=32768; this.buf=[new Float32Array(this.S), new Float32Array(this.S)]; this.t=0; this.gr=[{r:0,k:0,L:0},{r:0,k:0,L:0}]; this.started=false; this.lastD=0; }
  at(b, a){ let r=a%this.S; if(r<0) r+=this.S; const i0=r|0, f=r-i0; let i1=i0+1; if(i1>=this.S) i1-=this.S; return b[i0]*(1-f)+b[i1]*f; }
  near(b, a){ let r=Math.floor(a+0.5)%this.S; if(r<0) r+=this.S; return b[r]; }
  // Where should the new head start? Try delays dn..dn+range and keep the one whose past matches the other head's past best.
  search(other, dn, range, ratio, span){ const b=this.buf[0], t=this.t, step=Math.max(2, Math.floor(span/128)), nj=Math.max(4, Math.floor(span/step)); let best=0, bestS=-1e30;
    const score=(d)=>{ let c=0, e=0; for(let j=0;j<nj;j++){ const o=j*step, av=this.near(b, other-o), bv=this.near(b, t-d-o); c+=av*bv; e+=bv*bv; } return c/Math.sqrt(e+1e-9); };
    for(let dd=0; dd<=range; dd+=step){ const s=score(dn+dd); if(s>bestS){ bestS=s; best=dd; } }   // coarse pass
    const lo=Math.max(0,best-step+1), hi=Math.min(range,best+step-1), bc=best; for(let dd=lo; dd<=hi; dd++){ if(dd===bc) continue; const s=score(dn+dd); if(s>bestS){ bestS=s; best=dd; } }   // fine pass around the winner
    return dn+best; }
  process(inputs, outputs, p){
    if(this.dead) return false; const inp=inputs[0], out=outputs[0]; if(!inp||!inp.length) return true;
    const n=inp[0].length, S=this.S, sr=sampleRate, mix=p.mix[0];
    const ratio=Math.pow(2,(p.semitones[0]+p.cents[0]/100)/12), W=Math.max(128, Math.floor(sr*p.grain[0]/1000*0.95/Math.max(1,ratio))), H=W>>1, range=Math.floor(W*0.65), dn=(ratio>1?(ratio-1)*W:0)+4, span=Math.floor(W*Math.max(1,ratio));   // the search compares as much of the past as one grain covers, so a low note fits a whole period in it
    const g0=this.gr[0], g1=this.gr[1];
    if(!this.started){ this.started=true; g0.r=this.t-dn; g0.k=0; g0.L=W; g1.r=this.t-dn-(1-ratio)*H; g1.k=H; g1.L=W; }
    for(let i=0;i<n;i++){
      for(let c=0;c<2;c++) this.buf[c][this.t%S]=(inp[c]||inp[0])[i];
      this.t++;
      if(g0.k>=g0.L){ g0.k=0; g0.L=W; g0.r=this.t-this.search(g1.r, dn, range, ratio, span); }
      if(g1.k>=g1.L){ g1.k=0; g1.L=W; g1.r=this.t-this.search(g0.r, dn, range, ratio, span); }
      const w0=0.5-0.5*Math.cos(2*Math.PI*g0.k/g0.L), w1=0.5-0.5*Math.cos(2*Math.PI*g1.k/g1.L);
      const a0=Math.min(g0.r, this.t-1)-0.5, a1=Math.min(g1.r, this.t-1)-0.5;   // never read past what has been written; the half sample averages two samples so an up shift does not skip every other one
      for(let c=0;c<out.length;c++){ const b=this.buf[c<2?c:0]; const wet=this.at(b,a0)*w0+this.at(b,a1)*w1; out[c][i]=wet*mix+(inp[c]||inp[0])[i]*(1-mix); }
      g0.r+=ratio; g1.r+=ratio; g0.k++; g1.k++;
    }
    return true; }
}

registerProcessor('np-delay', DelayProcessor);
registerProcessor('np-taps', TapsProcessor);
registerProcessor('np-verb', VerbProcessor);
registerProcessor('np-oc2', OC2Processor);
registerProcessor('np-pitch2', Pitch2Processor);
