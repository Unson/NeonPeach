// Checks the mod pedal family (chorus, flanger, phaser, trem, vibrato, rotary, ring, crush) through the native engine. No browser needed.
// Run: NP_ADDON=native/build/mod/npaudio.node node native/test/pedals_mod.js
const {render, stats, bands, rmsAt, toneLevel, signal, sine, impulse, checker, SR, N} = require('./lib');
const {ok, done} = checker();
const dB = (a, b) => 20*Math.log10((a + 1e-9)/(b + 1e-9));
// the three checks every block gets: no NaN, no loud first moment, a sane level
function basics(type, params){ const y = render(type, params || {}); const s = stats(y); let pk0 = 0; for(let i = 0; i < 0.1*SR; i++) pk0 = Math.max(pk0, Math.abs(y[i]));
  ok(!s.nan, type + ': no NaN'); ok(pk0 < 1.0, type + ': no loud first moment (peak in the first 100 ms ' + pk0.toFixed(3) + ')'); ok(s.pk > 0.05 && s.pk < 1.0, type + ': default level is sane (peak ' + s.pk.toFixed(3) + ', rms ' + s.rms.toFixed(3) + ')'); return y; }
// how different left and right are, in dB under the mono sum (0 dB = fully different, -40 = mono)
function width(L, R, a, b){ let d = 0, m = 0; const i0 = Math.round(a*SR), i1 = Math.round(b*SR); for(let i = i0; i < i1; i++){ d += (L[i] - R[i])*(L[i] - R[i]); m += (L[i] + R[i])*(L[i] + R[i]); } return 10*Math.log10((d + 1e-12)/(m + 1e-12)); }
// level ripple: rms in 10 ms slices over a window, returns max/min in dB
function ripple(y, a, b){ let mx = 0, mn = 1e9; for(let t = a; t + 0.01 <= b; t += 0.01){ const r = rmsAt(y, t, t + 0.01); mx = Math.max(mx, r); mn = Math.min(mn, r); } return dB(mx, mn); }
// a spectrum (dB per bin) over 8192 samples at `at`, for peak hunting
function spec(y, at){ const n = 8192, off = Math.round(at*SR), re = new Float64Array(n), im = new Float64Array(n); for(let i = 0; i < n; i++) re[i] = y[off + i]*(0.5 - 0.5*Math.cos(2*Math.PI*i/n));
  // radix-2 FFT
  for(let i = 1, j = 0; i < n; i++){ let bit = n >> 1; for(; j & bit; bit >>= 1) j ^= bit; j ^= bit; if(i < j){ let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; } }
  for(let len = 2; len <= n; len <<= 1){ const ang = -2*Math.PI/len, wr = Math.cos(ang), wi = Math.sin(ang); for(let i = 0; i < n; i += len){ let cr = 1, ci = 0; for(let j = 0; j < len/2; j++){ const a = i + j, b = a + len/2; const vr = re[b]*cr - im[b]*ci, vi = re[b]*ci + im[b]*cr; re[b] = re[a] - vr; im[b] = im[a] - vi; re[a] += vr; im[a] += vi; const t = cr*wr - ci*wi; ci = cr*wi + ci*wr; cr = t; } } }
  const out = new Float64Array(n/2); for(let i = 0; i < n/2; i++) out[i] = 10*Math.log10(re[i]*re[i] + im[i]*im[i] + 1e-20); return out; }
const binHz = SR/8192;
// the exact frequency response of a block with its sweep frozen: an impulse in the middle of the window, dB per bin
function resp(type, params){ const x = new Float32Array(N); x[4096] = 0.5; return spec(render(type, params, x), 0); }
const FLAT = (() => { const x = new Float32Array(N); x[4096] = 0.5; return spec(x, 0); })();
// white-ish noise burst input: every bin has energy, so notches and peaks show
function noise(lv){ const x = new Float32Array(N); let s = 99; for(let i = 0; i < N; i++){ s = (s*16807) % 2147483647; x[i] = (lv || 0.2)*(s/2147483647 - 0.5)*2; } return x; }
// the deepest notch (most negative) of wet vs dry spectrum between f1 and f2, returns [Hz, dB]
function notchOf(wet, dry, f1, f2){ let best = [0, 1e9]; for(let k = Math.round(f1/binHz); k < f2/binHz; k++){ const d = wet[k] - dry[k]; if(d < best[1]) best = [k*binHz, d]; } return best; }
function peakOf(wet, dry, f1, f2){ let best = [0, -1e9]; for(let k = Math.round(f1/binHz); k < f2/binHz; k++){ const d = wet[k] - dry[k]; if(d > best[1]) best = [k*binHz, d]; } return best; }

