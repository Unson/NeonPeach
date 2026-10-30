// ===== Neon Peach v2 blocks: new effects, routing, and the delay each block adds =====
'use strict';
CATS.splice(CATS.indexOf('Looper'), 0, 'Routing');
function lr4(ctx, type, f){ const a=ctx.createBiquadFilter(), b=ctx.createBiquadFilter(); a.type=b.type=type; a.Q.value=b.Q.value=Math.SQRT1_2; a.frequency.value=b.frequency.value=f; a.connect(b); return {i:a, o:b, set(v){ a.frequency.value=v; b.frequency.value=v; }}; }
function shDelay(ctx){ const d=ctx.createDelay(0.01); d.delayTime.value=SHAPER_LAT/ctx.sampleRate; return d; }

// --- Split Grind: clean lows, dirty highs. The modern metal bass trick. ---
def('mbdrive', { name:'Split Grind', cat:'Drive', desc:'Lows stay clean and tight. Highs get the dirt.',
  params:{ xo:P('Split at',80,600,250,'Hz'), drive:P('Drive',0,100,60,'%'), shape:E('Flavor',['Micro','Alpha','Omega','Fuzz'],1), lows:P('Lows',-24,12,0,'dB'), highs:P('Highs',-24,12,-2,'dB'), squeeze:P('Low Squeeze',0,100,40,'%'), attack:P('Attack',-6,12,4,'dB'), mid:P('Mids',-12,12,2,'dB'), highcut:P('High Cut',1500,12000,6000,'Hz') },
  build(ctx,b){ const n=b.n; n.lp=lr4(ctx,'lowpass',250); n.hp=lr4(ctx,'highpass',250); n.ld=shDelay(ctx); n.lc=compNode(ctx); n.lg=ctx.createGain();
    n.att=ctx.createBiquadFilter(); n.att.type='highshelf'; n.att.frequency.value=2800; { const sh=['micro','alpha','omega','fuzz'][b.p.shape|0]; n.sh=initCurve(shaperNode(ctx, makeCurve(sh, b.p.drive/100)), sh, b.p.drive); } n.dc=ctx.createBiquadFilter(); n.dc.type='highpass'; n.dc.frequency.value=12; n.cut=ctx.createBiquadFilter(); n.cut.type='lowpass'; n.cut.Q.value=0.6; n.md=ctx.createBiquadFilter(); n.md.type='peaking'; n.md.frequency.value=900; n.md.Q.value=0.8; n.hg=ctx.createGain();
    n.lc.parameters.get('attack').value=15; n.lc.parameters.get('release').value=150; n.lc.parameters.get('knee').value=6;
    b.wetIn.connect(n.lp.i); n.lp.o.connect(n.ld).connect(n.lc).connect(n.lg).connect(b.wetOut);
    b.wetIn.connect(n.hp.i); n.hp.o.connect(n.att).connect(n.sh).connect(n.dc).connect(n.cut).connect(n.md).connect(n.hg).connect(b.wetOut); },
  apply(b){ const n=b.n,p=b.p, sh=['micro','alpha','omega','fuzz'][p.shape|0]; n.lp.set(p.xo); n.hp.set(p.xo); setCurve(n.sh, sh+':'+p.drive, ()=>makeCurve(sh, p.drive/100)); n.att.gain.value=p.attack; n.cut.frequency.value=p.highcut; n.md.gain.value=p.mid;
    wp(n.lc,'threshold',-6-p.squeeze*0.3); wp(n.lc,'ratio',1+p.squeeze/100*5); wp(n.lc,'makeup',p.squeeze*0.06); setP(n.lg.gain,dB(p.lows)); setP(n.hg.gain,dB(p.highs)*0.55); } });

