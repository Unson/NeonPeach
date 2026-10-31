// ===== Neon Peach 2.4 worklets: the drive pedal models =====
// Every processor here has a C++ twin in native/src/procs_drive.cpp. Keep them in step: the golden test compares them sample by sample.
// Both run 4x oversampled through the same half-band stages np-shaper uses (HB, HB1, HB2 from worklets2.js), so they add the same SHAPER_LAT delay and shDelay() lines a dry path up with them.
// Argument order matters: every nonlinear call lands in its own const before it is used, so C++ (which may evaluate arguments in any order) does the same thing.

// ---------- np-tube: one 12AX7 triode stage ----------
// What a curve cannot do, and a tube does:
// - the grid draws current when the signal swings it positive. That clamps the top of the wave and charges the coupling cap, which slides the bias down.
//   The bottom then cuts off harder for a while (the duck) and comes back as the cap drains (the bloom). The slide also means the grid conducts less, so it settles.
// - plate current follows a 3/2 power law, so cutoff is soft and the two sides of the wave never match.
// - sag: the supply drops when the stage works hard, so loud playing is held back a little and let go slowly.
// Numbers are in units of the grid swing from cutoff to grid conduction (VK). Bias 0.5 idles where the two sides of the wave have the same room (the 3/2 law puts that above the middle).
class TubeProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors(){ const k='k-rate'; return [ {name:'drive', defaultValue:0.25, minValue:0, maxValue:1, automationRate:k}, {name:'bias', defaultValue:0.5, minValue:0, maxValue:1, automationRate:k}, {name:'sag', defaultValue:0.3, minValue:0, maxValue:1, automationRate:k} ]; }
  constructor(){ super(); onKill(this); this.ch=[]; }
  process(inputs, outputs, p){
    if(this.dead) return false; const inp=inputs[0], out=outputs[0]; if(!inp||!inp.length){ for(const o of out) o.fill(0); return true; }
    const n=out[0].length, g=1+Math.pow(p.drive[0],1.3)*11, B=-0.44+(p.bias[0]-0.5)*0.6, GK=-B, sag=p.sag[0], VK=1.2, sr4=sampleRate*4;
    const i0=1+B/VK, ic0=i0*Math.sqrt(i0), sc=VK/(1.5*Math.sqrt(i0));   // idle current, and the gain that lets a quiet note pass at unity whatever the bias
    const cUp=1-Math.exp(-1/(sr4*0.004)), cDn=Math.exp(-1/(sr4*0.1)), sA=1-Math.exp(-1/(sr4*0.015)), sR=1-Math.exp(-1/(sr4*0.25));
    for(let c=0;c<out.length;c++){ const src=inp[c]||inp[0], o=out[c]; let st=this.ch[c]; if(!st){ st=this.ch[c]={u1:new HB(HB1), u2:new HB(HB2), d2:new HB(HB2), d1:new HB(HB1), cap:0, ps:0}; }
      const u1=st.u1, u2=st.u2, d2=st.d2, d1=st.d1;
      const tube=(x)=>{ const sh=0.5*st.cap/(st.cap+1); let v=x*g-sh, ig=0; const gc=v-GK; if(gc>0){ const cl=gc/(1+gc*4); v=GK+cl; ig=gc-cl; }   // the bias slide, then grid conduction: a firm clamp on top, and the current it draws
        st.cap = ig>st.cap ? st.cap+(ig-st.cap)*cUp : st.cap*cDn;                                                                      // the coupling cap charges fast and drains slow
        const t=1+(v+B)/VK, ic=t>0?t*Math.sqrt(t):0, y=(ic-ic0)*sc;                                                                   // plate current: 3/2 power, nothing below cutoff
        const ay=Math.abs(y); st.ps += (ay-st.ps)*(ay>st.ps?sA:sR); return y/(1+sag*st.ps*1.5); };                                    // sag follows how hard the stage works
      for(let i=0;i<n;i++){ u1.up(src[i]); const a=u1.a, bb=u1.b; u2.up(a); const s0=tube(u2.a), s1=tube(u2.b); const e=d2.down(s0,s1); u2.up(bb); const s2=tube(u2.a), s3=tube(u2.b); const od=d2.down(s2,s3); o[i]=d1.down(e,od); } }
    return true; }
}

// ---------- np-fuzz: a germanium Fuzz Face ----------
// Two transistor stages. Each saturates hard on top and cuts off softly below, so the wave leans. The second stage's bias is where the pedal lives:
// Bias sets it (starved and spitty at one end, smooth at the other), a loud signal drags it toward cutoff like the real cap charging up,
// and Gate starves it when the input is quiet, so decays break up and sputter. Play softer and both stages clip less: the fuzz cleans up.
class FuzzProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors(){ const k='k-rate'; return [ {name:'fuzz', defaultValue:0.7, minValue:0, maxValue:1, automationRate:k}, {name:'bias', defaultValue:0.5, minValue:0, maxValue:1, automationRate:k}, {name:'gate', defaultValue:0, minValue:0, maxValue:1, automationRate:k} ]; }
  constructor(){ super(); onKill(this); this.ch=[]; }
  process(inputs, outputs, p){
    if(this.dead) return false; const inp=inputs[0], out=outputs[0]; if(!inp||!inp.length){ for(const o of out) o.fill(0); return true; }
    const n=out[0].length, g1=2.5, g2=2+Math.pow(p.fuzz[0],1.5)*22, B2=(p.bias[0]-0.5)*1.2, gate=p.gate[0], sr4=sampleRate*4;
    const eA=1-Math.exp(-1/(sr4*0.003)), eR=Math.exp(-1/(sr4*0.08));
    const tr=(v)=>v>0?Math.tanh(v):(Math.exp(3*v)-1)/3;   // a transistor stage: saturates on top, cuts off below (slope 1 at rest, then nothing)
    for(let c=0;c<out.length;c++){ const src=inp[c]||inp[0], o=out[c]; let st=this.ch[c]; if(!st){ st=this.ch[c]={u1:new HB(HB1), u2:new HB(HB2), d2:new HB(HB2), d1:new HB(HB1), env:0}; }
      const u1=st.u1, u2=st.u2, d2=st.d2, d1=st.d1;
      const fz=(x)=>{ const ax=Math.abs(x); st.env = ax>st.env ? st.env+(ax-st.env)*eA : st.env*eR; const lv=Math.min(1, st.env*6);   // how hard the input is hitting, 0..1
        const y1=tr(x*g1*(0.5+0.5*lv));                                                                                              // the first stage's gain climbs with its current, so a quiet note gets less of it: that is the clean-up
        const off=B2-gate*(1-lv)*3-lv*0.3; return tr(y1*g2+off)-tr(off); };                                                           // Gate starves a quiet signal; a loud one drags the bias toward cutoff
      for(let i=0;i<n;i++){ u1.up(src[i]); const a=u1.a, bb=u1.b; u2.up(a); const s0=fz(u2.a), s1=fz(u2.b); const e=d2.down(s0,s1); u2.up(bb); const s2=fz(u2.a), s3=fz(u2.b); const od=d2.down(s2,s3); o[i]=d1.down(e,od); } }
    return true; }
}

registerProcessor('np-tube', TubeProcessor);
registerProcessor('np-fuzz', FuzzProcessor);
