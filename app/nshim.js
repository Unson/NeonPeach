// Neon Peach: a Web Audio stand-in that sends every call to the native engine.
// The app's code builds its graphs exactly as it does in a browser. Nothing in the app has to change.
// transport: { send(ops) }  and the creator calls ctx._receive(packet) with {frame, sampleRate, wall, msgs}.
(function(root){
'use strict';
function makeNativeAudio(transport, info){
  info = info || {};
  const ops = []; let queued = false, nextId = 10;
  const flush = () => { queued = false; if(ops.length) transport.send(ops.splice(0)); };
  const op = (a) => { ops.push(a); if(!queued){ queued = true; (root.queueMicrotask || ((f) => Promise.resolve().then(f)))(flush); } };
  const live = new Map();                 // id -> WeakRef(node), for messages
  const reg = typeof FinalizationRegistry !== 'undefined' ? new FinalizationRegistry((id) => { live.delete(id); op(['r', id]); }) : null;
  const descs = {};                       // worklet name -> parameterDescriptors

  // ---------------------------------------------------------------- params
  class NParam {
    constructor(node, name, def, min, max){ this._n = node; this._name = name; this._v = def; this.defaultValue = def; this.minValue = min; this.maxValue = max; this.automationRate = 'a-rate'; }
    get value(){ return this._v; }
    set value(v){ v = +v; if(!Number.isFinite(v)) return; this._v = v; op(['p', this._n.id, this._name, 'v', v]); }
    setValueAtTime(v, t){ this._v = +v; op(['p', this._n.id, this._name, 'set', +v, +t]); return this; }
    linearRampToValueAtTime(v, t){ this._v = +v; op(['p', this._n.id, this._name, 'lin', +v, +t]); return this; }
    exponentialRampToValueAtTime(v, t){ this._v = +v; op(['p', this._n.id, this._name, 'exp', +v, +t]); return this; }
    setTargetAtTime(v, t, tc){ this._v = +v; op(['p', this._n.id, this._name, 'tgt', +v, +t, +tc]); return this; }
    cancelScheduledValues(t){ op(['p', this._n.id, this._name, 'cancel', +t]); return this; }
    cancelAndHoldAtTime(t){ return this.cancelScheduledValues(t); }
  }

  // ---------------------------------------------------------------- nodes
  class NNode {
    constructor(ctx, type, opts, nin, nout){
      this.context = ctx; this.id = nextId++; this.numberOfInputs = nin; this.numberOfOutputs = nout;
      this._cc = 2; this._ccm = 'max'; this._ci = 'speakers'; this._listeners = {};
      op(['c', this.id, type, opts || {}]); live.set(this.id, new WeakRef(this)); if(reg) reg.register(this, this.id);
    }
    connect(dest, output = 0, input = 0){
      if(dest instanceof NParam) op(['xp', this.id, output | 0, dest._n.id, dest._name]);
      else if(dest && dest.id != null) op(['x', this.id, output | 0, dest.id, input | 0]);
      else throw new TypeError('connect: not a node');
      return dest; }
    disconnect(a, b, c){
      if(a === undefined) op(['dx', this.id, -1, 0, -1]);
      else if(typeof a === 'number') op(['dx', this.id, a, 0, -1]);
      else if(a instanceof NParam) op(['dx', this.id, b == null ? -1 : b, a._n.id, -1, a._name]);
      else op(['dx', this.id, b == null ? -1 : b, a.id, c == null ? -1 : c]); }
    get channelCount(){ return this._cc; } set channelCount(v){ this._cc = v | 0; op(['pr', this.id, 'channelCount', v | 0]); }
    get channelCountMode(){ return this._ccm; } set channelCountMode(v){ this._ccm = v; op(['pr', this.id, 'channelCountMode', String(v)]); }
    get channelInterpretation(){ return this._ci; } set channelInterpretation(v){ this._ci = v; op(['pr', this.id, 'channelInterpretation', String(v)]); }
    addEventListener(t, f){ (this._listeners[t] = this._listeners[t] || []).push(f); }
    removeEventListener(t, f){ const l = this._listeners[t]; if(l){ const i = l.indexOf(f); if(i >= 0) l.splice(i, 1); } }
    _emit(t, ev){ const h = this['on' + t]; if(typeof h === 'function') try{ h.call(this, ev); }catch(e){ console.error(e); } (this._listeners[t] || []).slice().forEach(f => { try{ f.call(this, ev); }catch(e){ console.error(e); } }); }
    _msg(m){ if(m && m.__ended){ this._emit('ended', {type: 'ended', target: this}); } }
  }
  const P = (n, name, def, min = -3.4028234663852886e38, max = 3.4028234663852886e38) => (n[name] = new NParam(n, name, def, min, max));

  class NGain extends NNode { constructor(c){ super(c, 'gain', {}, 1, 1); P(this, 'gain', 1); } }
  class NDelay extends NNode { constructor(c, max){ super(c, 'delay', {maxDelayTime: max == null ? 1 : +max}, 1, 1); P(this, 'delayTime', 0, 0, max == null ? 1 : +max); } }
  class NBiquad extends NNode { constructor(c){ super(c, 'biquad', {}, 1, 1); this._t = 'lowpass'; P(this, 'frequency', 350, 0, c.sampleRate/2); P(this, 'Q', 1); P(this, 'gain', 0); P(this, 'detune', 0); }
    get type(){ return this._t; } set type(v){ this._t = v; op(['pr', this.id, 'type', String(v)]); } }
  class NPanner extends NNode { constructor(c){ super(c, 'panner', {}, 1, 1); this._cc = 2; this._ccm = 'clamped-max'; P(this, 'pan', 0, -1, 1); } }
  class NShaper extends NNode { constructor(c){ super(c, 'shaper', {}, 1, 1); this._curve = null; this._os = 'none'; }
    get curve(){ return this._curve; } set curve(v){ this._curve = v; op(['d', this.id, 'curve', v ? [Float32Array.from(v)] : [], c0(this)]); }
    get oversample(){ return this._os; } set oversample(v){ this._os = v; } }
  const c0 = (n) => n.context.sampleRate;
  class NConvolver extends NNode { constructor(c){ super(c, 'convolver', {}, 1, 1); this._buf = null; this._norm = true; this._cc = 2; this._ccm = 'clamped-max'; }
    get normalize(){ return this._norm; } set normalize(v){ this._norm = !!v; op(['pr', this.id, 'normalize', !!v]); }
    get buffer(){ return this._buf; } set buffer(b){ this._buf = b; op(['d', this.id, 'buffer', b ? chans(b) : [], b ? b.sampleRate : c0(this)]); } }
  const chans = (b) => { const a = []; for(let i = 0; i < b.numberOfChannels; i++) a.push(Float32Array.from(b.getChannelData(i))); return a; };
  class NSched extends NNode {
    start(when = 0, offset = 0, duration){ const o = {when: +when, offset: +offset}; if(duration != null) o.duration = +duration; op(['pr', this.id, 'start', o]); this._started = true; }
    stop(when = 0){ op(['pr', this.id, 'stop', {when: +when}]); } }
  class NOsc extends NSched { constructor(c){ super(c, 'osc', {}, 0, 1); this._t = 'sine'; P(this, 'frequency', 440, -c.sampleRate/2, c.sampleRate/2); P(this, 'detune', 0); }
    get type(){ return this._t; } set type(v){ this._t = v; op(['pr', this.id, 'type', String(v)]); } }
  class NBufSrc extends NSched { constructor(c){ super(c, 'bufsrc', {}, 0, 1); this._buf = null; this._loop = false; P(this, 'playbackRate', 1); P(this, 'detune', 0); }
    get buffer(){ return this._buf; } set buffer(b){ this._buf = b; op(['d', this.id, 'buffer', b ? chans(b) : [], b ? b.sampleRate : c0(this)]); }
    get loop(){ return this._loop; } set loop(v){ this._loop = !!v; op(['pr', this.id, 'loop', !!v]); } }
  class NSplit extends NNode { constructor(c, n = 6){ super(c, 'split', {n}, 1, n); this._cc = n; this._ccm = 'explicit'; this._ci = 'discrete'; } }
  class NMerge extends NNode { constructor(c, n = 6){ super(c, 'merge', {n}, n, 1); this._cc = 1; this._ccm = 'explicit'; } }
  class NInput extends NNode { constructor(c, stream){ super(c, 'input', {}, 0, 1); this.mediaStream = stream || null; } }
  class NDest extends NNode {
    constructor(c){ super(c, 'dest-placeholder', {}, 1, 0); }
    get maxChannelCount(){ return this.context._outChannels; } }

  // analyser: the engine sends the last samples on request; frequency data is worked out here
  class NAnalyser extends NNode {
    constructor(c){ super(c, 'analyser', {}, 1, 1); this._fft = 2048; this.smoothingTimeConstant = 0.8; this.minDecibels = -100; this.maxDecibels = -30; this._snap = new Float32Array(2048); this._ask = 0; this._sm = null; }
    get fftSize(){ return this._fft; } set fftSize(v){ this._fft = v | 0; this._snap = new Float32Array(this._fft); op(['pr', this.id, 'fftSize', v | 0]); }
    get frequencyBinCount(){ return this._fft >> 1; }
    _want(){ const t = Date.now(); if(t - this._ask > 25){ this._ask = t; op(['m', this.id, {cmd: 'snap'}]); } }
    _msg(m){ if(m && m.snap) this._snap = m.snap; else super._msg(m); }
    getFloatTimeDomainData(a){ this._want(); const s = this._snap, n = Math.min(a.length, s.length); a.set(s.subarray(s.length - n)); }
    getByteTimeDomainData(a){ this._want(); const s = this._snap, n = Math.min(a.length, s.length); for(let i = 0; i < n; i++) a[i] = Math.max(0, Math.min(255, Math.round(128*(1 + s[s.length - n + i])))); }
    _spectrum(){ const N = this._fft, x = this._snap, re = new Float64Array(N), im = new Float64Array(N);
      for(let i = 0; i < N; i++){ const a = 0.16, w = 0.5*(1 - a) - 0.5*Math.cos(2*Math.PI*i/N) + a/2*Math.cos(4*Math.PI*i/N); re[i] = (x[i] || 0)*w; }
      for(let i = 1, j = 0; i < N; i++){ let bit = N >> 1; for(; j & bit; bit >>= 1) j ^= bit; j ^= bit; if(i < j){ let t = re[i]; re[i] = re[j]; re[j] = t; } }
      for(let len = 2; len <= N; len <<= 1){ const ang = -2*Math.PI/len; for(let i = 0; i < N; i += len) for(let k = 0; k < len/2; k++){ const wr = Math.cos(ang*k), wi = Math.sin(ang*k), xr = re[i+k+len/2]*wr - im[i+k+len/2]*wi, xi = re[i+k+len/2]*wi + im[i+k+len/2]*wr; re[i+k+len/2] = re[i+k] - xr; im[i+k+len/2] = im[i+k] - xi; re[i+k] += xr; im[i+k] += xi; } }
      const B = N >> 1; if(!this._sm || this._sm.length !== B) this._sm = new Float64Array(B); const tau = this.smoothingTimeConstant;
      for(let k = 0; k < B; k++){ const mag = Math.hypot(re[k], im[k])/N; this._sm[k] = tau*this._sm[k] + (1 - tau)*mag; } return this._sm; }
    getFloatFrequencyData(a){ this._want(); const s = this._spectrum(); for(let k = 0; k < Math.min(a.length, s.length); k++) a[k] = 20*Math.log10(s[k] + 1e-30); }
    getByteFrequencyData(a){ this._want(); const s = this._spectrum(), lo = this.minDecibels, hi = this.maxDecibels; for(let k = 0; k < Math.min(a.length, s.length); k++){ const d = 20*Math.log10(s[k] + 1e-30); a[k] = Math.max(0, Math.min(255, Math.floor(255/(hi - lo)*(d - lo)))); } }
  }

  // AudioWorkletNode: the processor runs natively; its port talks to it
  class NPort { constructor(n){ this._n = n; this.onmessage = null; this._l = []; }
    postMessage(m){ op(['m', this._n.id, m]); }
    addEventListener(t, f){ if(t === 'message') this._l.push(f); } removeEventListener(t, f){ const i = this._l.indexOf(f); if(i >= 0) this._l.splice(i, 1); }
    start(){} close(){}
    _deliver(d){ const ev = {data: d, target: this}; if(this.onmessage) try{ this.onmessage(ev); }catch(e){ console.error(e); } this._l.slice().forEach(f => { try{ f(ev); }catch(e){ console.error(e); } }); } }
  class NWorklet extends NNode {
    constructor(c, name, options = {}){
      const d = descs[name]; if(!d) throw new Error('AudioWorkletNode: "' + name + '" is not registered');
      const po = {}; if(options.processorOptions){ for(const k in options.processorOptions){ const v = options.processorOptions[k]; if(v instanceof ArrayBuffer || ArrayBuffer.isView(v) && !(v instanceof Float32Array)) continue; po[k] = v; } }
      super(c, 'worklet', {name, outputChannelCount: options.outputChannelCount || null, parameterData: options.parameterData || {}, processorOptions: po}, options.numberOfInputs == null ? 1 : options.numberOfInputs, options.numberOfOutputs == null ? 1 : options.numberOfOutputs);
      this.port = new NPort(this); const m = new Map();
      for(const pd of d){ const p = new NParam(this, pd.name, pd.defaultValue == null ? 0 : pd.defaultValue, pd.minValue == null ? -3.4e38 : pd.minValue, pd.maxValue == null ? 3.4e38 : pd.maxValue); if(options.parameterData && pd.name in options.parameterData) p._v = options.parameterData[pd.name]; m.set(pd.name, p); }
      this.parameters = m; }
    _msg(m){ if(m && m.__ended) return super._msg(m); this.port._deliver(m); } }

  // ---------------------------------------------------------------- buffers
  class NBuffer {
    constructor(o){ this.numberOfChannels = o.numberOfChannels | 0; this.length = o.length | 0; this.sampleRate = +o.sampleRate; this._ch = []; for(let i = 0; i < this.numberOfChannels; i++) this._ch.push(new Float32Array(this.length)); }
    get duration(){ return this.length/this.sampleRate; }
    getChannelData(i){ return this._ch[i]; }
    copyToChannel(src, c, off = 0){ this._ch[c].set(src.subarray(0, this.length - off), off); }
    copyFromChannel(dst, c, off = 0){ dst.set(this._ch[c].subarray(off, off + dst.length)); } }

  // ---------------------------------------------------------------- the context
  class NativeAudioContext {
    constructor(){ this.sampleRate = info.sampleRate || 48000; this._outChannels = info.outChannels || 2; this.baseLatency = info.baseLatency || 0; this.outputLatency = info.outputLatency || 0; this.state = 'running'; this._listeners = {};
      this._frame = 0; this._perf = nowMs(); this._wallFrame = 0; this.onstatechange = null; this.isNative = true;
      const self = this; this.audioWorklet = { addModule: async (url) => { const src = await sourceOf(url); collectDescriptors(src); } };
      this.destination = Object.create(NDest.prototype); Object.assign(this.destination, {context: this, id: 1, numberOfInputs: 1, numberOfOutputs: 0, _cc: 2, _ccm: 'explicit', _ci: 'speakers', _listeners: {}});
      void self; }
    get currentTime(){ if(info.offline) return this._frame/this.sampleRate; const t = this._frame/this.sampleRate + Math.max(0, (nowMs() - this._perf)/1000); this._last = Math.max(this._last || 0, t); return this._last; }
    _receive(pk){ if(pk.frame != null){ this._frame = pk.frame; this._perf = nowMs(); }
      if(pk.msgs) for(const [id, m] of pk.msgs){ const w = live.get(id); const n = w && w.deref(); if(n) n._msg(m); } }
    createGain(){ return new NGain(this); }
    createDelay(max){ return new NDelay(this, max); }
    createBiquadFilter(){ return new NBiquad(this); }
    createStereoPanner(){ return new NPanner(this); }
    createWaveShaper(){ return new NShaper(this); }
    createConvolver(){ return new NConvolver(this); }
    createOscillator(){ return new NOsc(this); }
    createBufferSource(){ return new NBufSrc(this); }
    createChannelSplitter(n = 6){ return new NSplit(this, n); }
    createChannelMerger(n = 6){ return new NMerge(this, n); }
    createAnalyser(){ return new NAnalyser(this); }
    createMediaStreamSource(stream){ return new NInput(this, stream); }
    createBuffer(ch, len, sr){ return new NBuffer({numberOfChannels: ch, length: len, sampleRate: sr}); }
    async decodeAudioData(ab, ok, bad){
      try{ const OAC = root.OfflineAudioContext || root.webkitOfflineAudioContext; if(!OAC) throw new Error('No decoder here');
        const real = await new OAC(1, 1, this.sampleRate).decodeAudioData(ab.slice ? ab.slice(0) : ab);
        const b = this.createBuffer(real.numberOfChannels, real.length, real.sampleRate); for(let c = 0; c < real.numberOfChannels; c++) b.getChannelData(c).set(real.getChannelData(c));
        if(ok) ok(b); return b; }catch(e){ if(bad) bad(e); throw e; } }
    async resume(){ this.state = 'running'; } async suspend(){} async close(){ this.state = 'closed'; if(transport.close) transport.close(); }
    async setSinkId(id){ if(transport.setSinkId) return transport.setSinkId(id); }
    addEventListener(t, f){ (this._listeners[t] = this._listeners[t] || []).push(f); } removeEventListener(){}
  }
  NDest.prototype.connect = NNode.prototype.connect; NDest.prototype.disconnect = NNode.prototype.disconnect;
  for(const k of ['channelCount', 'channelCountMode', 'channelInterpretation']) Object.defineProperty(NDest.prototype, k, Object.getOwnPropertyDescriptor(NNode.prototype, k));

  const nowMs = () => (root.performance && performance.now) ? performance.now() : Date.now();
  async function sourceOf(url){
    if(typeof url !== 'string') return '';
    if(url.startsWith('data:')){ const i = url.indexOf(','), meta = url.slice(0, i), body = url.slice(i + 1); if(/;base64/.test(meta)){ const bin = atob(body); const u8 = new Uint8Array(bin.length); for(let k = 0; k < bin.length; k++) u8[k] = bin.charCodeAt(k); return new TextDecoder().decode(u8); } return decodeURIComponent(body); }
    const r = await fetch(url); return r.text(); }
  function collectDescriptors(src){
    const found = {};
    const fake = function(){}; fake.prototype = {};
    // run the module with a pretend worklet scope; only class definitions and registerProcessor calls happen
    const fn = new Function('registerProcessor', 'AudioWorkletProcessor', 'sampleRate', 'currentTime', 'currentFrame', src);
    fn((name, cls) => { found[name] = (cls && cls.parameterDescriptors) || []; }, class { constructor(){ this.port = {postMessage(){}, onmessage: null}; } }, info.sampleRate || 48000, 0, 0);
    Object.assign(descs, found); }

  // installs the stand-ins on a global scope (the page), so `new AudioWorkletNode(ctx, ...)` works unchanged
  function install(g){
    g.AudioContext = NativeAudioContext; g.webkitAudioContext = NativeAudioContext;
    const Real = g.AudioWorkletNode;
    const Wrap = function AudioWorkletNode(ctx, name, opts){ if(ctx && ctx.isNative) return new NWorklet(ctx, name, opts); return new Real(ctx, name, opts); };
    Wrap.prototype = NWorklet.prototype; g.AudioWorkletNode = Wrap; }

  return {NativeAudioContext, install, descs, collectDescriptors, flush, classes: {NNode, NParam, NWorklet, NBuffer}};
}
if(typeof module !== 'undefined' && module.exports) module.exports = makeNativeAudio; else root.makeNativeAudio = makeNativeAudio;
})(typeof globalThis !== 'undefined' ? globalThis : this);