// --- Peach Muff: a big wall of fuzz with the scooped tone knob ---
def('muff', { name:'Peach Muff', cat:'Drive', desc:'Thick fuzz. Tone sweeps from dark to bright, with a mid scoop.',
  params:{ sustain:P('Sustain',0,100,70,'%'), tone:P('Tone',0,100,50,'%'), mids:P('Mids',-12,12,0,'dB'), blend:P('Blend',0,100,70,'%'), level:P('Level',-24,24,0,'dB'), grunt:P('Grunt',30,300,60,'Hz') },
  build(ctx,b){ const n=b.n; n.hp=ctx.createBiquadFilter(); n.hp.type='highpass'; n.sh=initCurve(shaperNode(ctx, makeCurve('muff',0.2+b.p.sustain/100*0.8)), 'muff', b.p.sustain); n.dc=ctx.createBiquadFilter(); n.dc.type='highpass'; n.dc.frequency.value=12;
    n.tl=ctx.createBiquadFilter(); n.tl.type='lowpass'; n.tl.frequency.value=650; n.th=ctx.createBiquadFilter(); n.th.type='highpass'; n.th.frequency.value=1100; n.gl=ctx.createGain(); n.gh=ctx.createGain(); n.md=ctx.createBiquadFilter(); n.md.type='peaking'; n.md.frequency.value=900; n.md.Q.value=0.7; n.lvl=ctx.createGain(); n.dd=shDelay(ctx); n.dry=ctx.createGain();
    b.wetIn.connect(n.hp).connect(n.sh).connect(n.dc); n.dc.connect(n.tl).connect(n.gl).connect(n.md); n.dc.connect(n.th).connect(n.gh).connect(n.md); n.md.connect(n.lvl).connect(b.wetOut); b.wetIn.connect(n.dd).connect(n.dry).connect(b.wetOut); },
  apply(b){ const n=b.n,p=b.p; n.hp.frequency.value=p.grunt; setCurve(n.sh,'muff:'+p.sustain,()=>makeCurve('muff',0.2+p.sustain/100*0.8)); const t=p.tone/100; setP(n.gl.gain,1-t); setP(n.gh.gain,t*1.6); n.md.gain.value=p.mids; const bl=p.blend/100; setP(n.lvl.gain,dB(p.level)*Math.sin(bl*Math.PI/2)*0.7); setP(n.dry.gain,Math.cos(bl*Math.PI/2)); } });

// --- Octave Fuzz: rectified fuzz that adds an octave up ---
def('octfuzz', { name:'Octave Fuzz', cat:'Drive', desc:'Fuzz with a ringing octave up. Best played high on the neck.', params:driveParams(150,3,70,2), build:buildDrive, apply(b){ applyDrive(b,'rect'); } });

// --- Three Band Squeeze: a compressor for lows, mids and highs ---
def('mbcomp', { name:'Three Band Squeeze', cat:'Dynamics', desc:'Holds the lows steady, and lets the attack through up top.', gr:true,
  params:{ xo1:P('Low Split',60,400,150,'Hz'), xo2:P('High Split',500,5000,1800,'Hz'), tlo:P('Low Thresh',-60,0,-24,'dB'), tmid:P('Mid Thresh',-60,0,-20,'dB'), thi:P('High Thresh',-60,0,-18,'dB'), ratio:P('Ratio',1,20,4,':1'), attack:P('Attack',0.1,100,10,'ms'), release:P('Release',10,1000,140,'ms'), glo:P('Low Gain',-12,12,2,'dB'), gmid:P('Mid Gain',-12,12,0,'dB'), ghi:P('High Gain',-12,12,1,'dB') },
  build(ctx,b){ const n=b.n; n.l1=lr4(ctx,'lowpass',150); n.h1=lr4(ctx,'highpass',150); n.al=lr4(ctx,'lowpass',1800); n.ah=lr4(ctx,'highpass',1800); n.ap=ctx.createGain(); n.m2=lr4(ctx,'lowpass',1800); n.h2=lr4(ctx,'highpass',1800);
    n.c=[compNode(ctx),compNode(ctx),compNode(ctx)]; n.g=[ctx.createGain(),ctx.createGain(),ctx.createGain()]; b.gr=0;
    n.c.forEach((c,i)=>{ c.port.onmessage=e=>{ (b.grs||(b.grs=[0,0,0]))[i]=e.data.gr; b.gr=Math.min(...b.grs); }; });
    b.wetIn.connect(n.l1.i); n.l1.o.connect(n.al.i); n.l1.o.connect(n.ah.i); n.al.o.connect(n.ap); n.ah.o.connect(n.ap); n.ap.connect(n.c[0]);   // low band, phase-matched to the high split
    b.wetIn.connect(n.h1.i); n.h1.o.connect(n.m2.i); n.h1.o.connect(n.h2.i); n.m2.o.connect(n.c[1]); n.h2.o.connect(n.c[2]);
    n.c.forEach((c,i)=>c.connect(n.g[i]).connect(b.wetOut)); },
  apply(b){ const n=b.n,p=b.p; n.l1.set(p.xo1); n.h1.set(p.xo1); [n.al,n.ah,n.m2,n.h2].forEach(f=>f.set(p.xo2)); [p.tlo,p.tmid,p.thi].forEach((t,i)=>{ const c=n.c[i]; wp(c,'threshold',t); wp(c,'ratio',p.ratio); wp(c,'attack',p.attack*(i===0?2:1)); wp(c,'release',p.release*(i===0?1.5:1)); wp(c,'knee',6); });
    [p.glo,p.gmid,p.ghi].forEach((g,i)=>setP(n.g[i].gain,dB(g))); } });

