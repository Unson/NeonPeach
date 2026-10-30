// Tests for the neural player. Usage: node tools/test_nam.js <model.nam> ...
'use strict';
const fs = require('fs'), path = require('path');
const NAM = require('../namcore.js'), REF = require('./namref.js'), wat = require('./wat2wasm.js');
let fails = 0;
const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if(!c) fails++; };
function signal(T, seed){
  let s = seed || 1; const rnd = () => (s = (s*1103515245 + 12345) & 0x7fffffff)/0x7fffffff;
  const x = new Float32Array(T);
  for(let t = 0; t < T; t++){
    const f = 40 + 2000*t/T, env = 0.15 + 0.6*Math.abs(Math.sin(t/900));
    x[t] = env*Math.sin(2*Math.PI*f*t/48000) + (t % 3000 < 400 ? 0.3*(rnd()*2 - 1) : 0) + (t > T*0.8 ? 0.9*Math.sign(Math.sin(t/37)) : 0);
  }
  return x;
}
function maxErr(a, b){ let m = 0, s = 0; for(let i = 0; i < a.length; i++){ m = Math.max(m, Math.abs(a[i] - b[i])); s = Math.max(s, Math.abs(b[i])); } return {abs: m, rel: m/Math.max(s, 1e-9), peak: s}; }
function randomWeights(n, seed, scale){ let s = seed; const w = new Array(n); for(let i = 0; i < n; i++){ s = (s*1664525 + 1013904223) >>> 0; w[i] = ((s/4294967296) - 0.5)*2*scale; } return w; }
function synth(arch, config, seed, scale){ const n = NAM.weightCount(arch, config); return {version: '0.6.0', architecture: arch, config, weights: randomWeights(n, seed, scale || 0.4), sample_rate: 48000}; }

