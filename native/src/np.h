// Neon Peach native audio engine.
// A small Web Audio graph engine in C++. The app's JavaScript builds the same graphs it builds in the
// browser; this engine runs them against the audio interface (ASIO, Core Audio, WASAPI, ALSA).
#pragma once
#include <cstdint>
#include <cstring>
#include <cmath>
#include <string>
#include <vector>
#include <map>
#include <memory>
#include <mutex>
#include <functional>
#include <atomic>
#include <cstdlib>

namespace np {

constexpr int MAXCH = 8;        // most channels on any bus
constexpr int MAXQ = 512;       // most frames in one processing pass

// ---------------------------------------------------------------- values passed with port messages
struct Value;
using ValueP = std::shared_ptr<Value>;
struct Value {
  enum T { Null, Bool, Num, Str, Arr, Obj, F32 } t = Null;
  bool b = false; double n = 0; std::string s;
  std::vector<ValueP> a; std::vector<std::pair<std::string, ValueP>> o; std::vector<float> f;
  static ValueP null(){ return std::make_shared<Value>(); }
  static ValueP num(double v){ auto p = std::make_shared<Value>(); p->t = Num; p->n = v; return p; }
  static ValueP boolean(bool v){ auto p = std::make_shared<Value>(); p->t = Bool; p->b = v; return p; }
  static ValueP str(const std::string& v){ auto p = std::make_shared<Value>(); p->t = Str; p->s = v; return p; }
  static ValueP obj(){ auto p = std::make_shared<Value>(); p->t = Obj; return p; }
  static ValueP arr(){ auto p = std::make_shared<Value>(); p->t = Arr; return p; }
  static ValueP f32(std::vector<float>&& v){ auto p = std::make_shared<Value>(); p->t = F32; p->f = std::move(v); return p; }
  ValueP get(const std::string& k) const { if(t == Obj) for(auto& kv : o) if(kv.first == k) return kv.second; return nullptr; }
  void set(const std::string& k, ValueP v){ for(auto& kv : o) if(kv.first == k){ kv.second = v; return; } o.emplace_back(k, v); }
  double numOr(const std::string& k, double d) const { auto v = get(k); if(!v) return d; if(v->t == Num) return v->n; if(v->t == Bool) return v->b ? 1 : 0; return d; }
  std::string strOr(const std::string& k, const std::string& d) const { auto v = get(k); return v && v->t == Str ? v->s : d; }
  bool truthy() const { switch(t){ case Bool: return b; case Num: return n != 0 && n == n; case Str: return !s.empty(); case Null: return false; default: return true; } }
};

// ---------------------------------------------------------------- a bus: channels of float frames
constexpr int MAXQB = 512;      // frames a bus holds; bigger device buffers are split into passes
struct Bus {
  int ch = 1; bool silent = true; int cap = 0;
  float* d[MAXCH] = {nullptr};
  std::vector<float> store;
  explicit Bus(int pre = 2){ ensure(pre); }
  void ensure(int c){ if(c <= cap) return; store.resize((size_t)c*MAXQB, 0.f); cap = c; for(int i = 0; i < cap; i++) d[i] = store.data() + (size_t)i*MAXQB; }
  void setCh(int c){ ensure(c); ch = c; }
  void zero(int n){ for(int c = 0; c < ch; c++) std::memset(d[c], 0, sizeof(float)*n); silent = true; }
};

class Context;
class Node;

// ---------------------------------------------------------------- automation
struct Event {
  enum T { SetValue, Linear, Expo, Target } type;
  double time, value, tc = 0;
  bool cached = false; double t0 = 0, v0 = 0;    // where a ramp or target starts
};

class Param {
public:
  Param(const std::string& name, float def, float mn = -3.4e38f, float mx = 3.4e38f, bool krate = false)
    : name(name), def(def), value(def), mn(mn), mx(mx), krate(krate) {}
  std::string name; float def, value, mn, mx; bool krate;
  std::vector<Event> ev;
  std::vector<std::pair<Node*, int>> in;     // audio-rate connections into this param
  // results for this pass
  float vals[MAXQ]; bool varying = false; float first = 0;
  double tgtTime = -1; float tgtVal = 0; int64_t tgtFrame = -1;   // running state of the current setTarget glide (Chromium steps it in float)
  void setValue(float v, double now);
  void add(Event e);
  void cancel(double t);
  void compute(Context& cx, int n, double t0);  // fills vals / first, varying
  float at(int i) const { return varying ? vals[i] : first; }
private:
  double valueAt(double t, size_t& idx);
  double startOf(size_t i);
};

// ---------------------------------------------------------------- nodes
struct Input {
  std::vector<std::pair<Node*, int>> conn;   // (source node, source output index)
  Bus bus; int computed = 1;
};

class Node {
public:
  explicit Node(Context& cx) : cx(cx) {}
  virtual ~Node() {}
  Context& cx;
  int id = 0;
  std::vector<std::unique_ptr<Input>> ins;
  std::vector<std::unique_ptr<Bus>> outs;
  std::vector<std::unique_ptr<Param>> params;
  struct Out { Node* node; int input; Param* param; int output; };
  std::vector<Out> outConn;     // where this node's outputs go
  int channelCount = 2; enum Mode { Max, ClampedMax, Explicit } mode = Max; bool discrete = false;
  bool released = false;       // the page no longer holds this node
  bool muted = false;          // in a cycle with no delay: outputs silence, as Web Audio does
  bool dead = false;           // a processor that returned false
  int pass = -1;               // last pass this node ran in
  virtual const char* kind() const = 0;
  virtual bool isSource() const { return false; }     // produces sound with no inputs
  virtual bool autoPull() const { return false; }     // runs even when nothing downstream pulls it
  virtual bool hasTail() const { return false; }      // keeps sounding after its inputs stop
  virtual bool isDelay() const { return false; }
  virtual void process(int n) = 0;                    // ins[*].bus are mixed; fill outs
  virtual void message(const ValueP&) {}              // from the page (worklet port)
  virtual void setProp(const std::string&, const ValueP&) {}
  virtual void setData(const std::string&, std::vector<std::vector<float>>&&, double) {}
  Param* param(const std::string& name){ for(auto& p : params) if(p->name == name) return p.get(); return nullptr; }
  Param* addParam(const std::string& name, float def, float mn = -3.4e38f, float mx = 3.4e38f, bool krate = false){
    params.emplace_back(new Param(name, def, mn, mx, krate)); return params.back().get(); }
  void addIn(int pre = 2){ ins.emplace_back(new Input()); ins.back()->bus.ensure(pre); }
  void addOut(int ch){ outs.emplace_back(new Bus(ch < 2 ? 2 : ch)); outs.back()->ch = ch; }
  bool inputSilent(int i = 0) const { return ins[i]->bus.silent; }
  void post(ValueP msg);    // to the page (worklet port)
};

// ---------------------------------------------------------------- the context
struct Cmd { std::function<void()> fn; };
struct OutMsg { int id; ValueP v; };

class Context {
public:
  Context(double sampleRate, int outChannels, int inChannels);
  ~Context();
  double sr; int outCh, inCh;
  int64_t frame = 0;                  // frames rendered so far
  double now() const { return frame / sr; }
  int quantum = 128;
  int passNo = 0;