// --- Auto Swell: every note fades in ---
def('swell', { name:'Auto Swell', cat:'Dynamics', desc:'Fades each note in, like a volume pedal. Great for pads.',
  params:{ thr:P('Sensitivity',-70,-15,-42,'dB'), attack:P('Swell Time',20,3000,450,'ms') },
  build(ctx,b){ b.n.s=new AudioWorkletNode(ctx,'np-swell',{outputChannelCount:[2]}); b.wetIn.connect(b.n.s).connect(b.wetOut); },
  apply(b){ wp(b.n.s,'thr',b.p.thr); wp(b.n.s,'attack',b.p.attack); } });

// --- Reverse Delay ---
def('revdelay', { name:'Reverse Delay', cat:'Delay', desc:'Each echo plays backwards.',
  params:{ time:P('Time',100,2000,600,'ms'), sync:E('Sync',SYNC,2), fb:P('Feedback',0,90,30,'%'), mix:P('Mix',0,100,45,'%') },
  build(ctx,b){ b.n.r=new AudioWorkletNode(ctx,'np-revdelay',{outputChannelCount:[2]}); b.wetIn.connect(b.n.r).connect(b.wetOut); },
  apply(b){ const n=b.n,p=b.p; wp(n.r,'time',clampN(delayTimeMs(p),100,2000)); wp(n.r,'feedback',p.fb/100); wp(n.r,'mix',p.mix/100); } });

// --- Freeze: turn it on and it holds the note you just played ---
def('freeze', { name:'Freeze', cat:'Synth', desc:'Turn it on to hold the sound you just played, as a pad. Play over the top.',
  params:{ level:P('Pad Level',0,200,90,'%'), dry:P('Dry',0,100,100,'%'), size:P('Grab Size',80,1000,320,'ms') },
  build(ctx,b){ b.n.f=new AudioWorkletNode(ctx,'np-freeze',{outputChannelCount:[2]}); b.wetIn.connect(b.n.f).connect(b.wetOut); },
  apply(b){ wp(b.n.f,'level',b.p.level/100); wp(b.n.f,'dry',b.p.dry/100); wp(b.n.f,'size',b.p.size); },
  onBypass(b,on,inst){ if(inst) return; b.n.f.port.postMessage({cmd:on?'let':'grab'}); } });

