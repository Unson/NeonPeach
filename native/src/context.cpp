// The graph: connections, order, automation, and one processing pass.
#include "np.h"
#include <algorithm>
#include <functional>

namespace np {

// ================================================================ automation
void Param::add(Event e){
  if((e.type == Event::Linear || e.type == Event::Expo) && ev.empty()){ e.cached = true; e.t0 = -1; e.v0 = value; }  // ramp with nothing before: from the current value
  auto it = std::upper_bound(ev.begin(), ev.end(), e.time, [](double t, const Event& x){ return t < x.time; });
  ev.insert(it, e);
}
void Param::setValue(float v, double now){ value = v; Event e{Event::SetValue, now, v}; add(e); }
void Param::cancel(double t){ ev.erase(std::remove_if(ev.begin(), ev.end(), [t](const Event& x){ return x.time >= t; }), ev.end()); }

double Param::startOf(size_t i){
  Event& e = ev[i]; if(e.cached) return e.v0;
  double v;
  if(i == 0){ v = value; e.t0 = e.time; }
  else {
    Event& p = ev[i-1];
    if(e.type == Event::Linear || e.type == Event::Expo){
      e.t0 = p.time;
      if(p.type == Event::Target){ double s = startOf(i-1); v = s; } else v = p.value;
    } else {
      e.t0 = e.time;
      if(p.type == Event::Target){ double s = startOf(i-1); v = p.value + (s - p.value)*std::exp(-(e.time - p.time)/std::max(1e-9, p.tc)); }
      else if((p.type == Event::Linear || p.type == Event::Expo) && i >= 1) v = p.value;
      else v = p.value;
    }
  }
  e.cached = true; e.v0 = v; return v;
}

double Param::valueAt(double t, size_t& idx){
  const size_t N = ev.size();
  if(idx > N) idx = 0;
  while(idx < N && ev[idx].time <= t) idx++;             // idx = first event after t
  long i = (long)idx - 1;                                // last event at or before t
  if(idx < N && (ev[idx].type == Event::Linear || ev[idx].type == Event::Expo)){
    Event& r = ev[idx]; double v0 = startOf(idx), t0 = r.t0;
    if(t0 < 0){ r.t0 = t0 = t; }                         // ramp with nothing before starts now
    if(t < t0) return i >= 0 ? ev[i].value : value;
    double f = (t - t0)/std::max(1e-12, r.time - t0);
    if(r.type == Event::Linear) return v0 + (r.value - v0)*f;
    if(v0*r.value <= 0) return v0;
    return v0*std::pow(r.value/v0, f);
  }
  if(i < 0) return value;
  Event& e = ev[i];
  if(e.type == Event::Target){ double s = startOf(i); return e.value + (s - e.value)*std::exp(-(t - e.time)/std::max(1e-9, e.tc)); }
  return e.value;
}

void Param::compute(Context& cx, int n, double t0){
  const double dt = 1.0/cx.sr;
  // drop events that are fully behind us, keeping what later events start from
  while(ev.size() >= 2 && ev[1].time <= t0){ startOf(1); if(ev[0].type != Event::Target) value = (float)ev[0].value; ev.erase(ev.begin()); }
  size_t idx = 0;
  if(ev.size() == 1 && ev[0].time <= t0 && ev[0].type != Event::Target && !(ev[0].type != Event::SetValue && ev[0].cached && ev[0].t0 < 0)){ value = (float)ev[0].value; ev.clear(); }
  if(ev.empty()){ first = value; varying = false; }
  else if(krate){ first = (float)valueAt(t0, idx); varying = false; }
  else { varying = true; for(int k = 0; k < n; k++) vals[k] = (float)valueAt(t0 + k*dt, idx); first = vals[0]; }
  if(!in.empty() && !krate){
    if(!varying){ for(int k = 0; k < n; k++) vals[k] = first; varying = true; }
    for(auto& c : in){ Node* s = c.first; if(s->pass < cx.passNo - 1 || s->pass < 0) continue; Bus& b = *s->outs[c.second]; if(b.silent) continue;
      if(b.ch == 1) for(int k = 0; k < n; k++) vals[k] += b.d[0][k];
      else { float g = 1.f/b.ch; for(int ch = 0; ch < b.ch; ch++) for(int k = 0; k < n; k++) vals[k] += b.d[ch][k]*(b.ch == 2 ? 0.5f : g); } }
  }
  if(varying){ for(int k = 0; k < n; k++){ float v = vals[k]; vals[k] = v != v ? def : clampf(v, mn, mx); } first = vals[0]; }
  else { if(first != first) first = def; first = clampf(first, mn, mx); }
}

// ================================================================ messages
void Node::post(ValueP msg){ cx.postMsg(id, msg); }
void Context::postMsg(int nid, ValueP v){ pend.push_back({nid, v}); if(mm.try_lock()){ for(auto& m : pend) msgs.push_back(std::move(m)); pend.clear(); mm.unlock(); } }
void Context::drainMessages(std::vector<OutMsg>& out){ std::lock_guard<std::mutex> g(mm); for(auto& m : msgs) out.push_back(std::move(m)); msgs.clear(); }
void Context::queue(std::function<void()> fn){ std::lock_guard<std::mutex> g(qm); q.push_back(std::move(fn)); }
std::vector<int> Context::trashAudio(){ std::vector<Node*> t; { std::lock_guard<std::mutex> g(tm); t.swap(trash); } std::vector<int> ids; for(Node* n : t){ ids.push_back(n->id); delete n; }
  std::vector<std::shared_ptr<void>> gb; { std::lock_guard<std::mutex> g(gm); gb.swap(garbage); } return ids; }
void Context::postFromPage(int nid, ValueP v){ std::lock_guard<std::mutex> g(mm); msgs.push_back({nid, v}); }

// ================================================================ connections
void Context::connect(Node* s, int o, Node* d, int i){
  if(o < 0 || o >= (int)s->outs.size() || i < 0 || i >= (int)d->ins.size()) return;
  auto& c = d->ins[i]->conn; for(auto& x : c) if(x.first == s && x.second == o) return;
  c.emplace_back(s, o); s->outConn.push_back({d, i, nullptr, o}); dirty();
}
void Context::connectParam(Node* s, int o, Param* p){
  if(o < 0 || o >= (int)s->outs.size() || !p) return;
  for(auto& x : p->in) if(x.first == s && x.second == o) return;
  Node* owner = nullptr; for(auto& kv : nodes) for(auto& pp : kv.second->params) if(pp.get() == p){ owner = kv.second; break; }
  p->in.emplace_back(s, o); s->outConn.push_back({owner, -1, p, o}); dirty();
}
// d==nullptr: every destination. o<0: every output. i<0: every input of d (and its params when p is null).
void Context::disconnect(Node* s, int o, Node* d, int i){
  auto& oc = s->outConn;
  for(size_t k = 0; k < oc.size();){
    auto& x = oc[k];
    bool m = (o < 0 || x.output == o) && (!d || x.node == d) && (i < 0 || (x.param == nullptr && x.input == i));
    if(!m){ k++; continue; }
    if(x.param){ auto& v = x.param->in; v.erase(std::remove(v.begin(), v.end(), std::make_pair(s, x.output)), v.end()); }
    else if(x.node && x.input >= 0 && x.input < (int)x.node->ins.size()){ auto& v = x.node->ins[x.input]->conn; v.erase(std::remove(v.begin(), v.end(), std::make_pair(s, x.output)), v.end()); }
    oc.erase(oc.begin() + k);
  }
  dirty();
}
void Context::disconnectParamAll(Node* s){
  auto& oc = s->outConn;
  for(size_t k = 0; k < oc.size();){ auto& x = oc[k]; if(!x.param){ k++; continue; } auto& v = x.param->in; v.erase(std::remove(v.begin(), v.end(), std::make_pair(s, x.output)), v.end()); oc.erase(oc.begin() + k); }
  dirty();
}
void Context::release(Node* n){ n->released = true; }

// ================================================================ order
// Nodes that matter are those that feed the destination or a node that runs by itself (analysers, processors).
// In a loop, the edge back to a node still being worked on reads that node's previous pass (Chromium does the same).
void Context::sortGraph(){
  topoDirty = false;
  std::vector<Node*> all; for(auto& kv : nodes) all.push_back(kv.second);
  std::map<Node*, int> ix; for(size_t k = 0; k < all.size(); k++) ix[all[k]] = (int)k;
  auto depsOf = [&](Node* v, std::vector<int>& out){ out.clear();
    for(auto& in : v->ins) for(auto& c : in->conn){ auto it = ix.find(c.first); if(it != ix.end()) out.push_back(it->second); }
    for(auto& p : v->params) for(auto& c : p->in){ auto it = ix.find(c.first); if(it != ix.end()) out.push_back(it->second); } };
  // what matters
  std::vector<char> want(all.size(), 0); std::vector<int> st, deps;
  for(size_t k = 0; k < all.size(); k++) if(all[k] == dest || all[k]->autoPull()){ want[k] = 1; st.push_back((int)k); }
  while(!st.empty()){ int v = st.back(); st.pop_back(); depsOf(all[v], deps); for(int u : deps) if(!want[u]){ want[u] = 1; st.push_back(u); } }
  // Loops: like Chromium, a node pulled while it is still being worked on hands over its output from the
  // previous pass (one block late), so every loop adds one block. Delay times are not clamped (checked against Chrome).
  std::vector<char> inLoop(all.size(), 0);
  {
    const int N = (int)all.size(); std::vector<int> index(N, -1), low(N, 0), comp(N, -1); std::vector<char> on(N, 0); std::vector<int> stk; int counter = 0, comps = 0;
    std::vector<std::vector<int>> adj(N); for(int v = 0; v < N; v++) if(want[v]) depsOf(all[v], adj[v]);
    std::function<void(int)> strong = [&](int v){
      index[v] = low[v] = counter++; stk.push_back(v); on[v] = 1;
      for(int u : adj[v]){ if(!want[u]) continue; if(index[u] < 0){ strong(u); low[v] = std::min(low[v], low[u]); } else if(on[u]) low[v] = std::min(low[v], index[u]); }
      if(low[v] == index[v]){ while(true){ int w = stk.back(); stk.pop_back(); on[w] = 0; comp[w] = comps; if(w == v) break; } comps++; } };
    for(int v = 0; v < N; v++) if(want[v] && index[v] < 0) strong(v);
    std::vector<int> size(comps, 0); for(int v = 0; v < N; v++) if(comp[v] >= 0) size[comp[v]]++;
    for(int v = 0; v < N; v++) if(want[v] && comp[v] >= 0){ bool cyc = size[comp[v]] > 1; for(int u : adj[v]) if(u == v) cyc = true; inLoop[v] = cyc; }
  }
  order.clear(); delayWrites.clear();
  std::vector<char> state(all.size(), 0);
  std::function<void(int)> visit = [&](int v){
    state[v] = 1; std::vector<int> d; depsOf(all[v], d);
    for(int u : d) if(want[u] && state[u] == 0) visit(u);       // state 1 = on the way: that edge reads last pass
    order.push_back(all[v]); state[v] = 2; };
  int di = ix.count(dest) ? ix[dest] : -1; if(di >= 0 && want[di]) visit(di);
  for(size_t k = 0; k < all.size(); k++) if(want[k] && state[k] == 0) visit((int)k);
  for(size_t k = 0; k < all.size(); k++) if(all[k]->isDelay()) all[k]->setProp("__loop", Value::boolean(inLoop[k] != 0));
}

// ================================================================ mixing
void mixInto(Bus& dst, const Bus& src, int dstCh, bool discrete, int n){
  const int sc = src.ch;
  if(sc == dstCh){ for(int c = 0; c < sc; c++){ float* d = dst.d[c]; const float* s = src.d[c]; for(int k = 0; k < n; k++) d[k] += s[k]; } return; }
  if(!discrete){
    if(sc == 1 && dstCh == 2){ const float* s = src.d[0]; for(int k = 0; k < n; k++){ dst.d[0][k] += s[k]; dst.d[1][k] += s[k]; } return; }
    if(sc == 2 && dstCh == 1){ const float* l = src.d[0]; const float* r = src.d[1]; for(int k = 0; k < n; k++) dst.d[0][k] += 0.5f*(l[k] + r[k]); return; }
    if(sc == 1 && dstCh > 2){ const float* s = src.d[0]; if(dstCh == 4){ for(int k = 0; k < n; k++){ dst.d[0][k] += s[k]; dst.d[1][k] += s[k]; } return; } }
  }
  const int m = std::min(sc, dstCh); for(int c = 0; c < m; c++){ float* d = dst.d[c]; const float* s = src.d[c]; for(int k = 0; k < n; k++) d[k] += s[k]; }
}

void Context::mixInput(Node* nd, Input& in, int n){
  int mx = 0; bool any = false;
  for(auto& c : in.conn){ Node* s = c.first; if(s->pass < passNo - 1 || s->pass < 0) continue; mx = std::max(mx, s->outs[c.second]->ch); any = true; }
  int ch;
  if(nd->mode == Node::Explicit) ch = nd->channelCount;
  else { ch = any ? mx : 1; if(nd->mode == Node::ClampedMax) ch = std::min(ch, nd->channelCount); }
  ch = std::max(1, std::min(MAXCH, ch));
  in.computed = ch; Bus& b = in.bus; b.setCh(ch);
  bool silent = true;
  for(auto& c : in.conn){ Node* s = c.first; if(s->pass < passNo - 1 || s->pass < 0) continue; if(!s->outs[c.second]->silent){ silent = false; break; } }
  if(silent){ if(!b.silent) b.zero(n); else for(int k = 0; k < ch; k++) std::memset(b.d[k], 0, sizeof(float)*n); b.silent = true; return; }
  for(int k = 0; k < ch; k++) std::memset(b.d[k], 0, sizeof(float)*n);
  for(auto& c : in.conn){ Node* s = c.first; if(s->pass < passNo - 1 || s->pass < 0) continue; Bus& sb = *s->outs[c.second]; if(sb.silent) continue; mixInto(b, sb, ch, nd->discrete, n); }
  b.silent = false;
}

// ================================================================ one pass
void Context::runPass(int n, int off, float* const* out, int outN){
  { std::unique_lock<std::mutex> g(qm, std::try_to_lock); if(g.owns_lock()) work.swap(q); }
  for(auto& f : work) f(); work.clear();
  if(topoDirty) sortGraph();
  passNo++; quantum = n;
  const double t0 = now();
  for(Node* v : order){
    for(auto& p : v->params) p->compute(*this, n, t0);
    for(auto& in : v->ins) mixInput(v, *in, n);
    if(v->dead){ for(auto& b : v->outs) if(!b->silent) b->zero(n); }
    else v->process(n);
    v->pass = passNo;
  }
  // to the device
  for(int c = 0; c < outN; c++){ float* o = out[c] + off;
    if(dest && dest->pass == passNo && c < dest->ins[0]->bus.ch && !dest->ins[0]->bus.silent) std::memcpy(o, dest->ins[0]->bus.d[c], sizeof(float)*n);
    else std::memset(o, 0, sizeof(float)*n); }
  frame += n; framePub.store(frame, std::memory_order_release); nodeCount.store((int)nodes.size(), std::memory_order_relaxed);
  if((passNo & 63) == 0) sweep();
}

void Context::render(const float* const* in, int inN, float* const* out, int outN, int n){
  int off = 0;
  while(off < n){
    int m = std::min(MAXQ, n - off);
    static thread_local const float* ins[MAXCH];
    for(int c = 0; c < inN && c < MAXCH; c++) ins[c] = in[c] + off;
    devIn = ins; devInN = std::min(inN, MAXCH);
    runPass(m, off, out, outN);
    off += m;
  }
}

// free nodes the page let go of once nothing can be heard from them
void Context::sweep(){
  for(int round = 0; round < 4; round++){
    std::vector<Node*> kill;
    for(auto& kv : nodes){ Node* v = kv.second; if(!v->released || v == dest) continue;
      bool hasIn = false; for(auto& in : v->ins) if(!in->conn.empty()) hasIn = true; for(auto& p : v->params) if(!p->in.empty()) hasIn = true;
      bool outSilent = true; for(auto& b : v->outs) if(!b->silent) outSilent = false;
      if(v->outConn.empty() && (!v->autoPull() || v->dead || !hasIn)) kill.push_back(v);
      else if(v->isSource() && v->dead) kill.push_back(v);                 // a source that has ended
      else if(!v->isSource() && !hasIn && outSilent) kill.push_back(v);    // nothing feeds it and its tail is gone
    }
    if(kill.empty()) break;
    for(Node* v : kill){
      disconnect(v, -1, nullptr, -1);
      for(auto& kv : nodes){ Node* s = kv.second; if(s == v) continue; disconnect(s, -1, v, -1); }
      nodes.erase(v->id);
      std::lock_guard<std::mutex> g(tm); trash.push_back(v);
    }
  }
}

} // namespace np
