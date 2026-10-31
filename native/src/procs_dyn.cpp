// The C++ twins of the worklets in app/worklets_dyn.js for the dyn pedal family. Ported line by line; the golden test checks them against Chrome.
#include "procs.h"
#include <algorithm>
#include <cstdint>

namespace np {

static const double PI_D = 3.141592653589793, TWO_PI_D = 6.283185307179586;
static inline double clampd(double v, double a, double b){ return v < a ? a : (v > b ? b : v); }
static inline double sgn(double v){ return v < 0 ? -1 : (v > 0 ? 1 : 0); }
#define IN(c) (in.d[(c) < inCh ? (c) : 0])

// One step of a 2-pole state-variable filter (Zavalishin TPT). g = tan(pi*fc/sr), k = 1/Q.
struct SV { double ic1 = 0, ic2 = 0, lp = 0, bp = 0, hp = 0; };
static inline void svfStep(SV& st, double x, double g, double k){ double a1 = 1/(1 + g*(g + k)), a2 = g*a1, a3 = g*a2, v3 = x - st.ic2, v1 = a1*st.ic1 + a2*v3, v2 = st.ic2 + a2*st.ic1 + a3*v3;
  st.ic1 = 2*v1 - st.ic1; st.ic2 = 2*v2 - st.ic2; st.lp = v2; st.bp = v1; st.hp = x - k*v1 - v2; }
static inline double svfG(double fc, double sr){ return std::tan(PI_D*clampd(fc, 10, sr*0.45)/sr); }
static inline double otaNrm(double kd){ return 0.35/std::tanh(0.35*kd); }
static inline double otaDrive(double x, double kd, double nrm){ return std::tanh(kd*x)*nrm; }

// ---------------------------------------------------------------- Super Squeeze
struct PComp : Proc {
  double env = 0, e2 = 0, gl = 1, hz = 0, hx = 0, ms = 0, minGr = 0; int tick = 0;
  std::vector<PDesc> desc() const override { return {{"threshold",-22,-80,0,true},{"ratio",4,1,100,true},{"attack",8,0.05f,200,true},{"release",120,5,3000,true},{"knee",8,0,30,true},{"makeup",4,-24,36,true},{"mix",1,0,1,true},{"schpf",80,10,1000,true},{"rms",0,0,1,true},{"auto",1,0,1,true},{"type",3,0,3,true}}; }
  bool process(Bus& in, int inCh, Bus& out, int n) override {
    if(dead) return false; if(!inCh) return true;
    int nc = out.ch, type = (int)std::lround(p(10)); double T = p(0), R0 = std::max(1.f, p(1)), mix = p(6); bool rms = p(8) > 0.5;
    double R = type == 0 ? 1 + (R0 - 1)*2 : R0;
    double W = type == 1 ? std::max(p(4), 10.f) : p(4);
    double mk = std::pow(10, (p(5) + p(9)*0.6*std::max(0.0, -T)*(1 - 1/R0))/20);
    double atkMs = p(2), relMs = p(3); if(type == 1) atkMs = std::max(atkMs, 3.0); else if(type == 2) atkMs *= 0.1; else if(type == 0) relMs *= 3;
    bool fb = type == 0 || type == 2;
    double aA = std::exp(-1/(sr*atkMs/1000)), aR = std::exp(-1/(sr*relMs/1000)), hp = std::exp(-TWO_PI_D*p(7)/sr), aM = std::exp(-1/(sr*0.01));
    double cA = fb ? std::min(1 - aA, 1/R) : 1 - aA, cR = 1 - aR;
    double cM = 1 - std::exp(-1/(sr*relMs*4/1000)), cM2 = 1 - std::exp(-1/(sr*relMs*10/1000));
    double sl = 1/R - 1;
    for(int i = 0; i < n; i++){
      double s = 0; for(int c = 0; c < inCh; c++) s += in.d[c][i]; s /= inCh;
      double h = hp*(hz + s - hx); hx = s; hz = h;
      double lv; if(rms){ ms = aM*ms + (1 - aM)*h*h; lv = std::sqrt(ms)*1.414; } else lv = std::fabs(h);
      if(fb) lv *= gl;
      double x = 20*std::log10(lv + 1e-9), y, d = x - T;
      if(2*d < -W) y = x; else if(W > 0 && 2*std::fabs(d) <= W){ double q = d + W/2; y = x + sl*q*q/(2*W); } else y = T + d/R;
      double tgt = y - x; if(fb) tgt *= R;
      double e;
      if(type == 0){ double gt = std::pow(10, tgt/20); gl = gt < gl ? gl + cA*(gt - gl) : gl + cR*(gt - gl); e = 20*std::log10(gl); }
      else if(type == 1){ double e1 = env - e2;
        if(tgt < env){ e1 += cA*(tgt - env); e2 += cM*(0.5*env - e2); }
        else { e2 += cM2*(0.5*tgt - e2); double t1 = std::min(0.0, tgt - e2); e1 += cR*(t1 - e1); }
        env = e1 + e2; e = env; gl = std::pow(10, e/20); }
      else { env = tgt < env ? env + cA*(tgt - env) : env + cR*(tgt - env); e = env; gl = std::pow(10, e/20); }
      if(e < minGr) minGr = e;
      double g = gl*mk;
      for(int c = 0; c < nc; c++){ double xx = IN(c)[i], yy = xx*g; if(type == 0) yy = std::tanh(yy*0.4)/0.4; else if(type == 2) yy = std::tanh(yy*0.3)/0.3; out.d[c][i] = (float)(yy*mix + xx*(1 - mix)); } }
    tick += n; if(tick > sr/30){ tick = 0; auto m = Value::obj(); m->set("gr", Value::num(minGr)); post(m); minGr = 0; }
    return true; }
};

// ---------------------------------------------------------------- Peach Gate
struct PGate : Proc {
  double env = 0, g = 0, hold = 0; bool open = false;
  std::vector<PDesc> desc() const override { return {{"threshold",-55,-90,0,true},{"attack",1,0.1f,100,true},{"release",120,5,2000,true},{"hold",40,0,1000,true},{"range",-80,-90,0,true},{"hyst",6,0,20,true},{"decay",0,0,100,true}}; }
  bool process(Bus& in, int inCh, Bus& out, int n) override {
    if(dead) return false; if(!inCh) return true;
    double thrO = std::pow(10, p(0)/20), cdB = (double)p(0) - p(5), thrC = std::pow(10, cdB/20), rdB = p(4), d = p(6)/100;
    double envRel = std::exp(-1/(sr*0.06)), atk = std::exp(-1/(sr*p(1)/1000)), rel = std::exp(-1/(sr*p(2)/1000)), holdS = sr*p(3)/1000;
    for(int i = 0; i < n; i++){
      double a = 0; for(int c = 0; c < inCh; c++){ double v = std::fabs(in.d[c][i]); if(v > a) a = v; }
      env = a > env ? a : env*envRel;
      if(env > thrO){ open = true; hold = holdS; } else if(env < thrC){ if(hold > 0) hold--; else open = false; }
      double tg; if(open) tg = 1; else { double eDB = std::max(rdB, std::min(0.0, 4*(20*std::log10(env + 1e-9) - cdB))); tg = std::pow(10, (rdB*(1 - d) + eDB*d)/20); }
      g = tg > g ? tg + (g - tg)*atk : tg + (g - tg)*rel;
      for(int c = 0; c < out.ch; c++) out.d[c][i] = (float)(IN(c)[i]*g); }
    return true; }
};

// ---------------------------------------------------------------- Brickwall
struct PLimit : Proc {
  double env = 0, minG = 1, hot = 0; int tick = 0;
  std::vector<PDesc> desc() const override { return {{"ceiling",-1,-30,0,true},{"release",80,5,2000,true},{"input",0,-24,36,true},{"type",0,0,1,true}}; }
  bool process(Bus& in, int inCh, Bus& out, int n) override {
    if(dead) return false; if(!inCh){ for(int c = 0; c < out.ch; c++) std::memset(out.d[c], 0, sizeof(float)*n); return true; }
    double cl = std::pow(10, p(0)/20), gi = std::pow(10, p(2)/20), relMs = p(1), rel = std::exp(-1/(sr*relMs/1000)), atk = std::exp(-1/(sr*0.0004)), k = 0.9*cl, r = cl - k; bool soft = p(3) > 0.5;
    double cH = 1 - std::exp(-1/(sr*0.2)), cH2 = 1 - std::exp(-1/(sr*1.0)), cdB = 20*std::log10(cl), W = 6;
    for(int i = 0; i < n; i++){ double pk = 0; for(int c = 0; c < inCh; c++){ double v = std::fabs(in.d[c][i]*gi); if(v > pk) pk = v; }
      double g;
      if(soft){ double rl = std::exp(-1/(sr*relMs*(1 + 2*hot)/1000)); env = pk > env ? atk*env + (1 - atk)*pk : rl*env + (1 - rl)*pk;
        double x = 20*std::log10(env + 1e-9), dd = x - cdB, y; if(2*dd < -W) y = x; else if(2*dd <= W){ double q = dd + W/2; y = x - q*q/(2*W); } else y = cdB;
        g = std::pow(10, (y - x)/20); hot += g < 0.999 ? cH*(1 - hot) : -cH2*hot; }
      else { env = pk > env ? atk*env + (1 - atk)*pk : rel*env + (1 - rel)*pk; g = env > cl ? cl/env : 1; }
      if(g < minG) minG = g;
      for(int c = 0; c < out.ch; c++){ double v = IN(c)[i]*gi*g, a = std::fabs(v); if(a > k) v = sgn(v)*(k + r*std::tanh((a - k)/r)); out.d[c][i] = (float)v; } }
    tick += n; if(tick > sr/30){ tick = 0; auto m = Value::obj(); m->set("gr", Value::num(20*std::log10(minG))); post(m); minG = 1; }
    return true; }
};

// ---------------------------------------------------------------- Envelope Filter
struct PEnvF : Proc {
  double env = 0, sm = 0; SV f[2];
  std::vector<PDesc> desc() const override { return {{"sens",0.5f,0,1,true},{"fmin",120,40,2000,true},{"range",0.7f,0,1,true},{"q",4,0.5f,20,true},{"attack",8,1,200,true},{"decay",180,10,1500,true},{"type",0,0,2,true},{"dir",0,0,1,true},{"mix",1,0,1,true},{"gain",0,0,100,true}}; }
  bool process(Bus& in, int inCh, Bus& out, int n) override {
    if(dead) return false; if(!inCh) return true;
    double atk = std::exp(-1/(sr*p(4)/1000)), dec = std::exp(-1/(sr*p(5)/1000));
    double fmin = p(1), fmax = std::min(fmin*std::pow(40.0, (double)p(2)), 9000.0), q = p(3), dir = p(7), mix = p(8), sens = std::pow(10, p(0)*3); int type = (int)std::lround(p(6));
    double qn = q/20, k0 = 1/q - 0.08*std::pow(qn, 8), kn = 0.15*qn*qn;
    double drv = p(9), kd = drv/100*6, nrm = drv > 0 ? otaNrm(kd) : 1;
    for(int i = 0; i < n; i++){
      double a = 0; for(int c = 0; c < inCh; c++){ double v = std::fabs(in.d[c][i]); if(v > a) a = v; }
      env = a > env ? a + (env - a)*atk : a + (env - a)*dec;
      double e = clampd(env*sens*0.3, 0, 1); e = std::sqrt(e); if(dir > 0.5) e = 1 - e;
      double fc = fmin*std::pow(fmax/fmin, e); sm += 0.02*(fc - sm);
      double g = svfG(sm, sr);
      for(int c = 0; c < out.ch; c++){ double x = IN(c)[i]; SV& st = f[c < 2 ? c : 0]; double xd = drv > 0 ? otaDrive(x, kd, nrm) : x;
        svfStep(st, xd, g, k0 + kn*st.ic1*st.ic1);
        double y = type == 0 ? st.lp : (type == 1 ? st.bp*1.5 : st.hp);
        out.d[c][i] = (float)(y*mix + x*(1 - mix)); } }
    return true; }
};

// ---------------------------------------------------------------- Pedal Wah
struct WahM { double fs, qs, lpg, bpg, hpg, og; };
static const WahM WAH_MODELS[3] = { {1, 1, 0.5, 1.0, 0, 0.45}, {0.75, 0.8, 1.0, 0.6, 0, 0.6}, {1.15, 1.25, 0.35, 1.1, 0.25, 0.4} };
struct Wah : Proc {
  double ps = 0.5; SV f[2];
  std::vector<PDesc> desc() const override { return {{"pos",0.5f,0,1,true},{"q",5,0.5f,15,true},{"fmin",350,100,1000,true},{"fmax",2200,800,5000,true},{"mix",1,0,1,true},{"model",0,0,2,true}}; }
  bool process(Bus& in, int inCh, Bus& out, int n) override {
    if(dead) return false; if(!inCh) return true;
    const WahM& m = WAH_MODELS[std::max(0, std::min(2, (int)std::lround(p(5))))]; double pos = p(0), q = p(1), fmin = p(2), fmax = std::max((double)p(3), fmin*1.01), mix = p(4), cp = 1 - std::exp(-1/(sr*0.004));
    for(int i = 0; i < n; i++){
      ps += cp*(pos - ps);
      double fc = fmin*std::pow(fmax/fmin, ps)*m.fs, g = svfG(fc, sr), k = 1/(q*m.qs*(0.7 + 0.6*ps));
      for(int c = 0; c < out.ch; c++){ double x = IN(c)[i]; SV& st = f[c < 2 ? c : 0]; svfStep(st, x, g, k);
        double y = (st.lp*m.lpg + st.bp*m.bpg + st.hp*m.hpg)*m.og; out.d[c][i] = (float)(y*mix + x*(1 - mix)); } }
    return true; }
};

// ---------------------------------------------------------------- Multi Filter
struct Ladder : Proc {
  struct L4 { double s1 = 0, s2 = 0, s3 = 0, s4 = 0, t1 = 0, t2 = 0, t3 = 0, t4 = 0, s4p = 0, u = 0; };
  double sf = 800; SV f[2]; L4 l[2];
  std::vector<PDesc> desc() const override { return {{"type",0,0,3,true},{"freq",800,40,12000,true},{"q",1,0.3f,20,true},{"mix",1,0,1,true},{"model",0,0,1,true},{"drive",0,0,100,true}}; }
  bool process(Bus& in, int inCh, Bus& out, int n) override {
    if(dead) return false; if(!inCh) return true;
    int type = (int)std::lround(p(0)); double freq = p(1), q = p(2), mix = p(3); bool ladder = p(4) > 0.5; double drv = p(5), kd = drv/100*6, nrm = drv > 0 ? otaNrm(kd) : 1, cf = 1 - std::exp(-1/(sr*0.002));
    double kS = 1/(type < 2 ? std::pow(10, q/20) : q);
    double r = clampd((q - 0.3)/19.7, 0, 1), kL = 4.2*r, comp = 1 + kL*0.35;
    for(int i = 0; i < n; i++){
      sf += cf*(freq - sf);
      for(int c = 0; c < out.ch; c++){ double x = IN(c)[i]; double xd = drv > 0 ? otaDrive(x, kd, nrm) : x, y;
        if(ladder){ L4& L = l[c < 2 ? c : 0]; double fc = clampd(sf, 20, sr*0.22), gL = 1 - std::exp(-PI_D*fc/sr);
          for(int s = 0; s < 2; s++){ double u = xd - kL*0.5*(L.s4 + L.s4p); L.u = u; L.s4p = L.s4; double t0 = std::tanh(u);
            L.s1 += gL*(t0 - L.t1); L.t1 = std::tanh(L.s1); L.s2 += gL*(L.t1 - L.t2); L.t2 = std::tanh(L.s2); L.s3 += gL*(L.t2 - L.t3); L.t3 = std::tanh(L.s3); L.s4 += gL*(L.t3 - L.t4); L.t4 = std::tanh(L.s4); }
          y = type == 0 ? L.s4 : type == 1 ? L.u - 4*L.s1 + 6*L.s2 - 4*L.s3 + L.s4 : type == 2 ? 4*(L.s2 - 2*L.s3 + L.s4) : L.u - 2*L.s1 + 2*L.s2; y *= comp; }
        else { SV& st = f[c < 2 ? c : 0]; svfStep(st, xd, svfG(sf, sr), kS); y = type == 0 ? st.lp : type == 1 ? st.hp : type == 2 ? kS*st.bp : xd - kS*st.bp; }
        out.d[c][i] = (float)(y*mix + x*(1 - mix)); } }
    return true; }
};

Proc* makeProcDyn(const std::string& name){
  if(name == "np-pcomp") return new PComp(); if(name == "np-pgate") return new PGate(); if(name == "np-plimit") return new PLimit();
  if(name == "np-penvf") return new PEnvF(); if(name == "np-wah") return new Wah(); if(name == "np-ladder") return new Ladder();
  return nullptr; }

} // namespace np
