// Renders the time family (delay, mdelay, reverb, octave, pitch, harm) through the native engine and checks each model does what its knobs say.
// No browser needed. Run: NP_ADDON=native/build/time/npaudio.node node native/test/pedals_time.js
const {render, stats, bands, rmsAt, toneLevel, signal, sine, impulse, checker, SR, N} = require('./lib');
const {ok, done} = checker();
const f3 = (v) => v.toFixed(3), f1 = (v) => v.toFixed(1);
// the usual three checks for every block: no NaN, no loud first moment, a sane level
function basics(type, params, lo, hi){ const y = render(type, params || {}), s = stats(y); let pk0 = 0; for(let i = 0; i < 0.1*SR; i++) pk0 = Math.max(pk0, Math.abs(y[i]));
  ok(!s.nan, type + ': no NaN'); ok(pk0 < 1.2, type + ': no loud first moment (peak in the first 100 ms ' + f3(pk0) + ')'); ok(s.pk > (lo || 0.05) && s.pk < (hi || 1.3), type + ': default level is sane (peak ' + f3(s.pk) + ', rms ' + f3(s.rms) + ')'); return y; }
// level of a window in dB
const dBat = (y, a, b) => 20*Math.log10(rmsAt(y, a, b) + 1e-12);
// the brightness of a window: high minus low band energy
function tilt(y, at){ const b = bands(y, at); return b.high - b.low; }
// is y the input, apart from the first 20 ms (the block's bypass ramp settles there)?
function isDry(y, x){ let e = 0, p = 0; for(let i = Math.round(0.02*SR); i < N; i++){ e += (y[i] - x[i])*(y[i] - x[i]); p += x[i]*x[i]; } return 10*Math.log10(p/(e + 1e-20)); }
// a click at half a second
function click(){ const x = new Float32Array(N); x[Math.round(0.5*SR)] = 1; return x; }
// a single short pluck at t=0 (so repeats can be measured on their own)
function pluck(f, lv){ const x = new Float32Array(N); for(let i = 0; i < SR*0.12; i++){ const t = i/SR; let v = 0; for(let h = 1; h < 24; h++) v += Math.sin(2*Math.PI*f*h*t)/(h*0.9 + 0.1)*Math.exp(-t*h*0.5); x[i] = (lv || 0.4)*v*Math.exp(-t*25)*Math.min(1, t*2000); } return x; }
// where the loudest moment is in a window, in seconds
function peakAt(y, a, b){ let pk = 0, at = a; for(let i = Math.round(a*SR); i < Math.round(b*SR); i++) if(Math.abs(y[i]) > pk){ pk = Math.abs(y[i]); at = i/SR; } return at; }

