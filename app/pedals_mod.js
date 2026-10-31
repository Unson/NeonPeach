// ===== Neon Peach 2.4: modulation, rebuilt as pedal models. Each def() here replaces the block of the same type from engine.js. =====
// Chorus, tremolo, vibrato, rotary and ring mod are plain node graphs (delay, biquad, oscillator, gain, panner, wave shaper), so both engines
// play them the same with no C++. Flanger, phaser and bit crusher are worklets (worklets_mod.js) with C++ twins (procs_mod.cpp): the first two
// need one-sample feedback, which a node loop cannot give.
'use strict';

// A gentle soft clip for the LFO-free parts of a BBD line: x -> tanh(k x)/k. Small signals pass as they are, loud ones round off.
function bbdCurve(k){ const N=8192, c=new Float32Array(N); for(let i=0;i<N;i++){ const x=(i/(N-1))*2-1; c[i]=Math.tanh(k*x)/k; } return c; }
// A curve that turns an LFO (-1..1) into a 0..1 control: c = 1 - ((1-l)/2)^pw. pw 1 is a plain crossfade, higher stays near the top longer and dips quicker.
function lfoCurve(pw){ const N=8192, c=new Float32Array(N); for(let i=0;i<N;i++){ const x=(i/(N-1))*2-1; c[i]=1-Math.pow(Math.max(0,(1-x)/2), pw); } return c; }
// Re-send a shaper curve only when its key changes (curves are 8192 floats; do not send them on every knob move).
function keyCurve(node, key, make){ if(node._ck===key) return; node._ck=key; node.curve=make(); }
// The BBD lowpass: a longer delay means a slower clock, which means a darker line. 5 ms is about 9 kHz, 20 ms is under 2.5 kHz.
function bbdLP(ms, tone){ return Math.min(tone, 46000/ms); }

// ---------- Peach Chorus: bucket-brigade chorus in three flavours ----------
// Each line: in -> soft clip -> BBD lowpass -> delay (swept by its own triangle LFO) -> level -> pan. Lines: [delay ms, swing ms at full depth, pan, LFO sign, rate multiplier, level]
const CHORUS_MODELS=[
  { name:'CE-2', sat:1.6, lines:[[5.5,3.5,0,1,1,1.4]], extra:[8.5,2.5,0,-1,1,1.1] },                                   // one dark BBD, mono. Voices 3 adds a second line swept the other way.
  { name:'Dimension D', sat:1.0, lines:[[9,2.5,-0.75,1,1,1],[14,2.5,0.75,-1,1,1]], extra:[21,2,0,1,0.73,0.8] },          // two lines in opposite phase, left and right: wide, no obvious wobble
  { name:'Tri-Chorus', sat:1.0, lines:[[7,3.5,-0.9,1,1,1],[12,3,0.9,-1,1.37,1],[18,2.5,0,1,0.73,1]], extra:null } ];   // three lines at three rates, always on
function chorusLines(p){ const m=CHORUS_MODELS[p.model|0]||CHORUS_MODELS[1]; const L=m.lines.slice(); if(m.extra && p.voices) L.push(m.extra); while(L.length<3) L.push(null); return L; }
// Every gain in the chorus from the settings. Wet lines are scaled so the loudest channel's wet adds up to the mix amount.
function chorusGains(p){ const L=chorusLines(p), mix=p.mix/100; let sL=0, sR=0; L.forEach(l=>{ if(!l) return; const x=(l[2]+1)/2; sL+=l[5]*Math.cos(x*Math.PI/2); sR+=l[5]*Math.sin(x*Math.PI/2); }); const norm=1/Math.max(0.5,sL,sR);
  return { dry:1-0.5*mix, lv:L.map(l=>l?l[5]*norm*mix*0.8:0), sw:L.map(l=>l?l[3]*l[1]/1000*p.depth/100:0) }; }
