// Node-API binding: the page's audio commands go in, messages and the clock come out.
// The audio device runs through RtAudio (ASIO / WASAPI / DirectSound on Windows, Core Audio on Mac, ALSA on Linux).
#define NAPI_DISABLE_CPP_EXCEPTIONS
#define NODE_ADDON_API_DISABLE_DEPRECATED
#include <napi.h>
#include "np.h"
#include "RtAudio.h"
#include <thread>
#include <chrono>
#include <algorithm>

namespace np {
std::shared_ptr<void> prepareWorklet(Node* n, const ValueP& m);
void deliverWorklet(Node* n, const ValueP& m, std::shared_ptr<void> pre);
std::vector<float> namRender(const ValueP& desc, const std::vector<float>& x);
std::shared_ptr<void> convPrepare(std::vector<std::vector<float>>&& d, double sr, bool normalize);
void convApply(Node* n, std::shared_ptr<void> p);
}
using namespace np;

// ---------------------------------------------------------------- values
static ValueP toValue(const Napi::Value& v, int depth = 0){
  if(depth > 64) return Value::null();
  if(v.IsNull() || v.IsUndefined()) return Value::null();
  if(v.IsBoolean()) return Value::boolean(v.As<Napi::Boolean>().Value());
  if(v.IsNumber()) return Value::num(v.As<Napi::Number>().DoubleValue());
  if(v.IsString()) return Value::str(v.As<Napi::String>().Utf8Value());
  if(v.IsTypedArray()){ auto ta = v.As<Napi::TypedArray>(); std::vector<float> f(ta.ElementLength());
    if(ta.TypedArrayType() == napi_float32_array){ auto a = v.As<Napi::Float32Array>(); std::memcpy(f.data(), a.Data(), f.size()*sizeof(float)); }
    else if(ta.TypedArrayType() == napi_float64_array){ auto a = v.As<Napi::Float64Array>(); for(size_t i = 0; i < f.size(); i++) f[i] = (float)a[i]; }
    else if(ta.TypedArrayType() == napi_int32_array){ auto a = v.As<Napi::Int32Array>(); for(size_t i = 0; i < f.size(); i++) f[i] = (float)a[i]; }
    else if(ta.TypedArrayType() == napi_uint8_array){ auto a = v.As<Napi::Uint8Array>(); for(size_t i = 0; i < f.size(); i++) f[i] = (float)a[i]; }
    return Value::f32(std::move(f)); }
  if(v.IsArray()){ auto a = v.As<Napi::Array>(); auto r = Value::arr(); for(uint32_t i = 0; i < a.Length(); i++) r->a.push_back(toValue(a.Get(i), depth + 1)); return r; }
  if(v.IsObject()){ auto o = v.As<Napi::Object>(); auto r = Value::obj(); auto keys = o.GetPropertyNames(); for(uint32_t i = 0; i < keys.Length(); i++){ auto k = keys.Get(i).ToString(); r->o.emplace_back(k.Utf8Value(), toValue(o.Get(k), depth + 1)); } return r; }
  return Value::null();
}
static Napi::Value fromValue(Napi::Env env, const ValueP& v){
  if(!v) return env.Null();
  switch(v->t){
    case Value::Null: return env.Null();
    case Value::Bool: return Napi::Boolean::New(env, v->b);
    case Value::Num: return Napi::Number::New(env, v->n);
    case Value::Str: return Napi::String::New(env, v->s);
    case Value::F32: { auto a = Napi::Float32Array::New(env, v->f.size()); if(!v->f.empty()) std::memcpy(a.Data(), v->f.data(), v->f.size()*sizeof(float)); return a; }
    case Value::Arr: { auto a = Napi::Array::New(env, v->a.size()); for(size_t i = 0; i < v->a.size(); i++) a.Set((uint32_t)i, fromValue(env, v->a[i])); return a; }
    case Value::Obj: { auto o = Napi::Object::New(env); for(auto& kv : v->o) o.Set(kv.first, fromValue(env, kv.second)); return o; }
  }
  return env.Null();
}

