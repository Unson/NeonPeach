// Checks the dyn pedal family (comp, gate, limiter, envf, wah, filter) through the native engine. No browser needed.
// Run: NP_ADDON=native/build/dyn/npaudio.node node native/test/pedals_dyn.js
const {render, stats, bands, rmsAt, toneLevel, signal, sine, impulse, checker, SR, N} = require('./lib');
const {ok, done} = checker();
const dB = (r) => 20*Math.log10(r + 1e-12);
// a sine that steps from one level to another at tAt seconds
function stepSine(f, lv1, lv2, tAt){ const x = new Float32Array(N); for(let i = 0; i < N; i++) x[i] = (i < tAt*SR ? lv1 : lv2)*Math.sin(2*Math.PI*f*i/SR); return x; }
// a note that fades from lv down to nothing over dur seconds (an exponential tail, like a bass note ringing out)
function fadeNote(f, lv, dur){ const x = new Float32Array(N); for(let i = 0; i < dur*SR; i++) x[i] = lv*Math.sin(2*Math.PI*f*i/SR)*Math.exp(-i/SR*8/dur); return x; }
// the gain track of a block: rms(out)/rms(in) over 5 ms windows, where the input is not silent
function gainTrack(y, x){ const w = Math.round(SR*0.005), g = []; for(let i = 0; i + w <= N; i += w){ let a = 0, b = 0; for(let j = i; j < i + w; j++){ a += y[j]*y[j]; b += x[j]*x[j]; } g.push(b > 1e-10 ? Math.sqrt(a/b) : -1); } return g; }
// how often the gain falls from open (> hi) to shut (< lo) and back
function flips(g, lo, hi){ let state = 0, closes = 0, opens = 0; for(const v of g){ if(v < 0) continue; if(state !== 1 && v > hi){ state = 1; opens++; } else if(state !== -1 && v < lo){ if(state === 1) closes++; state = -1; } } return {closes, opens}; }
function firstPeak(y){ let pk = 0; for(let i = 0; i < 0.1*SR; i++) pk = Math.max(pk, Math.abs(y[i])); return pk; }
// a new block must not be louder in its first 100 ms than it is later on (resonant filters and make-up gain are allowed to be loud, but not only at the start)
function quietStart(y, s){ return firstPeak(y) <= Math.max(1.2, s.pk*1.05); }
// the dry sound, skipping the first 50 ms (the test harness fades the block in over a millisecond)
function isDry(y, x){ let md = 0; for(let i = Math.round(0.05*SR); i < N; i++) md = Math.max(md, Math.abs(y[i] - x[i])); return md < 1e-4; }
function imp(){ const x = new Float32Array(N); x[Math.round(0.5*SR)] = 1; return x; }
// where a filter's output peaks, by probing a spectrum from an impulse
const PROBE = []; for(let f = 150; f < 6000; f *= 1.04) PROBE.push(f);
function peakFreq(y){ let best = -1e9, bf = 0; for(const f of PROBE){ const l = toneLevel(y, f, 0.5, 8192); if(l > best){ best = l; bf = f; } } return {f: bf, lvl: best}; }
const inStats = stats(signal());

