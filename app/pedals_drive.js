// ===== Neon Peach 2.4: drives and fuzz, rebuilt as pedal models. Each def() here replaces the block of the same type from engine.js. =====
// Every block keeps its old knobs, with the same meaning, range and default. New knobs default to the old sound as closely as the model allows.
// Built from nodes both engines have, plus two new worklets (np-tube, np-fuzz) in worklets_drive.js with C++ twins in native/src/procs_drive.cpp.
'use strict';

// ---------- shared pieces ----------
function pdBq(ctx,type,f,q,g){ const n=ctx.createBiquadFilter(); n.type=type; n.frequency.value=f; if(q!=null) n.Q.value=q; if(g!=null) n.gain.value=g; return n; }
// a curve for np-shaper from a transfer function f. The table runs x = -1..1; g is the gain into f. norm: scale so the loudest point is 1; else clamp to ±1 (when the level matters)
function pdCurve(f, g, norm){ const N=8192, c=new Float32Array(N); for(let i=0;i<N;i++) c[i]=f(((i/(N-1))*2-1)*g); if(norm){ let mx=0; for(let i=0;i<N;i++) mx=Math.max(mx,Math.abs(c[i])); if(mx>0) for(let i=0;i<N;i++) c[i]/=mx; } else for(let i=0;i<N;i++) c[i]=clampN(c[i],-1,1); return c; }
// Blend is an equal-power mix of the pedal (lvl) and the clean signal (dry). scale is the block's own trim so defaults sit near the clean level.
function pdMix(p, scale){ const bl=p.blend/100*Math.PI/2; return { lvl:dB(p.level)*Math.sin(bl)*scale, dry:Math.cos(bl) }; }
function pdSetGains(n, g, init){ for(const k in g){ if(init) n[k].gain.value=g[k]; else setP(n[k].gain, g[k]); } }
// what goes into every drive: Grunt (a highpass, how much low end hits the clip) and Attack (a 2.8 kHz shelf into the clip)
function pdPre(ctx,n,p){ n.hp=pdBq(ctx,'highpass',p.grunt,0.7); n.att=pdBq(ctx,'highshelf',2800,null,p.attack); }
// what comes out: the 12 Hz DC filter (curves make DC), High Cut, Tone (a 1.8 kHz shelf), Level
function pdPost(ctx,n,p){ n.dc=pdBq(ctx,'highpass',12,0.5); n.lp=pdBq(ctx,'lowpass',p.highcut,0.6); n.tone=pdBq(ctx,'highshelf',1800,null,p.tone); n.lvl=ctx.createGain(); }
function pdApplyCommon(b){ const n=b.n,p=b.p; n.hp.frequency.value=p.grunt; n.att.gain.value=p.attack; n.lp.frequency.value=p.highcut; n.tone.gain.value=p.tone; }
// the clean side of Blend. It waits one shaper's worth per shaper in the drive path (k of them), so the two line up and the lows stay full.
function pdDry(ctx,b,k){ const n=b.n; n.dry=ctx.createGain(); n.dd=[]; let prev=b.wetIn; for(let i=0;i<k;i++){ const d=shDelay(ctx); n.dd.push(d); prev.connect(d); prev=d; } prev.connect(n.dry).connect(b.wetOut); }
function pdWorklet(ctx,name,pd){ return new AudioWorkletNode(ctx,name,{outputChannelCount:[2], parameterData:pd}); }
const PD_K=(...v)=>v.join(',');   // one key from several knob values, for setCurve