// ---------------------------------------------------------------- the engine object
class Engine : public Napi::ObjectWrap<Engine> {
public:
  static Napi::Object Init(Napi::Env env, Napi::Object exports){
    Napi::Function f = DefineClass(env, "Engine", {
      InstanceMethod("cmd", &Engine::Cmd), InstanceMethod("poll", &Engine::Poll), InstanceMethod("render", &Engine::Render),
      InstanceMethod("open", &Engine::Open), InstanceMethod("close", &Engine::Close), InstanceMethod("info", &Engine::Info) });
    exports.Set("Engine", f);
    exports.Set("devices", Napi::Function::New(env, Devices));
    exports.Set("namRender", Napi::Function::New(env, NamRender));
    return exports; }

  Engine(const Napi::CallbackInfo& info) : Napi::ObjectWrap<Engine>(info){
    double sr = 48000; int outCh = 2, inCh = 2;
    if(info.Length() > 0 && info[0].IsObject()){ auto o = info[0].As<Napi::Object>(); if(o.Has("sampleRate")) sr = o.Get("sampleRate").ToNumber().DoubleValue(); if(o.Has("outChannels")) outCh = o.Get("outChannels").ToNumber().Int32Value(); }
    makeContext(sr, outCh, inCh); }
  ~Engine(){ stop(); }

private:
  std::unique_ptr<Context> cx; std::map<int, Node*> pageNodes; std::map<int, std::string> kinds; std::map<int, bool> convNorm;
  std::unique_ptr<RtAudio> rt; std::thread nullThread; std::atomic<bool> nullRun{false};
  std::string api, devName; double streamSr = 0; unsigned bufFrames = 0; int outN = 2, inN = 2; double outLat = 0, inLat = 0; bool fakeIn = false; std::vector<float> fake[2]; double fakePh = 0;
  std::vector<std::string> errors;

  void makeContext(double sr, int outCh, int inCh){ cx.reset(new Context(sr, outCh, inCh)); pageNodes.clear(); pageNodes[1] = cx->dest; kinds.clear(); }
  Node* node(int id){ auto it = pageNodes.find(id); return it == pageNodes.end() ? nullptr : it->second; }
  void collect(){ for(int id : cx->trashAudio()){ pageNodes.erase(id); kinds.erase(id); convNorm.erase(id); } }

