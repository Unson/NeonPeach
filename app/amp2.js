// ===== Neon Peach 2.3: the Neon 900 head. A Darkglass-style bass amp in one block. =====
// Built only from nodes that both engines have (gain, biquad, delay, the 4x drive, the compressor, the convolver),
// so it plays the same through the browser engine and the low-delay C++ engine.
'use strict';

// ---------- The four drive circuits ----------
// Each is a transfer curve for the 4x oversampled shaper. x is the signal after the pre-gain.
// b3k:   two CMOS inverter stages. A soft first stage with a little bias, then a hard second stage. Tight and clanky.
// vint:  a warmer, rounder clip that compresses early. Less gain, more even harmonics.
// alpha: a hard knee that stays clean right up to the edge, then clamps. Tight, punchy, bright.
// omega: saturates early and leans to one side, so it grows even harmonics and a fuzzy, raw edge.
const HEAD_CIRC={ b3k:{gain:120, f:(x)=>{ const y1=Math.tanh(1.1*(x+0.12))-Math.tanh(0.132); const u=y1*1.7; return u/Math.pow(1+Math.pow(Math.abs(u),3),1/3); }},
  vint:{gain:60, f:(x)=>{ const u=x+0.06; return Math.tanh(1.25*Math.tanh(0.8*u))-Math.tanh(1.25*Math.tanh(0.048)); }},
  alpha:{gain:100, f:(x)=>{ const u=x*1.2, y=u/Math.pow(1+Math.pow(Math.abs(u),5),1/5); return Math.tanh(1.3*y)/Math.tanh(1.3); }},
  omega:{gain:170, f:(x)=>{ let y=Math.tanh(1.6*(x+0.2))-Math.tanh(0.32); y=y-0.08*y*y*y; return y; }} };
function headCurve(circ, drive){ const N=8192, c=new Float32Array(N), m=HEAD_CIRC[circ]||HEAD_CIRC.b3k, g=1+Math.pow(drive,1.4)*m.gain;
  for(let i=0;i<N;i++) c[i]=m.f(((i/(N-1))*2-1)*g);
  let mx=0; for(let i=0;i<N;i++) mx=Math.max(mx,Math.abs(c[i])); if(mx>0) for(let i=0;i<N;i++) c[i]/=mx; return c; }
// Which two circuits the Mod knob blends, for each Circuit setting
const HEAD_PAIR=[['b3k','vint'],['alpha','omega']];
// Each circuit's own voice after the clip: two filters, [type, Hz, Q, dB]
const HEAD_VOICE={ b3k:[['highpass',60,0.7,0],['peaking',2000,1,2]], vint:[['peaking',500,0.9,2.5],['lowpass',4500,0.7,0]], alpha:[['highpass',85,0.7,0],['peaking',1200,1,2]], omega:[['lowshelf',140,0.7,3],['lowpass',5000,0.7,0]] };
function headVoice(f1, f2, circ){ const v=HEAD_VOICE[circ]||HEAD_VOICE.b3k; [f1,f2].forEach((f,i)=>{ const [t,hz,q,g]=v[i]; f.type=t; f.frequency.value=hz; f.Q.value=q; f.gain.value=g; }); }
const HEAD_GRUNT=[170,100,50], HEAD_ATT=[-6,0,8], HEAD_LMF=[250,500,1000], HEAD_HMF=[750,1500,3000];
// Every plain gain in the head, from the settings. Used when the block is made and every time a knob moves.
function headGains(p){ const bl=p.blend/100*Math.PI/2, mod=p.mod/100*Math.PI/2, cab=p.cab|0;
  return { inG:dB(p.input), cg:Math.cos(bl), lvl:dB(p.level)*Math.sin(bl)*0.5, gA:Math.cos(mod), gB:Math.sin(mod), m:dB(p.master)*0.6, cvg:cab>0?1:0, by:cab>0?0:1 }; }