// ---------- Microtubes B3K: the Darkglass B3K v2 ----------
// Grunt and Attack shape what hits the clip. The clip is the head's b3k circuit (two CMOS inverter stages). Its voice after the clip is the head's too.
def('b3k', { name:'Microtubes B3K', cat:'Drive', color:'#f96', desc:'The Darkglass B3K. Two CMOS stages. Tight, clanky grind with a clean blend.', lat:SHAPER_LAT,
  params:driveParams(100,3,55,0),
  note(b){ return 'Grunt sets how much low end hits the drive. Attack pushes 2.8 kHz into it. Blend keeps the clean lows under the grind.'; },
  build(ctx,b){ const n=b.n,p=b.p; pdPre(ctx,n,p); n.sh=initCurve(shaperNode(ctx, headCurve('b3k',p.drive/100)),'b3k',p.drive); n.v1=ctx.createBiquadFilter(); n.v2=ctx.createBiquadFilter(); headVoice(n.v1,n.v2,'b3k'); pdPost(ctx,n,p); pdDry(ctx,b,1); pdSetGains(n,pdMix(p,0.32),true);
    b.wetIn.connect(n.hp).connect(n.att).connect(n.sh).connect(n.v1).connect(n.v2).connect(n.dc).connect(n.lp).connect(n.tone).connect(n.lvl).connect(b.wetOut); },
  apply(b){ const n=b.n,p=b.p; pdApplyCommon(b); setCurve(n.sh,'b3k:'+p.drive,()=>headCurve('b3k',p.drive/100)); pdSetGains(n,pdMix(p,0.32)); } });

// ---------- Vintage Microtubes ----------
// Era morphs the clip from the tight B3K curve (0) to the round, early-compressing Vintage curve (100), and the voice with it: more 500 Hz, less top, and a slow squash before the clip.
function vintCurve(drive, era){ const a=headCurve('b3k',drive), c=headCurve('vint',drive), e=era/100, N=a.length, o=new Float32Array(N); let mx=0; for(let i=0;i<N;i++){ o[i]=a[i]*(1-e)+c[i]*e; mx=Math.max(mx,Math.abs(o[i])); } if(mx>0) for(let i=0;i<N;i++) o[i]/=mx; return o; }
def('vintage', { name:'Vintage Microtubes', cat:'Drive', color:'#f96', desc:'Warm, round tube-style drive that squashes early. Era goes from modern to vintage.', lat:SHAPER_LAT,
  params:Object.assign(driveParams(80,0,45,-2),{ era:P('Era',0,100,50,'%') }),
  note(b){ return b.p.era<34 ? 'Era is modern: tight and bright, close to a B3K.' : b.p.era>66 ? 'Era is vintage: dark, round, and it squashes early.' : 'Era is in the middle: warm but still clear.'; },
  build(ctx,b){ const n=b.n,p=b.p, e=p.era/100; pdPre(ctx,n,p); n.sq=compNode(ctx); n.sq.parameters.get('attack').value=8; n.sq.parameters.get('release').value=180; n.sq.parameters.get('knee').value=8; n.sq.parameters.get('threshold').value=-18-e*10; n.sq.parameters.get('ratio').value=1+e*2; n.sq.parameters.get('makeup').value=e*3;
    n.sh=initCurve(shaperNode(ctx, vintCurve(p.drive/100,p.era)),'vint',PD_K(p.drive,p.era)); n.v1=pdBq(ctx,'peaking',500,0.9,2.5*e); n.v2=pdBq(ctx,'peaking',2000,1,2*(1-e)); n.v3=pdBq(ctx,'lowpass',7000*Math.pow(3800/7000,e),0.7); pdPost(ctx,n,p); pdDry(ctx,b,1); pdSetGains(n,pdMix(p,0.4),true);
    b.wetIn.connect(n.hp).connect(n.att).connect(n.sq).connect(n.sh).connect(n.v1).connect(n.v2).connect(n.v3).connect(n.dc).connect(n.lp).connect(n.tone).connect(n.lvl).connect(b.wetOut); },
  apply(b){ const n=b.n,p=b.p, e=p.era/100; pdApplyCommon(b); wp(n.sq,'threshold',-18-e*10); wp(n.sq,'ratio',1+e*2); wp(n.sq,'makeup',e*3); setCurve(n.sh,'vint:'+PD_K(p.drive,p.era),()=>vintCurve(p.drive/100,p.era)); n.v1.gain.value=2.5*e; n.v2.gain.value=2*(1-e); n.v3.frequency.value=7000*Math.pow(3800/7000,e); pdSetGains(n,pdMix(p,0.4)); } });