// --- Talk Box ---
const VOWEL_NAMES=['A','E','I','O','U'];
def('vowel', { name:'Talk Box', cat:'Filter', desc:'Makes your bass say vowels. Dig in to say "wow".',
  params:{ mode:E('Moves with',['Your picking','Wobble','Exp pedal'],0), from:E('From',VOWEL_NAMES,3), to:E('To',VOWEL_NAMES,0), sens:P('Sensitivity',0,100,55,'%'), rate:P('Wobble Rate',0.05,10,1.5,'Hz'), pos:P('Pedal',0,100,50,'%'), q:P('Focus',1,30,9,''), mix:P('Mix',0,100,100,'%') },
  build(ctx,b){ b.n.v=new AudioWorkletNode(ctx,'np-vowel',{outputChannelCount:[2]}); b.wetIn.connect(b.n.v).connect(b.wetOut); },
  apply(b){ const n=b.n,p=b.p; wp(n.v,'mode',p.mode); wp(n.v,'from',p.from); wp(n.v,'to',p.to); wp(n.v,'sens',p.sens/100); wp(n.v,'rate',p.rate); wp(n.v,'pos',p.pos/100); wp(n.v,'q',p.q); wp(n.v,'mix',p.mix/100); } });

// --- Stutter ---
const STUT_DIV=['1/4','1/8','1/16','1/32','1/8 trip','1/16 trip'], STUT_N=[1,2,4,8,3,6];
def('stutter', { name:'Stutter', cat:'Mod', desc:'Chops your sound in time with the tempo, or repeats slices.',
  params:{ mode:E('Mode',['Chop','Repeat'],0), div:E('Speed',STUT_DIV,2), duty:P('Length',5,95,50,'%'), mix:P('Mix',0,100,100,'%'), sync:{l:'sync',def:1,hidden:true} },
  build(ctx,b){ b.n.s=new AudioWorkletNode(ctx,'np-stutter',{outputChannelCount:[2]}); b.wetIn.connect(b.n.s).connect(b.wetOut); },
  apply(b){ const n=b.n,p=b.p; wp(n.s,'bpm',NP.bpm); wp(n.s,'div',STUT_N[p.div|0]); wp(n.s,'mode',p.mode); wp(n.s,'duty',p.duty/100); wp(n.s,'mix',p.mix/100); } });

// --- Doubler ---
def('doubler', { name:'Doubler', cat:'Mod', desc:'Sounds like two basses playing at once. Lows stay in the middle.',
  params:{ time:P('Spread Time',5,40,16,'ms'), depth:P('Wobble',0,100,30,'%'), width:P('Width',0,100,80,'%'), keep:P('Keep Lows Mono',40,600,180,'Hz'), mix:P('Mix',0,100,50,'%') },
  build(ctx,b){ const n=b.n; n.hp=ctx.createBiquadFilter(); n.hp.type='highpass'; n.d1=ctx.createDelay(0.1); n.d2=ctx.createDelay(0.1); n.l1=mkLFO(ctx,'sine'); n.l2=mkLFO(ctx,'triangle'); n.g1=ctx.createGain(); n.g2=ctx.createGain(); n.p1=ctx.createStereoPanner(); n.p2=ctx.createStereoPanner(); n.w=ctx.createGain();
    n.l1.connect(n.g1).connect(n.d1.delayTime); n.l2.connect(n.g2).connect(n.d2.delayTime); b.wetIn.connect(n.hp); n.hp.connect(n.d1).connect(n.p1).connect(n.w); n.hp.connect(n.d2).connect(n.p2).connect(n.w); n.w.connect(b.wetOut); b.wetIn.connect(b.wetOut); },
  apply(b){ const n=b.n,p=b.p; n.hp.frequency.value=p.keep; n.d1.delayTime.value=p.time/1000; n.d2.delayTime.value=p.time*1.37/1000; n.l1.frequency.value=0.31; n.l2.frequency.value=0.23; const dp=p.depth/100*0.0012; n.g1.gain.value=dp; n.g2.gain.value=dp; n.p1.pan.value=-p.width/100; n.p2.pan.value=p.width/100; setP(n.w.gain,p.mix/100*0.8); } });

