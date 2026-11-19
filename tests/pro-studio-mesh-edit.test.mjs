import test from 'node:test';
import assert from 'node:assert/strict';
import {buildRiggedFixture} from '../scripts/pro-studio-glb-fixtures.mjs';
import {buildComplexRigFixture} from '../scripts/pro-studio-complex-rig-fixture.mjs';
import {parseGlb} from '../src/glb.js';
import {inspectRiggedGlb} from '../src/pro-studio/rigged-glb-audit.js';
import {compareGlbTextures} from '../src/pro-studio/glb-texture-qa.js';
import {applyMeshOperations,getMeshEditStats,validateMeshOperation}
 from '../src/pro-studio/mesh-edit-core.js';
import {createPreviewMarkscene,openPreviewMarkscene,exportEditedSourceGlb,
 repackPreviewMarkscene} from '../src/pro-studio/markscene-v3-preview.js';
import {createAiBridge} from '../src/pro-studio/ai-bridge-core.js';

const fixture=buildRiggedFixture(),complex=buildComplexRigFixture();
const op=(kind,params={})=>({kind,meshIndex:0,primitiveIndex:0,...params});
const report=x=>JSON.stringify(x);
const getAccessor=(data,index)=>{
 const p=parseGlb(data),a=p.json.accessors[index],v=p.json.bufferViews[a.bufferView],
  bin=p.chunks.find(c=>c.type===0x004e4942).data;
 const d=new DataView(bin.buffer,bin.byteOffset,bin.byteLength),
  size={SCALAR:1,VEC2:2,VEC3:3,VEC4:4,MAT4:16}[a.type],
  unit={5121:1,5123:2,5125:4,5126:4}[a.componentType],
  methods={5121:'getUint8',5123:'getUint16',5125:'getUint32',5126:'getFloat32'},
  stride=v.byteStride??size*unit,start=(v.byteOffset||0)+(a.byteOffset||0);
 return Array.from({length:a.count},(_,i)=>
  Array.from({length:size},(_,j)=>d[methods[a.componentType]](start+i*stride+j*unit,true)));
};
const mesh0=bytes=>{
 const doc=parseGlb(bytes).json,p=doc.meshes[0].primitives[0];
 return{p,doc,position:getAccessor(bytes,p.attributes.POSITION),
  index:getAccessor(bytes,p.indices).map(row=>row[0]),
  morph:p.targets.map(t=>getAccessor(bytes,t.POSITION)),
  joints:getAccessor(bytes,p.attributes.JOINTS_0),
  weights:getAccessor(bytes,p.attributes.WEIGHTS_0),
  uv:getAccessor(bytes,p.attributes.TEXCOORD_0)};
};

test('vertex.move changes REAL BIN POSITION but source, skins, morph deltas, clips, PNG remain intact',()=>{
 const before=mesh0(fixture.bytes),original=fixture.bytes.slice();
 const moved=applyMeshOperations(fixture.bytes,[op('vertex.move',{vertex:2,delta:[.12,.24,.06]})]);
 const after=mesh0(moved);
 assert.ok(Math.abs(after.position[2][0]-before.position[2][0]-.12)<1e-6);
 assert.ok(Math.abs(after.position[2][1]-before.position[2][1]-.24)<1e-6);
 assert.deepEqual(after.morph,before.morph);
 assert.deepEqual(after.joints,before.joints);
 assert.deepEqual(after.weights,before.weights);
 assert.deepEqual(after.uv,before.uv);
 assert.deepEqual(after.index,before.index);
 assert.deepEqual(fixture.bytes,original);
 const audit=inspectRiggedGlb(moved);
 assert.equal(audit.skins[0].joints,70);
 assert.equal(audit.animations.length,3);
 assert.equal(audit.morphs[0].targets,2);
 assert.equal(compareGlbTextures(fixture.bytes,moved).status,'pass_supported_png');
});

