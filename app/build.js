// Builds dist/neon-peach.html: one offline file with fonts, styles, the audio worklet, the wasm kernels and the app.
const fs=require('fs'); const path=require('path');
const wat2wasm=require('./tools/wat2wasm.js');
const r=f=>fs.readFileSync(path.join(__dirname,f),'utf8');
function face(family, file, extra){ const p=path.join(__dirname,'node_modules',file); if(!fs.existsSync(p)){ console.warn('missing font', file); return ''; }
  return `@font-face{font-family:'${family}';src:url(data:font/woff2;base64,${fs.readFileSync(p).toString('base64')}) format('woff2');${extra}font-display:swap;}`; }
(async()=>{
const fonts=[
  face('Tilt Neon','@fontsource/tilt-neon/files/tilt-neon-latin-400-normal.woff2','font-weight:400;font-style:normal;'),
  face('Saira','@fontsource-variable/saira/files/saira-latin-wdth-normal.woff2','font-weight:100 900;font-stretch:50% 125%;font-style:normal;')
].join('\n');
const namWasm=await wat2wasm(r('wasm/namkern.wat')), trainWasm=await wat2wasm(r('wasm/lstmtrain.wat'));
const css=r('style.css').replace('/*FONTS*/', fonts), worklets=r('worklets.js')+'\n'+r('worklets2.js'), engine=r('engine.js')+'\n'+r('fx2.js'), namcore=r('namcore.js'), cloner=r('cloner.js'), ui=r('ui.js'), ui2=r('ui2.js'), ui3=r('ui3.js'), ui4=r('ui4.js'), desktop=r('desktop.js');
for(const [n,s] of [['worklets',worklets],['engine',engine],['namcore',namcore],['cloner',cloner],['ui',ui],['ui2',ui2],['ui3',ui3],['ui4',ui4],['desktop',desktop]]){ if(/<\/script/i.test(s)) throw new Error(n+' contains </script'); }
const kernels=`const NAM_WASM_B64='${namWasm.toString('base64')}', TRAIN_WASM_B64='${trainWasm.toString('base64')}';`;
const POWER='<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.5v8"/><path d="M6.6 6.6a7.6 7.6 0 1 0 10.8 0"/></svg>';
const html=`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="color-scheme" content="dark">
<meta name="theme-color" content="#0a0612">
<title>Neon Peach</title>
<style>
${css}
</style>
</head>
<body>
<div id="splash">
  <div class="sign" aria-label="Neon Peach">neon peach</div>
  <p class="splash-line">A bass effects rig with two signal paths, amps, cabs, a synth, a looper, a tuner, and a cloner that copies your pedals.</p>
  <button id="power" aria-label="Power on">${POWER}</button>
  <div id="pwrlbl">Press to power on</div>
  <p class="splash-fine">Plug your bass into an audio interface first. When you are asked to use the microphone, say yes. That is how your bass gets in.</p>
</div>
<div id="pedal" style="display:none">
  <header id="top"><div class="brand"><div class="logo" aria-label="Neon Peach">neon peach</div><div class="brand-sub">Bass FX workstation</div></div><div id="status" aria-live="polite"></div><nav id="sysnav" aria-label="Setup"></nav></header>
  <main id="screen"><nav id="nav" aria-label="Pages"></nav><div id="page"></div></main>
  <div id="deck"><section id="encoders" aria-label="Knobs"></section><section id="foot" aria-label="Footswitches"></section></div>
</div>
<div id="modal"></div>
<div id="toast" role="status" aria-live="polite"></div>
<script type="text/worklet" id="worklet-src">
${namcore}
${worklets}
</script>
<script type="text/worker" id="clone-worker-src">
${namcore}
${cloner}
</script>
<script>
${kernels}
${engine}
${namcore}
${cloner}
${ui}
${ui2}
${ui3}
${ui4}
${desktop}
</script>
</body>
</html>`;
fs.mkdirSync(path.join(__dirname,'dist'),{recursive:true});
fs.writeFileSync(path.join(__dirname,'dist/neon-peach.html'), html);
console.log('built', (html.length/1024).toFixed(0)+' KB', '(kernels '+namWasm.length+' + '+trainWasm.length+' bytes)');
})().catch(e=>{ console.error(e); process.exit(1); });