// ---------------- Super Squeeze ----------------
// a compressor lets the first pluck through until its attack catches up, times the make-up gain (the old np-comp did the same). So the first 100 ms may be no louder than that.
const MK = Math.pow(10, (4 + 0.6*22*(1 - 1/4))/20), inFirst = firstPeak(signal());
for(let t = 0; t < 4; t++){ const nm = ['OTA', 'Opto', 'FET', 'VCA'][t], y = render('comp', {type: t}), s = stats(y);
  ok(!s.nan, 'comp ' + nm + ': no NaN'); ok(firstPeak(y) <= inFirst*MK*1.01, 'comp ' + nm + ': no loud first moment beyond the make-up gain (' + firstPeak(y).toFixed(3) + ', input ' + inFirst.toFixed(3) + ' x make-up ' + MK.toFixed(2) + ')');
  ok(Math.abs(dB(s.rms/inStats.rms)) < 8, 'comp ' + nm + ': sane level (' + dB(s.rms/inStats.rms).toFixed(1) + ' dB vs input)'); }
{ // the VCA is the sound old presets get: same squash and same make-up as the old feed-forward comp. Here: it compresses, and the level stays near the input
  const y = render('comp', {type: 3, thr: -30, ratio: 4}, stepSine(110, 0.5, 0.05, 1.0)); const loud = rmsAt(y, 0.6, 0.9), quiet = rmsAt(y, 1.7, 2.0);
  ok(dB(loud/quiet) < dB(0.5/0.05) - 6, 'comp VCA: squashes (loud to quiet gap ' + dB(loud/quiet).toFixed(1) + ' dB, input gap ' + dB(0.5/0.05).toFixed(1) + ')'); }
{ // OTA squashes harder and lets go slower than VCA at the same knobs
  const k = {thr: -30, ratio: 4, release: 150}, x = stepSine(110, 0.5, 0.05, 1.0), ota = render('comp', Object.assign({type: 0}, k), x), vca = render('comp', Object.assign({type: 3}, k), x);
  const gO = rmsAt(ota, 0.6, 0.9)/rmsAt(ota, 1.7, 2.0), gV = rmsAt(vca, 0.6, 0.9)/rmsAt(vca, 1.7, 2.0);
  ok(gO < gV, 'comp OTA squashes harder than VCA (loud/quiet gap ' + dB(gO).toFixed(1) + ' dB vs ' + dB(gV).toFixed(1) + ' dB)');
  const relO = rmsAt(ota, 1.02, 1.08)/rmsAt(ota, 1.7, 2.0), relV = rmsAt(vca, 1.02, 1.08)/rmsAt(vca, 1.7, 2.0);
  ok(relO < relV, 'comp OTA releases slower than VCA (level 20..80 ms after the drop: ' + dB(relO).toFixed(1) + ' dB vs ' + dB(relV).toFixed(1) + ' dB of final)'); }
{ // Opto: two-stage release. The fast part lets go in a few hundred ms; the slow part is still coming back a second later
  const x = stepSine(110, 0.5, 0.05, 1.0), y = render('comp', {type: 1, thr: -30, ratio: 6, release: 100}, x), vca = render('comp', {type: 3, thr: -30, ratio: 6, release: 100}, x);
  const g = gainTrack(y, x), gv = gainTrack(vca, x), at = (t) => g[Math.floor(t/0.005)], atv = (t) => gv[Math.floor(t/0.005)];
  const g0 = at(0.98), gEnd = at(1.99), f3 = (at(1.3) - g0)/(gEnd - g0), f9 = (at(1.9) - g0)/(gEnd - g0), v3 = (atv(1.3) - g0)/(atv(1.99) - g0);
  ok(f3 > 0.35 && f3 < 0.9, 'comp Opto: the fast half has let go 300 ms after the drop (' + (f3*100).toFixed(0) + '% recovered)');
  ok(f9 > f3 && f9 < 0.995, 'comp Opto: the slow half is still letting go 900 ms after (' + (f9*100).toFixed(0) + '% recovered)');
  ok(v3 > 0.95, 'comp VCA at the same knobs is done by then (' + (v3*100).toFixed(0) + '%)'); }
{ // FET: attack ten times faster. Less of the loud onset gets through
  const x = stepSine(110, 0.02, 0.5, 1.0), fet = render('comp', {type: 2, thr: -30, ratio: 8, attack: 20}, x), vca = render('comp', {type: 3, thr: -30, ratio: 8, attack: 20}, x);
  const oF = rmsAt(fet, 1.0, 1.004)/rmsAt(fet, 1.5, 1.9), oV = rmsAt(vca, 1.0, 1.004)/rmsAt(vca, 1.5, 1.9);
  ok(oF < oV, 'comp FET bites faster than VCA (onset overshoot ' + dB(oF).toFixed(1) + ' dB vs ' + dB(oV).toFixed(1) + ' dB)'); }
{ const a = stats(render('comp', {type: 3, thr: -40, ratio: 10, makeup: 0})), b = stats(render('comp', {type: 3, thr: -40, ratio: 10, makeup: 12}));
  ok(Math.abs(dB(b.rms/a.rms) - 12) < 1, 'comp Makeup adds what it says (+' + dB(b.rms/a.rms).toFixed(1) + ' dB)');
  const w = stats(render('comp', {thr: -40, ratio: 10, blend: 100})), h = stats(render('comp', {thr: -40, ratio: 10, blend: 0})), d = stats(signal());
  ok(Math.abs(h.rms - d.rms) < 0.002 && w.rms !== h.rms, 'comp Blend 0 is the dry sound');
  const lo = stats(render('comp', {type: 3, thr: -40, ratio: 10, schpf: 20}, sine(55, 0.4))), hi = stats(render('comp', {type: 3, thr: -40, ratio: 10, schpf: 500}, sine(55, 0.4)));
  ok(hi.rms > lo.rms*1.5, 'comp Ignore Lows: a 55 Hz note is squashed less when the detector ignores lows'); }

