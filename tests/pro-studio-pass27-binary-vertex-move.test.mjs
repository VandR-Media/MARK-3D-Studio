import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {parseGlb} from '../src/glb.js';
import {buildSkinnedSeamFixture}
 from '../scripts/pro-studio-pass17-skinned-seam-fixture.mjs';
import {buildEditableMeshDataBinary,previewEditableMeshDataBinary,
 renderEditableMeshDataGlb}
 from '../src/pro-studio/editable-meshdata-binary.js';
import {createPreviewMarkscene,openPreviewMarkscene,exportEditedSourceGlb}
 from '../src/pro-studio/markscene-v3-preview.js';
import {inspectRiggedGlb} from '../src/pro-studio/rigged-glb-audit.js';
import {createAiBridge} from '../src/pro-studio/ai-bridge-core.js';
const source=buildSkinnedSeamFixture(),
 sha=buffer=>createHash('sha256').update(Buffer.from(buffer)).digest('hex'),
 sourceSha=sha(source),
 id=i=>'mark-attr-'+sourceSha+'-m0-p0-v'+i;
const move=(vertex,delta,scope='verified-seam')=>({
 kind:'meshdata.moveVertex',meshIndex:0,primitiveIndex:0,
 vertexId:id(vertex),scope,delta
});
const uv=(face,uvSet,delta)=>({
 kind:'meshdata.translateUv',meshIndex:0,primitiveIndex:0,
 faceId:'mark-face-'+sourceSha+'-m0-p0-source-face-'+face,
 uvSet,scope:'face',delta
});
const build=operations=>buildEditableMeshDataBinary({
 sourceGLB:source,sourceSha256:sourceSha,operations
});
const preview=operations=>previewEditableMeshDataBinary({
 sourceGLB:source,sourceSha256:sourceSha,data:build(operations)
});
const exportReal=operations=>renderEditableMeshDataGlb({
 sourceGLB:source,sourceSha256:sourceSha,data:build(operations)
});
function rows(glb,accessorIndex){
 const p=parseGlb(glb),doc=p.json,a=doc.accessors[accessorIndex],
  v=doc.bufferViews[a.bufferView],
  bin=p.chunks.find(c=>c.type===0x004e4942).data,
  bytes={5121:1,5123:2,5125:4,5126:4}[a.componentType],
  get={5121:'getUint8',5123:'getUint16',5125:'getUint32',5126:'getFloat32'}[
   a.componentType],
  length={SCALAR:1,VEC2:2,VEC3:3,VEC4:4}[a.type],
  start=(v.byteOffset||0)+(a.byteOffset||0),
  step=v.byteStride??bytes*length,
  dv=new DataView(bin.buffer,bin.byteOffset,bin.byteLength);
 return Array.from({length:a.count},(_,i)=>
  Array.from({length},(_,k)=>dv[get](start+step*i+k*bytes,true)));
}
const attrs=(glb,name)=>rows(glb,
 parseGlb(glb).json.meshes[0].primitives[0].attributes[name]);
const close=(a,b)=>Math.abs(a-b)<2e-6;
const checkSaved=(sourceBefore,sourceAfter)=>{
 const a=parseGlb(sourceBefore).json,b=parseGlb(sourceAfter).json;
 assert.deepEqual(b.skins,a.skins);assert.deepEqual(b.animations,a.animations);
 assert.deepEqual(b.materials,a.materials);
 assert.deepEqual(b.textures,a.textures);assert.deepEqual(b.images,a.images);
 const rig=inspectRiggedGlb(sourceAfter);
 assert.equal(rig.skins[0].joints,70);
 assert.equal(rig.morphs[0].targets,2);
 assert.equal(rig.animations.length,3);
};
test('verified seam-scoped vertex move edits two actual binary source rows without welding UV',()=>{
 const before=preview([]),
  after=preview([move(1,[0,0,.15])]);
 assert.ok(before.persisted&&after.standaloneBinary);
 assert.deepEqual(before.vertices.map(v=>v.id),after.vertices.map(v=>v.id));
 assert.deepEqual(before.faces.map(f=>f.cornerIds),
  after.faces.map(f=>f.cornerIds));
 assert.equal(after.diagnostics.positionsEditable,true);
 for(const i of [1,4]){
  assert.ok(close(after.vertices[i].position[2],
   before.vertices[i].position[2]+.15));
  assert.deepEqual(after.vertices[i].position.slice(0,2),
   before.vertices[i].position.slice(0,2));
 }
 for(const i of [0,2,3,5])
  assert.deepEqual(after.vertices[i].position,before.vertices[i].position);
 const originalUV=before.corners.map(c=>c.attributes.uvSets),
  currentUV=after.corners.map(c=>c.attributes.uvSets);
 assert.deepEqual(currentUV,originalUV,
  'Existing distinct seam UV coordinates must not be welded or moved');
 const result=exportReal([move(1,[0,0,.15])]);
 const pos=attrs(result.glb,'POSITION');
 assert.equal(pos.length,6);
 for(const row of [1,4])assert.ok(close(pos[row][2],.15));
 for(const key of ['TEXCOORD_0','TEXCOORD_1',
  'JOINTS_0','WEIGHTS_0','NORMAL'])
  assert.deepEqual(attrs(result.glb,key),attrs(source,key),
   'Moving POSITION must never rewrite '+key);
 assert.equal(sha(source),sourceSha);
 checkSaved(source,result.glb);
});