// ===================================================================== delay
basics('delay', {});
{ // the time knob: a 300 ms delay puts the first repeat 300 ms after the pluck
  const y = render('delay', {type: 0, time: 300, fb: 0, mix: 100, lowcut: 20, highcut: 12000}, pluck(110)); const t1 = peakAt(y, 0.25, 0.45);
  ok(Math.abs(t1 - 0.3) < 0.02, 'delay: digital repeat lands at the set time (' + f3(t1) + ' s for 300 ms)'); }
{ // digital repeats stay clean and keep their brightness; tape repeats get darker each pass
  const dig = render('delay', {type: 0, time: 300, fb: 60, mix: 100, lowcut: 20, highcut: 12000}, pluck(110));
  const tape = render('delay', {type: 1, time: 300, fb: 60, mix: 100, lowcut: 20, highcut: 12000, age: 50}, pluck(110));
  const td1 = tilt(dig, 0.3), td3 = tilt(dig, 0.9), tt1 = tilt(tape, 0.3), tt2 = tilt(tape, 0.6), tt3 = tilt(tape, 0.9);
  ok(Math.abs(td1 - td3) < 2.5, 'delay: digital repeats keep their tone (tilt ' + f1(td1) + ' then ' + f1(td3) + ' dB)');
  ok(tt1 > tt2 + 1 && tt2 > tt3 + 1, 'delay: tape repeats get darker each pass (tilt ' + f1(tt1) + ', ' + f1(tt2) + ', ' + f1(tt3) + ' dB)');
  ok(tt1 < td1 - 2, 'delay: the first tape repeat is already darker than digital (' + f1(tt1) + ' vs ' + f1(td1) + ' dB)'); }
{ // tape wow and flutter: with Wow up, the repeat's pitch moves. Measure the 220 Hz line width: a wobbling tone spreads its energy off the bin.
  const still = render('delay', {type: 1, time: 400, fb: 0, mix: 100, mod: 0, lowcut: 20, highcut: 12000}, sine(220, 0.3, 1.2));
  const wob = render('delay', {type: 1, time: 400, fb: 0, mix: 100, mod: 100, lowcut: 20, highcut: 12000}, sine(220, 0.3, 1.2));
  const a = toneLevel(still, 220, 0.9, 16384) - toneLevel(still, 226, 0.9, 16384), b = toneLevel(wob, 220, 0.9, 16384) - toneLevel(wob, 226, 0.9, 16384);
  ok(b < a - 6, 'delay: Wow & Flutter spreads the repeat\'s pitch (tone sits ' + f1(a) + ' dB above its neighbour still, ' + f1(b) + ' dB with wow)'); }
{ // tape saturation: a hot repeat is squashed more than a quiet one (less than 1:1 growth)
  const q = render('delay', {type: 1, time: 300, fb: 0, mix: 100, age: 60, lowcut: 20, highcut: 12000}, sine(110, 0.1, 0.2)), h = render('delay', {type: 1, time: 300, fb: 0, mix: 100, age: 60, lowcut: 20, highcut: 12000}, sine(110, 0.8, 0.2));
  const g = dBat(h, 0.32, 0.48) - dBat(q, 0.32, 0.48); ok(g < 17, 'delay: tape squashes hot repeats (an 18 dB louder input comes back only ' + f1(g) + ' dB louder)'); }
{ // analog: the bandwidth narrows as the time grows
  const short = render('delay', {type: 2, time: 120, fb: 0, mix: 100, lowcut: 20, highcut: 12000}, pluck(110)), long = render('delay', {type: 2, time: 900, fb: 0, mix: 100, lowcut: 20, highcut: 12000}, pluck(110));
  const ts = tilt(short, 0.12), tl = tilt(long, 0.9); ok(ts > tl + 4, 'delay: analog bandwidth narrows with time (tilt ' + f1(ts) + ' dB at 120 ms, ' + f1(tl) + ' dB at 900 ms)');
  const dig = render('delay', {type: 0, time: 900, fb: 0, mix: 100, lowcut: 20, highcut: 12000}, pluck(110)); ok(tl < tilt(dig, 0.9) - 6, 'delay: a long analog repeat is much darker than digital'); }
{ // analog repeats get darker and grittier each pass
  const y = render('delay', {type: 2, time: 300, fb: 65, mix: 100, lowcut: 20, highcut: 12000, age: 60}, pluck(110));
  const t1 = tilt(y, 0.3), t3 = tilt(y, 0.9); ok(t1 > t3 + 1.5, 'delay: analog repeats get darker each pass (tilt ' + f1(t1) + ' then ' + f1(t3) + ' dB)'); }
{ // digital lo-fi: 12 bits at 12 kHz makes grit that is not in the clean one
  const clean = render('delay', {type: 0, time: 300, fb: 0, mix: 100, lofi: 0, lowcut: 20, highcut: 12000}, sine(110, 0.3, 0.2)), lofi = render('delay', {type: 0, time: 300, fb: 0, mix: 100, lofi: 100, lowcut: 20, highcut: 12000}, sine(110, 0.3, 0.2));
  const bc = bands(clean, 0.32), bl = bands(lofi, 0.32); ok(bl.high - bl.low > bc.high - bc.low + 10, 'delay: Lo-Fi adds grit to a clean sine repeat (high band +' + f1((bl.high - bl.low) - (bc.high - bc.low)) + ' dB)'); }
{ // ping pong: the first repeat is on the left only, the second on the right only
  const [L, R] = render('delay', {type: 3, time: 300, fb: 60, mix: 100, lowcut: 20, highcut: 12000}, pluck(110), {stereo: true});
  const l1 = dBat(L, 0.3, 0.42), r1 = dBat(R, 0.3, 0.42), l2 = dBat(L, 0.6, 0.72), r2 = dBat(R, 0.6, 0.72);
  ok(l1 > r1 + 20 && r2 > l2 + 20, 'delay: ping pong bounces (1st repeat L ' + f1(l1) + ' R ' + f1(r1) + ' dB, 2nd L ' + f1(l2) + ' R ' + f1(r2) + ' dB)'); }
{ // feedback: more feedback, longer tail
  const a = render('delay', {type: 0, time: 200, fb: 20, mix: 100}, pluck(110)), b = render('delay', {type: 0, time: 200, fb: 70, mix: 100}, pluck(110));
  ok(dBat(b, 1.4, 1.6) > dBat(a, 1.4, 1.6) + 15, 'delay: Feedback lengthens the tail (' + f1(dBat(a, 1.4, 1.6)) + ' vs ' + f1(dBat(b, 1.4, 1.6)) + ' dB at 1.5 s)'); }
{ // low cut and high cut shape the repeats
  const lc = render('delay', {type: 0, time: 300, fb: 0, mix: 100, lowcut: 1000, highcut: 12000}, pluck(110)), hc = render('delay', {type: 0, time: 300, fb: 0, mix: 100, lowcut: 20, highcut: 500}, pluck(110));
  ok(tilt(lc, 0.3) > tilt(hc, 0.3) + 15, 'delay: Low Cut and High Cut work (tilt ' + f1(tilt(lc, 0.3)) + ' vs ' + f1(tilt(hc, 0.3)) + ' dB)'); }
{ // mix: 0 is dry only
  const y = render('delay', {type: 0, time: 300, fb: 0, mix: 0}, pluck(110)); ok(dBat(y, 0.3, 0.42) < -60, 'delay: Mix 0 has no repeat (' + f1(dBat(y, 0.3, 0.42)) + ' dB)'); }

