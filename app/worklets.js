// ===== Neon Peach AudioWorklet processors =====
// This file runs inside the audio thread.

function lpCoef(fc){ return 1 - Math.exp(-2*Math.PI*fc/sampleRate); }
// A removed block sends {cmd:'kill'}. The processor then returns false so the browser can free it.
function onKill(p){ p.dead=false; p.port.onmessage=(e)=>{ if(e.data&&e.data.cmd==='kill') p.dead=true; }; }
function clamp(v,a,b){ return v<a?a:(v>b?b:v); }
const TWO_PI = Math.PI*2;

class SVF {
  constructor(){ this.ic1=0; this.ic2=0; }
  run(x, fc, q){
    const g = Math.tan(Math.PI*clamp(fc,10,sampleRate*0.45)/sampleRate);
    const k = 1/Math.max(q,0.2);
    const a1 = 1/(1+g*(g+k)), a2=g*a1, a3=g*a2;
    const v3 = x - this.ic2;
    const v1 = a1*this.ic1 + a2*v3;
    const v2 = this.ic2 + a2*this.ic1 + a3*v3;
    this.ic1 = 2*v1 - this.ic1; this.ic2 = 2*v2 - this.ic2;
    this.lp=v2; this.bp=v1; this.hp=x - k*v1 - v2;
    return this;
  }
}

// ---------- Noise gate ----------
class GateProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors(){ return [
    {name:'threshold', defaultValue:-55, minValue:-90, maxValue:0},
    {name:'attack', defaultValue:1, minValue:0.1, maxValue:100},
    {name:'release', defaultValue:120, minValue:5, maxValue:2000},
    {name:'hold', defaultValue:40, minValue:0, maxValue:1000},
    {name:'range', defaultValue:-80, minValue:-90, maxValue:0}
  ]; }
  constructor(){ super(); this.env=0; this.g=0; this.hold=0; this.open=false; onKill(this); }
  process(inputs, outputs, p){
    if(this.dead) return false;
    const inp=inputs[0], out=outputs[0];
    if(!inp || !inp.length){ return true; }
    const n=inp[0].length;
    const thr=Math.pow(10,p.threshold[0]/20), floor=Math.pow(10,p.range[0]/20);
    const envRel = Math.exp(-1/(sampleRate*0.01));
    const atk = Math.exp(-1/(sampleRate*p.attack[0]/1000));
    const rel = Math.exp(-1/(sampleRate*p.release[0]/1000));
    const holdS = sampleRate*p.hold[0]/1000;
    for(let i=0;i<n;i++){
      let a=0; for(let c=0;c<inp.length;c++){ const v=Math.abs(inp[c][i]); if(v>a)a=v; }
      this.env = a>this.env ? a : this.env*envRel;
      if(this.env>thr){ this.open=true; this.hold=holdS; }
      else if(this.env<thr*0.5){ if(this.hold>0) this.hold--; else this.open=false; }
      const target = this.open?1:floor;
      this.g = target>this.g ? target + (this.g-target)*atk : target + (this.g-target)*rel;
      for(let c=0;c<out.length;c++){ out[c][i]=(inp[c]||inp[0])[i]*this.g; }
    }
    return true;
  }
}