// ---------------- Peach Gate ----------------
{ const y = render('gate', {}), s = stats(y); ok(!s.nan, 'gate: no NaN'); ok(quietStart(y, s), 'gate: no loud first moment'); ok(Math.abs(dB(s.rms/inStats.rms)) < 1, 'gate: default passes the bass line (' + dB(s.rms/inStats.rms).toFixed(2) + ' dB)'); }
{ // a decaying low note crosses the threshold once. The gate must close once, without chatter
  const x = fadeNote(41.2, 0.5, 2.5), y = render('gate', {thr: -30, release: 50, hold: 40}, x), g = gainTrack(y, x), f = flips(g, 0.1, 0.5);
  ok(f.closes === 1 && f.opens === 1, 'gate closes once on a decaying low E with no chatter (opens ' + f.opens + ', closes ' + f.closes + ')');
  const hp = fadeNote(41.2, 0.5, 2.5); for(let i = 0; i < N; i++) hp[i] += 0.0003*Math.sin(2*Math.PI*60*i/SR);   // a little hum under it
  const y2 = render('gate', {thr: -30, release: 50, hold: 0}, hp), f2 = flips(gainTrack(y2, hp), 0.1, 0.5);
  ok(f2.closes === 1, 'gate stays shut on hum after the note (closes ' + f2.closes + ')');
  ok(rmsAt(y, 1.8, 2.0) < rmsAt(x, 1.8, 2.0)*0.01, 'gate: the tail is cut to Range (' + dB(rmsAt(y, 1.8, 2.0)/rmsAt(x, 1.8, 2.0)).toFixed(1) + ' dB)'); }
{ // Close Below: a higher value holds the gate open longer on the fading note
  const x = fadeNote(55, 0.5, 1.6); const tClose = (h) => { const g = gainTrack(render('gate', {thr: -24, hyst: h, release: 30, hold: 0}, x), x); for(let i = 0; i < g.length; i++) if(g[i] >= 0 && g[i] < 0.5 && i > 10) return i*0.005; return 2; };
  const t0 = tClose(0), t20 = tClose(20); ok(t20 > t0 + 0.1, 'gate Close Below holds the gate open longer (closes at ' + t20.toFixed(2) + ' s vs ' + t0.toFixed(2) + ' s)'); }
{ // Decay: at 100 the tail fades with the note instead of cutting off
  const x = fadeNote(55, 0.5, 2.5), hard = render('gate', {thr: -24, release: 30, hold: 0, decay: 0}, x), soft = render('gate', {thr: -24, release: 30, hold: 0, decay: 100}, x);
  const g = gainTrack(hard, x); let tc = 2; for(let i = 10; i < g.length; i++) if(g[i] >= 0 && g[i] < 0.5){ tc = i*0.005; break; }
  const w0 = tc + 0.1, w1 = tc + 0.3, rH = rmsAt(hard, w0, w1), rS = rmsAt(soft, w0, w1), rX = rmsAt(x, w0, w1);
  ok(rS > rH*3 && rS < rX, 'gate Decay 100 fades the tail instead of cutting it (' + dB(rS/rX).toFixed(1) + ' dB vs ' + dB(rH/rX).toFixed(1) + ' dB hard)');
  const r20 = render('gate', {thr: -24, release: 30, hold: 0, range: -20}, x); ok(Math.abs(dB(rmsAt(r20, 1.8, 2.0)/rmsAt(x, 1.8, 2.0)) + 20) < 1.5, 'gate Range -20 leaves -20 dB (' + dB(rmsAt(r20, 1.8, 2.0)/rmsAt(x, 1.8, 2.0)).toFixed(1) + ' dB)'); }
{ // Attack and Release set how fast the gain moves
  const x = stepSine(110, 0.001, 0.4, 1.0), fast = render('gate', {thr: -30, attack: 0.1}, x), slow = render('gate', {thr: -30, attack: 50}, x);
  ok(rmsAt(slow, 1.0, 1.02) < rmsAt(fast, 1.0, 1.02)*0.7, 'gate Attack 50 ms opens slower than 0.1 ms');
  const x2 = stepSine(110, 0.4, 0.001, 1.0), rf = render('gate', {thr: -30, release: 5, hold: 0}, x2), rs = render('gate', {thr: -30, release: 2000, hold: 0}, x2);
  ok(rmsAt(rs, 1.3, 1.5) > rmsAt(rf, 1.3, 1.5)*10, 'gate Release 2 s closes slower than 5 ms'); }