// ===================================================================== multi-tap
basics('mdelay', {});
{ // taps land at 1x 2x 3x the time for Even, 1x 1.5x for Golden... compare patterns on the second tap
  const tap2 = (pat) => { const y = render('mdelay', {time: 300, taps: 4, fb: 0, mix: 100, highcut: 12000, pattern: pat}, pluck(110)); return peakAt(y, 0.15, 0.35); };
  const ev = tap2(0), dot = tap2(1), tri = tap2(2), gold = tap2(3);
  ok(Math.abs(ev - 0.3) < 0.02 && Math.abs(dot - 0.225) < 0.02 && Math.abs(tri - 0.2) < 0.02 && Math.abs(gold - 0.3) < 0.02, 'mdelay: first tap at ' + f3(ev) + ' (even), ' + f3(dot) + ' (dotted), ' + f3(tri) + ' (triplet), ' + f3(gold) + ' (golden) s for 300 ms');
  const y = render('mdelay', {time: 300, taps: 4, fb: 0, mix: 100, highcut: 12000, pattern: 3}, pluck(110)); const g2 = peakAt(y, 0.4, 0.55); ok(Math.abs(g2 - 0.485) < 0.02, 'mdelay: golden second tap at ' + f3(g2) + ' s (1.618 x 300 ms)'); }
{ const one = render('mdelay', {time: 300, taps: 1, fb: 0, mix: 100}, pluck(110)), three = render('mdelay', {time: 300, taps: 3, fb: 0, mix: 100}, pluck(110));
  ok(dBat(one, 0.6, 0.72) < -50 && dBat(three, 0.6, 0.72) > -30, 'mdelay: Taps sets how many echoes (2nd tap ' + f1(dBat(one, 0.6, 0.72)) + ' dB with 1 tap, ' + f1(dBat(three, 0.6, 0.72)) + ' dB with 3)'); }
{ const [L, R] = render('mdelay', {time: 300, taps: 4, fb: 0, mix: 100, spread: 100}, pluck(110), {stereo: true}); const [L0, R0] = render('mdelay', {time: 300, taps: 4, fb: 0, mix: 100, spread: 0}, pluck(110), {stereo: true});
  ok(Math.abs(dBat(L, 1.2, 1.32) - dBat(R, 1.2, 1.32)) > 10 && Math.abs(dBat(L0, 1.2, 1.32) - dBat(R0, 1.2, 1.32)) < 1, 'mdelay: Spread pans the taps'); }