  // ops: arrays like ['c', id, type, opts] (see shim.js for the full list)
  Napi::Value Cmd(const Napi::CallbackInfo& info){
    Napi::Env env = info.Env(); if(!info[0].IsArray()) return env.Undefined();
    collect();
    auto ops = info[0].As<Napi::Array>(); Context* C = cx.get();
    for(uint32_t i = 0; i < ops.Length(); i++){
      Napi::Value ov = ops.Get(i); if(!ov.IsArray()) continue; auto op = ov.As<Napi::Array>(); std::string k = op.Get(0u).ToString().Utf8Value();
      auto I = [&](uint32_t j){ return op.Get(j).ToNumber().Int32Value(); }; auto D = [&](uint32_t j){ return op.Get(j).ToNumber().DoubleValue(); };
      if(k == "c"){ int id = I(1); std::string type = op.Get(2u).ToString().Utf8Value(); ValueP opts = toValue(op.Get(3u));
        Node* n = C->make(type, id, opts); if(!n){ errors.push_back("unknown node " + type); continue; }
        pageNodes[id] = n; kinds[id] = type;
        if(type == "input") C->queue([C, n]{ C->nodes[n->id] = n; C->inputs.push_back(n); C->dirty(); });
        else C->queue([C, n]{ C->nodes[n->id] = n; C->dirty(); }); }
      else if(k == "x"){ Node* s = node(I(1)); Node* d = node(I(3)); int o = I(2), in = I(4); if(s && d) C->queue([C, s, o, d, in]{ C->connect(s, o, d, in); }); }
      else if(k == "xp"){ Node* s = node(I(1)); Node* d = node(I(3)); int o = I(2); std::string pn = op.Get(4u).ToString().Utf8Value(); if(s && d){ Param* p = d->param(pn); if(p) C->queue([C, s, o, p]{ C->connectParam(s, o, p); }); } }
      else if(k == "dx"){ Node* s = node(I(1)); int o = I(2), dId = I(3), in = I(4); Node* d = dId ? node(dId) : nullptr; std::string pn = op.Length() > 5 && op.Get(5u).IsString() ? op.Get(5u).ToString().Utf8Value() : "";
        if(!s || (dId && !d)) continue;
        if(!pn.empty()){ Param* p = d->param(pn); if(p) C->queue([C, s, p]{ auto& oc = s->outConn; for(size_t q = 0; q < oc.size();){ if(oc[q].param == p){ auto& v = p->in; v.erase(std::remove(v.begin(), v.end(), std::make_pair(s, oc[q].output)), v.end()); oc.erase(oc.begin() + q); } else q++; } C->dirty(); }); }
        else C->queue([C, s, o, d, in]{ C->disconnect(s, o, d, in); }); }
      else if(k == "p"){ Node* n = node(I(1)); if(!n) continue; Param* p = n->param(op.Get(2u).ToString().Utf8Value()); if(!p) continue;
        std::string m = op.Get(3u).ToString().Utf8Value(); double a = D(4), b = op.Length() > 5 ? D(5) : 0, c = op.Length() > 6 ? D(6) : 0;
        C->queue([C, p, m, a, b, c]{
          if(m == "v") p->setValue((float)a, C->now());
          else if(m == "set") p->add({Event::SetValue, b, a});
          else if(m == "lin") p->add({Event::Linear, b, a});
          else if(m == "exp") p->add({Event::Expo, b, a});
          else if(m == "tgt"){ Event e{Event::Target, b, a}; e.tc = c; p->add(e); }
          else if(m == "cancel") p->cancel(a); }); }
      else if(k == "pr"){ Node* n = node(I(1)); if(!n) continue; std::string key = op.Get(2u).ToString().Utf8Value(); ValueP v = toValue(op.Get(3u)); if(key == "normalize") convNorm[I(1)] = v->truthy(); C->queue([n, key, v]{ n->setProp(key, v); if(key == "start" || key == "stop") n->cx.dirty(); }); }
      else if(k == "d"){ Node* n = node(I(1)); if(!n) continue; std::string key = op.Get(2u).ToString().Utf8Value(); std::vector<std::vector<float>> data; double sr = op.Length() > 4 ? D(4) : C->sr;
        if(op.Get(3u).IsArray()){ auto chs = op.Get(3u).As<Napi::Array>(); for(uint32_t c = 0; c < chs.Length(); c++){ auto a = chs.Get(c).As<Napi::Float32Array>(); data.emplace_back(a.Data(), a.Data() + a.ElementLength()); } }
        auto sp = std::make_shared<std::vector<std::vector<float>>>(std::move(data));
        // heavy set-up (FFT of an IR) runs here on the page thread for convolvers
        if(kinds[I(1)] == "convolver"){ bool nm = convNorm.count(I(1)) ? convNorm[I(1)] : true; auto pre = convPrepare(std::move(*sp), sr, nm); C->queue([n, pre]{ convApply(n, pre); }); }
        else C->queue([n, key, sp, sr]{ n->setData(key, std::move(*sp), sr); }); }
      else if(k == "m"){ Node* n = node(I(1)); if(!n) continue; ValueP v = toValue(op.Get(2u)); auto pre = prepareWorklet(n, v); C->queue([n, v, pre]{ deliverWorklet(n, v, pre); }); }
      else if(k == "r"){ Node* n = node(I(1)); if(!n || n == C->dest) continue; C->queue([C, n]{ C->release(n); }); }
    }
    return env.Undefined(); }

