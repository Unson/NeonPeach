// The C++ twins of the worklets in app/worklets_mod.js for the mod pedal family. Ported line by line; the golden test checks them against Chrome.
#include "procs.h"
#include <algorithm>
#include <cstdint>

namespace np {

static const double TWO_PI_M = 6.283185307179586, PI_M = 3.141592653589793;
#define IN(c) (in.d[(c) < inCh ? (c) : 0])

// ---------------------------------------------------------------- BBD flanger (np-flanger)
struct FlangerM : Proc {
  static const int S = 8192, mask = S - 1;
  std::vector<double> buf[2], dry[2]; int w = 0; double ph = 0, lpz[2] = {0, 0}, cS = -1;
  FlangerM(){ for(int c = 0; c < 2; c++){ buf[c].assign(S, 0.0); dry[c].assign(S, 0.0); } }
  std::vector<PDesc> desc() const override { return {{"rate",0.3f,0.02f,10,true},{"depth",0.6f,0,1,true},{"fb",0.5f,-0.97f,0.97f,true},{"manual",2,0.1f,20,true},{"mix",0.5f,0,1,true},{"model",0,0,2,true},{"polarity",0,0,1,true}}; }
  bool process(Bus& in, int inCh, Bus& out, int n) override {
    if(dead) return false; if(!inCh) return true;
    const int nc = std::min(out.ch, 2), model = (int)p(5);
    static const double FBMAX[3] = {0.8, 0.95, 0.85}, LPHZ[3] = {6000, 9000, 10000}, OCT[3] = {1.4, 1.8, 0};
    const double fbMax = FBMAX[model], lpHz = LPHZ[model], oct = (double)p(1)*OCT[model], lin = model == 2 ? (double)p(1)*0.95 : 0;
    const double center = (double)p(3)*0.001*sr, a = 1 - std::exp(-TWO_PI_M*lpHz/sr), inc = (double)p(0)/sr;
    const double fb = std::max(-fbMax, std::min(fbMax, (double)p(2))), mix = p(4), wetG = mix*(1 - 0.5*std::fabs(fb))*(p(6) > 0.5 ? -1 : 1), dryG = 1 - mix;
    if(cS < 0) cS = center;
    for(int i = 0; i < n; i++){
      ph += inc; if(ph >= 1) ph -= 1; const double tri = ph < 0.5 ? 4*ph - 1 : 3 - 4*ph; const double lfo = model == 0 ? tri*(1.5 - 0.5*tri*tri) : tri;
      cS += (center - cS)*0.002;
      double del = model == 2 ? cS*(1 + lin*lfo) : cS*std::pow(2.0, oct*lfo); if(del < 2) del = 2; double rp = w - del; if(rp < 0) rp += S; const int ri = (int)rp; const double rf = rp - ri; const int rj = (ri + 1) & mask;
      double dd = cS; if(dd < 2) dd = 2; double dp = w - dd; if(dp < 0) dp += S; const int di = (int)dp; const double df = dp - di; const int dj = (di + 1) & mask;
      for(int c = 0; c < nc; c++){
        double* b = buf[c].data(); const double x = IN(c)[i];
        const double y = b[ri]*(1 - rf) + b[rj]*rf; const double z = lpz[c] + a*(y - lpz[c]); lpz[c] = z;
        const double v = x + fb*z; b[w] = std::tanh(v*0.8)/0.8; dry[c][w] = x;
        const double dr = model == 2 ? dry[c][di]*(1 - df) + dry[c][dj]*df : x;
        out.d[c][i] = (float)(dr*dryG + z*wetG); }
      w = (w + 1) & mask; }
    return true; }
};

// ---------------------------------------------------------------- phaser (np-phaser)
struct PhaserM : Proc {
  double x1[2][8] = {{0}}, y1[2][8] = {{0}}, a[8] = {0}, yp[2] = {0, 0}, ph = 0, lamp = 0, cC = -1;
  std::vector<PDesc> desc() const override { return {{"rate",0.5f,0.02f,12,true},{"depth",0.7f,0,1,true},{"center",600,50,5000,true},{"stages",4,2,8,true},{"fb",0.3f,0,1,true},{"mix",0.5f,0,1,true},{"model",0,0,2,true},{"color",0,0,1,true}}; }
  bool process(Bus& in, int inCh, Bus& out, int n) override {
    if(dead) return false; if(!inCh) return true;
    const int nc = std::min(out.ch, 2), model = (int)p(6), st = std::max(2, std::min(8, (int)std::floor(p(3)/2.0 + 0.5)*2)); const double center = p(2), inc = (double)p(0)/sr;
    const double oct = (double)p(1)*(model == 1 ? 2.0 : 1.6), g = std::min(0.92, (double)p(4)*0.8 + (model == 1 && p(7) > 0.5 ? 0.7 : 0));
    const double mix = p(5), trim = 1 - 0.25*mix, wetG = mix*(1 - 0.5*g)*trim, dryG = (1 - mix)*trim;
    const double aUp = 1 - std::exp(-1/(sr*0.003)), aDn = 1 - std::exp(-1/(sr*0.04)), fmax = sr*0.45;
    static const double RV[8] = {0.3, 1, 3.2, 10, 0.3, 1, 3.2, 10}, R1[8] = {1, 1, 1, 1, 1, 1, 1, 1}; const double* R = model == 2 ? RV : R1;
    if(cC < 0) cC = center;
    for(int i = 0; i < n; i++){
      ph += inc; if(ph >= 1) ph -= 1; cC += (center - cC)*0.002;
      double l; if(model == 2){ const double u = (1 + std::sin(TWO_PI_M*ph))/2, bb = u*u*u; lamp += (bb - lamp)*(bb > lamp ? aUp : aDn); l = 2.4*lamp - 0.9; if(l > 1) l = 1; }
      else { const double tri = ph < 0.5 ? 4*ph - 1 : 3 - 4*ph; l = model == 1 ? tri*(1.5 - 0.5*tri*tri) : tri; }
      const double sw = std::pow(2.0, oct*l);
      for(int s = 0; s < st; s++){ double f = cC*R[s]*sw; if(f > fmax) f = fmax; if(f < 20) f = 20; const double t = std::tan(PI_M*f/sr); a[s] = (t - 1)/(t + 1); }
      for(int c = 0; c < nc; c++){ const double x = IN(c)[i]; double* X = x1[c]; double* Y = y1[c]; double v = x + g*yp[c];
        for(int s = 0; s < st; s++){ const double y = a[s]*v + X[s] - a[s]*Y[s]; X[s] = v; Y[s] = y; v = y; }
        yp[c] = v; out.d[c][i] = (float)(x*dryG + v*wetG); } }
    return true; }
};

// ---------------------------------------------------------------- bit crusher 2 (np-crusher2)
struct Crusher2 : Proc {
  int cnt = 0; double hold[2] = {0, 0}; double z[16] = {0};
  std::vector<PDesc> desc() const override { return {{"bits",8,2,16,false},{"rate",1,1,64,false},{"mix",1,0,1,false},{"filter",0,0,1,false}}; }
  bool process(Bus& in, int inCh, Bus& out, int n) override {
    if(dead) return false; if(!inCh) return true;
    const double steps = std::pow(2.0, (double)p(0)); const int rate = (int)p(1); const double mix = p(2); const bool filt = p(3) > 0.5;
    const double w0 = TWO_PI_M*std::min(0.42/rate, 0.45), sn = std::sin(w0), cs = std::cos(w0), al = sn/(2*0.7071), a0 = 1 + al;
    const double b0 = (1 - cs)/2/a0, b1 = (1 - cs)/a0, a1 = -2*cs/a0, a2 = (1 - al)/a0;
    for(int i = 0; i < n; i++){ cnt++; const bool take = cnt >= rate; if(take) cnt = 0;
      for(int c = 0; c < out.ch; c++){
        double x = IN(c)[i]; const int k = c & 1, o = k*8;
        if(filt){ const double y = b0*x + b1*z[o] + b0*z[o+1] - a1*z[o+2] - a2*z[o+3]; z[o+1] = z[o]; z[o] = x; z[o+3] = z[o+2]; z[o+2] = y; x = y; }
        if(take){ const double r = x*steps; hold[k] = std::floor(r + 0.5)/steps; }   // Math.round
        double h = hold[k];
        if(filt){ const double y = b0*h + b1*z[o+4] + b0*z[o+5] - a1*z[o+6] - a2*z[o+7]; z[o+5] = z[o+4]; z[o+4] = h; z[o+7] = z[o+6]; z[o+6] = y; h = y; }
        out.d[c][i] = (float)(h*mix + x*(1 - mix)); } }
    return true; }
};

Proc* makeProcMod(const std::string& name){
  if(name == "np-flanger") return new FlangerM(); if(name == "np-phaser") return new PhaserM(); if(name == "np-crusher2") return new Crusher2();
  return nullptr; }

} // namespace np