// ===================================================================== reverb
basics('reverb', {});
// RT60 from an impulse: fit the tail's slope between 0.4 and 1.5 s, in dB per second
function rt60(type, decay){ const y = render('reverb', {type, decay, mix: 100, lowcut: 20, highcut: 16000, predelay: 0}, impulse()); const a = dBat(y, 0.4, 0.5), b = dBat(y, 1.4, 1.5); return 60/((a - b)/1.0); }
for(const t of [0, 1, 2, 4]){ const r1 = rt60(t, 1), r2 = rt60(t, 2), r4 = rt60(t, 4);
  ok(r1 > 0.7 && r1 < 1.4 && r2 > 1.5 && r2 < 2.6 && r4 > 3 && r4 < 5.3, 'reverb: ' + ['Room','Hall','Plate','Spring','Cathedral'][t] + ' decay knob is RT60 (set 1 / 2 / 4 s, measured ' + f1(r1) + ' / ' + f1(r2) + ' / ' + f1(r4) + ' s)'); }
{ const r1 = rt60(3, 1), r3 = rt60(3, 3); ok(r3 > r1*1.8, 'reverb: Spring decay scales with the knob (' + f1(r1) + ' s at 1, ' + f1(r3) + ' s at 3)'); }
{ // each type has its own tail shape: compare brightness and how fast the tail builds up
  const shape = (t) => { const y = render('reverb', {type: t, decay: 2, mix: 100, lowcut: 20, highcut: 16000, predelay: 0}, impulse()); return {early: dBat(y, 0.002, 0.03) - dBat(y, 0.1, 0.2), tilt: tilt(y, 0.5)}; };
  const s = [0, 1, 2, 3, 4].map(shape); let diff = 0; for(let a = 0; a < 5; a++) for(let b = a + 1; b < 5; b++) diff = Math.max(diff, Math.min(Math.abs(s[a].early - s[b].early), Math.abs(s[a].tilt - s[b].tilt)) );
  const distinct = [0, 1, 2, 3, 4].every((a) => [0, 1, 2, 3, 4].every((b) => a === b || Math.abs(s[a].early - s[b].early) > 1.5 || Math.abs(s[a].tilt - s[b].tilt) > 1.5));
  ok(distinct, 'reverb: every type has its own tail shape (early/tilt dB: ' + s.map((v, i) => ['Room','Hall','Plate','Spring','Cathedral'][i] + ' ' + f1(v.early) + '/' + f1(v.tilt)).join(', ') + ')');
  ok(s[2].tilt > s[1].tilt + 3, 'reverb: Plate is brighter than Hall (' + f1(s[2].tilt) + ' vs ' + f1(s[1].tilt) + ' dB)');
  ok(s[4].tilt < s[1].tilt - 2, 'reverb: Cathedral is darker than Hall (' + f1(s[4].tilt) + ' vs ' + f1(s[1].tilt) + ' dB)');
  ok(s[0].early > s[1].early + 3, 'reverb: Room has early reflections you can hear (first 30 ms sit ' + f1(s[0].early) + ' dB over the tail, Hall ' + f1(s[1].early) + ' dB)'); }
{ // spring: the chirp. After the click itself, the first echo's highs arrive after its lows (dispersion): the 2.5 kHz band peaks later than the 300 Hz band.
  const y = render('reverb', {type: 3, decay: 2, mix: 100, lowcut: 20, highcut: 16000, predelay: 0}, impulse());
  const envPeak = (f) => { const w = 2*Math.PI*f/SR, n = 256; let best = 0, at = 0; for(let off = 100 + 96; off < 100 + 0.03*SR; off += 32){ let a = 0, b = 0; for(let i = 0; i < n; i++){ const v = y[off + i]; a += v*Math.cos(w*i); b -= v*Math.sin(w*i); } const m = a*a + b*b; if(m > best){ best = m; at = (off - 100)/SR; } } return at; };
  const tl = envPeak(300), th = envPeak(2500); ok(th > tl + 0.005, 'reverb: Spring chirps, highs arrive after lows (300 Hz peaks at ' + f3(tl) + ' s, 2.5 kHz at ' + f3(th) + ' s)');
  }
{ // pre-delay moves the start of the tail
  const a = render('reverb', {type: 1, decay: 2, mix: 100, predelay: 0, lowcut: 20, highcut: 16000}, impulse()), b = render('reverb', {type: 1, decay: 2, mix: 100, predelay: 150, lowcut: 20, highcut: 16000}, impulse());
  ok(dBat(a, 0.03, 0.1) > -40 && dBat(b, 0.03, 0.1) < -80, 'reverb: Pre-Delay holds the tail back (' + f1(dBat(a, 0.03, 0.1)) + ' vs ' + f1(dBat(b, 0.03, 0.1)) + ' dB in 30-100 ms)'); }
{ // low cut / high cut shape the wet sound
  const lc = render('reverb', {type: 1, decay: 2, mix: 100, lowcut: 1000, highcut: 16000}), hc = render('reverb', {type: 1, decay: 2, mix: 100, lowcut: 20, highcut: 1000});
  ok(tilt(lc, 0.6) > tilt(hc, 0.6) + 15, 'reverb: Low Cut and High Cut work (tilt ' + f1(tilt(lc, 0.6)) + ' vs ' + f1(tilt(hc, 0.6)) + ' dB)'); }
{ // shimmer: the tail grows an octave up. A 110 Hz sine in, with shimmer the tail has far more at 220 than without.
  const no = render('reverb', {type: 5, decay: 3, mix: 100, shimmer: 0, lowcut: 20, highcut: 16000}, sine(110, 0.3, 0.6)), sh = render('reverb', {type: 5, decay: 3, mix: 100, shimmer: 100, lowcut: 20, highcut: 16000}, sine(110, 0.3, 0.6));
  const r0 = toneLevel(no, 220, 1.2) - toneLevel(no, 110, 1.2), r1 = toneLevel(sh, 220, 1.2) - toneLevel(sh, 110, 1.2); ok(r1 > r0 + 10, 'reverb: Shimmer grows the octave (220 vs 110 Hz: ' + f1(r0) + ' dB without, ' + f1(r1) + ' dB with)'); }
{ const y = render('reverb', {type: 1, mix: 0}); ok(isDry(y, signal()) > 40, 'reverb: Mix 0 passes the dry sound alone'); }
{ // stereo: left and right differ
  const [L, R] = render('reverb', {type: 1, decay: 2, mix: 100}, impulse(), {stereo: true}); let e = 0, p = 0; for(let i = 0; i < N; i++){ e += (L[i] - R[i])*(L[i] - R[i]); p += L[i]*L[i]; } ok(e > p*0.3, 'reverb: left and right are different (side energy ' + f1(10*Math.log10(e/p)) + ' dB relative)'); }