def('chorus', { name:'Peach Chorus', cat:'Mod', color:'#9cf', desc:'Bucket-brigade chorus. CE-2 warmth, Dimension D width, or a three-line Tri-Chorus.',
  params:{ rate:P('Rate',0.05,10,0.8,'Hz'), depth:P('Depth',0,100,40,'%'), mix:P('Mix',0,100,50,'%'), tone:P('Tone',500,12000,6000,'Hz'), voices:E('Voices',['2','3'],0), model:E('Model',['CE-2','Dimension D','Tri-Chorus'],1) },
  note(b){ const m=b.p.model|0; return m===0 ? 'One dark BBD line, like the pedal. Voices 3 adds a second line swept the other way. Mix 50 is the real pedal.' : m===1 ? 'Two lines move in opposite directions, left and right. Wide, with no obvious wobble. Voices 3 adds a slow middle line.' : 'Three lines at three speeds. Always three; the Voices switch does nothing here.'; },
  build(ctx,b){ const n=b.n, p=b.p, g=chorusGains(p), L=chorusLines(p), m=CHORUS_MODELS[p.model|0]||CHORUS_MODELS[1];
    n.sat=ctx.createWaveShaper(); keyCurve(n.sat,'k'+m.sat,()=>bbdCurve(m.sat)); n.dry=ctx.createGain(); n.dry.gain.value=g.dry; n.wet=ctx.createGain();
    n.lfo=[]; n.lg=[]; n.lp=[]; n.d=[]; n.lv=[]; n.pan=[];
    for(let i=0;i<3;i++){ const l=L[i]; const o=mkLFO(ctx,'triangle'); o.frequency.value=p.rate*(l?l[4]:1); const lg=ctx.createGain(); lg.gain.value=g.sw[i]; const lp=ctx.createBiquadFilter(); lp.type='lowpass'; lp.Q.value=0.7; lp.frequency.value=l?bbdLP(l[0],p.tone):p.tone;
      const d=ctx.createDelay(0.06); d.delayTime.value=l?l[0]/1000:0.01; const lv=ctx.createGain(); lv.gain.value=g.lv[i]; const pan=ctx.createStereoPanner(); pan.pan.value=l?l[2]:0;
      o.connect(lg).connect(d.delayTime); n.sat.connect(lp).connect(d).connect(lv).connect(pan).connect(n.wet); n.lfo.push(o); n.lg.push(lg); n.lp.push(lp); n.d.push(d); n.lv.push(lv); n.pan.push(pan); }
    b.wetIn.connect(n.sat); n.wet.connect(b.wetOut); b.wetIn.connect(n.dry).connect(b.wetOut); },
  apply(b){ const n=b.n, p=b.p, g=chorusGains(p), L=chorusLines(p), m=CHORUS_MODELS[p.model|0]||CHORUS_MODELS[1]; keyCurve(n.sat,'k'+m.sat,()=>bbdCurve(m.sat)); setP(n.dry.gain,g.dry);
    for(let i=0;i<3;i++){ const l=L[i]; n.lfo[i].frequency.value=p.rate*(l?l[4]:1); n.lg[i].gain.value=g.sw[i]; n.lp[i].frequency.value=l?bbdLP(l[0],p.tone):p.tone; setP(n.d[i].delayTime,l?l[0]/1000:0.01,0.05); setP(n.lv[i].gain,g.lv[i]); n.pan[i].pan.value=l?l[2]:0; } }
});

// ---------- Flanger: Electric Mistress / ADA / through-zero BBD flanger (worklet np-flanger) ----------
def('flanger', { name:'Flanger', cat:'Mod', color:'#9cf', desc:'BBD flanger. Electric Mistress, ADA, or a through-zero jet.',
  params:{ rate:P('Rate',0.05,5,0.3,'Hz'), depth:P('Depth',0,100,60,'%'), fb:P('Feedback',-95,95,50,'%'), manual:P('Manual',0.5,8,2,'ms'), mix:P('Mix',0,100,50,'%'), model:E('Model',['Mistress','ADA','Through-Zero'],1), polarity:E('Polarity',['Positive','Negative'],0) },
  lat(b){ return (b.p.model|0)===2 ? Math.round(b.p.manual*NP.ctx.sampleRate/1000) : 0; },   // through-zero holds the dry side back by Manual ms
  note(b){ const m=b.p.model|0; return m===0 ? 'Slow, lush and dark. Feedback is held under 80%. Negative polarity thins it out.' : m===1 ? 'Deep sweep, bright, feedback up to 95% for the metallic peak. Polarity is the ADA Even/Odd switch.' : 'The dry side waits Manual ms and the wet side sweeps across it. Set Negative polarity for the full jet cancel at the crossing.'; },
  build(ctx,b){ const n=b.n, p=b.p; n.f=new AudioWorkletNode(ctx,'np-flanger',{outputChannelCount:[2], parameterData:{rate:p.rate, depth:p.depth/100, fb:p.fb/100, manual:p.manual, mix:p.mix/100, model:p.model|0, polarity:p.polarity|0}}); b.wetIn.connect(n.f).connect(b.wetOut); },
  apply(b){ const n=b.n, p=b.p; wp(n.f,'rate',p.rate); wp(n.f,'depth',p.depth/100); wp(n.f,'fb',p.fb/100); wp(n.f,'manual',p.manual); wp(n.f,'mix',p.mix/100); n.f.parameters.get('model').value=p.model|0; n.f.parameters.get('polarity').value=p.polarity|0; }
});

