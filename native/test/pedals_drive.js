// Checks the drive and fuzz pedal models through the native engine. No browser needed.
// Run: NP_ADDON=/home/claude/neonpeach/native/build/drive/npaudio.node node native/test/pedals_drive.js
const {render, stats, bands, rmsAt, toneLevel, signal, sine, checker, SR, N} = require('./lib');
const {ok, done} = checker();
const DRIVES = ['b3k', 'vintage', 'alpha', 'omega', 'ignis', 'od', 'fold', 'tubepre', 'muff', 'octfuzz'];
const r1 = (v) => +v.toFixed(1), r3 = (v) => +v.toFixed(3);
const first = (y) => { let pk = 0; for(let i = 0; i < 0.1*SR; i++) pk = Math.max(pk, Math.abs(y[i])); return pk; };
const dryRms = stats(signal()).rms;
// the level of one harmonic of a 110 Hz sine, relative to the fundamental
const harm = (y, h, at) => toneLevel(y, 110*h, at) - toneLevel(y, 110, at);
// total energy above a frequency, from a plain DFT over a window, in dB
function above(y, f0, at){ const n = 8192, off = Math.round((at == null ? 0.5 : at)*SR); let s = 0; for(let f = f0; f < 20000; f += 11.72){ const w = 2*Math.PI*f/SR; let a = 0, b = 0; for(let i = 0; i < n; i++){ const v = y[off + i]*(0.5 - 0.5*Math.cos(2*Math.PI*i/n)); a += v*Math.cos(w*i); b -= v*Math.sin(w*i); } s += a*a + b*b; } return 10*Math.log10(s + 1e-12); }
// how far a wave leans: the top peak against the bottom peak over a window, after the 12 Hz filter has taken the DC out. 0 is symmetric.
const lean = (y, a, b) => { let hi = 0, lo = 0; const i0 = Math.round(a*SR), i1 = Math.round(b*SR); for(let i = i0; i < i1; i++){ hi = Math.max(hi, y[i]); lo = Math.min(lo, y[i]); } return (hi + lo)/(hi - lo); };

// ---- every block: no NaN, no loud first moment, a sane level at defaults, blend 0 is clean ----
for(const t of DRIVES){ const y = render(t, {}), s = stats(y);
  ok(!s.nan, t + ': no NaN');
  ok(first(y) < 1.2, t + ': no loud first moment (peak in the first 100 ms ' + r3(first(y)) + ')');
  ok(s.pk > 0.08 && s.pk < 1.2, t + ': default level is sane (peak ' + r3(s.pk) + ', rms ' + r3(s.rms) + ', dry rms ' + r3(dryRms) + ')');
  const c = stats(render(t, {blend: 0, level: 0})); ok(Math.abs(20*Math.log10(c.rms/dryRms)) < 1, t + ': blend 0 passes the clean signal (' + r1(20*Math.log10(c.rms/dryRms)) + ' dB)');
  const q = stats(render(t, {blend: 100, level: 0}, signal({level: 0.02}))); ok(q.pk < 1.0, t + ': a quiet input never comes out over full scale at full blend (peak ' + r3(q.pk) + ')'); }

// ---- b3k ----
{ const lo = bands(render('b3k', {blend: 100, grunt: 40})), hi = bands(render('b3k', {blend: 100, grunt: 400}));
  ok(lo.low - lo.himid > hi.low - hi.himid + 3, 'b3k: Grunt keeps or cuts the low end into the drive (' + r1((lo.low - lo.himid) - (hi.low - hi.himid)) + ' dB)');
  const a0 = bands(render('b3k', {blend: 100, drive: 20, attack: -6})), a1 = bands(render('b3k', {blend: 100, drive: 20, attack: 12}));
  ok(a1.high - a1.low > a0.high - a0.low + 3, 'b3k: Attack adds top into the drive (' + r1((a1.high - a1.low) - (a0.high - a0.low)) + ' dB)');
  const d0 = stats(render('b3k', {blend: 100, drive: 0})), d1 = stats(render('b3k', {blend: 100, drive: 100}));
  ok(d1.rms/d1.pk > d0.rms/d0.pk, 'b3k: full drive is denser than clean (crest ' + (d1.pk/d1.rms).toFixed(2) + ' vs ' + (d0.pk/d0.rms).toFixed(2) + ')');
  const t0 = bands(render('b3k', {blend: 100, tone: -12})), t1 = bands(render('b3k', {blend: 100, tone: 12}));
  ok(t1.high - t1.low > t0.high - t0.low + 8, 'b3k: Tone works (' + r1((t1.high - t1.low) - (t0.high - t0.low)) + ' dB)');
  const h0 = bands(render('b3k', {blend: 100, highcut: 1500})), h1 = bands(render('b3k', {blend: 100, highcut: 12000}));
  ok(h1.fizz - h0.fizz > 10, 'b3k: High Cut takes the fizz off (' + r1(h1.fizz - h0.fizz) + ' dB)');
  const l0 = stats(render('b3k', {level: -12})), l1 = stats(render('b3k', {level: 12})); ok(l1.rms > l0.rms*3, 'b3k: Level works'); }