// ===================================================================== octave
basics('octave', {});
// Count how many times the -1 oct sub crosses zero upward in a window. A stable sub at f/2 crosses f/2 times a second.
function crossings(y, a, b){ let c = 0; for(let i = Math.round(a*SR) + 1; i < Math.round(b*SR); i++) if(y[i - 1] <= 0 && y[i] > 0) c++; return c; }
{ // 41 Hz low E: the sub is at 20.6 Hz, steady
  const y = render('octave', {sub1: 100, dry: 0, up: 0, tone: 600}, sine(41.2, 0.3)); const c = crossings(y, 0.5, 1.5);
  ok(Math.abs(c - 20.6) <= 1, 'octave: tracks a 41 Hz low E (' + c + ' sub cycles in a second, want 20.6)');
  ok(toneLevel(y, 20.6, 1) > toneLevel(y, 41.2, 1) + 12, 'octave: 41 Hz sub is clean (20.6 Hz ' + f1(toneLevel(y, 20.6, 1)) + ' dB, 41.2 Hz leak ' + f1(toneLevel(y, 41.2, 1)) + ' dB)'); }
{ // 110 Hz: sub at 55
  const y = render('octave', {sub1: 100, dry: 0, up: 0}, sine(110, 0.3)); const c = crossings(y, 0.5, 1.5);
  ok(Math.abs(c - 55) <= 1, 'octave: tracks 110 Hz (' + c + ' sub cycles in a second, want 55)'); }
{ // a fast line: 110 Hz notes 120 ms long with 30 ms gaps, with harmonics. Every note must give a steady sub with no flip glitch in its middle.
  const x = new Float32Array(N); const notes = [110, 123.5, 130.8, 110, 146.8, 110, 164.8, 110, 123.5, 110]; notes.forEach((f, k) => { const i0 = Math.round(k*0.15*SR); for(let i = 0; i < 0.12*SR; i++){ const t = i/SR; let v = 0; for(let h = 1; h < 10; h++) v += Math.sin(2*Math.PI*f*h*t)/(h*0.9 + 0.1)*Math.exp(-t*h*2); x[i0 + i] = 0.35*v*Math.exp(-t*6)*Math.min(1, t*1000); } });
  const y = render('octave', {sub1: 100, dry: 0, up: 0}, x); let bad = 0; const got = [];
  const subHz = (a, b) => { const ups = []; for(let i = Math.round(a*SR) + 1; i < Math.round(b*SR); i++) if(y[i - 1] <= 0 && y[i] > 0) ups.push(i); return ups.length > 1 ? SR*(ups.length - 1)/(ups[ups.length - 1] - ups[0]) : 0; };
  notes.forEach((f, k) => { const c = subHz(k*0.15 + 0.03, k*0.15 + 0.12), want = f/2; got.push(Math.round(c)); if(Math.abs(c - want) > want*0.08) bad++; });
  ok(bad === 0, 'octave: a fast 110 Hz line tracks every note (sub Hz per note: ' + got.join(' ') + ', want ' + notes.map(f => Math.round(f/2)).join(' ') + ')'); }
{ // the sub follows the note's dynamics and dies with it
  const y = render('octave', {sub1: 100, dry: 0, up: 0}, pluck(82.4, 0.5)); ok(dBat(y, 0.02, 0.06) > dBat(y, 0.25, 0.3) + 15 && dBat(y, 0.6, 0.8) < -60, 'octave: the sub follows the pluck and dies with it (' + f1(dBat(y, 0.02, 0.06)) + ' dB at the attack, ' + f1(dBat(y, 0.25, 0.3)) + ' at 250 ms, ' + f1(dBat(y, 0.6, 0.8)) + ' after)'); }
{ // -2 oct: a quarter of the input frequency
  const y = render('octave', {sub1: 0, sub2: 100, dry: 0, up: 0}, sine(110, 0.3)); const c = crossings(y, 0.5, 1.5); ok(Math.abs(c - 27.5) <= 1, 'octave: -2 Oct is two octaves down (' + c + ' cycles, want 27.5)'); }
{ // +1 oct: energy at 220 from a 110 input
  const y = render('octave', {sub1: 0, sub2: 0, up: 100, dry: 0}, sine(110, 0.3)); ok(toneLevel(y, 220, 1) > toneLevel(y, 110, 1) + 10, 'octave: +1 Oct puts the energy at 220 Hz (' + f1(toneLevel(y, 220, 1)) + ' vs ' + f1(toneLevel(y, 110, 1)) + ' dB)'); }
{ // tone darkens the sub; dry mixes the input back in
  const dark = render('octave', {sub1: 100, dry: 0, tone: 100}, signal()), bright = render('octave', {sub1: 100, dry: 0, tone: 4000}, signal());
  ok(tilt(bright, 0.41) > tilt(dark, 0.41) + 6, 'octave: Tone brightens the sub (tilt ' + f1(tilt(dark, 0.41)) + ' vs ' + f1(tilt(bright, 0.41)) + ' dB)');
  ok(isDry(render('octave', {sub1: 0, dry: 100}), signal()) > 40, 'octave: Dry 100 with no subs is the input'); }