// ---------- Analog-style sub octave (flip-flop divider) ----------
class OctaveProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors(){ return [
    {name:'sub1', defaultValue:0.7, minValue:0, maxValue:1},
    {name:'sub2', defaultValue:0, minValue:0, maxValue:1},
    {name:'up', defaultValue:0, minValue:0, maxValue:1},
    {name:'dry', defaultValue:1, minValue:0, maxValue:1},
    {name:'tone', defaultValue:600, minValue:100, maxValue:4000},
    {name:'track', defaultValue:300, minValue:100, maxValue:800}
  ]; }
  constructor(){ super(); this.z1=0; this.z2=0; this.prev=0; this.ff1=1; this.ff2=1; this.cnt=0; this.env=0; this.s1=0;this.s2=0;this.s3=0;this.s4=0; this.dc=0; this.dcx=0; onKill(this); }
  process(inputs, outputs, p){
    if(this.dead) return false; const inp=inputs[0], out=outputs[0]; if(!inp||!inp.length) return true;
    const n=inp[0].length;
    const ct=lpCoef(p.track[0]), cto=lpCoef(p.tone[0]), envA=lpCoef(60), envR=Math.exp(-1/(sampleRate*0.08));
    for(let i=0;i<n;i++){
      const x = inp.length>1 ? (inp[0][i]+inp[1][i])*0.5 : inp[0][i];
      this.z1 += ct*(x-this.z1); this.z2 += ct*(this.z1-this.z2);
      const f=this.z2;
      if(this.prev<=0 && f>0){ this.ff1=-this.ff1; this.cnt++; if(this.cnt&1) this.ff2=-this.ff2; }
      this.prev=f;
      const a=Math.abs(x); this.env = a>this.env ? this.env + envA*(a-this.env) : this.env*envR;
      let sub1=this.ff1*this.env, sub2=this.ff2*this.env;
      this.s1 += cto*(sub1-this.s1); this.s2 += cto*(this.s1-this.s2);
      this.s3 += cto*(sub2-this.s3); this.s4 += cto*(this.s3-this.s4);
      let up = Math.abs(x)*2; this.dcx += 0.002*(up-this.dcx); up -= this.dcx;
      const y = x*p.dry[0] + this.s2*p.sub1[0]*1.6 + this.s4*p.sub2[0]*1.6 + up*p.up[0];
      for(let c=0;c<out.length;c++) out[c][i]=y;
    }
    return true;
  }
}

// ---------- Granular delay-line pitch shifter ----------
class PitchProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors(){ return [
    {name:'semitones', defaultValue:0, minValue:-24, maxValue:24},
    {name:'cents', defaultValue:0, minValue:-100, maxValue:100},
    {name:'mix', defaultValue:1, minValue:0, maxValue:1},
    {name:'grain', defaultValue:70, minValue:20, maxValue:150}
  ]; }
  constructor(){ super(); this.size=16384; this.buf=[new Float32Array(this.size), new Float32Array(this.size)]; this.w=0; this.ph=0; onKill(this); }
  process(inputs, outputs, p){
    if(this.dead) return false; const inp=inputs[0], out=outputs[0]; if(!inp||!inp.length) return true;
    const n=inp[0].length, S=this.size;
    const ratio=Math.pow(2,(p.semitones[0]+p.cents[0]/100)/12);
    const G=Math.min(S/2, Math.floor(sampleRate*p.grain[0]/1000));
    const mix=p.mix[0];
    for(let i=0;i<n;i++){
      for(let c=0;c<2;c++){ this.buf[c][this.w]=(inp[c]||inp[0])[i]; }
      this.ph += (1-ratio); while(this.ph<0) this.ph+=G; while(this.ph>=G) this.ph-=G;
      const d1=this.ph, d2=(this.ph+G/2)%G;
      const w1=Math.sin(Math.PI*d1/G), w2=Math.sin(Math.PI*d2/G);
      for(let c=0;c<out.length;c++){
        const b=this.buf[c<2?c:0];
        let r1=this.w-d1-2; while(r1<0) r1+=S; let i1=r1|0, f1=r1-i1; const v1=b[i1]*(1-f1)+b[(i1+1)%S]*f1;
        let r2=this.w-d2-2; while(r2<0) r2+=S; let i2=r2|0, f2=r2-i2; const v2=b[i2]*(1-f2)+b[(i2+1)%S]*f2;
        const wet=v1*w1+v2*w2;
        out[c][i]= wet*mix + (inp[c]||inp[0])[i]*(1-mix);
      }
      this.w=(this.w+1)%S;
    }
    return true;
  }
}

