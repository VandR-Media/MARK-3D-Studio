import test from 'node:test';
import assert from 'node:assert/strict';
import {buildRiggedFixture} from '../scripts/pro-studio-glb-fixtures.mjs';
import {parseGlb,writeGlb} from '../src/glb.js';
import {applyMeshOperations,getMeshEditStats} from '../src/pro-studio/mesh-edit-core.js';
import {createPreviewMarkscene,openPreviewMarkscene,exportEditedSourceGlb}
 from '../src/pro-studio/markscene-v3-preview.js';
import {createPrimitiveGlb} from '../src/pro-studio/primitive-factory.js';
import {inspectRiggedGlb} from '../src/pro-studio/rigged-glb-audit.js';
import {compareGlbTextures} from '../src/pro-studio/glb-texture-qa.js';
import {createAiBridge} from '../src/pro-studio/ai-bridge-core.js';

const fixture=buildRiggedFixture();
const operation=(faces=[0,1],distance=.4)=>({
 kind:'face.regionExtrude',meshIndex:0,primitiveIndex:0,faces,distance
});
function read(bytes,index){
 const p=parseGlb(bytes),a=p.json.accessors[index],view=p.json.bufferViews[a.bufferView];
 const bin=p.chunks.find(c=>c.type===0x004e4942).data,dv=
  new DataView(bin.buffer,bin.byteOffset,bin.byteLength);
 const arity={SCALAR:1,VEC2:2,VEC3:3,VEC4:4}[a.type], 
  [width,get]={5121:[1,'getUint8'],5123:[2,'getUint16'],
   5125:[4,'getUint32'],5126:[4,'getFloat32']}[a.componentType];
 const base=(view.byteOffset??0)+(a.byteOffset??0),step=view.byteStride??arity*width;
 return Array.from({length:a.count},(_,i)=>Array.from({length:arity},
  (_,k)=>dv[get](base+i*step+k*width,true)));
}
function geometry(bytes){
 const doc=parseGlb(bytes).json,prim=doc.meshes[0].primitives[0];
 return{doc,prim,positions:read(bytes,prim.attributes.POSITION),
  normals:read(bytes,prim.attributes.NORMAL),
  uv:read(bytes,prim.attributes.TEXCOORD_0),
  joints:prim.attributes.JOINTS_0===undefined?null:read(bytes,prim.attributes.JOINTS_0),
  weights:prim.attributes.WEIGHTS_0===undefined?null:read(bytes,prim.attributes.WEIGHTS_0),
  morphs:(prim.targets||[]).map(t=>read(bytes,t.POSITION)),
  triangles:read(bytes,prim.indices).map(v=>v[0])};
}
function rewriteTriangle(bytes,face,triangle){
 const parsed=parseGlb(bytes),doc=parsed.json,prim=doc.meshes[0].primitives[0];
 const a=doc.accessors[prim.indices],v=doc.bufferViews[a.bufferView];
 const bin=parsed.chunks.find(c=>c.type===0x004e4942).data.slice(),
  data=new DataView(bin.buffer,bin.byteOffset,bin.byteLength);
 const width=a.componentType===5123?2:4;
 const setter=a.componentType===5123?'setUint16':'setUint32';
 for(let i=0;i<3;i++)data[setter]((v.byteOffset??0)+(a.byteOffset??0)+
  (face*3+i)*width,triangle[i],true);
 return writeGlb({...parsed,chunks:parsed.chunks.map(c=>
  c.type===0x004e4942?{type:c.type,data:bin}:c)},doc);
}

test('two connected triangles extrude as ONE cap with FOUR perimeter walls',()=>{
 const before=fixture.bytes.slice(),original=geometry(before);
 const edited=applyMeshOperations(before,[operation()]),result=geometry(edited);
 assert.deepEqual(before,fixture.bytes,'no mutation of imported source');
 assert.equal(result.positions.length,24,'4 unique cap + 16 split wall vertices');
 assert.equal(result.triangles.length,30,'2 cap + 8 wall triangles');
 assert.equal(getMeshEditStats(edited).triangleCount,10);
 assert.deepEqual(result.triangles.slice(0,6),[4,5,6,5,7,6]);
 for(let i=0;i<4;i++){
  const p=result.positions[4+i],start=original.positions[i];
  for(let axis=0;axis<2;axis++)
   assert.ok(Math.abs(p[axis]-start[axis])<1e-6);
  assert.ok(Math.abs(p[2]-start[2]-.4)<1e-6);
  assert.deepEqual(result.uv[4+i],original.uv[i]);
  assert.deepEqual(result.joints[4+i],original.joints[i]);
  assert.deepEqual(result.weights[4+i],original.weights[i]);
 }
 const wallTriangles=result.triangles.slice(6);
 assert.equal(wallTriangles.length,24);
 assert.deepEqual(result.uv.slice(8,12),[[0,0],[1,0],[1,1],[0,1]]);
 assert.ok(result.normals.slice(8).every(n=>
  Math.abs(Math.hypot(...n)-1)<1e-5));
 assert.equal(result.positions.length-4,20);
});

