/**
 * True Chromium/SwiftShader WebGL2 Visual Engine v2 acceptance.
 * No fake screenshots, no prebaked instrument image. Screenshots are from
 * the actual canvas; WAV is generated as PCM16 and decoded by Web Audio.
 */
import {chromium} from 'playwright';
import {PNG} from 'pngjs';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {parseGlb,writeGlb} from '../src/glb.js';
import {compareGlbFidelity} from '../src/visual-engine/glb-fidelity.js';
const sha=x=>createHash('sha256').update(x).digest('hex');
const output=resolve('dist/visual-v2/acceptance');
mkdirSync(output,{recursive:true});
const renderUrl=pathToFileURL(resolve('dist/MARK-Visual-Engine-v2.html')).href;
function makeStereoWav({sr=48000,seconds=45}={}){
 const n=sr*seconds|0,b=new Uint8Array(44+n*4),v=new DataView(b.buffer);
 const ascii=(s,o)=>{for(let i=0;i<s.length;i++)v.setUint8(o+i,s.charCodeAt(i));};
 ascii('RIFF',0);v.setUint32(4,b.length-8,true);ascii('WAVE',8);ascii('fmt ',12);
 v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,2,true);
 v.setUint32(24,sr,true);v.setUint32(28,sr*4,true);
 v.setUint16(32,4,true);v.setUint16(34,16,true);
 ascii('data',36);v.setUint32(40,n*4,true);
 for(let i=0;i<n;i++){
  v.setInt16(44+i*4,Math.round(.75*Math.sin(2*Math.PI*120*i/sr)*32767),true);
  v.setInt16(46+i*4,Math.round(.75*Math.sin(2*Math.PI*6000*i/sr)*32767),true);
 }
 return Buffer.from(b);
}
const wav=makeStereoWav(),browser=await chromium.launch({headless:true,args:[
 '--no-sandbox','--enable-webgl','--use-gl=angle','--use-angle=swiftshader',
 '--enable-unsafe-swiftshader','--disable-dev-shm-usage','--autoplay-policy=no-user-gesture-required'
]});
const report={sourceCommit:process.env.MARK_SOURCE_SHA||process.env.GITHUB_SHA||'local-unverified',renderer:'Chromium WebGL2',
 syntheticInput:'Decoded 45 s WAV with L=120 Hz R=6000 Hz (independent known PCM; not a commercial track)',
 tests:[],screenshots:[],errors:[],status:'running',deviceMeasured:false};
