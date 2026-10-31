// The C++ twins of the worklets in app/worklets_drive.js for the drive pedal family. Ported line by line; the golden test checks them against Chrome.
// Both processors run 4x oversampled through the same half-band stages np-shaper uses, so they add the same delay and a dry path lines up with shDelay().
#include "procs.h"
#include <algorithm>
#include <cstdint>

namespace np {

#define IN(c) (in.d[(c) < inCh ? (c) : 0])

// the half-band stages, the same as procs.cpp's (kept private there)
namespace drv {
struct HBD { int M; std::vector<double> taps; double center; };
static HBD halfband(int N, double beta){
  int M = (N - 1) >> 1; std::vector<double> h(N); auto I0 = [](double x){ double s = 1, t = 1; for(int k = 1; k < 40; k++){ t *= (x/2)/k; s += t*t; } return s; }; double b0 = I0(beta), sum = 0;
  for(int n = 0; n < N; n++){ int m = n - M; double x = m/2.0, sinc = m == 0 ? 1 : std::sin(3.141592653589793*x)/(3.141592653589793*x), r = 2.0*n/(N - 1) - 1; h[n] = 0.5*sinc*I0(beta*std::sqrt(std::max(0.0, 1 - r*r)))/b0; sum += h[n]; }
  for(int n = 0; n < N; n++) h[n] /= sum; HBD d; d.M = M; for(int k = 0; k < N; k += 2) d.taps.push_back(h[k]); d.center = h[M]; return d; }
struct HB {
  const HBD* d; int T, D, L; std::vector<double> ux, ve, vo; int ui = 0, vi = 0; double a = 0, b = 0;
  explicit HB(const HBD* dd) : d(dd){ T = (int)d->taps.size(); D = (d->M + 1) >> 1; L = std::max(T, D + 1); ux.assign(L*2, 0); ve.assign(L*2, 0); vo.assign(L*2, 0); }
  void up(double x){ ui = (ui + 1) % L; ux[ui] = x; ux[ui + L] = x; int base = ui + L; double s = 0; for(int j = 0; j < T; j++) s += d->taps[j]*ux[base - j]; a = 2*s; b = ux[base - (D - 1)]*2*d->center; }
  double down(double e, double o){ vi = (vi + 1) % L; ve[vi] = e; ve[vi + L] = e; vo[vi] = o; vo[vi + L] = o; int base = vi + L; double y = 0; for(int j = 0; j < T; j++) y += d->taps[j]*vo[base - j]; return y + d->center*ve[base - (D - 1)]; }
};
static const HBD& HB1(){ static HBD h = halfband(31, 8); return h; }
static const HBD& HB2(){ static HBD h = halfband(15, 6); return h; }
// one channel's 4x path: up two stages, f on each of the four samples, down two stages
struct Os4 { HB u1, u2, d2, d1; Os4() : u1(&HB1()), u2(&HB2()), d2(&HB2()), d1(&HB1()) {}
  template<class F> double run(double x, F f){ u1.up(x); double a = u1.a, bb = u1.b; u2.up(a); double s0 = f(u2.a), s1 = f(u2.b); double e = d2.down(s0, s1); u2.up(bb); double s2 = f(u2.a), s3 = f(u2.b); double od = d2.down(s2, s3); return d1.down(e, od); } };
}

// ---------------------------------------------------------------- np-tube: one 12AX7 triode stage
struct Tube : Proc {
  struct St { drv::Os4 os; double cap = 0, ps = 0; };
  std::vector<std::unique_ptr<St>> ch;
  std::vector<PDesc> desc() const override { return {{"drive",0.25f,0,1,true},{"bias",0.5f,0,1,true},{"sag",0.3f,0,1,true}}; }
  bool process(Bus& in, int inCh, Bus& out, int n) override {
    if(dead) return false; if(!inCh){ for(int c = 0; c < out.ch; c++) std::memset(out.d[c], 0, sizeof(float)*n); return true; }
    const double g = 1 + std::pow((double)p(0), 1.3)*11, B = -0.44 + (p(1) - 0.5)*0.6, GK = -B, sag = p(2), VK = 1.2, sr4 = sr*4;
    const double i0 = 1 + B/VK, ic0 = i0*std::sqrt(i0), sc = VK/(1.5*std::sqrt(i0));
    const double cUp = 1 - std::exp(-1/(sr4*0.004)), cDn = std::exp(-1/(sr4*0.1)), sA = 1 - std::exp(-1/(sr4*0.015)), sR = 1 - std::exp(-1/(sr4*0.25));
    for(int c = 0; c < out.ch; c++){ while((int)ch.size() <= c) ch.emplace_back(new St()); St& st = *ch[c]; const float* src = IN(c); float* o = out.d[c];
      auto tube = [&](double x){ const double sh = 0.5*st.cap/(st.cap + 1); double v = x*g - sh, ig = 0; const double gc = v - GK; if(gc > 0){ const double cl = gc/(1 + gc*4); v = GK + cl; ig = gc - cl; }
        st.cap = ig > st.cap ? st.cap + (ig - st.cap)*cUp : st.cap*cDn;
        const double t = 1 + (v + B)/VK, ic = t > 0 ? t*std::sqrt(t) : 0, y = (ic - ic0)*sc;
        const double ay = std::fabs(y); st.ps += (ay - st.ps)*(ay > st.ps ? sA : sR); return y/(1 + sag*st.ps*1.5); };
      for(int i = 0; i < n; i++) o[i] = (float)st.os.run(src[i], tube); }
    return true; }
};

// ---------------------------------------------------------------- np-fuzz: a germanium Fuzz Face
struct Fuzz : Proc {
  struct St { drv::Os4 os; double env = 0; };
  std::vector<std::unique_ptr<St>> ch;
  std::vector<PDesc> desc() const override { return {{"fuzz",0.7f,0,1,true},{"bias",0.5f,0,1,true},{"gate",0,0,1,true}}; }
  static double tr(double v){ return v > 0 ? std::tanh(v) : (std::exp(3*v) - 1)/3; }
  bool process(Bus& in, int inCh, Bus& out, int n) override {
    if(dead) return false; if(!inCh){ for(int c = 0; c < out.ch; c++) std::memset(out.d[c], 0, sizeof(float)*n); return true; }
    const double g1 = 2.5, g2 = 2 + std::pow((double)p(0), 1.5)*22, B2 = (p(1) - 0.5)*1.2, gate = p(2), sr4 = sr*4;
    const double eA = 1 - std::exp(-1/(sr4*0.003)), eR = std::exp(-1/(sr4*0.08));
    for(int c = 0; c < out.ch; c++){ while((int)ch.size() <= c) ch.emplace_back(new St()); St& st = *ch[c]; const float* src = IN(c); float* o = out.d[c];
      auto fz = [&](double x){ const double ax = std::fabs(x); st.env = ax > st.env ? st.env + (ax - st.env)*eA : st.env*eR; const double lv = std::min(1.0, st.env*6);
        const double y1 = tr(x*g1*(0.5 + 0.5*lv));
        const double off = B2 - gate*(1 - lv)*3 - lv*0.3; return tr(y1*g2 + off) - tr(off); };
      for(int i = 0; i < n; i++) o[i] = (float)st.os.run(src[i], fz); }
    return true; }
};

Proc* makeProcDrive(const std::string& name){ if(name == "np-tube") return new Tube(); if(name == "np-fuzz") return new Fuzz(); return nullptr; }

} // namespace np
