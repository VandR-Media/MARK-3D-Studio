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
import {parseGlb} from '../src/glb.js';
const sha=x=>createHash('sha256').update(x).digest('hex');
const output=resolve('dist/visual-v2/acceptance');
mkdirSync(output,{recursive:true});
const renderUrl=pathToFileURL(resolve('dist/MARK-Visual-Engine-v2.html')).href;
function makeStereoWav({sr=48000,seconds=9}={}){
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
 syntheticInput:'Decoded 9 s WAV with L=120 Hz R=6000 Hz (independent known PCM; not a commercial track)',
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
 await page.waitForFunction(()=>window.__MARK_VISUAL_READY__===true||Boolean(window.__MARK_VISUAL_ERROR__),null,{timeout:40000});
 const error=await page.evaluate(()=>window.__MARK_VISUAL_ERROR__);
 if(error)throw Error('Visual renderer initialization: '+error);
 await page.locator('#mode').selectOption(preset);
 await page.waitForFunction(target=>window.MARK_VISUAL_API?.scene()?.id===target,
  preset==='analog-studio'?'analog-studio-v2':'spectrum-matrix-v2',{timeout:40000,polling:200});
 const info=await page.evaluate(()=>window.MARK_VISUAL_API.renderStats());
 if(info.meshCount<(kind==='analog'?100:110)||info.ledCount!==(kind==='analog'?48:108))
  throw Error('Wrong real physical object count '+JSON.stringify(info));
 await page.evaluate(()=>window.MARK_VISUAL_API.view('front'));
 const front=await capture(page,kind+'-'+device+'-front.png');
 const frontLabels=await page.evaluate(()=>window.MARK_VISUAL_API.overlayPositions());
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
  const importedScene=await page.evaluate(()=>window.MARK_VISUAL_API.scene());
  const importedMesh=importedScene.objects.find(o=>o.geometry.type==='imported'&&o.meta?.mesh===true&&
   imported.ids.includes(o.id)&&o.material===null&&o.name);
  if(!importedMesh)throw Error('Imported meshes not available in editable inspector');
  const before=importedMesh.position[0];
  importedMesh.position[0]+=.27;
  importedMesh.material='enclosure';
  await page.evaluate(x=>window.MARK_VISUAL_API.loadScene(x),importedScene);
  const altered=await page.evaluate(()=>window.MARK_VISUAL_API.scene());
  writeFileSync(join(output,kind+'-desktop-imported-edited.markscene'),JSON.stringify(altered,null,2)+'\n');
  const part=altered.objects.find(o=>o.id===importedMesh.id);
  if(part.position[0]!==before+.27||part.material!=='enclosure')
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
  await capture(page,kind+'-real-stereo-pcm.png');
  await page.locator('#pause').click();
  await page.waitForFunction(()=>window.MARK_VISUAL_API.audioState().source==='silence',null,{timeout:3000});
  const silence=await page.evaluate(()=>window.MARK_VISUAL_API.activeSegments());
  if(Object.values(silence).some(n=>n!==0))throw Error('Silence/pause did not clear active segments');
 }
 const profileStats=[];
 for(const profile of ['eco','normal','high']){
  const t0=Date.now();
  await page.evaluate(async x=>window.MARK_VISUAL_API.setQuality(x),profile);
  const durationMs=Date.now()-t0;
  profileStats.push({profile,firstRenderWithRebuildMs:durationMs});
  if(device==='desktop')await capture(page,kind+'-'+profile+'.png');
 }
 if(jsErrors.length)throw Error('Browser JavaScript exceptions: '+jsErrors.join(' | '));
 const summary={preset,device,viewport,meshCount:info.meshCount,ledCount:info.ledCount,
  glbBytes:glb.length,glbSha256:sha(glb),sceneNodes:parsed.nodes.length,
  materialCount:parsed.materials.length,parallaxVerified:true,
  physicalLabelsFollowCamera:true,rearLabelsOccluded:true,profiles:profileStats,status:'pass'};
 report.tests.push(summary);console.log('VISUAL V2 WEBGL PASS '+JSON.stringify(summary));
 await page.close();
}
try{
 for(const p of ['analog-studio','spectrum-matrix']){
  await testPreset(p,{width:1280,height:780});
  await testPreset(p,{width:430,height:932});
 }
 report.status='pass';
}finally{
 writeFileSync(join(output,'browser-report.json'),JSON.stringify(report,null,2)+'\n');
 await browser.close();
}
if(report.status!=='pass')throw Error('Visual Engine browser acceptance did not pass');