// ---------------------------------------------------------------- chorus
basics('chorus');
{ const dryS = stats(signal()), on50 = stats(render('chorus', {mix: 50})); ok(on50.rms < dryS.rms*1.15, 'chorus: not louder at mix 50 (' + dB(on50.rms, dryS.rms).toFixed(1) + ' dB)');
  const [L1, R1] = render('chorus', {model: 1, depth: 100, mix: 100}, signal(), {stereo: true}); ok(width(L1, R1, 0.4, 1.0) > -9, 'chorus: Dimension D is wide (L-R under L+R: ' + width(L1, R1, 0.4, 1.0).toFixed(1) + ' dB)');
  const sb = (y) => { const s = spec(y, 1.0); let e = 0; for(let k = Math.round(190/binHz); k < 250/binHz; k++) if(Math.abs(k*binHz - 220) > 15) e += Math.pow(10, s[k]/10); return 10*Math.log10(e); };
  const d0 = sb(render('chorus', {model: 1, depth: 0, mix: 100, rate: 3}, sine(220, 0.3))), d1 = sb(render('chorus', {model: 1, depth: 100, mix: 100, rate: 3}, sine(220, 0.3))); ok(d1 > d0 + 10, 'chorus: depth spreads the pitch (' + (d1 - d0).toFixed(1) + ' dB more energy beside a 220 Hz tone)');
  const [Lc, Rc] = render('chorus', {model: 0, depth: 100, mix: 100}, signal(), {stereo: true}); ok(width(Lc, Rc, 0.4, 1.0) < -30, 'chorus: CE-2 is mono (' + width(Lc, Rc, 0.4, 1.0).toFixed(1) + ' dB)');
  const [Lt, Rt] = render('chorus', {model: 2, depth: 60, mix: 100}, signal(), {stereo: true}); ok(width(Lt, Rt, 0.4, 1.0) > -12, 'chorus: Tri-Chorus is wide (' + width(Lt, Rt, 0.4, 1.0).toFixed(1) + ' dB)');
  // the BBD lowpass: a wet CE-2 line is darker than the input
  // the wet lines alone: at mix 100 half the dry is still there (as in the old block), so take it away
  const nz = noise(); const wetOnly = (p) => { const y = render('chorus', Object.assign({mix: 100, tone: 12000, depth: 0}, p), nz), d = render('chorus', Object.assign({mix: 0}, p), nz); const w = new Float32Array(N); for(let i = 0; i < N; i++) w[i] = y[i] - 0.5*d[i]; return w; };
  const bw = bands(wetOnly({model: 0}), 1.0), bd = bands(nz, 1.0); ok(bw.fizz - bw.lomid < bd.fizz - bd.lomid - 6, 'chorus: the BBD line is darker than the dry sound (fizz ' + (bw.fizz - bw.lomid - (bd.fizz - bd.lomid)).toFixed(1) + ' dB)');
  const bD = bands(wetOnly({model: 1}), 1.0); ok(bD.high - bD.lomid < bw.high - bw.lomid - 1, 'chorus: the longer Dimension D lines are darker than the CE-2 line (' + (bD.high - bD.lomid - (bw.high - bw.lomid)).toFixed(1) + ' dB at 2.5-8k)');
  const bt = bands(wetOnly({model: 0, tone: 1000}), 1.0); ok(bt.high < bw.high - 6, 'chorus: Tone darkens the wet line (' + (bt.high - bw.high).toFixed(1) + ' dB at 2.5-8k)');
  // rate: a 110 Hz sine through a wet line comes out with a pitch wobble; faster rate = more spread around the tone
  const slow = render('chorus', {model: 0, mix: 100, rate: 0.2, depth: 100}, sine(220, 0.3)), fast = render('chorus', {model: 0, mix: 100, rate: 6, depth: 100}, sine(220, 0.3));
  ok(sb(fast) > sb(slow) + 6, 'chorus: faster rate smears the pitch more (' + (sb(fast) - sb(slow)).toFixed(1) + ' dB more energy beside a 220 Hz tone)');
  // voices: CE-2 with 3 voices has a second line
  const [L2, R2] = render('chorus', {model: 0, voices: 1, mix: 100, depth: 100}, signal(), {stereo: true}); ok(rmsAt(L2, 0.4, 1) > 0.01, 'chorus: 3 voices on the CE-2 still has level'); }

