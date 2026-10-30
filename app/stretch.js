// ===== Neon Peach practice player: time stretch and pitch shift, streamed in chunks =====
// Runs in a Web Worker. A phase vocoder with phase locking changes the speed. A cubic resampler then changes the pitch.
// At normal speed and pitch it just copies the song, so nothing is lost.
'use strict';
const N = 4096, HS = 1024, HALF = N/2, BINS = N/2 + 1, RING = 1 << 16, RM = RING - 1;
const WIN = new Float64Array(N); for(let i = 0; i < N; i++) WIN[i] = 0.5 - 0.5*Math.cos(2*Math.PI*i/N);
const OLA_NORM = 1/1.5;   // Hann times Hann at a quarter-frame hop sums to 1.5
// ---- FFT (radix 2, in place) ----
const LG = Math.log2(N), REV = new Uint32Array(N), CS = new Float64Array(N/2), SN = new Float64Array(N/2);
for(let i = 0; i < N; i++){ let r = 0; for(let b = 0; b < LG; b++) if(i & (1 << b)) r |= 1 << (LG - 1 - b); REV[i] = r; }
for(let k = 0; k < N/2; k++){ CS[k] = Math.cos(-2*Math.PI*k/N); SN[k] = Math.sin(-2*Math.PI*k/N); }
function fft(re, im, inv){
  for(let i = 0; i < N; i++){ const j = REV[i]; if(i < j){ let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; } }
  for(let len = 2; len <= N; len <<= 1){ const half = len >> 1, step = N/len;
    for(let i = 0; i < N; i += len) for(let j = 0; j < half; j++){ const c = CS[j*step], s = inv ? -SN[j*step] : SN[j*step];
      const a = i + j, b = a + half, xr = re[b]*c - im[b]*s, xi = re[b]*s + im[b]*c; re[b] = re[a] - xr; im[b] = im[a] - xi; re[a] += xr; im[a] += xi; } }
  if(inv){ const g = 1/N; for(let i = 0; i < N; i++){ re[i] *= g; im[i] *= g; } } }

let song = null;   // {ch:[Float32Array], len}
let S = null;      // stream state
const re = new Float64Array(N), im = new Float64Array(N), mag = new Float64Array(BINS), ph = new Float64Array(BINS), outPh = new Float64Array(BINS);
function wrapPi(x){ return x - 2*Math.PI*Math.round(x/(2*Math.PI)); }

function reset(pos, speed, pitch, loop){
  const nc = song ? song.ch.length : 1, p = Math.pow(2, pitch/12);
  S = { pos: Math.max(0, pos), speed, p, alpha: p/speed, loop, pass: Math.abs(speed - 1) < 1e-6 && Math.abs(pitch) < 1e-6,
    aPos: Math.max(0, pos), frame: 0, ring: Array.from({length: nc}, () => new Float32Array(RING)), done: 0, rp: 0,
    prevPh: Array.from({length: nc}, () => new Float64Array(BINS)), synPh: Array.from({length: nc}, () => new Float64Array(BINS)), first: true, fadeIn: 256 }; }

// one vocoder frame: analysis centred on S.aPos, synthesis centred on output index frame*HS
function pvFrame(){
  const a = Math.round(S.aPos), ha = HS/S.alpha, ratio = S.alpha, o0 = S.frame*HS - HALF;
  for(let c = 0; c < S.ring.length; c++){
    const x = song.ch[c], L = song.len, prev = S.prevPh[c], syn = S.synPh[c], ring = S.ring[c];
    for(let i = 0; i < N; i++){ const k = a - HALF + i; re[i] = (k >= 0 && k < L ? x[k] : 0)*WIN[i]; im[i] = 0; }
    fft(re, im, false);
    for(let k = 0; k < BINS; k++){ mag[k] = Math.hypot(re[k], im[k]); ph[k] = Math.atan2(im[k], re[k]); }
    if(S.first){ for(let k = 0; k < BINS; k++) outPh[k] = ph[k]; }
    else {
      // advance the phase of each peak; bins near a peak keep their offset from it (identity phase locking)
      for(let k = 0; k < BINS; k++){ const om = 2*Math.PI*k*ha/N, d = wrapPi(ph[k] - prev[k] - om); outPh[k] = syn[k] + (om + d)*ratio; }
      const lockTo = new Int32Array(BINS), peaks = [];
      for(let k = 1; k < BINS - 1; k++) if(mag[k] > mag[k - 1] && mag[k] >= mag[k + 1]) peaks.push(k);
      if(peaks.length){ let j = 0; for(let k = 0; k < BINS; k++){ while(j + 1 < peaks.length && Math.abs(peaks[j + 1] - k) < Math.abs(peaks[j] - k)) j++; lockTo[k] = peaks[j]; }
        for(let k = 0; k < BINS; k++){ const pk = lockTo[k]; if(pk !== k) outPh[k] = outPh[pk] + (ph[k] - ph[pk]); } }
    }
    for(let k = 0; k < BINS; k++){ prev[k] = ph[k]; syn[k] = outPh[k]; }
    for(let k = 0; k < BINS; k++){ re[k] = mag[k]*Math.cos(outPh[k]); im[k] = mag[k]*Math.sin(outPh[k]); }
    for(let k = 1; k < N/2; k++){ re[N - k] = re[k]; im[N - k] = -im[k]; }
    fft(re, im, true);
    for(let i = 0; i < N; i++){ const o = o0 + i; if(o < S.done) continue; ring[o & RM] += re[i]*WIN[i]*OLA_NORM; }
  }
  S.first = false; S.frame++; S.aPos += ha;
  const fin = S.frame*HS - HALF;   // everything before the next frame's start is final
  S.done = Math.max(S.done, fin); }