  // made on the page thread, used on the audio thread
  Node* make(const std::string& type, int id, const ValueP& opts);
  void queue(std::function<void()> fn);     // run at the start of the next pass on the audio thread
  void render(const float* const* in, int inN, float* const* out, int outN, int n);  // one device callback
  void drainMessages(std::vector<OutMsg>& out);
  std::vector<int> trashAudio();             // free nodes the audio thread let go of (page thread); returns their ids
  void postFromPage(int id, ValueP v);       // a message to the page, sent from the page thread
  std::atomic<int64_t> framePub{0};          // frames rendered, readable from any thread
  std::atomic<int> xruns{0}; std::atomic<int> nodeCount{0};
  std::vector<std::shared_ptr<void>> garbage; std::mutex gm;   // freed on the page thread

  // used on the audio thread
  std::map<int, Node*> nodes;
  Node* dest = nullptr;      // destination
  std::vector<Node*> inputs; // device input nodes
  const float* const* devIn = nullptr; int devInN = 0;
  void connect(Node* s, int o, Node* d, int i);
  void connectParam(Node* s, int o, Param* p);
  void disconnect(Node* s, int o, Node* d, int i);   // d==nullptr: all from output o; o<0: everything
  void disconnectParamAll(Node* s);
  void dirty(){ topoDirty = true; }
  void postMsg(int id, ValueP v);
  void release(Node* n);
  std::vector<std::pair<std::string, double>> stats;

private:
  std::mutex qm; std::vector<std::function<void()>> q, work;
  std::mutex mm; std::vector<OutMsg> msgs, pend;
  std::mutex tm; std::vector<Node*> trash;
  bool topoDirty = true;
  std::vector<Node*> order;                 // processing order
  std::vector<Node*> delayWrites;           // delays split because they sit in a cycle
  void sortGraph();
  void runPass(int n, int off, float* const* out, int outN);
  void mixInput(Node* nd, Input& in, int n);
  void sweep();
};

// helpers shared by nodes
void mixInto(Bus& dst, const Bus& src, int dstCh, bool discrete, int n);
inline float clampf(float v, float a, float b){ return v < a ? a : (v > b ? b : v); }

} // namespace np