  Napi::Value Poll(const Napi::CallbackInfo& info){
    Napi::Env env = info.Env(); collect();
    std::vector<OutMsg> msgs; cx->drainMessages(msgs);
    auto o = Napi::Object::New(env); o.Set("frame", Napi::Number::New(env, (double)cx->framePub.load())); o.Set("sampleRate", Napi::Number::New(env, cx->sr));
    o.Set("wall", Napi::Number::New(env, (double)std::chrono::duration_cast<std::chrono::microseconds>(std::chrono::steady_clock::now().time_since_epoch()).count()/1000.0));
    o.Set("xruns", Napi::Number::New(env, cx->xruns.load())); o.Set("nodes", Napi::Number::New(env, cx->nodeCount.load()));
    auto a = Napi::Array::New(env, msgs.size()); for(size_t i = 0; i < msgs.size(); i++){ auto m = Napi::Array::New(env, 2); m.Set(0u, Napi::Number::New(env, msgs[i].id)); m.Set(1u, fromValue(env, msgs[i].v)); a.Set((uint32_t)i, m); }
    o.Set("msgs", a);
    if(!errors.empty()){ auto e = Napi::Array::New(env, errors.size()); for(size_t i = 0; i < errors.size(); i++) e.Set((uint32_t)i, Napi::String::New(env, errors[i])); o.Set("errors", e); errors.clear(); }
    return o; }

  // offline: render(frames, [inputCh0, inputCh1]) -> [out channels]
  Napi::Value Render(const Napi::CallbackInfo& info){
    Napi::Env env = info.Env(); int frames = info[0].ToNumber().Int32Value(); int q = info.Length() > 2 ? info[2].ToNumber().Int32Value() : 128;
    std::vector<std::vector<float>> in(2, std::vector<float>(frames, 0.f));
    if(info.Length() > 1 && info[1].IsArray()){ auto a = info[1].As<Napi::Array>(); for(uint32_t c = 0; c < a.Length() && c < 2; c++){ auto f = a.Get(c).As<Napi::Float32Array>(); size_t n = std::min<size_t>(frames, f.ElementLength()); std::memcpy(in[c].data(), f.Data(), n*sizeof(float)); } }
    int oc = cx->outCh; std::vector<std::vector<float>> out(oc, std::vector<float>(frames, 0.f));
    for(int off = 0; off < frames; off += q){ int m = std::min(q, frames - off); const float* ip[2] = {in[0].data() + off, in[1].data() + off}; std::vector<float*> op(oc); for(int c = 0; c < oc; c++) op[c] = out[c].data() + off; cx->render(ip, 2, op.data(), oc, m); }
    auto r = Napi::Array::New(env, oc); for(int c = 0; c < oc; c++){ auto f = Napi::Float32Array::New(env, frames); std::memcpy(f.Data(), out[c].data(), frames*sizeof(float)); r.Set((uint32_t)c, f); }
    return r; }

  // ---------------------------------------------------------------- devices
  static Napi::Value Devices(const Napi::CallbackInfo& info){
    Napi::Env env = info.Env(); auto list = Napi::Array::New(env); uint32_t k = 0;
    std::vector<RtAudio::Api> apis; RtAudio::getCompiledApi(apis);
    for(auto a : apis){ if(a == RtAudio::RTAUDIO_DUMMY) continue; RtAudio r(a); r.showWarnings(false);
      for(unsigned id : r.getDeviceIds()){ RtAudio::DeviceInfo d = r.getDeviceInfo(id); auto o = Napi::Object::New(env);
        o.Set("api", RtAudio::getApiName(a)); o.Set("apiName", RtAudio::getApiDisplayName(a)); o.Set("id", id); o.Set("name", d.name); o.Set("ins", d.inputChannels); o.Set("outs", d.outputChannels);
        o.Set("defaultIn", d.isDefaultInput); o.Set("defaultOut", d.isDefaultOutput); o.Set("preferredRate", d.preferredSampleRate);
        auto rates = Napi::Array::New(env, d.sampleRates.size()); for(size_t i = 0; i < d.sampleRates.size(); i++) rates.Set((uint32_t)i, d.sampleRates[i]); o.Set("rates", rates);
        list.Set(k++, o); } }
    return list; }