// ---------- Envelope filter ----------
class EnvFilterProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors(){ return [
    {name:'sens', defaultValue:0.5, minValue:0, maxValue:1},
    {name:'fmin', defaultValue:120, minValue:40, maxValue:2000},
    {name:'range', defaultValue:0.7, minValue:0, maxValue:1},
    {name:'q', defaultValue:4, minValue:0.5, maxValue:20},
    {name:'attack', defaultValue:8, minValue:1, maxValue:200},
    {name:'decay', defaultValue:180, minValue:10, maxValue:1500},
    {name:'type', defaultValue:0, minValue:0, maxValue:2},
    {name:'dir', defaultValue:0, minValue:0, maxValue:1},
    {name:'mix', defaultValue:1, minValue:0, maxValue:1}
  ]; }
  constructor(){ super(); this.env=0; this.f=[new SVF(), new SVF()]; this.sm=0; onKill(this); }
  process(inputs, outputs, p){
    if(this.dead) return false; const inp=inputs[0], out=outputs[0]; if(!inp||!inp.length) return true;
    const n=inp[0].length;
    const atk=Math.exp(-1/(sampleRate*p.attack[0]/1000)), dec=Math.exp(-1/(sampleRate*p.decay[0]/1000));
    const fmin=p.fmin[0], fmax=Math.min(fmin*Math.pow(40,p.range[0]), 9000), q=p.q[0], type=p.type[0]|0, dir=p.dir[0], mix=p.mix[0];
    const sens=Math.pow(10, p.sens[0]*3); // 1..1000 gain on envelope
    for(let i=0;i<n;i++){
      let a=0; for(let c=0;c<inp.length;c++){ const v=Math.abs(inp[c][i]); if(v>a)a=v; }
      this.env = a>this.env ? a+(this.env-a)*atk : a+(this.env-a)*dec;
      let e=clamp(this.env*sens*0.3,0,1); e=Math.sqrt(e);
      if(dir>0.5) e=1-e;
      const fc=fmin*Math.pow(fmax/fmin,e);
      this.sm += 0.02*(fc-this.sm);
      for(let c=0;c<out.length;c++){
        const x=(inp[c]||inp[0])[i]; const s=this.f[c<2?c:0].run(x,this.sm,q);
        const y = type===0?s.lp:(type===1?s.bp*1.5:s.hp);
        out[c][i]=y*mix + x*(1-mix);
      }
    }
    return true;
  }
}