def('head', { name:'Neon 900 Head', cat:'Amp', color:'#fc6', desc:'A Darkglass-style head. Microtubes or Alpha·Omega drive, 4-band EQ, power amp sag, and a cab.',
  params:{ drive:P('Drive',0,100,50,'%'), blend:P('Blend',0,100,60,'%'), level:P('Level',-24,24,0,'dB'), tone:P('Tone',-12,12,0,'dB'), mod:P('Mod',0,100,0,'%'), circuit:E('Circuit',['Microtubes','Alpha·Omega'],0),
    grunt:E('Grunt',['Thin','Raw','Fat'],1), attack:E('Attack',['Cut','Flat','Boost'],1), bite:P('Bite',0,100,0,'%'), growl:P('Growl',0,100,0,'%'), highcut:P('High Cut',3000,12000,7000,'Hz'), input:P('Gain',-12,24,0,'dB'),
    bass:P('Bass',-12,12,0,'dB'), lomid:P('Lo Mids',-12,12,0,'dB'), lomidf:E('Lo Mid Freq',['250','500','1k'],1), himid:P('Hi Mids',-12,12,0,'dB'), himidf:E('Hi Mid Freq',['750','1.5k','3k'],1), treble:P('Treble',-12,12,0,'dB'),
    master:P('Master',-24,12,0,'dB'), sag:P('Sag',0,100,25,'%'), cab:E('Cab',['Off'].concat(CAB_NAMES),0) },
  // the Mod knob is called Era on the Microtubes circuit, like the Vintage pedal
  spec(b,k,s){ if(k==='mod') return Object.assign({},s,{l:b.p.circuit?'Mod':'Era'}); return null; },
  note(b){ return b.p.circuit ? 'Mod blends Alpha (0, tight and punchy) into Omega (100, raw and fuzzy). Bite and Growl push highs and low mids into the drive.' : 'Era blends B3K (0, tight and clanky) into Vintage (100, warm and round). Grunt sets how much low end hits the drive.'; },
  build(ctx,b){ const n=b.n, p=b.p; const pair=HEAD_PAIR[p.circuit|0]||HEAD_PAIR[0];
    n.inHP=ctx.createBiquadFilter(); n.inHP.type='highpass'; n.inHP.frequency.value=28; n.inHP.Q.value=0.7; n.inG=ctx.createGain();
    // clean side waits for the drive, so blending them never thins out
    n.cd=ctx.createDelay(0.01); n.cd.delayTime.value=SHAPER_LAT/ctx.sampleRate; n.cg=ctx.createGain();
    // drive side: what goes in (grunt, growl, attack, bite), the two circuits, then what comes out (dc, high cut, tone, level)
    n.gr=ctx.createBiquadFilter(); n.gr.type='highpass'; n.gr.Q.value=0.7; n.growl=ctx.createBiquadFilter(); n.growl.type='peaking'; n.growl.frequency.value=280; n.growl.Q.value=1;
    n.att=ctx.createBiquadFilter(); n.att.type='highshelf'; n.att.frequency.value=2800; n.bite=ctx.createBiquadFilter(); n.bite.type='peaking'; n.bite.frequency.value=2800; n.bite.Q.value=1.3;
    n.shA=initCurve(shaperNode(ctx, headCurve(pair[0], p.drive/100)), pair[0], p.drive); n.shB=initCurve(shaperNode(ctx, headCurve(pair[1], p.drive/100)), pair[1], p.drive); n.gA=ctx.createGain(); n.gB=ctx.createGain(); n.vA1=ctx.createBiquadFilter(); n.vA2=ctx.createBiquadFilter(); n.vB1=ctx.createBiquadFilter(); n.vB2=ctx.createBiquadFilter();
    n.dc=ctx.createBiquadFilter(); n.dc.type='highpass'; n.dc.frequency.value=12; n.dc.Q.value=0.5; n.lp=ctx.createBiquadFilter(); n.lp.type='lowpass'; n.lp.Q.value=0.6; n.tone=ctx.createBiquadFilter(); n.tone.type='highshelf'; n.tone.frequency.value=1800; n.lvl=ctx.createGain();
    // the amp: 4-band EQ, power amp sag, master, cab
    n.eq0=ctx.createGain(); n.bass=ctx.createBiquadFilter(); n.bass.type='lowshelf'; n.bass.frequency.value=70; n.lm=ctx.createBiquadFilter(); n.lm.type='peaking'; n.lm.Q.value=0.8; n.hm=ctx.createBiquadFilter(); n.hm.type='peaking'; n.hm.Q.value=0.8; n.tr=ctx.createBiquadFilter(); n.tr.type='highshelf'; n.tr.frequency.value=5000;
    n.sag=compNode(ctx); n.sag.parameters.get('knee').value=10; n.sag.parameters.get('attack').value=5; n.sag.parameters.get('release').value=150; n.sag.parameters.get('auto').value=1; n.m=ctx.createGain();
    n.cv=ctx.createConvolver(); n.cvg=ctx.createGain(); n.by=ctx.createGain(); n.cur=-1;
    { const g=headGains(p); for(const k in g) n[k].gain.value=g[k]; }   // every gain starts where it belongs, so a new block has no loud first moment
    b.wetIn.connect(n.inHP).connect(n.inG);
    n.inG.connect(n.cd).connect(n.cg).connect(n.eq0);
    n.inG.connect(n.gr).connect(n.growl).connect(n.att).connect(n.bite); n.bite.connect(n.shA).connect(n.vA1).connect(n.vA2).connect(n.gA).connect(n.dc); n.bite.connect(n.shB).connect(n.vB1).connect(n.vB2).connect(n.gB).connect(n.dc);
    n.dc.connect(n.lp).connect(n.tone).connect(n.lvl).connect(n.eq0);
    n.eq0.connect(n.bass).connect(n.lm).connect(n.hm).connect(n.tr).connect(n.sag).connect(n.m);
    n.m.connect(n.cv).connect(n.cvg).connect(b.wetOut); n.m.connect(n.by).connect(b.wetOut); },
  apply(b){ const n=b.n, p=b.p, pair=HEAD_PAIR[p.circuit|0]||HEAD_PAIR[0], d=p.drive/100;
    { const g=headGains(p); for(const k in g) setP(n[k].gain, g[k]); }
    n.gr.frequency.value=HEAD_GRUNT[p.grunt|0]??100; n.growl.gain.value=p.growl/100*9; n.att.gain.value=HEAD_ATT[p.attack|0]??0; n.bite.gain.value=p.bite/100*10;
    setCurve(n.shA, pair[0]+':'+p.drive, ()=>headCurve(pair[0], d)); setCurve(n.shB, pair[1]+':'+p.drive, ()=>headCurve(pair[1], d)); headVoice(n.vA1, n.vA2, pair[0]); headVoice(n.vB1, n.vB2, pair[1]);
    n.lp.frequency.value=p.highcut; n.tone.gain.value=p.tone;
    n.bass.gain.value=p.bass; n.lm.frequency.value=HEAD_LMF[p.lomidf|0]??500; n.lm.gain.value=p.lomid; n.hm.frequency.value=HEAD_HMF[p.himidf|0]??1500; n.hm.gain.value=p.himid; n.tr.gain.value=p.treble;
    wp(n.sag,'threshold',-30+(1-p.sag/100)*30); wp(n.sag,'ratio',1+p.sag/100*2.5);
    const cab=p.cab|0; if(cab!==n.cur){ n.cur=cab; n.cv.buffer = cab>0 ? genCabIR(NP.ctx, CAB_NAMES[cab-1]) : null; } }
});