// ===================================================================== pitch
basics('pitch', {});
// how much the level wobbles over a steady tone, in dB: the old shifter's warble. The window is two periods of the shifted tone, so the wave itself does not count.
function ripple(y, a, b, fo){ const win = 2/fo; let mn = 9, mx = 0; for(let t = a; t < b; t += win/4){ const r = rmsAt(y, t, t + win); mn = Math.min(mn, r); mx = Math.max(mx, r); } return 20*Math.log10(mx/mn); }
{ const y = render('pitch', {semi: 12, mix: 100}, sine(110, 0.3)); ok(toneLevel(y, 220, 1) > -14 && toneLevel(y, 220, 1) > toneLevel(y, 110, 1) + 40, 'pitch: +12 on 110 Hz puts the energy at 220 (' + f1(toneLevel(y, 220, 1)) + ' dB) with little at 110 (' + f1(toneLevel(y, 110, 1)) + ' dB)');
  ok(ripple(y, 0.5, 1.9, 220) < 1, 'pitch: +12 on a steady note has little warble (' + f3(ripple(y, 0.5, 1.9, 220)) + ' dB level ripple)'); }
{ const y = render('pitch', {semi: -12, mix: 100}, sine(110, 0.3)); ok(toneLevel(y, 55, 1) > -14 && toneLevel(y, 55, 1) > toneLevel(y, 110, 1) + 40, 'pitch: -12 on 110 Hz puts the energy at 55 (' + f1(toneLevel(y, 55, 1)) + ' dB) with little at 110 (' + f1(toneLevel(y, 110, 1)) + ' dB)');
  ok(ripple(y, 0.5, 1.9, 55) < 1, 'pitch: -12 on a steady note has little warble (' + f3(ripple(y, 0.5, 1.9, 55)) + ' dB level ripple)'); }
{ // a real bass note: -12 on a 55 Hz pluck with harmonics stays smooth (the old shifter chopped)
  const y = render('pitch', {semi: -12, mix: 100, grain: 40}, sine(55, 0.3)); ok(ripple(y, 0.5, 1.9, 27.5) < 1, 'pitch: -12 on a 55 Hz note is smooth (' + f3(ripple(y, 0.5, 1.9, 27.5)) + ' dB ripple)');
  const z = render('pitch', {semi: -12, mix: 100, grain: 40}, sine(41.2, 0.3)); ok(ripple(z, 0.5, 1.9, 20.6) < 1, 'pitch: -12 on a 41 Hz low E is smooth (' + f3(ripple(z, 0.5, 1.9, 20.6)) + ' dB ripple)'); }
{ // grain changes the slice size but the pitch stays right
  const y = render('pitch', {semi: 7, mix: 100, grain: 120}, sine(110, 0.3)); const f = 110*Math.pow(2, 7/12); ok(toneLevel(y, f, 1) > toneLevel(y, 110, 1) + 30, 'pitch: +7 with a 120 ms grain lands on ' + f1(f) + ' Hz'); }
{ // cents: +50 cents moves the tone a quarter step
  const y = render('pitch', {semi: 0, cents: 50, mix: 100}, sine(220, 0.3)); const f = 220*Math.pow(2, 50/1200), g = 220*Math.pow(2, -50/1200); ok(toneLevel(y, f, 0.5, 32768) > toneLevel(y, g, 0.5, 32768) + 15, 'pitch: Cents works (' + f1(f) + ' Hz ' + f1(toneLevel(y, f, 0.5, 32768)) + ' dB vs ' + f1(g) + ' Hz ' + f1(toneLevel(y, g, 0.5, 32768)) + ' dB)'); }
{ // latency: a click comes out within 20 ms, up or down. The heads cycle, so the click is tried at a few moments and the worst one counts.
  const onset = (semi, at0) => { const x = new Float32Array(N); x[Math.round(at0*SR)] = 1; const y = render('pitch', {semi, mix: 100, grain: 40}, x); for(let i = Math.round(at0*SR); i < N; i++) if(Math.abs(y[i]) > 0.05) return (i - at0*SR)/SR*1000; return 999; };
  const up = Math.max(...[0.5, 0.507, 0.515, 0.522].map(t => onset(12, t))), dn = Math.max(...[0.5, 0.51, 0.52, 0.53].map(t => onset(-12, t)));
  ok(up < 20, 'pitch: +12 latency is under 20 ms (worst ' + f1(up) + ' ms)'); ok(dn < 20, 'pitch: -12 latency is under 20 ms (worst ' + f1(dn) + ' ms)'); }
{ ok(isDry(render('pitch', {semi: 12, mix: 0}), signal()) > 40, 'pitch: Mix 0 is the dry sound'); }