// ---------- Phaser: Phase 90 / Small Stone / Univibe (worklet np-phaser) ----------
// The stages sweep in octaves around Center, so the sweep sounds even from top to bottom. Feedback comes back one sample later, as in the circuit.
def('phaser', { name:'Phaser', cat:'Mod', color:'#9cf', desc:'Phase 90, Small Stone, or a Univibe with its lamp-and-photocell throb.',
  params:{ rate:P('Rate',0.05,8,0.5,'Hz'), depth:P('Depth',0,100,70,'%'), center:P('Center',100,3000,600,'Hz'), stages:E('Stages',['4','6','8'],0), fb:P('Feedback',0,90,30,'%'), mix:P('Mix',0,100,50,'%'), model:E('Model',['Phase 90','Small Stone','Univibe'],0), color:B('Color',0) },
  note(b){ const m=b.p.model|0; return m===0 ? 'Four matched stages and a triangle sweep. Mix 50 gives the deepest notches.' : m===1 ? 'A rounder, wider sweep. Color adds regeneration for the hollow EHX sound.' : 'The stages sit at four different pitches and the lamp flashes once a cycle. Mix 100 is Vibrato mode, with no dry.'; },
  spec(b,k,s){ if(k==='color' && (b.p.model|0)!==1) return Object.assign({},s,{l:'Color (Small Stone)'}); return null; },
  build(ctx,b){ const n=b.n, p=b.p; n.f=new AudioWorkletNode(ctx,'np-phaser',{outputChannelCount:[2], parameterData:{rate:p.rate, depth:p.depth/100, center:p.center, stages:[4,6,8][p.stages|0]||4, fb:p.fb/100, mix:p.mix/100, model:p.model|0, color:p.color|0}}); b.wetIn.connect(n.f).connect(b.wetOut); },
  apply(b){ const n=b.n, p=b.p; wp(n.f,'rate',p.rate); wp(n.f,'depth',p.depth/100); wp(n.f,'center',p.center); n.f.parameters.get('stages').value=[4,6,8][p.stages|0]||4; wp(n.f,'fb',p.fb/100); wp(n.f,'mix',p.mix/100); n.f.parameters.get('model').value=p.model|0; n.f.parameters.get('color').value=p.color|0; }
});

// ---------- Tremolo: optical, bias, or harmonic ----------
// The LFO goes through a lowpass (so Square has no click) and then a curve that gives each model its own wave. The sound is split into two bands with a
// Linkwitz-Riley crossover that sums flat; Optical and Bias move both bands together, Harmonic moves them against each other.
const TREM_PW=[2.0,1.2,1];   // curve power per model: Optical stays loud and dips quick (the photocell), Bias is a soft throb, Harmonic is a plain crossfade
function tremGains(p){ const d=p.depth/100, h=(p.model|0)===2, bias=(p.model|0)===1;
  return { lo:1-d, hi:h?1:1-d, dgL:d, dgH:h?-d:d, pg:p.stereo?0.9:0, dop:bias?0.0004*d:0, tone:bias?500*d:0, dly:bias?0.0008:0 }; }
