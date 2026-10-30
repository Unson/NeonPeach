// Loads the built engine, renders a short graph offline, and lists audio devices. Used by CI on each platform.
const path = require('path'); const file = process.argv[2]; const a = require(path.resolve(file));
const e = new a.Engine({sampleRate: 48000, outChannels: 2});
e.cmd([['c', 10, 'osc', {}], ['pr', 10, 'start', {when: 0}], ['c', 11, 'biquad', {}], ['pr', 11, 'type', 'lowpass'], ['x', 10, 0, 11, 0], ['x', 11, 0, 1, 0],
  ['c', 12, 'worklet', {name: 'np-comp', outputChannelCount: [2]}], ['x', 11, 0, 12, 0], ['c', 13, 'worklet', {name: 'np-shaper', outputChannelCount: [2]}], ['x', 12, 0, 13, 0], ['x', 13, 0, 1, 0]]);
const out = e.render(4800, [], 128); let pk = 0; for(const v of out[0]) pk = Math.max(pk, Math.abs(v));
console.log('render peak', pk.toFixed(3)); if(!(pk > 0.1 && pk < 4)) { console.error('bad render'); process.exit(1); }
let d = []; try{ d = a.devices(); }catch(err){ console.log('devices failed:', err.message); }
console.log('apis:', [...new Set(d.map(x => x.apiName))].join(', ') || '(none on this machine)', '| devices:', d.length);
console.log('ok');
