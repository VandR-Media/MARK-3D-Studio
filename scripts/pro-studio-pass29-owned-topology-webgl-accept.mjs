/**
 * Pass29: actual WebGL2 and persisted 3-file .markscene MeshData.
 * Chromium software GPU, NOT a real Huawei test.
 */
import {chromium} from 'playwright';
import {createHash} from 'node:crypto';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {PNG} from 'pngjs';
import {buildSkinnedSeamFixture}
 from './pro-studio-pass17-skinned-seam-fixture.mjs';
import {openPreviewMarkscene,exportEditedSourceGlb}
 from '../src/pro-studio/markscene-v3-preview.js';
import {inspectRiggedGlb} from '../src/pro-studio/rigged-glb-audit.js';
import {parseGlb} from '../src/glb.js';

const root=resolve('dist/pro-studio/pass29-acceptance');
mkdirSync(root,{recursive:true});
const sha=x=>createHash('sha256').update(Buffer.from(x)).digest('hex');
const source=buildSkinnedSeamFixture(),sourceSha=sha(source),
 buildSha=process.env.MARK_SOURCE_SHA||'local-unverified';
const report={schema:'mark.pass29-binary-meshdata-webgl2/1',
 sourceSha,buildSha,backend:'Chromium WebGL2/SwiftShader + Canvas2D',
 realHuaweiTested:false,status:'running',tests:[],artifacts:[],errors:[]};