// ---------- Alpha·Omega: Alpha Crunch and Omega Growl are the two sides of the same pedal ----------
// Mod blends the Alpha clip (hard knee, stays clean to the edge) into the Omega clip (saturates early, leans to one side). Bite and Growl push 2.8 kHz and 280 Hz into the clip. Both circuits and voices are the head's.
const aoParams=(g,a,d,t,mod)=>Object.assign(driveParams(g,a,d,t),{ mod:P('Mod',0,100,mod,'%'), bite:P('Bite',0,100,0,'%'), growl:P('Growl',0,100,0,'%') });
function aoGains(p){ const m=pdMix(p,0.32), md=p.mod/100*Math.PI/2; m.gA=Math.cos(md); m.gB=Math.sin(md); return m; }
function aoNote(b){ return 'Mod blends Alpha (0, tight and punchy) into Omega (100, raw and fuzzy). Bite pushes highs into the drive. Growl pushes low mids in.'; }
function aoBuild(ctx,b){ const n=b.n,p=b.p; pdPre(ctx,n,p); n.growl=pdBq(ctx,'peaking',280,1,p.growl/100*9); n.bite=pdBq(ctx,'peaking',2800,1.3,p.bite/100*10);
  n.shA=initCurve(shaperNode(ctx, headCurve('alpha',p.drive/100)),'alpha',p.drive); n.shB=initCurve(shaperNode(ctx, headCurve('omega',p.drive/100)),'omega',p.drive); n.gA=ctx.createGain(); n.gB=ctx.createGain();
  n.vA1=ctx.createBiquadFilter(); n.vA2=ctx.createBiquadFilter(); n.vB1=ctx.createBiquadFilter(); n.vB2=ctx.createBiquadFilter(); headVoice(n.vA1,n.vA2,'alpha'); headVoice(n.vB1,n.vB2,'omega'); pdPost(ctx,n,p); pdDry(ctx,b,1); pdSetGains(n,aoGains(p),true);
  b.wetIn.connect(n.hp).connect(n.growl).connect(n.att).connect(n.bite); n.bite.connect(n.shA).connect(n.vA1).connect(n.vA2).connect(n.gA).connect(n.dc); n.bite.connect(n.shB).connect(n.vB1).connect(n.vB2).connect(n.gB).connect(n.dc); n.dc.connect(n.lp).connect(n.tone).connect(n.lvl).connect(b.wetOut); }
function aoApply(b){ const n=b.n,p=b.p; pdApplyCommon(b); n.growl.gain.value=p.growl/100*9; n.bite.gain.value=p.bite/100*10; setCurve(n.shA,'alpha:'+p.drive,()=>headCurve('alpha',p.drive/100)); setCurve(n.shB,'omega:'+p.drive,()=>headCurve('omega',p.drive/100)); pdSetGains(n,aoGains(p)); }
def('alpha', { name:'Alpha Crunch', cat:'Drive', color:'#f96', desc:'The Alpha side of the Alpha·Omega. Tight, punchy, modern crunch. Mod blends in Omega.', lat:SHAPER_LAT, params:aoParams(120,4,60,2,0), note:aoNote, build:aoBuild, apply:aoApply });
def('omega', { name:'Omega Growl', cat:'Drive', color:'#f96', desc:'The Omega side of the Alpha·Omega. Big, raw, growling distortion. Mod blends in Alpha.', lat:SHAPER_LAT, params:aoParams(90,2,65,-3,100), note:aoNote, build:aoBuild, apply:aoApply });

