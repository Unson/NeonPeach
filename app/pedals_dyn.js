// ===== Neon Peach 2.4: dynamics and filters, rebuilt as pedal models. Each def() here replaces the block of the same type from engine.js. =====
// The sound lives in app/worklets_dyn.js (and its C++ twin native/src/procs_dyn.cpp). None of these blocks adds any delay.
'use strict';
// set every worklet knob at once: dynInit when the block is made (no ramp, so there is no wrong first moment), dynSet when a knob moves
function dynInit(node, m){ for(const k in m) node.parameters.get(k).value=m[k]; }
function dynSet(node, m){ for(const k in m) wp(node, k, m[k]); }

// --- Super Squeeze: four compressor circuits in one box ---
const COMP_TYPES=['OTA','Opto','FET','VCA'];
const COMP_NOTE=[ 'OTA: the Dyna Comp circuit. Squashy, with that long sustain. Push the threshold down and it pumps.', 'Opto: a photocell, like an LA-2A. Slow and soft. The longer it squashes, the slower it lets go.', 'FET: the 1176. Very fast. Attack runs ten times faster than the knob says. Bites when pushed.', 'VCA: clean and even. The attack and release do exactly what the knobs say.' ];
function compMap(p){ return { threshold:p.thr, ratio:p.ratio, attack:p.attack, release:p.release, knee:p.knee, makeup:p.makeup, mix:p.blend/100, schpf:p.schpf, rms:p.detect|0, auto:1, type:p.type|0 }; }
def('comp', { name:'Super Squeeze', cat:'Dynamics', color:'#8ef', desc:'Four compressor circuits: OTA squash, Opto glow, FET snap, or clean VCA. Blend keeps the attack.', gr:true,
  params:{ type:E('Circuit',COMP_TYPES,3), thr:P('Threshold',-60,0,-22,'dB'), ratio:P('Ratio',1,20,4,':1'), attack:P('Attack',0.1,100,8,'ms'), release:P('Release',10,1000,120,'ms'), knee:P('Knee',0,30,8,'dB'), makeup:P('Makeup',0,24,4,'dB'), blend:P('Blend',0,100,100,'%'), schpf:P('Ignore Lows',20,500,80,'Hz'), detect:E('Detect',['Peak','RMS'],0) },
  note(b){ return COMP_NOTE[b.p.type|0]||''; },
  build(ctx,b){ const n=b.n; n.c=new AudioWorkletNode(ctx,'np-pcomp',{outputChannelCount:[2]}); dynInit(n.c, compMap(b.p)); n.c.port.onmessage=e=>{ b.gr=e.data.gr; }; b.wetIn.connect(n.c).connect(b.wetOut); },
  apply(b){ dynSet(b.n.c, compMap(b.p)); }
});

// --- Peach Gate: an NS-2 style gate ---
function gateMap(p){ return { threshold:p.thr, attack:p.attack, release:p.release, hold:p.hold, range:p.range, hyst:p.hyst, decay:p.decay }; }
def('gate', { name:'Peach Gate', cat:'Dynamics', color:'#8ef', desc:'Cuts hiss and hum when you stop playing. Opens fast, closes clean, never chatters.',
  params:{ thr:P('Threshold',-90,0,-55,'dB'), attack:P('Attack',0.1,100,1,'ms'), release:P('Release',5,2000,120,'ms'), hold:P('Hold',0,1000,40,'ms'), range:P('Range',-90,0,-80,'dB'), hyst:P('Close Below',0,20,6,'dB'), decay:P('Decay',0,100,0,'%') },
  note(b){ return 'The gate opens at Threshold and closes once the sound drops Close Below under it. Decay at 0 shuts it hard. Turn Decay up and the gate follows the note down instead, so tails fade out.'; },
  build(ctx,b){ const n=b.n; n.g=new AudioWorkletNode(ctx,'np-pgate',{outputChannelCount:[2]}); dynInit(n.g, gateMap(b.p)); b.wetIn.connect(n.g).connect(b.wetOut); },
  apply(b){ dynSet(b.n.g, gateMap(b.p)); }
});

// --- Brickwall: a limiter with no look-ahead ---
function limMap(p){ return { input:p.gain, ceiling:p.ceil, release:p.release, type:p.type|0 }; }
def('limiter', { name:'Brickwall', cat:'Dynamics', color:'#8ef', desc:'A hard ceiling. Nothing gets louder than this. No delay.', gr:true,
  params:{ type:E('Knee',['Hard','Soft'],0), ceil:P('Ceiling',-20,0,-1,'dB'), release:P('Release',10,500,60,'ms'), gain:P('Input',0,24,0,'dB') },
  note(b){ return b.p.type ? 'Soft eases in from 3 dB under the ceiling, and lets go slower after a long squash.' : 'Hard only acts above the ceiling. Fast and plain.'; },
  build(ctx,b){ const n=b.n; n.l=new AudioWorkletNode(ctx,'np-plimit',{outputChannelCount:[2]}); dynInit(n.l, limMap(b.p)); n.l.port.onmessage=e=>{ b.gr=e.data.gr; }; b.wetIn.connect(n.l).connect(b.wetOut); },
  apply(b){ dynSet(b.n.l, limMap(b.p)); }
});