// ===== Melted Raspberry: the Neon 900's bigger sibling. Two bands, two drive stages, a 6-band EQ. =====
// What is new over the 900:
// - The lows stay clean. Everything under Split goes around the drive, through its own squeeze, and comes back in time.
// - Two drive stages. A soft Warmth stage first (even harmonics, a little squash), then the circuit pair. That is the "melted" part.
// - A third circuit pair, Raspberry: Melt (creamy, round) to Jam (crunchy, mid-forward).
// - Presence after the drive, a 6-band EQ and an Air shelf instead of the 4-band stack.
Object.assign(HEAD_CIRC, {
  melt:{gain:80, f:(x)=>{ const u=1.1*x+0.25, y=u/Math.sqrt(1+u*u); return y-0.25/Math.sqrt(1.0625); }},
  jam:{gain:130, f:(x)=>{ const u=1.3*x, y=u/Math.pow(1+Math.pow(Math.abs(u),2.5),0.4); return Math.tanh(1.5*y)/Math.tanh(1.5); }} });
Object.assign(HEAD_VOICE, { melt:[['peaking',350,0.8,2.5],['lowpass',5200,0.7,0]], jam:[['highpass',70,0.7,0],['peaking',900,1,3]] });
const RASP_PAIR=[['b3k','vint'],['alpha','omega'],['melt','jam']], RASP_F=[70,180,400,1000,2500,6000];
function raspGains(p){ const bl=p.blend/100*Math.PI/2, mod=p.mod/100*Math.PI/2, cab=p.cab|0;
  return { inG:dB(p.input), lcg:Math.cos(bl), lvl:dB(p.level)*Math.sin(bl)*0.5, gA:Math.cos(mod), gB:Math.sin(mod), lowG:dB(p.lows), m:dB(p.master)*0.6, cvg:cab>0?1:0, by:cab>0?0:1 }; }