// ---------------------------------------------------------------- flanger
basics('flanger');
{ const dryS = stats(signal()), on50 = stats(render('flanger', {mix: 50})); ok(on50.rms < dryS.rms*1.2, 'flanger: not louder at mix 50 (' + dB(on50.rms, dryS.rms).toFixed(1) + ' dB)');
  const nz = noise(); const dryN = spec(nz, 1.0);
  // feedback raises a resonant peak: compare the tallest peak at fb 0 and fb 90 with the sweep frozen (depth 0)
  const p0 = peakOf(resp('flanger', {model: 1, depth: 0, fb: 0, mix: 50, manual: 2}), FLAT, 300, 6000), p9 = peakOf(resp('flanger', {model: 1, depth: 0, fb: 90, mix: 50, manual: 2}), FLAT, 300, 6000);
  ok(p9[1] > p0[1] + 6, 'flanger: feedback raises a resonant peak (+' + p0[1].toFixed(1) + ' dB at fb 0, +' + p9[1].toFixed(1) + ' dB at fb 90, near ' + Math.round(p9[0]) + ' Hz)');
  // manual sets where the comb sits: the first notch at 2 ms is near 250 Hz, at 1 ms near 500 Hz
  const n2 = notchOf(resp('flanger', {model: 1, depth: 0, fb: 0, mix: 50, manual: 2}), FLAT, 150, 400), n1 = notchOf(resp('flanger', {model: 1, depth: 0, fb: 0, mix: 50, manual: 1}), FLAT, 300, 800);
  ok(Math.abs(n2[0] - 250) < 40 && Math.abs(n1[0] - 500) < 60, 'flanger: Manual sets the comb (first notch ' + Math.round(n2[0]) + ' Hz at 2 ms, ' + Math.round(n1[0]) + ' Hz at 1 ms)');
  // depth sweeps the comb: notches at two times differ
  const sw = render('flanger', {model: 1, depth: 100, fb: 0, mix: 50, manual: 2, rate: 0.5}, nz); const a = notchOf(spec(sw, 0.6), dryN, 100, 700), b = notchOf(spec(sw, 1.5), dryN, 100, 700);
  ok(Math.abs(a[0] - b[0]) > 40, 'flanger: the comb moves with the sweep (first notch ' + Math.round(a[0]) + ' Hz then ' + Math.round(b[0]) + ' Hz)');
  // polarity: negative flips the comb, so the 2 ms notch at 250 Hz becomes a peak
  const neg = resp('flanger', {model: 1, depth: 0, fb: 0, mix: 50, manual: 2, polarity: 1}), posR = resp('flanger', {model: 1, depth: 0, fb: 0, mix: 50, manual: 2}); const k250 = Math.round(250/binHz); let pos = 0, ng = 0; for(let k = k250 - 2; k <= k250 + 2; k++){ pos += posR[k] - FLAT[k]; ng += neg[k] - FLAT[k]; }
  ok(ng > pos + 6, 'flanger: Negative polarity flips the comb (250 Hz: ' + (pos/5).toFixed(1) + ' dB positive, ' + (ng/5).toFixed(1) + ' dB negative)');
  // models: Mistress is darker than ADA on the wet line
  const bm = bands(render('flanger', {model: 0, mix: 100, fb: 0, depth: 0}, nz), 1.0), ba = bands(render('flanger', {model: 1, mix: 100, fb: 0, depth: 0}, nz), 1.0); ok(bm.fizz - bm.lomid < ba.fizz - ba.lomid - 1, 'flanger: Mistress is darker than ADA (' + (bm.fizz - bm.lomid - (ba.fizz - ba.lomid)).toFixed(1) + ' dB)');
  // through-zero: with negative polarity the wet and dry cancel when the sweep crosses zero, so the level dips hard somewhere in each cycle
  const tz = render('flanger', {model: 2, depth: 100, fb: 0, mix: 50, manual: 2, rate: 1, polarity: 1}, sine(110, 0.3)); const rp = ripple(tz, 0.5, 1.5); ok(rp > 12, 'flanger: through-zero cancels at the crossing (level swings ' + rp.toFixed(1) + ' dB over a cycle)');
  const hi = stats(render('flanger', {model: 1, fb: 95, depth: 100, mix: 100})); ok(hi.pk < 1.5 && !hi.nan, 'flanger: full feedback stays in control (peak ' + hi.pk.toFixed(2) + ')'); }