function cubic(r, x){ const i = Math.floor(x), f = x - i, a = r[(i - 1) & RM], b = r[i & RM], c = r[(i + 1) & RM], d = r[(i + 2) & RM];
  return b + 0.5*f*(c - a + f*(2*a - 5*b + 4*c - d + f*(3*(b - c) + d - a))); }

function pull(n){
  const nc = S.ring.length, out = Array.from({length: nc}, () => new Float32Array(n)), pos0 = S.pos, L = song.len;
  let lim = n, wrap = false, end = false;
  const B = S.loop ? S.loop[1] : L;
  const left = Math.ceil((B - S.pos)/S.speed);
  if(left <= n){ lim = Math.max(0, left); if(S.loop) wrap = true; else end = true; }
  if(S.pass){ const p = Math.floor(S.pos); for(let c = 0; c < nc; c++){ const x = song.ch[c]; for(let i = 0; i < lim; i++){ const k = p + i; out[c][i] = k < L ? x[k] : 0; } } }
  else {
    for(let i = 0; i < lim; i++){
      while(Math.floor(S.rp) + 3 > S.done) pvFrame();
      for(let c = 0; c < nc; c++) out[c][i] = cubic(S.ring[c], S.rp);
      // clear ring slots we have passed so the overlap-add starts clean when the ring wraps around
      const old = Math.floor(S.rp) - 4; if(old >= 0 && Math.floor(S.rp + S.p) - 4 > old){ for(let o = old; o < Math.floor(S.rp + S.p) - 4; o++) for(let c = 0; c < nc; c++) S.ring[c][o & RM] = 0; }
      S.rp += S.p; } }
  S.pos += lim*S.speed;
  if(S.fadeIn > 0){ const m = Math.min(S.fadeIn, lim); for(let c = 0; c < nc; c++) for(let i = 0; i < m; i++) out[c][i] *= i/m; S.fadeIn = 0; }
  if(wrap || end){ const m = Math.min(256, lim); for(let c = 0; c < nc; c++) for(let i = 0; i < m; i++) out[c][lim - 1 - i] *= i/m; }
  const res = {ch: out.map(x => x.subarray(0, lim)), pos0, speed: S.speed, wrap, end, n: lim};
  if(wrap) reset(S.loop[0], S.speed, 12*Math.log2(S.p), S.loop);
  return res; }

self.onmessage = (e) => { const m = e.data;
  if(m.cmd === 'load'){ song = {ch: m.ch, len: m.ch[0].length, sr: m.sr}; S = null; return; }
  if(m.cmd === 'set'){ if(!song) return; reset(m.pos, m.speed, m.pitch, m.loop); return; }
  if(m.cmd === 'loop'){ if(S) S.loop = m.loop; return; }
  if(m.cmd === 'pull'){ if(!song || !S){ self.postMessage({seq: m.seq, n: 0, end: true, ch: []}); return; }
    const r = pull(m.n); r.seq = m.seq; self.postMessage(r, r.ch.map(x => x.buffer)); return; }
  if(m.cmd === 'tempo'){ self.postMessage({tempo: findTempo(), seq: -1}); return; }
};

// ---- tempo guess: autocorrelation of the onset strength, 70 to 180 bpm ----
function findTempo(){
  if(!song) return 0; const L = song.len, sr = song.sr || 48000, hop = 512, nF = Math.floor(L/hop); if(nF < 400) return 0;
  const env = new Float32Array(nF); let prev = 0;
  for(let f = 0; f < nF; f++){ let e = 0; for(let c = 0; c < song.ch.length; c++){ const x = song.ch[c]; for(let i = f*hop; i < f*hop + hop; i++) e += x[i]*x[i]; } e = Math.log(1e-9 + e); env[f] = Math.max(0, e - prev); prev = e; }
  let mean = 0; for(let f = 0; f < nF; f++) mean += env[f]; mean /= nF; for(let f = 0; f < nF; f++) env[f] -= mean;
  const fps = sr/hop; let best = 0, bestV = -1e30;
  for(let bpm = 70; bpm <= 180; bpm += 0.5){ const lag = 60*fps/bpm; let v = 0;
    for(const mult of [1, 2, 4]){ const lg = lag*mult, li = Math.floor(lg), fr = lg - li; let s = 0; for(let f = 0; f + li + 1 < nF; f++) s += env[f]*(env[f + li]*(1 - fr) + env[f + li + 1]*fr); v += s/mult; }
    if(v > bestV){ bestV = v; best = bpm; } }
  return best; }