function artifact(name,data,meta={}){
 const bytes=Buffer.from(data);
 writeFileSync(join(root,name),bytes);
 const record={name,sha256:sha(bytes),bytes:bytes.length,...meta};
 report.artifacts.push(record);return record;
}
function check(id,pass,metrics,reason){
 report.tests.push({id,status:pass?'pass':'fail',metrics,
  reason:pass?'':reason});
 if(!pass)throw Error(id+': '+reason+' '+JSON.stringify(metrics));
}
artifact('source-rigged-70-bones.glb',source);
const browser=await chromium.launch({headless:true,args:[
 '--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'
]});
try{
 const page=await browser.newPage({viewport:{width:1280,height:780}});
 const errors=[];
 page.on('pageerror',e=>errors.push(String(e)));
 page.on('console',e=>{if(e.type()==='error')errors.push(e.text());});
 page.on('dialog',d=>d.accept());
 await page.goto(pathToFileURL(resolve('dist/pro-studio/rig-viewer-offline.html')).href,
  {waitUntil:'load'});
 await page.waitForFunction(()=>window.__MARK_RIG_VIEWER_READY__||
  window.MARK_RIG_LAST_ERROR,null,{timeout:60000});
 const ready=await page.evaluate(()=>({
  gpu:window.MARK_RIG_VIEWER_API?.gpu(),
  error:window.MARK_RIG_LAST_ERROR||null
 }));
 check('P29-REAL-WEBGL-01',!ready.error&&Boolean(ready.gpu),ready,
  'WebGL2 renderer did not initialize');
 await page.evaluate(bytes=>window.MARK_RIG_VIEWER_API.loadBinary(
  new Uint8Array(bytes)),Array.from(source));
 await page.locator('#bridge-write-grant').check();
 await page.locator('#mesh-open').click();
 await page.waitForFunction(()=>document.querySelector('#mesh-output')
  ?.textContent?.includes('UV-швов'),null,{timeout:30000});
 const request=async(method,params={})=>{
  const response=await page.evaluate(async({method,params})=>{
   const r=await window.MARK_AI_BRIDGE.request({
    requestId:'p26.'+method,method,params});
   return r.ok&&r.result?.data?{...r,
    result:{...r.result,data:Array.from(r.result.data)}}:r;
  },{method,params});
  if(!response.ok)throw Error(method+': '+JSON.stringify(response.diagnostics));
  return response.result;
 };
 const initial=await request('meshdata.get',{meshId:'gltf-mesh-0'});
 check('P29-OPTOUT-LEGACY-02',initial.enabled===false,{initial},
  'Existing GLB unexpectedly has a MeshData resource');
 await page.locator('#meshdata-enable').click();
 await page.waitForFunction(()=>Array.isArray(window.MARK_AI_BRIDGE
  .getSnapshot().edits?.meshDataOperations),null,{timeout:30000});
 const created=await request('meshdata.get',{
  meshId:'gltf-mesh-0',full:true});
 check('P29-PERSISTED-MESHDATA-03',
  created.enabled&&created.faces.length===2&&
  created.corners.length===6&&
  created.diagnostics.editableMeshData===true&&
  created.uvSets.includes('TEXCOORD_0')&&
  created.uvSets.includes('TEXCOORD_1'),
  {uvSets:created.uvSets,bytes:created.binaryBytes,
   diagnostics:created.diagnostics},
  'Binary MeshData did not enable or did not preserve UV corners');
 const byFace=(m,face,set)=>{
  const f=m.faces.find(x=>x.triangleIndex===face),
   corners=new Map(m.corners.map(c=>[c.id,c]));
  return f.cornerIds.map(id=>
   corners.get(id).attributes.uvSets['TEXCOORD_'+set]);
 };
 const uv0Before=byFace(created,0,0),uv1Before=byFace(created,1,1),
  uvOtherBefore=byFace(created,1,0);
 await page.locator('#mesh-pick-toggle').click();
 await page.locator('#mesh-pick-mode').selectOption('face');
 await page.evaluate(()=>window.MARK_RIG_VIEWER_API.centerView('front'));
 const clickFace=async face=>{
  const p=await page.evaluate(i=>window.MARK_MESH_PICK_API.projectFace(0,i),face);
  await page.locator('#viewport').scrollIntoViewIfNeeded();
  const box=await page.locator('#viewport').boundingBox();
  if(!p.visible||!box||p.x<=0||p.y<=0||
   p.x>=box.width||p.y>=box.height)throw Error('Face not on actual viewport '+face);
  await page.mouse.click(box.x+p.x,box.y+p.y);
  const picked=await page.evaluate(()=>window.MARK_MESH_PICK_API.selection());
  return{picked,projection:p};
 };
 const firstPick=await clickFace(0);
 check('P29-ACTUAL-MOUSE-FACE0-04',
  firstPick.picked?.mode==='face'&&firstPick.picked.face===0,
  firstPick,'No raycast face0 mouse click');
 await page.locator('#meshdata-uv-scope').selectOption('island');
 await page.locator('#mesh-uv-set').selectOption('0');
 await page.locator('#mesh-uv-preview').click();
 await page.waitForFunction(()=>document.querySelector('#mesh-uv-output')
  ?.textContent?.includes('TEXCOORD_0: 2'),null,{timeout:15000});
 const uvScreenshot=async name=>{
  const png=await page.evaluate(()=>document.querySelector(
   '#mesh-uv-canvas').toDataURL('image/png'));
  if(!png.startsWith('data:image/png;base64,'))
   throw Error('Expected actual Canvas2D screenshot');
  return artifact(name,Buffer.from(png.split(',')[1],'base64'),
   {source:'actual MeshData UV corner canvas, no mock'});
 };
 const before=await uvScreenshot('binary-meshdata-uv0-before.png');
 await page.locator('#mesh-a').fill('999');
 await page.locator('#mesh-uv-du').fill('.25');
 await page.locator('#mesh-uv-dv').fill('-.125');
 await page.locator('#mesh-uv-apply').click();
 await page.waitForFunction(()=>window.MARK_AI_BRIDGE.getSnapshot()
  .edits?.meshDataOperations?.length===1,null,{timeout:30000});
 const modified=await request('meshdata.get',{
  meshId:'gltf-mesh-0',full:true});
 const tol=(a,b)=>Math.abs(a-b)<2e-6;
 check('P29-REAL-UV-ISLAND-05',
  modified.operationCount===1&&
  byFace(modified,0,0).every((point,i)=>point.every((v,k)=>
   tol(v,uv0Before[i][k]+[.25,-.125][k])))&&
  JSON.stringify(byFace(modified,1,0))===JSON.stringify(uvOtherBefore)&&
  JSON.stringify(byFace(modified,1,1))===JSON.stringify(uv1Before),
  {ops:modified.operationCount,
   uv0:byFace(modified,0,0),island:'separate source indexed triangles'},
  'UV island edit incorrectly welded different source islands');
 const after=await uvScreenshot('binary-meshdata-uv0-after.png');
 const p=PNG.sync.read(readFileSync(join(root,before.name))),
  q=PNG.sync.read(readFileSync(join(root,after.name)));
 let pixels=0;
 for(let i=0;i<p.data.length;i+=4){
  const delta=Math.abs(p.data[i]-q.data[i])+
   Math.abs(p.data[i+1]-q.data[i+1])+
   Math.abs(p.data[i+2]-q.data[i+2]);
  if(delta>24)pixels++;
 }
 check('P29-ACTUAL-UV-PIXELS-06',pixels>80,
  {pixels,before:before.sha256,after:after.sha256},
  'UV Canvas2D failed to show true physical coordinates');
 const secondPick=await clickFace(1);
 check('P29-ACTUAL-MOUSE-FACE1-07',
  secondPick.picked?.mode==='face'&&secondPick.picked.face===1,
  secondPick,'Second face must be picked by real raycast');
 await page.locator('#mesh-uv-set').selectOption('1');
 await page.locator('#meshdata-uv-scope').selectOption('face');
 await page.locator('#mesh-uv-du').fill('.125');
 await page.locator('#mesh-uv-dv').fill('.2');
 await page.locator('#mesh-uv-apply').click();
 await page.waitForFunction(()=>window.MARK_AI_BRIDGE.getSnapshot()
  .edits?.meshDataOperations?.length===2,null,{timeout:30000});
 const finalMeshData=await request('meshdata.get',{
  meshId:'gltf-mesh-0',full:true});
 check('P29-TWO-SETS-AND-FACE-IDS-08',
  finalMeshData.operationCount===2&&
  finalMeshData.faces.map(x=>x.id).join(',')===
   created.faces.map(x=>x.id).join(',')&&
  finalMeshData.faces.map(x=>x.cornerIds.join(',')).join('|')===
   created.faces.map(x=>x.cornerIds.join(',')).join('|')&&
  byFace(finalMeshData,1,1).every((point,i)=>point.every((v,k)=>
   tol(v,uv1Before[i][k]+[.125,.2][k]))),
  {ops:finalMeshData.operationCount,
   uv1:byFace(finalMeshData,1,1)},
  'Second UV set edit lost stable semantic face/corner IDs');
 const saved=await request('scene.save'),glb=await request('scene.export');
 const marksceneFile=artifact('editable-binary-meshdata.markscene',saved.data),
  glbFile=artifact('exported-skinned-uv-islands.glb',glb.data);
 const opened=await openPreviewMarkscene(Buffer.from(saved.data)),
  replay=await exportEditedSourceGlb(opened),
  audit=inspectRiggedGlb(Buffer.from(glb.data));
 check('P29-NATIVE-3-ENTRY-AND-RIG-09',
  opened.manifest.assetManifest.length===2&&
  opened.manifest.editableMeshDataResource.uri==='mesh/editable-meshdata.bin'&&
  opened.manifest.editableMeshDataResource.sha256===
   sha(opened.meshDataBinary)&&
  opened.edits.meshDataOperations.length===2&&
  opened.sourceSha256===sourceSha&&
  sha(replay.glb)===sha(glb.data)&&
  audit.skins[0].joints===70&&audit.morphs[0].targets===2&&
  audit.animations.length===3,
  {marksceneFile,glbFile,rig:audit.skins[0]},
  'Binary scene save/reopen or skinned GLB export lost assets');
 await page.locator('#mesh-undo').click();
 await page.waitForFunction(()=>window.MARK_AI_BRIDGE.getSnapshot()
  .edits?.meshDataOperations?.length===1,null,{timeout:30000});
 const undo=await request('meshdata.get',{meshId:'gltf-mesh-0'});
 check('P29-REAL-UNDO-10',undo.operationCount===1,
  {ops:undo.operationCount},'Undo did not restore prior native binary resource');
 await page.locator('#mesh-redo').click();
 await page.waitForFunction(()=>window.MARK_AI_BRIDGE.getSnapshot()
  .edits?.meshDataOperations?.length===2,null,{timeout:30000});
 const redo=await request('scene.export');
 check('P29-IDENTICAL-GLB-REDO-11',sha(redo.data)===sha(glb.data),
  {shaBefore:sha(glb.data),shaAfter:sha(redo.data)},
  'Redo did not reproduce exported binary GLB');
 // Now test actual vertex POSITION editing INSIDE the already persisted
 // independent MeshData containing real UV0 and UV1 copy-on-write edits.
 await page.evaluate(()=>window.MARK_MESH_PICK_API.enable(false));
 await page.evaluate(()=>window.MARK_RIG_VIEWER_API.centerView('front'));
 const beforeMove=artifact('vertex-original-webgl.png',
  await page.locator('#viewport').screenshot(),
  {source:'actual Chromium WebGL2 before P27 position edit'});
 await page.locator('#mesh-pick-mode').selectOption('vertex');
 await page.evaluate(()=>window.MARK_MESH_PICK_API.enable(true));
 const projectedVertex=await page.evaluate(()=>
  window.MARK_MESH_PICK_API.projectVertex(0,6));
 const physicalFaceCentroid=await page.evaluate(()=>
  window.MARK_MESH_PICK_API.projectFace(0,0));
 await page.locator('#viewport').scrollIntoViewIfNeeded();
 const boxVertex=await page.locator('#viewport').boundingBox();
 check('P29-POSITION-MOUSE-ONSCREEN-13',
  Boolean(boxVertex)&&projectedVertex.visible&&
  projectedVertex.x>0&&projectedVertex.y>0&&
  projectedVertex.x<boxVertex.width&&
  projectedVertex.y<boxVertex.height,
  {projectedVertex,boxVertex},
  'Physical source vertex 0 was not on WebGL2 viewport');
 // A raycast strictly ON the triangle corner may miss the face by 1px.
 // Click INSIDE the real rendered face, close to the real COW vertex.
 await page.mouse.click(boxVertex.x+projectedVertex.x*.88+
  physicalFaceCentroid.x*.12,
  boxVertex.y+projectedVertex.y*.88+
   physicalFaceCentroid.y*.12);
 const pickedVertex=await page.evaluate(()=>
  window.MARK_MESH_PICK_API.selection());
 check('P29-ACTUAL-VERTEX-MOUSE-PICK-14',
  pickedVertex?.mode==='vertex'&&pickedVertex.vertex===6,
  {pickedVertex,projectedVertex,physicalFaceCentroid},
  'Visible COW vertex must be selected by real raycast and remapped to stable source vertex 0');
 await page.locator('#mesh-a').fill('999');
 await page.locator('#meshdata-vertex-scope').selectOption('attribute');
 await page.locator('#meshdata-dx').fill('.25');
 await page.locator('#meshdata-dy').fill('0');
 await page.locator('#meshdata-dz').fill('0');
 await page.locator('#meshdata-vertex-move').click();
 await page.waitForFunction(()=>window.MARK_AI_BRIDGE.getSnapshot()
  .edits?.meshDataOperations?.length===3,null,{timeout:30000});
 const vertexAfter=await request('meshdata.get',{
  meshId:'gltf-mesh-0',full:true});
 check('P29-PHYSICAL-VERTEX-MOVE-15',
  vertexAfter.operationCount===3&&
  vertexAfter.diagnostics.positionsEditable===true&&
  vertexAfter.vertices.map(x=>x.id).join(',')===
   finalMeshData.vertices.map(x=>x.id).join(',')&&
  tol(vertexAfter.vertices[0].position[0],
   finalMeshData.vertices[0].position[0]+.25)&&
  vertexAfter.vertices.slice(1).every((v,i)=>
   JSON.stringify(v.position)===
    JSON.stringify(finalMeshData.vertices[i+1].position))&&
  vertexAfter.corners.every((c,i)=>
   JSON.stringify(c.attributes.uvSets)===
    JSON.stringify(finalMeshData.corners[i].attributes.uvSets)),
  {newPosition:vertexAfter.vertices[0],
   oldPosition:finalMeshData.vertices[0]},
  'Binary source POSITION changed wrong rows or modified UV corners');
 await page.evaluate(()=>window.MARK_MESH_PICK_API.enable(false));
 await page.evaluate(()=>window.MARK_RIG_VIEWER_API.centerView('front'));
 const afterMove=artifact('vertex-moved-webgl.png',
  await page.locator('#viewport').screenshot(),
  {source:'actual Chromium WebGL2 after P27 position edit'});
 const moveA=PNG.sync.read(readFileSync(join(root,beforeMove.name))),
  moveB=PNG.sync.read(readFileSync(join(root,afterMove.name)));
 let movedPixels=0;
 for(let i=0;i<moveA.data.length;i+=4)
  if(Math.abs(moveA.data[i]-moveB.data[i])+
   Math.abs(moveA.data[i+1]-moveB.data[i+1])+
   Math.abs(moveA.data[i+2]-moveB.data[i+2])>24)movedPixels++;
 check('P29-TRUE-WEBGL-VERTEX-PIXELS-16',movedPixels>100,
  {movedPixels,before:beforeMove.sha256,after:afterMove.sha256},
  'Real triangle deformation did not change WebGL2 pixels');
 const seamReject=await page.evaluate(async()=>{
  const snapshot=window.MARK_AI_BRIDGE.getSnapshot(),
   sha=snapshot.sourceSha256,
   sourceVertex='mark-attr-'+sha+'-m0-p0-v1';
  const r=await window.MARK_AI_BRIDGE.request({
   requestId:'p27.seam.attribute.reject',
   method:'meshdata.moveVertex',params:{
    meshId:'gltf-mesh-0',primitiveIndex:0,vertexId:sourceVertex,
    scope:'attribute',delta:[0,0,.1]}
  });
  return{ok:r.ok,diagnostics:r.diagnostics};
 });
 check('P29-SPLIT-SEAM-REJECT-17',
  !seamReject.ok&&
  JSON.stringify(seamReject.diagnostics).includes('MOVE_SEAM_SPLIT'),
  seamReject,'Unsafe single-attribute displacement of a split seam must fail');
 await page.locator('#mesh-a').fill('1');
 await page.locator('#meshdata-vertex-scope').selectOption('verified-seam');
 await page.locator('#meshdata-dx').fill('0');
 await page.locator('#meshdata-dy').fill('0');
 await page.locator('#meshdata-dz').fill('.1');
 await page.locator('#meshdata-vertex-move').click();
 await page.waitForFunction(()=>window.MARK_AI_BRIDGE.getSnapshot()
  .edits?.meshDataOperations?.length===4,null,{timeout:30000});
 const movedSeam=await request('meshdata.get',{
  meshId:'gltf-mesh-0',full:true});
 check('P29-SEAM-PAIR-PRESERVED-18',
  movedSeam.operationCount===4&&
  tol(movedSeam.vertices[1].position[2],
   vertexAfter.vertices[1].position[2]+.1)&&
  tol(movedSeam.vertices[4].position[2],
   vertexAfter.vertices[4].position[2]+.1)&&
  JSON.stringify(movedSeam.corners.map(c=>c.attributes.uvSets))===
   JSON.stringify(vertexAfter.corners.map(c=>c.attributes.uvSets)),
  {v1:movedSeam.vertices[1],v4:movedSeam.vertices[4]},
  'Actual verified seam duplicate must move with same POS without UV welding');
 const nativeMove=await request('scene.save'),
  glbMove=await request('scene.export');
 const nativeFile=artifact('meshdata-moved-vertices.markscene',nativeMove.data),
  glbFileMoved=artifact('meshdata-moved-70bone-rig.glb',glbMove.data),
  reopenedMove=await openPreviewMarkscene(Buffer.from(nativeMove.data)),
  exportedMove=await exportEditedSourceGlb(reopenedMove),
  moveAudit=inspectRiggedGlb(Buffer.from(glbMove.data));
 check('P29-PERSISTENT-MOVE-RIG-19',
  reopenedMove.edits.meshDataOperations.length===4&&
  reopenedMove.edits.meshDataOperations.slice(-2)
   .every(op=>op.kind==='meshdata.moveVertex')&&
  reopenedMove.meshDataBinary?.length>64&&
  reopenedMove.sourceSha256===sourceSha&&
  sha(exportedMove.glb)===sha(glbMove.data)&&
  moveAudit.skins[0].joints===70&&
  moveAudit.morphs[0].targets===2&&
  moveAudit.animations.length===3,
  {nativeFile,glbFileMoved,morphs:moveAudit.morphs},
  'The native third resource or rigged true GLB lost MeshData POSITION edits');
 await page.locator('#mesh-undo').click();
 await page.waitForFunction(()=>window.MARK_AI_BRIDGE.getSnapshot()
  .edits?.meshDataOperations?.length===3,null,{timeout:30000});
 const undoneMove=await request('meshdata.get',{meshId:'gltf-mesh-0'});
 await page.locator('#mesh-redo').click();
 await page.waitForFunction(()=>window.MARK_AI_BRIDGE.getSnapshot()
  .edits?.meshDataOperations?.length===4,null,{timeout:30000});
 const redoneMove=await request('scene.export');
 check('P29-TRUE-POSITION-UNDO-REDO-20',
  undoneMove.operationCount===3&&
  sha(redoneMove.data)===sha(glbMove.data),
  {before:sha(glbMove.data),redo:sha(redoneMove.data)},
  'Real animated GLB POSITION/UV bytes did not replay after undo/redo');
 // Real P28 atomic group edit after the two existing persistent UV +
 // two vertex moves. The same UI controls call the production AI Bridge.
 await page.evaluate(()=>window.MARK_RIG_VIEWER_API.centerView('front'));
 const groupBefore=artifact('group-move-before-webgl.png',
  await page.locator('#viewport').screenshot(),
  {type:'true Chromium WebGL2 before atomic MeshData group'});
 await page.locator('#meshdata-group-rows').fill('2,3');
 await page.locator('#meshdata-vertex-scope').selectOption('verified-seam');
 await page.locator('#meshdata-dx').fill('0');
 await page.locator('#meshdata-dy').fill('0');
 await page.locator('#meshdata-dz').fill('.2');
 await page.locator('#meshdata-group-move').click();
 await page.waitForFunction(()=>window.MARK_AI_BRIDGE.getSnapshot()
  .edits?.meshDataOperations?.length===5,null,{timeout:30000});
 const groupGraph=await request('meshdata.get',{
  meshId:'gltf-mesh-0',full:true});
 check('P29-ATOMIC-GROUP-21',
  groupGraph.operationCount===5&&
  groupGraph.diagnostics.binaryVersion===1&&
  [2,3,5].every(i=>tol(groupGraph.vertices[i].position[2],
   movedSeam.vertices[i].position[2]+.2))&&
  groupGraph.vertices.map(x=>x.id).join(',')===
   movedSeam.vertices.map(x=>x.id).join(',')&&
  JSON.stringify(groupGraph.corners.map(c=>c.attributes.uvSets))===
   JSON.stringify(movedSeam.corners.map(c=>c.attributes.uvSets)),
  {vertex2:groupGraph.vertices[2],vertex3:groupGraph.vertices[3],
   vertex5:groupGraph.vertices[5]},
  'Group should modify actual 2,3,5 source POSITION rows, preserve UV');
 await page.evaluate(()=>window.MARK_RIG_VIEWER_API.centerView('front'));
 const groupAfter=artifact('group-move-after-webgl.png',
  await page.locator('#viewport').screenshot(),
  {type:'true Chromium WebGL2 after atomic MeshData group'});
 const pA=PNG.sync.read(readFileSync(join(root,groupBefore.name))),
  pB=PNG.sync.read(readFileSync(join(root,groupAfter.name)));
 let groupPixelDelta=0;
 for(let i=0;i<pA.data.length;i+=4)
  if(Math.abs(pA.data[i]-pB.data[i])+
   Math.abs(pA.data[i+1]-pB.data[i+1])+
   Math.abs(pA.data[i+2]-pB.data[i+2])>24)groupPixelDelta++;
 check('P29-WEBGL-GROUP-PIXELS-22',groupPixelDelta>100,
  {groupPixelDelta,before:groupBefore.sha256,after:groupAfter.sha256},
  'Actual group editing must change rendered model pixels');
 // The source NORMAL rows are preserved until the user explicitly
 // requests a normal recomputation (no unrequested smoothing).
 const afterGroupGlb=await request('scene.export');
 const normalsFromGlb=bytes=>{
  const parsed=parseGlb(Buffer.from(bytes)),json=parsed.json,
   acc=json.accessors[json.meshes[0].primitives[0].attributes.NORMAL],
   v=json.bufferViews[acc.bufferView],
   chunk=parsed.chunks.find(c=>c.type===0x004e4942).data,
   dv=new DataView(chunk.buffer,chunk.byteOffset,chunk.byteLength),
   start=(v.byteOffset||0)+(acc.byteOffset||0),
   stride=v.byteStride??12;
  return Array.from({length:acc.count},(_,i)=>
   Array.from({length:3},(_,k)=>
    dv.getFloat32(start+i*stride+k*4,true)));
 };
 const sourceNormals=normalsFromGlb(glbMove.data),
  beforeNormals=normalsFromGlb(afterGroupGlb.data);
 check('P29-NO-SILENT-NORMAL-CHANGE-23',
  JSON.stringify(sourceNormals)===JSON.stringify(beforeNormals),
  {normalRows:beforeNormals.length},
  'Group position edit must not silently rewrite imported normals');
 await page.locator('#meshdata-normal-recalculate').click();
 await page.waitForFunction(()=>window.MARK_AI_BRIDGE.getSnapshot()
  .edits?.meshDataOperations?.length===6,null,{timeout:30000});
 const normalGraph=await request('meshdata.get',{
  meshId:'gltf-mesh-0',full:true});
 check('P29-PERSISTENT-NORMAL-V2-24',
  normalGraph.operationCount===6&&
  normalGraph.diagnostics.normalsRecalculated===true&&
  normalGraph.diagnostics.binaryVersion===2&&
  normalGraph.vertices.every(v=>Array.isArray(v.normal)&&
   tol(Math.hypot(...v.normal),1))&&
  JSON.stringify(normalGraph.corners.map(c=>c.attributes.uvSets))===
   JSON.stringify(groupGraph.corners.map(c=>c.attributes.uvSets)),
  {diagnostics:normalGraph.diagnostics,
   vertex2:normalGraph.vertices[2]},
  'Independent MeshData v2 must contain real normalized per-vertex normals');
 const shaded=await request('scene.export'),
  shadeNormals=normalsFromGlb(shaded.data);
 let changedNormals=0;
 for(let i=0;i<beforeNormals.length;i++)for(let k=0;k<3;k++)
  if(Math.abs(beforeNormals[i][k]-shadeNormals[i][k])>.005)
   changedNormals++;
 check('P29-REAL-GLB-NORMAL-25',
  shadeNormals.length===beforeNormals.length&&changedNormals>2&&
  normalGraph.vertices.every((v,i)=>
   v.normal.every((x,k)=>tol(x,shadeNormals[i][k]))),
  {normalRows:shadeNormals.length,changedNormals},
  'Actual indexed GLB NORMAL VEC3 binary accessor did not change');
 const invalidPostNormal=await page.evaluate(async(vertexIds)=>{
  const r=await window.MARK_AI_BRIDGE.request({
   requestId:'p28.reject.post.normal',method:'meshdata.moveVertexGroup',
   params:{meshId:'gltf-mesh-0',primitiveIndex:0,
    vertexIds,scope:'verified-seam',delta:[0,0,.1]}
  });
  return{ok:r.ok,diagnostics:r.diagnostics};
 },[normalGraph.vertices[2].id,normalGraph.vertices[3].id]);
 check('P29-AFTER-NORMAL-REJECT-26',
  invalidPostNormal.ok===false&&
  JSON.stringify(invalidPostNormal.diagnostics).includes('NORMAL_TERMINAL'),
  invalidPostNormal,'Post-normal mutable topology edit must fail');
 const shadedNative=await request('scene.save'),
  shadedArchive=artifact('pass29-group-normals-editable.markscene',
   shadedNative.data),
  shadedGlb=artifact('pass29-group-normals-real.glb',shaded.data),
  reopenedNormal=await openPreviewMarkscene(Buffer.from(shadedNative.data)),
  replayNormal=await exportEditedSourceGlb(reopenedNormal),
  rigNormal=inspectRiggedGlb(Buffer.from(shaded.data));
 check('P29-SKIN-NATIVE-V2-27',
  reopenedNormal.edits.meshDataOperations.length===6&&
  reopenedNormal.edits.meshDataOperations.at(-1).kind===
   'meshdata.recalculateNormals'&&
  reopenedNormal.manifest.editableMeshDataResource.byteLength===
   reopenedNormal.meshDataBinary.length&&
  reopenedNormal.meshDataBinary[8]===2&&
  reopenedNormal.sourceSha256===sourceSha&&
  sha(replayNormal.glb)===sha(shaded.data)&&
  rigNormal.skins[0].joints===70&&
  rigNormal.animations.length===3&&
  rigNormal.morphs[0].targets===2,
  {shadedArchive,shadedGlb,normalCount:shadeNormals.length},
  'Reopened 3-resource normal-v2 project not bytewise identical to GLB');
 await page.locator('#mesh-undo').click();
 await page.waitForFunction(()=>window.MARK_AI_BRIDGE.getSnapshot()
  .edits?.meshDataOperations?.length===5,null,{timeout:30000});
 const undoneNormal=await request('meshdata.get',{
  meshId:'gltf-mesh-0'});
 check('P29-NORMAL-V2-UNDO-28',
  undoneNormal.operationCount===5&&
  undoneNormal.diagnostics.binaryVersion===1&&
  !undoneNormal.diagnostics.normalsRecalculated,
  {diagnostics:undoneNormal.diagnostics},
  'Normal Undo must restore physical original-normal binary v1');
 await page.locator('#mesh-redo').click();
 await page.waitForFunction(()=>window.MARK_AI_BRIDGE.getSnapshot()
  .edits?.meshDataOperations?.length===6,null,{timeout:30000});
 const shadedRedo=await request('scene.export');
 check('P29-NORMAL-V2-REDO-29',
  sha(shadedRedo.data)===sha(shaded.data),
  {expected:sha(shaded.data),redo:sha(shadedRedo.data)},
  'Normal Redo must replay exact physical GLB bytes');
 // P29: migrate the *same actual edited skinned model* into a 4th,
 // independently hashed native Vertex/Edge/Face/Halfedge resource.
 const beforeTopoGLB=await request('scene.export');
 const originalBin=glb=>{
  const p=parseGlb(Buffer.from(glb));
  return p.chunks.find(c=>c.type===0x004e4942).data;
 };
 await page.locator('#meshdata-topology-begin').click();
 await page.waitForFunction(()=>Array.isArray(window.MARK_AI_BRIDGE
  .getSnapshot().edits?.meshTopologyOperations),null,{timeout:30000});
 const initialTopo=await request('meshdata.getOwnedTopology',{
  meshId:'gltf-mesh-0',primitiveIndex:0,full:true
 });
 check('P29-BINARY-CATALOG-30',
  initialTopo.enabled===true&&
  initialTopo.schema==='mark.owned-topology/1'&&
  initialTopo.persistedVertexEdgeFaceHalfedge===true&&
  initialTopo.diagnostics.vertexCount===6&&
  initialTopo.diagnostics.edgeCount===6&&
  initialTopo.diagnostics.faceCount===2&&
  initialTopo.diagnostics.halfedgeCount===6&&
  initialTopo.diagnostics.boundaryEdges===6,
  {schema:initialTopo.schema,diagnostics:initialTopo.diagnostics},
  'Separate binary topology catalog was not created from same skinned source');
 const firstEdge=initialTopo.edges.find(e=>e.sourceRows.join(',')==='0,1');
 if(!firstEdge)throw Error('First source indexed edge0-1 missing');
 await page.locator('#meshdata-topology-refresh').click();
 check('P29-TRUE-EDGE-INSPECTOR-31',
  (await page.locator('#meshdata-topology-output').textContent())
   .includes('6')&&
  initialTopo.edges.every(e=>e.id.includes(sourceSha)),
  {firstEdge:firstEdge.id},
  'UI inspector must show actual source SHA-scoped edges');
 const uiBefore=artifact('owned-topology-panel-before.png',
  await page.locator('#meshdata-topology-workspace').screenshot(),
  {source:'real MARK UI inspector, separate owned topology resource'});
 await page.locator('#meshdata-edge-a').fill('0');
 await page.locator('#meshdata-edge-b').fill('1');
 await page.locator('#meshdata-edge-flag').selectOption('seam');
 await page.locator('#meshdata-edge-enabled').check();
 await page.locator('#meshdata-topology-mark').click();
 await page.waitForFunction(()=>window.MARK_AI_BRIDGE.getSnapshot()
  .edits?.meshTopologyOperations?.length===1,null,{timeout:30000});
 const seamTopo=await request('meshdata.getOwnedTopology',{
  meshId:'gltf-mesh-0',full:true});
 check('P29-REAL-EDGE-SEAM-32',
  seamTopo.operationCount===1&&
  seamTopo.diagnostics.markedSeams===1&&
  seamTopo.edges.find(e=>e.id===firstEdge.id)?.seam&&
  JSON.stringify(seamTopo.vertices)===
   JSON.stringify(initialTopo.vertices)&&
  JSON.stringify(seamTopo.faces)===
   JSON.stringify(initialTopo.faces)&&
  JSON.stringify(seamTopo.halfedges)===
   JSON.stringify(initialTopo.halfedges),
  {edge:seamTopo.edges.find(e=>e.id===firstEdge.id)},
  'Edge annotation may not mutate persistent source topology identities');
 await page.locator('#meshdata-edge-flag').selectOption('sharp');
 await page.locator('#meshdata-topology-mark').click();
 await page.waitForFunction(()=>window.MARK_AI_BRIDGE.getSnapshot()
  .edits?.meshTopologyOperations?.length===2,null,{timeout:30000});
 const bothTopo=await request('meshdata.getOwnedTopology',{
  meshId:'gltf-mesh-0',full:true});
 const bothEdge=bothTopo.edges.find(e=>e.id===firstEdge.id);
 check('P29-SEPARATE-SEAM-SHARP-33',
  bothTopo.diagnostics.markedSeams===1&&
  bothTopo.diagnostics.markedSharpEdges===1&&
  bothEdge.seam&&bothEdge.sharp,
  {flags:bothEdge,metrics:bothTopo.diagnostics},
  'Sharp and UV seam flags are independent explicit MARK edge attributes');
 const uiAfter=artifact('owned-topology-panel-marked.png',
  await page.locator('#meshdata-topology-workspace').screenshot(),
  {source:'real MARK UI after seam+sharp source edge edits'});
 check('P29-REAL-UI-STATUS-34',
  (await page.locator('#meshdata-topology-output').textContent())
   .includes('sharp=true')&&
  uiBefore.sha256!==uiAfter.sha256,
  {before:uiBefore.sha256,after:uiAfter.sha256},
  'Real owner panel did not change its displayed edge attributes');
 const annotated=await request('scene.export'),
  imported=parseGlb(Buffer.from(annotated.data)),
  flags=imported.json.meshes[0].primitives[0].extras
   ?.MARK_topologyAnnotations;
 check('P29-GLB-EXTRAS-NO-GEOMETRY-35',
  Boolean(flags)&&flags.schema==='mark.owned-topology-edge-flags/1'&&
  flags.sourceSha256===sourceSha&&flags.edges.length===1&&
  flags.edges[0].id===firstEdge.id&&
  flags.edges[0].seam&&flags.edges[0].sharp&&
  sha(originalBin(annotated.data))===sha(originalBin(beforeTopoGLB.data)),
  {sourceHash:flags.sourceSha256,
   geometryHash:sha(originalBin(annotated.data)),edges:flags.edges},
  'MARK metadata must not silently rewrite any GLB BIN vertex/skin/UV bytes');
 const topoNative=await request('scene.save'),
  nativeTopoFile=artifact('four-resource-owned-topology.markscene',
   topoNative.data),
  topoGlbFile=artifact('marked-skinned-70bone.glb',annotated.data),
  reopenedTopo=await openPreviewMarkscene(Buffer.from(topoNative.data)),
  replayTopo=await exportEditedSourceGlb(reopenedTopo),
  topoAudit=inspectRiggedGlb(Buffer.from(annotated.data));
 check('P29-FOUR-RESOURCE-NATIVE-36',
  reopenedTopo.manifest.assetManifest.length===3&&
  reopenedTopo.manifest.ownedTopologyResource.uri===
   'mesh/owned-topology.bin'&&
  reopenedTopo.manifest.ownedTopologyResource.sha256===
   sha(reopenedTopo.ownedTopologyBinary)&&
  reopenedTopo.edits.meshTopologyOperations.length===2&&
  reopenedTopo.edits.meshDataOperations.length===6&&
  sha(replayTopo.glb)===sha(annotated.data)&&
  topoAudit.skins[0].joints===70&&
  topoAudit.morphs[0].targets===2&&
  topoAudit.animations.length===3,
  {nativeTopoFile,topoGlbFile,rig:topoAudit.skins[0]},
  'Native 4th resource / GLB extras replay broke skinned fixture');
 await page.locator('#mesh-undo').click();
 await page.waitForFunction(()=>window.MARK_AI_BRIDGE.getSnapshot()
  .edits?.meshTopologyOperations?.length===1,null,{timeout:30000});
 const undoTopology=await request('meshdata.getOwnedTopology',{
  meshId:'gltf-mesh-0'
 });
 check('P29-OWNED-EDGE-UNDO-37',
  undoTopology.diagnostics.markedSeams===1&&
  undoTopology.diagnostics.markedSharpEdges===0,
  {diagnostics:undoTopology.diagnostics},
  'Undo must restore actual native binary edge flags');
 await page.locator('#mesh-redo').click();
 await page.waitForFunction(()=>window.MARK_AI_BRIDGE.getSnapshot()
  .edits?.meshTopologyOperations?.length===2,null,{timeout:30000});
 const topoRedone=await request('scene.export');
 check('P29-OWNED-EDGE-BINARY-REDO-38',
  sha(topoRedone.data)===sha(annotated.data),
  {before:sha(annotated.data),redo:sha(topoRedone.data)},
  'Redo must replay exactly identical marked rigged GLB bytes');
 check('P29-NO-CONSOLE-ERRORS-12',errors.length===0,{errors},
  'Chromium reported console/JavaScript errors');
 report.status='pass';
}catch(error){report.status='fail';report.errors.push(String(error?.stack||error));}
finally{
 await browser.close();
 report.completedAt=new Date().toISOString();
 writeFileSync(join(root,'pass29-report.json'),JSON.stringify(report,null,2)+'\n');
 console.log('PASS29 '+report.status.toUpperCase()+' '+JSON.stringify({
  tests:report.tests.map(x=>({id:x.id,status:x.status})),
  errors:report.errors,artifacts:report.artifacts.length
 }));
 if(report.status!=='pass')process.exitCode=1;
}