test('UV0/UV1 COW followed by vertex position and another UV edit retains row provenance',()=>{
 const ops=[uv(0,0,[.125,-.05]),move(0,[.25,0,0],'attribute'),
  uv(1,1,[.1,.2])];
 const original=preview([]),current=preview(ops),out=exportReal(ops);
 assert.deepEqual(current.faces.map(f=>f.id),
  original.faces.map(f=>f.id));
 assert.deepEqual(current.faces.map(f=>f.cornerIds),
  original.faces.map(f=>f.cornerIds));
 assert.ok(close(current.vertices[0].position[0],
  original.vertices[0].position[0]+.25));
 assert.deepEqual(current.vertices[1].position,original.vertices[1].position);
 assert.equal(current.corners[0].attributes.uvSets.TEXCOORD_0[0],
  Math.fround(original.corners[0].attributes.uvSets.TEXCOORD_0[0]+.125));
 const pos=attrs(out.glb,'POSITION');
 assert.equal(pos.length,12);
 assert.ok(close(pos[0][0],-.17));
 assert.ok(close(pos[6][0],pos[0][0]),
  'Cloned UV0 corner must inherit changed true source POSITION');
 assert.equal(out.movedVertices,1);
 assert.equal(current.attributeRowProvenance.length,12);
 assert.equal(current.attributeRowProvenance[6].sourceAttributeVertex,0);
 assert.equal(current.attributeRowProvenance[6].vertexId,id(0));
 assert.equal(current.attributeRowProvenance[7].sourceAttributeVertex,1);
 assert.equal(current.attributeRowProvenance[9].sourceAttributeVertex,4);
 assert.deepEqual(current.attributeRowProvenance.slice(0,6).map(x=>x.vertexId),
  original.vertices.map(x=>x.id));
 for(let i=0;i<6;i++)
  if(i!==0)assert.deepEqual(pos[i],attrs(source,'POSITION')[i]);
 for(const semantic of ['JOINTS_0','WEIGHTS_0','NORMAL']){
  assert.deepEqual(attrs(out.glb,semantic).slice(0,6),
   attrs(source,semantic));
 }
 const oldDoc=parseGlb(source).json,
  newDoc=parseGlb(out.glb).json;
 for(let i=0;i<2;i++){
  const oldMorph=rows(source,
   oldDoc.meshes[0].primitives[0].targets[i].POSITION),
   newer=rows(out.glb,
    newDoc.meshes[0].primitives[0].targets[i].POSITION);
  assert.deepEqual(newer.slice(0,6),oldMorph);
  assert.deepEqual(newer[6],oldMorph[0]);
 }
 checkSaved(source,out.glb);
});

test('seam tearing, forged source IDs and degenerate/flipped triangles fail closed',()=>{
 assert.throws(()=>build([move(1,[0,0,.15],'attribute')]),
  /MARK_MDB_MOVE_SEAM_SPLIT/);
 assert.throws(()=>build([move(100,[0,0,.1])]),
  /MARK_MDB_MOVE_VERTEX/);
 assert.throws(()=>build([move(0,[.84,0,0],'attribute')]),
  /MARK_MDB_MOVE_TOPOLOGY/);
 assert.throws(()=>build([move(0,[1.1,0,0],'attribute')]),
  /MARK_MDB_MOVE_TOPOLOGY/);
 for(const invalid of [
  {...move(0,[.15,0,0]),vertexId:'mark-attr-forged-v0'},
  {...move(0,[.15,0,0]),scope:'invalid'},
  {...move(0,[.15,0,0]),delta:[0,0,0]},
  {...move(0,[.15,0,0]),delta:[100,0,0]},
  {...move(0,[.15,0,0]),script:'bad'},
  {...move(0,[.15,0,0]),delta:[.1,NaN,0]}
 ])assert.throws(()=>build([invalid]),/MARK_MDB_/);
 assert.throws(()=>build([{
  kind:'meshdata.unknown',meshIndex:0,primitiveIndex:0
 }]),/MARK_MDB_OPS_KIND/);
});