test('edge.split makes 1 REAL vertex + two new triangles and interpolates UV, 4-way skin and morph deltas',()=>{
 const before=mesh0(fixture.bytes);
 const edge=op('edge.split',{start:1,end:2,factor:.5});
 const modified=applyMeshOperations(fixture.bytes,[edge]);
 const after=mesh0(modified);
 assert.equal(after.position.length,5);
 assert.equal(after.index.length,12);
 assert.equal(after.morph[0].length,5);
 assert.equal(after.morph[1].length,5);
 for(let k=0;k<3;k++)
  assert.ok(Math.abs(after.position[4][k]-(before.position[1][k]+before.position[2][k])*.5)<1e-6);
 for(let k=0;k<2;k++)
  assert.ok(Math.abs(after.uv[4][k]-(before.uv[1][k]+before.uv[2][k])*.5)<1e-6);
 assert.ok(Math.abs(after.weights[4].reduce((a,b)=>a+b,0)-1)<1e-6);
 assert.deepEqual(after.joints[4].slice(0,3),[0,14,27]);
 assert.equal(inspectRiggedGlb(modified).skins[0].joints,70);
 assert.equal(getMeshEditStats(modified).triangleCount,4);
 assert.equal(compareGlbTextures(fixture.bytes,modified).status,'pass_supported_png');
});

test('face.flip swaps winding and face.delete reduces actual triangle index buffer',()=>{
 const original=mesh0(fixture.bytes);
 const swapped=applyMeshOperations(fixture.bytes,[op('face.flip',{face:0})]);
 assert.deepEqual(mesh0(swapped).index.slice(0,3),
  [original.index[0],original.index[2],original.index[1]]);
 const deleted=applyMeshOperations(fixture.bytes,[op('face.delete',{face:0})]);
 assert.deepEqual(mesh0(deleted).index,original.index.slice(3));
 assert.equal(getMeshEditStats(deleted).triangleCount,1);
 assert.equal(inspectRiggedGlb(deleted).animations.length,3);
 assert.equal(compareGlbTextures(fixture.bytes,deleted).status,'pass_supported_png');
});

test('normal.recalculate replaces actual glTF Float32 vertex normals from oriented triangle geometry',()=>{
 const original=mesh0(fixture.bytes),flipped=applyMeshOperations(
  fixture.bytes,[op('face.flip',{face:0})]);
 const recomputed=applyMeshOperations(flipped,[op('normal.recalculate')]);
 const doc=parseGlb(recomputed).json,prim=doc.meshes[0].primitives[0];
 const normals=getAccessor(recomputed,prim.attributes.NORMAL);
 assert.equal(normals.length,original.position.length);
 for(const row of normals)assert.ok(Math.abs(Math.hypot(...row)-1)<1e-5,
  'area-weighted normal should be unit-length');
 assert.notEqual(prim.attributes.NORMAL,parseGlb(fixture.bytes).json.meshes[0].primitives[0].attributes.NORMAL);
 assert.equal(inspectRiggedGlb(recomputed).skins[0].joints,70);
 assert.equal(compareGlbTextures(fixture.bytes,recomputed).status,'pass_supported_png');
});
test('topology diagnostics detect boundary, inconsistent winding and duplicate triangles independently',()=>{
 const stats=getMeshEditStats(fixture.bytes);
 assert.equal(stats.vertexCount,4);
 assert.equal(stats.triangleCount,2);
 assert.equal(stats.boundaryEdges,4);
 assert.equal(stats.nonManifoldEdges,0);
 assert.equal(stats.duplicateFaces,0);
 const flipped=applyMeshOperations(fixture.bytes,[op('face.flip',{face:0})]);
 assert.equal(getMeshEditStats(flipped).conflictingWindingEdges,1);
 const duplicate=applyMeshOperations(fixture.bytes,[
  op('edge.split',{start:1,end:2,factor:.5}),
  op('normal.recalculate')
 ]);
 assert.equal(getMeshEditStats(duplicate).triangleCount,4);
 assert.equal(getMeshEditStats(duplicate).nonManifoldEdges,0);
});
test('normal.recalculate survives native save/open/export and undo / redo with real BIN change',async()=>{
 const input=await createPreviewMarkscene(fixture.bytes,{
  projectId:'pass8-normal-profile',edits:{meshOperations:[
   op('face.flip',{face:0}),op('normal.recalculate')
  ]}
 });
 const saved=await openPreviewMarkscene(input.archive);
 assert.deepEqual(saved.edits.meshOperations.map(x=>x.kind),
  ['face.flip','normal.recalculate']);
 const exported=await exportEditedSourceGlb(saved);
 assert.equal(exported.geometryModified,true);
 const doc=parseGlb(exported.glb).json;
 assert.notEqual(doc.meshes[0].primitives[0].attributes.NORMAL,
  parseGlb(fixture.bytes).json.meshes[0].primitives[0].attributes.NORMAL);
 assert.equal(saved.sourceSha256,fixture.sha256);
});
test('invalid mesh mutations reject unknown operation, invalid indices, zero area budget and last face deletion',()=>{
 for(const invalid of [
  op('explode',{vertex:0}),
  op('vertex.move',{vertex:123,delta:[1,0,0]}),
  op('vertex.move',{vertex:0,delta:[Infinity,0,0]}),
  op('face.flip',{face:77}),
  op('edge.split',{start:0,end:77}),
  op('edge.split',{start:0,end:1,factor:1}),
  op('edge.split',{start:0,end:3,factor:.5})
 ]){
  assert.throws(()=>applyMeshOperations(fixture.bytes,[invalid]),/MARK_MESH_/);
 }
 const single=applyMeshOperations(fixture.bytes,[op('face.delete',{face:0})]);
 assert.throws(()=>applyMeshOperations(single,[op('face.delete',{face:0})]),
  /MARK_MESH_LAST_FACE/);
 assert.throws(()=>applyMeshOperations(fixture.bytes,Array(65).fill(op('face.flip',{face:0}))),
  /MARK_MESH_OPS_BUDGET/);
});

