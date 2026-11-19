import test from 'node:test';
import assert from 'node:assert/strict';
import {buildRiggedFixture} from '../scripts/pro-studio-glb-fixtures.mjs';
import {parseGlb} from '../src/glb.js';
import {applyMeshOperations,getMeshEditStats} from '../src/pro-studio/mesh-edit-core.js';
import {createPreviewMarkscene,openPreviewMarkscene,exportEditedSourceGlb}
 from '../src/pro-studio/markscene-v3-preview.js';
import {inspectRiggedGlb} from '../src/pro-studio/rigged-glb-audit.js';
import {compareGlbTextures} from '../src/pro-studio/glb-texture-qa.js';
import {createAiBridge} from '../src/pro-studio/ai-bridge-core.js';

const fixture=buildRiggedFixture();
const op=(kind,args={})=>({kind,meshIndex:0,primitiveIndex:0,...args});
const extrude=op('face.extrude',{face:0,distance:.35});
function accessor(bytes,index){
 const p=parseGlb(bytes),a=p.json.accessors[index],v=p.json.bufferViews[a.bufferView];
 const bin=p.chunks.find(c=>c.type===0x004e4942).data;
 const view=new DataView(bin.buffer,bin.byteOffset,bin.byteLength);
 const dimensions={SCALAR:1,VEC2:2,VEC3:3,VEC4:4,MAT4:16}[a.type];
 const [width,get]={5121:[1,'getUint8'],5123:[2,'getUint16'],
  5125:[4,'getUint32'],5126:[4,'getFloat32']}[a.componentType];
 const offset=(v.byteOffset??0)+(a.byteOffset??0),stride=v.byteStride??dimensions*width;
 return Array.from({length:a.count},(_,i)=>Array.from({length:dimensions},
  (_,k)=>view[get](offset+i*stride+k*width,true)));
}
function geometry(bytes){
 const doc=parseGlb(bytes).json,prim=doc.meshes[0].primitives[0];
 return {doc,prim,position:accessor(bytes,prim.attributes.POSITION),
  normal:accessor(bytes,prim.attributes.NORMAL),
  uv:accessor(bytes,prim.attributes.TEXCOORD_0),
  joints:accessor(bytes,prim.attributes.JOINTS_0),
  weights:accessor(bytes,prim.attributes.WEIGHTS_0),
  morphs:prim.targets.map(t=>accessor(bytes,t.POSITION)),
  triangles:accessor(bytes,prim.indices).map(x=>x[0])};
}
test('face.extrude changes real BIN topology, cap coordinates, wall UV and side normals',()=>{
 const original=fixture.bytes.slice(),before=geometry(original);
 const output=applyMeshOperations(original,[extrude]),after=geometry(output);
 assert.deepEqual(original,fixture.bytes);
 assert.equal(after.position.length,19);
 assert.equal(after.triangles.length,24);
 assert.equal(getMeshEditStats(output).triangleCount,8);
 assert.deepEqual(after.triangles.slice(0,3),before.triangles.slice(3));
 assert.deepEqual(after.triangles.slice(3,6),[4,5,6]);
 for(let i=0;i<3;i++){
  const source=before.triangles[i];
  for(let axis=0;axis<2;axis++)
   assert.ok(Math.abs(after.position[4+i][axis]-before.position[source][axis])<1e-6);
  assert.ok(Math.abs(after.position[4+i][2]-before.position[source][2]-.35)<1e-6);
  assert.deepEqual(after.uv[4+i],before.uv[source]);
 }
 assert.deepEqual(after.uv.slice(7,11),[[0,0],[1,0],[1,1],[0,1]]);
 assert.deepEqual(after.triangles.slice(6,12),[7,8,9,7,9,10]);
 assert.ok(after.normal.slice(7).every(v=>Math.abs(Math.hypot(...v)-1)<1e-5));
});