// ---------- Ignissor Fuzz: a germanium Fuzz Face (np-fuzz) ----------
def('ignis', { name:'Ignissor Fuzz', cat:'Drive', color:'#f96', desc:'A germanium Fuzz Face. Cleans up when you play softer. Bias sets how it breaks up.', lat:SHAPER_LAT,
  params:Object.assign(driveParams(70,0,70,0),{ bias:P('Bias',0,100,50,'%'), gate:P('Gate',0,100,0,'%') }),
  note(b){ const p=b.p; return (p.bias<35 ? 'Bias is starved: spitty, with a decay that breaks up.' : p.bias>65 ? 'Bias is hot: smooth and thick.' : 'Bias is in the middle: the classic sound.')+(p.gate>0 ? ' Gate chops the tail as a note dies out.' : ' Play softer and it cleans up.'); },
  build(ctx,b){ const n=b.n,p=b.p; pdPre(ctx,n,p); n.fz=pdWorklet(ctx,'np-fuzz',{fuzz:p.drive/100, bias:p.bias/100, gate:p.gate/100}); pdPost(ctx,n,p); pdDry(ctx,b,1); pdSetGains(n,pdMix(p,0.35),true);
    b.wetIn.connect(n.hp).connect(n.att).connect(n.fz).connect(n.dc).connect(n.lp).connect(n.tone).connect(n.lvl).connect(b.wetOut); },
  apply(b){ const n=b.n,p=b.p; pdApplyCommon(b); wp(n.fz,'fuzz',p.drive/100); wp(n.fz,'bias',p.bias/100); wp(n.fz,'gate',p.gate/100); pdSetGains(n,pdMix(p,0.35)); } });

// ---------- Peach Overdrive: a Tube Screamer ----------
// The op-amp stage adds a clipped copy of the highs (above 720 Hz, the 4.7k/47n leg) to the untouched signal: out = in + clip(gain * highs). That is where the mid hump comes from, and it grows with Drive.
// The diodes sit in the feedback loop, so the clip is soft and symmetric. Clip picks the diodes: threshold and knee. A 51 pF cap across the feedback rolls the highs off harder as Drive goes up.
const OD_CLIP=[{Tp:0.55,Tn:0.55,k:3},{Tp:0.3,Tn:0.3,k:2},{Tp:1.6,Tn:1.6,k:5},{Tp:0.55,Tn:1.1,k:3}];   // Silicon, Germanium (lower, softer), LED (higher, harder), Asymmetric (two diodes one way)
function odGain(d){ return 3+Math.pow(d,1.5)*110; }   // Rf/4.7k. The real pot starts at 51k (gain 11); this starts a little lower so Drive has a near-clean end on a hot bass
function odLP(d){ return Math.min(20000, 1/(2*Math.PI*(51e3+500e3*d)*51e-12)); }
function odCurve(drive, clip){ const m=OD_CLIP[clip|0]||OD_CLIP[0]; return pdCurve(u=>{ const T=u>=0?m.Tp:m.Tn; return u/Math.pow(1+Math.pow(Math.abs(u)/T,m.k),1/m.k)/2; }, odGain(drive), false); }   // /2 keeps the LED curve inside the table; n.cs gives it back
def('od', { name:'Peach Overdrive', cat:'Drive', color:'#f96', desc:'A Tube Screamer. Diodes in the feedback loop, the 720 Hz mid hump, the active tone. Pick your diodes.', lat:SHAPER_LAT,
  params:Object.assign(driveParams(60,1,40,0),{ clip:E('Clip',['Silicon','Germanium','LED','Asymmetric'],0) }),
  note(b){ return ['Silicon: the classic. Smooth and even.','Germanium: clips sooner and softer. Warmer, quieter.','LED: clips later and harder. Louder, more open.','Asymmetric: one side clips sooner. Adds even harmonics, a little tube-like.'][b.p.clip|0]+' The mid hump grows with Drive.'; },
  build(ctx,b){ const n=b.n,p=b.p, d=p.drive/100; pdPre(ctx,n,p); n.h7=pdBq(ctx,'highpass',500,-6); /* the 4.7k/47n leg: close to a first-order 720 Hz highpass */ n.fb=pdBq(ctx,'lowpass',odLP(d),-3); n.sh=initCurve(shaperNode(ctx, odCurve(d,p.clip)),'od',PD_K(p.drive,p.clip)); n.cs=ctx.createGain(); n.cs.gain.value=2; n.cd=shDelay(ctx); n.sum=ctx.createGain();
    pdPost(ctx,n,p); n.tone.frequency.value=1000; n.tone.gain.value=p.tone/2; n.t1=pdBq(ctx,'lowshelf',1000,null,-p.tone/2); pdDry(ctx,b,1); pdSetGains(n,pdMix(p,0.45),true);
    b.wetIn.connect(n.hp).connect(n.att); n.att.connect(n.h7).connect(n.fb).connect(n.sh).connect(n.cs).connect(n.sum); n.att.connect(n.cd).connect(n.sum); n.sum.connect(n.dc).connect(n.t1).connect(n.tone).connect(n.lp).connect(n.lvl).connect(b.wetOut); },
  apply(b){ const n=b.n,p=b.p, d=p.drive/100; pdApplyCommon(b); n.tone.gain.value=p.tone/2; n.t1.gain.value=-p.tone/2; n.fb.frequency.value=odLP(d); setCurve(n.sh,'od:'+PD_K(p.drive,p.clip),()=>odCurve(d,p.clip)); pdSetGains(n,pdMix(p,0.45)); } });

