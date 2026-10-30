// Convolver: zero-latency. The first 256 taps run directly; the rest run in FFT partitions whose work is spread
// over time, so a long reverb never lands all at once in one audio callback.
#include "np.h"
#include <complex>
#include <algorithm>

namespace np {

using cf = std::complex<float>;

struct FFT {
  int n, lg; std::vector<cf> tw; std::vector<int> rev;
  explicit FFT(int N) : n(N){ lg = 0; while((1 << lg) < n) lg++; tw.resize(n/2); for(int k = 0; k < n/2; k++){ double a = -2*3.141592653589793*k/n; tw[k] = cf((float)std::cos(a), (float)std::sin(a)); }
    rev.resize(n); for(int i = 0; i < n; i++){ int r = 0; for(int b = 0; b < lg; b++) if(i & (1 << b)) r |= 1 << (lg - 1 - b); rev[i] = r; } }
  void run(cf* x, bool inv) const {
    for(int i = 0; i < n; i++) if(i < rev[i]) std::swap(x[i], x[rev[i]]);
    for(int len = 2; len <= n; len <<= 1){ int half = len >> 1, step = n/len;
      for(int i = 0; i < n; i += len) for(int j = 0; j < half; j++){ cf w = tw[j*step]; if(inv) w = std::conj(w); cf u = x[i + j], v = x[i + j + half]*w; x[i + j] = u + v; x[i + j + half] = u - v; } }
    if(inv){ float s = 1.f/n; for(int i = 0; i < n; i++) x[i] *= s; } }
};

// one uniform partitioned stage: block P, IR segment starting at offset O
struct Stage {
  int P, O, N; FFT fft; std::vector<std::vector<cf>> H;   // N partitions, P+1 bins each
  std::vector<std::vector<cf>> X; int xHead = 0;            // frequency delay line
  std::vector<float> prev, cur; int fill = 0;
  std::vector<cf> acc, work; int jDone = 0; bool busy = false; int64_t outAt = 0; int64_t blockStart = 0;
  Stage(int p, int o, const float* h, int len) : P(p), O(o), N(0), fft(2*p) {
    int seg = std::max(0, len - O); N = (seg + P - 1)/P;
    std::vector<cf> buf(2*P);
    for(int j = 0; j < N; j++){ std::fill(buf.begin(), buf.end(), cf(0, 0)); for(int t = 0; t < P; t++){ int k = O + j*P + t; if(k < len) buf[t] = cf(h[k], 0); } fft.run(buf.data(), false); H.emplace_back(buf.begin(), buf.begin() + P + 1); }
    X.assign(std::max(1, N), std::vector<cf>(P + 1)); prev.assign(P, 0.f); cur.assign(P, 0.f); acc.assign(P + 1, cf(0, 0)); work.assign(2*P, cf(0, 0)); }
  // spread: how many partitions to do now so the job ends before the next block is complete
  void step(int frames, std::vector<float>& ring, int64_t& ringBase, int ringMask){
    if(!busy) return; int quota = O >= 2*P ? std::max(1, (int)((int64_t)N*frames/P) + 1) : N;
    int end = std::min(N, jDone + quota);
    for(int j = jDone; j < end; j++){ const std::vector<cf>& x = X[(xHead - j + N) % N]; const std::vector<cf>& h = H[j]; for(int k = 0; k <= P; k++) acc[k] += x[k]*h[k]; }
    jDone = end; if(jDone < N) return;
    for(int k = 0; k <= P; k++) work[k] = acc[k]; for(int k = 1; k < P; k++) work[2*P - k] = std::conj(acc[k]);
    fft.run(work.data(), true);
    for(int t = 0; t < P; t++){ int64_t pos = outAt + t; ring[pos & ringMask] += work[P + t].real(); }
    (void)ringBase; busy = false; }
  void blockDone(int64_t start, std::vector<float>& ring, int64_t& ringBase, int ringMask){
    if(busy){ step(1 << 30, ring, ringBase, ringMask); }      // finish anything left (should not happen)
    for(int t = 0; t < P; t++){ work[t] = cf(prev[t], 0); work[P + t] = cf(cur[t], 0); }
    fft.run(work.data(), false); xHead = (xHead + 1) % std::max(1, N); std::copy(work.begin(), work.begin() + P + 1, X[xHead].begin());
    prev.swap(cur); std::fill(acc.begin(), acc.end(), cf(0, 0)); jDone = 0; busy = N > 0; outAt = start + O; blockStart = start;
    if(O < 2*P) step(1 << 30, ring, ringBase, ringMask); }
};

struct Path {
  static const int HL = 512;
  std::vector<float> head; int H = 0; std::vector<float> hist; int hp = 0;      // direct taps (stored reversed; history kept twice so reads are one straight run)
  std::vector<std::unique_ptr<Stage>> st; std::vector<float> ring; int mask = 0; int64_t base = 0; int64_t t = 0;
  void setup(const std::vector<float>& h){
    const int len = (int)h.size(); H = std::min(256, len); head.assign(H, 0.f); for(int k = 0; k < H; k++) head[k] = h[H - 1 - k]; hist.assign(2*HL, 0.f); hp = 0;
    st.clear(); if(len > 256) st.emplace_back(new Stage(128, 256, h.data(), std::min(len, 2048)));
    if(len > 2048) st.emplace_back(new Stage(1024, 2048, h.data(), std::min(len, 16384)));
    if(len > 16384) st.emplace_back(new Stage(8192, 16384, h.data(), len));
    int need = 1; while(need < len + 2*8192 + 4096) need <<= 1; ring.assign(need, 0.f); mask = need - 1; t = 0; }
  void run(const float* x, float* y, int n){
    for(int i = 0; i < n; i++){
      float xi = x ? x[i] : 0.f;
      hist[hp] = xi; hist[hp + HL] = xi; const float* xs = hist.data() + hp + HL - H + 1; const float* hd = head.data();
      float a0 = 0, a1 = 0, a2 = 0, a3 = 0; int k = 0; for(; k + 4 <= H; k += 4){ a0 += hd[k]*xs[k]; a1 += hd[k+1]*xs[k+1]; a2 += hd[k+2]*xs[k+2]; a3 += hd[k+3]*xs[k+3]; } for(; k < H; k++) a0 += hd[k]*xs[k];
      double acc = (a0 + a1) + (a2 + a3); hp = (hp + 1) & (HL - 1);
      for(auto& s : st){ s->cur[s->fill++] = xi; if(s->fill == s->P){ s->fill = 0; s->blockDone(t + 1 - s->P, ring, base, mask); } }
      y[i] = (float)(acc + ring[t & mask]); ring[t & mask] = 0.f; t++; }
    for(auto& s : st) s->step(n, ring, base, mask); }
};

struct ConvPrep { std::vector<std::vector<float>> ir; int irCh = 0, len = 0; Path path[2]; };
struct ConvolverNode : Node {
  std::shared_ptr<ConvPrep> cur; int quiet = 1 << 30;
  ConvolverNode(Context& c) : Node(c){ addIn(); addOut(2); channelCount = 2; mode = ClampedMax; }
  const char* kind() const override { return "convolver"; }
  void setProp(const std::string& k, const ValueP& v) override { if(k == "channelCount") channelCount = std::max(1, std::min(2, (int)v->n)); else if(k == "channelCountMode") mode = v->s == "explicit" ? Explicit : v->s == "clamped-max" ? ClampedMax : Max; }
  // page thread: normalize and cut the IR into partitions
  static std::shared_ptr<ConvPrep> prepare(std::vector<std::vector<float>>&& d, double irSr, bool normalize){
    auto p = std::make_shared<ConvPrep>(); p->ir = std::move(d); p->irCh = (int)p->ir.size(); p->len = p->irCh ? (int)p->ir[0].size() : 0;
    if(p->irCh && normalize){ double pw = 0; for(auto& c : p->ir) for(float v : c) pw += (double)v*v; pw = std::sqrt(pw/(p->irCh*(double)std::max(1, p->len))); if(!(pw >= 0.000125)) pw = 0.000125; double sc = 1/pw*std::pow(10.0, -58*0.05)*(44100.0/irSr); if(p->irCh == 4) sc *= 0.5; for(auto& c : p->ir) for(float& v : c) v = (float)(v*sc); }
    for(int c = 0; c < 2; c++) p->path[c].setup(p->irCh ? p->ir[std::min(c, p->irCh - 1)] : std::vector<float>());
    return p; }
  void apply(std::shared_ptr<ConvPrep> p){ cur.swap(p); quiet = 1 << 30; if(p){ std::lock_guard<std::mutex> g(cx.gm); cx.garbage.push_back(p); } }
  void process(int n) override {
    Input& in = *ins[0]; Bus& o = *outs[0]; o.setCh(2);
    if(!cur || !cur->irCh){ if(!o.silent) o.zero(n); return; }
    if(!in.bus.silent) quiet = 0; else { quiet += n; if(quiet > cur->len + 2*8192 + 16384){ if(!o.silent) o.zero(n); return; } }
    const int ic = in.computed;
    for(int c = 0; c < 2; c++){ const float* x = in.bus.silent ? nullptr : in.bus.d[ic == 1 ? 0 : c]; cur->path[c].run(x, o.d[c], n); }
    o.silent = false; }
};
std::shared_ptr<void> convPrepare(std::vector<std::vector<float>>&& d, double sr, bool normalize){ return ConvolverNode::prepare(std::move(d), sr, normalize); }
void convApply(Node* n, std::shared_ptr<void> p){ static_cast<ConvolverNode*>(n)->apply(std::static_pointer_cast<ConvPrep>(p)); }

Node* makeConvolver(Context& c){ return new ConvolverNode(c); }

} // namespace np