test('face.extrude preserves real skin joint/weight data, morphs, clips and textures',()=>{
 const before=geometry(fixture.bytes),modified=applyMeshOperations(fixture.bytes,[extrude]);
 const after=geometry(modified);
 const sourceForNew=[0,1,2,0,1,1,0,1,2,2,1,2,0,0,2];
 for(let i=0;i<15;i++){
  const source=sourceForNew[i];
  assert.deepEqual(after.joints[4+i],before.joints[source]);
  assert.deepEqual(after.weights[4+i],before.weights[source]);
  for(let k=0;k<after.morphs.length;k++)
   assert.deepEqual(after.morphs[k][4+i],before.morphs[k][source]);
 }
 const audit=inspectRiggedGlb(modified);
 assert.equal(audit.skins[0].joints,70);
 assert.equal(audit.animations.length,3);
 assert.equal(audit.morphs[0].targets,2);
 assert.deepEqual(after.doc.animations,before.doc.animations);
 assert.deepEqual(after.doc.skins,before.doc.skins);
 assert.equal(compareGlbTextures(fixture.bytes,modified).status,'pass_supported_png');
});

test('native .markscene save/open/export replays extrude and vertex.snap without source loss',async()=>{
 for(const operations of [[extrude],[op('vertex.snap',{vertex:0,targetVertex:1})]]){
  const native=await createPreviewMarkscene(fixture.bytes,{
   projectId:'pass11-native',edits:{meshOperations:operations}
  });
  const reopened=await openPreviewMarkscene(native.archive);
  assert.deepEqual(reopened.sourceGLB,fixture.bytes);
  assert.deepEqual(reopened.edits.meshOperations,operations);
  const output=await exportEditedSourceGlb(reopened);
  assert.deepEqual(output.glb,applyMeshOperations(fixture.bytes,operations));
 }
});

test('invalid face, distance and unexpected native keys fail without mutating source',async()=>{
 const before=fixture.bytes.slice();
 for(const args of [
  {face:9,distance:.2},{face:0,distance:0},{face:0,distance:-1},
  {face:0,distance:51},{face:0,distance:NaN},{face:.5,distance:.2}
 ]){
  assert.throws(()=>applyMeshOperations(fixture.bytes,[op('face.extrude',args)]),
   /MARK_MESH_(FACE|EXTRUDE_DISTANCE)/);
 }
 await assert.rejects(()=>createPreviewMarkscene(fixture.bytes,{
  edits:{meshOperations:[{...extrude,script:'alert(1)'}]}}),/MARK_SCENE3_/);
 assert.deepEqual(before,fixture.bytes);
});

test('AI Bridge extrusion survives save and undo/redo of the topology',async()=>{
 const bridge=createAiBridge({allowWrites:true,buildHash:'pass11-test'});
 const call=async(method,params={})=>{
  const reply=await bridge.request({requestId:'pass11-'+method,method,params});
  assert.equal(reply.ok,true,JSON.stringify(reply.diagnostics));return reply.result;
 };
 const upload=await call('asset.upload',{name:'rig.glb',type:'glb',data:fixture.bytes});
 await call('scene.open',{assetId:upload.assetId});
 await call('mesh.edit',{meshId:'gltf-mesh-0',operation:{
  kind:'face.extrude',face:0,distance:.25
 }});
 const stats=await call('mesh.getStats',{meshId:'gltf-mesh-0'});
 assert.equal(stats.vertexCount,19);assert.equal(stats.triangleCount,8);
 const saved=await call('scene.save');
 assert.equal((await openPreviewMarkscene(saved.data)).edits.meshOperations[0].kind,
  'face.extrude');
 await call('history.undo');
 assert.equal((await call('mesh.getStats',{meshId:'gltf-mesh-0'})).vertexCount,4);
 await call('history.redo');
 assert.equal((await call('mesh.getStats',{meshId:'gltf-mesh-0'})).vertexCount,19);
});