def('trem', { name:'Tremolo', cat:'Mod', color:'#9cf', desc:'Optical, tube-bias, or Brownface harmonic tremolo. Three real amp circuits.',
  params:{ rate:P('Rate',0.1,20,4,'Hz'), depth:P('Depth',0,100,60,'%'), shape:E('Shape',['Sine','Triangle','Square'],0), stereo:B('Stereo Pan',0), model:E('Model',['Optical','Bias','Harmonic'],0) },
  note(b){ const m=b.p.model|0; return m===0 ? 'A lamp and a photocell. Smooth, with a wider dip than peak.' : m===1 ? 'The tubes themselves pulse. Throbbing, with a little pitch and tone wobble on top.' : 'Lows and highs pulse against each other, split at 650 Hz. Sounds halfway to a Univibe.'; },
  build(ctx,b){ const n=b.n, p=b.p, g=tremGains(p);
    n.lfo=mkLFO(ctx,['sine','triangle','square'][p.shape|0]); n.lfo.frequency.value=p.rate; n.sm=ctx.createBiquadFilter(); n.sm.type='lowpass'; n.sm.frequency.value=50; n.sm.Q.value=0.5;
    n.sh=ctx.createWaveShaper(); keyCurve(n.sh,'pw'+TREM_PW[p.model|0],()=>lfoCurve(TREM_PW[p.model|0]));
    n.dgL=ctx.createGain(); n.dgL.gain.value=g.dgL; n.dgH=ctx.createGain(); n.dgH.gain.value=g.dgH; n.pg=ctx.createGain(); n.pg.gain.value=g.pg; n.dop=ctx.createGain(); n.dop.gain.value=g.dop; n.tg=ctx.createGain(); n.tg.gain.value=g.tone;
    n.dly=ctx.createDelay(0.01); n.dly.delayTime.value=g.dly; n.tone=ctx.createBiquadFilter(); n.tone.type='lowpass'; n.tone.frequency.value=(p.model|0)===1?2500:ctx.sampleRate/2; n.tone.Q.value=0.5;   // at half the sample rate the filter is a straight wire
    n.lp=lr4(ctx,'lowpass',650); n.hp=lr4(ctx,'highpass',650); n.lo=ctx.createGain(); n.lo.gain.value=g.lo; n.hi=ctx.createGain(); n.hi.gain.value=g.hi; n.pan=ctx.createStereoPanner();
    n.lfo.connect(n.sm).connect(n.sh); n.sh.connect(n.dgL).connect(n.lo.gain); n.sh.connect(n.dgH).connect(n.hi.gain); n.sm.connect(n.pg).connect(n.pan.pan); n.sm.connect(n.dop).connect(n.dly.delayTime); n.sm.connect(n.tg).connect(n.tone.detune);
    b.wetIn.connect(n.dly).connect(n.tone); n.tone.connect(n.lp.i); n.lp.o.connect(n.lo).connect(n.pan); n.tone.connect(n.hp.i); n.hp.o.connect(n.hi).connect(n.pan); n.pan.connect(b.wetOut); },
  apply(b){ const n=b.n, p=b.p, g=tremGains(p); n.lfo.frequency.value=p.rate; n.lfo.type=['sine','triangle','square'][p.shape|0]; keyCurve(n.sh,'pw'+TREM_PW[p.model|0],()=>lfoCurve(TREM_PW[p.model|0]));
    setP(n.lo.gain,g.lo); setP(n.hi.gain,g.hi); setP(n.dgL.gain,g.dgL); setP(n.dgH.gain,g.dgH); setP(n.pg.gain,g.pg); setP(n.dop.gain,g.dop); setP(n.tg.gain,g.tone); setP(n.dly.delayTime,g.dly,0.05); n.tone.frequency.value=(p.model|0)===1?2500:NP.ctx.sampleRate/2; }
});

