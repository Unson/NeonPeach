// ===== Neon Peach 2.4: delay, reverb and pitch, rebuilt as pedal models. Each def() here replaces the block of the same type from engine.js. =====
// Built on five new worklets in worklets_time.js (np-delay, np-taps, np-verb, np-oc2, np-pitch2), each with a C++ twin in procs_time.cpp. Trails wiring (b.wetDry, b.trailsWet, b.trailsIn) is the same as before.
'use strict';

// ---------- Delay: four real machines behind one set of knobs (np-delay) ----------
// Digital: clean repeats, with a 12-bit / 12 kHz lo-fi mode on the Lo-Fi knob.
// Tape (Echoplex EP-3 / Space Echo RE-201): wow and flutter from two LFOs, a head bump at 110 Hz, tape saturation and hiss in the repeats, highs that fade more each pass.
// Analog (Boss DM-2 / Memory Man BBD): the clock slows and the bandwidth falls as the time grows, soft clipping in the loop, repeats get darker and grainier.
// Ping Pong: the Digital machine, bouncing left and right.
// The whole loop runs inside the processor: a feedback loop made of nodes lands a block early or late depending on the engine, and this one never does.
const DLY_TYPES=['Digital','Tape','Analog','Ping Pong'];
function dlyGains(p){ return { inG:1, wet:p.mix/100*((p.type|0)===3?0.95:1.2) }; }
function dlyParams(p){ return { type:p.type|0, time:clampN(delayTimeMs(p),1,3900), fb:p.fb/100, lowcut:p.lowcut, highcut:p.highcut, mod:p.mod/100, age:(p.age==null?25:p.age)/100, lofi:(p.lofi||0)/100 }; }
def('delay', { name:'Delay', cat:'Delay', color:'#fd8', desc:'Echoes. A clean digital, a worn tape machine, a dark analog box, or ping pong.',
  params:{ type:E('Type',DLY_TYPES,0), time:P('Time',10,2000,375,'ms'), sync:E('Sync',SYNC,0), fb:P('Feedback',0,100,35,'%'), mix:P('Mix',0,100,30,'%'), lowcut:P('Low Cut',20,1000,120,'Hz'), highcut:P('High Cut',500,12000,5000,'Hz'), mod:P('Wow',0,100,0,'%'), trails:B('Trails',1),
    age:P('Age',0,100,25,'%'), lofi:P('Lo-Fi',0,100,0,'%') },
  spec(b,k,s){ const t=b.p.type|0; if(k==='age' && t!==1 && t!==2) return Object.assign({},s,{l:'Age (tape, analog)'}); if(k==='lofi' && t!==0 && t!==3) return Object.assign({},s,{l:'Lo-Fi (digital)'}); if(k==='mod') return Object.assign({},s,{l:t===1?'Wow & Flutter':(t===2?'Clock Wobble':'Mod')}); return null; },
  note(b){ const t=b.p.type|0; return t===1 ? 'Age wears the tape: more wow and flutter, duller repeats, more squash and hiss. Feedback at 100 runs away slowly, like a real Space Echo.'
    : t===2 ? 'Longer times get darker and grainier, like a real bucket-brigade chip. Age adds grit and clock wobble.'
    : t===3 ? 'Each echo jumps to the other side. Lo-Fi makes it a 12-bit rack unit.' : 'Clean repeats. Lo-Fi turns it into a 12-bit, 12 kHz rack unit from 1985.'; },
  build(ctx,b){ const n=b.n, p=b.p, g=dlyGains(p);
    n.inG=ctx.createGain(); n.d=new AudioWorkletNode(ctx,'np-delay',{outputChannelCount:[2], parameterData:dlyParams(p)}); n.wet=ctx.createGain(); b.wetDry=ctx.createGain();
    for(const k in g) n[k].gain.value=g[k];
    b.wetIn.connect(b.wetDry).connect(b.wetOut); b.wetIn.connect(n.inG).connect(n.d).connect(n.wet).connect(b.wetOut);
    b.trailsWet=n.wet; b.trailsIn=n.inG; },
  apply(b){ const n=b.n, p=b.p, g=dlyGains(p), q=dlyParams(p); for(const k in g) setP(n[k].gain, g[k]); for(const k in q) n.d.parameters.get(k).value=q[k]; }   // the processor glides the time itself
});