// ---------- Pitch-tracking mono synth (Peach Synth) ----------
class SynthProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors(){ return [
    {name:'wave', defaultValue:0, minValue:0, maxValue:3},
    {name:'octave', defaultValue:0, minValue:-2, maxValue:1},
    {name:'sub', defaultValue:0.3, minValue:0, maxValue:1},
    {name:'detune', defaultValue:0, minValue:0, maxValue:50},
    {name:'cutoff', defaultValue:400, minValue:60, maxValue:8000},
    {name:'res', defaultValue:3, minValue:0.5, maxValue:15},
    {name:'envamt', defaultValue:0.6, minValue:0, maxValue:1},
    {name:'glide', defaultValue:20, minValue:0, maxValue:500},
    {name:'attack', defaultValue:5, minValue:1, maxValue:300},
    {name:'release', defaultValue:120, minValue:10, maxValue:1500},
    {name:'mix', defaultValue:0.5, minValue:0, maxValue:1},
    {name:'gate', defaultValue:-45, minValue:-80, maxValue:-10}
  ]; }
  constructor(){ super(); this.z1=0;this.z2=0;this.prev=0;this.since=0;this.periods=[0,0,0];this.pi=0;this.freq=0;this.cur=0;this.ph=0;this.ph2=0;this.phs=0;this.env=0;this.fenv=0;this.svf=new SVF();this.sub=1; onKill(this); }
  blep(t, dt){ if(t<dt){ t/=dt; return t+t-t*t-1; } else if(t>1-dt){ t=(t-1)/dt; return t*t+t+t+1; } return 0; }
  process(inputs, outputs, p){
    if(this.dead) return false; const inp=inputs[0], out=outputs[0]; if(!inp||!inp.length) return true;
    const n=inp[0].length;
    const ct=lpCoef(450), gate=Math.pow(10,p.gate[0]/20);
    const atk=Math.exp(-1/(sampleRate*p.attack[0]/1000)), rel=Math.exp(-1/(sampleRate*p.release[0]/1000));
    const glide = p.glide[0]>0 ? 1-Math.exp(-1/(sampleRate*p.glide[0]/1000)) : 1;
    const wave=p.wave[0]|0, oct=Math.pow(2,p.octave[0]|0), mix=p.mix[0], det=p.detune[0];
    const minP=sampleRate/400, maxP=sampleRate/25;
    for(let i=0;i<n;i++){
      const x = inp.length>1?(inp[0][i]+inp[1][i])*0.5:inp[0][i];
      this.z1 += ct*(x-this.z1); this.z2 += ct*(this.z1-this.z2);
      const f=this.z2; this.since++;
      const a=Math.abs(x); this.env = a>this.env ? a+(this.env-a)*atk : a+(this.env-a)*rel;
      if(this.prev<=0 && f>0){
        if(this.since>minP && this.since<maxP && this.env>gate){
          this.periods[this.pi]=this.since; this.pi=(this.pi+1)%3;
          const s=[...this.periods].sort((a,b)=>a-b); if(s[0]>0){ this.freq=sampleRate/s[1]; }
        }
        this.since=0;
      }
      this.prev=f;
      if(this.freq>0){ this.cur += glide*(this.freq-this.cur); }
      const fr=this.cur*oct;
      const dt=fr/sampleRate, dt2=fr*(1+det/1000)/sampleRate, dts=dt*0.5;
      this.ph+=dt; if(this.ph>=1)this.ph-=1; this.ph2+=dt2; if(this.ph2>=1)this.ph2-=1; this.phs+=dts; if(this.phs>=1)this.phs-=1;
      let o;
      if(wave===0){ o = (2*this.ph-1) - this.blep(this.ph,dt); if(det>0){ o=(o + (2*this.ph2-1)-this.blep(this.ph2,dt2))*0.6; } }
      else if(wave===1){ o = (this.ph<0.5?1:-1) + this.blep(this.ph,dt) - this.blep((this.ph+0.5)%1,dt); }
      else if(wave===2){ o = (this.ph<0.25?1:-1) + this.blep(this.ph,dt) - this.blep((this.ph+0.75)%1,dt); }
      else { o = Math.sin(TWO_PI*this.ph); }
      const sq = this.phs<0.5?1:-1; o += sq*p.sub[0];
      const amp = clamp((this.env-gate)*6, 0, 1);
      this.fenv += 0.003*(amp-this.fenv);
      const fc = p.cutoff[0]*Math.pow(16, this.fenv*p.envamt[0]);
      const y = this.svf.run(o*0.5, fc, p.res[0]).lp * amp;
      for(let c=0;c<out.length;c++){ out[c][i] = y*mix + (inp[c]||inp[0])[i]*(1-mix); }
    }
    return true;
  }
}

// ---------- Bit crusher ----------
class CrusherProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors(){ return [
    {name:'bits', defaultValue:8, minValue:2, maxValue:16},
    {name:'rate', defaultValue:1, minValue:1, maxValue:64},
    {name:'mix', defaultValue:1, minValue:0, maxValue:1}
  ]; }
  constructor(){ super(); this.cnt=0; this.hold=[0,0]; onKill(this); }
  process(inputs, outputs, p){
    if(this.dead) return false; const inp=inputs[0], out=outputs[0]; if(!inp||!inp.length) return true;
    const n=inp[0].length, steps=Math.pow(2,p.bits[0]), rate=p.rate[0]|0, mix=p.mix[0];
    for(let i=0;i<n;i++){
      this.cnt++; const take = this.cnt>=rate; if(take) this.cnt=0;
      for(let c=0;c<out.length;c++){
        const x=(inp[c]||inp[0])[i];
        if(take) this.hold[c&1]=Math.round(x*steps)/steps;
        out[c][i]=this.hold[c&1]*mix + x*(1-mix);
      }
    }
    return true;
  }
}

