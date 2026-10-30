// The standard nodes, written to match the Web Audio spec (and Chromium where the spec leaves room).
#include "np.h"
#include "procs.h"
#include <algorithm>

namespace np {

static const double PI = 3.14159265358979323846;

// ---------------------------------------------------------------- destination and device input
struct DestNode : Node {
  DestNode(Context& c, int ch) : Node(c){ addIn(MAXCH); channelCount = 2; mode = Explicit; discrete = false; (void)ch; }
  const char* kind() const override { return "dest"; }
  void process(int) override {}
  void setProp(const std::string& k, const ValueP& v) override {
    if(k == "channelCount") channelCount = std::max(1, std::min(MAXCH, (int)v->n));
    else if(k == "channelCountMode") mode = v->s == "explicit" ? Explicit : v->s == "clamped-max" ? ClampedMax : Max;
    else if(k == "channelInterpretation") discrete = v->s == "discrete"; }
};
struct InputNode : Node {
  InputNode(Context& c) : Node(c){ addOut(2); }
  const char* kind() const override { return "input"; }
  bool isSource() const override { return true; }
  void process(int n) override { Bus& o = *outs[0]; o.setCh(2); bool any = false;
    for(int c = 0; c < 2; c++){ if(cx.devIn && c < cx.devInN && cx.devIn[c]){ std::memcpy(o.d[c], cx.devIn[c], sizeof(float)*n); any = true; } else std::memset(o.d[c], 0, sizeof(float)*n); }
    if(cx.devInN == 1 && cx.devIn && cx.devIn[0]) std::memcpy(o.d[1], cx.devIn[0], sizeof(float)*n);
    o.silent = !any; }
};

// ---------------------------------------------------------------- common props for every node
static void commonProp(Node* nd, const std::string& k, const ValueP& v){
  if(k == "channelCount") nd->channelCount = std::max(1, std::min(MAXCH, (int)v->n));
  else if(k == "channelCountMode") nd->mode = v->s == "explicit" ? Node::Explicit : v->s == "clamped-max" ? Node::ClampedMax : Node::Max;
  else if(k == "channelInterpretation") nd->discrete = v->s == "discrete";
}

// ---------------------------------------------------------------- gain
struct GainNode : Node {
  Param* g;
  GainNode(Context& c) : Node(c){ addIn(); addOut(1); g = addParam("gain", 1.f); }
  const char* kind() const override { return "gain"; }
  void setProp(const std::string& k, const ValueP& v) override { commonProp(this, k, v); }
  void process(int n) override {
    Input& in = *ins[0]; Bus& o = *outs[0]; o.setCh(in.computed);
    if(in.bus.silent){ if(!o.silent) o.zero(n); return; }
    for(int c = 0; c < o.ch; c++){ const float* s = in.bus.d[c]; float* d = o.d[c];
      if(g->varying) for(int k = 0; k < n; k++) d[k] = s[k]*g->vals[k]; else { float v = g->first; for(int k = 0; k < n; k++) d[k] = s[k]*v; } }
    o.silent = false; }
};

// ---------------------------------------------------------------- delay (linear interpolation; cut at the start of a pass when inside a loop)
struct DelayNode : Node {
  Param* dt; double maxDelay; int size; std::vector<std::vector<float>> buf; int w = 0; bool loop = false; int quiet = 1 << 30; int outCh = 1;
  DelayNode(Context& c, double maxD) : Node(c){ addIn(); addOut(1); maxDelay = maxD; dt = addParam("delayTime", 0.f, 0.f, (float)maxD);
    size = (int)std::ceil(maxD*c.sr) + 2*MAXQ + 8; buf.assign(MAXCH, std::vector<float>()); }
  const char* kind() const override { return "delay"; }
  bool isDelay() const override { return true; }
  void setProp(const std::string& k, const ValueP& v) override {
    if(k == "__loop") loop = v->b; else commonProp(this, k, v); }
  void ensure(int ch){ for(int c = 0; c < ch; c++) if(buf[c].empty()) buf[c].assign(size, 0.f); }
  float readAt(int c, double pos){ // pos: absolute write index (may be fractional, can be negative)
    double p = std::fmod(pos, (double)size); if(p < 0) p += size; int i = (int)p; double f = p - i; int j = i + 1; if(j >= size) j = 0;
    return (float)(buf[c][i]*(1 - f) + buf[c][j]*f); }
  void write(int n){ Input& in = *ins[0]; int ch = in.computed; if(!in.bus.silent){ outCh = ch; quiet = 0; } else quiet += n;
    ensure(outCh);
    for(int c = 0; c < outCh; c++){ float* b = buf[c].data(); const float* s = in.bus.silent || c >= ch ? nullptr : in.bus.d[c]; int p = w;
      for(int k = 0; k < n; k++){ b[p] = s ? s[k] : 0.f; if(++p >= size) p = 0; } }
    w = (w + n) % size; }
  void read(int n, bool after){
    Bus& o = *outs[0]; o.setCh(outCh);
    const double maxF = maxDelay*cx.sr;
    if(quiet > maxF + 2*n + 4){ if(!o.silent) o.zero(n); return; }
    ensure(outCh);
    for(int c = 0; c < outCh; c++){ float* d = o.d[c];
      for(int k = 0; k < n; k++){
        double del = (dt->varying ? dt->vals[k] : dt->first)*cx.sr; if(del > maxF) del = maxF; if(del < 0) del = 0;
        double base = after ? (double)(w - n + k) : (double)(w + k);   // index this sample would be written at
        d[k] = readAt(c, base - del); } }
    o.silent = false; }
  void process(int n) override { write(n); read(n, true); }
};

// ---------------------------------------------------------------- biquad (Chromium formulas, double precision)
struct BiquadNode : Node {
  Param *fr, *q, *gn, *de; int type = 0; // 0 lowpass 1 highpass 2 bandpass 3 lowshelf 4 highshelf 5 peaking 6 notch 7 allpass
  double x1[MAXCH] = {0}, x2[MAXCH] = {0}, y1[MAXCH] = {0}, y2[MAXCH] = {0}; int outCh = 1; int quietN = 1 << 30;
  double b0, b1, b2, a1, a2;
  BiquadNode(Context& c) : Node(c){ addIn(); addOut(1); double ny = c.sr/2; fr = addParam("frequency", 350.f, 0.f, (float)ny); q = addParam("Q", 1.f); gn = addParam("gain", 0.f, -3.4e38f, (float)(40*std::log10(3.4e38))); de = addParam("detune", 0.f, (float)(-1200*std::log2(3.4e38)), (float)(1200*std::log2(3.4e38))); }
  const char* kind() const override { return "biquad"; }
  void setProp(const std::string& k, const ValueP& v) override {
    if(k == "type"){ static const char* T[] = {"lowpass","highpass","bandpass","lowshelf","highshelf","peaking","notch","allpass"}; for(int i = 0; i < 8; i++) if(v->s == T[i]) type = i; }
    else commonProp(this, k, v); }
  void setN(double nb0, double nb1, double nb2, double na0, double na1, double na2){ double s = 1/na0; b0 = nb0*s; b1 = nb1*s; b2 = nb2*s; a1 = na1*s; a2 = na2*s; }
  void coeffs(double f, double Q, double G, double det){
    double ny = cx.sr*0.5; double freq = f*std::pow(2.0, det/1200.0); double fn = freq/ny;
    if(type == 0){ double c = std::min(1.0, std::max(0.0, fn)); if(c == 1) setN(1,0,0,1,0,0); else if(c > 0){ double res = std::pow(10, Q/20); double th = PI*c, al = std::sin(th)/(2*res), cw = std::cos(th), be = (1 - cw)/2; setN(be, 2*be, be, 1 + al, -2*cw, 1 - al); } else setN(0,0,0,1,0,0); return; }
    if(type == 1){ double c = std::min(1.0, std::max(0.0, fn)); if(c == 1) setN(0,0,0,1,0,0); else if(c > 0){ double res = std::pow(10, Q/20); double th = PI*c, al = std::sin(th)/(2*res), cw = std::cos(th), be = (1 + cw)/2; setN(be, -2*be, be, 1 + al, -2*cw, 1 - al); } else setN(1,0,0,1,0,0); return; }
    double c = std::max(0.0, std::min(1.0, fn));
    if(type == 2){ double qq = std::max(0.0, Q); if(c > 0 && c < 1){ if(qq > 0){ double th = PI*c, al = std::sin(th)/(2*qq), k = std::cos(th); setN(al, 0, -al, 1 + al, -2*k, 1 - al); } else setN(1,0,0,1,0,0); } else setN(0,0,0,1,0,0); return; }
    if(type == 3){ double A = std::pow(10, G/40); if(c == 1) setN(A*A,0,0,1,0,0); else if(c > 0){ double th = PI*c, S = 1, al = 0.5*std::sin(th)*std::sqrt((A + 1/A)*(1/S - 1) + 2), k = std::cos(th), k2 = 2*std::sqrt(A)*al, ap = A + 1, am = A - 1;
        setN(A*(ap - am*k + k2), 2*A*(am - ap*k), A*(ap - am*k - k2), ap + am*k + k2, -2*(am + ap*k), ap + am*k - k2); } else setN(1,0,0,1,0,0); return; }
    if(type == 4){ double A = std::pow(10, G/40); if(c == 1) setN(1,0,0,1,0,0); else if(c > 0){ double th = PI*c, S = 1, al = 0.5*std::sin(th)*std::sqrt((A + 1/A)*(1/S - 1) + 2), k = std::cos(th), k2 = 2*std::sqrt(A)*al, ap = A + 1, am = A - 1;
        setN(A*(ap + am*k + k2), -2*A*(am + ap*k), A*(ap + am*k - k2), ap - am*k + k2, 2*(am - ap*k), ap - am*k - k2); } else setN(A*A,0,0,1,0,0); return; }
    if(type == 5){ double A = std::pow(10, G/40); if(c > 0 && c < 1){ double qq = std::max(0.0, Q); if(qq > 0){ double th = PI*c, al = std::sin(th)/(2*qq), k = std::cos(th); setN(1 + al*A, -2*k, 1 - al*A, 1 + al/A, -2*k, 1 - al/A); } else setN(A*A,0,0,1,0,0); } else setN(1,0,0,1,0,0); return; }
    if(type == 6){ double qq = std::max(0.0, Q); if(c > 0 && c < 1){ if(qq > 0){ double th = PI*c, al = std::sin(th)/(2*qq), k = std::cos(th); setN(1, -2*k, 1, 1 + al, -2*k, 1 - al); } else setN(0,0,0,1,0,0); } else setN(1,0,0,1,0,0); return; }
    if(type == 7){ double qq = std::max(0.0, Q); if(c > 0 && c < 1){ if(qq > 0){ double th = PI*c, al = std::sin(th)/(2*qq), k = std::cos(th); setN(1 - al, -2*k, 1 + al, 1 + al, -2*k, 1 - al); } else setN(-1,0,0,1,0,0); } else setN(1,0,0,1,0,0); return; }
  }
  void process(int n) override {
    Input& in = *ins[0]; Bus& o = *outs[0];
    if(!in.bus.silent){ outCh = in.computed; quietN = 0; }
    else { quietN += n; if(quietN > 4*(int)cx.sr){ if(!o.silent) o.zero(n); return; } }   // a filter rings for a while; after 4 s of silence it is quiet
    o.setCh(outCh);
    bool vary = fr->varying || q->varying || gn->varying || de->varying;
    if(!vary) coeffs(fr->first, q->first, gn->first, de->first);
    double peak = 0;
    for(int c = 0; c < outCh; c++){
      const float* s = (in.bus.silent || c >= in.computed) ? nullptr : in.bus.d[c]; float* d = o.d[c];
      double X1 = x1[c], X2 = x2[c], Y1 = y1[c], Y2 = y2[c];
      for(int k = 0; k < n; k++){
        if(vary) coeffs(fr->at(k), q->at(k), gn->at(k), de->at(k));
        float x = s ? s[k] : 0.f; float y = (float)(b0*x + b1*X1 + b2*X2 - a1*Y1 - a2*Y2);   // Chromium keeps the output as float
        X2 = X1; X1 = x; Y2 = Y1; Y1 = y; d[k] = y; if(std::fabs(y) > peak) peak = std::fabs(y); }
      // flush denormals
      if(std::fabs(Y1) < 1e-30) Y1 = 0; if(std::fabs(Y2) < 1e-30) Y2 = 0;
      x1[c] = X1; x2[c] = X2; y1[c] = Y1; y2[c] = Y2; }
    o.silent = in.bus.silent && peak < 1e-9;
    if(o.silent) for(int c = 0; c < outCh; c++){ x1[c] = x2[c] = y1[c] = y2[c] = 0; }
  }
};

// ---------------------------------------------------------------- stereo panner (equal power)
struct PannerNode : Node {
  Param* pan;
  PannerNode(Context& c) : Node(c){ addIn(); addOut(2); channelCount = 2; mode = ClampedMax; pan = addParam("pan", 0.f, -1.f, 1.f); }
  const char* kind() const override { return "panner"; }
  void setProp(const std::string& k, const ValueP& v) override { commonProp(this, k, v); }
  void process(int n) override {
    Input& in = *ins[0]; Bus& o = *outs[0]; o.setCh(2);
    if(in.bus.silent){ if(!o.silent) o.zero(n); return; }
    float* L = o.d[0]; float* R = o.d[1];
    if(in.computed == 1){ const float* s = in.bus.d[0];
      for(int k = 0; k < n; k++){ double p = std::min(1.0, std::max(-1.0, (double)pan->at(k))), x = (p + 1)/2; L[k] = (float)(s[k]*std::cos(x*PI/2)); R[k] = (float)(s[k]*std::sin(x*PI/2)); } }
    else { const float* sl = in.bus.d[0]; const float* sr = in.bus.d[1];
      for(int k = 0; k < n; k++){ double p = std::min(1.0, std::max(-1.0, (double)pan->at(k)));
        if(p <= 0){ double x = p + 1, gL = std::cos(x*PI/2), gR = std::sin(x*PI/2); L[k] = (float)(sl[k] + sr[k]*gL); R[k] = (float)(sr[k]*gR); }
        else { double x = p, gL = std::cos(x*PI/2), gR = std::sin(x*PI/2); L[k] = (float)(sl[k]*gL); R[k] = (float)(sr[k] + sl[k]*gR); } } }
    o.silent = false; }
};

// ---------------------------------------------------------------- wave shaper (no oversampling; the app only uses 'none' here)
struct ShaperNode : Node {
  std::vector<float> curve;
  ShaperNode(Context& c) : Node(c){ addIn(); addOut(1); }
  const char* kind() const override { return "shaper"; }
  void setProp(const std::string& k, const ValueP& v) override { commonProp(this, k, v); }
  void setData(const std::string& k, std::vector<std::vector<float>>&& d, double) override { if(k == "curve") curve = d.empty() ? std::vector<float>() : std::move(d[0]); }
  float map(float x) const { const int N = (int)curve.size(); if(N == 0) return x; if(N == 1) return curve[0];
    double v = (N - 1)/2.0*(x + 1.0); if(v <= 0) return curve[0]; if(v >= N - 1) return curve[N-1]; int k = (int)v; double f = v - k; return (float)((1 - f)*curve[k] + f*curve[k+1]); }
  void process(int n) override {
    Input& in = *ins[0]; Bus& o = *outs[0]; o.setCh(in.computed);
    float z = map(0.f);
    if(in.bus.silent && std::fabs(z) < 1e-12f){ if(!o.silent) o.zero(n); return; }
    for(int c = 0; c < o.ch; c++){ const float* s = in.bus.d[c]; float* d = o.d[c]; if(in.bus.silent) for(int k = 0; k < n; k++) d[k] = z; else for(int k = 0; k < n; k++) d[k] = map(s[k]); }
    o.silent = false; }
};

// ---------------------------------------------------------------- scheduled sources
struct Scheduled : Node {
  double startT = -1, stopT = 1e300, offset = 0; bool started = false, ended = false;
  explicit Scheduled(Context& c) : Node(c){}
  bool isSource() const override { return true; }
  void setProp(const std::string& k, const ValueP& v) override {
    if(k == "start"){ startT = v->numOr("when", 0); offset = v->numOr("offset", 0); if(v->get("duration")) stopT = std::min(stopT, std::max(startT, cx.now()) + v->numOr("duration", 0)); }
    else if(k == "stop") stopT = v->numOr("when", 0);
    else commonProp(this, k, v); }
  // frames [a,b) of this pass that should play
  bool span(int n, int& a, int& b){
    if(startT < 0 || ended) return false;
    const double sr = cx.sr; int64_t f0 = cx.frame;
    int64_t s = (int64_t)std::ceil(std::max(0.0, startT)*sr - 1e-9), e = stopT >= 1e299 ? INT64_MAX : (int64_t)std::ceil(stopT*sr - 1e-9);
    if(s < f0) s = f0;
    a = (int)std::max<int64_t>(0, std::min<int64_t>(n, s - f0)); b = (int)std::max<int64_t>(0, std::min<int64_t>(n, e - f0));
    if(e <= f0 + n && e <= f0 + b){ }
    return a < b; }
  void finishIf(int n){ if(ended) return; int64_t e = stopT >= 1e299 ? INT64_MAX : (int64_t)std::ceil(stopT*cx.sr - 1e-9); if(startT >= 0 && e <= cx.frame + n){ ended = true; dead = false; endedMsg(); } }
  void endedMsg(){ auto m = Value::obj(); m->set("__ended", Value::boolean(true)); post(m); markDead = true; }
  bool markDead = false;
};

// band-limited tables, built once per wave type
struct WaveTables {
  static constexpr int SIZE = 4096, LEVELS = 12;     // tables with 1, 2, 4 ... 2048 partials
  std::vector<float> t[LEVELS];
  WaveTables(int type){
    // partial amplitudes: 0 sine, 1 square, 2 sawtooth, 3 triangle (Fourier series, sine phase)
    std::vector<double> full(SIZE, 0.0);
    auto amp = [&](int k)->double{ if(type == 0) return k == 1 ? 1.0 : 0.0; if(type == 1) return (k & 1) ? 4.0/(PI*k) : 0.0;
      if(type == 2) return 2.0/(PI*k)*((k & 1) ? 1.0 : -1.0); if(type == 3){ if(!(k & 1)) return 0.0; return 8.0/(PI*PI*k*k)*((((k - 1)/2) & 1) ? -1.0 : 1.0); } return 0.0; };
    double norm = 1.0;
    for(int L = LEVELS - 1; L >= 0; L--){
      int parts = 1 << L; std::vector<double> x(SIZE, 0.0);
      for(int k = 1; k <= parts && k < SIZE/2; k++){ double a = amp(k); if(a == 0) continue; for(int i = 0; i < SIZE; i++) x[i] += a*std::sin(2*PI*k*i/SIZE); }
      if(L == LEVELS - 1){ double m = 0; for(double v : x) m = std::max(m, std::fabs(v)); norm = m > 0 ? 1.0/m : 1.0; }
      t[L].resize(SIZE + 1); for(int i = 0; i < SIZE; i++) t[L][i] = (float)(x[i]*norm); t[L][SIZE] = t[L][0];
    }
  }
  static const WaveTables& get(int type){ static WaveTables w0(0), w1(1), w2(2), w3(3); return type == 0 ? w0 : type == 1 ? w1 : type == 2 ? w2 : w3; }
};

struct OscNode : Scheduled {
  Param *fr, *de; int type = 0; double phase = 0;
  OscNode(Context& c) : Scheduled(c){ addOut(1); double ny = c.sr/2; fr = addParam("frequency", 440.f, (float)-ny, (float)ny); de = addParam("detune", 0.f, (float)(-1200*std::log2(3.4e38)), (float)(1200*std::log2(3.4e38))); }
  const char* kind() const override { return "osc"; }
  void setProp(const std::string& k, const ValueP& v) override {
    if(k == "type"){ static const char* T[] = {"sine","square","sawtooth","triangle"}; for(int i = 0; i < 4; i++) if(v->s == T[i]) type = i; }
    else Scheduled::setProp(k, v); }
  void process(int n) override {
    Bus& o = *outs[0]; o.setCh(1); int a, b;
    if(markDead){ dead = true; if(!o.silent) o.zero(n); return; }
    if(!span(n, a, b)){ if(!o.silent) o.zero(n); finishIf(n); return; }
    float* d = o.d[0]; for(int k = 0; k < a; k++) d[k] = 0; for(int k = b; k < n; k++) d[k] = 0;
    const WaveTables& W = WaveTables::get(type); const int S = WaveTables::SIZE; const double ny = cx.sr/2;
    for(int k = a; k < b; k++){
      double f = fr->at(k)*std::pow(2.0, de->at(k)/1200.0);
      double af = std::fabs(f); int parts = af > 0 ? (int)std::floor(ny/af) : S/2; int L = 0; while(L + 1 < WaveTables::LEVELS && (1 << (L + 1)) <= parts) L++;
      if(parts < 1){ d[k] = 0; } else {
        double p = phase*S; int i = (int)p; double fr2 = p - i; const float* t = W.t[L].data(); d[k] = (float)(t[i]*(1 - fr2) + t[i+1]*fr2); }
      phase += f/cx.sr; phase -= std::floor(phase); }
    o.silent = false; finishIf(n); }
};

struct BufSrcNode : Scheduled {
  std::vector<std::vector<float>> buf; double bsr = 48000; bool loop = false; double pos = -1;
  Param *rate, *det;
  BufSrcNode(Context& c) : Scheduled(c){ addOut(1); rate = addParam("playbackRate", 1.f, -3.4e38f, 3.4e38f, true); det = addParam("detune", 0.f, -3.4e38f, 3.4e38f, true); }
  const char* kind() const override { return "bufsrc"; }
  void setProp(const std::string& k, const ValueP& v) override { if(k == "loop") loop = v->truthy(); else Scheduled::setProp(k, v); }
  void setData(const std::string& k, std::vector<std::vector<float>>&& d, double sr) override { if(k == "buffer"){ buf = std::move(d); bsr = sr; } }
  void process(int n) override {
    Bus& o = *outs[0]; int ch = std::max(1, (int)buf.size()); o.setCh(ch); int a, b;
    if(markDead){ dead = true; if(!o.silent) o.zero(n); return; }
    if(buf.empty() || !span(n, a, b)){ if(!o.silent) o.zero(n); finishIf(n); return; }
    const size_t len = buf[0].size(); if(pos < 0) pos = offset*bsr;
    double step = bsr/cx.sr*rate->first*std::pow(2.0, det->first/1200.0);
    for(int c = 0; c < ch; c++){ float* d = o.d[c]; for(int k = 0; k < a; k++) d[k] = 0; for(int k = b; k < n; k++) d[k] = 0; }
    bool done = false;
    for(int k = a; k < b; k++){
      if(loop && len){ while(pos >= len) pos -= len; }
      if(pos >= len || pos < 0){ for(int c = 0; c < ch; c++) o.d[c][k] = 0; done = true; continue; }
      size_t i = (size_t)pos; double f = pos - i; size_t j = i + 1; if(j >= len) j = loop ? 0 : i;
      for(int c = 0; c < ch; c++){ const std::vector<float>& s = buf[c]; o.d[c][k] = (float)(s[i]*(1 - f) + s[j]*f); }
      pos += step; }
    o.silent = false;
    if(done && !loop && !ended){ ended = true; endedMsg(); }
    finishIf(n); }
};

// ---------------------------------------------------------------- splitter / merger
struct SplitterNode : Node {
  int N;
  SplitterNode(Context& c, int n) : Node(c), N(n){ addIn(n); for(int i = 0; i < n; i++) addOut(1); channelCount = n; mode = Explicit; discrete = true; }
  const char* kind() const override { return "split"; }
  void process(int n) override { Input& in = *ins[0];
    for(int i = 0; i < N; i++){ Bus& o = *outs[i]; o.setCh(1); if(in.bus.silent || i >= in.computed){ if(!o.silent) o.zero(n); continue; } std::memcpy(o.d[0], in.bus.d[i], sizeof(float)*n); o.silent = false; } }
};
struct MergerNode : Node {
  int N;
  MergerNode(Context& c, int n) : Node(c), N(n){ for(int i = 0; i < n; i++) addIn(1); addOut(n); channelCount = 1; mode = Explicit; }
  const char* kind() const override { return "merge"; }
  void process(int n) override { Bus& o = *outs[0]; o.setCh(N); bool any = false;
    for(int i = 0; i < N; i++){ Input& in = *ins[i]; if(in.bus.silent) std::memset(o.d[i], 0, sizeof(float)*n); else { std::memcpy(o.d[i], in.bus.d[0], sizeof(float)*n); any = true; } }
    o.silent = !any; }
};

// ---------------------------------------------------------------- analyser: passes sound through and keeps the last samples (mono)
struct AnalyserNode : Node {
  std::vector<float> ring; int w = 0; int fft = 2048; int sinceSnap = 0; bool want = false;
  AnalyserNode(Context& c) : Node(c){ addIn(); addOut(1); ring.assign(32768, 0.f); }
  const char* kind() const override { return "analyser"; }
  bool autoPull() const override { return true; }
  void setProp(const std::string& k, const ValueP& v) override { if(k == "fftSize") fft = std::max(32, std::min(32768, (int)v->n)); else commonProp(this, k, v); }
  void message(const ValueP& m) override { if(m->strOr("cmd", "") == "snap") want = true; }
  void process(int n) override { Input& in = *ins[0]; Bus& o = *outs[0]; o.setCh(in.computed);
    const int R = (int)ring.size();
    for(int k = 0; k < n; k++){ float s = 0; if(!in.bus.silent){ for(int c = 0; c < in.computed; c++) s += in.bus.d[c][k]; s /= in.computed; } ring[w] = s; w = (w + 1) % R; }
    if(in.bus.silent){ if(!o.silent) o.zero(n); } else { for(int c = 0; c < o.ch; c++) std::memcpy(o.d[c], in.bus.d[c], sizeof(float)*n); o.silent = false; }
    if(want){ want = false; std::vector<float> s(fft); for(int k = 0; k < fft; k++) s[k] = ring[(w - fft + k + R) % R]; auto m = Value::obj(); m->set("snap", Value::f32(std::move(s))); post(m); } }
};

// ---------------------------------------------------------------- the context
Context::Context(double sampleRate, int outChannels, int inChannels) : sr(sampleRate), outCh(outChannels), inCh(inChannels) {
  dest = new DestNode(*this, outChannels); dest->id = 1; nodes[1] = dest;
}
Context::~Context(){ for(auto& kv : nodes) delete kv.second; nodes.clear(); trashAudio(); }

Node* makeConvolver(Context& c);
Node* makeWorklet(Context& c, const std::string& name, const ValueP& opts);

Node* Context::make(const std::string& type, int nid, const ValueP& opts){
  Node* n = nullptr;
  if(type == "gain") n = new GainNode(*this);
  else if(type == "delay") n = new DelayNode(*this, opts ? opts->numOr("maxDelayTime", 1.0) : 1.0);
  else if(type == "biquad") n = new BiquadNode(*this);
  else if(type == "panner") n = new PannerNode(*this);
  else if(type == "shaper") n = new ShaperNode(*this);
  else if(type == "osc") n = new OscNode(*this);
  else if(type == "bufsrc") n = new BufSrcNode(*this);
  else if(type == "split") n = new SplitterNode(*this, opts ? (int)opts->numOr("n", 6) : 6);
  else if(type == "merge") n = new MergerNode(*this, opts ? (int)opts->numOr("n", 6) : 6);
  else if(type == "analyser") n = new AnalyserNode(*this);
  else if(type == "input") n = new InputNode(*this);
  else if(type == "convolver") n = makeConvolver(*this);
  else if(type == "worklet") n = makeWorklet(*this, opts ? opts->strOr("name", "") : "", opts);
  if(n) n->id = nid;
  return n;
}

} // namespace np