// ---------------- Brickwall ----------------
{ const y = render('limiter', {}), s = stats(y); ok(!s.nan, 'limiter: no NaN'); ok(quietStart(y, s), 'limiter: no loud first moment'); ok(Math.abs(dB(s.rms/inStats.rms)) < 1, 'limiter: default leaves the bass line alone (' + dB(s.rms/inStats.rms).toFixed(2) + ' dB)'); }
for(let t = 0; t < 2; t++){ const nm = t ? 'Soft' : 'Hard', y = render('limiter', {type: t, gain: 20, ceil: -6}), s = stats(y), cl = Math.pow(10, -6/20);
  ok(s.pk <= cl*1.02, 'limiter ' + nm + ': nothing over the ceiling (peak ' + dB(s.pk).toFixed(2) + ' dBFS, ceiling -6)'); ok(s.rms > 0.2, 'limiter ' + nm + ': loud and dense (rms ' + s.rms.toFixed(3) + ')'); }
{ const x = stepSine(110, 0.9, 0.05, 1.0), h = render('limiter', {type: 0, ceil: -12, release: 100}, x), s = render('limiter', {type: 1, ceil: -12, release: 100}, x);
  ok(rmsAt(s, 1.02, 1.1) < rmsAt(h, 1.02, 1.1)*0.9, 'limiter Soft lets go slower after a long squash (' + dB(rmsAt(s, 1.02, 1.1)/rmsAt(h, 1.02, 1.1)).toFixed(1) + ' dB behind Hard)');
  const q = sine(110, Math.pow(10, -13/20)), hq = render('limiter', {type: 0, ceil: -12}, q), sq = render('limiter', {type: 1, ceil: -12}, q);
  ok(rmsAt(sq, 1.5, 1.9) < rmsAt(hq, 1.5, 1.9)*0.98 && rmsAt(sq, 1.5, 1.9) > rmsAt(hq, 1.5, 1.9)*0.9, 'limiter Soft starts easing in under the ceiling (' + dB(rmsAt(sq, 1.5, 1.9)/rmsAt(hq, 1.5, 1.9)).toFixed(2) + ' dB at 1 dB under; Hard does nothing there)'); }

