// Processors: the C++ twins of the app's AudioWorklet processors (worklets.js, worklets2.js).
#pragma once
#include "np.h"

namespace np {

struct PDesc { const char* name; float def, mn, mx; bool krate; };

struct Proc {
  virtual ~Proc() {}
  Node* node = nullptr; double sr = 48000; bool dead = false;
  std::vector<Param*> P;
  virtual std::vector<PDesc> desc() const { return {}; }
  virtual void init(const ValueP&) {}
  // inCh is 0 when nothing is connected (inputs[0] is empty in a worklet)
  virtual bool process(Bus& in, int inCh, Bus& out, int n) = 0;
  virtual std::shared_ptr<void> prepare(const ValueP&) { return nullptr; }     // page thread: heavy work for a message
  virtual void message(const ValueP&, std::shared_ptr<void>) {}                // audio thread
  float p(int i) const { return P[i]->first; }
  double time() const;   // currentTime at the start of this pass
  void post(ValueP v){ node->post(v); }
};

Proc* makeProc(const std::string& name);
Proc* makeNamProc();

} // namespace np