// ---------- Vibrato: a BBD line swept by the LFO, with a Rise control ----------
// Rise: the sound's own level is rectified (a |x| curve), smoothed by a slow lowpass, squashed to 0..1, and used to scale the LFO. So each note's
// wobble fades in, like a player's hand. At Rise 0 the LFO goes straight through.
function vibGains(p){ const r=p.rise>0; return { sw:p.depth/100*0.004, envOn:r?1:0, lfoOn:r?0:1, fc:r?Math.max(0.1,1000/(2*Math.PI*p.rise*0.35)):10 }; }
def('vibrato', { name:'Vibrato', cat:'Mod', color:'#9cf', desc:'BBD pitch vibrato. Rise makes the wobble fade in after each note starts.',
  params:{ rate:P('Rate',0.5,12,5,'Hz'), depth:P('Depth',0,100,30,'%'), rise:P('Rise',0,2000,0,'ms'), shape:E('Shape',['Sine','Triangle'],0) },
  note(b){ return b.p.rise>0 ? 'Each note starts straight and the wobble grows in over about '+Math.round(b.p.rise)+' ms.' : 'Set Rise above 0 to make the wobble fade in after each note starts.'; },
  build(ctx,b){ const n=b.n, p=b.p, g=vibGains(p);
    n.lfo=mkLFO(ctx,p.shape?'triangle':'sine'); n.lfo.frequency.value=p.rate; n.mul=ctx.createGain(); n.mul.gain.value=g.lfoOn; n.sw=ctx.createGain(); n.sw.gain.value=g.sw;
    n.rect=ctx.createWaveShaper(); keyCurve(n.rect,'abs',()=>{ const c=new Float32Array(8192); for(let i=0;i<8192;i++) c[i]=Math.abs((i/8191)*2-1); return c; }); n.env=ctx.createBiquadFilter(); n.env.type='lowpass'; n.env.Q.value=0.5; n.env.frequency.value=g.fc;
    n.sq=ctx.createWaveShaper(); keyCurve(n.sq,'sq',()=>{ const c=new Float32Array(8192); for(let i=0;i<8192;i++){ const x=(i/8191)*2-1; c[i]=Math.tanh(Math.max(0,x)*24); } return c; }); n.eg=ctx.createGain(); n.eg.gain.value=g.envOn;
    n.sat=ctx.createWaveShaper(); keyCurve(n.sat,'k1.6',()=>bbdCurve(1.6)); n.lp=ctx.createBiquadFilter(); n.lp.type='lowpass'; n.lp.frequency.value=bbdLP(6,9000); n.lp.Q.value=0.7; n.d=ctx.createDelay(0.05); n.d.delayTime.value=0.006;
    n.lfo.connect(n.mul).connect(n.sw).connect(n.d.delayTime); b.wetIn.connect(n.rect).connect(n.env).connect(n.sq).connect(n.eg).connect(n.mul.gain);
    b.wetIn.connect(n.sat).connect(n.lp).connect(n.d).connect(b.wetOut); },
  apply(b){ const n=b.n, p=b.p, g=vibGains(p); n.lfo.frequency.value=p.rate; n.lfo.type=p.shape?'triangle':'sine'; setP(n.sw.gain,g.sw); setP(n.mul.gain,g.lfoOn); setP(n.eg.gain,g.envOn); n.env.frequency.value=g.fc; }
});