// ---- vintage: Era goes from tight and bright to dark and squashy ----
{ const m = bands(render('vintage', {blend: 100, drive: 60, era: 0})), v = bands(render('vintage', {blend: 100, drive: 60, era: 100}));
  ok(v.high - v.lomid < m.high - m.lomid - 3, 'vintage: Era 100 is darker than Era 0 (' + r1((m.high - m.lomid) - (v.high - v.lomid)) + ' dB)');
  const gr = (era) => 20*Math.log10(rmsAt(render('vintage', {blend: 100, drive: 0, era}, signal({level: 0.6})), 0.45, 0.6)/rmsAt(render('vintage', {blend: 100, drive: 0, era}, signal({level: 0.1})), 0.45, 0.6));
  ok(gr(100) < gr(0) - 3, 'vintage: at Drive 0, Era 100 compresses early and Era 0 stays clean (15.6 dB more in gives ' + r1(gr(100)) + ' dB more out at Era 100, ' + r1(gr(0)) + ' dB at Era 0)'); }

// ---- alpha / omega: Mod blends the two circuits, Bite and Growl push into the clip ----
{ const a = bands(render('alpha', {blend: 100, drive: 70, mod: 0})), o = bands(render('alpha', {blend: 100, drive: 70, mod: 100})), oo = bands(render('omega', {blend: 100, drive: 70, mod: 100}));
  const diff = (x, y) => Math.max(...Object.keys(x).map(k => Math.abs(x[k] - y[k])));
  ok(diff(a, o) > 1.5, 'alpha: Mod 0 and Mod 100 sound different (' + r1(diff(a, o)) + ' dB apart somewhere)');
  const same = {blend: 100, drive: 70, mod: 100, grunt: 100, attack: 2, tone: 0, highcut: 6500, level: 0}; const o2 = bands(render('alpha', same)), oo2 = bands(render('omega', same));
  ok(diff(o2, oo2) < 0.01, 'alpha and omega are one pedal: the same knobs give the same sound (' + r1(diff(o2, oo2)) + ' dB apart)');
  const sa = stats(render('alpha', {blend: 100, drive: 70, mod: 0})), so = stats(render('alpha', {blend: 100, drive: 70, mod: 100}));
  ok(so.rms/so.pk > sa.rms/sa.pk && o.fizz - o.lomid < a.fizz - a.lomid, 'omega side saturates earlier and is darker than alpha (crest ' + (so.pk/so.rms).toFixed(2) + ' vs ' + (sa.pk/sa.rms).toFixed(2) + ')');
  const b1 = bands(render('omega', {blend: 100, drive: 20, bite: 100})), b0 = bands(render('omega', {blend: 100, drive: 20, bite: 0}));
  ok(b1.high - b1.low > b0.high - b0.low + 1, 'omega: Bite adds top (' + r1((b1.high - b1.low) - (b0.high - b0.low)) + ' dB)');
  const g1 = bands(render('omega', {blend: 100, drive: 20, growl: 100})), g0 = bands(render('omega', {blend: 100, drive: 20, growl: 0}));
  ok(g1.lomid - g1.low > g0.lomid - g0.low + 0.7, 'omega: Growl adds low mids (' + r1((g1.lomid - g1.low) - (g0.lomid - g0.low)) + ' dB)'); }