// ---------------------------------------------------------------- phaser
basics('phaser');
{ const dryS = stats(signal()), on50 = stats(render('phaser', {mix: 50})); ok(on50.rms < dryS.rms*1.2, 'phaser: not louder at mix 50 (' + dB(on50.rms, dryS.rms).toFixed(1) + ' dB)');
  const nz = noise(); const dryN = spec(nz, 1.0);
  // notches move over time
  const sw = render('phaser', {model: 0, depth: 100, rate: 0.4, mix: 50, fb: 0}, nz); const a = notchOf(spec(sw, 0.5), dryN, 150, 4000), b = notchOf(spec(sw, 1.3), dryN, 150, 4000);
  ok(a[1] < -6 && b[1] < -6 && Math.abs(Math.log2(a[0]/b[0])) > 0.3, 'phaser: notches move over time (' + Math.round(a[0]) + ' Hz ' + a[1].toFixed(1) + ' dB, then ' + Math.round(b[0]) + ' Hz ' + b[1].toFixed(1) + ' dB)');
  // depth 0: the notches stay put
  const st = render('phaser', {model: 0, depth: 0, rate: 0.4, mix: 50, fb: 0}, nz); const c = notchOf(spec(st, 0.5), dryN, 150, 4000), d = notchOf(spec(st, 1.3), dryN, 150, 4000); ok(Math.abs(Math.log2(c[0]/d[0])) < 0.1, 'phaser: depth 0 holds the notches still (' + Math.round(c[0]) + ' and ' + Math.round(d[0]) + ' Hz)');
  // center moves the notches
  // four matched stages plus dry give two notches, at 0.41 and 2.41 times the stage frequency
  const lo = notchOf(resp('phaser', {model: 0, depth: 0, mix: 50, fb: 0, center: 300}), FLAT, 60, 250)[0], hi = notchOf(resp('phaser', {model: 0, depth: 0, mix: 50, fb: 0, center: 1200}), FLAT, 250, 1000)[0];
  ok(Math.abs(lo - 124) < 15 && Math.abs(hi - 497) < 30, 'phaser: Center moves the notches (first notch ' + Math.round(lo) + ' Hz at 300, ' + Math.round(hi) + ' Hz at 1200)');
  // more stages = more notches between 100 and 5 kHz
  const count = (s) => { let n = 0; for(let k = Math.round(60/binHz) + 1; k < 12000/binHz - 1; k++){ const v = s[k] - FLAT[k]; if(v < -10 && v <= s[k-1] - FLAT[k-1] && v < s[k+1] - FLAT[k+1]) n++; } return n; };
  const s4 = resp('phaser', {model: 0, depth: 0, mix: 50, fb: 0, stages: 0, center: 600}), s8 = resp('phaser', {model: 0, depth: 0, mix: 50, fb: 0, stages: 2, center: 600}); ok(count(s4) === 2 && count(s8) === 4, 'phaser: 8 stages make more notches than 4 (' + count(s4) + ' vs ' + count(s8) + ')');
  // feedback raises peaks between the notches
  const p0 = peakOf(resp('phaser', {model: 0, depth: 0, mix: 50, fb: 0}), FLAT, 150, 4000), p9 = peakOf(resp('phaser', {model: 0, depth: 0, mix: 50, fb: 90}), FLAT, 150, 4000); ok(p9[1] > p0[1] + 3, 'phaser: feedback raises the peaks (+' + p0[1].toFixed(1) + ' dB at 0, +' + p9[1].toFixed(1) + ' dB at 90)');
  // Small Stone color adds regeneration too
  const c0 = peakOf(resp('phaser', {model: 1, depth: 0, mix: 50, fb: 0, color: 0}), FLAT, 150, 4000), c1 = peakOf(resp('phaser', {model: 1, depth: 0, mix: 50, fb: 0, color: 1}), FLAT, 150, 4000); ok(c1[1] > c0[1] + 3, 'phaser: Small Stone Color adds regeneration (+' + c0[1].toFixed(1) + ' -> +' + c1[1].toFixed(1) + ' dB)');
  // Univibe: the LFO is a lamp flash, so the notch spends most of the cycle low and jumps up briefly; 4 staggered stages give notches spread apart
  // Univibe: the lamp flashes once a cycle, so the lowest notch sits low most of the time and jumps up briefly
  const uv = render('phaser', {model: 2, depth: 100, rate: 1, mix: 50, fb: 0, center: 600}, nz); const fs = []; for(let t = 0.5; t < 1.5; t += 0.02){ const s = spec(uv, t); let f = 0; for(let k = Math.round(60/binHz); k < 2500/binHz; k++){ if(s[k] - dryN[k] < -10){ f = k*binHz; break; } } if(f) fs.push(f); }
  fs.sort((a, b) => a - b); const med = fs[fs.length >> 1], mid = Math.sqrt(fs[0]*fs[fs.length - 1]); ok(fs.length > 30 && med < mid*0.8, 'phaser: Univibe sits low most of the cycle and flashes up (lowest notch: median ' + Math.round(med) + ' Hz, range ' + Math.round(fs[0]) + '-' + Math.round(fs[fs.length - 1]) + ' Hz)');
  const vb = stats(render('phaser', {model: 2, mix: 100})); ok(vb.pk > 0.05 && vb.pk < 1, 'phaser: Univibe at mix 100 (vibrato mode) is a sane level'); }