// ===================================================================== harmonizer
basics('harm', {});
{ const y = render('harm', {v1: 7, l1: 100, v2: -12, l2: 100, dry: 0, spread: 0}, sine(110, 0.3)); const f1h = 110*Math.pow(2, 7/12);
  ok(toneLevel(y, f1h, 1) > -16 && toneLevel(y, 55, 1) > -16 && toneLevel(y, 110, 1) < toneLevel(y, 55, 1) - 25, 'harm: both voices sound (' + f1(f1h) + ' Hz ' + f1(toneLevel(y, f1h, 1)) + ' dB, 55 Hz ' + f1(toneLevel(y, 55, 1)) + ' dB, dry 110 Hz ' + f1(toneLevel(y, 110, 1)) + ' dB)'); }
{ const [L, R] = render('harm', {v1: 7, l1: 100, v2: -12, l2: 100, dry: 0, spread: 100}, sine(110, 0.3), {stereo: true}); const f1h = 110*Math.pow(2, 7/12);
  ok(toneLevel(L, f1h, 1) > toneLevel(R, f1h, 1) + 20 && toneLevel(R, 55, 1) > toneLevel(L, 55, 1) + 20, 'harm: Spread puts voice 1 left and voice 2 right'); }
{ ok(isDry(render('harm', {v1: 7, l1: 0, v2: -12, l2: 0, dry: 100}), signal()) > 40, 'harm: levels at 0 leave the dry sound alone'); }

done();