// ---------- Looper ----------
class LooperProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors(){ return [
    {name:'level', defaultValue:1, minValue:0, maxValue:2},
    {name:'feedback', defaultValue:1, minValue:0, maxValue:1}
  ]; }
  constructor(){ super();
    // 3 minutes of stereo is ~70 MB, so the buffer is made only when recording starts
    this.max=Math.floor(sampleRate*180); this.buf=null; this.dead=false;
    this.undo=null; this.len=0; this.pos=0; this.state='empty'; this.reverse=false; this.half=false; this.tick=0; this.fpos=0;
    this.bar=0; this.target=0; this.after='play'; this.armAt=0;   // bar: loop length snaps to whole bars; armAt: recording waits for this frame
    this.port.onmessage=(e)=>this.cmd(e.data);
  }
  cmd(m){
    const s=this.state;
    if(m.bar!==undefined) this.bar=Math.max(0, Math.floor(m.bar||0));
    switch(m.cmd){
      case 'kill': this.dead=true; this.buf=null; this.undo=null; return;
      case 'rec':
        if(s==='empty' || s==='arm'){ if(!this.buf) this.buf=[new Float32Array(this.max), new Float32Array(this.max)]; this.len=0; this.pos=0; this.target=0;
          if(s==='empty' && m.at>currentFrame){ this.state='arm'; this.armAt=m.at; } else this.state='rec'; }
        else if(s==='rec'){ this.endRec('play'); }
        else if(s==='play'){ this.snap(); this.state='over'; }
        else if(s==='over'){ this.state='play'; }
        else if(s==='stop'){ this.snap(); this.pos=0; this.fpos=0; this.state='over'; }
        break;
      case 'play': if(s==='rec'){ this.endRec('play'); } else if(s==='arm'){ this.state='empty'; } else if(this.len>0){ if(s==='over') this.state='play'; else if(s==='stop'){ this.pos=0; this.fpos=0; this.state='play'; } } break;
      case 'stop': if(s==='rec'){ this.endRec('stop'); } else if(s==='arm'){ this.state='empty'; } else if(this.len>0) this.state='stop'; break;
      case 'clear': this.state='empty'; this.len=0; this.pos=0; this.fpos=0; this.undo=null; this.buf=null; break;
      case 'undo': if(this.undo){ this.buf[0].set(this.undo[0].subarray(0,this.len)); this.buf[1].set(this.undo[1].subarray(0,this.len)); this.undo=null; } break;
      case 'reverse': this.reverse=!this.reverse; break;
      case 'half': this.half=!this.half; break;
    }
    this.report();
  }
  // Stop the first recording. With bars on, the loop length snaps to the nearest whole number of bars:
  // stop a little late and the extra is trimmed, stop early and it keeps recording to the bar line.
  endRec(next){ const pos=this.pos, bar=this.bar;
    if(bar>0 && pos>0){ const t=Math.min(Math.floor(this.max/bar)*bar || bar, Math.max(bar, Math.round(pos/bar)*bar));
      if(t>pos){ this.target=t; this.after=next; return; }
      this.len=t; this.pos=next==='stop'?0:pos-t; this.fpos=this.pos; this.state=next; return; }
    this.len=pos; this.pos=0; this.fpos=0; this.state=next; }
  snap(){ this.undo=[this.buf[0].slice(0,this.len), this.buf[1].slice(0,this.len)]; }
  report(){ this.port.postMessage({state:this.state, len:this.len, pos:this.pos, sr:sampleRate, reverse:this.reverse, half:this.half, hasUndo:!!this.undo, target:this.target, bar:this.bar}); }
  process(inputs, outputs, p){
    if(this.dead) return false;
    const inp=inputs[0], out=outputs[0]; if(!out||!out.length) return true;
    const n=out[0].length, lvl=p.level[0], fb=p.feedback[0];
    const hasIn = inp && inp.length;
    for(let i=0;i<n;i++){
      const xL = hasIn?inp[0][i]:0, xR = hasIn?(inp[1]||inp[0])[i]:0;
      let lL=0,lR=0;
      if(this.state==='arm' && currentFrame+i>=this.armAt){ this.state='rec'; this.tick=1e9; }
      if(this.state==='rec'){
        if(this.pos<this.max){ this.buf[0][this.pos]=xL; this.buf[1][this.pos]=xR; this.pos++; if(this.target && this.pos>=this.target){ this.len=this.target; this.target=0; this.pos=0; this.fpos=0; this.state=this.after; this.tick=1e9; } }
        else { this.len=this.pos; this.pos=0; this.fpos=0; this.target=0; this.state='play'; }
      } else if(this.state==='play' || this.state==='over'){
        if(this.len>0){
          let rp;
          if(this.half){ rp=this.fpos; } else rp=this.pos;
          let idx = this.reverse ? (this.len-1-Math.floor(rp)) : Math.floor(rp);
          idx = ((idx%this.len)+this.len)%this.len;
          lL=this.buf[0][idx]; lR=this.buf[1][idx];
          if(this.state==='over'){ this.buf[0][idx]=lL*fb+xL; this.buf[1][idx]=lR*fb+xR; }
          if(this.half){ this.fpos+=0.5; if(this.fpos>=this.len) this.fpos-=this.len; this.pos=Math.floor(this.fpos); }
          else { this.pos++; if(this.pos>=this.len) this.pos=0; this.fpos=this.pos; }
        }
      }
      out[0][i]=xL+lL*lvl; if(out[1]) out[1][i]=xR+lR*lvl;
    }
    this.tick+=n; if(this.tick>sampleRate/15){ this.tick=0; this.report(); }
    return true;
  }
}