// ---- ignis: cleans up when the input is quieter, Bias changes the sound, Gate chops the tail ----
{ const loud = render('ignis', {blend: 100, drive: 70}, sine(110, 0.5)), soft = render('ignis', {blend: 100, drive: 70}, sine(110, 0.03));
  const hl = above(loud, 300) - toneLevel(loud, 110), hs = above(soft, 300) - toneLevel(soft, 110);
  ok(hs < hl - 6, 'ignis: a quiet note has less fuzz on it than a loud one (harmonics ' + r1(hs) + ' vs ' + r1(hl) + ' dB under the note)');
  const lin = 20*Math.log10(rmsAt(loud, 0.5, 0.9)/rmsAt(soft, 0.5, 0.9)); ok(lin < 20, 'ignis: 24 dB more in gives less out (' + r1(lin) + ' dB): the fuzz squashes');
  const cold = render('ignis', {blend: 100, drive: 70, bias: 0}, sine(110, 0.3)), hot = render('ignis', {blend: 100, drive: 70, bias: 100}, sine(110, 0.3)), mid = render('ignis', {blend: 100, drive: 70, bias: 50}, sine(110, 0.3));
  ok(Math.abs(harm(cold, 2) - harm(hot, 2)) > 3 || Math.abs(harm(cold, 3) - harm(hot, 3)) > 3, 'ignis: Bias changes the harmonics (2nd ' + r1(harm(cold, 2)) + ' vs ' + r1(harm(hot, 2)) + ' dB, 3rd ' + r1(harm(cold, 3)) + ' vs ' + r1(harm(hot, 3)) + ' dB)');
  ok(harm(cold, 2) > harm(mid, 2), 'ignis: a starved bias leans the wave (more 2nd harmonic: ' + r1(harm(cold, 2)) + ' vs ' + r1(harm(mid, 2)) + ' dB)');
  const g0 = render('ignis', {blend: 100, gate: 0}), g1 = render('ignis', {blend: 100, gate: 100}); const tail0 = rmsAt(g0, 1.85, 1.98), tail1 = rmsAt(g1, 1.85, 1.98);
  ok(tail1 < tail0*0.5, 'ignis: Gate cuts the dying tail of a note (' + r1(20*Math.log10(tail1/tail0)) + ' dB)'); }

// ---- od: a Tube Screamer. The mid hump grows with drive, the diodes change the clip ----
{ const d0 = bands(render('od', {blend: 100, drive: 0, tone: 0})), d1 = bands(render('od', {blend: 100, drive: 100, tone: 0}));
  ok(d1.himid - d1.low > d0.himid - d0.low + 4, 'od: the mid hump grows with Drive (' + r1((d1.himid - d1.low) - (d0.himid - d0.low)) + ' dB more 700-2500 Hz over the lows)');
  const dd0 = stats(render('od', {blend: 100, drive: 0})), dd1 = stats(render('od', {blend: 100, drive: 100})); ok(dd1.rms/dd1.pk > dd0.rms/dd0.pk, 'od: full drive is denser than Drive 0 (crest ' + (dd1.pk/dd1.rms).toFixed(2) + ' vs ' + (dd0.pk/dd0.rms).toFixed(2) + ')');
  const si = render('od', {blend: 100, drive: 60, clip: 0}, sine(110, 0.4)), ge = render('od', {blend: 100, drive: 60, clip: 1}, sine(110, 0.4)), led = render('od', {blend: 100, drive: 60, clip: 2}, sine(110, 0.4)), asym = render('od', {blend: 100, drive: 60, clip: 3}, sine(110, 0.4));
  ok(stats(ge).pk < stats(si).pk && stats(si).pk < stats(led).pk, 'od: Germanium clips lowest, LED highest (peaks ' + r3(stats(ge).pk) + ' < ' + r3(stats(si).pk) + ' < ' + r3(stats(led).pk) + ')');
  ok(harm(asym, 2) > harm(si, 2) + 10, 'od: Asymmetric adds even harmonics (2nd ' + r1(harm(asym, 2)) + ' vs ' + r1(harm(si, 2)) + ' dB)');
  ok(harm(si, 2) < -30, 'od: Silicon is symmetric (2nd harmonic ' + r1(harm(si, 2)) + ' dB)');
  const t0 = bands(render('od', {blend: 100, tone: -12})), t1 = bands(render('od', {blend: 100, tone: 12})); ok(t1.high - t1.lomid > t0.high - t0.lomid + 8, 'od: Tone tilts the sound (' + r1((t1.high - t1.lomid) - (t0.high - t0.lomid)) + ' dB)'); }