// ---------- Wavefolder: a Buchla-style folder ----------
// Past the edge the wave folds back on itself instead of flattening. Folds is how many times a loud note folds, Drive is how hard it hits, Symmetry offsets the wave so even harmonics appear (full turn: an octave-like rectifier), Shape goes from sharp corners (triangle) to a smooth sine fold.
function foldTri(u){ u=(u+1)%4; if(u<0) u+=4; return u<2 ? u-1 : 3-u; }
function foldCurve(drive, folds, sym, shape){ const g=1+Math.pow(drive,1.2)*4*folds, o=sym/100, s=shape/100; return pdCurve(x=>{ const v=x+o; return foldTri(v)*(1-s)+Math.sin(Math.PI*v/2)*s; }, g, false); }
def('fold', { name:'Wavefolder', cat:'Drive', color:'#f96', desc:'A Buchla-style wavefolder. Wild, synth-like harmonics that bloom as you dig in.', lat:SHAPER_LAT,
  params:Object.assign(driveParams(50,0,30,0),{ folds:P('Folds',1,6,4,'',1), symmetry:P('Symmetry',-100,100,0,'%'), shape:P('Shape',0,100,20,'%') }),
  note(b){ return 'Drive is how hard the wave hits the folder. Folds is how many times a loud note folds. Symmetry adds even harmonics. Shape softens the corners.'; },
  build(ctx,b){ const n=b.n,p=b.p; pdPre(ctx,n,p); n.sh=initCurve(shaperNode(ctx, foldCurve(p.drive/100,p.folds,p.symmetry,p.shape)),'fold',PD_K(p.drive,p.folds,p.symmetry,p.shape)); pdPost(ctx,n,p); pdDry(ctx,b,1); pdSetGains(n,pdMix(p,0.5),true);
    b.wetIn.connect(n.hp).connect(n.att).connect(n.sh).connect(n.dc).connect(n.lp).connect(n.tone).connect(n.lvl).connect(b.wetOut); },
  apply(b){ const n=b.n,p=b.p; pdApplyCommon(b); setCurve(n.sh,'fold:'+PD_K(p.drive,p.folds,p.symmetry,p.shape),()=>foldCurve(p.drive/100,p.folds,p.symmetry,p.shape)); pdSetGains(n,pdMix(p,0.5)); } });