// --- Tilt EQ: one knob, dark to bright ---
def('tilt', { name:'Tilt EQ', cat:'EQ', desc:'One knob. Turn left for darker, right for brighter.',
  params:{ tilt:P('Tilt',-12,12,0,'dB'), center:P('Center',150,3000,700,'Hz'), level:P('Level',-12,12,0,'dB') },
  build(ctx,b){ const n=b.n; n.lo=ctx.createBiquadFilter(); n.lo.type='lowshelf'; n.hi=ctx.createBiquadFilter(); n.hi.type='highshelf'; n.l=ctx.createGain(); b.wetIn.connect(n.lo).connect(n.hi).connect(n.l).connect(b.wetOut); },
  apply(b){ const n=b.n,p=b.p; n.lo.frequency.value=p.center; n.hi.frequency.value=p.center; n.lo.gain.value=-p.tilt/2; n.hi.gain.value=p.tilt/2; setP(n.l.gain,dB(p.level)); } });

// --- FX Loop: send to a real pedal through spare interface jacks, and bring it back ---
const LOOP_OUTS=['Out 3-4','Out 5-6','Out 7-8'];
function fxMonoInput(){ try{ const t=typeof UI!=='undefined'&&UI.stream&&UI.stream.getAudioTracks()[0], s=t&&t.getSettings&&t.getSettings(); return !!(s&&s.channelCount===1); }catch(e){ return false; } }
def('fxloop', { name:'FX Loop', cat:'Routing', desc:'Put a real pedal in the chain. Uses a spare output and input on your interface.',
  params:{ out:E('Send to',LOOP_OUTS,0), jack:E('Return from',['Input 1','Input 2'],1), send:P('Send',-24,12,0,'dB'), ret:P('Return',-24,24,0,'dB'), mix:P('Mix',0,100,100,'%'), phase:B('Flip Phase',0) },
  build(ctx,b){ const n=b.n, r=NP.rig; n.send=ctx.createGain(); n.sp=ctx.createChannelSplitter(2); n.ret=ctx.createGain(); n.ret.channelCount=1; n.ret.channelCountMode='explicit'; n.rw=ctx.createGain(); n.dg=ctx.createGain(); n.on=ctx.createGain();
    n.dd=ctx.createDelay(1); b.wetIn.connect(n.send).connect(n.on).connect(n.sp); b.wetIn.connect(n.dd).connect(n.dg).connect(b.wetOut); n.ret.connect(n.rw).connect(b.wetOut); n.cur=null; },
  // the pedal's trip out and back takes the interface's round trip. The ping test measures it; the dry blend waits that long.
  lat(b){ return UI&&UI.pingMs ? UI.pingMs*NP.ctx.sampleRate/1000 : 0; },
  note(b){ return b.n.warn||''; },
  apply(b){ const n=b.n,p=b.p,r=NP.rig,g=NP.globals||{}, N=outChannels(), ch=2+(p.out|0)*2, mono=fxMonoInput(), ic=g.inCh|0;
    let warn=''; if(ch+1>=N) warn='This interface has no '+LOOP_OUTS[p.out|0]+'. The loop is off.';
    else if(ch===(g.mainOut|0)*2 || (NP.auxLive && ch===(g.auxOut|0)*2)) warn=LOOP_OUTS[p.out|0]+' is already used by '+(ch===(g.mainOut|0)*2?'Main':'Aux')+'. Pick another pair. The loop is off.';
    else if(mono) warn='Your input is mono, so there is no second jack to come back on. The loop is off.';
    else if(ic===2 || ic===(p.jack|0)) warn='Your bass comes in on that same jack. Return the pedal on the other input, or set your bass to one input on the Audio page. The loop is off.';
    const key=warn?'off':(p.out|0)+':'+(p.jack|0);
    if(n.cur!==key){ try{ n.sp.disconnect(); }catch(e){} if(n.jk!=null){ try{ r.inSplit.disconnect(n.ret, n.jk); }catch(e){} n.jk=null; }
      if(!warn){ n.sp.connect(r.merge,0,ch); n.sp.connect(r.merge,1,ch+1); n.jk=p.jack|0; r.inSplit.connect(n.ret, n.jk); } n.cur=key; if(warn && NP.ready) toast(warn, 4200); }
    n.warn=warn; const m=warn?0:p.mix/100; n.dd.delayTime.value=Math.min(0.9, UI&&UI.pingMs?UI.pingMs/1000:0); setP(n.send.gain,dB(p.send)); setP(n.rw.gain,dB(p.ret)*m*(p.phase?-1:1)); setP(n.dg.gain,1-m); },
  onBypass(b,on){ setP(b.n.on.gain,on?0:1); },
  destroy(b){ const n=b.n; try{ if(n.jk!=null) NP.rig.inSplit.disconnect(n.ret, n.jk); }catch(e){} } });