test('rig/UV/morph bytes logically round-trip, including BOTH joint and weight streams',()=>{
 const original=geometry(fixture.bytes);
 const updated=applyMeshOperations(fixture.bytes,[operation([1,0],.25)]);
 const edited=geometry(updated);
 const capSources=[0,1,2,3];
 for(let i=0;i<capSources.length;i++){
  assert.deepEqual(edited.joints[4+i],original.joints[capSources[i]]);
  assert.deepEqual(edited.weights[4+i],original.weights[capSources[i]]);
  for(let t=0;t<edited.morphs.length;t++)
   assert.deepEqual(edited.morphs[t][4+i],original.morphs[t][capSources[i]]);
 }
 const audit=inspectRiggedGlb(updated);
 assert.equal(audit.skins[0].joints,70);
 assert.equal(audit.animations.length,3);
 assert.equal(audit.morphs[0].targets,2);
 assert.deepEqual(edited.doc.skins,original.doc.skins);
 assert.deepEqual(edited.doc.animations,original.doc.animations);
 assert.equal(compareGlbTextures(fixture.bytes,updated).status,'pass_supported_png');
});

test('native manifest canonically sorts region list and source + replay remain deterministic',async()=>{
 const saved=await createPreviewMarkscene(fixture.bytes,{
  projectId:'pass13-region',edits:{meshOperations:[operation([1,0],.25)]}
 });
 const reopened=await openPreviewMarkscene(saved.archive);
 assert.deepEqual(reopened.sourceGLB,fixture.bytes);
 assert.deepEqual(reopened.edits.meshOperations,[operation([0,1],.25)]);
 const reexport=await exportEditedSourceGlb(reopened);
 assert.deepEqual(reexport.glb,applyMeshOperations(fixture.bytes,[operation([0,1],.25)]));
 const again=await exportEditedSourceGlb(await openPreviewMarkscene(saved.archive));
 assert.deepEqual(again.glb,reexport.glb);
});

test('disconnected, holed, duplicate, winding-conflict and non-manifold regions fail safely',async()=>{
 const box=createPrimitiveGlb({shape:'box'}).glb;
 const grid=createPrimitiveGlb({shape:'grid',size:1,segments:3}).glb;
 const badCases=[
  [box,operation([0,2]) ,/MARK_MESH_REGION_DISCONNECTED/],
  [grid,operation([0,1,2,3,4,5,6,7,10,11,12,13,14,15,16,17]),
   /MARK_MESH_REGION_BOUNDARY/],
  [fixture.bytes,operation([0,0]),/MARK_MESH_REGION_FACES/],
  [fixture.bytes,operation([0,999]),/MARK_MESH_REGION_FACES/],
  [fixture.bytes,operation([0,1],0),/MARK_MESH_EXTRUDE_DISTANCE/],
  [fixture.bytes,operation([0,1],51),/MARK_MESH_EXTRUDE_DISTANCE/],
  [rewriteTriangle(grid,1,[1,4,5]),operation([0,1]),/MARK_MESH_REGION_WINDING/],
  [rewriteTriangle(grid,2,[1,4,5]),operation([0,1]),
   /MARK_MESH_REGION_NONMANIFOLD/]
 ];
 for(const [bytes,op,code] of badCases){
  const unchanged=bytes.slice();
  assert.throws(()=>applyMeshOperations(bytes,[op]),code,
   'operation must fail with the expected structured reason');
  assert.deepEqual(bytes,unchanged,'failed edit cannot mutate source');
 }
 await assert.rejects(()=>createPreviewMarkscene(fixture.bytes,{
  edits:{meshOperations:[{...operation(),eval:'bad'}]}}),/MARK_SCENE3_/);
});

test('AI Bridge region edit save/undo/redo reconstructs actual mesh geometry',async()=>{
 const bridge=createAiBridge({allowWrites:true,buildHash:'pass13-tests'});
 let request=0;
 const call=async(method,params={})=>{
  const reply=await bridge.request({requestId:'pass13.'+(++request),method,params});
  assert.equal(reply.ok,true,JSON.stringify(reply.diagnostics));return reply.result;
 };
 const uploaded=await call('asset.upload',{name:'rig.glb',type:'glb',data:fixture.bytes});
 await call('scene.open',{assetId:uploaded.assetId});
 const original=await call('mesh.getStats',{meshId:'gltf-mesh-0'});
 assert.equal(original.vertexCount,4);
 await call('mesh.edit',{meshId:'gltf-mesh-0',operation:{
  kind:'face.regionExtrude',faces:[0,1],distance:.3}});
 const edited=await call('mesh.getStats',{meshId:'gltf-mesh-0'});
 assert.equal(edited.vertexCount,24);assert.equal(edited.triangleCount,10);
 const native=await call('scene.save'),reopened=await openPreviewMarkscene(native.data);
 assert.deepEqual(reopened.edits.meshOperations,[operation([0,1],.3)]);
 await call('history.undo');
 assert.equal((await call('mesh.getStats',{meshId:'gltf-mesh-0'})).vertexCount,4);
 await call('history.redo');
 assert.equal((await call('mesh.getStats',{meshId:'gltf-mesh-0'})).vertexCount,24);
 const exported=await call('scene.export');
 assert.equal(geometry(exported.data).triangles.length,30);
});