// ---------- Tube Preamp: one 12AX7 stage (np-tube) ----------
def('tubepre', { name:'Tube Preamp', cat:'Drive', color:'#f96', desc:'A 12AX7 triode stage. Grid clamp on top, soft cutoff below, and a bias that blooms and ducks as you play.', lat:SHAPER_LAT,
  params:Object.assign(driveParams(40,0,25,0),{ bias:P('Bias',0,100,50,'%'), sag:P('Sag',0,100,30,'%') }),
  note(b){ const p=b.p; return (p.bias<35 ? 'Bias is cold: the bottom of the wave cuts off first. Crunchy and asymmetric.' : p.bias>65 ? 'Bias is hot: the top clamps first. Smoother, with more even harmonics.' : 'Bias is in the middle: a balanced stage.')+(p.sag>0 ? ' Sag holds hard playing back a little and lets go slowly.' : ''); },
  build(ctx,b){ const n=b.n,p=b.p; pdPre(ctx,n,p); n.tb=pdWorklet(ctx,'np-tube',{drive:p.drive/100, bias:p.bias/100, sag:p.sag/100}); pdPost(ctx,n,p); pdDry(ctx,b,1); pdSetGains(n,pdMix(p,0.7),true);
    b.wetIn.connect(n.hp).connect(n.att).connect(n.tb).connect(n.dc).connect(n.lp).connect(n.tone).connect(n.lvl).connect(b.wetOut); },
  apply(b){ const n=b.n,p=b.p; pdApplyCommon(b); wp(n.tb,'drive',p.drive/100); wp(n.tb,'bias',p.bias/100); wp(n.tb,'sag',p.sag/100); pdSetGains(n,pdMix(p,0.7)); } });

// ---------- Peach Muff: the Big Muff / Deluxe Bass Big Muff ----------
// Two diode clipping stages, both fixed. Sustain is the volume into the first one, like the real pot: at zero the first stage is nearly clean and the second does the work; at full both are slammed.
// Each stage rolls the highs off before it clips (the 470p feedback caps), so it stays smooth, and a coupling cap sits between them.
// The tone knob crossfades a lowpass against a highpass, which scoops the mids in the middle; a little of the other side always leaks through, like the real pot. Mids puts them back. Gate starves the input so decays sputter and chop.
function muffStage(){ return pdCurve(u=>u/Math.pow(1+Math.pow(Math.abs(u)/0.6,2.5),0.4), 8, true); }   // a silicon diode pair across a transistor stage: clean gain 13, then the diodes hold it
function muffSus(s){ return 0.02+Math.pow(s,1.3)*2.5; }
function muffGains(p){ const m=pdMix(p,0.55), t=p.tone/100; m.gl=0.08+0.92*(1-t); m.gh=(0.08+0.92*t)*1.3; m.sg=muffSus(p.sustain/100); return m; }
function muffGate(p){ return { threshold:-90+p.gate*0.72, attack:0.3, release:20, hold:3, range:-80 }; }
def('muff', { name:'Peach Muff', cat:'Drive', color:'#f96', desc:'A Big Muff fuzz for bass. Two clipping stages, the scooped tone knob, a mids knob to put them back, and a sputtery gate.', lat:2*SHAPER_LAT,
  params:{ sustain:P('Sustain',0,100,70,'%'), tone:P('Tone',0,100,50,'%'), mids:P('Mids',-12,12,0,'dB'), blend:P('Blend',0,100,70,'%'), level:P('Level',-24,24,0,'dB'), grunt:P('Grunt',30,300,60,'Hz'), gate:P('Gate',0,100,0,'%') },
  note(b){ return 'Tone goes dark to bright and scoops the mids in the middle. Mids puts them back.'+(b.p.gate>50 ? ' Gate is high: the tail of each note sputters and chops.' : b.p.gate>0 ? ' Gate cuts the tail of each note short.' : ''); },
  build(ctx,b){ const n=b.n,p=b.p; n.hp=pdBq(ctx,'highpass',p.grunt,0.7); n.gt=pdWorklet(ctx,'np-gate',muffGate(p)); n.sg=ctx.createGain(); n.lp1=pdBq(ctx,'lowpass',3000,-3); n.sh1=initCurve(shaperNode(ctx, muffStage()),'muff',0); n.dc1=pdBq(ctx,'highpass',12,0.5); n.cp=pdBq(ctx,'highpass',60,0.5); n.lp2=pdBq(ctx,'lowpass',2500,-3); n.sh2=initCurve(shaperNode(ctx, muffStage()),'muff',0); n.dc=pdBq(ctx,'highpass',12,0.5);
    n.tl=pdBq(ctx,'lowpass',450,-4); n.th=pdBq(ctx,'highpass',1500,-4); n.gl=ctx.createGain(); n.gh=ctx.createGain(); n.md=pdBq(ctx,'peaking',800,0.7,p.mids); n.lvl=ctx.createGain(); pdDry(ctx,b,2); pdSetGains(n,muffGains(p),true);
    b.wetIn.connect(n.hp).connect(n.gt).connect(n.sg).connect(n.lp1).connect(n.sh1).connect(n.dc1).connect(n.cp).connect(n.lp2).connect(n.sh2).connect(n.dc); n.dc.connect(n.tl).connect(n.gl).connect(n.md); n.dc.connect(n.th).connect(n.gh).connect(n.md); n.md.connect(n.lvl).connect(b.wetOut); },
  apply(b){ const n=b.n,p=b.p, g=muffGate(p); n.hp.frequency.value=p.grunt; for(const k in g) wp(n.gt,k,g[k]); n.md.gain.value=p.mids; pdSetGains(n,muffGains(p)); } });

