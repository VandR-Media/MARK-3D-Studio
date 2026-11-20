import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {parseGlb} from '../src/glb.js';
import {applyMeshOperations,getMeshEditStats}
 from '../src/pro-studio/mesh-edit-core.js';
import {buildMeshDataSnapshot}
 from '../src/pro-studio/meshdata-halfedge-preview.js';
import {createPreviewMarkscene,openPreviewMarkscene,exportEditedSourceGlb}
 from '../src/pro-studio/markscene-v3-preview.js';
import {createAiBridge} from '../src/pro-studio/ai-bridge-core.js';
import {buildSkinnedSeamFixture}
 from '../scripts/pro-studio-pass17-skinned-seam-fixture.mjs';
import {inspectRiggedGlb} from '../src/pro-studio/rigged-glb-audit.js';
import {compareGlbTextures} from '../src/pro-studio/glb-texture-qa.js';

const source=buildSkinnedSeamFixture();
const sha=b=>createHash('sha256').update(Buffer.from(b)).digest('hex');
const sourceSha=sha(source);
const extrusion={kind:'face.regionExtrudeLinked',meshIndex:0,primitiveIndex:0,
 faces:[0,1],distance:.55,links:[
 {meshIndex:0,primitiveIndex:0,vertexA:1,vertexB:4},
 {meshIndex:0,primitiveIndex:0,vertexA:2,vertexB:5}]};
const move={kind:'vertex.moveLinkedCap',meshIndex:0,primitiveIndex:0,
 sourceVertex:1,delta:[.12,.015,.02]};
const poke=sourceFace=>({kind:'face.pokeLinkedCap',meshIndex:0,
 primitiveIndex:0,sourceFace});
const split=(sourceFace,sourceVertex)=>({kind:'edge.splitPokedCap',
 meshIndex:0,primitiveIndex:0,sourceFace,sourceVertex});
const originalOps=[extrusion,move,poke(0),poke(1)];
const withSplit=[...originalOps,split(0,1)];
function rows(glb,accessor){
 const parsed=parseGlb(glb),doc=parsed.json,a=doc.accessors[accessor],
  v=doc.bufferViews[a.bufferView],bin=parsed.chunks.find(c=>
   c.type===0x004e4942).data,
  n={SCALAR:1,VEC2:2,VEC3:3,VEC4:4}[a.type],
  width={5121:1,5123:2,5125:4,5126:4}[a.componentType],
  getter={5121:'getUint8',5123:'getUint16',5125:'getUint32',
   5126:'getFloat32'}[a.componentType],
  view=new DataView(bin.buffer,bin.byteOffset,bin.byteLength),
  start=(v.byteOffset||0)+(a.byteOffset||0),stride=v.byteStride??width*n;
 return Array.from({length:a.count},(_,i)=>Array.from({length:n},(_,k)=>
  view[getter](start+i*stride+k*width,true)));
}
const attr=(glb,name)=>{
 const prim=parseGlb(glb).json.meshes[0].primitives[0];
 return rows(glb,prim.attributes[name]);
};
const indices=glb=>{
 const prim=parseGlb(glb).json.meshes[0].primitives[0];
 return rows(glb,prim.indices).map(r=>r[0]);
};
function data(glb,ops){
 return buildMeshDataSnapshot({sourceGLB:source,editedGLB:glb,
  sourceSha256:sourceSha,operations:ops});
}

const withTwo=[...withSplit,split(1,3)];
const reverse=[...originalOps,split(1,3),split(0,1)];

const daughter=sourceFace=>({kind:'edge.splitPokedCapChild',
 meshIndex:0,primitiveIndex:0,sourceFace,sourceVertex:1});
const withChild=[...withTwo,daughter(0)];