// ---- fold: more folds, more harmonics; Symmetry adds even ones; Shape softens ----
{ const f1 = render('fold', {blend: 100, drive: 60, folds: 1, shape: 0}, sine(110, 0.4)), f6 = render('fold', {blend: 100, drive: 60, folds: 6, shape: 0}, sine(110, 0.4));
  const a1 = above(f1, 1000) - toneLevel(f1, 110), a6 = above(f6, 1000) - toneLevel(f6, 110);
  ok(a6 > a1 + 6, 'fold: more Folds puts more energy above 1 kHz (' + r1(a1) + ' -> ' + r1(a6) + ' dB under the note)');
  const s0 = render('fold', {blend: 100, drive: 60, folds: 3, symmetry: 0}, sine(110, 0.4)), s1 = render('fold', {blend: 100, drive: 60, folds: 3, symmetry: 60}, sine(110, 0.4));
  ok(harm(s1, 2) > harm(s0, 2) + 10, 'fold: Symmetry adds even harmonics (2nd ' + r1(harm(s0, 2)) + ' -> ' + r1(harm(s1, 2)) + ' dB)');
  const sh0 = render('fold', {blend: 100, drive: 60, folds: 3, shape: 0}, sine(110, 0.4)), sh1 = render('fold', {blend: 100, drive: 60, folds: 3, shape: 100}, sine(110, 0.4));
  ok(above(sh1, 3000) < above(sh0, 3000) - 3, 'fold: Shape 100 is smoother than sharp corners (' + r1(above(sh0, 3000) - above(sh1, 3000)) + ' dB less above 3 kHz)');
  const al = render('fold', {blend: 100, drive: 100, folds: 6, highcut: 12000}, sine(110, 0.5)); ok(!stats(al).nan && stats(al).pk < 1.5, 'fold: full folds on a 110 Hz note stays sane'); }

// ---- tubepre: the bias moves with the signal (duck and bloom), Bias and Sag knobs do their jobs ----
{ const y = render('tubepre', {blend: 100, drive: 60, sag: 0}, sine(110, 0.4));
  const early = lean(y, 0.03, 0.06), late = lean(y, 1.5, 1.9);
  ok(late > early + 0.015, 'tubepre: grid current slides the bias down under a loud note, so the bottom cuts off more as it settles (lean ' + r3(early) + ' at the start, ' + r3(late) + ' later)');
  const soft = render('tubepre', {blend: 100, drive: 60}, sine(110, 0.01)); ok(harm(soft, 2) < harm(y, 2) - 6, 'tubepre: a quiet note is cleaner than a loud one (2nd ' + r1(harm(soft, 2)) + ' vs ' + r1(harm(y, 2)) + ' dB)');
  ok(harm(y, 2) > -22, 'tubepre: a loud note has real even harmonics (2nd ' + r1(harm(y, 2)) + ' dB)');
  const cold = render('tubepre', {blend: 100, drive: 70, bias: 0}, sine(110, 0.3)), hot = render('tubepre', {blend: 100, drive: 70, bias: 100}, sine(110, 0.3));
  ok(lean(cold, 1, 1.9) > 0.05 && lean(cold, 1, 1.9) > lean(hot, 1, 1.9) + 0.08, 'tubepre: a cold Bias cuts the bottom off first, a hot one clamps the top (lean ' + r3(lean(cold, 1, 1.9)) + ' vs ' + r3(lean(hot, 1, 1.9)) + ')');
  ok(harm(hot, 3) > harm(cold, 3) + 1, 'tubepre: a hot Bias clamps harder, so more odd harmonics (3rd ' + r1(harm(hot, 3)) + ' vs ' + r1(harm(cold, 3)) + ' dB)');
  const s0 = render('tubepre', {blend: 100, drive: 80, sag: 0}, sine(110, 0.5)), s1 = render('tubepre', {blend: 100, drive: 80, sag: 100}, sine(110, 0.5));
  ok(rmsAt(s1, 1.5, 1.9) < rmsAt(s0, 1.5, 1.9)*0.9, 'tubepre: Sag holds a loud note back (' + r1(20*Math.log10(rmsAt(s1, 1.5, 1.9)/rmsAt(s0, 1.5, 1.9))) + ' dB)');
  ok(rmsAt(s1, 0.002, 0.012)/rmsAt(s1, 1.5, 1.9) > rmsAt(s0, 0.002, 0.012)/rmsAt(s0, 1.5, 1.9), 'tubepre: with Sag the first moment of a note pokes out more than the sustain');
  const al = render('tubepre', {blend: 100, drive: 100, highcut: 12000}, sine(110, 0.6)); let ali = -200; for(let f = 110*1.5; f < 20000; f += 110){ ali = Math.max(ali, toneLevel(al, f, 1.0, 16384)); }
  ok(ali < toneLevel(al, 110, 1.0, 16384) - 40, 'tubepre: no aliasing to speak of on a 110 Hz note at full drive (biggest tone between harmonics ' + r1(ali - toneLevel(al, 110, 1.0, 16384)) + ' dB under the note)'); }

