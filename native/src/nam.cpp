// Neural Amp Modeler player: a C++ port of the build/plan/kernels in namcore.js.
// The page parses .nam files (NAMCore.parse) and sends the parsed description; this builds and plays it.
#include "procs.h"
#include <algorithm>
#include <stdexcept>

namespace np {

static const int BLOCK = 128, ROOM = 2048;

struct Act { int k = 0; double a = 0, b = 0, c = 0, d = 0; std::vector<double> slopes; };
static Act readAct(const ValueP& v){ Act r; if(!v || v->t != Value::Obj) return r; r.k = (int)v->numOr("k", 0); r.a = v->numOr("a", 0); r.b = v->numOr("b", 0); r.c = v->numOr("c", 0); r.d = v->numOr("d", 0);
  ValueP s = v->get("slopes"); if(s && s->t == Value::Arr) for(auto& x : s->a) r.slopes.push_back(x->n); return r; }
static inline float actF(int k, float x, double a, double b, double c, double d){
  switch(k){
    case 1: return std::tanh(x);
    case 2: return x < -1 ? -1 : (x > 1 ? 1 : x);
    case 3: { double ax = std::fabs(x), x2 = (double)x*x; return (float)((x*(2.45550750702956 + 2.45550750702956*ax + (0.893229853513558 + 0.821226666969744*ax)*x2)) / (2.44506634652299 + (2.44506634652299 + x2)*std::fabs(x + 0.814642734961073*x*ax))); }
    case 4: return x > 0 ? x : 0;
    case 5: return x > 0 ? x : (float)(a*x);
    case 6: return (float)(1/(1 + std::exp(-(double)x)));
    case 7: return (float)(x/(1 + std::exp(-(double)x)));
    case 8: { double t = x + 3; return (float)(x*(t < 0 ? 0 : (t > 6 ? 6 : t))/6); }
    case 9: return (float)(x < a ? (x - a)*c + a : (x > b ? (x - b)*d + b : x));
    case 10: return x/(1 + std::fabs(x));
    default: return x;
  }
}
static std::runtime_error namErr(const std::string& m){ return std::runtime_error(m); }

// ---------------------------------------------------------------- memory plan
struct Buf { int rows, lb; int stride; int base; bool hist; };   // in floats
struct Arena {
  int top = 16; std::vector<std::pair<int, std::vector<float>>> inits; std::vector<Buf*> hist; std::vector<std::unique_ptr<Buf>> keep;
  int alloc(int floats){ int p = top; top += ((std::max(1, floats)*4 + 63)/64)*16 + 16; return p; }
  int data(const std::vector<float>& a){ int p = alloc((int)a.size()); inits.emplace_back(p, a); return p; }
  Buf* scratch(int rows){ keep.emplace_back(new Buf{rows, 0, BLOCK, 0, false}); keep.back()->base = alloc(rows*BLOCK); return keep.back().get(); }
  Buf* histBuf(int rows, int lb){ keep.emplace_back(new Buf{rows, lb, lb + ROOM, 0, true}); keep.back()->base = alloc(rows*(lb + ROOM)); hist.push_back(keep.back().get()); return keep.back().get(); }
};
struct Reader { const std::vector<float>& w; size_t i = 0; explicit Reader(const std::vector<float>& ww) : w(ww) {}
  float one(){ if(i >= w.size()) throw namErr("This model file is damaged: it ran out of numbers."); return w[i++]; }
  std::vector<float> many(size_t n){ if(i + n > w.size()) throw namErr("This model file is damaged: it ran out of numbers."); std::vector<float> s(w.begin() + i, w.begin() + i + n); i += n; return s; }
  bool done() const { return i == w.size(); } };
struct Conv { std::vector<float> w, b; int K, rows, cols; bool hasB; };
static Conv dense(Reader& rd, int K, int rows, int cols, int groups, bool bias){
  if(groups < 1 || rows % groups || cols % groups) throw namErr("This model has a bad group count.");
  Conv c; c.K = K; c.rows = rows; c.cols = cols; c.w.assign((size_t)K*rows*cols, 0.f); int opg = rows/groups, ipg = cols/groups, mat = rows*cols;
  for(int g = 0; g < groups; g++) for(int i = 0; i < opg; i++) for(int j = 0; j < ipg; j++) for(int k = 0; k < K; k++) c.w[(size_t)k*mat + (g*opg + i)*cols + g*ipg + j] = rd.one();
  c.hasB = bias; if(bias) c.b = rd.many(rows); return c; }

struct Player;
using Op = std::function<void(Player&, int)>;
struct Stage { int kind; std::vector<Op> ops; Buf* inBuf = nullptr; Buf* outBuf = nullptr; double scale = 1;   // 0 graph, 1 lstm, 2 linear
  // lstm
  struct L { int I, cols; std::vector<float> W, b, h0, c0, xh, c, g; }; std::vector<L> lstm; std::vector<float> hw; double hb = 0; int H = 0;
  // linear
  std::vector<float> ir, lhist; double bias = 0; int rf = 0, lp = 0; };

struct Player {
  std::vector<float> F; int P = 0; std::vector<Buf*> hist; std::vector<Stage> stages; int prewarm = 0; std::vector<float> tmp = std::vector<float>(BLOCK);
  float* at(Buf* b, int row){ return F.data() + b->base + row*b->stride + (b->hist ? b->lb + P : 0); }
  // kernels
  void conv(const Conv& cv, int dil, Buf* X, Buf* Y, int n, bool acc){
    const int mat = cv.rows*cv.cols;
    for(int r = 0; r < cv.rows; r++){ float* y = at(Y, r); float b = cv.hasB ? cv.b[r] : 0.f;
      if(acc){ for(int t = 0; t < n; t++) y[t] += b; } else { for(int t = 0; t < n; t++) y[t] = b; }
      for(int k = 0; k < cv.K; k++){ int off = dil*(k + 1 - cv.K); const float* wr = cv.w.data() + (size_t)k*mat + r*cv.cols;
        for(int c = 0; c < cv.cols; c++){ float wv = wr[c]; if(wv == 0) continue; const float* x = at(X, c) + off; for(int t = 0; t < n; t++) y[t] += wv*x[t]; } } } }
  void act(const Act& a, Buf* B, int row0, int rows, int n){
    if(a.slopes.size() > 1){ for(int r = 0; r < rows; r++){ float* y = at(B, row0 + r); double s = a.slopes[r % a.slopes.size()]; for(int t = 0; t < n; t++) y[t] = actF(5, y[t], s, 0, 0, 0); } return; }
    if(!a.k) return; double s = a.slopes.size() == 1 ? a.slopes[0] : a.a;
    for(int r = 0; r < rows; r++){ float* y = at(B, row0 + r); for(int t = 0; t < n; t++) y[t] = actF(a.k, y[t], s, a.b, a.c, a.d); } }
  void block(const float* in, float* out, int n){
    if(P + n > ROOM){ for(Buf* b : hist){ if(!b->lb) continue; for(int r = 0; r < b->rows; r++){ float* o = F.data() + b->base + r*b->stride; std::memmove(o, o + P, sizeof(float)*b->lb); } } P = 0; }
    const float* cur = in;
    for(size_t si = 0; si < stages.size(); si++){ Stage& s = stages[si]; float* dst = si + 1 == stages.size() ? out : tmp.data();
      if(s.kind == 2){ // linear
        if(s.lp + n > (int)s.lhist.size()){ std::memmove(s.lhist.data(), s.lhist.data() + s.lp - s.rf, sizeof(float)*s.rf); s.lp = s.rf; }
        std::memcpy(s.lhist.data() + s.lp, cur, sizeof(float)*n);
        for(int t = 0; t < n; t++){ double acc = s.bias; int e = s.lp + t; for(int k = 0; k < s.rf; k++) acc += s.ir[k]*s.lhist[e - k]; dst[t] = (float)acc; }
        s.lp += n; }
      else if(s.kind == 1){ // lstm
        const int H = s.H;
        for(int t = 0; t < n; t++){ float x = cur[t];
          for(size_t l = 0; l < s.lstm.size(); l++){ auto& L = s.lstm[l]; float* xh = L.xh.data();
            if(l == 0) xh[0] = x; else std::memcpy(xh, s.lstm[l-1].xh.data() + s.lstm[l-1].I, sizeof(float)*H);
            for(int r = 0; r < 4*H; r++){ float acc = L.b[r]; const float* w = L.W.data() + (size_t)r*L.cols; for(int j = 0; j < L.cols; j++) acc += w[j]*xh[j]; L.g[r] = acc; }
            for(int i = 0; i < H; i++){ float sg = 1/(1 + std::exp(-L.g[H + i])), si2 = 1/(1 + std::exp(-L.g[i])); L.c[i] = sg*L.c[i] + si2*std::tanh(L.g[2*H + i]); }
            for(int i = 0; i < H; i++){ float so = 1/(1 + std::exp(-L.g[3*H + i])); xh[L.I + i] = so*std::tanh(L.c[i]); } }
          auto& last = s.lstm.back(); double y = s.hb; for(int i = 0; i < H; i++) y += s.hw[i]*last.xh[last.I + i]; dst[t] = (float)y; } }
      else { // graph
        std::memcpy(at(s.inBuf, 0), cur, sizeof(float)*n);
        for(auto& op : s.ops) op(*this, n);
        const float* o = at(s.outBuf, 0); for(int t = 0; t < n; t++) dst[t] = (float)(o[t]*s.scale); }
      cur = dst; }
    P += n; }
  void process(const float* in, float* out, int n){ int off = 0; while(off < n){ int m = std::min(BLOCK, n - off); block(in + off, out + off, m); off += m; } }
  void reset(){ for(Buf* b : hist) std::fill(F.begin() + b->base, F.begin() + b->base + b->rows*b->stride, 0.f); P = 0;
    for(auto& s : stages){ if(s.kind == 1) for(auto& L : s.lstm){ std::fill(L.xh.begin(), L.xh.end(), 0.f); std::copy(L.h0.begin(), L.h0.end(), L.xh.begin() + L.I); L.c = L.c0; }
      if(s.kind == 2){ std::fill(s.lhist.begin(), s.lhist.end(), 0.f); s.lp = s.rf; } } }
  void warm(){ std::vector<float> z(BLOCK, 0.f), o(BLOCK); int nb = (prewarm + BLOCK - 1)/BLOCK; for(int i = 0; i < nb; i++) block(z.data(), o.data(), BLOCK); }
};

// ---------------------------------------------------------------- planning
static int ival(const ValueP& v, const char* k){ return (int)v->numOr(k, 0); }
static void planWaveNet(const ValueP& cfg, const std::vector<float>& w, Arena& A, Stage& S){
  Reader rd(w); ValueP arrays = cfg->get("arrays"); if(!arrays || arrays->t != Value::Arr) throw namErr("This model has no layers.");
  int Zmax = 1, Bmax = 1;
  for(auto& a : arrays->a){ int B = ival(a, "B"); Bmax = std::max(Bmax, B); for(auto& l : a->get("layers")->a) Zmax = std::max(Zmax, ival(l, "gate") ? 2*B : B); }
  Buf* cond = A.scratch(1); Buf* Z = A.scratch(Zmax); Buf* PRE = A.scratch(Bmax);
  auto& ops = S.ops;
  auto convOp = [&](Conv cv, int dil, Buf* X, Buf* Y, bool acc){ auto p = std::make_shared<Conv>(std::move(cv)); ops.push_back([p, dil, X, Y, acc](Player& pl, int n){ pl.conv(*p, dil, X, Y, n, acc); }); };
  auto actOp = [&](Act a, Buf* B, int row0, int rows){ if(a.slopes.size() > 1 && (int)a.slopes.size() != rows) throw namErr("This model has the wrong number of PReLU slopes."); ops.push_back([a, B, row0, rows](Player& pl, int n){ pl.act(a, B, row0, rows, n); }); };
  Buf* src = cond; Buf* prevHead = nullptr; int ai = 0;
  for(auto& a : arrays->a){
    int C = ival(a, "C"), B = ival(a, "B"), H = ival(a, "H"), hk = ival(a, "hk"), hd = ival(a, "hd"), gIn = ival(a, "gIn"), gMix = ival(a, "gMix"), inSize = ival(a, "inSize"), condN = ival(a, "cond"); bool hb = a->numOr("hb", 0) != 0;
    ValueP l1v = a->get("l1"), h1v = a->get("h1"); bool l1on = l1v->numOr("on", 0) != 0, h1on = h1v->numOr("on", 0) != 0; int l1g = ival(l1v, "g"), h1out = ival(h1v, "out"), h1g = ival(h1v, "g");
    int HO = h1on ? h1out : B; auto& layers = a->get("layers")->a;
    std::vector<Buf*> lin; for(auto& l : layers) lin.push_back(A.histBuf(C, ival(l, "d")*(ival(l, "K") - 1)));
    Buf* HA = A.histBuf(HO, hd*(hk - 1)); Buf* LO = A.scratch(C); Buf* HOUT = A.scratch(H);
    convOp(dense(rd, 1, C, inSize, 1, false), 0, src, lin[0], false);
    if(ai == 0) ops.push_back([HA, HO](Player& pl, int n){ for(int r = 0; r < HO; r++) std::fill(pl.at(HA, r), pl.at(HA, r) + n, 0.f); });
    else { Buf* ph = prevHead; ops.push_back([HA, ph, HO](Player& pl, int n){ for(int r = 0; r < HO; r++) std::memmove(pl.at(HA, r), pl.at(ph, r), sizeof(float)*n); }); }
    for(size_t li = 0; li < layers.size(); li++){ auto& l = layers[li]; Buf* X = lin[li]; Buf* Y = li + 1 < layers.size() ? lin[li + 1] : LO; int gate = ival(l, "gate"), Zc = gate ? 2*B : B;
      convOp(dense(rd, ival(l, "K"), Zc, C, gIn, true), ival(l, "d"), X, Z, false);
      convOp(dense(rd, 1, Zc, condN, gMix, false), 0, cond, Z, true);
      Act act = readAct(l->get("act")), sec = readAct(l->get("sec"));
      if(gate == 0) actOp(act, Z, 0, B);
      else if(gate == 1){ actOp(act, Z, 0, B); actOp(sec, Z, B, B); ops.push_back([Z, B](Player& pl, int n){ for(int r = 0; r < B; r++){ float* y = pl.at(Z, r); const float* x = pl.at(Z, B + r); for(int t = 0; t < n; t++) y[t] *= x[t]; } }); }
      else { ops.push_back([PRE, Z, B](Player& pl, int n){ for(int r = 0; r < B; r++) std::memmove(pl.at(PRE, r), pl.at(Z, r), sizeof(float)*n); }); actOp(act, Z, 0, B); actOp(sec, Z, B, B);
        ops.push_back([Z, PRE, B](Player& pl, int n){ for(int r = 0; r < B; r++){ float* y = pl.at(Z, r); const float* al = pl.at(Z, B + r); const float* p = pl.at(PRE, r); for(int t = 0; t < n; t++) y[t] = al[t]*y[t] + (1 - al[t])*p[t]; } }); }
      std::unique_ptr<Conv> l1, h1; if(l1on) l1.reset(new Conv(dense(rd, 1, C, B, l1g, true))); if(h1on) h1.reset(new Conv(dense(rd, 1, HO, B, h1g, true)));
      if(h1) convOp(*h1, 0, Z, HA, true); else ops.push_back([HA, Z, B](Player& pl, int n){ for(int r = 0; r < B; r++){ float* y = pl.at(HA, r); const float* x = pl.at(Z, r); for(int t = 0; t < n; t++) y[t] += x[t]; } });
      ops.push_back([Y, X, C](Player& pl, int n){ for(int r = 0; r < C; r++) std::memmove(pl.at(Y, r), pl.at(X, r), sizeof(float)*n); });
      if(l1) convOp(*l1, 0, Z, Y, true); }
    convOp(dense(rd, hk, H, HO, 1, hb), hd, HA, HOUT, false);
    src = LO; prevHead = HOUT; ai++;
  }
  ValueP post = cfg->get("post"); std::vector<Conv> postConvs; Act pact;
  if(post && post->t == Value::Obj){ int cin = ival(post, "inCh"); auto& ks = post->get("ks")->a; pact = readAct(post->get("act"));
    for(size_t i = 0; i < ks.size(); i++){ int cout = i + 1 == ks.size() ? ival(post, "out") : ival(post, "ch"); postConvs.push_back(dense(rd, (int)ks[i]->n, cout, cin, 1, true)); cin = cout; } }
  float scale = rd.one(); if(!rd.done()) throw namErr("This model file is damaged: it has extra numbers.");
  S.inBuf = cond;
  if(!postConvs.empty()){ int cin = ival(post, "inCh"); Buf* prev = prevHead;
    for(size_t i = 0; i < postConvs.size(); i++){ Conv& cv = postConvs[i]; Buf* X = A.histBuf(cin, cv.K - 1); Buf* p = prev; int rows = cin;
      if(i == 0) ops.push_back([X, p, rows, scale](Player& pl, int n){ for(int r = 0; r < rows; r++){ float* y = pl.at(X, r); const float* x = pl.at(p, r); for(int t = 0; t < n; t++) y[t] = x[t]*scale; } });
      else ops.push_back([X, p, rows](Player& pl, int n){ for(int r = 0; r < rows; r++) std::memmove(pl.at(X, r), pl.at(p, r), sizeof(float)*n); });
      actOp(pact, X, 0, rows); Buf* Y = A.scratch(cv.rows); convOp(cv, 1, X, Y, false); prev = Y; cin = cv.rows; }
    S.outBuf = prev; S.scale = 1; }
  else { S.outBuf = prevHead; S.scale = scale; }
}

static void planConvNet(const ValueP& cfg, const std::vector<float>& w, Arena& A, Stage& S){
  Reader rd(w); int C = ival(cfg, "C"), g = cfg->get("g") ? ival(cfg, "g") : 1; bool bn = cfg->numOr("bn", 0) != 0; Act act = readAct(cfg->get("act"));
  std::vector<int> dil; for(auto& d : cfg->get("dil")->a) dil.push_back((int)d->n);
  struct Blk { Conv cv; int d; }; std::vector<Blk> blocks;
  for(size_t i = 0; i < dil.size(); i++){ int cin = i ? C : 1; Conv cv = dense(rd, 2, C, cin, g, !bn);
    if(bn){ auto mean = rd.many(C), vr = rd.many(C), wt = rd.many(C), bs = rd.many(C); float eps = rd.one(); cv.b.assign(C, 0.f); cv.hasB = true;
      for(int o = 0; o < C; o++){ double sc = wt[o]/std::sqrt(eps + vr[o]); cv.b[o] = (float)(bs[o] - sc*mean[o]); for(int k = 0; k < 2; k++) for(int j = 0; j < cin; j++) cv.w[(size_t)k*C*cin + o*cin + j] = (float)(cv.w[(size_t)k*C*cin + o*cin + j]*sc); } }
    blocks.push_back({std::move(cv), dil[i]}); }
  Conv head; head.K = 1; head.rows = 1; head.cols = C; head.w = rd.many(C); head.b = rd.many(1); head.hasB = true;
  if(!rd.done()) throw namErr("This model file is damaged: it has extra numbers.");
  Buf* cond = A.scratch(1); Buf* X0 = A.histBuf(1, blocks[0].d); Buf* X = X0; auto& ops = S.ops;
  ops.push_back([X0, cond](Player& pl, int n){ std::memmove(pl.at(X0, 0), pl.at(cond, 0), sizeof(float)*n); });
  Buf* last = nullptr;
  for(size_t i = 0; i < blocks.size(); i++){ Buf* Y = i + 1 < blocks.size() ? A.histBuf(C, blocks[i + 1].d) : A.scratch(C); Buf* x = X; auto p = std::make_shared<Conv>(std::move(blocks[i].cv)); int d = blocks[i].d;
    ops.push_back([p, d, x, Y](Player& pl, int n){ pl.conv(*p, d, x, Y, n, false); });
    Act a = act; if(a.slopes.size() > 1){ ops.push_back([a, Y, C](Player& pl, int n){ for(int r = 0; r < C; r++){ float* y = pl.at(Y, r); double s = a.slopes[r % a.slopes.size()]; for(int t = 0; t < n; t++) y[t] = actF(5, y[t], s, 0, 0, 0); } }); }
    else ops.push_back([a, Y, C](Player& pl, int n){ pl.act(a, Y, 0, C, n); });
    X = Y; last = Y; }
  Buf* OUT = A.scratch(1); auto hp = std::make_shared<Conv>(std::move(head)); Buf* L = last;
  ops.push_back([hp, L, OUT](Player& pl, int n){ pl.conv(*hp, 0, L, OUT, n, false); });
  S.inBuf = cond; S.outBuf = OUT; S.scale = 1;
}

static void addStage(const ValueP& d, Arena& A, Player& P, std::vector<Stage>& stages){
  std::string arch = d->strOr("arch", "");
  if(arch == "Sequential"){ for(auto& m : d->get("models")->a) addStage(m, A, P, stages); return; }
  ValueP wv = d->get("w"); if(!wv || wv->t != Value::F32) throw namErr("This model file is missing its weights.");
  ValueP cfg = d->get("cfg"); Stage S;
  if(arch == "WaveNet"){ S.kind = 0; planWaveNet(cfg, wv->f, A, S); }
  else if(arch == "ConvNet"){ S.kind = 0; planConvNet(cfg, wv->f, A, S); }
  else if(arch == "LSTM"){ S.kind = 1; Reader rd(wv->f); int L = ival(cfg, "L"), I0 = ival(cfg, "I"), H = ival(cfg, "H"); S.H = H;
    for(int l = 0; l < L; l++){ Stage::L x; x.I = l ? H : I0; x.cols = x.I + H; x.W = rd.many((size_t)4*H*x.cols); x.b = rd.many(4*H); x.h0 = rd.many(H); x.c0 = rd.many(H); x.xh.assign(x.cols, 0.f); x.c = x.c0; x.g.assign(4*H, 0.f); S.lstm.push_back(std::move(x)); }
    S.hw = rd.many(H); S.hb = rd.one(); if(!rd.done()) throw namErr("This model file is damaged: it has extra numbers."); }
  else if(arch == "Linear"){ S.kind = 2; S.rf = ival(cfg, "rf"); bool bias = cfg->numOr("bias", 0) != 0; S.ir.assign(wv->f.begin(), wv->f.begin() + S.rf); S.bias = bias ? wv->f[S.rf] : 0; S.lhist.assign(S.rf + ROOM, 0.f); S.lp = S.rf; }
  else throw namErr("This model type cannot be played.");
  stages.push_back(std::move(S));
}
static std::shared_ptr<Player> buildPlayer(const ValueP& desc){
  auto P = std::make_shared<Player>(); Arena A; addStage(desc, A, *P, P->stages);
  P->F.assign(A.top + 1024, 0.f); for(auto& in : A.inits) std::copy(in.second.begin(), in.second.end(), P->F.begin() + in.first);
  P->hist = A.hist; P->prewarm = (int)desc->numOr("prewarm", 1);
  // the Buf objects must live as long as the player
  struct Holder { std::vector<std::unique_ptr<Buf>> k; }; auto h = std::make_shared<Holder>(); h->k.swap(A.keep);
  P->stages.front().ops.push_back([h](Player&, int){});   // keeps the buffers alive (does nothing)
  P->reset(); P->warm(); return P;
}

// ---------------------------------------------------------------- the processor
struct NamProc : Proc {
  std::shared_ptr<Player> cur, old; bool pass = true, fadeDry = false; double nextId = 0;
  std::vector<float> x = std::vector<float>(MAXQ), y = std::vector<float>(MAXQ), y2 = std::vector<float>(MAXQ);
  struct Prep { std::shared_ptr<Player> p; std::string err; };
  std::shared_ptr<void> prepare(const ValueP& m) override {
    if(m->strOr("cmd", "") != "model") return nullptr; auto r = std::make_shared<Prep>();
    try{ r->p = buildPlayer(m->get("desc")); }catch(std::exception& e){ r->err = e.what(); }
    return r; }
  void message(const ValueP& m, std::shared_ptr<void> pre) override {
    std::string cmd = m->strOr("cmd", "");
    if(cmd == "kill"){ dead = true; return; }
    if(cmd == "clear"){ cur.reset(); old.reset(); pass = true; return; }
    if(cmd == "model" && pre){ auto r = std::static_pointer_cast<Prep>(pre); double id = m->numOr("id", 0);
      auto mk = [&](const char* st){ auto o = Value::obj(); o->set("state", Value::str(st)); o->set("id", m->get("id") ? m->get("id") : Value::num(id)); return o; };
      if(!r->p){ auto o = mk("error"); o->set("error", Value::str(r->err)); post(o); return; }
      auto l = mk("loading"); l->set("wasm", Value::boolean(true)); post(l);
      old = cur; fadeDry = !cur && pass; cur = r->p; pass = false; post(mk("ready")); } }
  bool process(Bus& in, int inCh, Bus& out, int n) override {
    if(dead) return false;
    if(inCh){ for(int t = 0; t < n; t++) x[t] = in.d[0][t]; if(inCh > 1) for(int t = 0; t < n; t++) x[t] = 0.5f*(x[t] + in.d[1][t]); } else std::fill(x.begin(), x.begin() + n, 0.f);
    if(cur){ cur->process(x.data(), y.data(), n);
      if(old){ old->process(x.data(), y2.data(), n); for(int t = 0; t < n; t++){ float f = (float)t/n; y[t] = y[t]*f + y2[t]*(1 - f); } old.reset(); }
      else if(fadeDry){ for(int t = 0; t < n; t++){ float f = (float)t/n; y[t] = y[t]*f + x[t]*(1 - f); } fadeDry = false; } }
    else if(pass) std::copy(x.begin(), x.begin() + n, y.begin()); else std::fill(y.begin(), y.begin() + n, 0.f);
    for(int c = 0; c < out.ch; c++) std::memcpy(out.d[c], y.data(), sizeof(float)*n);
    return true; }
};
Proc* makeNamProc(){ return new NamProc(); }

// for tests: run a parsed model over a buffer
std::vector<float> namRender(const ValueP& desc, const std::vector<float>& x){ auto p = buildPlayer(desc); p->reset(); std::vector<float> y(x.size()); std::vector<float> a(BLOCK), b(BLOCK);
  for(size_t i = 0; i < x.size(); i += BLOCK){ size_t m = std::min<size_t>(BLOCK, x.size() - i); std::fill(a.begin(), a.end(), 0.f); std::copy(x.begin() + i, x.begin() + i + m, a.begin()); p->process(a.data(), b.data(), BLOCK); std::copy(b.begin(), b.begin() + m, y.begin() + i); }
  return y; }

} // namespace np