test('physical daughter split changes BOTH actual incident triangles, never old GLB rows',()=>{
 const parent=applyMeshOperations(source,withTwo),
  out=applyMeshOperations(source,withChild);
 const stats=getMeshEditStats(out),before=getMeshEditStats(parent);
 assert.equal(before.vertexCount,32);
 assert.equal(before.triangleCount,18);
 assert.equal(stats.vertexCount,33);
 assert.equal(stats.triangleCount,20);
 assert.equal(stats.nonManifoldEdges,0);
 assert.equal(stats.degenerateTriangles,0);
 assert.equal(stats.conflictingWindingEdges,0);
 const oldPosition=attr(parent,'POSITION'),p=attr(out,'POSITION');
 assert.deepEqual(p.slice(0,32),oldPosition);
 for(let k=0;k<3;k++)assert.ok(Math.abs(p[32][k]-
  (p[7][k]+p[30][k])/2)<1e-6);
 const first=indices(parent),after=indices(out),changed=[];
 for(let i=0;i<18;i++){
  const prev=first.slice(i*3,i*3+3).join(','),
   next=after.slice(i*3,i*3+3).join(',');
  if(prev!==next){
   changed.push(i);
   assert.ok(first.slice(i*3,i*3+3).includes(7));
   assert.ok(first.slice(i*3,i*3+3).includes(30));
   assert.ok(after.slice(i*3,i*3+3).includes(32));
  }
 }
 assert.equal(changed.length,2);
 const incidence=new Map();
 for(let i=0;i<after.length;i+=3)
  for(let k=0;k<3;k++){
   const a=after[i+k],b=after[i+(k+1)%3],
    key=[a,b].sort((x,y)=>x-y).join(':');
   incidence.set(key,(incidence.get(key)||0)+1);
  }
 assert.ok(!incidence.has('7:30'));
 assert.equal(incidence.get('7:32'),2);
 assert.equal(incidence.get('30:32'),2);
 assert.equal(sha(source),sourceSha);
});

test('new daughter vertex interpolates UV0/UV1 and morphs, conserves 70 bone rig, PBR textures',()=>{
 const parent=applyMeshOperations(source,withTwo),
  current=applyMeshOperations(source,withChild);
 for(const semantic of ['POSITION','NORMAL','TEXCOORD_0','TEXCOORD_1',
  'JOINTS_0','WEIGHTS_0'])
  assert.deepEqual(attr(current,semantic).slice(0,32),attr(parent,semantic),
   'Daughter must never alter previous '+semantic+' attribute rows');
 for(const semantic of ['TEXCOORD_0','TEXCOORD_1']){
  const uv=attr(current,semantic);
  for(let k=0;k<2;k++)assert.ok(Math.abs(
   uv[32][k]-(uv[7][k]+uv[30][k])/2)<1e-6);
 }
 const joint=attr(current,'JOINTS_0')[32],
  weight=attr(current,'WEIGHTS_0')[32];
 assert.equal(joint.length,4);
 assert.ok(joint.every(Number.isSafeInteger));
 assert.ok(weight.every(x=>x>=0&&Number.isFinite(x)));
 assert.ok(Math.abs(weight.reduce((x,y)=>x+y,0)-1)<1e-6);
 const a=parseGlb(parent).json.meshes[0].primitives[0],
  b=parseGlb(current).json.meshes[0].primitives[0];
 for(let i=0;i<2;i++){
  const old=rows(parent,a.targets[i].POSITION),
   next=rows(current,b.targets[i].POSITION);
  assert.deepEqual(next.slice(0,32),old);
  for(let k=0;k<3;k++)assert.ok(Math.abs(
   next[32][k]-(old[7][k]+old[30][k])/2)<1e-6);
 }
 const rig=inspectRiggedGlb(current),doc=parseGlb(current).json,
  initial=parseGlb(source).json;
 assert.equal(rig.skins[0].joints,70);
 assert.equal(rig.morphs[0].targets,2);
 assert.equal(rig.animations.length,3);
 assert.deepEqual(doc.materials,initial.materials);
 assert.deepEqual(doc.skins,initial.skins);
 assert.deepEqual(doc.animations,initial.animations);
 assert.equal(compareGlbTextures(source,current).status,'pass_supported_png');
});

test('one source-scoped parent-edge lineage, previous remaps and stable face/corner IDs',()=>{
 const before=data(applyMeshOperations(source,withTwo),withTwo),
  after=data(applyMeshOperations(source,withChild),withChild);
 assert.equal(after.diagnostics.triangleCount,20);
 assert.equal(after.diagnostics.cornerCount,60);
 assert.equal(after.diagnostics.halfedgeCount,60);
 assert.equal(after.diagnostics.boundaryEdges,4);
 assert.equal(after.diagnostics.nonManifoldEdges,0);
 assert.equal(after.diagnostics.windingConflicts,0);
 assert.equal(after.diagnostics.daughterSplitCount,1);
 assert.equal(after.diagnostics.radialSplitCount,2);
 assert.deepEqual(after.topologyRemaps,before.topologyRemaps);
 assert.deepEqual(after.edgeSplitRemaps,before.edgeSplitRemaps,
  'Existing primary radial edge creation history must be immutable');
 const r=after.daughterRemap;
 assert.equal(r.schema,'mark.radial-daughter-split-remap/1');
 assert.equal(r.sourceFace,0);
 assert.equal(r.sourceVertex,1);
 assert.equal(r.generation,1);
 assert.equal(r.newAttributeVertex,32);
 assert.equal(r.parentSplitNewLogicalVertexId,before.edgeSplitRemaps[0].newLogicalVertexId);
 assert.ok(before.edges.some(e=>e.id===r.parentEdgeId));
 assert.ok(!after.edges.some(e=>e.id===r.parentEdgeId));
 assert.equal(r.newFaceIds.length,2);
 assert.ok(r.newFaceIds.every(id=>after.faces.some(f=>f.id===id)));
 assert.equal(r.invalidatedCornerIds.length,2);
 assert.equal(r.invalidatedHalfedgeIds.length,4);
 assert.ok(r.invalidatedCornerIds.every(id=>
  before.corners.some(c=>c.id===id)&&
  !after.corners.some(c=>c.id===id)));
 assert.ok(r.invalidatedHalfedgeIds.every(id=>
  before.halfedges.some(h=>h.id===id)&&
  !after.halfedges.some(h=>h.id===id)));
 assert.ok(r.createdEdgeIds.length>=3);
 const halfedges=new Map(after.halfedges.map(h=>[h.id,h]));
 assert.equal(halfedges.size,after.halfedges.length);
 for(const e of halfedges.values()){
  assert.ok(halfedges.has(e.next)&&halfedges.has(e.prev));
  if(e.twin)assert.equal(halfedges.get(e.twin)?.twin,e.id);
 }
});