// --- Aux Send: copies the sound at this spot to the Aux outputs (for example, before the cab, for your stage amp) ---
def('auxsend', { name:'Aux Send', cat:'Routing', desc:'Sends the sound at this spot to the Aux outputs. Put it before the cab to feed a stage amp.',
  params:{ level:P('Level',-60,12,0,'dB') },
  build(ctx,b){ const n=b.n; n.g=ctx.createGain(); n.on=ctx.createGain(); b.wetIn.connect(b.wetOut); b.wetIn.connect(n.g).connect(n.on).connect(NP.rig.auxSends); },
  apply(b){ setP(b.n.g.gain,dB(b.p.level)); },
  onBypass(b,on){ setP(b.n.on.gain,on?0:1); } });

// the delay each block adds, in samples
['b3k','vintage','alpha','omega','ignis','od','fold','tubepre','octfuzz','muff','mbdrive','amp','capture'].forEach(t=>{ BLOCKS[t].lat=SHAPER_LAT; });

// short notes for the block picker
const DESC={ comp:'Evens out your playing. Blend keeps the attack.', gate:'Cuts hiss and hum when you stop playing.', limiter:'A hard ceiling. Nothing gets louder than this.', b3k:'Gritty, punchy drive with a clean blend.', vintage:'Warm, round tube-style drive.', alpha:'Tight modern crunch.', omega:'Big, growling distortion.', ignis:'Raw fuzz.', od:'Smooth overdrive.', fold:'Wild folding distortion. Synth-like.', tubepre:'A gentle tube preamp glow.', amp:'Eight amp heads with a tone stack.', capture:'An old-style capture.', clone:'A pedal or plugin you copied, or a .nam file.', cab:'Speaker cabinet and mic. Load your own IRs too.', peq:'Five-band parametric EQ.', geq:'Ten sliders, from 31 Hz to 16 kHz.', tone6:'Six knobs tuned for bass.', cut:'Cut the lowest lows and the fizz.', octave:'Analog-style octave down. Tracks fast.', pitch:'Shift up or down by any amount.', harm:'Adds two harmony voices.', synth:'A synth that follows the notes you play.', envf:'Funky auto-wah that follows your picking.', wah:'A wah you sweep with the expression pedal.', filter:'Low pass, high pass, band pass or notch.', chorus:'Shimmer and width.', flanger:'Jet-plane swoosh.', phaser:'Swirl.', trem:'Pulses the volume.', vibrato:'Wobbles the pitch.', rotary:'A spinning speaker.', ring:'Metallic, bell-like tones.', crush:'Lo-fi and broken, on purpose.', delay:'Echoes. Digital, tape, analog or ping pong.', mdelay:'Up to four echo taps.', reverb:'Rooms, halls, springs and shimmer.', vol:'Volume, pan, mute and phase.', widen:'Make it wider, or mono.', boost:'A clean push.', xover:'Tilt the lows against the highs.', looper:'Record a loop and play over it.' };
Object.entries(DESC).forEach(([t,d])=>{ if(BLOCKS[t] && !BLOCKS[t].desc) BLOCKS[t].desc=d; });