// ---------- Rotary Speaker: a Leslie with a horn rotor and a drum rotor ----------
// The sound is driven by a tube stage, split at the crossover. The horn gets Doppler (a swept delay) and deep level pulsing; the drum mostly level pulsing with a little Doppler.
// Two mics on each rotor. Mic Spread moves the right mic from beside the left one (0, mono) around to the far side (100, left and right pulse against each other).
// Fast and slow speeds are from the 122/147: horn 6.8 / 0.8 Hz, drum 5.8 / 0.7 Hz. The horn is light and changes speed fast; the drum is heavy and takes seconds.
const ROT_SPD=[[0.8,0.7],[6.8,5.8],[0,0]];   // [horn, drum] Hz for Slow, Fast, Brake
function rotTau(p, up){ const mul=1.9-1.8*p.accel/100; return { h:(up?0.4:0.6)*mul, d:(up?1.5:2.5)*mul }; }
function rotGains(p){ const w=1-2*p.width/100, mix=p.mix/100; return { hL:0.3, hR:0.3*w, dL:0.22, dR:0.22*w, dopL:0.0005, dopR:0.0005*w, ddopL:0.00012, ddopR:0.00012*w, wet:mix*0.95, dry:1-mix }; }
// The tube stage: an asymmetric soft clip whose output is pulled back as the drive goes up, so Drive changes the sound more than the level.
function rotCurve(drive){ const N=8192, c=new Float32Array(N), k=1+3*drive, m=Math.pow(k,0.75); for(let i=0;i<N;i++){ const u=k*((i/(N-1))*2-1); c[i]=(Math.tanh(u+0.12)-Math.tanh(0.12))/m; } return c; }
def('rotary', { name:'Rotary Speaker', cat:'Mod', color:'#9cf', desc:'A Leslie 122. Horn and drum rotors with real speed-up and slow-down, two mics, tube drive.',
  params:{ speed:E('Speed',['Slow','Fast','Brake'],0), drive:P('Drive',0,100,20,'%'), mix:P('Mix',0,100,70,'%'), xo:P('Crossover',200,1500,700,'Hz'), accel:P('Accel',0,100,50,'%'), width:P('Mic Spread',0,100,70,'%') },
  note(b){ return b.p.speed===2 ? 'Brake: both rotors coast to a stop. Pick Slow or Fast to start them again.' : 'Switch Slow and Fast while playing: the horn gets there in about a second, the drum takes a few. Accel makes both quicker.'; },
  build(ctx,b){ const n=b.n, p=b.p, g=rotGains(p), spd=ROT_SPD[p.speed|0]||ROT_SPD[0]; n.spd=p.speed|0;
    n.sh=ctx.createWaveShaper(); keyCurve(n.sh,'d'+p.drive,()=>rotCurve(p.drive/100)); n.dc=ctx.createBiquadFilter(); n.dc.type='highpass'; n.dc.frequency.value=12; n.dc.Q.value=0.5;
    n.lp=lr4(ctx,'lowpass',p.xo); n.hp=lr4(ctx,'highpass',p.xo); n.hlp=ctx.createBiquadFilter(); n.hlp.type='lowpass'; n.hlp.frequency.value=7000; n.hlp.Q.value=0.6;
    n.lfoH=mkLFO(ctx); n.lfoH.frequency.value=spd[0]; n.lfoD=mkLFO(ctx); n.lfoD.frequency.value=spd[1];
    n.dHL=ctx.createDelay(0.01); n.dHL.delayTime.value=0.0015; n.dHR=ctx.createDelay(0.01); n.dHR.delayTime.value=0.0015; n.tHL=ctx.createGain(); n.tHL.gain.value=0.7; n.tHR=ctx.createGain(); n.tHR.gain.value=0.7;
    n.dDL=ctx.createDelay(0.01); n.dDL.delayTime.value=0.0005; n.dDR=ctx.createDelay(0.01); n.dDR.delayTime.value=0.0005; n.tDL=ctx.createGain(); n.tDL.gain.value=0.78; n.tDR=ctx.createGain(); n.tDR.gain.value=0.78;
    const mk=(v)=>{ const x=ctx.createGain(); x.gain.value=v; return x; }; n.gHL=mk(g.hL); n.gHR=mk(g.hR); n.gDL=mk(g.dL); n.gDR=mk(g.dR); n.oHL=mk(g.dopL); n.oHR=mk(g.dopR); n.oDL=mk(g.ddopL); n.oDR=mk(g.ddopR);
    n.lfoH.connect(n.gHL).connect(n.tHL.gain); n.lfoH.connect(n.gHR).connect(n.tHR.gain); n.lfoH.connect(n.oHL).connect(n.dHL.delayTime); n.lfoH.connect(n.oHR).connect(n.dHR.delayTime);
    n.lfoD.connect(n.gDL).connect(n.tDL.gain); n.lfoD.connect(n.gDR).connect(n.tDR.gain); n.lfoD.connect(n.oDL).connect(n.dDL.delayTime); n.lfoD.connect(n.oDR).connect(n.dDR.delayTime);
    n.mg=ctx.createChannelMerger(2); n.wet=ctx.createGain(); n.wet.gain.value=g.wet; n.dry=ctx.createGain(); n.dry.gain.value=g.dry;
    b.wetIn.connect(n.sh).connect(n.dc); n.dc.connect(n.hp.i); n.hp.o.connect(n.hlp); n.hlp.connect(n.dHL).connect(n.tHL).connect(n.mg,0,0); n.hlp.connect(n.dHR).connect(n.tHR).connect(n.mg,0,1);
    n.dc.connect(n.lp.i); n.lp.o.connect(n.dDL).connect(n.tDL).connect(n.mg,0,0); n.lp.o.connect(n.dDR).connect(n.tDR).connect(n.mg,0,1);
    n.mg.connect(n.wet).connect(b.wetOut); b.wetIn.connect(n.dry).connect(b.wetOut); },
  apply(b){ const n=b.n, p=b.p, g=rotGains(p); keyCurve(n.sh,'d'+p.drive,()=>rotCurve(p.drive/100)); n.lp.set(p.xo); n.hp.set(p.xo);
    const s=p.speed|0, spd=ROT_SPD[s]||ROT_SPD[0], was=ROT_SPD[n.spd]||ROT_SPD[0], tau=rotTau(p, spd[0]>was[0]); n.spd=s;   // speed up is quicker than slowing down
    setP(n.lfoH.frequency,spd[0],tau.h); setP(n.lfoD.frequency,spd[1],tau.d);
    setP(n.gHL.gain,g.hL); setP(n.gHR.gain,g.hR); setP(n.gDL.gain,g.dL); setP(n.gDR.gain,g.dR); setP(n.oHL.gain,g.dopL); setP(n.oHR.gain,g.dopR); setP(n.oDL.gain,g.ddopL); setP(n.oDR.gain,g.ddopR); setP(n.wet.gain,g.wet); setP(n.dry.gain,g.dry); }
});