// ---------- Octave Fuzz: an Octavia / Green Ringer ----------
// The octave comes from full-wave rectifying the note: every half cycle flips up, so the pitch doubles. It only comes out clean when the note is mostly its fundamental, so a lowpass picks that band first, and the clean octave needs a note played high up and alone.
// Octave sets how much rectified signal versus straight signal feeds the fuzz stage after it.
function ofzGains(p){ const m=pdMix(p,0.4), o=p.octave/100; m.go=o*1.6; m.gd=1-o*0.8; return m; }   // the two halves of a real rectifier never match, so some of the note always gets through
function rectCurve(){ return pdCurve(x=>Math.sqrt(x*x+0.0025)-0.05, 1, true); }   // a soft full-wave rectifier (germanium diodes)
function ofzCurve(drive){ return pdCurve(x=>Math.tanh(1.3*(x+0.1))-Math.tanh(0.13), 2+Math.pow(drive,1.5)*40, true); }   // a silicon transistor fuzz stage, leaning a little to one side
def('octfuzz', { name:'Octave Fuzz', cat:'Drive', color:'#f96', desc:'An Octavia. Rectified fuzz with a ringing octave up. Play high on the neck, one note at a time.', lat:2*SHAPER_LAT,
  params:Object.assign(driveParams(150,3,70,2),{ octave:P('Octave',0,100,60,'%') }),
  note(b){ return 'Octave is how much octave versus plain fuzz. The octave rings clearest above the 12th fret, one note at a time. Grunt trims the lows that muddy it.'; },
  build(ctx,b){ const n=b.n,p=b.p; pdPre(ctx,n,p); n.ob=pdBq(ctx,'lowpass',900,-3); n.rect=initCurve(shaperNode(ctx, rectCurve()),'rect',0); n.rdc=pdBq(ctx,'highpass',12,0.5); n.go=ctx.createGain(); n.od=shDelay(ctx); n.gd=ctx.createGain(); n.sum=ctx.createGain(); n.fz=initCurve(shaperNode(ctx, ofzCurve(p.drive/100)),'ofz',p.drive); pdPost(ctx,n,p); pdDry(ctx,b,2); pdSetGains(n,ofzGains(p),true);
    b.wetIn.connect(n.hp).connect(n.att); n.att.connect(n.ob).connect(n.rect).connect(n.rdc).connect(n.go).connect(n.sum); n.att.connect(n.od).connect(n.gd).connect(n.sum); n.sum.connect(n.fz).connect(n.dc).connect(n.lp).connect(n.tone).connect(n.lvl).connect(b.wetOut); },
  apply(b){ const n=b.n,p=b.p; pdApplyCommon(b); setCurve(n.fz,'ofz:'+p.drive,()=>ofzCurve(p.drive/100)); pdSetGains(n,ofzGains(p)); } });