// ---------- Multi-tap: up to four echoes off one line, spaced by a pattern (np-taps) ----------
const MD_PAT=['Even','Dotted','Triplet','Golden'];
function mdGains(p){ return { inG:1, wet:p.mix/100 }; }
function mdParams(p){ const mul=[4,3,8/3,4.236][p.pattern|0]||4; return { time:Math.min(1900, 7900/mul, delayTimeMs(p)), fb:p.fb/100, highcut:p.highcut, spread:p.spread/100, taps:p.taps|0, pattern:p.pattern|0 }; }
def('mdelay', { name:'Multi-Tap Delay', cat:'Delay', color:'#fd8', desc:'Up to four echo taps, spaced even, dotted, triplet or golden.',
  params:{ time:P('Time',10,2000,250,'ms'), sync:E('Sync',SYNC,0), taps:P('Taps',1,4,3,'',1), fb:P('Feedback',0,90,20,'%'), spread:P('Spread',0,100,60,'%'), mix:P('Mix',0,100,30,'%'), highcut:P('High Cut',500,12000,4000,'Hz'), trails:B('Trails',1), pattern:E('Pattern',MD_PAT,0) },
  note(b){ return ['Taps land on every beat of the time.','Taps land every three quarters of the time: a dotted feel.','Taps land every two thirds of the time: a triplet feel.','Taps spread by the golden ratio, so they never line up. A smear, not a rhythm.'][b.p.pattern|0]; },
  build(ctx,b){ const n=b.n, p=b.p, g=mdGains(p);
    n.inG=ctx.createGain(); n.t=new AudioWorkletNode(ctx,'np-taps',{outputChannelCount:[2], parameterData:mdParams(p)}); n.wet=ctx.createGain(); b.wetDry=ctx.createGain();
    for(const k in g) n[k].gain.value=g[k];
    b.wetIn.connect(b.wetDry).connect(b.wetOut); b.wetIn.connect(n.inG).connect(n.t).connect(n.wet).connect(b.wetOut);
    b.trailsWet=n.wet; b.trailsIn=n.inG; },
  apply(b){ const n=b.n, p=b.p, g=mdGains(p), q=mdParams(p); for(const k in g) setP(n[k].gain, g[k]); for(const k in q) n.t.parameters.get(k).value=q[k]; }
});

// ---------- Reverb: an algorithmic reverb (np-verb) in place of the old noise IR ----------
// Room, Hall, Plate, Cathedral: an 8-line feedback delay network, each type with its own line lengths, damping and early reflections.
// Spring: three springs made of stretched allpass chains, so every echo chirps. Shimmer: the Hall, with the tail fed back through a +12 shifter.
// Decay is RT60: the seconds the tail takes to drop 60 dB.
const VERB_TYPES=['Room','Hall','Plate','Spring','Cathedral','Shimmer'];
function verbGains(p){ return { inG:1, wet:p.mix/100*1.5, shg:p.shimmer/100*0.5 }; }
def('reverb', { name:'Reverb', cat:'Reverb', color:'#bdf', desc:'Room, hall, plate, spring, cathedral or shimmer. Decay is the real ring-out time.',
  params:{ type:E('Type',VERB_TYPES,1), decay:P('Decay',0.2,8,2,'s'), predelay:P('Pre-Delay',0,200,10,'ms'), mix:P('Mix',0,100,25,'%'), lowcut:P('Low Cut',20,1000,150,'Hz'), highcut:P('High Cut',1000,16000,7000,'Hz'), shimmer:P('Shimmer',0,100,0,'%'), trails:B('Trails',1) },
  note(b){ const t=b.p.type|0; return ['A small room. Short, with early slaps you can hear.','A concert hall. Long, smooth and dark.','A steel plate. Dense, bright and fast.','Three springs in a tank. Dig in for the boing.','A stone cathedral. Very long, very washed out.','The hall, with the tail fed back an octave up. Shimmer sets how much.'][t]+(t===5?'':' Decay is the time the tail takes to fade 60 dB.'); },
  build(ctx,b){ const n=b.n, p=b.p, g=verbGains(p);
    n.inG=ctx.createGain(); n.v=new AudioWorkletNode(ctx,'np-verb',{outputChannelCount:[2], parameterData:{type:p.type|0, decay:p.decay, predelay:p.predelay, damp:p.highcut}});
    n.hp=ctx.createBiquadFilter(); n.hp.type='highpass'; n.hp.Q.value=0.7; n.hp.frequency.value=p.lowcut; n.lp=ctx.createBiquadFilter(); n.lp.type='lowpass'; n.lp.Q.value=0.7; n.lp.frequency.value=p.highcut; n.wet=ctx.createGain(); b.wetDry=ctx.createGain();
    // shimmer: the wet tail, an octave up, back into the reverb. A limiter in the loop keeps a long decay from running away.
    n.sh=new AudioWorkletNode(ctx,'np-pitch',{outputChannelCount:[2]}); n.sh.parameters.get('semitones').value=12; n.shg=ctx.createGain(); n.shl=new AudioWorkletNode(ctx,'np-limit',{outputChannelCount:[2]}); n.shl.parameters.get('ceiling').value=-12; n.shl.parameters.get('release').value=200; n.shd=ctx.createDelay(0.1); n.shd.delayTime.value=0.03;
    for(const k in g) n[k].gain.value=g[k];
    b.wetIn.connect(b.wetDry).connect(b.wetOut);
    b.wetIn.connect(n.inG).connect(n.v).connect(n.hp).connect(n.lp).connect(n.wet).connect(b.wetOut); n.lp.connect(n.sh).connect(n.shg).connect(n.shl).connect(n.shd).connect(n.inG);
    b.trailsWet=n.wet; b.trailsIn=n.inG; },
  apply(b){ const n=b.n, p=b.p, g=verbGains(p); for(const k in g) setP(n[k].gain, g[k]);
    const v=n.v.parameters; v.get('type').value=p.type|0; v.get('decay').value=p.decay; v.get('predelay').value=p.predelay; v.get('damp').value=p.highcut; n.hp.frequency.value=p.lowcut; n.lp.frequency.value=p.highcut; }
});