// ---------------------------------------------------------------- tremolo
basics('trem');
{ const steady = sine(110, 0.3);
  const y0 = render('trem', {depth: 0, rate: 4}, steady), y1 = render('trem', {depth: 100, rate: 4}, steady); ok(ripple(y0, 0.5, 1.5) < 1 && ripple(y1, 0.5, 1.5) > 20, 'trem: depth shows as level ripple (' + ripple(y0, 0.5, 1.5).toFixed(1) + ' dB at 0, ' + ripple(y1, 0.5, 1.5).toFixed(1) + ' dB at 100)');
  // ripple at the LFO rate: count dips per second
  const dips = (y) => { let n = 0, was = false; for(let t = 0.5; t < 1.5; t += 0.005){ const r = rmsAt(y, t, t + 0.005); const low = r < 0.12; if(low && !was) n++; was = low; } return n; };
  ok(Math.abs(dips(render('trem', {depth: 100, rate: 4}, steady)) - 4) <= 1, 'trem: 4 Hz gives 4 dips a second (' + dips(render('trem', {depth: 100, rate: 4}, steady)) + ')');
  ok(Math.abs(dips(render('trem', {depth: 100, rate: 8}, steady)) - 8) <= 1, 'trem: 8 Hz gives 8 dips a second (' + dips(render('trem', {depth: 100, rate: 8}, steady)) + ')');
  // shapes: square has steeper edges than sine (max level change between 10 ms slices)
  const slope = (y) => { let mx = 0, prev = rmsAt(y, 0.5, 0.51); for(let t = 0.51; t < 1.5; t += 0.01){ const r = rmsAt(y, t, t + 0.01); mx = Math.max(mx, Math.abs(r - prev)); prev = r; } return mx; };
  const sqS = slope(render('trem', {depth: 100, rate: 2, shape: 2}, steady)), snS = slope(render('trem', {depth: 100, rate: 2, shape: 0}, steady)); ok(sqS > snS*1.8, 'trem: Square has steeper edges than Sine (' + sqS.toFixed(3) + ' vs ' + snS.toFixed(3) + ' per 10 ms)');
  // optical: more time spent loud than quiet (asymmetric)
  const frac = (y) => { const rs = []; for(let t = 0.5; t < 1.5; t += 0.005) rs.push(rmsAt(y, t, t + 0.02)); const mid = (Math.max(...rs) + Math.min(...rs))/2; return rs.filter(r => r > mid).length/rs.length; };
  const fo = frac(render('trem', {depth: 100, rate: 2, model: 0}, steady)), fh = frac(render('trem', {depth: 100, rate: 2, model: 2}, steady)); ok(fo > 0.58 && Math.abs(fh - 0.5) < 0.06, 'trem: Optical sits loud more than half the time, Harmonic is even (' + Math.round(100*fo) + '% vs ' + Math.round(100*fh) + '%)');
  // stereo: L and R pulse against each other
  const [L, R] = render('trem', {depth: 60, rate: 3, stereo: 1}, steady, {stereo: true}), [Lm, Rm] = render('trem', {depth: 60, rate: 3, stereo: 0}, steady, {stereo: true});
  ok(width(L, R, 0.5, 1.5) > width(Lm, Rm, 0.5, 1.5) + 10, 'trem: Stereo Pan moves the sound between the sides (' + width(Lm, Rm, 0.5, 1.5).toFixed(1) + ' -> ' + width(L, R, 0.5, 1.5).toFixed(1) + ' dB)');
  // harmonic: the overall level barely moves while the tone changes (lows and highs trade places)
  const bright = signal({bright: 1}); const hm = render('trem', {depth: 100, rate: 2, model: 2}, bright), op = render('trem', {depth: 100, rate: 2, model: 0}, bright);
  ok(ripple(hm, 0.42, 0.9) < ripple(op, 0.42, 0.9) - 6, 'trem: Harmonic moves the tone, not the level (ripple ' + ripple(hm, 0.42, 0.9).toFixed(1) + ' dB vs Optical ' + ripple(op, 0.42, 0.9).toFixed(1) + ' dB)');
  const tilt = (y, t) => { const b = bands(y, t); return b.high - b.low; }; let tmx = -1e9, tmn = 1e9; for(let t = 0.45; t < 0.85; t += 0.05){ const v = tilt(hm, t); tmx = Math.max(tmx, v); tmn = Math.min(tmn, v); } ok(tmx - tmn > 6, 'trem: Harmonic tilts the tone back and forth (' + (tmx - tmn).toFixed(1) + ' dB swing between lows and highs)');
  // bias: a little pitch wobble shows as energy beside the tone
  const bs = spec(render('trem', {depth: 100, rate: 6, model: 1}, sine(1000, 0.3)), 0.5), os = spec(render('trem', {depth: 100, rate: 6, model: 0}, sine(1000, 0.3)), 0.5); const far = (s) => { let e = 0; for(let k = Math.round(1030/binHz); k < 1150/binHz; k++) e += Math.pow(10, s[k]/10); return 10*Math.log10(e); };
  ok(far(bs) > far(os) + 6, 'trem: Bias adds a pitch wobble (' + (far(bs) - far(os)).toFixed(1) + ' dB more energy 30-150 Hz above a 1 kHz tone than Optical)'); }

