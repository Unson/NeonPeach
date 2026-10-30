// Assemble a WAT file into wasm bytes with SIMD on. Usage: node tools/wat2wasm.js in.wat out.wasm
const fs=require('fs');
module.exports=async function(src){
  const w=await require('wabt')();
  const m=w.parseWat('k.wat', src, {simd:true, multi_value:true, bulk_memory:true});
  m.resolveNames(); m.validate();
  const {buffer}=m.toBinary({log:false, write_debug_names:false});
  m.destroy();
  return Buffer.from(buffer);
};
if(require.main===module){
  module.exports(fs.readFileSync(process.argv[2],'utf8')).then(b=>{ fs.writeFileSync(process.argv[3], b); console.log('wasm bytes', b.length); })
    .catch(e=>{ console.error(String(e.message||e)); process.exit(1); });
}