def('raspberry', { name:'Melted Raspberry', cat:'Amp', color:'#ff5c8a', desc:'The 900 with the lows kept clean, two drive stages, a Raspberry circuit, and a 6-band EQ.',
  params:{ drive:P('Drive',0,100,50,'%'), blend:P('Blend',0,100,65,'%'), level:P('Level',-24,24,0,'dB'), tone:P('Tone',-12,12,0,'dB'), mod:P('Mod',0,100,0,'%'), circuit:E('Circuit',['Microtubes','Alpha·Omega','Raspberry'],2),
    xo:P('Split at',60,500,180,'Hz'), warmth:P('Warmth',0,100,35,'%'), squeeze:P('Low Squeeze',0,100,40,'%'), lows:P('Lows',-24,12,0,'dB'), attack:E('Attack',['Cut','Flat','Boost'],1), bite:P('Bite',0,100,0,'%'),
    highcut:P('High Cut',3000,12000,7500,'Hz'), presence:P('Presence',-12,12,0,'dB'), input:P('Gain',-12,24,0,'dB'), b0:P('70',-12,12,0,'dB'), b1:P('180',-12,12,0,'dB'), b2:P('400',-12,12,0,'dB'),
    b3:P('1k',-12,12,0,'dB'), b4:P('2.5k',-12,12,0,'dB'), b5:P('6k',-12,12,0,'dB'), air:P('Air',-12,12,0,'dB'), master:P('Master',-24,12,0,'dB'), sag:P('Sag',0,100,25,'%'), cab:E('Cab',['Off'].concat(CAB_NAMES),0) },
  spec(b,k,s){ if(k==='mod') return Object.assign({},s,{l:(b.p.circuit|0)===0?'Era':'Mod'}); return null; },
  note(b){ const c=b.p.circuit|0; return (c===2 ? 'Mod blends Melt (0, creamy and round) into Jam (100, crunchy and mid-forward).' : c===1 ? 'Mod blends Alpha (0) into Omega (100).' : 'Era blends B3K (0) into Vintage (100).')+' Everything under Split stays clean, with its own squeeze. Warmth is a soft first stage before the drive.'; },
  build(ctx,b){ const n=b.n, p=b.p; const pair=RASP_PAIR[p.circuit|0]||RASP_PAIR[2], LAT=2*SHAPER_LAT/ctx.sampleRate;
    n.inHP=ctx.createBiquadFilter(); n.inHP.type='highpass'; n.inHP.frequency.value=28; n.inHP.Q.value=0.7; n.inG=ctx.createGain();
    // lows: around the drive, squeezed, and held back two drive stages' worth so they land in time with the highs
    n.lp4=lr4(ctx,'lowpass',p.xo); n.ld=ctx.createDelay(0.01); n.ld.delayTime.value=LAT; n.lc=compNode(ctx); n.lc.parameters.get('attack').value=15; n.lc.parameters.get('release').value=150; n.lc.parameters.get('knee').value=6; n.lowG=ctx.createGain();
    // highs: clean copy (waits), and the drive: attack, bite, warmth stage, circuit pair, dc, high cut, presence, tone, level
    n.hp4=lr4(ctx,'highpass',p.xo); n.hd=ctx.createDelay(0.01); n.hd.delayTime.value=LAT; n.lcg=ctx.createGain();
    n.att=ctx.createBiquadFilter(); n.att.type='highshelf'; n.att.frequency.value=2800; n.bite=ctx.createBiquadFilter(); n.bite.type='peaking'; n.bite.frequency.value=2800; n.bite.Q.value=1.3;
    n.warm=initCurve(shaperNode(ctx, makeCurve('tube', p.warmth/100*0.35)), 'warm', p.warmth); n.wdc=ctx.createBiquadFilter(); n.wdc.type='highpass'; n.wdc.frequency.value=12; n.wdc.Q.value=0.5;
    n.shA=initCurve(shaperNode(ctx, headCurve(pair[0], p.drive/100)), pair[0], p.drive); n.shB=initCurve(shaperNode(ctx, headCurve(pair[1], p.drive/100)), pair[1], p.drive); n.gA=ctx.createGain(); n.gB=ctx.createGain(); n.vA1=ctx.createBiquadFilter(); n.vA2=ctx.createBiquadFilter(); n.vB1=ctx.createBiquadFilter(); n.vB2=ctx.createBiquadFilter();
    n.dc=ctx.createBiquadFilter(); n.dc.type='highpass'; n.dc.frequency.value=12; n.dc.Q.value=0.5; n.lp=ctx.createBiquadFilter(); n.lp.type='lowpass'; n.lp.Q.value=0.6; n.pres=ctx.createBiquadFilter(); n.pres.type='peaking'; n.pres.frequency.value=3200; n.pres.Q.value=1; n.tone=ctx.createBiquadFilter(); n.tone.type='highshelf'; n.tone.frequency.value=1800; n.lvl=ctx.createGain();
    // the amp: 6-band EQ, air, sag, master, cab
    n.eq0=ctx.createGain(); n.eq=RASP_F.map((f,i)=>{ const q=ctx.createBiquadFilter(); q.type=i===0?'lowshelf':'peaking'; q.frequency.value=f; q.Q.value=1.1; return q; }); n.air=ctx.createBiquadFilter(); n.air.type='highshelf'; n.air.frequency.value=9000;
    n.sag=compNode(ctx); n.sag.parameters.get('knee').value=10; n.sag.parameters.get('attack').value=5; n.sag.parameters.get('release').value=150; n.sag.parameters.get('auto').value=1; n.m=ctx.createGain();
    n.cv=ctx.createConvolver(); n.cvg=ctx.createGain(); n.by=ctx.createGain(); n.cur=-1;
    { const g=raspGains(p); for(const k in g) n[k].gain.value=g[k]; }
    b.wetIn.connect(n.inHP).connect(n.inG);
    n.inG.connect(n.lp4.i); n.lp4.o.connect(n.ld).connect(n.lc).connect(n.lowG).connect(n.eq0);
    n.inG.connect(n.hp4.i); n.hp4.o.connect(n.hd).connect(n.lcg).connect(n.eq0);
    n.hp4.o.connect(n.att).connect(n.bite).connect(n.warm).connect(n.wdc); n.wdc.connect(n.shA).connect(n.vA1).connect(n.vA2).connect(n.gA).connect(n.dc); n.wdc.connect(n.shB).connect(n.vB1).connect(n.vB2).connect(n.gB).connect(n.dc);
    n.dc.connect(n.lp).connect(n.pres).connect(n.tone).connect(n.lvl).connect(n.eq0);
    let prev=n.eq0; n.eq.forEach(q=>{ prev.connect(q); prev=q; }); prev.connect(n.air).connect(n.sag).connect(n.m);
    n.m.connect(n.cv).connect(n.cvg).connect(b.wetOut); n.m.connect(n.by).connect(b.wetOut); },
  apply(b){ const n=b.n, p=b.p, pair=RASP_PAIR[p.circuit|0]||RASP_PAIR[2], d=p.drive/100;
    { const g=raspGains(p); for(const k in g) setP(n[k].gain, g[k]); }
    n.lp4.set(p.xo); n.hp4.set(p.xo); wp(n.lc,'threshold',-6-p.squeeze*0.3); wp(n.lc,'ratio',1+p.squeeze/100*5); wp(n.lc,'makeup',p.squeeze*0.06);
    n.att.gain.value=HEAD_ATT[p.attack|0]??0; n.bite.gain.value=p.bite/100*10; setCurve(n.warm, 'warm:'+p.warmth, ()=>makeCurve('tube', p.warmth/100*0.35));
    setCurve(n.shA, pair[0]+':'+p.drive, ()=>headCurve(pair[0], d)); setCurve(n.shB, pair[1]+':'+p.drive, ()=>headCurve(pair[1], d)); headVoice(n.vA1, n.vA2, pair[0]); headVoice(n.vB1, n.vB2, pair[1]);
    n.lp.frequency.value=p.highcut; n.pres.gain.value=p.presence; n.tone.gain.value=p.tone;
    n.eq.forEach((q,i)=>q.gain.value=p['b'+i]); n.air.gain.value=p.air;
    wp(n.sag,'threshold',-30+(1-p.sag/100)*30); wp(n.sag,'ratio',1+p.sag/100*2.5);
    const cab=p.cab|0; if(cab!==n.cur){ n.cur=cab; n.cv.buffer = cab>0 ? genCabIR(NP.ctx, CAB_NAMES[cab-1]) : null; } }
});