// ---------------------------------------------------------------- vibrato
basics('vibrato');
{ const t = sine(220, 0.3); const sp = (y) => { const s = spec(y, 1.0); let e = 0; for(let k = Math.round(190/binHz); k < 250/binHz; k++) if(Math.abs(k*binHz - 220) > 15) e += Math.pow(10, s[k]/10); return 10*Math.log10(e); };
  const d0 = sp(render('vibrato', {depth: 0}, t)), d1 = sp(render('vibrato', {depth: 100}, t)); ok(d1 > d0 + 10, 'vibrato: depth spreads the pitch (' + (d1 - d0).toFixed(1) + ' dB more energy beside the tone)');
  const r2 = spec(render('vibrato', {depth: 100, rate: 2}, t), 1.0), r8 = spec(render('vibrato', {depth: 100, rate: 8}, t), 1.0); const at = (s, f) => s[Math.round(f/binHz)]; ok(at(r8, 236) > at(r2, 236) + 6, 'vibrato: rate sets how far the sidebands sit (8 Hz puts more at 236 Hz than 2 Hz: ' + (at(r8, 236) - at(r2, 236)).toFixed(1) + ' dB)');
  // rise: early in the note there is less wobble than later
  const rise = render('vibrato', {depth: 100, rate: 6, rise: 800}, t), none = render('vibrato', {depth: 100, rate: 6, rise: 0}, t);
  const wob = (y, a) => { const s = spec(y, a); let e = 0; for(let k = Math.round(190/binHz); k < 250/binHz; k++) if(Math.abs(k*binHz - 220) > 15) e += Math.pow(10, s[k]/10); return 10*Math.log10(e); };
  ok(wob(rise, 0.02) < wob(none, 0.02) - 6, 'vibrato: Rise holds the wobble back at the start (' + (wob(none, 0.02) - wob(rise, 0.02)).toFixed(1) + ' dB less in the first 170 ms)');
  ok(wob(rise, 1.6) > wob(rise, 0.02) + 6, 'vibrato: the wobble grows in (' + (wob(rise, 1.6) - wob(rise, 0.02)).toFixed(1) + ' dB more after 1.6 s)');
  const lv = stats(render('vibrato', {depth: 100, rise: 800})); ok(lv.pk > 0.05 && lv.pk < 1, 'vibrato: level with Rise is sane (peak ' + lv.pk.toFixed(3) + ')'); }