// ---------- Recorder (for WAV export and capture) ----------
class RecorderProcessor extends AudioWorkletProcessor {
  constructor(){ super(); this.on=false; this.chunks=[[],[]]; this.port.onmessage=(e)=>{ const m=e.data;
    if(m.cmd==='kill'){ this.dead=true; this.on=false; this.chunks=null; return; }
    if(m.cmd==='start'){ this.chunks=[[],[]]; this.on=true; }
    else if(m.cmd==='stop'){ this.on=false; const L=this.join(0), R=this.join(1); this.port.postMessage({done:true, L, R, sr:sampleRate},[L.buffer,R.buffer]); }
  }; }
  join(c){ let len=0; for(const k of this.chunks[c]) len+=k.length; const o=new Float32Array(len); let p=0; for(const k of this.chunks[c]){ o.set(k,p); p+=k.length; } return o; }
  process(inputs){ if(this.dead) return false; const inp=inputs[0]; if(this.on){ if(inp && inp.length){ this.chunks[0].push(inp[0].slice()); this.chunks[1].push((inp[1]||inp[0]).slice()); } else { const z=new Float32Array(128); this.chunks[0].push(z); this.chunks[1].push(z); } } return true; }
}

// ---------- Simple peak/RMS meter ----------
class MeterProcessor extends AudioWorkletProcessor {
  constructor(){ super(); this.peak=0; this.tick=0; }
  process(inputs){ const inp=inputs[0]; if(inp&&inp.length){ const n=inp[0].length; for(let c=0;c<inp.length;c++){ const b=inp[c]; for(let i=0;i<n;i++){ const v=Math.abs(b[i]); if(v>this.peak)this.peak=v; } } this.tick+=n; if(this.tick>sampleRate/30){ this.port.postMessage(this.peak); this.peak=0; this.tick=0; } } return true; }
}