async function capture(page,file){
 const buffer=await page.locator('#visualCanvas').screenshot();
 const image=PNG.sync.read(buffer);
 if(image.width<200||image.height<200||buffer.length<7000)
  throw Error('Blank or tiny WebGL canvas: '+file);
 const path=join(output,file);writeFileSync(path,buffer);
 report.screenshots.push({file,bytes:buffer.length,sha256:sha(buffer),width:image.width,height:image.height});
 return sha(buffer);
}
async function testPreset(preset,viewport){
 const kind=preset==='analog-studio'?'analog':'matrix',device=viewport.width<600?'mobile':'desktop';
 const page=await browser.newPage({viewport,acceptDownloads:true,deviceScaleFactor:1});
 const jsErrors=[];page.on('pageerror',e=>jsErrors.push(e.message));
 await page.goto(renderUrl,{waitUntil:'load'});
 try {
  await page.waitForFunction(()=>window.__MARK_VISUAL_READY__===true||Boolean(window.__MARK_VISUAL_ERROR__),null,{timeout:40000});
 } catch(waitError) {
  // Preserve page exceptions rather than reporting only the generic timeout.
  const state=await page.evaluate(()=>({
   ready:window.__MARK_VISUAL_READY__===true,
   error:window.__MARK_VISUAL_ERROR__||null,
   canvasPresent:Boolean(document.querySelector('#visualCanvas')),
   statusText:document.querySelector('#signalState')?.textContent||null
  })).catch(error=>({inspectionError:error.message}));
  const diagnostic={preset,viewport,state,pageErrors:jsErrors,waitError:waitError.message};
  report.errors.push(diagnostic);
  await page.screenshot({path:join(output,'startup-failure-'+kind+'-'+device+'.png'),fullPage:true}).catch(()=>{});
  writeFileSync(join(output,'startup-diagnostics.json'),JSON.stringify(diagnostic,null,2)+'\\n');
  throw Error('Visual renderer startup failure: '+JSON.stringify(diagnostic));
 }
 const error=await page.evaluate(()=>window.__MARK_VISUAL_ERROR__);
 if(error)throw Error('Visual renderer initialization: '+error);
 await page.locator('#mode').selectOption(preset);
 await page.waitForFunction(target=>window.MARK_VISUAL_API?.scene()?.id===target,
  preset==='analog-studio'?'analog-studio-v2':'spectrum-matrix-v2',{timeout:40000,polling:200});
 const gpu=await page.evaluate(()=>window.MARK_VISUAL_API.gpuInfo());
 if(!gpu.webgl2)throw Error('Renderer is not a real WebGL2 context: '+JSON.stringify(gpu));
 const info=await page.evaluate(()=>window.MARK_VISUAL_API.renderStats());
 if(info.meshCount<(kind==='analog'?100:110)||info.ledCount!==(kind==='analog'?48:108))
  throw Error('Wrong real physical object count '+JSON.stringify(info));
 await page.evaluate(()=>window.MARK_VISUAL_API.view('front'));
 const frame=await page.evaluate(()=>window.MARK_VISUAL_API.framing());
 const geometry=await page.evaluate(()=>window.MARK_VISUAL_API.geometryStats());
 if(!frame||frame.left<.049||frame.right>.951||frame.top<.02||frame.bottom>.98)
  throw Error('M2 clipped physical 3D case: '+JSON.stringify({device,frame}));
 if(device==='desktop'&&(frame.width<.55||frame.width>.85))
  throw Error('M2 desktop body must use 55-85% canvas width: '+JSON.stringify(frame));
 if(geometry.meshObjects<100||geometry.storedTriangles<1000)
  throw Error('M2 invalid scene complexity statistics: '+JSON.stringify(geometry));
 const front=await capture(page,kind+'-'+device+'-front.png');
 const frontLabels=await page.evaluate(()=>window.MARK_VISUAL_API.overlayPositions());
 await page.evaluate(()=>window.MARK_VISUAL_API.view('detail'));
 await capture(page,kind+'-'+device+'-detail.png');
 await page.evaluate(()=>window.MARK_VISUAL_API.view('front'));
 await page.evaluate(()=>window.MARK_VISUAL_API.view('left30'));
 await capture(page,kind+'-'+device+'-left30.png');
 await page.evaluate(()=>window.MARK_VISUAL_API.view('right30'));
 await capture(page,kind+'-'+device+'-right30.png');
 await page.evaluate(()=>window.MARK_VISUAL_API.view('front'));
 await page.evaluate(()=>window.MARK_VISUAL_API.view('threequarter'));
 const threequarter=await capture(page,kind+'-'+device+'-threequarter.png');
 const angledLabels=await page.evaluate(()=>window.MARK_VISUAL_API.overlayPositions());
 if(front===threequarter)throw Error('3D parallax test failed: camera rotation produced identical pixels');
 const anchorLabel=frontLabels.find(x=>x.anchor!=='hud'&&x.visible);
 const moved=angledLabels.find(x=>x.anchor===anchorLabel?.anchor&&x.text===anchorLabel?.text);
 if(!anchorLabel||!moved||!moved.visible||
  Math.hypot(anchorLabel.left-moved.left,anchorLabel.top-moved.top)<.25)
  throw Error('P0 overlay: dial lettering did not follow camera perspective');
 await page.evaluate(()=>window.MARK_VISUAL_API.view('back'));
 const backLabels=await page.evaluate(()=>window.MARK_VISUAL_API.overlayPositions());
 const backVisible=backLabels.filter(x=>x.anchor!=='hud'&&x.visible).length;
 if(backVisible!==0)throw Error('P0 overlay: device-face labels should be occluded from rear ('+backVisible+' visible)');
 await page.evaluate(()=>window.MARK_VISUAL_API.view('front'));
 if(device==='desktop'){
  // Deliberately inject deterministic per-channel *measurement frames* to
  // isolate renderer kinematics. The separate real decoded PCM WAV test below
  // remains mandatory; these frames must never be presented as audio playback.
  const states=[
   {name:'silence',playing:false,left:[0,0,0,0],right:[0,0,0,0]},
   {name:'left-medium',playing:true,left:[.36,.50,0,0],right:[0,0,0,0]},
   {name:'right-medium',playing:true,left:[0,0,0,0],right:[.36,0,0,.5]},
   {name:'high',playing:true,left:[.96,1,1,1],right:[.92,1,1,1]},
   {name:'paused',playing:false,left:[0,0,0,0],right:[0,0,0,0]}
  ];
  const poses={};
  for(const state of states){
   for(let n=0;n<7;n++){
    await page.evaluate(x=>{
     const channel=values=>({
      rms:values[0],peak:values[0],low:values[1],mid:values[2],
      high:values[3],waveform:Array(128).fill(0)
     });
     window.MARK_VISUAL_API.renderFrame({schema:'mark.audio.stereo/1',
      timestampMs:performance.now(),source:x.playing?'pcm':'silence',
      playing:x.playing,left:channel(x.left),right:channel(x.right),
      bass:0,beat:0});
    },state);
    await page.waitForTimeout(75);
   }
   poses[state.name]=await page.evaluate(()=>window.MARK_VISUAL_API.visualResponse());
   await capture(page,kind+'-amplitude-'+state.name+'.png');
  }
  const needle=key=>poses[key].needles;
  if(kind==='analog'){
   const base=needle('silence'),left=needle('left-medium'),
    right=needle('right-medium'),full=needle('high'),paused=needle('paused');
   if(!(base.left.tipX<-.5&&base.right.tipX<-.5&&
     left.left.tipX>base.left.tipX+.35&&
     Math.abs(left.right.tipX-base.right.tipX)<.07&&
     right.right.tipX>base.right.tipX+.35&&
     right.left.tipX<left.left.tipX-.5&&
     full.left.tipX>left.left.tipX+.1&&full.right.tipX>right.right.tipX+.1&&
     Math.abs(paused.left.tipX-base.left.tipX)<.07&&
     Math.abs(paused.right.tipX-base.right.tipX)<.07))
    throw Error('M2 physical stereo needle direction/inertia error: '+JSON.stringify(poses));
  }
  const lit=(pose,id)=>pose.leds[id]?.active??-1;
  for(const id of ['left.low','right.high']){
   if(!(lit(poses.silence,id)===0&&lit(poses.high,id)>lit(poses.silence,id)&&
     lit(poses.paused,id)===0))
    throw Error('M2 physical LED amplitude not responsive: '+id+' '+JSON.stringify(poses));
  }
  if(!(lit(poses['left-medium'],'left.low')>0&&
       lit(poses['left-medium'],'right.high')===0&&
       lit(poses['right-medium'],'right.high')>0&&
       lit(poses['right-medium'],'left.low')===0))
   throw Error('M2 stereo left/right LED cross-talk in physical meshes');
  if(kind==='matrix'){
   for(const id of ['left.low','right.high']){
    const colors=poses.high.leds[id]?.colors||[];
    if(!['#0abf63','#dfb019','#dd3230'].every(c=>colors.includes(c)))
     throw Error('M2 missing green-yellow-red physical LED ramp: '+id+' '+colors);
   }
  }
  report.tests.push({preset:kind+'-M2-3D-amplitude-sequence',status:'pass',
   source:'deterministic visual signal injection (not a WAV)',
   snapshots:poses});
 }
 const b64=await page.evaluate(()=>window.MARK_VISUAL_API.exportGlb());
 const glb=Buffer.from(b64,'base64'),parsed=parseGlb(glb).json;
 if(parsed.meshes.length<70||parsed.materials.length<10||parsed.nodes.length<75)
  throw Error('3D export is not multi-mesh or lost materials');
 writeFileSync(join(output,kind+'-'+device+'.glb'),glb);
 const saved=await page.evaluate(()=>window.MARK_VISUAL_API.scene());
 writeFileSync(join(output,kind+'-'+device+'.markscene'),JSON.stringify(saved,null,2)+'\n');
 const reloaded=await page.evaluate(async s=>window.MARK_VISUAL_API.loadScene(s),saved);
 if(reloaded.objects!==saved.objects.length)throw Error('Editable .markscene reload lost objects');
 if(device==='desktop'){
  // Failed imports must never destroy unsaved project edits or selection.
  const parsedInput=parseGlb(glb);
  const external=structuredClone(parsedInput.json);
  if(external.buffers?.[0])external.buffers[0].uri='missing-file.bin';
  const extension=structuredClone(parsedInput.json);
  extension.extensionsUsed=[...(extension.extensionsUsed||[]),'KHR_not_supported_test'];
  const badImports=[
   {name:'damaged-binary',bytes:Buffer.from([0,1,2,3])},
   {name:'missing-external-file',bytes:Buffer.from(writeGlb(parsedInput,external))},
   {name:'unsupported-extension',bytes:Buffer.from(writeGlb(parsedInput,extension))}
  ];
  for(const sample of badImports){
   const check=await page.evaluate(async bytes=>{
    const api=window.MARK_VISUAL_API;
    const scene=JSON.stringify(api.scene()),select=document.querySelector('#objectSelect').value;
    let rejected=false,error='';
    try{await api.importGlb(bytes,'corrupt-test.glb');}
    catch(e){rejected=true;error=e.message;}
    return {rejected,error,unchanged:scene===JSON.stringify(api.scene())&&
     select===document.querySelector('#objectSelect').value};
   },sample.bytes.toString('base64'));
   if(!check.rejected||!check.unchanged)
    throw Error('Non-atomic '+sample.name+': '+JSON.stringify(check));
   report.tests.push({preset:kind+'-'+sample.name,status:'pass',...check});
  }
  const negative=await page.evaluate(async()=>{
   const api=window.MARK_VISUAL_API;
   const baseline=api.scene();
   const select=document.querySelector('#objectSelect');
   select.value='case.main';select.dispatchEvent(new Event('change'));
   const selected=select.value;
   const samples=[
    {name:'broken-attachment',change:s=>{
      s.attachments=[{name:'broken.glb',data:'data:model/gltf-binary;base64,AAAA'}];
    }},
    {name:'nonexistent-node',change:s=>{
      s.attachments=[{name:'broken.glb',data:'data:model/gltf-binary;base64,AAAA'}];
      s.objects.push({id:'imported.bad',name:'Missing mesh',parent:null,
       geometry:{type:'imported',asset:0,node:800},material:null,
       position:[0,0,0],rotation:[0,0,0],scale:[1,1,1],visible:true,meta:{}});
    }},
    {name:'invalid-texture',change:s=>{
      s.materials.enclosure.maps={baseColor:'data:image/png;base64,AAAA'};
    }},
    {name:'late-geometry-construction',change:s=>{
      s.objects.push({id:'test.fail.led',name:'Invalid LED material',parent:null,
       geometry:{type:'box',width:1,height:1,depth:1},material:null,
       position:[0,0,0],rotation:[0,0,0],scale:[1,1,1],
       visible:true,meta:{role:'led'}});
    }}
   ];
   const results=[];
   for(const sample of samples){
    const attempt=structuredClone(baseline);sample.change(attempt);
    let rejected=false,message='';
    try{await api.loadScene(attempt);}
    catch(error){rejected=true;message=String(error.message);}
    if(!rejected||JSON.stringify(api.scene())!==JSON.stringify(baseline)||
       select.value!==selected)throw Error('Non-atomic '+sample.name+': '+message);
    results.push({name:sample.name,rejected,projectRetained:true,
     selectionRetained:true,error:message});
   }
   return results;
  });
  report.tests.push({preset:kind+'-atomic-import-errors',
   status:'pass',cases:negative});
  const edited=structuredClone(saved);
  const chassis=edited.objects.find(o=>o.id==='case.main');
  chassis.position[0]+=.18;
  edited.materials.enclosure.color='#304968';
  await page.evaluate(async x=>window.MARK_VISUAL_API.loadScene(x),edited);
  const modified=Buffer.from(await page.evaluate(()=>window.MARK_VISUAL_API.exportGlb()),'base64');
  const doc=parseGlb(modified).json;
  if(modified.equals(glb)||doc.meshes?.length!==parsed.meshes?.length||
    doc.materials?.length!==parsed.materials?.length)
   throw Error('P0 GLB edit: geometry/material changes were lost or node counts shifted');
  writeFileSync(join(output,kind+'-desktop-edited.glb'),modified);
  const lit=structuredClone(saved);
  lit.lights[0].intensity=0;
  await page.evaluate(async x=>window.MARK_VISUAL_API.loadScene(x),lit);
  const muted=await capture(page,kind+'-light-change.png');
  await page.evaluate(async x=>window.MARK_VISUAL_API.loadScene(x),saved);
  const restored=await capture(page,kind+'-light-restored.png');
  if(muted===restored)throw Error('P0 lighting: changing key light did not alter the true renderer');
  // Roundtrip must reconstruct a CLEAN editable graph, never append a duplicate.
  const clean=structuredClone(saved);
  clean.objects=[];clean.bindings=[];clean.overlays=[];delete clean.attachments;
  await page.evaluate(x=>window.MARK_VISUAL_API.loadScene(x),clean);
  const imported=await page.evaluate(x=>window.MARK_VISUAL_API.importGlb(x),
   glb.toString('base64'));
  if(imported.meshes!==parsed.meshes.length)
   throw Error('GLB mesh count lost on clean import: '+imported.meshes+' vs '+parsed.meshes.length);
  const duplicateRejected=await page.evaluate(async b64=>{
   const before=JSON.stringify(window.MARK_VISUAL_API.scene());
   let failed=false;
   try{await window.MARK_VISUAL_API.importGlb(b64);}
   catch(error){failed=/already|уже присутствует/.test(String(error.message));}
   return failed&&before===JSON.stringify(window.MARK_VISUAL_API.scene());
  },glb.toString('base64'));
  if(!duplicateRejected)throw Error('Duplicate import was not rejected atomically');
  const firstRoundtrip=Buffer.from(await page.evaluate(()=>
   window.MARK_VISUAL_API.exportGlb()),'base64');
  const fidelity=compareGlbFidelity(glb,firstRoundtrip,{epsilon:1e-4});
  report.tests.push({preset:kind+'-GLB-semantic-fidelity',status:'pass',...fidelity});
  const importedScene=await page.evaluate(()=>window.MARK_VISUAL_API.scene());
  const importedMesh=importedScene.objects.find(o=>o.geometry.type==='imported'&&o.meta?.mesh===true&&
   imported.ids.includes(o.id)&&o.material===null&&o.name);
  if(!importedMesh)throw Error('Imported meshes not available in editable inspector');
  const before=importedMesh.position[0];
  importedMesh.position[0]+=.27;
  importedMesh.material='amber';
  await page.evaluate(x=>window.MARK_VISUAL_API.loadScene(x),importedScene);
  const altered=await page.evaluate(()=>window.MARK_VISUAL_API.scene());
  writeFileSync(join(output,kind+'-desktop-imported-edited.markscene'),JSON.stringify(altered,null,2)+'\n');
  // Simulate reopening the exact persisted editor project, not only exporting
  // from the current live Three.js graph.
  await page.evaluate(x=>window.MARK_VISUAL_API.loadScene(x),altered);
  const reopened=await page.evaluate(()=>window.MARK_VISUAL_API.scene());
  const reopenedPart=reopened.objects.find(o=>o.id===importedMesh.id);
  if(!reopenedPart||reopenedPart.material!=='amber'||
     reopenedPart.position[0]!==before+.27)
   throw Error('Edited GLB material/position lost on .markscene reopening');
  const part=altered.objects.find(o=>o.id===importedMesh.id);
  if(part.position[0]!==before+.27||part.material!=='amber')
   throw Error('GLB per-part editing not retained in .markscene');
  const editedGlb=Buffer.from(await page.evaluate(()=>window.MARK_VISUAL_API.exportGlb()),'base64');
  const editedDoc=parseGlb(editedGlb).json;
  if(editedDoc.meshes.length!==parsed.meshes.length)
   throw Error('GLB clean edit/export changed mesh count');
  writeFileSync(join(output,kind+'-desktop-reimport.glb'),editedGlb);
  // Reopen edited binary into a second clean scene and verify no duplicate meshes.
  await page.evaluate(x=>window.MARK_VISUAL_API.loadScene(x),clean);
  const second=await page.evaluate(x=>window.MARK_VISUAL_API.importGlb(x),editedGlb.toString('base64'));
  if(second.meshes!==parsed.meshes.length)
   throw Error('GLB second import lost or duplicated meshes');
  const finalGlb=Buffer.from(await page.evaluate(()=>window.MARK_VISUAL_API.exportGlb()),'base64');
  if(parseGlb(finalGlb).json.meshes.length!==parsed.meshes.length)
   throw Error('GLB second export changed mesh count');
  const editedFidelity=compareGlbFidelity(editedGlb,finalGlb,{epsilon:1e-4});
  report.tests.push({preset:kind+'-GLB-edited-fidelity',status:'pass',...editedFidelity});
  report.tests.push({preset:kind+'-GLB-edit-roundtrip',status:'pass',
   originalMeshes:parsed.meshes.length,firstImportMeshes:imported.meshes,
   secondImportMeshes:second.meshes,editorObjectId:part.id,
   editedMaterial:part.material,editedPosition:part.position,
   originalMaterials:parsed.materials.length,editedMaterials:editedDoc.materials.length});
  await page.evaluate(async x=>window.MARK_VISUAL_API.loadScene(x),saved);
 }
 if(kind==='analog'&&device==='desktop'){
  const keyRecipe=JSON.parse(readFileSync('recipes/visual-v2-keyframe-example.json','utf8'));
  await page.evaluate(async r=>window.MARK_VISUAL_API.loadRecipe(r),keyRecipe);
  await page.evaluate(()=>window.MARK_VISUAL_API.seekAnimation('camera-tilt-study',0));
  const pose0=await capture(page,'analog-keyframe-start.png');
  await page.evaluate(()=>window.MARK_VISUAL_API.seekAnimation('camera-tilt-study',1));
  const pose1=await capture(page,'analog-keyframe-mid.png');
  if(pose0===pose1)throw Error('Keyframe animation does not transform real 3D geometry');
  const clipGlb=Buffer.from(await page.evaluate(()=>window.MARK_VISUAL_API.exportGlb()),'base64');
  const clipDoc=parseGlb(clipGlb).json;
  if(!clipDoc.animations?.length)throw Error('GLB lost keyframe animation clips');
  writeFileSync(join(output,'analog-keyframe-animated.glb'),clipGlb);
  report.tests.push({preset:'analog-keyframe-animation',status:'pass',
   animations:clipDoc.animations.length,realGlbBytes:clipGlb.length});
  const originalRecipe=JSON.parse(readFileSync('recipes/visual-v2-analog-studio.json','utf8'));
  await page.evaluate(async r=>window.MARK_VISUAL_API.loadRecipe(r),originalRecipe);
 }
 if(device==='desktop'){
  await page.locator('#audioFile').setInputFiles({name:'independent-stereo-120Hz-6000Hz.wav',
   mimeType:'audio/wav',buffer:wav});
  await page.waitForFunction(()=>window.MARK_VISUAL_API?.audioState()?.source==='pcm',null,{timeout:12000});
  const audio=await page.evaluate(()=>({
   channels:window.MARK_VISUAL_API.activeSegments(),state:window.MARK_VISUAL_API.audioState()
  }));
  if(!(audio.channels['left.low']>audio.channels['left.high']&&
       audio.channels['right.high']>audio.channels['right.low']))
   throw Error('Six real stereo channels do not show test PCM selectivity '+JSON.stringify(audio));
  const activeImage=await capture(page,kind+'-real-stereo-pcm.png');
  await page.waitForTimeout(450);
  const lateImage=await capture(page,kind+'-real-stereo-pcm-late.png');
  if(await page.evaluate(()=>window.MARK_VISUAL_API.audioState().source)!=='pcm')
   throw Error('PCM finished before real 3D visual frame capture');
  await page.locator('#pause').click();
  await page.waitForFunction(()=>window.MARK_VISUAL_API.audioState().source==='silence',null,{timeout:3000});
  const silence=await page.evaluate(()=>window.MARK_VISUAL_API.activeSegments());
  if(Object.values(silence).some(n=>n!==0))throw Error('Silence/pause did not clear active segments');
  const pausedImage=await capture(page,kind+'-paused-silence.png');
  if(activeImage===pausedImage&&lateImage===pausedImage)
   throw Error('M2 PCM visual proof failed: active LEDs/needles identical to paused WebGL canvas');
  report.tests.push({preset:kind+'-webgl-pcm-visible',status:'pass',
   activeSha256:activeImage,lateSha256:lateImage,pausedSha256:pausedImage});
 }
 if(device==='mobile'){
  for(const viewport of [{width:360,height:800},{width:1080,height:1920}]){
   await page.setViewportSize(viewport);
   await page.evaluate(()=>window.MARK_VISUAL_API.view('front'));
   const responsiveFrame=await page.evaluate(()=>window.MARK_VISUAL_API.framing());
   if(!responsiveFrame||responsiveFrame.left<.049||responsiveFrame.right>.951||
      responsiveFrame.top<.02||responsiveFrame.bottom>.98)
    throw Error('M2 responsive viewport clipping '+JSON.stringify({viewport,responsiveFrame}));
   await capture(page,kind+'-'+viewport.width+'x'+viewport.height+'-front.png');
   report.tests.push({preset:kind+'-responsive-'+viewport.width,status:'pass',
    frame:responsiveFrame,viewport});
  }
  await page.setViewportSize({width:430,height:932});
  await page.evaluate(()=>window.MARK_VISUAL_API.view('front'));
 }
 const profileStats=[];
 for(const profile of ['eco','normal','high']){
  const t0=Date.now();
  await page.evaluate(async x=>window.MARK_VISUAL_API.setQuality(x),profile);
  const durationMs=Date.now()-t0;
  const throughput=await page.evaluate(()=>window.MARK_VISUAL_API.benchmarkFrames(8));
  profileStats.push({profile,firstRenderWithRebuildMs:durationMs,throughput});
  if(device==='desktop')await capture(page,kind+'-'+profile+'.png');
 }
 if(jsErrors.length)throw Error('Browser JavaScript exceptions: '+jsErrors.join(' | '));
 const summary={preset,device,viewport,meshCount:info.meshCount,ledCount:info.ledCount,
  glbBytes:glb.length,glbSha256:sha(glb),sceneNodes:parsed.nodes.length,
  physicalFraming:frame,sceneGeometry:geometry,
  materialCount:parsed.materials.length,parallaxVerified:true,
  physicalLabelsFollowCamera:true,rearLabelsOccluded:true,
  webgl2Verified:true,gpu,profiles:profileStats,status:'pass'};
 report.tests.push(summary);console.log('VISUAL V2 WEBGL PASS '+JSON.stringify(summary));
 await page.close();
}
let failure=null;
try{
 for(const p of ['analog-studio','spectrum-matrix']){
  await testPreset(p,{width:1280,height:780});
  await testPreset(p,{width:430,height:932});
 }
 report.status='pass';
}catch(error){
 failure=error;report.status='fail';
 report.errors.push({message:error.message,stack:error.stack});
 console.error('MARK VISUAL V2 ACCEPTANCE FAILED',error.stack);
}finally{
 writeFileSync(join(output,'browser-report.json'),JSON.stringify(report,null,2)+'\n');
 await browser.close();
}
if(failure)throw failure;
if(report.status!=='pass')throw Error('Visual Engine browser acceptance did not pass');
