/**
 * Real Chromium WebGL2 Playwright verification of experimental rig preview.
 * Captures actual canvas pixels after imported glTF animations, never diagrams.
 */
import {chromium} from 'playwright';
import {createHash} from 'node:crypto';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {inspectRiggedGlb} from '../src/pro-studio/rigged-glb-audit.js';
import {compareGlbSemantics} from '../src/pro-studio/glb-semantic-diff.js';
import {openPreviewMarkscene} from '../src/pro-studio/markscene-v3-preview.js';
import {buildRiggedFixture} from './pro-studio-glb-fixtures.mjs';

const sourceSha=process.env.MARK_SOURCE_SHA||'local-unverified';
const root=resolve('dist/pro-studio/acceptance');
mkdirSync(root,{recursive:true});
const SHA=data=>createHash('sha256').update(data).digest('hex');
const json={schema:'mark.rig-webgl2-acceptance/1',sourceSha,
 status:'in_progress',backend:'Chromium WebGL2 / software-backed SwiftShader',
 deviceTested:false,tests:[],screenshots:[],errors:[],exports:[],nativeProjects:[],numericalDiagnostics:[]};
const put=(name,bytes)=>{const path=join(root,name);writeFileSync(path,bytes);return{path:name,sha256:SHA(bytes),bytes:bytes.length};};
const fail=(id,message)=>{json.tests.push({testId:id,status:'fail',reason:message});throw Error(id+': '+message)};
function assertTest(id,predicate,metrics,reason){
 if(!predicate)fail(id,reason||JSON.stringify(metrics));
 json.tests.push({testId:id,status:'pass',metrics});
}
function toBytes(url){return Buffer.from(url.split(',')[1],'base64');}
async function canvasShot(page,name,meta){
 const url=await page.evaluate(()=>window.MARK_RIG_VIEWER_API.canvas());
 if(!url.startsWith('data:image/png;base64,'))throw Error('No real canvas screenshot');
 const image=put(name,toBytes(url));
 json.screenshots.push({...image,...meta,sourceSha,renderer:'real WebGL2 canvas'});
 return image.sha256;
}
const browser=await chromium.launch({headless:true,args:[
 '--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'
]});
try{
 const page=await browser.newPage({viewport:{width:1280,height:780},deviceScaleFactor:1});
 const consoleErrors=[];
 page.on('pageerror',e=>consoleErrors.push(String(e)));
 page.on('console',e=>{if(e.type()==='error')consoleErrors.push(e.text());});
 page.on('dialog',async d=>{consoleErrors.push('DIALOG '+d.message());await d.dismiss();});
 await page.goto(pathToFileURL(resolve('dist/pro-studio/rig-viewer-offline.html')).href,{
  waitUntil:'load',timeout:60000
 });
 await page.waitForFunction(()=>window.__MARK_RIG_VIEWER_READY__||window.MARK_RIG_LAST_ERROR,null,{timeout:60000});
 const startup=await page.evaluate(()=>({
  error:window.MARK_RIG_LAST_ERROR||null,
  gpu:window.MARK_RIG_VIEWER_API?.gpu(),
  pose:window.MARK_RIG_VIEWER_API?.pose()
 }));
 if(startup.error)throw Error('GLTFLoader/WebGL start: '+startup.error);
 assertTest('RIG-WEBGL-001',startup.gpu?.webgl2===true,startup.gpu,
  'Real WebGL2 context was not established');
 assertTest('RIG-GLTF-002',
  startup.pose.skins[0]?.joints===70&&startup.pose.clips.length===3&&
  startup.pose.meshes[0]?.morph.length===2,
  {skins:startup.pose.skins,clips:startup.pose.clips,
   morphs:startup.pose.meshes[0]?.morph.length},
  'Actual GLTFLoader scene lost 70 joints / 3 clips / 2 morph targets');
 const features=await page.evaluate(()=>({
  clipUi:document.querySelectorAll('#clip option').length,
  timeline:document.getElementById('timeline').max
 }));
 assertTest('RIG-CLIP-UI-003',features.clipUi===3&&Number(features.timeline)===12000,features,
  'Clip selector and timeline are not functional');
 const firstFrame=await canvasShot(page,'front-rest.png',{view:'front',clip:0,seconds:0,viewport:'1280x780'});
 const poses={};
 for(let clip=0;clip<3;clip++){
  await page.evaluate(c=>window.MARK_RIG_VIEWER_API.selectClip(c),clip);
  poses[clip]=[];
  for(const seconds of [0,6,11.9]){
   const pose=await page.evaluate(t=>window.MARK_RIG_VIEWER_API.seek(t),seconds);
   const hash=await canvasShot(page,`clip-${clip}-t-${String(seconds).replace('.','p')}.png`,
    {view:'front',clip,seconds,viewport:'1280x780'});
   poses[clip].push({seconds,hash,mesh:pose.meshes[0]?.morph,
    joints:pose.selectedBoneRotations});
  }
  const list=poses[clip];
  assertTest('RIG-ANIM-'+clip+'-004',
   list[0].hash!==list[1].hash&&
   JSON.stringify(list[0].mesh)!==JSON.stringify(list[1].mesh),
   list,'Rendered frames and real morph weights must change on each glTF clip');
 }
 await page.evaluate(()=>window.MARK_RIG_VIEWER_API.selectClip(2));
 await page.evaluate(()=>window.MARK_RIG_VIEWER_API.seek(6));
 for(const view of ['left','right','back','threequarter','top']){
  await page.evaluate(v=>window.MARK_RIG_VIEWER_API.centerView(v),view);
  await canvasShot(page,view+'-dance-t6.png',{view,clip:2,seconds:6,viewport:'1280x780'});
 }
 assertTest('RIG-VIEWS-005',true,{views:['front','left','right','back','threequarter','top']});
 await page.evaluate(()=>window.MARK_RIG_VIEWER_API.centerView('front'));
 for(const device of [{width:430,height:932},{width:360,height:800}]){
  await page.setViewportSize(device);
  await page.waitForTimeout(200);
  const pose=await page.evaluate(()=>window.MARK_RIG_VIEWER_API.render());
  await canvasShot(page,`mobile-${device.width}x${device.height}.png`,
   {view:'front',clip:2,seconds:6,viewport:`${device.width}x${device.height}`});
  assertTest('RIG-MOBILE-'+device.width+'-006',
   pose.skins[0]?.joints===70,{device,pose:pose.skins},
   'Changing viewport lost loaded skeleton');
 }
 await page.setViewportSize({width:1280,height:780});
 await page.evaluate(()=>window.MARK_RIG_VIEWER_API.centerView('front'));
 let exported;
 try{
  exported=await page.evaluate(async()=>{
   const result=await window.MARK_RIG_VIEWER_API.exportRoundTrip();
   return {bytes:Array.from(result.glb),before:result.before,after:result.after,
    semanticPass:result.semanticPass};
  });
 }catch(e){
  json.tests.push({testId:'RIG-EXPORT-007',status:'fail',reason:String(e)});
  throw e;
 }
 const exportBytes=Buffer.from(exported.bytes);
 const exportInfo=put('rig-threejs-export-reimport.glb',exportBytes);
 const examined=inspectRiggedGlb(exportBytes);
 json.exports.push({...exportInfo,before:exported.before,after:exported.after,
  validation:{skins:examined.skins.length,animations:examined.animations.length,
   morphTargets:examined.morphs[0]?.targets},sourceRigSha256:buildRiggedFixture().sha256,
  note:'Independent GLTFExporter binary and clean GLTFLoader re-import; no authoring edits'});
 assertTest('RIG-EXPORT-007',
  exported.semanticPass===true&&examined.skins[0]?.joints===70&&
  examined.animations.length===3&&examined.morphs[0]?.targets===2,
  json.exports[0],
  'Exported GLB lost 70 bones, 2 morph targets or 3 animation clips');
 // Numerical cross-export diagnostics: compare actual GLTFExporter bytes
 // against original source, not just 70/2/3 headline counts. Record mismatches
 // explicitly, even when current experimental export is not lossless.
 const gltfComparison=compareGlbSemantics(buildRiggedFixture().bytes,exportBytes);
 json.numericalDiagnostics.push({profile:'independent-threejs-exporter',
  ...gltfComparison});
 const baseline=await page.evaluate(async()=>{
  window.MARK_RIG_VIEWER_API.selectClip(2);
  window.MARK_RIG_VIEWER_API.seek(6);
  window.MARK_RIG_VIEWER_API.centerView('front');
  const result=await window.MARK_RIG_VIEWER_API.saveNativeProject();
  return {archive:Array.from(result.archive),sourceSha256:result.sourceSha256,
   schema:result.manifest.schema,sceneNodes:result.manifest.sceneGraph.length};
 });
 const baselineNative=Buffer.from(baseline.archive);
 const inputRig=buildRiggedFixture();
 const reopenedNative=await openPreviewMarkscene(baselineNative);
 assertTest('RIG-V3-NATIVE-010',
  baseline.schema==='mark.professional-scene/3-preview'&&baseline.sceneNodes===72&&
  reopenedNative.sourceSha256===SHA(inputRig.bytes)&&
  reopenedNative.manifest.sourceSummary.skinJoints[0]===70,
  {schema:baseline.schema,nodes:baseline.sceneNodes,sourceHash:baseline.sourceSha256},
  'Browser native project cannot preserve exact 70-bone input GLB');
 const beforeEdit=await canvasShot(page,'rig-v3-before-edit.png',
  {view:'front',clip:2,seconds:6,nativeEditing:'before'});
 const editedPose=await page.evaluate(()=>{
  return window.MARK_RIG_VIEWER_API.applyProjectEdit({
   translationX:.36,roughnessFactor:.23});
 });
 const afterEdit=await canvasShot(page,'rig-v3-after-edit.png',
  {view:'front',clip:2,seconds:6,nativeEditing:'after'});
 assertTest('RIG-V3-EDIT-011',
  beforeEdit!==afterEdit&&Math.abs(editedPose.skinnedX-.36)<1e-6&&
  Math.abs(editedPose.roughness-.23)<1e-6,
  {beforeEdit,afterEdit,meshX:editedPose.skinnedX,roughness:editedPose.roughness},
  'Editing did not actually change WebGL2 mesh position and PBR appearance');
 const savedEdit=await page.evaluate(async()=>{
  const result=await window.MARK_RIG_VIEWER_API.saveNativeProject();
  return{archive:Array.from(result.archive),sha256:result.sha256,
   sourceSha256:result.sourceSha256};
 });
 const readAfterEdit=await openPreviewMarkscene(Buffer.from(savedEdit.archive));
 const savedNative=put('rig-v3-preview-edited.markscene',Buffer.from(savedEdit.archive));
 json.nativeProjects.push({...savedNative,format:'mark.professional-scene/3-preview',
  originalSourceHash:savedEdit.sourceSha256,
  nativeSha256:savedEdit.sha256,
  edition:'TRS+PBR+clip selection; not full edit mesh'});
 const reload=await page.evaluate(async bytes=>{
  return window.MARK_RIG_VIEWER_API.openNativeProject(new Uint8Array(bytes));
 },savedEdit.archive);
 const restored=await page.evaluate(()=>window.MARK_RIG_VIEWER_API.applyProjectEdit({}));
 assertTest('RIG-V3-REOPEN-012',
  Math.abs(restored.skinnedX-.36)<1e-6&&Math.abs(restored.roughness-.23)<1e-6&&
  reload.sourceSha256===SHA(inputRig.bytes)&&reload.pose.clips.length===3&&
  readAfterEdit.edits.selection.clipIndex===2,
  {skinnedX:restored.skinnedX,roughness:restored.roughness,
   sourceSha256:reload.sourceSha256,clips:reload.pose.clips.length},
  'Native project save → reopen lost edits, 70-bone source or clip selection');
 const exportEdited=await page.evaluate(async()=>{
  const result=await window.MARK_RIG_VIEWER_API.exportNativeEditedGLB();
  return{glb:Array.from(result.glb),preservesOriginalBinary:result.preservesOriginalBinary};
 });
 const editedGlb=Buffer.from(exportEdited.glb);
 const editedGlbFile=put('rig-v3-preview-edited-export.glb',editedGlb);
 const editedInspection=inspectRiggedGlb(editedGlb);
 const editsNumeric=compareGlbSemantics(inputRig.bytes,editedGlb,{
  allowEditedNodes:['SkinnedQuad'],allowEditedMaterials:[0]});
 json.numericalDiagnostics.push({profile:'v3-preview-edits-only',...editsNumeric});
 json.exports.push({...editedGlbFile,origin:'experimental-v3-preview-edited-project',
  numericProfile:editsNumeric.status});
 assertTest('RIG-V3-EXPORT-013',
  editedInspection.skins[0].joints===70&&editedInspection.animations.length===3&&
  editedInspection.morphs[0].targets===2&&
  exportEdited.preservesOriginalBinary&&editsNumeric.status==='pass_partial_profile',
  {inspection:{skins:editedInspection.skins.length,
   morphs:editedInspection.morphs.length,clips:editedInspection.animations.length},
   numericalErrors:editsNumeric.errors,compared:editsNumeric.numericComparisons},
  'Edited project GLB changed unedited rig, morph, animation or vertex/UV attributes');
 // The project-open path must refuse a corrupted ZIP and leave the last
 // working pose in the renderer intact, never silently clearing the scene.
 const badArchive=savedEdit.archive.slice();
 badArchive[Math.floor(badArchive.length/2)]^=1;
 const rejected=await page.evaluate(async bytes=>{
  const before=window.MARK_RIG_VIEWER_API.pose();
  try{await window.MARK_RIG_VIEWER_API.openNativeProject(new Uint8Array(bytes));
   return{rejected:false};}
  catch(e){
   const after=window.MARK_RIG_VIEWER_API.pose();
   return{rejected:true,error:String(e),
    posePreserved:after.skins[0]?.joints===before.skins[0]?.joints};
  }
 },badArchive);
 assertTest('RIG-V3-SECURE-014',
  rejected.rejected&&rejected.posePreserved,
  rejected,'Corrupt native archive replaced the working scene');
 await canvasShot(page,'rig-v3-reopened-edit.png',
  {view:'front',clip:2,seconds:6,nativeEditing:'reopened'});
 // Restore the original fixture for independently reproducible MP4 frames.
 await page.evaluate(async bytes=>{
  await window.MARK_RIG_VIEWER_API.loadBinary(new Uint8Array(bytes));
 },Array.from(inputRig.bytes));
 // Deterministic 8fps frame sequence from genuine WebGL2 canvas, not a CGI concept.
 const frames=join(root,'video-frames');mkdirSync(frames,{recursive:true});
 await page.evaluate(()=>window.MARK_RIG_VIEWER_API.selectClip(2));
 for(let i=0;i<32;i++){
  const t=i*12/32;
  await page.evaluate(seconds=>window.MARK_RIG_VIEWER_API.seek(seconds),t);
  const image=toBytes(await page.evaluate(()=>window.MARK_RIG_VIEWER_API.canvas()));
  writeFileSync(join(frames,`frame-${String(i).padStart(3,'0')}.png`),image);
 }
 const movie=join(root,'rig-dance-real-webgl.mp4');
 const ffmpeg=spawnSync('ffmpeg',['-hide_banner','-loglevel','error','-y','-framerate','8',
  '-i',join(frames,'frame-%03d.png'),
  '-vf','scale=trunc(iw/2)*2:trunc(ih/2)*2',
  '-c:v','libx264','-preset','ultrafast','-movflags','+faststart',
  '-pix_fmt','yuv420p',movie],{timeout:120000});
 if(ffmpeg.error||ffmpeg.status!==0)
  fail('RIG-VIDEO-008','Actual WebGL frame sequence could not be encoded: '+
   String(ffmpeg.error||ffmpeg.stderr||ffmpeg.signal||'unknown').slice(0,600));
 const movieBytes=readFileSync(movie);
 assertTest('RIG-VIDEO-008',movieBytes.length>2000,put('rig-dance-real-webgl.mp4',movieBytes));
 assertTest('RIG-PAGE-ERRORS-009',consoleErrors.length===0,{consoleErrors},
  'Browser errors during real animation '+JSON.stringify(consoleErrors));
 json.status='pass';
}catch(error){
 json.status='fail';json.errors.push(String(error?.stack||error));
}finally{
 await browser.close();
 json.completedAt=new Date().toISOString();
 writeFileSync(join(root,'browser-report.json'),JSON.stringify(json,null,2)+'\n');
 console.log('MARK RIG WEBGL2 '+json.status.toUpperCase(),JSON.stringify({
  sha:json.sourceSha,tests:json.tests.map(x=>({id:x.testId,status:x.status})),
  screenshots:json.screenshots.length,exports:json.exports.length,errors:json.errors
 }));
 if(json.status!=='pass')process.exitCode=1;
}