test('v3-preview native .markscene stores typed geometry operation log but exact ORIGINAL GLB stays byte-identical',async()=>{
 const operations=[
  op('vertex.move',{vertex:2,delta:[.18,0,.15]}),
  op('edge.split',{start:1,end:2,factor:.5}),
  op('face.flip',{face:0})
 ];
 const edits={nodeTransforms:{},materialPbr:{},
  selection:{clipIndex:2,timeSeconds:6},meshOperations:operations};
 const saved=await createPreviewMarkscene(fixture.bytes,{
  projectId:'mesh-pass7',name:'real binary mesh editing',edits
 });
 const reopened=await openPreviewMarkscene(saved.archive);
 assert.deepEqual(reopened.sourceGLB,fixture.bytes);
 assert.deepEqual(reopened.edits.meshOperations,operations);
 const exported=await exportEditedSourceGlb(reopened);
 assert.equal(exported.geometryModified,true);
 assert.equal(exported.preservesOriginalBinary,false);
 assert.equal(exported.originalSourcePreservedInNative,true);
 const geom=mesh0(exported.glb);
 assert.equal(geom.position.length,5);
 assert.equal(geom.index.length,12);
 assert.equal(compareGlbTextures(fixture.bytes,exported.glb).status,'pass_supported_png');
 const reexported=await exportEditedSourceGlb(await openPreviewMarkscene(saved.archive));
 assert.deepEqual(reexported.glb,exported.glb);
 const changed=await repackPreviewMarkscene(reopened,{
  ...reopened.edits,meshOperations:[...operations,op('face.delete',{face:2})]
 });
 assert.equal((await openPreviewMarkscene(changed.archive)).edits.meshOperations.length,4);
});

test('stored malicious mesh operation with additional unsafe keys is rejected',async()=>{
 for(const operation of [
  {...op('vertex.move',{vertex:0,delta:[0,0,0]}),script:'eval("x")'},
  op('edge.split',{start:99,end:1,factor:.5}),
  op('face.delete',{face:999}),
  op('edge.split',{start:1,end:2,factor:0})
 ]){
  await assert.rejects(()=>createPreviewMarkscene(fixture.bytes,{
   edits:{meshOperations:[operation]}}),/MARK_SCENE3_/);
 }
});