// ---------------- Envelope Filter ----------------
{ const y = render('envf', {}), s = stats(y); ok(!s.nan, 'envf: no NaN'); ok(quietStart(y, s), 'envf: no loud first moment (' + firstPeak(y).toFixed(3) + ' vs ' + s.pk.toFixed(3) + ' later)'); ok(Math.abs(dB(s.rms/inStats.rms)) < 8, 'envf: sane level (' + dB(s.rms/inStats.rms).toFixed(1) + ' dB)'); }
{ // sweeps up with level: a louder pluck opens the filter wider, so more of the top gets through
  const soft = bands(render('envf', {sens: 20}, signal({level: 0.05, bright: 1})), 0.41), loud = bands(render('envf', {sens: 20}, signal({level: 0.5, bright: 1})), 0.41), xs = bands(signal({level: 0.05, bright: 1}), 0.41), xl = bands(signal({level: 0.5, bright: 1}), 0.41);
  const tiltS = (soft.himid - soft.low) - (xs.himid - xs.low), tiltL = (loud.himid - loud.low) - (xl.himid - xl.low);
  ok(tiltL > tiltS + 6, 'envf Up: louder playing opens the filter (' + tiltL.toFixed(1) + ' dB vs ' + tiltS.toFixed(1) + ' dB of top kept)');
  const dS = bands(render('envf', {sens: 20, dir: 1}, signal({level: 0.05, bright: 1})), 0.41), dL = bands(render('envf', {sens: 20, dir: 1}, signal({level: 0.5, bright: 1})), 0.41);
  const dtS = (dS.himid - dS.low) - (xs.himid - xs.low), dtL = (dL.himid - dL.low) - (xl.himid - xl.low);
  ok(dtL < dtS - 6, 'envf Down: louder playing closes the filter (' + dtL.toFixed(1) + ' dB vs ' + dtS.toFixed(1) + ' dB of top kept)'); }
{ // Reso at the top rings on its own after the note stops, and stays tame
  const x = sine(110, 0.3, 0.3), ring = render('envf', {q: 20, sens: 0}, x), mild = render('envf', {q: 4, sens: 0}, x);
  ok(rmsAt(ring, 1.5, 2.0) > 0.01, 'envf Reso 20 sings on its own after the note (rms ' + rmsAt(ring, 1.5, 2.0).toFixed(3) + ' in silence)');
  ok(stats(ring).pk < 1.0, 'envf: the ringing is tamed (peak ' + stats(ring).pk.toFixed(3) + ')');
  ok(rmsAt(mild, 1.5, 2.0) < 0.001, 'envf Reso 4 is quiet after the note'); }
{ // Gain drives the input stage: a sine grows harmonics
  const x = sine(110, 0.4), c = render('envf', {gain: 0, fmin: 2000, range: 0, q: 0.5}, x), d = render('envf', {gain: 100, fmin: 2000, range: 0, q: 0.5}, x);
  ok(toneLevel(d, 330) > toneLevel(c, 330) + 15, 'envf Gain adds harmonics (3rd harmonic ' + toneLevel(d, 330).toFixed(1) + ' dB vs ' + toneLevel(c, 330).toFixed(1) + ')');
  const lp = bands(render('envf', {type: 0, sens: 0, fmin: 300, q: 2}), 0.41), hp = bands(render('envf', {type: 2, sens: 0, fmin: 300, q: 2}), 0.41), bp = bands(render('envf', {type: 1, sens: 0, fmin: 300, q: 2}), 0.41);
  ok(lp.low - lp.high > hp.low - hp.high + 20, 'envf Low Pass and High Pass point opposite ways'); ok(bp.low < lp.low - 6 && bp.high < hp.high - 6, 'envf Band Pass trims both ends');
  ok(isDry(render('envf', {mix: 0}), signal()), 'envf Mix 0 is the dry sound'); }
{ const x = stepSine(440, 0.001, 0.4, 1.0), fast = render('envf', {attack: 1, decay: 10, sens: 20}, x), slow = render('envf', {attack: 200, decay: 10, sens: 20}, x);
  ok(toneLevel(fast, 440, 1.0, 2048) > toneLevel(slow, 440, 1.0, 2048) + 3, 'envf Attack 1 ms opens the filter faster than 200 ms (' + toneLevel(fast, 440, 1.0, 2048).toFixed(1) + ' vs ' + toneLevel(slow, 440, 1.0, 2048).toFixed(1) + ' dB of a 440 Hz note in its first 40 ms)'); }