  static int callback(void* out, void* in, unsigned n, double, RtAudioStreamStatus st, void* user){
    Engine* e = (Engine*)user; if(st) e->cx->xruns++;
    const float* ip[MAXCH] = {nullptr}; float* op[MAXCH];
    float* I = (float*)in; float* O = (float*)out;
    if(e->fakeIn){ e->fakeTone(n); ip[0] = e->fake[0].data(); ip[1] = e->fake[1].data(); }
    else for(int c = 0; c < e->inN && c < MAXCH; c++) ip[c] = I ? I + (size_t)c*n : nullptr;
    for(int c = 0; c < e->outN && c < MAXCH; c++) op[c] = O + (size_t)c*n;
    e->cx->render(ip, e->fakeIn ? 2 : (I ? e->inN : 0), op, e->outN, (int)n);
    return 0; }
  void fakeTone(unsigned n){ for(int c = 0; c < 2; c++) if(fake[c].size() < n) fake[c].assign(n, 0.f); for(unsigned i = 0; i < n; i++){ float v = (float)(0.05*std::sin(fakePh)); fakePh += 2*3.141592653589793*110/cx->sr; fake[0][i] = v; fake[1][i] = v; } }

  void stop(){ if(rt){ if(rt->isStreamRunning()) rt->stopStream(); if(rt->isStreamOpen()) rt->closeStream(); rt.reset(); }
    if(nullThread.joinable()){ nullRun = false; nullThread.join(); } }