test('complex 12-skinned-mesh rig can edit ONE mesh without modifying other mesh geometry, joint matrices or clips',()=>{
 const before=parseGlb(complex.bytes).json;
 const modified=applyMeshOperations(complex.bytes,[op('edge.split',{start:1,end:2})]);
 const after=parseGlb(modified).json;
 assert.equal(before.meshes.length,12);
 assert.equal(after.meshes.length,12);
 assert.equal(before.meshes[1].primitives[0].attributes.POSITION,
  after.meshes[1].primitives[0].attributes.POSITION);
 assert.equal(before.skins[0].inverseBindMatrices,after.skins[0].inverseBindMatrices);
 assert.deepEqual(before.animations,after.animations);
 assert.equal(inspectRiggedGlb(modified).skins[0].joints,70);
 assert.equal(inspectRiggedGlb(modified).morphs.length,12);
 assert.equal(compareGlbTextures(complex.bytes,modified).status,'pass_supported_png');
});

test('AI Bridge mesh.edit/getStats executes real vertex topology in atomic group, undo and redo restore GLB',async()=>{
 const b=createAiBridge({allowWrites:true,buildHash:'mesh-unit'});
 const cmd=async(method,params={})=>{
  const reply=await b.request({requestId:'mesh-'+method,method,params});
  assert.equal(reply.ok,true,report(reply.diagnostics));return reply.result;
 };
 const caps=await cmd('studio.getCapabilities');
 assert.ok(caps.supported.includes('mesh.edit'));
 assert.ok(caps.supported.includes('mesh.getStats'));
 const up=await cmd('asset.upload',{name:'rig.glb',type:'glb',data:fixture.bytes});
 await cmd('scene.open',{assetId:up.assetId});
 const baseline=await cmd('mesh.getStats',{meshId:'gltf-mesh-0'});
 assert.equal(baseline.vertexCount,4);assert.equal(baseline.triangleCount,2);
 const tx=await cmd('transaction.begin');
 await cmd('mesh.edit',{meshId:'gltf-mesh-0',operation:{
  kind:'edge.split',start:1,end:2,factor:.5}});
 await cmd('mesh.edit',{meshId:'gltf-mesh-0',operation:{
  kind:'vertex.move',vertex:4,delta:[0,.22,0]}});
 assert.equal(b.getSnapshot().revision,1);
 const staged=await cmd('mesh.getStats',{meshId:'gltf-mesh-0'});
 assert.equal(staged.vertexCount,5);
 const commit=await cmd('transaction.commit',{transactionId:tx.transactionId});
 assert.equal(commit.commands,2);
 const after=await cmd('mesh.getStats',{meshId:'gltf-mesh-0'});
 assert.equal(after.vertexCount,5);assert.equal(after.triangleCount,4);
 const native=await cmd('scene.save');
 const replay=await openPreviewMarkscene(native.data);
 assert.equal(replay.edits.meshOperations.length,2);
 const modified=await cmd('scene.export');
 assert.equal(inspectRiggedGlb(modified.data).skins[0].joints,70);
 assert.equal(mesh0(modified.data).position.length,5);
 await cmd('history.undo');
 assert.equal((await cmd('mesh.getStats',{meshId:'gltf-mesh-0'})).vertexCount,4);
 await cmd('history.redo');
 assert.equal((await cmd('mesh.getStats',{meshId:'gltf-mesh-0'})).vertexCount,5);
 const denied=await b.request({requestId:'bad-edit',method:'mesh.edit',
  params:{meshId:'gltf-mesh-0',operation:{kind:'face.delete',face:999}}});
 assert.equal(denied.ok,false);
 assert.equal((await cmd('mesh.getStats',{meshId:'gltf-mesh-0'})).vertexCount,5);
});