// ---------- Neural model player (Clone block) ----------
// The model arrives as a plain description from NAMCore.parse on the page. The kernel bytes come in
// processorOptions. A new model warms up a few blocks per call, then takes over with a short crossfade.
let NAM_MOD = null;
class NamProcessor extends AudioWorkletProcessor {
  constructor(o){ super(); onKill(this); const kill = this.port.onmessage;
    this.cur = null; this.next = null; this.old = null; this.warm = 0; this.perQ = 4; this.pass = true;
    this.x = new Float32Array(128); this.y = new Float32Array(128); this.y2 = new Float32Array(128); this.z = new Float32Array(128);
    const w = o && o.processorOptions && o.processorOptions.wasm;
    if(!NAM_MOD && w){ try{ NAM_MOD = new WebAssembly.Module(w); }catch(e){ NAM_MOD = null; } }
    this.port.onmessage = (e) => { const m = e.data; if(!m) return; kill(e);
      if(m.cmd === 'clear'){ this.next = null; this.nextId = null; this.cur = null; this.old = null; this.pass = true; return; }
      if(m.cmd === 'model'){
        try{
          const pl = NAMCore.build(m.desc, NAM_MOD ? NAMCore.instantiate(NAM_MOD) : null);
          this.next = pl; this.nextId = m.id; this.warm = pl.prewarmBlocks(); this.perQ = Math.max(1, Math.min(64, Math.floor(0.7/Math.max(1e-6, (m.desc.macs || 1000)*6e-5*(pl.wasm ? 1 : 12)))));
          this.port.postMessage({state: 'loading', id: m.id, wasm: pl.wasm});
        }catch(err){ this.port.postMessage({state: 'error', error: String(err && err.message || err), id: m.id}); }
      }
    };
  }
  process(inputs, outputs){
    if(this.dead) return false;
    const out = outputs[0], inp = inputs[0], n = out[0].length, x = this.x;
    if(n !== 128){ for(let c = 0; c < out.length; c++){ if(inp && inp[c]) out[c].set(inp[c]); else out[c].fill(0); } return true; }
    if(inp && inp.length){ x.set(inp[0]); if(inp.length > 1){ const r = inp[1]; for(let i = 0; i < n; i++) x[i] = 0.5*(x[i] + r[i]); } } else x.fill(0);
    if(this.next){
      for(let i = 0; i < this.perQ && this.warm > 0; i++, this.warm--) this.next.process(this.z, this.y2, 128);
      if(this.warm <= 0){ this.old = this.cur; this.fadeDry = !this.cur && this.pass; this.cur = this.next; this.next = null; this.pass = false; this.port.postMessage({state: 'ready', id: this.nextId}); }
    }
    const y = this.y;
    if(this.cur){
      this.cur.process(x, y, 128);
      if(this.old){ this.old.process(x, this.y2, 128); const y2 = this.y2; for(let i = 0; i < 128; i++){ const f = i/128; y[i] = y[i]*f + y2[i]*(1 - f); } this.old = null; }
      else if(this.fadeDry){ for(let i = 0; i < 128; i++){ const f = i/128; y[i] = y[i]*f + x[i]*(1 - f); } this.fadeDry = false; }
    } else if(this.pass) y.set(x); else y.fill(0);
    for(let c = 0; c < out.length; c++) out[c].set(y);
    return true;
  }
}
registerProcessor('np-nam', NamProcessor);
registerProcessor('np-gate', GateProcessor);
registerProcessor('np-octave', OctaveProcessor);
registerProcessor('np-pitch', PitchProcessor);
registerProcessor('np-envfilter', EnvFilterProcessor);
registerProcessor('np-synth', SynthProcessor);
registerProcessor('np-crusher', CrusherProcessor);
registerProcessor('np-looper', LooperProcessor);
registerProcessor('np-recorder', RecorderProcessor);
registerProcessor('np-meter', MeterProcessor);