// ---------------------------------------------------------------- rotary
basics('rotary');
{ const steady = sine(110, 0.3), hiT = sine(1500, 0.2);
  const slow = render('rotary', {speed: 0, mix: 100}, hiT), fast = render('rotary', {speed: 1, mix: 100}, hiT);
  const dips = (y) => { let n = 0, was = false; let mean = rmsAt(y, 0.5, 1.5); for(let t = 0.5; t < 1.5; t += 0.005){ const r = rmsAt(y, t, t + 0.005); const low = r < mean*0.9; if(low && !was) n++; was = low; } return n; };
  ok(dips(fast) >= 5 && dips(fast) <= 9 && dips(slow) <= 2, 'rotary: horn pulses about 7 times a second on Fast, under once on Slow (' + dips(fast) + ' vs ' + dips(slow) + ')');
  const [L, R] = render('rotary', {speed: 1, mix: 100}, signal(), {stereo: true}); ok(width(L, R, 0.4, 1.0) > -14, 'rotary: two mics give a wide image (' + width(L, R, 0.4, 1.0).toFixed(1) + ' dB)');
  const [Lm, Rm] = render('rotary', {speed: 1, mix: 100, width: 0}, signal(), {stereo: true}); ok(width(Lm, Rm, 0.4, 1.0) < -30, 'rotary: Mic Spread 0 is mono (' + width(Lm, Rm, 0.4, 1.0).toFixed(1) + ' dB)');
  // speed change ramps: switch to Fast at 0.5 s, the pulse rate half a second later is still well under the fast rate
  const sw = render('rotary', {speed: 0, mix: 100}, hiT, {steps: [[0.5, {speed: 1}]]}); const early = dips2(sw, 0.55, 1.0), late = dips2(sw, 1.5, 2.0);
  function dips2(y, a, b){ let n = 0, was = false; const mean = rmsAt(y, a, b); for(let t = a; t < b; t += 0.005){ const r = rmsAt(y, t, t + 0.005); const low = r < mean*0.9; if(low && !was) n++; was = low; } return n*(1/(b - a)); }
  ok(early < late - 1.5, 'rotary: the horn speeds up over time rather than jumping (' + early.toFixed(1) + ' pulses/s right after the switch, ' + late.toFixed(1) + ' a second later)');
  // Doppler on the horn: a 1.5 kHz tone gets sidebands on Fast
  const sF = spec(fast, 1.0), sS = spec(slow, 1.0); const side = (s) => { let e = 0; for(let k = Math.round(1515/binHz); k < 1600/binHz; k++) e += Math.pow(10, s[k]/10); return 10*Math.log10(e); }; ok(side(sF) > side(sS) + 6, 'rotary: Doppler spreads the horn pitch on Fast (' + (side(sF) - side(sS)).toFixed(1) + ' dB)');
  // the drum pulses less deeply than the horn
  ok(ripple(render('rotary', {speed: 1, mix: 100}, steady), 0.5, 1.5) < ripple(fast, 0.5, 1.5), 'rotary: the drum (110 Hz) pulses less than the horn (1.5 kHz): ' + ripple(render('rotary', {speed: 1, mix: 100}, steady), 0.5, 1.5).toFixed(1) + ' vs ' + ripple(fast, 0.5, 1.5).toFixed(1) + ' dB');
  // brake: after switching to brake the pulsing dies away
  const br = render('rotary', {speed: 1, mix: 100}, hiT, {steps: [[0.3, {speed: 2}]]}); ok(ripple(br, 1.7, 2.0) < ripple(br, 0.35, 0.65) - 3, 'rotary: Brake lets the rotors coast to a stop (ripple ' + ripple(br, 0.35, 0.65).toFixed(1) + ' -> ' + ripple(br, 1.7, 2.0).toFixed(1) + ' dB)');
  const d0 = stats(render('rotary', {drive: 0, mix: 100})), d1 = stats(render('rotary', {drive: 100, mix: 100})); ok(d1.rms/d1.pk > d0.rms/d0.pk, 'rotary: Drive squashes the peaks (crest ' + (d1.pk/d1.rms).toFixed(2) + ' vs ' + (d0.pk/d0.rms).toFixed(2) + ')');
  const nz = noise(); const cab = bands(render('rotary', {mix: 100, drive: 0}, nz), 1.0), dr = bands(nz, 1.0); ok(cab.fizz - cab.lomid < dr.fizz - dr.lomid - 3, 'rotary: the cabinet takes the fizz off (' + (cab.fizz - cab.lomid - (dr.fizz - dr.lomid)).toFixed(1) + ' dB)');
  const dryS = stats(signal()), on = stats(render('rotary', {mix: 70})); ok(on.rms < dryS.rms*1.3, 'rotary: default is not much louder than dry (' + dB(on.rms, dryS.rms).toFixed(1) + ' dB)'); }