// ---------- Ring Mod ----------
def('ring', { name:'Ring Mod', cat:'Mod', color:'#9cf', desc:'Multiplies the sound by a carrier. Bells, robots and clangs. Tone takes the edge off.',
  params:{ freq:P('Freq',20,2000,200,'Hz'), mix:P('Mix',0,100,50,'%'), shape:E('Shape',['Sine','Square','Triangle','Saw'],0), tone:P('Tone',500,12000,8000,'Hz') },
  note(b){ return 'Tune Freq to the key for bell tones. Square and Saw carriers add more clang.'; },
  build(ctx,b){ const n=b.n, p=b.p; n.o=mkLFO(ctx,['sine','square','triangle','sawtooth'][p.shape|0]); n.o.frequency.value=p.freq; n.r=ctx.createGain(); n.r.gain.value=0; n.o.connect(n.r.gain); n.lp=ctx.createBiquadFilter(); n.lp.type='lowpass'; n.lp.Q.value=0.6; n.lp.frequency.value=p.tone;
    n.w=ctx.createGain(); n.w.gain.value=p.mix/100; n.d=ctx.createGain(); n.d.gain.value=1-p.mix/100; b.wetIn.connect(n.r).connect(n.lp).connect(n.w).connect(b.wetOut); b.wetIn.connect(n.d).connect(b.wetOut); },
  apply(b){ const n=b.n, p=b.p; n.o.frequency.value=p.freq; n.o.type=['sine','square','triangle','sawtooth'][p.shape|0]; n.lp.frequency.value=p.tone; setP(n.w.gain,p.mix/100); setP(n.d.gain,1-p.mix/100); }
});

// ---------- Bit Crusher (worklet np-crusher2: the old crusher plus an anti-alias filter) ----------
def('crush', { name:'Bit Crusher', cat:'Mod', color:'#9cf', desc:'Fewer bits and a lower sample rate. Filter on for clean lo-fi, off for harsh.',
  params:{ bits:P('Bits',2,16,8,'',1), rate:P('Downsample',1,64,1,'x',1), mix:P('Mix',0,100,100,'%'), filter:B('Filter',0) },
  note(b){ return b.p.filter ? 'Filter on: a lowpass before and after the downsampler keeps the aliasing out. Smooth, old-sampler lo-fi.' : 'Filter off: raw aliasing. Turn it on for the clean lo-fi sound.'; },
  build(ctx,b){ const p=b.p; b.n.c=new AudioWorkletNode(ctx,'np-crusher2',{outputChannelCount:[2], parameterData:{bits:p.bits, rate:p.rate, mix:p.mix/100, filter:p.filter|0}}); b.wetIn.connect(b.n.c).connect(b.wetOut); },
  apply(b){ const c=b.n.c, p=b.p; c.parameters.get('bits').value=p.bits; c.parameters.get('rate').value=p.rate; c.parameters.get('mix').value=p.mix/100; c.parameters.get('filter').value=p.filter|0; }
});
