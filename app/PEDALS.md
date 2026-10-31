# How to build a pedal model in Neon Peach

Read this before you change any block. It is the house rules for the 2.4 pedal rebuild.

## The two engines must agree

Neon Peach plays every block two ways:

- the browser engine: real Web Audio nodes and AudioWorklet processors (Chrome)
- the native engine: C++ twins of every node and processor (`native/src`), driven through `app/nshim.js`, which turns Web Audio calls into commands

A block is built from a graph of nodes in its `build(ctx,b)`. If it only uses nodes both engines have, it plays the same everywhere with no C++ work:

- `ctx.createGain()`, `ctx.createBiquadFilter()` (all 8 types, `frequency`, `Q`, `gain`, `detune`), `ctx.createDelay(max)`, `ctx.createStereoPanner()`, `ctx.createConvolver()`, `ctx.createOscillator()` (sine, triangle, square, sawtooth), `ctx.createWaveShaper()` (no oversampling), `ctx.createChannelSplitter/Merger()`, `ctx.createAnalyser()`, `ctx.createBufferSource()`
- worklets that already exist: `np-shaper` (4x oversampled table shaper with anti-aliasing, use `shaperNode(ctx, curve)`), `np-comp` (feed-forward compressor, use `compNode(ctx)`), `np-limit`, `np-gate`, `np-octave`, `np-pitch`, `np-envfilter`, `np-synth`, `np-crusher`, `np-looper`, `np-revdelay`, `np-freeze`, `np-vowel`, `np-stutter`, `np-swell`, `np-nam`

If you write a new AudioWorklet processor, you must also write its C++ twin, line for line:

- JS goes in `app/worklets_<family>.js`; C++ goes in `native/src/procs_<family>.cpp`, registered in that file's `makeProc<Family>(name)`
- the JS `parameterDescriptors` and the C++ `desc()` list the same names, defaults and ranges; in C++ `p(i)` is the i-th entry of `desc()`
- see `app/worklets2.js` and `native/src/procs.cpp` for the pattern: `onKill(this)` in the constructor, `process(inputs, outputs, p)` with k-rate params read as `p.name[0]`, messages through `this.port`; in C++ `process(Bus& in, int inCh, Bus& out, int n)`, `IN(c)` for a channel of the input, `message()` on the audio thread, `prepare()` on the page thread for heavy work
- use `double` state in both, the same order of operations, `Math.tanh` ↔ `std::tanh`, `Math.exp` ↔ `std::exp`. Do not use `Math.random` without seeding the same way in both.
- the golden test proves it: `NODE_PATH=/home/claude/neonpeach/app/node_modules node native/test/golden.js <type,type,...>` renders each block in Chrome and in the native engine and prints the match in dB. 60 dB or better is a pass. Under 40 dB means the twins differ; fix the port.

## Delay (latency)

Players feel every millisecond. The rules:

- dynamics (compressors, gates, limiters, filters) add no delay. No look-ahead.
- `np-shaper` adds `SHAPER_LAT` samples (17.875, about 0.4 ms). Any dry or parallel path beside it must wait the same amount: `shDelay(ctx)` makes that delay. Two shapers in series means two delays.
- a block that adds delay the paths must line up for sets `lat` (samples) on its def, like `fxloop`. Drives do not declare `lat`; the chain page shows "drives add 0.4 ms each".

## Knobs and presets

- every block keeps its type name and every existing param key, with the same meaning, range and default, so saved presets load and sound right at their old settings. You may add params; give them defaults that match the old sound as closely as the model allows.
- params: `P(label,min,max,def,unit,step)`, `E(label,[options],def)` (an enum; 4 or fewer options show as buttons, more as a menu), `B(label,def)` (a switch)
- a def may add `desc` (one short line for the block picker), `note(b)` (a sentence shown in the editor, can depend on settings), `spec(b,k,s)` (rename or reshape a control from the settings; return null to leave it alone)
- write labels and notes plainly: short sentences, common words.

## Sound rules

- every gain node starts at its real value in `build` (set `.gain.value` from the params), then `apply` moves it with `setP(param, v)`. A block made while audio runs must not have a loud first moment.
- curves for `np-shaper` are `Float32Array(8192)` over x = -1..1, normalized to |y| ≤ 1. Change them with `setCurve(node, key, () => curve)`; the key must change whenever the curve would, and `initCurve(node, name, amount)` sets the first key so `apply` does not re-send it.
- put a 12 Hz highpass after any clipper (`n.dc`): curves make DC.
- `wp(node, 'param', v)` sets a worklet param with a short ramp; `setP(audioParam, v)` ramps an AudioParam; `dB(v)` is dB to gain.
- the drive curves in `amp2.js` (`HEAD_CIRC`, `headCurve`, `HEAD_VOICE`, `headVoice`) are good and already tuned; reuse them where a pedal shares a circuit with the 900 head.

## Tests

`native/test/lib.js` renders any block through the native engine with no browser:

```js
const {render, stats, bands, rmsAt, toneLevel, signal, sine, impulse, checker, SR, N} = require('./lib');
const y = render('chorus', {rate: 1, depth: 60});          // left channel, 2 s at 48 kHz, picked bass line in
const {pk, rms, nan} = stats(y); const b = bands(y);       // bands: low/lomid/himid/high/fizz in dB
const [L, R] = render('chorus', {}, signal(), {stereo: true});
const z = render('comp', {}, sine(110, 0.3), {steps: [[1.0, {thr: -40}]]});   // turn a knob at 1 s
```

Write `native/test/pedals_<family>.js` with a check per block: no NaN, no loud first moment, a sane level, and one or two checks that each knob does what its label says. Build your own copy of the engine so parallel work does not collide: `cd native && NP_OBJ=build/obj-<family> NP_OUT=build/<family> sh build-linux.sh`, then run tests with `NP_ADDON=/home/claude/neonpeach/native/build/<family>/npaudio.node`.

Do not run `app/build.js` and do not edit files outside your family (`app/pedals_<family>.js`, `app/worklets_<family>.js`, `native/src/procs_<family>.cpp`, `native/test/pedals_<family>.js`). The integration pass does the build, the UI test and the README.
