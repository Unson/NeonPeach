// The C++ twins of the worklets in app/worklets_time.js for the time pedal family. Ported line by line; the golden test checks them against Chrome.
#include "procs.h"
#include <algorithm>
#include <cstdint>

namespace np {

static const double TWO_PI_T = 6.283185307179586, PI_T = 3.141592653589793;
#define IN(c) (in.d[(c) < inCh ? (c) : 0])
static inline double lpCoefT(double fc, double sr){ return 1 - std::exp(-TWO_PI_T*fc/sr); }
// The next prime at or above n. Delay lines with prime lengths never share a ring.
static int primeAbove(double x){ int n = std::max(2, (int)std::floor(x + 0.5)); for(;; n++){ bool ok = true; for(int d = 2; d*d <= n; d++){ if(n % d == 0){ ok = false; break; } } if(ok) return n; } }
// A delay line read with linear interpolation. d is the delay in samples (fractional), w the write index, S the size.
static inline double tapRead(const float* b, int w, double d, int S){ double r = w - d; if(r < 0) r += S; int i0 = (int)r; double f = r - i0; int i1 = i0 + 1; if(i1 >= S) i1 -= S; return b[i0]*(1 - f) + b[i1]*f; }

// Deterministic noise: the same seed in both engines gives the same hiss.
static inline uint32_t lcg(uint32_t s){ return s*1664525u + 1013904223u; }
static inline double clampT(double v, double a, double b){ return v < a ? a : (v > b ? b : v); }
struct SVFT {
  double ic1 = 0, ic2 = 0, lp = 0, bp = 0, hp = 0;
  SVFT& run(double x, double fc, double q, double sr){
    double g = std::tan(PI_T*clampT(fc, 10, sr*0.45)/sr), k = 1/std::max(q, 0.2);
    double a1 = 1/(1 + g*(g + k)), a2 = g*a1, a3 = g*a2, v3 = x - ic2, v1 = a1*ic1 + a2*v3, v2 = ic2 + a2*ic1 + a3*v3;
    ic1 = 2*v1 - ic1; ic2 = 2*v2 - ic2; lp = v2; bp = v1; hp = x - k*v1 - v2; return *this; }
};

// ---------------------------------------------------------------- delay (np-delay)
struct Delay : Proc {
  int S = 0; std::vector<float> buf[2]; int w = 0; double d = -1, ph1 = 0, ph2 = 0; uint32_t seed = 22222;
  double hp[4] = {0,0,0,0}, lp[10] = {0,0,0,0,0,0,0,0,0,0}; SVFT bump[2]; double dc[2] = {0,0}, acc[2] = {0,0}, hold[2] = {0,0}, qh[2] = {0,0}; int cnt = 0;
  std::vector<PDesc> desc() const override { return {{"type",0,0,3,true},{"time",375,1,3900,true},{"fb",0.35f,0,1,true},{"lowcut",120,20,1000,true},{"highcut",5000,500,12000,true},{"mod",0,0,1,true},{"age",0.25f,0,1,true},{"lofi",0,0,1,true}}; }
  void init(const ValueP&) override { S = (int)std::ceil(sr*4.2); buf[0].assign(S, 0.f); buf[1].assign(S, 0.f); }
  bool process(Bus& in, int inCh, Bus& out, int n) override {
    if(dead) return false; bool has = inCh > 0;
    int type = (int)std::lround(p(0)); bool tape = type == 1, analog = type == 2, pp = type == 3; double age = p(6), mod = p(5), lofi = p(7), ms = p(1);
    double target = std::min(S - sr*0.3, ms*sr/1000); if(d < 0) d = target; double dcc = 1 - std::exp(-1/(sr*0.05));
    double fbg = p(2)*(tape || analog ? 1 : 0.95);
    double chp = lpCoefT(p(3), sr), bw = analog ? std::min((double)p(4), clampT(900000/ms, 700, 7000)) : p(4), clp = lpCoefT(bw, sr), clp2 = lpCoefT(tape ? 5500 - 2500*age : bw, sr);
    double bumpG = tape ? std::pow(10, 2.5*(0.5 + age)/20) - 1 : 0, clk = clampT(4096*1000/(2*ms), 2500, 40000)/sr, grit = analog ? 0.15 + 0.5*age : 0, hiss = tape ? 0.0004*age : (analog ? 0.00015*age : 0);
    double sg = tape ? 1 + 0.5*age : 1, kt = tape ? 0.6 + 1.4*age : 1, kb = 0.8 + 1.5*age, bb = 0.1 + 0.2*age, tb = std::tanh(kb*bb), nb = kb*(1 - tb*tb);
    double f1 = tape ? 0.42 : (analog ? 0.6 : 0.3), f2 = tape ? 5.7 : (analog ? 7.1 : 0.3), D1 = mod*sr*(tape ? 0.0035*(0.6 + 0.8*age) : (analog ? 0.002 : 0.0025)), D2 = mod*sr*(tape ? 0.00014*(0.5 + age) : (analog ? 0.00006 : 0));
    double r1 = TWO_PI_T*f1/sr, r2 = TWO_PI_T*f2/sr;
    for(int i = 0; i < n; i++){
      double xL = has ? in.d[0][i] : 0, xR = has ? IN(1)[i] : 0;
      d += dcc*(target - d); ph1 += r1; if(ph1 > TWO_PI_T) ph1 -= TWO_PI_T; ph2 += r2; if(ph2 > TWO_PI_T) ph2 -= TWO_PI_T;
      double tri = std::fabs(ph2/PI_T - 1)*2 - 1, rd = clampT(d + D1*std::sin(ph1) + D2*tri, 1, S - 2);
      double tL = tapRead(buf[0].data(), w, rd, S), tR = tapRead(buf[1].data(), w, rd, S);
      cnt++; bool take = cnt >= 4; if(take) cnt = 0;
      double pre0 = pp ? 0.5*(xL + xR) + fbg*tR : xL + fbg*tL, pre1 = pp ? tL : xR + fbg*tR;
      for(int c = 0; c < 2; c++){ double y = c ? pre1 : pre0; int o = c*2, o5 = c*5;
        hp[o] += chp*(y - hp[o]); y -= hp[o]; hp[o+1] += chp*(y - hp[o+1]); y -= hp[o+1];
        if(analog){ acc[c] += clk; if(acc[c] >= 1){ acc[c] -= 1; hold[c] = y; } y = y*(1 - grit) + hold[c]*grit; }
        lp[o5] += clp*(y - lp[o5]); lp[o5+1] += clp*(lp[o5] - lp[o5+1]); y = lp[o5+1];
        if(analog){ lp[o5+2] += clp*(y - lp[o5+2]); lp[o5+3] += clp*(lp[o5+2] - lp[o5+3]); y = lp[o5+3]; }
        if(tape){ lp[o5+4] += clp2*(y - lp[o5+4]); y = lp[o5+4]; y += bumpG*bump[c].run(y, 110, 0.9, sr).bp/0.9; }
        if(!tape && !analog && lofi > 0){ if(take) qh[c] = std::floor(y*2048 + 0.5)/2048; y = y*(1 - lofi) + qh[c]*lofi; }
        if(hiss > 0){ seed = lcg(seed); y += (seed/4294967296.0 - 0.5)*hiss; }
        if(tape){ double u = y*sg; y = std::tanh(kt*u)/(kt*sg); } else if(analog){ y = (std::tanh(kb*(y + bb)) - tb)/nb; } else { y = y/std::pow(1 + std::pow(std::fabs(y)/1.2, 8), 0.125); }
        dc[c] += 0.0005*(y - dc[c]); y -= dc[c];
        buf[c][w] = (float)y; }
      w++; if(w >= S) w = 0;
      out.d[0][i] = (float)tL; if(out.ch > 1) out.d[1][i] = (float)tR; }
    return true; }
};

// ---------------------------------------------------------------- multi-tap (np-taps)
static const double TAPS_MUL[4][4] = {{1,2,3,4},{0.75,1.5,2.25,3},{2.0/3,4.0/3,2,8.0/3},{1,1.618,2.618,4.236}};
struct Taps : Proc {
  int S = 0; std::vector<float> buf; int w = 0; double d[4] = {-1,-1,-1,-1}, g[4] = {-1,-1,-1,-1}, lp = 0;
  std::vector<PDesc> desc() const override { return {{"time",250,1,2000,true},{"fb",0.2f,0,0.95f,true},{"highcut",4000,500,12000,true},{"spread",0.6f,0,1,true},{"taps",3,1,4,true},{"pattern",0,0,3,true}}; }
  void init(const ValueP&) override { S = (int)std::ceil(sr*8.7); buf.assign(S, 0.f); }
  bool process(Bus& in, int inCh, Bus& out, int n) override {
    if(dead) return false; bool has = inCh > 0;
    int pat = (int)std::lround(p(5)); const double* mul = TAPS_MUL[pat >= 0 && pat < 4 ? pat : 0]; int taps = (int)std::lround(p(4)); double fb = p(1), clp = lpCoefT(p(2), sr), dcc = 1 - std::exp(-1/(sr*0.05)), gc = 1 - std::exp(-1/(sr*0.01)), spread = p(3);
    double tg[4], td[4], pL[4], pR[4];
    for(int k = 0; k < 4; k++){ td[k] = std::min((double)S - 4, p(0)*sr/1000*mul[k]); tg[k] = k < taps ? std::pow(0.7, k) : 0; if(d[k] < 0){ d[k] = td[k]; g[k] = tg[k]; } double pan = (k % 2 ? 1 : -1)*spread*(k/3.0), a = (pan + 1)*PI_T/4; pL[k] = std::cos(a); pR[k] = std::sin(a); }
    float* b = buf.data();
    for(int i = 0; i < n; i++){
      double x = has ? (inCh > 1 ? 0.5*(in.d[0][i] + (double)in.d[1][i]) : in.d[0][i]) : 0, oL = 0, oR = 0, t0 = 0;
      for(int k = 0; k < 4; k++){ d[k] += dcc*(td[k] - d[k]); g[k] += gc*(tg[k] - g[k]); double v = tapRead(b, w, d[k], S); if(k == 0) t0 = v; oL += v*g[k]*pL[k]; oR += v*g[k]*pR[k]; }
      lp += clp*(t0 - lp); b[w] = (float)(x + fb*lp); w++; if(w >= S) w = 0;
      out.d[0][i] = (float)oL; if(out.ch > 1) out.d[1][i] = (float)oR; }
    return true; }
};

// ---------------------------------------------------------------- reverb (np-verb)
struct VerbT { double l[8]; double er[6]; int ern; double erg, dg, damp, mod, hp, og; };
static const VerbT VERB_T[6] = {
  {{13.7,17.9,21.1,25.3,29.9,34.7,39.1,44.3}, {5.1,8.3,12.7,17.3,22.9,28.1}, 6, 0.9, 0.55, 6500, 5, 60, 0.11},
  {{31.7,39.1,46.3,55.9,63.1,71.3,79.9,89.7}, {11.3,17.9,24.1,31.7,39.3,47.1}, 6, 0.3, 0.72, 4000, 11, 45, 0.14},
  {{9.7,12.1,14.3,17.9,21.1,24.7,28.3,33.1}, {0,0,0,0,0,0}, 0, 0, 0.8, 11000, 9, 80, 0.05},
  {{13.7,17.9,21.1,25.3,29.9,34.7,39.1,44.3}, {0,0,0,0,0,0}, 0, 0, 0, 3000, 0, 90, 0.8},
  {{59.3,71.9,83.1,97.7,109.3,121.1,137.9,149.3}, {19.3,29.7,41.1,53.9,67.3,79.1}, 6, 0.25, 0.82, 1300, 14, 40, 0.09},
  {{31.7,39.1,46.3,55.9,63.1,71.3,79.9,89.7}, {11.3,17.9,24.1,31.7,39.3,47.1}, 6, 0.3, 0.72, 5000, 11, 45, 0.13} };
struct SpringT { double d; int m, k; double a, lp; };
static const SpringT SPRINGS[3] = {{31,48,8,0.55,3600},{37,56,9,0.57,3000},{44,64,10,0.6,2600}};
static const double AP_MS[4] = {4.76,3.59,12.7,9.3};
struct Verb : Proc {
  static const int SZ = 16384, PS = 32768, AS = 2048, SS = 8192;
  std::vector<float> line[8]; int w = 0; double L[8], g[8], lp[8];
  std::vector<float> pre[2]; int pw = 0;
  std::vector<float> ap[8]; int apL[8]; int aw = 0;
  double hpz[2] = {0,0}, ph[2] = {0,0}, erT[6] = {0,0,0,0,0,0}; int erN = 0;
  struct Sp { std::vector<float> buf; std::vector<double> xs, ys; int q = 0, w = 0; double lp = 0, hp = 0; int d; double g = 0, c; } sp[3];
  double dz[8] = {0,0,0,0,0,0,0,0}; int type = -1; double T60 = -1, damp = -1, hpc = 0, erg = 0, dg = 0, og = 0, mod = 0;
  std::vector<PDesc> desc() const override { return {{"type",1,0,5,true},{"decay",2,0.2f,8,true},{"predelay",10,0,200,true},{"damp",7000,500,20000,true}}; }
  void init(const ValueP&) override {
    for(int i = 0; i < 8; i++) line[i].assign(SZ, 0.f); for(int i = 0; i < 2; i++) pre[i].assign(PS, 0.f);
    for(int i = 0; i < 8; i++){ ap[i].assign(AS, 0.f); apL[i] = std::min(AS - 2, (int)std::floor(sr*AP_MS[i & 3]/1000*(i < 4 ? 1 : 1.07) + 0.5)); }
    for(int j = 0; j < 3; j++){ const SpringT& s = SPRINGS[j]; Sp& S = sp[j]; S.buf.assign(SS, 0.f); S.xs.assign(s.m*s.k, 0.0); S.ys.assign(s.m*s.k, 0.0); S.d = std::min(SS - 4, (int)std::floor(sr*s.d/1000 + 0.5)); S.c = 1 - std::exp(-TWO_PI_T*s.lp/sr); }
    tune(1, 2, 7000); }
  void tune(int ty, double t60, double dmpIn){ const VerbT& t = VERB_T[ty >= 0 && ty < 6 ? ty : 1];
    if(ty != type){ type = ty; for(auto& b : line) std::fill(b.begin(), b.end(), 0.f); for(auto& s : sp){ std::fill(s.buf.begin(), s.buf.end(), 0.f); std::fill(s.xs.begin(), s.xs.end(), 0.0); std::fill(s.ys.begin(), s.ys.end(), 0.0); s.lp = 0; s.hp = 0; } for(auto& b : ap) std::fill(b.begin(), b.end(), 0.f); hpz[0] = hpz[1] = 0;
      for(int i = 0; i < 8; i++) L[i] = std::min(SZ - 40, primeAbove(sr*t.l[i]/1000)); erN = t.ern; for(int i = 0; i < erN; i++) erT[i] = sr*t.er[i]/1000; }
    double dmp = std::min(t.damp, dmpIn), c = 1 - std::exp(-TWO_PI_T*dmp/sr), comp = std::sqrt(1 + std::pow(400/t.damp, 2));
    for(int i = 0; i < 8; i++){ g[i] = std::min(0.995, std::pow(10, -3*L[i]/(sr*t60))*comp); lp[i] = c; }
    for(int j = 0; j < 3; j++){ const SpringT& s = SPRINGS[j]; Sp& S = sp[j]; double len = S.d + s.m*s.k*0.5, k = std::sqrt(1 + std::pow(400/s.lp, 2)); S.g = std::min(0.995, std::pow(10, -3*len/(sr*t60))*k); }
    hpc = 1 - std::exp(-TWO_PI_T*t.hp/sr); erg = t.erg; dg = t.dg; og = t.og; mod = t.mod; T60 = t60; damp = dmpIn; }
  bool process(Bus& in, int inCh, Bus& out, int n) override {
    if(dead) return false; bool has = inCh > 0;
    int ty = (int)std::lround(p(0)); double t60 = p(1), dmp = p(3); if(ty != type || t60 != T60 || dmp != damp) tune(ty, t60, dmp);
    double pd = std::min((double)PS - 4, p(2)*sr/1000);
    double r1 = TWO_PI_T*0.31/sr, r2 = TWO_PI_T*0.47/sr; bool spring = ty == 3;
    for(int i = 0; i < n; i++){
      double xL = has ? in.d[0][i] : 0, xR = has ? IN(1)[i] : 0;
      pre[0][pw] = (float)xL; pre[1][pw] = (float)xR; pw++; if(pw >= PS) pw = 0;
      double aL = tapRead(pre[0].data(), pw, pd + 1, PS), aR = tapRead(pre[1].data(), pw, pd + 1, PS);
      double oL = 0, oR = 0;
      if(spring){
        double x = 0.5*(aL + aR), s0 = 0, s1 = 0, s2 = 0;
        for(int j = 0; j < 3; j++){ const SpringT& s = SPRINGS[j]; Sp& S = sp[j]; int K = s.k, M = s.m; double a = s.a;
          double z = S.buf[(S.w - S.d + SS) % SS]; S.lp += S.c*(z - S.lp); z = S.lp; S.hp += hpc*(z - S.hp); z -= S.hp;
          double v = x*0.5 + z*S.g;
          int q = S.q; double* xs = S.xs.data(); double* ys = S.ys.data(); for(int m = 0; m < M; m++){ int ix = m*K + q; double xd = xs[ix], yd = ys[ix]; double y = a*(v - yd) + xd; xs[ix] = v; ys[ix] = y; v = y; }
          S.q = q + 1; if(S.q >= K) S.q = 0; S.buf[S.w] = (float)v; S.w++; if(S.w >= SS) S.w = 0;
          if(j == 0) s0 = v; else if(j == 1) s1 = v; else s2 = v; }
        oL = (s0 + 0.5*s2)*og*0.8; oR = (s1 + 0.5*s2)*og*0.8;
      } else {
        double eL = 0, eR = 0; for(int j = 0; j < erN; j++){ double v = tapRead(pre[j & 1].data(), pw, pd + 1 + erT[j], PS)*(0.7 - 0.08*j); if(j & 1) eR += v; else eL += v; }
        hpz[0] += hpc*(aL - hpz[0]); hpz[1] += hpc*(aR - hpz[1]); double dL = aL - hpz[0], dR = aR - hpz[1];
        for(int j = 0; j < 4; j++){ float* b = ap[j].data(); int rd = (aw - apL[j] + AS) % AS; double z = b[rd]; double y = z - dg*dL; b[aw] = (float)(dL + dg*z); dL = y; }
        for(int j = 4; j < 8; j++){ float* b = ap[j].data(); int rd = (aw - apL[j] + AS) % AS; double z = b[rd]; double y = z - dg*dR; b[aw] = (float)(dR + dg*z); dR = y; }
        aw++; if(aw >= AS) aw = 0;
        ph[0] += r1; if(ph[0] > TWO_PI_T) ph[0] -= TWO_PI_T; ph[1] += r2; if(ph[1] > TWO_PI_T) ph[1] -= TWO_PI_T;
        double m2 = mod*std::sin(ph[0]), m5 = mod*std::sin(ph[1]);
        double r0 = tapRead(line[0].data(), w, L[0], SZ), rr1 = tapRead(line[1].data(), w, L[1], SZ), rr2 = tapRead(line[2].data(), w, L[2] + m2, SZ), r3 = tapRead(line[3].data(), w, L[3], SZ), r4 = tapRead(line[4].data(), w, L[4], SZ), r5 = tapRead(line[5].data(), w, L[5] + m5, SZ), r6 = tapRead(line[6].data(), w, L[6], SZ), r7 = tapRead(line[7].data(), w, L[7], SZ);
        oL = (eL*erg + (r0 - rr2 + r4 - r6))*og; oR = (eR*erg + (rr1 - r3 + r5 - r7))*og;
        double* d = dz; d[0] += lp[0]*(r0 - d[0]); d[1] += lp[1]*(rr1 - d[1]); d[2] += lp[2]*(rr2 - d[2]); d[3] += lp[3]*(r3 - d[3]); d[4] += lp[4]*(r4 - d[4]); d[5] += lp[5]*(r5 - d[5]); d[6] += lp[6]*(r6 - d[6]); d[7] += lp[7]*(r7 - d[7]);
        double v0 = d[0]*g[0], v1 = d[1]*g[1], v2 = d[2]*g[2], v3 = d[3]*g[3], v4 = d[4]*g[4], v5 = d[5]*g[5], v6 = d[6]*g[6], v7 = d[7]*g[7];
        double s = (v0 + v1 + v2 + v3 + v4 + v5 + v6 + v7)*0.25, iL = dL*0.5, iR = dR*0.5;
        line[0][w] = (float)(v0 - s + iL); line[1][w] = (float)(v1 - s - iL); line[2][w] = (float)(v2 - s + iL); line[3][w] = (float)(v3 - s - iL); line[4][w] = (float)(v4 - s + iR); line[5][w] = (float)(v5 - s - iR); line[6][w] = (float)(v6 - s + iR); line[7][w] = (float)(v7 - s - iR);
        w++; if(w >= SZ) w = 0;
      }
      out.d[0][i] = (float)oL; if(out.ch > 1) out.d[1][i] = (float)oR;
    }
    return true; }
};

// ---------------------------------------------------------------- sub octave (np-oc2)
struct OC2 : Proc {
  double l1 = 0, l2 = 0, l3 = 0, l4 = 0, env = 0, ff1 = 1, ff2 = 1, s1 = 0, s2 = 0, s3 = 0, s4 = 0, u1 = 0, u2 = 0, udc = 0; int cmp = -1, cnt = 0; long hold = 0, flips = 0;
  std::vector<PDesc> desc() const override { return {{"sub1",0.7f,0,1,false},{"sub2",0,0,1,false},{"up",0,0,1,false},{"dry",1,0,1,false},{"tone",600,100,4000,false},{"track",300,100,800,false}}; }
  bool process(Bus& in, int inCh, Bus& out, int n) override {
    if(dead) return false; if(!inCh) return true;
    double track = p(5), tone = p(4);
    double ct = lpCoefT(track, sr), cto = lpCoefT(tone, sr), cto2 = lpCoefT(tone*0.5, sr), cup = lpCoefT(std::min(tone*4, 6000.0), sr), cdc = lpCoefT(40, sr), envA = lpCoefT(80, sr), envR = std::exp(-1/(sr*0.06)), minHold = 0.4*sr/track, gate = 0.002;
    double sub1 = p(0)*1.6, sub2 = p(1)*1.5, up = p(2)*1.6, dry = p(3);
    for(int i = 0; i < n; i++){
      double x = inCh > 1 ? (in.d[0][i] + (double)in.d[1][i])*0.5 : in.d[0][i];
      l1 += ct*(x - l1); l2 += ct*(l1 - l2); l3 += ct*(l2 - l3); l4 += ct*(l3 - l4);
      double c = l4, a = std::fabs(c); env = a > env ? env + envA*(a - env) : env*envR;
      double h = 0.08*env; hold++;
      if(cmp < 0){ if(c < -h) cmp = 0; } else if(cmp == 0){ if(c > 0){ cmp = 1; if(hold > minHold && env > gate){ hold = 0; ff1 = -ff1; cnt++; if(cnt & 1) ff2 = -ff2; flips++; } } }
      else if(c < -h) cmp = 0;
      double o1 = c*ff1; s1 += cto*(o1 - s1); s2 += cto*(s1 - s2);
      double o2 = a*ff2; s3 += cto2*(o2 - s3); s4 += cto2*(s3 - s4);
      double u = std::fabs(l2); udc += cdc*(u - udc); u -= udc; u1 += cup*(u - u1); u2 += cup*(u1 - u2);
      double y = x*dry + s2*sub1 + s4*sub2 + u2*up;
      for(int c2 = 0; c2 < out.ch; c2++) out.d[c2][i] = (float)y; }
    return true; }
};

// ---------------------------------------------------------------- pitch shifter (np-pitch2)
struct Pitch2 : Proc {
  static const int S = 32768; std::vector<float> buf[2]; int64_t t = 0; struct G { double r; int k, L; } gr[2] = {{0,0,0},{0,0,0}}; bool started = false;
  Pitch2(){ buf[0].assign(S, 0.f); buf[1].assign(S, 0.f); }
  std::vector<PDesc> desc() const override { return {{"semitones",0,-24,24,false},{"cents",0,-100,100,false},{"mix",1,0,1,false},{"grain",40,15,150,false}}; }
  double at(const float* b, double a){ double r = std::fmod(a, (double)S); if(r < 0) r += S; int i0 = (int)r; double f = r - i0; int i1 = i0 + 1; if(i1 >= S) i1 -= S; return b[i0]*(1 - f) + b[i1]*f; }
  double near(const float* b, double a){ double r = std::fmod(std::floor(a + 0.5), (double)S); if(r < 0) r += S; return b[(int)r]; }
  double search(double other, double dn, int range, double ratio, int span){ (void)ratio; const float* b = buf[0].data(); double tt = (double)t; int step = std::max(2, span/128), nj = std::max(4, span/step); int best = 0; double bestS = -1e30;
    auto score = [&](double d){ double c = 0, e = 0; for(int j = 0; j < nj; j++){ double o = (double)j*step, av = near(b, other - o), bv = near(b, tt - d - o); c += av*bv; e += bv*bv; } return c/std::sqrt(e + 1e-9); };
    for(int dd = 0; dd <= range; dd += step){ double s = score(dn + dd); if(s > bestS){ bestS = s; best = dd; } }
    int lo = std::max(0, best - step + 1), hi = std::min(range, best + step - 1), bc = best; for(int dd = lo; dd <= hi; dd++){ if(dd == bc) continue; double s = score(dn + dd); if(s > bestS){ bestS = s; best = dd; } }
    return dn + best; }
  bool process(Bus& in, int inCh, Bus& out, int n) override {
    if(dead) return false; if(!inCh) return true;
    double mix = p(2), ratio = std::pow(2, (p(0) + p(1)/100)/12); int W = std::max(128, (int)std::floor(sr*p(3)/1000*0.95/std::max(1.0, ratio))), H = W >> 1, range = (int)std::floor(W*0.65), span = (int)std::floor(W*std::max(1.0, ratio)); double dn = (ratio > 1 ? (ratio - 1)*W : 0) + 4;
    G& g0 = gr[0]; G& g1 = gr[1];
    if(!started){ started = true; g0.r = t - dn; g0.k = 0; g0.L = W; g1.r = t - dn - (1 - ratio)*H; g1.k = H; g1.L = W; }
    for(int i = 0; i < n; i++){
      for(int c = 0; c < 2; c++) buf[c][t % S] = IN(c)[i];
      t++;
      if(g0.k >= g0.L){ g0.k = 0; g0.L = W; g0.r = t - search(g1.r, dn, range, ratio, span); }
      if(g1.k >= g1.L){ g1.k = 0; g1.L = W; g1.r = t - search(g0.r, dn, range, ratio, span); }
      double w0 = 0.5 - 0.5*std::cos(TWO_PI_T*g0.k/g0.L), w1 = 0.5 - 0.5*std::cos(TWO_PI_T*g1.k/g1.L);
      double a0 = std::min(g0.r, (double)(t - 1)) - 0.5, a1 = std::min(g1.r, (double)(t - 1)) - 0.5;
      for(int c = 0; c < out.ch; c++){ const float* b = buf[c < 2 ? c : 0].data(); double wet = at(b, a0)*w0 + at(b, a1)*w1; out.d[c][i] = (float)(wet*mix + IN(c)[i]*(1 - mix)); }
      g0.r += ratio; g1.r += ratio; g0.k++; g1.k++; }
    return true; }
};

Proc* makeProcTime(const std::string& name){
  if(name == "np-delay") return new Delay(); if(name == "np-taps") return new Taps(); if(name == "np-verb") return new Verb(); if(name == "np-oc2") return new OC2(); if(name == "np-pitch2") return new Pitch2();
  return nullptr; }

} // namespace np