// --- Envelope Filter: Mutron III / Q-Tron style ---
function envfMap(p){ return { sens:p.sens/100, fmin:p.fmin, range:p.range/100, q:p.q, attack:p.attack, decay:p.decay, type:p.type|0, dir:p.dir|0, mix:p.mix/100, gain:p.gain }; }
def('envf', { name:'Envelope Filter', cat:'Filter', color:'#9ff', desc:'Funky auto-wah that follows your picking. Mutron-style, with real resonance.',
  params:{ sens:P('Sensitivity',0,100,50,'%'), fmin:P('Start Freq',40,2000,120,'Hz'), range:P('Range',0,100,70,'%'), q:P('Reso',0.5,20,4,''), attack:P('Attack',1,200,8,'ms'), decay:P('Decay',10,1500,180,'ms'), type:E('Type',['Low Pass','Band Pass','High Pass'],0), dir:E('Direction',['Up','Down'],0), mix:P('Mix',0,100,100,'%'), gain:P('Gain',0,100,0,'%') },
  note(b){ return (b.p.q>=18 ? 'Reso this high rings on its own. ' : '')+'Gain drives the filter input into gentle saturation. Mix brings back the clean bass.'; },
  build(ctx,b){ const n=b.n; n.e=new AudioWorkletNode(ctx,'np-penvf',{outputChannelCount:[2]}); dynInit(n.e, envfMap(b.p)); b.wetIn.connect(n.e).connect(b.wetOut); },
  apply(b){ dynSet(b.n.e, envfMap(b.p)); }
});

// --- Pedal Wah: Cry Baby, Bass 105Q, Vox ---
function wahMap(p){ return { pos:p.pos/100, q:p.q, fmin:p.fmin, fmax:p.fmax, mix:p.mix/100, model:p.model|0 }; }
def('wah', { name:'Pedal Wah', cat:'Filter', color:'#9ff', desc:'A wah you sweep with the expression pedal. Cry Baby, a fat bass 105Q, or a bright Vox.',
  params:{ model:E('Model',['Cry Baby','Bass 105Q','Vox'],0), pos:P('Position',0,100,50,'%'), q:P('Reso',0.5,15,5,''), fmin:P('Min Freq',100,1000,350,'Hz'), fmax:P('Max Freq',800,5000,2200,'Hz'), mix:P('Mix',0,100,100,'%') },
  note(b){ return ['Cry Baby: the classic peak with the lows thinned out.','Bass 105Q: sweeps lower and keeps your low end under the peak.','Vox: brighter and narrower, with more top above the peak.'][b.p.model|0]+' Link Position to the expression pedal.'; },
  build(ctx,b){ const n=b.n; n.w=new AudioWorkletNode(ctx,'np-wah',{outputChannelCount:[2]}); dynInit(n.w, wahMap(b.p)); b.wetIn.connect(n.w).connect(b.wetOut); },
  apply(b){ dynSet(b.n.w, wahMap(b.p)); }
});

// --- Multi Filter: a clean 2-pole, or a Moog-style ladder ---
function filtMap(p){ return { type:p.type|0, freq:p.freq, q:p.q, mix:p.mix/100, model:p.model|0, drive:p.drive }; }
def('filter', { name:'Multi Filter', cat:'Filter', color:'#9ff', desc:'Low pass, high pass, band pass or notch. Clean, or a Moog-style ladder that growls and sings.',
  params:{ model:E('Model',['SVF','Ladder'],0), type:E('Type',['Low Pass','High Pass','Band Pass','Notch'],0), freq:P('Freq',40,12000,800,'Hz'), q:P('Reso',0.3,20,1,''), mix:P('Mix',0,100,100,'%'), drive:P('Drive',0,100,0,'%') },
  note(b){ return b.p.model ? 'Ladder: four stages with soft clipping in each, like a Moog. Reso near the top makes it sing on its own.' : 'SVF: a clean 2-pole filter. Drive adds a little saturation before it.'; },
  build(ctx,b){ const n=b.n; n.f=new AudioWorkletNode(ctx,'np-ladder',{outputChannelCount:[2]}); dynInit(n.f, filtMap(b.p)); b.wetIn.connect(n.f).connect(b.wetOut); },
  apply(b){ dynSet(b.n.f, filtMap(b.p)); }
});