test('binary POSITION changes replay bytewise and native 3-resource .markscene migration stays safe',async()=>{
 const ops=[move(0,[.25,0,0],'attribute'),
  uv(0,0,[.1,0]),move(1,[0,0,.1])];
 const original=build([]),newBinary=build(ops);
 assert.equal(original.length,newBinary.length);
 assert.notDeepEqual(original,newBinary);
 const project=await createPreviewMarkscene(source,{
  projectId:'pass27-vertex-native',edits:{meshDataOperations:ops}
 });
 const opened=await openPreviewMarkscene(project.archive);
 assert.deepEqual(opened.sourceGLB,source);
 assert.deepEqual(opened.meshDataBinary,newBinary);
 assert.deepEqual(opened.edits.meshDataOperations,ops);
 const exportFirst=await exportEditedSourceGlb(opened);
 assert.deepEqual(exportFirst.glb,exportReal(ops).glb);
 assert.equal(sha(source),sourceSha);
 checkSaved(source,exportFirst.glb);
 const recreated=await createPreviewMarkscene(source,{
  projectId:'pass27-vertex-native',edits:opened.edits
 });
 assert.deepEqual(recreated.archive,project.archive);
 const corrupted=project.archive.slice(),
  start=Buffer.from(corrupted).indexOf(Buffer.from('MARKMDB1'));
 assert.ok(start>0);
 corrupted[start+65]^=1;
 await assert.rejects(()=>openPreviewMarkscene(corrupted),
  /MARK_SCENE3_ZIP_CRC|MARK_SCENE3_MESHDATA_SHA/);
 await assert.rejects(()=>createPreviewMarkscene(source,{
  edits:{meshDataOperations:[{...move(0,[.1,0,0]),foreign:true}]}
 }),/MARK_SCENE3_MESHDATA_OP/);
});

test('AI Bridge source-bound vertex pick, actual GLB, no seam tearing, Undo/Redo and reopen',async()=>{
 const bridge=createAiBridge({allowWrites:true,buildHash:'pass27'});
 let count=0;const call=async(method,params={})=>{
  const r=await bridge.request({requestId:'p27.'+(++count),method,params});
  assert.equal(r.ok,true,JSON.stringify(r.diagnostics));return r.result;
 };
 const caps=await call('studio.getCapabilities');
 assert.ok(caps.supported.includes('meshdata.moveVertex'));
 const asset=await call('asset.upload',{
  type:'glb',name:'70-joint-seam.glb',data:source});
 await call('scene.open',{assetId:asset.assetId});
 await call('meshdata.begin',{meshId:'gltf-mesh-0',primitiveIndex:0});
 const orig=await call('meshdata.get',{
  meshId:'gltf-mesh-0',primitiveIndex:0,full:true});
 assert.equal(orig.vertices.length,6);
 const rejected=await bridge.request({requestId:'bad.source',
  method:'meshdata.moveVertex',params:{meshId:'gltf-mesh-0',
   primitiveIndex:0,vertexId:id(1),scope:'attribute',delta:[0,0,.1]}});
 assert.equal(rejected.ok,false);
 assert.ok(JSON.stringify(rejected.diagnostics).includes('MOVE_SEAM_SPLIT'));
 const forged=await bridge.request({requestId:'bad.forged',
  method:'meshdata.moveVertex',params:{meshId:'gltf-mesh-0',
   primitiveIndex:0,vertexId:id(99),scope:'verified-seam',
   delta:[0,0,.1]}});
 assert.equal(forged.ok,false);
 assert.ok(JSON.stringify(forged.diagnostics).includes('MDB_MOVE_STALE'));
 await call('meshdata.translateUv',{meshId:'gltf-mesh-0',primitiveIndex:0,
  faceId:'mark-face-'+sourceSha+'-m0-p0-source-face-0',
  scope:'face',uvSet:0,delta:[.1,0]});
 await call('meshdata.moveVertex',{meshId:'gltf-mesh-0',
  primitiveIndex:0,vertexId:id(0),scope:'attribute',
  delta:[.25,0,0]});
 await call('meshdata.moveVertex',{meshId:'gltf-mesh-0',
  primitiveIndex:0,vertexId:id(1),scope:'verified-seam',
  delta:[0,0,.1]});
 const view=await call('meshdata.get',{meshId:'gltf-mesh-0',full:true});
 assert.equal(view.operationCount,3);
 assert.ok(close(view.vertices[0].position[0],-.17));
 assert.ok(close(view.vertices[4].position[2],.1));
 const stats=await call('mesh.getStats',{meshId:'gltf-mesh-0'});
 assert.equal(stats.vertexCount,9);
 assert.equal(stats.triangleCount,2);
 const native=await call('scene.save'),exported=await call('scene.export');
 const opened=await openPreviewMarkscene(native.data);
 assert.equal(opened.edits.meshDataOperations.length,3);
 assert.equal(opened.manifest.assetManifest.length,2);
 assert.deepEqual((await exportEditedSourceGlb(opened)).glb,exported.data);
 checkSaved(source,exported.data);
 await call('history.undo');
 const afterUndo=await call('meshdata.get',{meshId:'gltf-mesh-0'});
 assert.equal(afterUndo.operationCount,2);
 await call('history.redo');
 assert.deepEqual((await call('scene.export')).data,exported.data);
 const again=createAiBridge({allowWrites:true});
 let n=0;const ask=async(method,params={})=>{
  const r=await again.request({requestId:'reload.'+(++n),method,params});
  assert.equal(r.ok,true,JSON.stringify(r.diagnostics));return r.result;
 };
 const loaded=await ask('asset.upload',{type:'markscene',
  name:'pass27.markscene',data:native.data});
 await ask('scene.open',{assetId:loaded.assetId});
 assert.deepEqual((await ask('scene.export')).data,exported.data);
 assert.equal((await ask('meshdata.get',{meshId:'gltf-mesh-0'}))
  .operationCount,3);
});