test('reverse order of independent primary splits preserves source-scoped daughter lineage',()=>{
 const reverse=[...originalOps,split(1,3),split(0,1),daughter(0)];
 const a=data(applyMeshOperations(source,withChild),withChild),
  b=data(applyMeshOperations(source,reverse),reverse);
 assert.equal(a.daughterRemap.newLogicalVertexId,
  b.daughterRemap.newLogicalVertexId);
 assert.equal(a.daughterRemap.parentEdgeId,b.daughterRemap.parentEdgeId);
 assert.deepEqual(a.daughterRemap.newFaceIds,b.daughterRemap.newFaceIds);
 assert.deepEqual(a.daughterRemap.createdEdgeIds,b.daughterRemap.createdEdgeIds);
 assert.deepEqual(a.faces.map(x=>x.id).sort(),b.faces.map(x=>x.id).sort());
});

test('native .markscene round-trip preserves daughter operation and real GLB bytewise',async()=>{
 const native=await createPreviewMarkscene(source,{
  projectId:'pass23-daughter-lineage',
  edits:{meshOperations:withChild,meshSeamLinks:[]}
 });
 const reopened=await openPreviewMarkscene(native.archive);
 assert.deepEqual(reopened.sourceGLB,source);
 assert.deepEqual(reopened.edits.meshOperations,withChild);
 const exported=await exportEditedSourceGlb(reopened);
 assert.deepEqual(exported.glb,applyMeshOperations(source,withChild));
 assert.deepEqual((await exportEditedSourceGlb(
  await openPreviewMarkscene(native.archive))).glb,exported.glb);
 assert.deepEqual(data(exported.glb,withChild).daughterRemap,
  data(applyMeshOperations(source,withChild),withChild).daughterRemap);
});

test('reject daughter without primary, wrong lineage, repeated daughter, unknown payload and followup',async()=>{
 const invalid=[
  [...originalOps,daughter(0)],
  [...withTwo,{...daughter(0),sourceVertex:2}],
  [...withTwo,{...daughter(0),sourceFace:4}],
  [...withChild,daughter(0)],
  [...withChild,split(0,2)],
  [...withChild,poke(1)],
  [...withChild,move],
  [...withTwo,{...daughter(0),arbitrary:'bad'}]
 ];
 for(const ops of invalid)assert.throws(()=>
  applyMeshOperations(source,ops),/MARK_MESH_/);
 await assert.rejects(()=>createPreviewMarkscene(source,{
  edits:{meshOperations:[...withChild,daughter(0)]}
 }),/MARK_SCENE3_MESH_LINKED_SEQUENCE/);
 await assert.rejects(()=>createPreviewMarkscene(source,{
  edits:{meshOperations:[...withTwo,{...daughter(0),evil:true}]}
 }),/MARK_SCENE3_MESH_EDIT_FIELDS/);
});