(async () => {
  const bytes = await wat(fs.readFileSync(path.join(__dirname, '..', 'wasm', 'namkern.wat'), 'utf8'));
  const mod = new WebAssembly.Module(bytes);
  // 1. tanh accuracy of the wasm kernel
  { const W = NAM.instantiate(mod).exports; let m = 0, at = 0;
    for(let x = -12; x <= 12; x += 0.0007){ const e = Math.abs(W.tanh1(x) - Math.tanh(x)); if(e > m){ m = e; at = x; } }
    ok(m < 5e-7, 'wasm tanh max error ' + m.toExponential(2) + ' at ' + at.toFixed(3)); }
  // 2. models: files given on the command line plus synthetic ones that use every feature
  const cases = process.argv.slice(2).map(f => ({name: path.basename(f), json: JSON.parse(fs.readFileSync(f, 'utf8'))}));
  const L = (o) => { const r = Object.assign({input_size: 1, condition_size: 1, head_size: 1, head_bias: true, channels: 4, kernel_size: 3, dilations: [1, 2, 4], activation: 'Tanh', gated: false}, o); if(o.kernel_sizes) delete r.kernel_size; if(o.gating_mode) delete r.gated; return r; };
  cases.push({name: 'syn gated + 2 arrays', json: synth('WaveNet', {layers: [L({channels: 6, head_size: 4, head_bias: false, gated: true, dilations: [1, 3, 9, 27]}), L({input_size: 6, channels: 4, gated: true, dilations: [1, 5]})], head_scale: 0.05}, 11)});
  cases.push({name: 'syn blended + head1x1 + bottleneck', json: synth('WaveNet', {layers: [L({channels: 8, bottleneck: 4, gating_mode: ['blended', 'gated', 'none', 'blended'], secondary_activation: [{type: 'Sigmoid'}, 'Hardtanh', 'Tanh', {type: 'LeakyHardtanh', min_val: -0.5, max_val: 0.7}], activation: ['Tanh', 'SiLU', {type: 'LeakyReLU', negative_slope: 0.2}, 'Softsign'], dilations: [1, 2, 4, 8], head1x1: {active: true, out_channels: 3, groups: 1}, head: {out_channels: 1, kernel_size: 4, bias: true, head_dilation: 2}})], head_scale: 0.1}, 12)});
  cases.push({name: 'syn groups + layer1x1 off + post head', json: synth('WaveNet', {layers: [L({channels: 4, kernel_sizes: [2, 5, 3], dilations: [1, 7, 2], groups_input: 2, groups_input_mixin: 1, layer1x1: {active: false, groups: 1}, head: {out_channels: 3, kernel_size: 1, bias: true}, activation: {type: 'PReLU', negative_slopes: [0.1, 0.2, 0.3, 0.05]}})], head: {channels: 5, out_channels: 1, kernel_sizes: [3, 2], activation: 'Hardswish'}, head_scale: 0.3}, 13)});
  cases.push({name: 'syn depthwise + fasttanh + relu', json: synth('WaveNet', {layers: [L({channels: 4, groups_input: 4, activation: ['Fasttanh', 'ReLU', 'Sigmoid'], layer1x1: {active: true, groups: 2}, head1x1: {active: true, out_channels: 2, groups: 2}, head: {out_channels: 1, kernel_size: 2, bias: false}})], head_scale: 0.2}, 14)});
  cases.push({name: 'syn LSTM 2x5', json: synth('LSTM', {num_layers: 2, input_size: 1, hidden_size: 5}, 15, 0.6)});
  cases.push({name: 'syn ConvNet batchnorm', json: (() => { const j = synth('ConvNet', {channels: 6, dilations: [1, 2, 4, 8, 16], batchnorm: true, activation: 'Tanh'}, 16); let k = 0; // make variances positive
    const C = 6; for(let b = 0; b < 5; b++){ const cin = b ? C : 1; k += 2*C*cin; for(let i = 0; i < C; i++) j.weights[k + C + i] = 0.5 + Math.abs(j.weights[k + C + i]); k += 4*C; j.weights[k] = 1e-5; k += 1; } return j; })()});
  cases.push({name: 'syn ConvNet plain', json: synth('ConvNet', {channels: 3, dilations: [1, 3, 9], batchnorm: false, activation: 'Softsign'}, 17)});
  cases.push({name: 'syn Linear', json: synth('Linear', {receptive_field: 33, bias: true}, 18)});
  cases.push({name: 'syn Sequential', json: {version: '0.7.0', architecture: 'Sequential', config: {models: [synth('LSTM', {num_layers: 1, input_size: 1, hidden_size: 3}, 19), synth('WaveNet', {layers: [L({})], head_scale: 0.5}, 20)]}, weights: []}});
  const x = signal(4096, 7);
  for(const c of cases){
    let d;
    try{ d = NAM.parse(c.json); }catch(e){ ok(/condition|FiLM/.test(e.message) && /condition|feature/.test(c.name), c.name + ': refused (' + e.message + ')'); continue; }
    const ref = REF.run(d, x);
    const pj = NAM.build(d, null), pw = NAM.build(d, NAM.instantiate(mod));
    const yj = NAM.render(pj, x), yw = NAM.render(pw, x);
    const ej = maxErr(yj, ref), ew = maxErr(yw, ref);
    ok(ej.rel < 2e-5, `${c.name} [${NAM.describe(d)}] js vs ref rel ${ej.rel.toExponential(2)} (peak ${ej.peak.toFixed(3)})`);
    ok(ew.rel < 2e-4, `${c.name} wasm vs ref rel ${ew.rel.toExponential(2)}`);
    // block pattern must not matter: run again after reset in a different split
    pw.reset(); const y2 = new Float32Array(x.length), a = new Float32Array(128), b = new Float32Array(128);
    for(let i = 0; i < x.length; i += 128){ a.set(x.subarray(i, i + 128)); pw.process(a, b, 128); y2.set(b, i); }
    ok(maxErr(y2, yw).abs === 0, `${c.name} reset gives the same output`);
  }
  console.log(fails ? fails + ' FAILED' : 'all passed');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