// ---- muff: tone goes dark to bright, mids puts them back, sustain adds grind, gate sputters ----
{ const dark = bands(render('muff', {blend: 100, tone: 0})), mid = bands(render('muff', {blend: 100, tone: 50})), bright = bands(render('muff', {blend: 100, tone: 100}));
  ok(bright.high - bright.low > dark.high - dark.low + 12 && bright.high - bright.low < dark.high - dark.low + 60, 'muff: Tone goes dark to bright, without killing either end (' + r1((bright.high - bright.low) - (dark.high - dark.low)) + ' dB)');
  ok(mid.himid - (mid.lomid + mid.high)/2 < Math.min(dark.himid - (dark.lomid + dark.high)/2, bright.himid - (bright.lomid + bright.high)/2), 'muff: the middle of Tone scoops the mids');
  const m0 = bands(render('muff', {blend: 100, mids: -12})), m1 = bands(render('muff', {blend: 100, mids: 12})); ok(m1.himid - m1.low > m0.himid - m0.low + 8, 'muff: Mids works (' + r1((m1.himid - m1.low) - (m0.himid - m0.low)) + ' dB)');
  const s0 = render('muff', {blend: 100, sustain: 0}), s1 = render('muff', {blend: 100, sustain: 100}); const sus = (y) => rmsAt(y, 1.6, 1.7)/rmsAt(y, 0.82, 0.95);
  ok(sus(s1) > sus(s0)*1.4, 'muff: Sustain holds the dying tail up against the note (' + r1(20*Math.log10(sus(s1)/sus(s0))) + ' dB more tail)');
  const h0 = render('muff', {blend: 100, sustain: 0, tone: 50}, sine(110, 0.3)), h1 = render('muff', {blend: 100, sustain: 100, tone: 50}, sine(110, 0.3)); ok(above(h1, 1000) - toneLevel(h1, 110) > above(h0, 1000) - toneLevel(h0, 110) + 3, 'muff: Sustain adds grind (' + r1((above(h1, 1000) - toneLevel(h1, 110)) - (above(h0, 1000) - toneLevel(h0, 110))) + ' dB more above 1 kHz on a sine)');
  const g0 = render('muff', {blend: 100, gate: 0}), g1 = render('muff', {blend: 100, gate: 100}); ok(rmsAt(g1, 1.9, 1.98) < rmsAt(g0, 1.9, 1.98)*0.5, 'muff: Gate cuts the dying tail (' + r1(20*Math.log10(rmsAt(g1, 1.9, 1.98)/rmsAt(g0, 1.9, 1.98))) + ' dB)');
  ok(rmsAt(g1, 0.82, 0.95) > rmsAt(g0, 0.82, 0.95)*0.7, 'muff: Gate leaves the note itself alone'); }

// ---- octfuzz: the octave is there and the Octave knob sets how much ----
{ const o1 = render('octfuzz', {blend: 100, drive: 30, octave: 100, grunt: 150}, sine(220, 0.3)), o0 = render('octfuzz', {blend: 100, drive: 30, octave: 0, grunt: 150}, sine(220, 0.3));
  const oct1 = toneLevel(o1, 440) - toneLevel(o1, 220), oct0 = toneLevel(o0, 440) - toneLevel(o0, 220);
  ok(oct1 > oct0 + 15, 'octfuzz: Octave 100 brings the octave up (octave is ' + r1(oct1) + ' dB against the note; ' + r1(oct0) + ' dB at Octave 0)');
  ok(oct1 > 0 && oct1 < 40, 'octfuzz: at full Octave the octave is louder than the note, but the note is still there (' + r1(oct1) + ' dB)');
  const d0 = stats(render('octfuzz', {blend: 100, drive: 0})), d1 = stats(render('octfuzz', {blend: 100, drive: 100})); ok(d1.rms/d1.pk > d0.rms/d0.pk, 'octfuzz: Drive adds fuzz (crest ' + (d1.pk/d1.rms).toFixed(2) + ' vs ' + (d0.pk/d0.rms).toFixed(2) + ')'); }

done();