// ---------------- Pedal Wah ----------------
{ const y = render('wah', {}), s = stats(y); ok(!s.nan, 'wah: no NaN'); ok(quietStart(y, s), 'wah: no loud first moment'); ok(s.rms > inStats.rms*0.1 && s.rms < inStats.rms*2, 'wah: sane level (' + dB(s.rms/inStats.rms).toFixed(1) + ' dB; a bass wah at mid sweep is thinner than the dry bass)'); }
{ const pk = (prm) => peakFreq(render('wah', prm, imp())), heel = pk({pos: 10}), mid = pk({pos: 50}), toe = pk({pos: 90});
  ok(heel.f < mid.f && mid.f < toe.f, 'wah peak moves up with Position (' + heel.f.toFixed(0) + ' -> ' + mid.f.toFixed(0) + ' -> ' + toe.f.toFixed(0) + ' Hz)');
  ok(mid.lvl > toneLevel(imp(), mid.f, 0.5, 8192) + 3, 'wah has gain at the peak (+' + (mid.lvl - toneLevel(imp(), mid.f, 0.5, 8192)).toFixed(1) + ' dB)');
  const cb = pk({model: 0, pos: 50}), bq = pk({model: 1, pos: 50}), vx = pk({model: 2, pos: 50});
  ok(bq.f < cb.f*0.85, 'wah Bass 105Q sits lower than Cry Baby (' + bq.f.toFixed(0) + ' vs ' + cb.f.toFixed(0) + ' Hz)'); ok(vx.f > cb.f*1.08, 'wah Vox sits higher than Cry Baby (' + vx.f.toFixed(0) + ' Hz)');
  const bB = bands(render('wah', {model: 1}), 0.41), bC = bands(render('wah', {model: 0}), 0.41); ok(bB.low - bB.himid > bC.low - bC.himid + 3, 'wah Bass 105Q keeps more low end under the peak');
  const bV = bands(render('wah', {model: 2}), 0.41); ok(bV.high - bV.lomid > bC.high - bC.lomid + 2, 'wah Vox is brighter than Cry Baby');
  const lowQ = pk({q: 1}), hiQ = pk({q: 15}); ok(hiQ.lvl > lowQ.lvl + 6, 'wah Reso sharpens the peak (+' + (hiQ.lvl - lowQ.lvl).toFixed(1) + ' dB)');
  const f1 = pk({fmin: 100, fmax: 800, pos: 0}), f2 = pk({fmin: 1000, fmax: 5000, pos: 0}); ok(f2.f > f1.f*3, 'wah Min Freq moves the heel (' + f1.f.toFixed(0) + ' vs ' + f2.f.toFixed(0) + ' Hz)');
  ok(isDry(render('wah', {mix: 0}), signal()), 'wah Mix 0 is the dry sound'); }
{ // a pedal sweep is smooth: no sample jumps bigger than the sine itself moves
  const x = sine(110, 0.3), y = render('wah', {pos: 0}, x, {steps: [[1.0, {pos: 100}]]}); let mj = 0; for(let i = Math.round(0.99*SR); i < 1.2*SR; i++) mj = Math.max(mj, Math.abs(y[i] - y[i-1]));
  ok(mj < 0.1, 'wah: a full pedal sweep makes no clicks (largest step ' + mj.toFixed(4) + ')'); }

