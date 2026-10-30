// The processors, ported line by line from worklets.js and worklets2.js.
#include "procs.h"
#include <algorithm>
#include <cstdint>

namespace np {

static const double TWO_PI = 6.283185307179586;
static inline double clampd(double v, double a, double b){ return v < a ? a : (v > b ? b : v); }
double Proc::time() const { return node->cx.now(); }

struct SVF {
  double ic1 = 0, ic2 = 0, lp = 0, bp = 0, hp = 0;
  SVF& run(double x, double fc, double q, double sr){
    double g = std::tan(3.141592653589793*clampd(fc, 10, sr*0.45)/sr), k = 1/std::max(q, 0.2);
    double a1 = 1/(1 + g*(g + k)), a2 = g*a1, a3 = g*a2, v3 = x - ic2, v1 = a1*ic1 + a2*v3, v2 = ic2 + a2*ic1 + a3*v3;
    ic1 = 2*v1 - ic1; ic2 = 2*v2 - ic2; lp = v2; bp = v1; hp = x - k*v1 - v2; return *this; }
};
#define IN(c) (in.d[(c) < inCh ? (c) : 0])

// ---------------------------------------------------------------- gate
struct Gate : Proc {
  double env = 0, g = 0, hold = 0; bool open = false;
  std::vector<PDesc> desc() const override { return {{"threshold",-55,-90,0,false},{"attack",1,0.1f,100,false},{"release",120,5,2000,false},{"hold",40,0,1000,false},{"range",-80,-90,0,false}}; }
  bool process(Bus& in, int inCh, Bus& out, int n) override {
    if(dead) return false; if(!inCh) return true;
    double thr = std::pow(10, p(0)/20), floor = std::pow(10, p(4)/20), envRel = std::exp(-1/(sr*0.01)), atk = std::exp(-1/(sr*p(1)/1000)), rel = std::exp(-1/(sr*p(2)/1000)), holdS = sr*p(3)/1000;
    for(int i = 0; i < n; i++){
      double a = 0; for(int c = 0; c < inCh; c++){ double v = std::fabs(in.d[c][i]); if(v > a) a = v; }
      env = a > env ? a : env*envRel;
      if(env > thr){ open = true; hold = holdS; } else if(env < thr*0.5){ if(hold > 0) hold--; else open = false; }
      double t = open ? 1 : floor; g = t > g ? t + (g - t)*atk : t + (g - t)*rel;
      for(int c = 0; c < out.ch; c++) out.d[c][i] = (float)(IN(c)[i]*g); }
    return true; }
};

// ---------------------------------------------------------------- octave
struct Octave : Proc {
  double z1 = 0, z2 = 0, prev = 0, ff1 = 1, ff2 = 1, env = 0, s1 = 0, s2 = 0, s3 = 0, s4 = 0, dcx = 0; int cnt = 0;
  std::vector<PDesc> desc() const override { return {{"sub1",0.7f,0,1,false},{"sub2",0,0,1,false},{"up",0,0,1,false},{"dry",1,0,1,false},{"tone",600,100,4000,false},{"track",300,100,800,false}}; }
  double lpc(double fc){ return 1 - std::exp(-TWO_PI*fc/sr); }
  bool process(Bus& in, int inCh, Bus& out, int n) override {
    if(dead) return false; if(!inCh) return true;
    double ct = lpc(p(5)), cto = lpc(p(4)), envA = lpc(60), envR = std::exp(-1/(sr*0.08));
    for(int i = 0; i < n; i++){
      double x = inCh > 1 ? (in.d[0][i] + (double)in.d[1][i])*0.5 : in.d[0][i];
      z1 += ct*(x - z1); z2 += ct*(z1 - z2); double f = z2;
      if(prev <= 0 && f > 0){ ff1 = -ff1; cnt++; if(cnt & 1) ff2 = -ff2; }
      prev = f; double a = std::fabs(x); env = a > env ? env + envA*(a - env) : env*envR;
      double sub1 = ff1*env, sub2 = ff2*env; s1 += cto*(sub1 - s1); s2 += cto*(s1 - s2); s3 += cto*(sub2 - s3); s4 += cto*(s3 - s4);
      double up = std::fabs(x)*2; dcx += 0.002*(up - dcx); up -= dcx;
      double y = x*p(3) + s2*p(0)*1.6 + s4*p(1)*1.6 + up*p(2);
      for(int c = 0; c < out.ch; c++) out.d[c][i] = (float)y; }
    return true; }
};

// ---------------------------------------------------------------- pitch shifter
struct Pitch : Proc {
  static const int S = 16384; std::vector<float> buf[2]; int w = 0; double ph = 0;
  Pitch(){ buf[0].assign(S, 0.f); buf[1].assign(S, 0.f); }
  std::vector<PDesc> desc() const override { return {{"semitones",0,-24,24,false},{"cents",0,-100,100,false},{"mix",1,0,1,false},{"grain",70,20,150,false}}; }
  bool process(Bus& in, int inCh, Bus& out, int n) override {
    if(dead) return false; if(!inCh) return true;
    double ratio = std::pow(2, (p(0) + p(1)/100)/12); double G = std::min((double)S/2, std::floor(sr*p(3)/1000)); double mix = p(2);
    for(int i = 0; i < n; i++){
      for(int c = 0; c < 2; c++) buf[c][w] = IN(c)[i];
      ph += (1 - ratio); while(ph < 0) ph += G; while(ph >= G) ph -= G;
      double d1 = ph, d2 = std::fmod(ph + G/2, G), w1 = std::sin(3.141592653589793*d1/G), w2 = std::sin(3.141592653589793*d2/G);
      for(int c = 0; c < out.ch; c++){ const std::vector<float>& b = buf[c < 2 ? c : 0];
        double r1 = w - d1 - 2; while(r1 < 0) r1 += S; int i1 = (int)r1; double f1 = r1 - i1; double v1 = b[i1]*(1 - f1) + b[(i1 + 1) % S]*f1;
        double r2 = w - d2 - 2; while(r2 < 0) r2 += S; int i2 = (int)r2; double f2 = r2 - i2; double v2 = b[i2]*(1 - f2) + b[(i2 + 1) % S]*f2;
        out.d[c][i] = (float)((v1*w1 + v2*w2)*mix + IN(c)[i]*(1 - mix)); }
      w = (w + 1) % S; }
    return true; }
};

// ---------------------------------------------------------------- envelope filter
struct EnvFilter : Proc {
  double env = 0, sm = 0; SVF f[2];
  std::vector<PDesc> desc() const override { return {{"sens",0.5f,0,1,false},{"fmin",120,40,2000,false},{"range",0.7f,0,1,false},{"q",4,0.5f,20,false},{"attack",8,1,200,false},{"decay",180,10,1500,false},{"type",0,0,2,false},{"dir",0,0,1,false},{"mix",1,0,1,false}}; }
  bool process(Bus& in, int inCh, Bus& out, int n) override {
    if(dead) return false; if(!inCh) return true;
    double atk = std::exp(-1/(sr*p(4)/1000)), dec = std::exp(-1/(sr*p(5)/1000)), fmin = p(1), fmax = std::min(fmin*std::pow(40.0, (double)p(2)), 9000.0), q = p(3), dir = p(7), mix = p(8); int type = (int)p(6);
    double sens = std::pow(10, p(0)*3);
    for(int i = 0; i < n; i++){
      double a = 0; for(int c = 0; c < inCh; c++){ double v = std::fabs(in.d[c][i]); if(v > a) a = v; }
      env = a > env ? a + (env - a)*atk : a + (env - a)*dec;
      double e = clampd(env*sens*0.3, 0, 1); e = std::sqrt(e); if(dir > 0.5) e = 1 - e;
      double fc = fmin*std::pow(fmax/fmin, e); sm += 0.02*(fc - sm);
      for(int c = 0; c < out.ch; c++){ double x = IN(c)[i]; SVF& s = f[c < 2 ? c : 0].run(x, sm, q, sr); double y = type == 0 ? s.lp : (type == 1 ? s.bp*1.5 : s.hp); out.d[c][i] = (float)(y*mix + x*(1 - mix)); } }
    return true; }
};

// ---------------------------------------------------------------- synth
struct Synth : Proc {
  double z1 = 0, z2 = 0, prev = 0, freq = 0, cur = 0, ph = 0, ph2 = 0, phs = 0, env = 0, fenv = 0; int since = 0; int periods[3] = {0,0,0}; int pi = 0; SVF svf;
  std::vector<PDesc> desc() const override { return {{"wave",0,0,3,false},{"octave",0,-2,1,false},{"sub",0.3f,0,1,false},{"detune",0,0,50,false},{"cutoff",400,60,8000,false},{"res",3,0.5f,15,false},{"envamt",0.6f,0,1,false},{"glide",20,0,500,false},{"attack",5,1,300,false},{"release",120,10,1500,false},{"mix",0.5f,0,1,false},{"gate",-45,-80,-10,false}}; }
  static double blep(double t, double dt){ if(t < dt){ t /= dt; return t + t - t*t - 1; } else if(t > 1 - dt){ t = (t - 1)/dt; return t*t + t + t + 1; } return 0; }
  bool process(Bus& in, int inCh, Bus& out, int n) override {
    if(dead) return false; if(!inCh) return true;
    double ct = 1 - std::exp(-TWO_PI*450/sr), gate = std::pow(10, p(11)/20), atk = std::exp(-1/(sr*p(8)/1000)), rel = std::exp(-1/(sr*p(9)/1000));
    double glide = p(7) > 0 ? 1 - std::exp(-1/(sr*p(7)/1000)) : 1; int wave = (int)p(0); double oct = std::pow(2, (int)p(1)), mix = p(10), det = p(3), minP = sr/400, maxP = sr/25;
    for(int i = 0; i < n; i++){
      double x = inCh > 1 ? (in.d[0][i] + (double)in.d[1][i])*0.5 : in.d[0][i];
      z1 += ct*(x - z1); z2 += ct*(z1 - z2); double f = z2; since++;
      double a = std::fabs(x); env = a > env ? a + (env - a)*atk : a + (env - a)*rel;
      if(prev <= 0 && f > 0){
        if(since > minP && since < maxP && env > gate){ periods[pi] = since; pi = (pi + 1) % 3; int s[3] = {periods[0], periods[1], periods[2]}; std::sort(s, s + 3); if(s[0] > 0) freq = sr/s[1]; }
        since = 0; }
      prev = f;
      if(freq > 0) cur += glide*(freq - cur);
      double fr = cur*oct, dt = fr/sr, dt2 = fr*(1 + det/1000)/sr, dts = dt*0.5;
      ph += dt; if(ph >= 1) ph -= 1; ph2 += dt2; if(ph2 >= 1) ph2 -= 1; phs += dts; if(phs >= 1) phs -= 1;
      double o;
      if(wave == 0){ o = (2*ph - 1) - blep(ph, dt); if(det > 0) o = (o + (2*ph2 - 1) - blep(ph2, dt2))*0.6; }
      else if(wave == 1) o = (ph < 0.5 ? 1 : -1) + blep(ph, dt) - blep(std::fmod(ph + 0.5, 1.0), dt);
      else if(wave == 2) o = (ph < 0.25 ? 1 : -1) + blep(ph, dt) - blep(std::fmod(ph + 0.75, 1.0), dt);
      else o = std::sin(TWO_PI*ph);
      double sq = phs < 0.5 ? 1 : -1; o += sq*p(2);
      double amp = clampd((env - gate)*6, 0, 1); fenv += 0.003*(amp - fenv);
      double fc = p(4)*std::pow(16.0, fenv*p(6)); double y = svf.run(o*0.5, fc, p(5), sr).lp*amp;
      for(int c = 0; c < out.ch; c++) out.d[c][i] = (float)(y*mix + IN(c)[i]*(1 - mix)); }
    return true; }
};

// ---------------------------------------------------------------- bit crusher
struct Crusher : Proc {
  int cnt = 0; double hold[2] = {0, 0};
  std::vector<PDesc> desc() const override { return {{"bits",8,2,16,false},{"rate",1,1,64,false},{"mix",1,0,1,false}}; }
  bool process(Bus& in, int inCh, Bus& out, int n) override {
    if(dead) return false; if(!inCh) return true;
    double steps = std::pow(2, (double)p(0)); int rate = (int)p(1); double mix = p(2);
    for(int i = 0; i < n; i++){ cnt++; bool take = cnt >= rate; if(take) cnt = 0;
      for(int c = 0; c < out.ch; c++){ double x = IN(c)[i]; if(take) hold[c & 1] = std::nearbyint(x*steps + 0.0)/steps; if(take){ double r = x*steps; hold[c & 1] = std::floor(r + 0.5)/steps; } out.d[c][i] = (float)(hold[c & 1]*mix + x*(1 - mix)); } }
    return true; }
};

// ---------------------------------------------------------------- looper
struct Looper : Proc {
  int64_t max; std::unique_ptr<float[]> buf[2]; std::vector<float> undo[2]; bool hasUndo = false;
  int64_t len = 0, pos = 0; double fpos = 0; std::string state = "empty"; bool rev = false, half = false; int tick = 0;
  Looper(){ max = 0; }
  void init(const ValueP&) override { max = (int64_t)std::floor(sr*180); }
  std::vector<PDesc> desc() const override { return {{"level",1,0,2,false},{"feedback",1,0,1,false}}; }
  void snap(){ for(int c = 0; c < 2; c++) undo[c].assign(buf[c].get(), buf[c].get() + len); hasUndo = true; }
  void report(){ auto m = Value::obj(); m->set("state", Value::str(state)); m->set("len", Value::num((double)len)); m->set("pos", Value::num((double)pos)); m->set("sr", Value::num(sr)); m->set("reverse", Value::boolean(rev)); m->set("half", Value::boolean(half)); m->set("hasUndo", Value::boolean(hasUndo)); post(m); }
  void message(const ValueP& m, std::shared_ptr<void>) override {
    std::string cmd = m->strOr("cmd", ""); const std::string s = state;
    if(cmd == "kill"){ dead = true; buf[0].reset(); buf[1].reset(); undo[0].clear(); undo[1].clear(); return; }
    if(cmd == "rec"){
      if(s == "empty"){ if(!buf[0]){ buf[0].reset(new float[max]); buf[1].reset(new float[max]); } state = "rec"; len = 0; pos = 0; }
      else if(s == "rec"){ len = pos; pos = 0; state = "play"; }
      else if(s == "play"){ snap(); state = "over"; }
      else if(s == "over") state = "play";
      else if(s == "stop"){ snap(); pos = 0; fpos = 0; state = "over"; } }
    else if(cmd == "play"){ if(s == "rec"){ len = pos; pos = 0; state = "play"; } else if(len > 0){ if(s == "over") state = "play"; else if(s == "stop"){ pos = 0; fpos = 0; state = "play"; } } }
    else if(cmd == "stop"){ if(s == "rec"){ len = pos; state = "stop"; } else if(len > 0) state = "stop"; }
    else if(cmd == "clear"){ state = "empty"; len = 0; pos = 0; fpos = 0; undo[0].clear(); undo[1].clear(); hasUndo = false; buf[0].reset(); buf[1].reset(); }
    else if(cmd == "undo"){ if(hasUndo){ for(int c = 0; c < 2; c++) std::memcpy(buf[c].get(), undo[c].data(), sizeof(float)*std::min<int64_t>(len, undo[c].size())); undo[0].clear(); undo[1].clear(); hasUndo = false; } }
    else if(cmd == "reverse") rev = !rev;
    else if(cmd == "half") half = !half;
    report(); }
  bool process(Bus& in, int inCh, Bus& out, int n) override {
    if(dead) return false; double lvl = p(0), fb = p(1); bool hasIn = inCh > 0;
    for(int i = 0; i < n; i++){
      float xL = hasIn ? in.d[0][i] : 0, xR = hasIn ? IN(1)[i] : 0; float lL = 0, lR = 0;
      if(state == "rec"){ if(pos < max){ buf[0][pos] = xL; buf[1][pos] = xR; pos++; } else { len = pos; pos = 0; state = "play"; } }
      else if((state == "play" || state == "over") && len > 0){
        double rp = half ? fpos : (double)pos; int64_t idx = rev ? (len - 1 - (int64_t)std::floor(rp)) : (int64_t)std::floor(rp); idx = ((idx % len) + len) % len;
        lL = buf[0][idx]; lR = buf[1][idx];
        if(state == "over"){ buf[0][idx] = (float)(lL*fb + xL); buf[1][idx] = (float)(lR*fb + xR); }
        if(half){ fpos += 0.5; if(fpos >= len) fpos -= len; pos = (int64_t)std::floor(fpos); } else { pos++; if(pos >= len) pos = 0; fpos = (double)pos; } }
      out.d[0][i] = (float)(xL + lL*lvl); if(out.ch > 1) out.d[1][i] = (float)(xR + lR*lvl); }
    tick += n; if(tick > sr/15){ tick = 0; report(); }
    return true; }
};

// ---------------------------------------------------------------- recorder
struct Recorder : Proc {
  bool on = false; std::vector<std::vector<float>> chunks[2]; size_t fill = 0;
  void push(int c, const float* s, int n){ auto& v = chunks[c]; if(v.empty() || v.back().size() + n > v.back().capacity()){ v.emplace_back(); v.back().reserve(48000*2); } v.back().insert(v.back().end(), s, s + n); }
  void message(const ValueP& m, std::shared_ptr<void>) override {
    std::string cmd = m->strOr("cmd", "");
    if(cmd == "kill"){ dead = true; on = false; chunks[0].clear(); chunks[1].clear(); return; }
    if(cmd == "start"){ chunks[0].clear(); chunks[1].clear(); on = true; }
    else if(cmd == "stop"){ on = false; std::vector<float> L, R; for(auto& k : chunks[0]) L.insert(L.end(), k.begin(), k.end()); for(auto& k : chunks[1]) R.insert(R.end(), k.begin(), k.end());
      auto o = Value::obj(); o->set("done", Value::boolean(true)); o->set("L", Value::f32(std::move(L))); o->set("R", Value::f32(std::move(R))); o->set("sr", Value::num(sr)); post(o); chunks[0].clear(); chunks[1].clear(); } }
  bool process(Bus& in, int inCh, Bus& out, int n) override { if(dead) return false; if(on && inCh){ push(0, in.d[0], n); push(1, IN(1), n); } (void)out; return true; }
};

// ---------------------------------------------------------------- meter
struct Meter : Proc {
  double peak = 0; int tick = 0;
  bool process(Bus& in, int inCh, Bus& out, int n) override { (void)out;
    if(inCh){ for(int c = 0; c < inCh; c++) for(int i = 0; i < n; i++){ double v = std::fabs(in.d[c][i]); if(v > peak) peak = v; } tick += n; if(tick > sr/30){ post(Value::num(peak)); peak = 0; tick = 0; } }
    return true; }
};

// ---------------------------------------------------------------- compressor (zero look-ahead)
struct Comp : Proc {
  double env = 0, hz = 0, hx = 0, ms = 0, minGr = 0; int tick = 0;
  std::vector<PDesc> desc() const override { return {{"threshold",-20,-80,0,true},{"ratio",4,1,100,true},{"attack",8,0.05f,200,true},{"release",120,5,3000,true},{"knee",6,0,30,true},{"makeup",0,-24,36,true},{"mix",1,0,1,true},{"schpf",20,10,1000,true},{"rms",0,0,1,true},{"auto",0,0,1,true}}; }
  bool process(Bus& in, int inCh, Bus& out, int n) override {
    if(dead) return false; if(!inCh) return true;
    double T = p(0), R = std::max(1.f, p(1)), W = p(4), mk = std::pow(10, (p(5) + p(9)*0.6*std::max(0.0, -T)*(1 - 1/R))/20), mix = p(6); bool rms = p(8) > 0.5;
    double aA = std::exp(-1/(sr*p(2)/1000)), aR = std::exp(-1/(sr*p(3)/1000)), hp = std::exp(-TWO_PI*p(7)/sr), aM = std::exp(-1/(sr*0.01)), sl = 1/R - 1;
    for(int i = 0; i < n; i++){
      double s = 0; for(int c = 0; c < inCh; c++) s += in.d[c][i]; s /= inCh;
      double h = hp*(hz + s - hx); hx = s; hz = h;
      double lv; if(rms){ ms = aM*ms + (1 - aM)*h*h; lv = std::sqrt(ms)*1.414; } else lv = std::fabs(h);
      double x = 20*std::log10(lv + 1e-9), y, d = x - T;
      if(2*d < -W) y = x; else if(W > 0 && 2*std::fabs(d) <= W){ double q = d + W/2; y = x + sl*q*q/(2*W); } else y = T + d/R;
      double gr = y - x; env = gr < env ? aA*env + (1 - aA)*gr : aR*env + (1 - aR)*gr; if(env < minGr) minGr = env;
      double g = std::pow(10, env/20)*mk, wet = g*mix + (1 - mix);
      for(int c = 0; c < out.ch; c++) out.d[c][i] = (float)(IN(c)[i]*wet); }
    tick += n; if(tick > sr/30){ tick = 0; auto m = Value::obj(); m->set("gr", Value::num(minGr)); post(m); minGr = 0; }
    return true; }
};

// ---------------------------------------------------------------- drive: 4x oversampled table shaper with ADAA
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
struct Shaper : Proc {
  std::vector<float> c; std::vector<double> F; int N = 2; double h = 2;
  struct St { HB u1, u2, d2, d1; double x0 = 0, F0 = 0; St() : u1(&HB1()), u2(&HB2()), d2(&HB2()), d1(&HB1()) {} };
  std::vector<std::unique_ptr<St>> ch;
  void setCurve(const std::vector<float>& cv){ c = cv.empty() ? std::vector<float>{-1.f, 1.f} : cv; N = (int)c.size(); h = 2.0/(N - 1); F.assign(N, 0); for(int k = 1; k < N; k++) F[k] = F[k-1] + (c[k-1] + (double)c[k])*h/2; for(auto& s : ch) s->F0 = Fi(s->x0); }
  void init(const ValueP& o) override { ValueP po = o ? o->get("processorOptions") : nullptr; ValueP cv = po ? po->get("curve") : nullptr; setCurve(cv && cv->t == Value::F32 ? cv->f : std::vector<float>()); }
  std::shared_ptr<void> prepare(const ValueP& m) override { ValueP cv = m->get("curve"); if(!cv || cv->t != Value::F32) return nullptr; auto p = std::make_shared<std::vector<float>>(cv->f); return p; }
  void message(const ValueP& m, std::shared_ptr<void> pre) override { if(m->strOr("cmd", "") == "kill"){ dead = true; return; } if(pre) setCurve(*std::static_pointer_cast<std::vector<float>>(pre)); }
  double f(double x) const { if(x <= -1) return c[0]; if(x >= 1) return c[N-1]; double t = (x + 1)/h; int k = std::min(N - 2, (int)t); double fr = t - k; return c[k] + (c[k+1] - c[k])*fr; }
  double Fi(double x) const { if(x <= -1) return c[0]*(x + 1); if(x >= 1) return F[N-1] + c[N-1]*(x - 1); double t = (x + 1)/h; int k = std::min(N - 2, (int)t); double d = (t - k)*h, s = (c[k+1] - c[k])/h; return F[k] + c[k]*d + s*d*d/2; }
  double shape(St& s, double x){ double dx = x - s.x0, y; if(std::fabs(dx) > 1e-7){ double F1 = Fi(x); y = (F1 - s.F0)/dx; s.F0 = F1; } else { y = f(0.5*(x + s.x0)); s.F0 = Fi(x); } s.x0 = x; return y; }
  bool process(Bus& in, int inCh, Bus& out, int n) override {
    if(dead) return false; if(!inCh){ for(int c2 = 0; c2 < out.ch; c2++) std::memset(out.d[c2], 0, sizeof(float)*n); return true; }
    for(int k = 0; k < out.ch; k++){ while((int)ch.size() <= k){ ch.emplace_back(new St()); ch.back()->F0 = Fi(0); } St& s = *ch[k]; const float* src = IN(k); float* o = out.d[k];
      for(int i = 0; i < n; i++){ s.u1.up(src[i]); double pp = s.u1.a, q = s.u1.b;
        s.u2.up(pp); double s0 = shape(s, s.u2.a), s1 = shape(s, s.u2.b); double e = s.d2.down(s0, s1);
        s.u2.up(q); double s2 = shape(s, s.u2.a), s3 = shape(s, s.u2.b); double od = s.d2.down(s2, s3);
        o[i] = (float)s.d1.down(e, od); } }
    return true; }
};

// ---------------------------------------------------------------- limiter
struct Limit : Proc {
  double env = 0, minG = 1; int tick = 0;
  std::vector<PDesc> desc() const override { return {{"ceiling",-1,-30,0,true},{"release",80,5,2000,true},{"input",0,-24,36,true}}; }
  bool process(Bus& in, int inCh, Bus& out, int n) override {
    if(dead) return false; if(!inCh){ for(int c = 0; c < out.ch; c++) std::memset(out.d[c], 0, sizeof(float)*n); return true; }
    double cl = std::pow(10, p(0)/20), gi = std::pow(10, p(2)/20), rel = std::exp(-1/(sr*p(1)/1000)), atk = std::exp(-1/(sr*0.0004)), k = 0.9*cl, r = cl - k;
    for(int i = 0; i < n; i++){ double pk = 0; for(int c = 0; c < inCh; c++){ double v = std::fabs(in.d[c][i]*gi); if(v > pk) pk = v; }
      env = pk > env ? atk*env + (1 - atk)*pk : rel*env + (1 - rel)*pk; double g = env > cl ? cl/env : 1; if(g < minG) minG = g;
      for(int c = 0; c < out.ch; c++){ double v = IN(c)[i]*gi*g, a = std::fabs(v); if(a > k) v = (v < 0 ? -1 : 1)*(k + r*std::tanh((a - k)/r)); out.d[c][i] = (float)v; } }
    tick += n; if(tick > sr/30){ tick = 0; auto m = Value::obj(); m->set("gr", Value::num(20*std::log10(minG))); post(m); minG = 1; }
    return true; }
};

// ---------------------------------------------------------------- reverse delay
struct RevDelay : Proc {
  int S; std::vector<float> buf[2]; int w = 0; struct G { long s, L, k; } g[2]; bool started = false;
  std::vector<PDesc> desc() const override { return {{"time",500,50,2000,true},{"feedback",0.3f,0,0.95f,true},{"mix",0.5f,0,1,true}}; }
  void init(const ValueP&) override { S = (int)std::ceil(sr*4.5); buf[0].assign(S, 0.f); buf[1].assign(S, 0.f); }
  bool process(Bus& in, int inCh, Bus& out, int n) override {
    if(dead) return false; long L = std::max(256L, (long)std::floor(sr*p(0)/1000)); double fbk = p(1), mix = p(2);
    if(!started){ started = true; g[0] = {w, L, 0}; g[1] = {w + (L >> 1), L, L >> 1}; }
    for(int i = 0; i < n; i++){
      for(auto& gg : g) if(gg.k >= gg.L){ gg.k = 0; gg.L = L; gg.s = w; }
      double s0 = std::sin(3.141592653589793*g[0].k/(double)g[0].L), s1 = std::sin(3.141592653589793*g[1].k/(double)g[1].L), w0 = s0*s0, w1 = s1*s1;
      long r0 = ((g[0].s - g[0].k) % S + S) % S, r1 = ((g[1].s - g[1].k) % S + S) % S;
      for(int c = 0; c < out.ch; c++){ std::vector<float>& b = buf[c & 1]; double x = inCh ? IN(c)[i] : 0, y = b[r0]*w0 + b[r1]*w1; b[w] = (float)(x + y*fbk); out.d[c][i] = (float)(x*(1 - mix*0.5) + y*mix); }
      w = (w + 1) % S; g[0].k++; g[1].k++; }
    return true; }
};

// ---------------------------------------------------------------- freeze
struct Freeze : Proc {
  int R; std::vector<float> ring; int w = 0; std::vector<float> gr, old; int ph[3] = {0,0,0}, oph[3] = {0,0,0}; double x = 1, amp = 0, tgt = 0, size = 0.3;
  std::vector<PDesc> desc() const override { return {{"level",1,0,2,true},{"dry",1,0,1,true},{"size",300,80,1000,true}}; }
  void init(const ValueP&) override { R = (int)std::ceil(sr*1.2); ring.assign(R, 0.f); }
  void grab(){ int L = (int)std::floor(sr*std::min(1.0, size)); std::vector<float> g(L); for(int i = 0; i < L; i++) g[i] = ring[((w - L + i) % R + R) % R];
    old.swap(gr); std::memcpy(oph, ph, sizeof ph); gr.swap(g); ph[0] = 0; ph[1] = L/3; ph[2] = 2*L/3; x = 0; tgt = 1; }
  void message(const ValueP& m, std::shared_ptr<void>) override { std::string c = m->strOr("cmd", ""); if(c == "kill") dead = true; else if(c == "grab") grab(); else if(c == "let") tgt = 0; }
  double read(std::vector<float>& g, int* p){ int L = (int)g.size(); double s = 0; for(int j = 0; j < 3; j++){ int k = p[j]; double ww = 0.5 - 0.5*std::cos(TWO_PI*k/L); s += g[k]*ww; p[j] = (k + 1) % L; } return s*(2.0/3); }
  bool process(Bus& in, int inCh, Bus& out, int n) override {
    if(dead) return false; size = p(2)/1000; double lv = p(0), dry = p(1), fade = 1/(sr*0.12);
    for(int i = 0; i < n; i++){ double xx = 0; if(inCh){ for(int c = 0; c < inCh; c++) xx += in.d[c][i]; xx /= inCh; } ring[w] = (float)xx; w = (w + 1) % R;
      amp += (tgt - amp)*0.0005; double y = 0;
      if(!gr.empty()){ y = read(gr, ph); if(!old.empty() && x < 1){ y = y*x + read(old, oph)*(1 - x); x = std::min(1.0, x + fade); if(x >= 1) old.clear(); } }
      y *= amp*lv; for(int c = 0; c < out.ch; c++){ double src = inCh ? IN(c)[i] : 0; out.d[c][i] = (float)(src*dry + y); } }
    return true; }
};

// ---------------------------------------------------------------- talk box
static const double VF[5][3] = {{800,1150,2900},{400,1600,2700},{350,1900,2800},{450,800,2830},{325,700,2530}}, VG[5][3] = {{0,-6,-32},{0,-24,-30},{0,-20,-30},{0,-11,-30},{0,-16,-35}};
struct Vowel : Proc {
  SVF f[2][3]; double env = 0, ph = 0, F[3] = {800,1150,2900}, G[3] = {1,1,1};
  std::vector<PDesc> desc() const override { return {{"mode",0,0,2,true},{"pos",0.5f,0,1,true},{"sens",0.5f,0,1,true},{"rate",1,0.05f,10,true},{"q",8,1,30,true},{"mix",1,0,1,true},{"from",0,0,4,true},{"to",4,0,4,true}}; }
  bool process(Bus& in, int inCh, Bus& out, int n) override {
    if(dead) return false; if(!inCh){ for(int c = 0; c < out.ch; c++) std::memset(out.d[c], 0, sizeof(float)*n); return true; }
    int mode = (int)std::lround(p(0)); double sens = p(2), q = p(4), mix = p(5); int a = (int)std::lround(p(6)), b = (int)std::lround(p(7));
    double ea = 1 - std::exp(-TWO_PI*80/sr), er = std::exp(-1/(sr*0.15));
    for(int i = 0; i < n; i++){ double ab = 0; for(int c = 0; c < inCh; c++) ab += std::fabs(in.d[c][i]); ab /= inCh; env = ab > env ? env + (ab - env)*ea : env*er;
      if((i & 15) == 0){ double m; if(mode == 0) m = std::min(1.0, env*(2 + sens*40)); else if(mode == 1){ ph = std::fmod(ph + 16*p(3)/sr, 1.0); m = 0.5 - 0.5*std::cos(TWO_PI*ph); } else m = p(1);
        double t = a + (b - a)*m; int k = std::min(3, (int)std::floor(t)); double fr = t - k; int k0 = std::max(0, std::min(4, k)), k1 = std::max(0, std::min(4, k + 1));
        for(int j = 0; j < 3; j++){ F[j] = VF[k0][j] + (VF[k1][j] - VF[k0][j])*fr; G[j] = std::pow(10, (VG[k0][j] + (VG[k1][j] - VG[k0][j])*fr)/20); } }
      for(int c = 0; c < out.ch; c++){ double x = IN(c)[i]; SVF* fs = f[c & 1]; double y = 0; for(int j = 0; j < 3; j++) y += fs[j].run(x, F[j], q*(j ? 1.4 : 1), sr).bp*G[j]; out.d[c][i] = (float)(x*(1 - mix) + y*mix*2.2); } }
    return true; }
};

// ---------------------------------------------------------------- stutter
struct Stutter : Proc {
  int S; std::vector<float> buf[2]; int w = 0; long slot = -1; int st = 0; double g = 0;
  std::vector<PDesc> desc() const override { return {{"bpm",120,30,300,true},{"div",4,1,16,true},{"mode",0,0,1,true},{"duty",0.5f,0.05f,0.95f,true},{"mix",1,0,1,true}}; }
  void init(const ValueP&) override { S = (int)std::ceil(sr*9); buf[0].assign(S, 0.f); buf[1].assign(S, 0.f); }
  bool process(Bus& in, int inCh, Bus& out, int n) override {
    if(dead) return false; double bpm = p(0), div = p(1), duty = p(3), mix = p(4); int mode = (int)std::lround(p(2));
    double spb = sr*60/bpm/div; double t0 = time()*sr; double sm = 1 - std::exp(-1/(sr*0.0015));
    for(int i = 0; i < n; i++){ double t = t0 + i; long sl = (long)std::floor(t/spb); double ph = std::fmod(t/spb, 1.0);
      for(int c = 0; c < out.ch; c++){ double x = inCh ? IN(c)[i] : 0; buf[c & 1][w] = (float)x; }
      if(sl != slot){ slot = sl; if(mode == 1 && (sl % 4 == 0)) st = w; }
      double tgt = 1; if(mode == 0) tgt = ph < duty ? 1 : 0; g += (tgt - g)*sm;
      for(int c = 0; c < out.ch; c++){ std::vector<float>& b = buf[c & 1]; double x = inCh ? IN(c)[i] : 0, y;
        if(mode == 0) y = x*g;
        else { long L = std::max(64L, (long)std::floor(spb*duty)), k = (long)std::floor(ph*spb); double ww = std::min(1.0, std::min(k/64.0, (L - k)/64.0)); y = k < L ? b[(st + k) % S]*std::max(0.0, ww) : 0; }
        out.d[c][i] = (float)(x*(1 - mix) + y*mix); }
      w = (w + 1) % S; }
    return true; }
};

// ---------------------------------------------------------------- auto swell
struct Swell : Proc {
  double env = 0, g = 0; long quiet = 0; bool armed = true;
  std::vector<PDesc> desc() const override { return {{"thr",-40,-80,-10,true},{"attack",400,20,3000,true}}; }
  bool process(Bus& in, int inCh, Bus& out, int n) override {
    if(dead) return false; if(!inCh){ for(int c = 0; c < out.ch; c++) std::memset(out.d[c], 0, sizeof(float)*n); return true; }
    double thr = std::pow(10, p(0)/20), up = 1/(sr*p(1)/1000), er = std::exp(-1/(sr*0.02));
    for(int i = 0; i < n; i++){ double a = 0; for(int c = 0; c < inCh; c++){ double v = std::fabs(in.d[c][i]); if(v > a) a = v; } env = a > env ? a : env*er;
      if(env < thr*0.5){ if(++quiet > sr*0.04){ armed = true; g = std::max(0.0, g - 1/(sr*0.03)); } } else quiet = 0;
      if(env > thr){ if(armed && g > 0.98) armed = false; g = std::min(1.0, g + up); }
      double gg = g*g; for(int c = 0; c < out.ch; c++) out.d[c][i] = (float)(IN(c)[i]*gg); }
    return true; }
};

Proc* makeProc(const std::string& name){
  if(name == "np-gate") return new Gate(); if(name == "np-octave") return new Octave(); if(name == "np-pitch") return new Pitch();
  if(name == "np-envfilter") return new EnvFilter(); if(name == "np-synth") return new Synth(); if(name == "np-crusher") return new Crusher();
  if(name == "np-looper") return new Looper(); if(name == "np-recorder") return new Recorder(); if(name == "np-meter") return new Meter();
  if(name == "np-comp") return new Comp(); if(name == "np-shaper") return new Shaper(); if(name == "np-limit") return new Limit();
  if(name == "np-revdelay") return new RevDelay(); if(name == "np-freeze") return new Freeze(); if(name == "np-vowel") return new Vowel();
  if(name == "np-stutter") return new Stutter(); if(name == "np-swell") return new Swell(); if(name == "np-nam") return makeNamProc();
  return nullptr;
}

// ---------------------------------------------------------------- the worklet node that hosts a processor
struct WorkletNode : Node {
  std::unique_ptr<Proc> proc; int fixedOut = 0; Bus empty;
  WorkletNode(Context& c, Proc* p, const ValueP& opts) : Node(c), proc(p) {
    addIn(); addOut(2); channelCount = 2; mode = Max;
    proc->node = this; proc->sr = c.sr;
    ValueP oc = opts ? opts->get("outputChannelCount") : nullptr; if(oc && oc->t == Value::Arr && !oc->a.empty()) fixedOut = (int)oc->a[0]->n;
    for(auto& d : proc->desc()){ Param* pp = addParam(d.name, d.def, d.mn, d.mx, d.krate); proc->P.push_back(pp); }
    ValueP pd = opts ? opts->get("parameterData") : nullptr; if(pd && pd->t == Value::Obj) for(auto& kv : pd->o){ Param* pp = param(kv.first); if(pp && kv.second->t == Value::Num) pp->value = (float)kv.second->n; }
    proc->init(opts);
  }
  const char* kind() const override { return "worklet"; }
  bool autoPull() const override { return true; }
  void setProp(const std::string& k, const ValueP& v) override { commonProp(k, v); }
  void commonProp(const std::string& k, const ValueP& v){ if(k == "channelCount") channelCount = std::max(1, std::min(MAXCH, (int)v->n)); else if(k == "channelCountMode") mode = v->s == "explicit" ? Explicit : v->s == "clamped-max" ? ClampedMax : Max; else if(k == "channelInterpretation") discrete = v->s == "discrete"; }
  void message(const ValueP& m) override { proc->message(m, nullptr); if(m->strOr("cmd", "") == "kill") proc->dead = true; }
  void messagePrepared(const ValueP& m, std::shared_ptr<void> pre){ proc->message(m, pre); if(m->strOr("cmd", "") == "kill") proc->dead = true; }
  void process(int n) override {
    Input& in = *ins[0]; int inCh = in.conn.empty() ? 0 : in.computed; Bus& o = *outs[0];
    o.setCh(fixedOut ? fixedOut : std::max(1, inCh));
    if(inCh && in.bus.silent) for(int c = 0; c < inCh; c++) std::memset(in.bus.d[c], 0, sizeof(float)*n);
    for(int c = 0; c < o.ch; c++) std::memset(o.d[c], 0, sizeof(float)*n);
    bool keep = proc->process(in.bus, inCh, o, n); o.silent = false;
    if(!keep){ dead = true; o.zero(n); } }
};

std::shared_ptr<void> prepareWorklet(Node* n, const ValueP& m){ auto w = dynamic_cast<WorkletNode*>(n); return w ? w->proc->prepare(m) : nullptr; }
void deliverWorklet(Node* n, const ValueP& m, std::shared_ptr<void> pre){ auto w = dynamic_cast<WorkletNode*>(n); if(w) w->messagePrepared(m, pre); else n->message(m); }
Node* makeWorklet(Context& c, const std::string& name, const ValueP& opts){ Proc* p = makeProc(name); if(!p) return nullptr; return new WorkletNode(c, p, opts); }

} // namespace np