// ---------------------------------------------------------------- ring mod
basics('ring');
{ const y = render('ring', {freq: 200, mix: 100, shape: 0, tone: 12000}, sine(500, 0.3)); const s = spec(y, 1.0); const at = (f) => { let m = -1e9; for(let k = Math.round((f - 8)/binHz); k <= (f + 8)/binHz; k++) m = Math.max(m, s[k]); return m; };
  ok(at(300) > at(500) + 15 && at(700) > at(500) + 15, 'ring: a 500 Hz sine and a 200 Hz carrier give 300 and 700 Hz, not 500 (300: ' + at(300).toFixed(0) + ', 500: ' + at(500).toFixed(0) + ', 700: ' + at(700).toFixed(0) + ' dB)');
  const sq = spec(render('ring', {freq: 200, mix: 100, shape: 1, tone: 12000}, sine(500, 0.3)), 1.0); ok(sq[Math.round(1100/binHz)] > s[Math.round(1100/binHz)] + 15, 'ring: a Square carrier adds the 3rd harmonic pair (1100 Hz: ' + sq[Math.round(1100/binHz)].toFixed(0) + ' vs ' + s[Math.round(1100/binHz)].toFixed(0) + ' dB)');
  const nz = noise(); const bt = bands(render('ring', {mix: 100, tone: 800}, nz), 1.0), bo = bands(render('ring', {mix: 100, tone: 12000}, nz), 1.0); ok(bt.high < bo.high - 8, 'ring: Tone takes the top off (' + (bt.high - bo.high).toFixed(1) + ' dB at 2.5-8k)');
  const m0 = stats(render('ring', {mix: 0})), dry = stats(signal()); ok(Math.abs(dB(m0.rms, dry.rms)) < 0.5, 'ring: mix 0 is dry'); }

// ---------------------------------------------------------------- bit crusher
basics('crush');
{ const dry = stats(signal()); const clean = stats(render('crush', {bits: 16, rate: 1})); ok(Math.abs(dB(clean.rms, dry.rms)) < 0.3, 'crush: 16 bits at 1x is almost dry');
  const b = bands(render('crush', {bits: 4, rate: 1})), d = bands(signal()); ok(b.fizz > d.fizz + 10, 'crush: 4 bits add fizz (+' + (b.fizz - d.fizz).toFixed(1) + ' dB)');
  const raw = bands(render('crush', {bits: 16, rate: 16, filter: 0})), fil = bands(render('crush', {bits: 16, rate: 16, filter: 1})); ok(fil.fizz < raw.fizz - 10 && fil.high < raw.high - 6, 'crush: Filter takes the aliasing out of a 16x downsample (fizz ' + (fil.fizz - raw.fizz).toFixed(1) + ' dB, high ' + (fil.high - raw.high).toFixed(1) + ' dB)');
  ok(Math.abs(fil.low - raw.low) < 2, 'crush: Filter keeps the lows (' + (fil.low - raw.low).toFixed(1) + ' dB)');
  const half = stats(render('crush', {bits: 4, mix: 50})); ok(half.pk < 1 && !half.nan, 'crush: mix 50 is sane'); }

done();
