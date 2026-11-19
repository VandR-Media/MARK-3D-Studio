import test from 'node:test';
import assert from 'node:assert/strict';
import {primitiveGeometry} from '../src/pro-studio/primitive-geometry.js';
import {createEmptyGlb,createPrimitiveGlb} from '../src/pro-studio/primitive-factory.js';
import {parseGlb} from '../src/glb.js';
import {applyMeshOperations,getMeshEditStats} from '../src/pro-studio/mesh-edit-core.js';
import {createPreviewMarkscene,openPreviewMarkscene,
 exportEditedSourceGlb} from '../src/pro-studio/markscene-v3-preview.js';
import {createAiBridge} from '../src/pro-studio/ai-bridge-core.js';

const shapes=['plane','grid','box','uv-sphere','cylinder'];
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],
 a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const sub=(a,b)=>a.map((x,i)=>x-b[i]);
const dot=(a,b)=>a.reduce((s,x,i)=>s+x*b[i],0);
const req=(b,method,params={})=>b.request({
 requestId:'primitive-'+method,method,params
});
async function good(b,method,params={}){
 const r=await req(b,method,params);
 assert.equal(r.ok,true,JSON.stringify(r.diagnostics));return r.result;
}
test('five original primitive generators produce triangle meshes, UVs, normals, nonzero outward winding',()=>{
 for(const shape of shapes){
  const g=primitiveGeometry({shape,segments:12,size:2});
  assert.ok(g.position.length>=4,shape);
  assert.equal(g.index.length%3,0,shape);
  assert.equal(g.position.length,g.normal.length,shape);
  assert.equal(g.position.length,g.uv.length,shape);
  assert.ok(g.position.every(v=>v.length===3&&v.every(Number.isFinite)));
  assert.ok(g.index.every(i=>i>=0&&i<g.position.length));
  for(let i=0;i<g.index.length;i+=3){
   const [a,b,c]=g.index.slice(i,i+3).map(i=>g.position[i]);
   const n=cross(sub(b,a),sub(c,a));
   const expected=g.normal[g.index[i]];
   assert.ok(dot(n,expected)>-1e-6,
    shape+' triangle winding points opposite analytic normal at '+i/3);
  }
 }
});
test('standalone creation uses an ACTUAL originally empty glTF scene, not a hidden skinned quad',()=>{
 const empty=parseGlb(createEmptyGlb()).json;
 assert.equal(empty.nodes.length,0);
 assert.equal(empty.meshes.length,0);
 for(const shape of shapes){
  const created=createPrimitiveGlb({shape,segments:12,size:1.5});
  const doc=parseGlb(created.glb).json;
  assert.equal(doc.nodes.length,1,shape);
  assert.equal(doc.meshes.length,1,shape);
  assert.equal(doc.scenes[0].nodes.length,1,shape);
  assert.equal((doc.skins||[]).length,0,shape);
  assert.equal((doc.animations||[]).length,0,shape);
  const stats=getMeshEditStats(created.glb,0,0);
  assert.equal(stats.degenerateTriangles,0,shape);
  assert.equal(stats.vertexCount,created.stats.vertexCount);
  assert.equal(doc.materials[0].pbrMetallicRoughness.roughnessFactor,.6);
 }
});
test('glTF normal.recalculate and vertex.move work on a standalone box project',async()=>{
 const input=createPrimitiveGlb({shape:'box',size:2}).glb;
 const native=await createPreviewMarkscene(input,{
  projectId:'standalone-box-test',
  edits:{meshOperations:[
   {kind:'vertex.move',meshIndex:0,primitiveIndex:0,
    vertex:0,delta:[.15,.07,0]},
   {kind:'normal.recalculate',meshIndex:0,primitiveIndex:0}
  ]}
 });
 const read=await openPreviewMarkscene(native.archive);
 assert.deepEqual(read.sourceGLB,input);
 assert.equal(read.edits.meshOperations.length,2);
 const exported=await exportEditedSourceGlb(read);
 assert.equal(exported.geometryModified,true);
 assert.equal(getMeshEditStats(exported.glb).vertexCount,24);
 assert.equal(parseGlb(exported.glb).json.meshes[0].primitives[0].attributes.NORMAL!==
  parseGlb(input).json.meshes[0].primitives[0].attributes.NORMAL,true);
});
test('primitive.add from existing scene creates second mesh and stable glTF node without changing original source',async()=>{
 const first=createPrimitiveGlb({shape:'box'}).glb;
 const added=applyMeshOperations(first,[{
  kind:'primitive.add',meshIndex:0,primitiveIndex:0,
  shape:'uv-sphere',size:.4,segments:6,materialIndex:0
 }]);
 const doc=parseGlb(added).json;
 assert.equal(doc.meshes.length,2);
 assert.equal(doc.nodes.length,2);
 assert.equal(doc.scenes[0].nodes.length,2);
 assert.equal(doc.nodes[1].mesh,1);
 assert.ok(getMeshEditStats(added,1,0).triangleCount>40);
 const native=await createPreviewMarkscene(first,{
  projectId:'joined-primitive-test',
  edits:{meshOperations:[{
   kind:'primitive.add',meshIndex:0,primitiveIndex:0,
   shape:'uv-sphere',size:.4,segments:6,materialIndex:0
  }]}
 });
 const reopened=await openPreviewMarkscene(native.archive);
 assert.deepEqual(reopened.sourceGLB,first);
 const exported=await exportEditedSourceGlb(reopened);
 assert.equal(parseGlb(exported.glb).json.meshes.length,2);
 assert.deepEqual(exported.glb,added);
});
test('AI Bridge scene.new from empty and mesh.create operations save/reopen/undo/redo',async()=>{
 const bridge=createAiBridge({allowWrites:true,buildHash:'P8-test'});
 const caps=await good(bridge,'studio.getCapabilities');
 assert.ok(caps.supported.includes('scene.new'));
 assert.ok(caps.supported.includes('mesh.create'));
 const newScene=await good(bridge,'scene.new',{
  shape:'plane',size:1,segments:8,
  projectId:'new-native-empty-project',name:'Native MARK from zero'
 });
 assert.equal(newScene.stats.vertexCount,4);
 const start=await good(bridge,'scene.getHierarchy');
 assert.equal(start.nodes.length,1);
 assert.equal(start.nodes[0].meshId,'gltf-mesh-0');
 const tx=await good(bridge,'transaction.begin');
 const second=await good(bridge,'mesh.create',{
  shape:'cylinder',size:.8,segments:9
 });
 assert.equal(second.staged,true);
 assert.equal((await good(bridge,'scene.getHierarchy')).nodes.length,2);
 await good(bridge,'transaction.commit',{transactionId:tx.transactionId});
 const graph=await good(bridge,'scene.getHierarchy');
 assert.equal(graph.nodes.length,2);
 assert.equal(graph.nodes[1].meshId,'gltf-mesh-1');
 assert.ok((await good(bridge,'mesh.getStats',{meshId:'gltf-mesh-1'})).triangleCount>20);
 const saved=await good(bridge,'scene.save');
 const reopened=await openPreviewMarkscene(saved.data);
 assert.equal(reopened.manifest.sceneGraph.length,1);
 assert.equal(reopened.edits.meshOperations[0].kind,'primitive.add');
 const exportResult=await good(bridge,'scene.export');
 const fileDoc=parseGlb(exportResult.data).json;
 assert.equal(fileDoc.meshes.length,2);
 assert.equal(fileDoc.nodes.length,2);
 assert.equal((fileDoc.animations||[]).length,0);
 await good(bridge,'history.undo');
 assert.equal((await good(bridge,'scene.getHierarchy')).nodes.length,1);
 await good(bridge,'history.redo');
 assert.equal((await good(bridge,'scene.getHierarchy')).nodes.length,2);
});
test('unsupported procedural parameters are rejected without changing scene or undo history',async()=>{
 const bridge=createAiBridge({allowWrites:true});
 await good(bridge,'scene.new',{shape:'box'});
 const snap=bridge.getSnapshot();
 for(const bad of [
  {shape:'torus-knot'}, {shape:'box',segments:999},
  {shape:'uv-sphere',size:-5}, {shape:'plane',materialIndex:999},
  {shape:'plane',script:'eval()'}
 ]){
  const r=await req(bridge,'mesh.create',bad);
  assert.equal(r.ok,false,'Unsafe primitive was wrongly accepted '+JSON.stringify(bad));
  assert.equal(bridge.getSnapshot().revision,snap.revision);
  assert.equal(bridge.getSnapshot().undoDepth,0);
 }
 assert.equal((await good(bridge,'scene.getHierarchy')).nodes.length,1);
});