// ---------- Sub Octave: a Boss OC-2 (np-oc2) ----------
def('octave', { name:'Sub Octave', cat:'Pitch', color:'#c9f', desc:'A Boss OC-2. Analog-style octaves down that follow your note and die with it.',
  params:{ sub1:P('-1 Oct',0,100,70,'%'), sub2:P('-2 Oct',0,100,0,'%'), up:P('+1 Oct',0,100,0,'%'), dry:P('Dry',0,100,100,'%'), tone:P('Tone',100,4000,600,'Hz'), track:P('Tracking',100,800,300,'Hz') },
  note(b){ return 'Tracking is the filter the pitch follower listens through. Set it a little above your highest note; lower is steadier. Tone rounds off the subs.'; },
  build(ctx,b){ const p=b.p; b.n.o=new AudioWorkletNode(ctx,'np-oc2',{outputChannelCount:[2], parameterData:{sub1:p.sub1/100, sub2:p.sub2/100, up:p.up/100, dry:p.dry/100, tone:p.tone, track:p.track}}); b.wetIn.connect(b.n.o).connect(b.wetOut); },
  apply(b){ const o=b.n.o,p=b.p; wp(o,'sub1',p.sub1/100); wp(o,'sub2',p.sub2/100); wp(o,'up',p.up/100); wp(o,'dry',p.dry/100); o.parameters.get('tone').value=p.tone; o.parameters.get('track').value=p.track; }
});

// ---------- Pitch Shift and Harmonizer: the splice-searching shifter (np-pitch2) ----------
def('pitch', { name:'Pitch Shift', cat:'Pitch', color:'#c9f', desc:'Shift up or down by any amount. Splices where the waves line up, so a bass note stays smooth.',
  params:{ semi:P('Semitones',-24,24,-12,'st',1), cents:P('Cents',-100,100,0,'c'), mix:P('Mix',0,100,100,'%'), grain:P('Grain',15,150,40,'ms') },
  note(b){ const r=Math.pow(2,b.p.semi/12), ms=r>1 ? b.p.grain/r*(0.5*(r-1)+0.2) : b.p.grain*(0.2+(1-r)/2); return 'Grain is the slice size. Longer is smoother on low notes but adds delay: about '+Math.round(ms)+' ms at this setting.'; },
  build(ctx,b){ const p=b.p; b.n.p=new AudioWorkletNode(ctx,'np-pitch2',{outputChannelCount:[2], parameterData:{semitones:p.semi, cents:p.cents, mix:p.mix/100, grain:p.grain}}); b.wetIn.connect(b.n.p).connect(b.wetOut); },
  apply(b){ const o=b.n.p,p=b.p; o.parameters.get('semitones').value=p.semi; o.parameters.get('cents').value=p.cents; wp(o,'mix',p.mix/100); o.parameters.get('grain').value=p.grain; }
});
function harmGains(p){ return { g1:p.l1/100, g2:p.l2/100, d:p.dry/100 }; }
def('harm', { name:'Harmonizer', cat:'Pitch', color:'#c9f', desc:'Two harmony voices, spread left and right.',
  params:{ v1:P('Voice 1',-24,24,7,'st',1), l1:P('Level 1',0,100,60,'%'), v2:P('Voice 2',-24,24,-12,'st',1), l2:P('Level 2',0,100,0,'%'), dry:P('Dry',0,100,100,'%'), spread:P('Spread',0,100,50,'%') },
  build(ctx,b){ const n=b.n, p=b.p, g=harmGains(p); n.p1=new AudioWorkletNode(ctx,'np-pitch2',{outputChannelCount:[2], parameterData:{semitones:p.v1, grain:40}}); n.p2=new AudioWorkletNode(ctx,'np-pitch2',{outputChannelCount:[2], parameterData:{semitones:p.v2, grain:40}}); n.g1=ctx.createGain(); n.g2=ctx.createGain(); n.pan1=ctx.createStereoPanner(); n.pan2=ctx.createStereoPanner(); n.d=ctx.createGain();
    for(const k in g) n[k].gain.value=g[k]; n.pan1.pan.value=-p.spread/100; n.pan2.pan.value=p.spread/100;
    b.wetIn.connect(n.p1).connect(n.g1).connect(n.pan1).connect(b.wetOut); b.wetIn.connect(n.p2).connect(n.g2).connect(n.pan2).connect(b.wetOut); b.wetIn.connect(n.d).connect(b.wetOut); },
  apply(b){ const n=b.n,p=b.p, g=harmGains(p); n.p1.parameters.get('semitones').value=p.v1; n.p2.parameters.get('semitones').value=p.v2; for(const k in g) setP(n[k].gain, g[k]); n.pan1.pan.value=-p.spread/100; n.pan2.pan.value=p.spread/100; }
});
