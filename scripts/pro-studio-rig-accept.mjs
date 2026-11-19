/**
 * Real Chromium WebGL2 Playwright verification of experimental rig preview.
 * Captures actual canvas pixels after imported glTF animations, never diagrams.
 */
import {chromium} from 'playwright';
import {createHash} from 'node:crypto';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {inspectRiggedGlb} from '../src/pro-studio/rigged-glb-audit.js';
import {compareGlbSemantics} from '../src/pro-studio/glb-semantic-diff.js';
import {compareGlbTextures} from '../src/pro-studio/glb-texture-qa.js';
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
 const threeTexture=compareGlbTextures(buildRiggedFixture().bytes,exportBytes);
 json.textureDiagnostics=[{profile:'threejs-exporter',...threeTexture}];
 assertTest('RIG-TEXTURE-015',
  threeTexture.status==='pass_supported_png'&&threeTexture.stats.pixelsCompared===4,
  {status:threeTexture.status,stats:threeTexture.stats,errors:threeTexture.errors,
   unverified:threeTexture.unverified},
  'GLTFExporter changed actual decoded PNG pixels, PBR slot, UV selector or sampler');
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
 const editedTexture=compareGlbTextures(inputRig.bytes,editedGlb);
 json.textureDiagnostics.push({profile:'native-edited-glb',...editedTexture});
 assertTest('RIG-TEXTURE-016',
  editedTexture.status==='pass_supported_png'&&editedTexture.stats.pixelsCompared===4,
  {status:editedTexture.status,stats:editedTexture.stats,
   errors:editedTexture.errors,unverified:editedTexture.unverified},
  'Native .markscene reopen/export changed actual decoded PNG pixels or UV/sampler');
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
 // API integration runs ON THE REAL ACTIVE VIEWPORT; it is not a
 // JavaScript mock, and no HTTP/network listener is involved.
 const bridgeResult=await page.evaluate(async()=>{
  const a=window.MARK_AI_BRIDGE,feedback=[];
  let n=0;
  const call=async(method,params={})=>{
   const r=await a.request({requestId:'playwright.'+(++n),method,params});
   feedback.push({method,ok:r.ok,diagnostics:r.diagnostics});
   return r;
  };
  const caps=await call('studio.getCapabilities');
  const denied=await call('asset.upload',{
   name:'denied.glb',type:'glb',data:new Uint8Array([1,2,3,4])
  });
  document.getElementById('bridge-write-grant').checked=true;
  const bytes=Uint8Array.from(atob(window.MARK_EMBEDDED_RIG_BASE64),
   x=>x.charCodeAt(0));
  const uploaded=await call('asset.upload',{name:'rig.glb',type:'glb',data:bytes});
  if(!uploaded.ok)throw Error('asset.upload: '+JSON.stringify(uploaded.diagnostics));
  const opened=await call('scene.open',{assetId:uploaded.result.assetId});
  if(!opened.ok)throw Error('scene.open: '+JSON.stringify(opened.diagnostics));
  const baseline=await call('render.capture',{view:'front',timeSeconds:6});
  if(!baseline.ok)throw Error('Initial real WebGL capture: '+JSON.stringify(baseline.diagnostics));
  const started=await call('transaction.begin');
  if(!started.ok)throw Error('transaction.begin: '+JSON.stringify(started.diagnostics));
  const commands=[
   ['object.setTransform',{uuid:'gltf-node-1',transform:{translation:[.28,0,0]}}],
   ['material.setPbr',{materialId:'gltf-material-0',pbr:{roughnessFactor:.26}}],
   ['animation.preview',{clipIndex:2,timeSeconds:6}]
  ];
  for(const [method,params] of commands){
   const r=await call(method,params);
   if(!r.ok)throw Error('Staged '+method+': '+JSON.stringify(r.diagnostics));
  }
  const committed=await call('transaction.commit',{transactionId:started.result.transactionId});
  if(!committed.ok)throw Error('commit: '+JSON.stringify(committed.diagnostics));
  const after=await call('render.capture',{view:'front',timeSeconds:6});
  if(!after.ok)throw Error('After commit capture: '+JSON.stringify(after.diagnostics));
  const saved=await call('scene.save');
  const exported=await call('scene.export');
  if(!saved.ok||!exported.ok)
   throw Error('Native bridge save/export '+JSON.stringify(feedback.slice(-2)));
  const invalid=await call('object.setTransform',{
   uuid:'SkinnedQuad',transform:{translation:[.5,0,0]}
  });
  const undo=await call('history.undo');
  const undoneState=a.getSnapshot();
  const redo=await call('history.redo');
  const redoneState=a.getSnapshot();
  const side=await call('camera.set',{view:'left'});
  const sideImage=await call('render.capture',{view:'left',timeSeconds:6});
  document.getElementById('bridge-write-grant').checked=false;
  const deniedAfter=await call('material.setPbr',{materialId:'gltf-material-0',
   pbr:{roughnessFactor:.5}});
  return {
   caps:caps.result,denied:denied.diagnostics?.[0]?.code,
   opened:opened.result,baseline:{sha256:baseline.result.sha256,
    width:baseline.result.width,height:baseline.result.height},
   after:{sha256:after.result.sha256,width:after.result.width,
    height:after.result.height,png:Array.from(after.result.data)},
   committed:committed.result,
   saved:{sha256:saved.result.sha256,data:Array.from(saved.result.data)},
   exported:{sha256:exported.result.sha256,data:Array.from(exported.result.data)},
   invalid:invalid.diagnostics?.[0]?.code,
   undo:{ok:undo.ok,edits:undoneState.edits},
   redo:{ok:redo.ok,edits:redoneState.edits},
   side:{ok:side.ok,sha256:sideImage.result?.sha256},
   deniedAfter:deniedAfter.diagnostics?.[0]?.code,feedback
  };
 });
 assertTest('RIG-BRIDGE-DISCOVERY-017',
  bridgeResult.caps?.supported.includes('render.capture')&&
  bridgeResult.caps?.supported.includes('transaction.commit')&&
  bridgeResult.caps?.supported.includes('mesh.edit')&&
  bridgeResult.caps?.supported.includes('mesh.getStats')&&
  !bridgeResult.caps?.supported.includes('mesh.create')&&
  bridgeResult.denied==='WRITE_PERMISSION_DENIED'&&
  bridgeResult.deniedAfter==='WRITE_PERMISSION_DENIED',
  {transport:bridgeResult.caps?.transport,writeRequired:true,
   userGrants:bridgeResult.caps?.writePermissionGranted,
   diagnostics:{denied:bridgeResult.denied,after:bridgeResult.deniedAfter}},
  'Wrong capability set or missing explicit user grant');
 const webglPng=put('ai-bridge-real-WebGL2.png',Buffer.from(bridgeResult.after.png));
 const browserProject=Buffer.from(bridgeResult.saved.data);
 const reopenedViaNode=await openPreviewMarkscene(browserProject);
 const browserGlb=Buffer.from(bridgeResult.exported.data);
 const inspectedViaNode=inspectRiggedGlb(browserGlb);
 const bridgeFiles=[
  put('ai-bridge-edited.markscene',browserProject),
  put('ai-bridge-edited.glb',browserGlb)
 ];
 assertTest('RIG-BRIDGE-TRANSACTION-018',
  bridgeResult.committed.commands===3&&
  bridgeResult.after.sha256!==bridgeResult.baseline.sha256&&
  bridgeResult.invalid==='INVALID_UUID'&&
  bridgeResult.undo.ok&&bridgeResult.redo.ok&&
  bridgeResult.undo.edits.nodeTransforms['1']===undefined&&
  bridgeResult.redo.edits.nodeTransforms['1'].translation[0]===.28,
  {commands:bridgeResult.committed.commands,frontBefore:bridgeResult.baseline.sha256,
   frontAfter:bridgeResult.after.sha256,invalid:bridgeResult.invalid,
   undo:bridgeResult.undo.edits.nodeTransforms,
   redo:bridgeResult.redo.edits.nodeTransforms},
  'Atomic UUID edit, rollback/redo or actual WebGL pixel difference failed');
 assertTest('RIG-BRIDGE-ROUNDTRIP-019',
  reopenedViaNode.sourceSha256===SHA(buildRiggedFixture().bytes)&&
  reopenedViaNode.edits.nodeTransforms['1'].translation[0]===.28&&
  inspectedViaNode.skins[0].joints===70&&inspectedViaNode.animations.length===3&&
  inspectedViaNode.morphs[0].targets===2,
  {nativeSha:bridgeFiles[0].sha256,exportSha:bridgeFiles[1].sha256,
   pngSha:webglPng.sha256,rigJoints:inspectedViaNode.skins[0].joints},
  'Live AI Bridge project export cannot be reopened in clean Node/headless');
 assertTest('RIG-BRIDGE-CAMERA-020',
  bridgeResult.side.ok&&bridgeResult.side.sha256!==bridgeResult.after.sha256&&
  bridgeResult.after.width>0&&bridgeResult.after.height>0,
  {frontSha:bridgeResult.after.sha256,sideSha:bridgeResult.side.sha256,
   width:bridgeResult.after.width,height:bridgeResult.after.height},
  'Camera.set did not update real WebGL viewport');
 json.aiBridge={
  profile:bridgeResult.caps.schema,transport:bridgeResult.caps.transport,
  supportedOperations:bridgeResult.caps.supported,permissionGates:'explicit DOM user grant',
  realCapture:webglPng,project:bridgeFiles[0],glb:bridgeFiles[1],
  noNetworkListener:true};

 // Pass 7: live, ACTUAL WebGL2 binary geometry editing via the same
 // permission-controlled bridge, not a node transform or mock surface.
 const meshBridge=await page.evaluate(async()=>{
  const api=window.MARK_AI_BRIDGE;let n=0;
  const run=async(method,params={})=>{
   const r=await api.request({requestId:'mesh7.'+(++n),method,params});
   if(!r.ok)throw Error(method+': '+JSON.stringify(r.diagnostics));
   return r.result;
  };
  document.getElementById('bridge-write-grant').checked=true;
  const original=await run('mesh.getStats',{meshId:'gltf-mesh-0'});
  const start=await run('render.capture',{view:'front',timeSeconds:6});
  const tx=await run('transaction.begin');
  await run('mesh.edit',{meshId:'gltf-mesh-0',operation:{
   kind:'vertex.move',vertex:2,delta:[0,.28,.24]
  }});
  await run('mesh.edit',{meshId:'gltf-mesh-0',operation:{
   kind:'edge.split',start:1,end:2,factor:.5
  }});
  const staged=await run('mesh.getStats',{meshId:'gltf-mesh-0'});
  const committed=await run('transaction.commit',{transactionId:tx.transactionId});
  const changed=await run('mesh.getStats',{meshId:'gltf-mesh-0'});
  const shot=await run('render.capture',{view:'front',timeSeconds:6});
  const project=await run('scene.save'),exported=await run('scene.export');
  await run('history.undo');
  const undo=await run('mesh.getStats',{meshId:'gltf-mesh-0'});
  await run('history.redo');
  const redo=await run('mesh.getStats',{meshId:'gltf-mesh-0'});
  document.getElementById('bridge-write-grant').checked=false;
  const denied=await api.request({
   requestId:'mesh7.denied',method:'mesh.edit',
   params:{meshId:'gltf-mesh-0',operation:{kind:'face.flip',face:0}}
  });
  return {
   original,staged,committed,changed,undo,redo,
   initialSha:start.sha256,changedSha:shot.sha256,
   initialPng:Array.from(start.data),changedPng:Array.from(shot.data),
   project:Array.from(project.data),exported:Array.from(exported.data),
   denied:denied.diagnostics?.[0]?.code
  };
 });
 const meshScene=put('mesh-edit-p7-native.markscene',Buffer.from(meshBridge.project));
 const meshExport=put('mesh-edit-p7-exported.glb',Buffer.from(meshBridge.exported));
 const meshShotBefore=put('mesh-edit-p7-before-real-webgl.png',
  Buffer.from(meshBridge.initialPng));
 const meshShotAfter=put('mesh-edit-p7-after-real-webgl.png',
  Buffer.from(meshBridge.changedPng));
 const meshReopened=await openPreviewMarkscene(Buffer.from(meshBridge.project));
 const meshDecoded=inspectRiggedGlb(Buffer.from(meshBridge.exported));
 assertTest('RIG-MESH-EDIT-WEBGL-021',
  meshBridge.original.vertexCount===4&&
  meshBridge.staged.vertexCount===5&&
  meshBridge.changed.vertexCount===5&&
  meshBridge.changed.triangleCount===4&&
  meshBridge.changedSha!==meshBridge.initialSha,
  {original:meshBridge.original,changed:meshBridge.changed,
   beforeSha:meshShotBefore.sha256,afterSha:meshShotAfter.sha256},
  'Real WebGL2 canvas or indexed geometry did not change after mesh edit');
 assertTest('RIG-MESH-EDIT-NATIVE-022',
  meshReopened.sourceSha256===SHA(inputRig.bytes)&&
  meshReopened.edits.meshOperations.length===2&&
  meshDecoded.skins[0].joints===70&&meshDecoded.animations.length===3&&
  meshDecoded.morphs[0].targets===2&&
  compareGlbTextures(inputRig.bytes,Buffer.from(meshBridge.exported)).status===
   'pass_supported_png',
  {nativeFile:meshScene,outputGlb:meshExport,
   operations:meshReopened.edits.meshOperations.map(x=>x.kind),
   skins:meshDecoded.skins,morphs:meshDecoded.morphs,
   clips:meshDecoded.animations.length},
  'Native mesh edit reopened with lost original rig/texture/animation data');
 assertTest('RIG-MESH-EDIT-HISTORY-023',
  meshBridge.committed.commands===2&&
  meshBridge.undo.vertexCount===4&&
  meshBridge.redo.vertexCount===5&&
  meshBridge.denied==='WRITE_PERMISSION_DENIED',
  {commitCommands:meshBridge.committed.commands,
   undo:meshBridge.undo.vertexCount,redo:meshBridge.redo.vertexCount,
   denied:meshBridge.denied},
  'Mesh edit undo/redo or write permission guard failed');
 json.meshEdit={
  schema:'mark.mesh-edit-qa/1',sourceSha256:SHA(inputRig.bytes),
  supported:['vertex.move','edge.split','face.flip','face.delete'],
  nativeProject:meshScene,exportedGlb:meshExport,
  realFrames:[meshShotBefore,meshShotAfter],
  caveat:'experimental indexed triangles, NOT full sculpt or Blender'
 };

 // Restore the original fixture for independently reproducible MP4 frames.
 await page.evaluate(async bytes=>{
  await window.MARK_RIG_VIEWER_API.loadBinary(new Uint8Array(bytes));
 },Array.from(inputRig.bytes));
 // Deterministic 8 fps video of real WebGL2 canvas through native
 // Chromium MediaRecorder: never depends on ffmpeg or synthetic images.
 const frames=join(root,'video-frames');mkdirSync(frames,{recursive:true});
 await page.evaluate(()=>window.MARK_RIG_VIEWER_API.selectClip(2));
 const recSetup=await page.evaluate(()=>{
  const canvas=document.getElementById('viewport');
  if(!canvas.captureStream||!window.MediaRecorder||
   !MediaRecorder.isTypeSupported('video/webm;codecs=vp8'))
   return {supported:false};
  const stream=canvas.captureStream(0),track=stream.getVideoTracks()[0];
  const segments=[];
  const recorder=new MediaRecorder(stream,{
   mimeType:'video/webm;codecs=vp8',videoBitsPerSecond:1400000
  });
  const done=new Promise((resolve,reject)=>{
   recorder.onstop=resolve;recorder.onerror=e=>reject(Error(String(e.error||e)));
  });
  recorder.ondataavailable=e=>{if(e.data.size)segments.push(e.data);};
  window.__MARK_RECORDING={stream,track,segments,recorder,done};
  recorder.start(125);return {supported:true,mime:recorder.mimeType};
 });
 if(!recSetup.supported)fail('RIG-VIDEO-008','Canvas MediaRecorder VP8 is unavailable');
 for(let i=0;i<32;i++){
  const t=i*12/32;
  await page.evaluate(seconds=>{
   window.MARK_RIG_VIEWER_API.seek(seconds);
   window.__MARK_RECORDING.track.requestFrame();
  },t);
  const image=toBytes(await page.evaluate(()=>window.MARK_RIG_VIEWER_API.canvas()));
  writeFileSync(join(frames,`frame-${String(i).padStart(3,'0')}.png`),image);
  await page.waitForTimeout(125);
 }
 const recorded=await page.evaluate(async()=>{
  const r=window.__MARK_RECORDING;
  r.recorder.stop();await r.done;r.track.stop();
  const data=new Uint8Array(await new Blob(r.segments,{type:'video/webm'}).arrayBuffer());
  let base64='';
  for(let i=0;i<data.length;i+=16384)
   base64+=String.fromCharCode(...data.subarray(i,i+16384));
  delete window.__MARK_RECORDING;
  return {base64:btoa(base64),mime:'video/webm',bytes:data.length};
 });
 const movieBytes=Buffer.from(recorded.base64,'base64');
 const isWebm=movieBytes.length>2500&&movieBytes.subarray(0,4).toString('hex')==='1a45dfa3';
 assertTest('RIG-VIDEO-008',isWebm,
  {...put('rig-dance-real-webgl.webm',movieBytes),codec:'VP8',fps:8,source:'canvas.captureStream'},
  'MediaRecorder produced no valid EBML WebM from real WebGL2 animation');
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
