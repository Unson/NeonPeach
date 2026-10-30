// Speed check. Usage: node tools/bench_nam.js <model.nam> ...
const fs=require('fs'), path=require('path'), NAM=require('../namcore.js'), wat=require('./wat2wasm.js');
(async()=>{
  const mod=new WebAssembly.Module(await wat(fs.readFileSync(path.join(__dirname,'..','wasm','namkern.wat'),'utf8')));
  const secs=5, x=new Float32Array(48000*secs); for(let i=0;i<x.length;i++) x[i]=0.3*Math.sin(i*0.01)+0.1*Math.sin(i*0.37);
  const jobs=process.argv.slice(2).map(f=>[path.basename(f), JSON.parse(fs.readFileSync(f,'utf8'))]);
  for(const H of [12,16,24,32]){ const cfg={num_layers:1,input_size:1,hidden_size:H}; const n=NAM.weightCount('LSTM',cfg); jobs.push(['LSTM 1x'+H,{version:'0.5.4',architecture:'LSTM',config:cfg,weights:Array.from({length:n},(_,i)=>Math.sin(i)*0.2),sample_rate:48000}]); }
  for(const [name,j] of jobs){
    const d=NAM.parse(j);
    for(const kind of ['wasm','js']){
      if(kind==='js' && d.arch==='LSTM') continue;
      const p=NAM.build(d, kind==='wasm'?NAM.instantiate(mod):null);
      NAM.render(p, x.subarray(0,48000)); // warm up the JIT
      const t0=process.hrtime.bigint(); NAM.render(p, x); const ms=Number(process.hrtime.bigint()-t0)/1e6;
      console.log(`${name.padEnd(28)} ${kind.padEnd(4)} weights ${String(d.w? d.w.length:'').padStart(6)}  ${(ms/secs).toFixed(1).padStart(6)} ms per second of audio  = ${(100*ms/secs/1000).toFixed(1)}% of one core`);
    }
  }
})();