// ---------------- Multi Filter ----------------
{ const y = render('filter', {}), s = stats(y); ok(!s.nan, 'filter: no NaN'); ok(quietStart(y, s), 'filter: no loud first moment'); ok(Math.abs(dB(s.rms/inStats.rms)) < 6, 'filter: sane level (' + dB(s.rms/inStats.rms).toFixed(1) + ' dB)'); }
{ // SVF: the old shapes still work. Low Pass at 800 passes 110 Hz flat and is about 12 dB down an octave above
  const lp = render('filter', {model: 0, type: 0, freq: 800, q: 1}, sine(110, 0.3)); ok(Math.abs(toneLevel(lp, 110) - toneLevel(sine(110, 0.3), 110)) < 0.5, 'filter SVF Low Pass passes the lows flat');
  const lp2 = render('filter', {model: 0, type: 0, freq: 800, q: 1}, sine(1600, 0.3)); ok(Math.abs(toneLevel(lp2, 1600) - toneLevel(sine(1600, 0.3), 1600) + 12) < 2.5, 'filter SVF Low Pass is 2-pole (' + (toneLevel(lp2, 1600) - toneLevel(sine(1600, 0.3), 1600)).toFixed(1) + ' dB an octave up)');
  const hp = render('filter', {model: 0, type: 1, freq: 800, q: 1}, sine(110, 0.3)); ok(toneLevel(hp, 110) < toneLevel(sine(110, 0.3), 110) - 25, 'filter SVF High Pass cuts the lows');
  const nt = render('filter', {model: 0, type: 3, freq: 440, q: 2}, sine(440, 0.3)); ok(toneLevel(nt, 440) < toneLevel(sine(440, 0.3), 440) - 30, 'filter SVF Notch kills the tone at Freq');
  const bp = render('filter', {model: 0, type: 2, freq: 440, q: 2}, sine(440, 0.3)); ok(Math.abs(toneLevel(bp, 440) - toneLevel(sine(440, 0.3), 440)) < 1, 'filter SVF Band Pass passes the tone at Freq at unity'); }
{ // Ladder: 4-pole, so steeper than the SVF, sings near max Reso, and Drive adds harmonics
  const l2 = render('filter', {model: 1, type: 0, freq: 800, q: 0.3}, sine(1600, 0.3)), ldrop = toneLevel(l2, 1600) - toneLevel(sine(1600, 0.3), 1600);
  ok(ldrop < -18, 'filter Ladder Low Pass is 4-pole (' + ldrop.toFixed(1) + ' dB an octave up)');
  const l1 = render('filter', {model: 1, type: 0, freq: 800, q: 0.3}, sine(110, 0.3)); ok(Math.abs(toneLevel(l1, 110) - toneLevel(sine(110, 0.3), 110)) < 1.5, 'filter Ladder passes the lows (' + (toneLevel(l1, 110) - toneLevel(sine(110, 0.3), 110)).toFixed(1) + ' dB)');
  const x = sine(110, 0.3, 0.3), ring = render('filter', {model: 1, q: 20, freq: 400}, x), mild = render('filter', {model: 1, q: 5, freq: 400}, x);
  ok(rmsAt(ring, 1.5, 2.0) > 0.01, 'filter Ladder Reso 20 self-resonates (rms ' + rmsAt(ring, 1.5, 2.0).toFixed(3) + ' in silence)'); ok(stats(ring).pk < 1.0, 'filter Ladder: the ringing is tamed (peak ' + stats(ring).pk.toFixed(3) + ')');
  ok(rmsAt(mild, 1.5, 2.0) < 0.001, 'filter Ladder Reso 5 is quiet after the note');
  ok(Math.abs(toneLevel(ring, 400, 1.5, 4096) - toneLevel(ring, 400, 1.85, 4096)) < 1, 'filter Ladder: the ringing holds a steady level (' + toneLevel(ring, 400, 1.5, 4096).toFixed(1) + ' vs ' + toneLevel(ring, 400, 1.85, 4096).toFixed(1) + ' dB)');
  const c = render('filter', {model: 1, freq: 12000, q: 0.3, drive: 0}, sine(110, 0.4)), d = render('filter', {model: 1, freq: 12000, q: 0.3, drive: 100}, sine(110, 0.4));
  ok(toneLevel(d, 330) > toneLevel(c, 330) + 10, 'filter Drive adds harmonics (3rd harmonic ' + toneLevel(d, 330).toFixed(1) + ' vs ' + toneLevel(c, 330).toFixed(1) + ' dB)');
  const hp = render('filter', {model: 1, type: 1, freq: 800, q: 0.3}, sine(110, 0.3)); ok(toneLevel(hp, 110) < toneLevel(sine(110, 0.3), 110) - 25, 'filter Ladder High Pass cuts the lows');
  const hp2 = render('filter', {model: 1, type: 1, freq: 200, q: 0.3}, sine(1600, 0.3)); ok(Math.abs(toneLevel(hp2, 1600) - toneLevel(sine(1600, 0.3), 1600)) < 2, 'filter Ladder High Pass passes the highs');
  const bp = render('filter', {model: 1, type: 2, freq: 440, q: 0.3}, sine(440, 0.3)), bpL = render('filter', {model: 1, type: 2, freq: 440, q: 0.3}, sine(55, 0.3)), bpH = render('filter', {model: 1, type: 2, freq: 440, q: 0.3}, sine(3520, 0.3));
  ok(toneLevel(bp, 440) > toneLevel(bpL, 55) + 15 && toneLevel(bp, 440) > toneLevel(bpH, 3520) + 15, 'filter Ladder Band Pass peaks at Freq');
  const nt = render('filter', {model: 1, type: 3, freq: 440, q: 0.3}, sine(440, 0.3)), ntL = render('filter', {model: 1, type: 3, freq: 440, q: 0.3}, sine(55, 0.3));
  ok(toneLevel(nt, 440) < toneLevel(ntL, 55) - 15, 'filter Ladder Notch dips at Freq (' + (toneLevel(nt, 440) - toneLevel(ntL, 55)).toFixed(1) + ' dB under the lows)');
  ok(isDry(render('filter', {model: 1, mix: 0}), signal()), 'filter Mix 0 is the dry sound'); }

done();