  // open({api, out, in, firstIn, rate, buffer, fakeInput}) ; api 'null' renders on a timer with no device
  Napi::Value Open(const Napi::CallbackInfo& info){
    Napi::Env env = info.Env(); stop(); auto o = info[0].As<Napi::Object>(); auto res = Napi::Object::New(env);
    std::string a = o.Has("api") ? o.Get("api").ToString().Utf8Value() : ""; double rate = o.Has("rate") ? o.Get("rate").ToNumber().DoubleValue() : 48000; unsigned buf = o.Has("buffer") ? o.Get("buffer").ToNumber().Uint32Value() : 128;
    fakeIn = o.Has("fakeInput") && o.Get("fakeInput").ToBoolean().Value();
    // keep the graph when the rate stays the same: only the device changes
    auto keepOrMake = [&](double r, int oc){ if(!cx || std::fabs(cx->sr - r) > 0.5){ makeContext(r, oc, 2); res.Set("fresh", true); } else { cx->outCh = oc; res.Set("fresh", false); } };
    if(a == "null"){
      keepOrMake(rate, 2); outN = 2; inN = 2; streamSr = rate; bufFrames = buf; outLat = inLat = buf/rate; api = "null"; devName = "No device (test mode)";
      nullRun = true; nullThread = std::thread([this, buf]{ std::vector<float> ob(buf*2); auto next = std::chrono::steady_clock::now();
        while(nullRun){ callback(ob.data(), nullptr, buf, 0, 0, this); next += std::chrono::microseconds((int64_t)(1e6*buf/streamSr)); std::this_thread::sleep_until(next); } });
      res.Set("ok", true); fill(res); return res; }
    RtAudio::Api A = RtAudio::getCompiledApiByName(a); if(A == RtAudio::UNSPECIFIED && !a.empty()){ res.Set("ok", false); res.Set("error", "That audio system is not available here."); return res; }
    rt.reset(new RtAudio(A)); rt->showWarnings(false);
    unsigned outId = o.Has("out") ? o.Get("out").ToNumber().Uint32Value() : rt->getDefaultOutputDevice();
    unsigned inId = o.Has("in") ? o.Get("in").ToNumber().Uint32Value() : rt->getDefaultInputDevice();
    unsigned firstIn = o.Has("firstIn") ? o.Get("firstIn").ToNumber().Uint32Value() : 0;
    RtAudio::DeviceInfo di = rt->getDeviceInfo(outId), ii = rt->getDeviceInfo(inId);
    if(std::find(di.sampleRates.begin(), di.sampleRates.end(), (unsigned)rate) == di.sampleRates.end() && di.preferredSampleRate) rate = di.preferredSampleRate;
    RtAudio::StreamParameters op, ip; op.deviceId = outId; op.nChannels = std::max(1u, std::min(8u, di.outputChannels)); op.firstChannel = 0;
    unsigned avail = ii.inputChannels > firstIn ? ii.inputChannels - firstIn : 0; ip.deviceId = inId; ip.nChannels = std::min(2u, avail); ip.firstChannel = firstIn;
    RtAudio::StreamOptions so; so.flags = RTAUDIO_NONINTERLEAVED | RTAUDIO_MINIMIZE_LATENCY | RTAUDIO_SCHEDULE_REALTIME; so.priority = 90; so.streamName = "Neon Peach";
    keepOrMake(rate, (int)op.nChannels); outN = (int)op.nChannels; inN = (int)ip.nChannels;
    unsigned frames = buf;
    RtAudioErrorType err = rt->openStream(&op, ip.nChannels ? &ip : nullptr, RTAUDIO_FLOAT32, (unsigned)rate, &frames, &Engine::callback, this, &so);
    if(err != RTAUDIO_NO_ERROR){ res.Set("ok", false); res.Set("error", rt->getErrorText()); rt.reset(); return res; }
    streamSr = rt->getStreamSampleRate(); bufFrames = frames; if(std::fabs(streamSr - cx->sr) > 0.5){ makeContext(streamSr, outN, 2); res.Set("fresh", true); }
    if(rt->startStream() != RTAUDIO_NO_ERROR){ res.Set("ok", false); res.Set("error", rt->getErrorText()); rt->closeStream(); rt.reset(); return res; }
    long lat = rt->getStreamLatency(); api = a; devName = di.name;
    // RtAudio reports total buffering; split it as the device does: about half in, half out
    outLat = (bufFrames + std::max(0L, lat)/2.0)/streamSr; inLat = (bufFrames + std::max(0L, lat)/2.0)/streamSr;
    res.Set("ok", true); fill(res); return res; }
  void fill(Napi::Object& r){ r.Set("api", api); r.Set("device", devName); r.Set("sampleRate", streamSr); r.Set("buffer", bufFrames); r.Set("outChannels", outN); r.Set("inChannels", inN); r.Set("outLatency", outLat); r.Set("inLatency", inLat); }
  Napi::Value Close(const Napi::CallbackInfo& info){ stop(); return info.Env().Undefined(); }
  Napi::Value Info(const Napi::CallbackInfo& info){ auto r = Napi::Object::New(info.Env()); fill(r); r.Set("running", (bool)(rt && rt->isStreamRunning()) || nullRun.load()); return r; }

  static Napi::Value NamRender(const Napi::CallbackInfo& info){
    Napi::Env env = info.Env(); ValueP d = toValue(info[0]); auto x = info[1].As<Napi::Float32Array>(); std::vector<float> in(x.Data(), x.Data() + x.ElementLength());
    try{ auto y = namRender(d, in); auto f = Napi::Float32Array::New(env, y.size()); std::memcpy(f.Data(), y.data(), y.size()*sizeof(float)); return f; }
    catch(std::exception& e){ Napi::Error::New(env, e.what()).ThrowAsJavaScriptException(); return env.Undefined(); } }
};

Napi::Object InitAll(Napi::Env env, Napi::Object exports){ return Engine::Init(env, exports); }
NODE_API_MODULE(npaudio, InitAll)