test('Bridge verifies current parent edge, rejects forged IDs, Undo/Redo and project reopen',async()=>{
 const bridge=createAiBridge({allowWrites:true,buildHash:'p23-lineage'});
 let n=0;const call=async(method,params={})=>{
  const r=await bridge.request({
   requestId:'p23.'+(++n),method,params});
  assert.equal(r.ok,true,JSON.stringify(r.diagnostics));return r.result;
 };
 const caps=await call('studio.getCapabilities');
 assert.ok(caps.supported.includes('mesh.splitPokedCapChildEdge'));
 const up=await call('asset.upload',{
  type:'glb',name:'seam-skin.glb',data:source});
 await call('scene.open',{assetId:up.assetId});
 for(const link of extrusion.links)await call('mesh.linkSeam',{
  meshId:'gltf-mesh-0',vertexA:link.vertexA,vertexB:link.vertexB});
 await call('mesh.extrudeLinkedRegion',{meshId:'gltf-mesh-0',
  faces:[0,1],distance:.55});
 for(const face of [0,1]){
  const graph=await call('mesh.getMeshData',{meshId:'gltf-mesh-0',full:true});
  await call('mesh.pokeLinkedCap',{meshId:'gltf-mesh-0',
   capFaceId:graph.faces.find(f=>f.id.endsWith('cap-face-'+face)).id});
 }
 for(const [sourceFace,sourceVertex] of [[0,1],[1,3]]){
  const graph=await call('mesh.getMeshData',{meshId:'gltf-mesh-0',full:true}),
   center=graph.topologyRemaps.find(p=>p.sourceFace===sourceFace)
    .centerLogicalVertexId,
   cap=graph.capMap.find(p=>p.sourceVertex===sourceVertex).logicalVertexId,
   edge=graph.edges.find(e=>e.halfedgeIds.length===2&&
    graph.halfedges.some(h=>e.halfedgeIds.includes(h.id)&&
     (h.origin===center&&h.destination===cap||
      h.destination===center&&h.origin===cap)));
  assert.ok(edge?.id);
  await call('mesh.splitPokedCapEdge',{meshId:'gltf-mesh-0',
   sourceFace,sourceVertex,edgeId:edge.id});
 }
 const graph=await call('mesh.getMeshData',{meshId:'gltf-mesh-0',full:true}),
  parent=graph.edgeSplitRemaps.find(x=>x.sourceFace===0),
  cap=graph.capMap.find(c=>c.sourceVertex===1);
 const edge=graph.edges.find(e=>e.halfedgeIds.length===2&&
  parent.createdEdgeIds.includes(e.id)&&graph.halfedges.some(h=>
   e.halfedgeIds.includes(h.id)&&
   (h.origin===cap.logicalVertexId&&
    h.destination===parent.newLogicalVertexId||
    h.destination===cap.logicalVertexId&&
    h.origin===parent.newLogicalVertexId)));
 assert.ok(edge?.id);
 const forged=await bridge.request({requestId:'p23.forged',
  method:'mesh.splitPokedCapChildEdge',params:{
   meshId:'gltf-mesh-0',sourceFace:0,sourceVertex:1,
   parentEdgeId:edge.id+'-fake'}});
 assert.equal(forged.ok,false);
 assert.ok(JSON.stringify(forged.diagnostics).includes('DAUGHTER_PARENT'));
 await call('mesh.splitPokedCapChildEdge',{meshId:'gltf-mesh-0',
  sourceFace:0,sourceVertex:1,parentEdgeId:edge.id});
 const info=await call('mesh.getMeshData',{meshId:'gltf-mesh-0'});
 assert.equal(info.diagnostics.daughterSplitCount,1);
 assert.equal(info.daughterRemap.parentEdgeId,edge.id);
 const native=await call('scene.save'),out=await call('scene.export');
 const reopened=await openPreviewMarkscene(native.data);
 assert.equal(reopened.edits.meshOperations.at(-1).kind,
  'edge.splitPokedCapChild');
 assert.deepEqual((await exportEditedSourceGlb(reopened)).glb,out.data);
 const second=await bridge.request({requestId:'p23.duplicate',
  method:'mesh.splitPokedCapChildEdge',params:{
   meshId:'gltf-mesh-0',sourceFace:0,sourceVertex:1,
   parentEdgeId:edge.id}});
 assert.equal(second.ok,false);
 await call('history.undo');
 assert.equal((await call('mesh.getStats',{meshId:'gltf-mesh-0'}))
  .triangleCount,18);
 await call('history.redo');
 assert.deepEqual((await call('scene.export')).data,out.data);
 const other=createAiBridge({allowWrites:true});
 let i=0;const again=async(method,params={})=>{
  const r=await other.request({
   requestId:'again.'+(++i),method,params});
  assert.equal(r.ok,true,JSON.stringify(r.diagnostics));return r.result;
 };
 const asset=await again('asset.upload',{
  name:'daughter.markscene',type:'markscene',data:native.data});
 await again('scene.open',{assetId:asset.assetId});
 assert.deepEqual((await again('scene.export')).data,out.data);
 assert.deepEqual((await again('mesh.getMeshData',{meshId:'gltf-mesh-0'}))
  .daughterRemap,info.daughterRemap);
});
