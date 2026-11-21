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

const grandchild={kind:'edge.splitPokedCapGrandchild',
 meshIndex:0,primitiveIndex:0,sourceFace:0,sourceVertex:1};
const deepOps=[...withChild,grandchild];

test('real depth-two edge split repairs both incident triangles and appends one vertex',()=>{
 const before=applyMeshOperations(source,withChild),
  after=applyMeshOperations(source,deepOps),
  oldStats=getMeshEditStats(before),newStats=getMeshEditStats(after);
 assert.equal(oldStats.vertexCount,33);assert.equal(oldStats.triangleCount,20);
 assert.equal(newStats.vertexCount,34);assert.equal(newStats.triangleCount,22);
 assert.equal(newStats.degenerateTriangles,0);
 assert.equal(newStats.nonManifoldEdges,0);
 assert.equal(newStats.conflictingWindingEdges,0);
 const beforePos=attr(before,'POSITION'),pos=attr(after,'POSITION');
 assert.deepEqual(pos.slice(0,33),beforePos);
 for(let k=0;k<3;k++)assert.ok(
  Math.abs(pos[33][k]-(pos[7][k]+pos[32][k])/2)<1e-6);
 const first=indices(before),current=indices(after),modified=[];
 for(let i=0;i<20;i++){
  const a=first.slice(i*3,i*3+3),b=current.slice(i*3,i*3+3);
  if(a.join()!==b.join()){
   assert.ok(a.includes(7)&&a.includes(32));
   assert.ok(b.includes(33));modified.push(i);
  }
 }
 assert.equal(modified.length,2);
 const inc=new Map();
 for(let f=0;f<current.length;f+=3)
  for(let k=0;k<3;k++){
   const a=current[f+k],b=current[f+(k+1)%3],
    key=[a,b].sort((x,y)=>x-y).join(':');
   inc.set(key,(inc.get(key)||0)+1);
  }
 assert.ok(!inc.has('7:32'));
 assert.equal(inc.get('7:33'),2);
 assert.equal(inc.get('32:33'),2);
 assert.equal(sha(source),sourceSha);
});

test('depth-two midpoint conserves both UV sets, all 70 joints, morphs and textures',()=>{
 const prev=applyMeshOperations(source,withChild),
  next=applyMeshOperations(source,deepOps);
 for(const name of ['POSITION','NORMAL','TEXCOORD_0','TEXCOORD_1',
  'JOINTS_0','WEIGHTS_0'])
  assert.deepEqual(attr(next,name).slice(0,33),attr(prev,name),
   'Pre-existing row must remain unchanged: '+name);
 for(const name of ['TEXCOORD_0','TEXCOORD_1']){
  const uv=attr(next,name);
  for(let k=0;k<2;k++)assert.ok(
   Math.abs(uv[33][k]-(uv[7][k]+uv[32][k])/2)<1e-6);
 }
 const weights=attr(next,'WEIGHTS_0')[33],
  joints=attr(next,'JOINTS_0')[33];
 assert.ok(joints.every(Number.isSafeInteger));
 assert.ok(weights.every(n=>Number.isFinite(n)&&n>=0));
 assert.ok(Math.abs(weights.reduce((a,b)=>a+b,0)-1)<1e-6);
 const p=parseGlb(prev).json.meshes[0].primitives[0],
  q=parseGlb(next).json.meshes[0].primitives[0];
 for(let i=0;i<2;i++){
  const a=rows(prev,p.targets[i].POSITION),
   b=rows(next,q.targets[i].POSITION);
  assert.deepEqual(b.slice(0,33),a);
  for(let k=0;k<3;k++)assert.ok(
   Math.abs(b[33][k]-(a[7][k]+a[32][k])/2)<1e-6);
 }
 const rig=inspectRiggedGlb(next),doc=parseGlb(next).json,
  src=parseGlb(source).json;
 assert.equal(rig.skins[0].joints,70);
 assert.equal(rig.morphs[0].targets,2);
 assert.equal(rig.animations.length,3);
 assert.deepEqual(doc.skins,src.skins);
 assert.deepEqual(doc.animations,src.animations);
 assert.deepEqual(doc.materials,src.materials);
 assert.equal(compareGlbTextures(source,next).status,'pass_supported_png');
});

test('read-only MeshData preserves parent and daughter journals, new grandchild lineage',()=>{
 const before=data(applyMeshOperations(source,withChild),withChild),
  after=data(applyMeshOperations(source,deepOps),deepOps);
 assert.equal(after.diagnostics.triangleCount,22);
 assert.equal(after.diagnostics.cornerCount,66);
 assert.equal(after.diagnostics.halfedgeCount,66);
 assert.equal(after.diagnostics.boundaryEdges,4);
 assert.equal(after.diagnostics.nonManifoldEdges,0);
 assert.equal(after.diagnostics.windingConflicts,0);
 assert.equal(after.diagnostics.radialSplitCount,2);
 assert.equal(after.diagnostics.daughterSplitCount,2);
 assert.equal(after.diagnostics.deepestSplitGeneration,2);
 assert.deepEqual(after.topologyRemaps,before.topologyRemaps);
 assert.deepEqual(after.edgeSplitRemaps,before.edgeSplitRemaps);
 assert.deepEqual(after.daughterRemap,before.daughterRemap,
  'Historical daughter-edge creation must not be rewritten');
 const remap=after.grandchildRemap;
 assert.ok(remap);assert.equal(remap.generation,2);
 assert.equal(remap.newAttributeVertex,33);
 assert.equal(remap.sourceFace,0);assert.equal(remap.sourceVertex,1);
 assert.equal(remap.parentSplitNewLogicalVertexId,
  before.daughterRemap.newLogicalVertexId);
 assert.ok(before.edges.some(e=>e.id===remap.parentEdgeId));
 assert.ok(!after.edges.some(e=>e.id===remap.parentEdgeId));
 assert.deepEqual(after.descendantRemaps,[before.daughterRemap,remap]);
 assert.equal(remap.newFaceIds.length,2);
 assert.ok(remap.newFaceIds.every(id=>after.faces.some(f=>f.id===id)));
 assert.equal(remap.invalidatedCornerIds.length,2);
 assert.equal(remap.invalidatedHalfedgeIds.length,4);
 for(const id of remap.invalidatedCornerIds){
  assert.ok(before.corners.some(c=>c.id===id));
  assert.ok(!after.corners.some(c=>c.id===id));
 }
 for(const id of remap.invalidatedHalfedgeIds){
  assert.ok(before.halfedges.some(h=>h.id===id));
  assert.ok(!after.halfedges.some(h=>h.id===id));
 }
 assert.ok(remap.createdEdgeIds.length>=3);
 const halfedges=new Map(after.halfedges.map(h=>[h.id,h]));
 assert.equal(halfedges.size,after.halfedges.length);
 for(const h of halfedges.values()){
  assert.ok(halfedges.has(h.next)&&halfedges.has(h.prev));
  if(h.twin)assert.equal(halfedges.get(h.twin)?.twin,h.id);
 }
});

test('reverse primary ordering never changes semantic grandchild lineage IDs',()=>{
 const reverseDeep=[...originalOps,split(1,3),split(0,1),
  daughter(0),grandchild];
 const a=data(applyMeshOperations(source,deepOps),deepOps),
  b=data(applyMeshOperations(source,reverseDeep),reverseDeep);
 const fields=r=>({
  sourceFace:r.sourceFace,sourceVertex:r.sourceVertex,
  id:r.newLogicalVertexId,parent:r.parentEdgeId,
  faces:r.newFaceIds,edges:r.createdEdgeIds});
 assert.deepEqual(fields(a.grandchildRemap),fields(b.grandchildRemap));
 assert.deepEqual(a.faces.map(f=>f.id).sort(),
  b.faces.map(f=>f.id).sort());
});

test('native ZIP saves generation-two command and replays exactly identical GLB',async()=>{
 const native=await createPreviewMarkscene(source,{
  projectId:'mark-pass24-depth2',
  edits:{meshSeamLinks:[],meshOperations:deepOps}
 });
 const opened=await openPreviewMarkscene(native.archive);
 assert.deepEqual(opened.sourceGLB,source);
 assert.deepEqual(opened.edits.meshOperations,deepOps);
 const out=await exportEditedSourceGlb(opened);
 assert.deepEqual(out.glb,applyMeshOperations(source,deepOps));
 assert.deepEqual((await exportEditedSourceGlb(
  await openPreviewMarkscene(native.archive))).glb,out.glb);
 assert.deepEqual(data(out.glb,deepOps).grandchildRemap,
  data(applyMeshOperations(source,deepOps),deepOps).grandchildRemap);
});

test('invalid generation-two sources, duplicates, forged fields and subsequent edits rejected',async()=>{
 const invalid=[
  [...withTwo,grandchild],
  [...withChild,{...grandchild,sourceVertex:2}],
  [...withChild,{...grandchild,sourceFace:1}],
  [...deepOps,grandchild],
  [...deepOps,daughter(0)],
  [...deepOps,split(1,4)],
  [...deepOps,move],
  [...withChild,{...grandchild,script:'unsafe'}]
 ];
 for(const ops of invalid)assert.throws(()=>
  applyMeshOperations(source,ops),/MARK_MESH_/);
 await assert.rejects(()=>createPreviewMarkscene(source,{
  edits:{meshOperations:[...withChild,{...grandchild,evil:1}]}
 }),/MARK_SCENE3_MESH_EDIT_FIELDS/);
 await assert.rejects(()=>createPreviewMarkscene(source,{
  edits:{meshOperations:[...withChild,grandchild,grandchild]}
 }),/MARK_SCENE3_MESH_LINKED_SEQUENCE/);
});

test('AI Bridge validates actual daughter edge, blocks forging, restores after undo and reopen',async()=>{
 const bridge=createAiBridge({allowWrites:true,buildHash:'pass24'});
 let n=0;const call=async(method,params={})=>{
  const r=await bridge.request({requestId:'p24.'+(++n),method,params});
  assert.equal(r.ok,true,JSON.stringify(r.diagnostics));return r.result;
 };
 const caps=await call('studio.getCapabilities');
 assert.ok(caps.supported.includes('mesh.splitPokedCapGrandchildEdge'));
 const up=await call('asset.upload',{
  type:'glb',name:'pass24-rig.glb',data:source});
 await call('scene.open',{assetId:up.assetId});
 for(const link of extrusion.links)await call('mesh.linkSeam',{
  meshId:'gltf-mesh-0',vertexA:link.vertexA,vertexB:link.vertexB});
 await call('mesh.extrudeLinkedRegion',{
  meshId:'gltf-mesh-0',faces:[0,1],distance:.55});
 for(const face of [0,1]){
  const graph=await call('mesh.getMeshData',{
   meshId:'gltf-mesh-0',full:true});
  await call('mesh.pokeLinkedCap',{
   meshId:'gltf-mesh-0',
   capFaceId:graph.faces.find(f=>f.id.endsWith('cap-face-'+face)).id});
 }
 for(const [sourceFace,sourceVertex] of [[0,1],[1,3]]){
  const graph=await call('mesh.getMeshData',{
   meshId:'gltf-mesh-0',full:true}),
   center=graph.topologyRemaps.find(r=>r.sourceFace===sourceFace)
    .centerLogicalVertexId,
   cap=graph.capMap.find(r=>r.sourceVertex===sourceVertex)
    .logicalVertexId,
   edge=graph.edges.find(e=>e.halfedgeIds.length===2&&
    graph.halfedges.some(h=>e.halfedgeIds.includes(h.id)&&
     (h.origin===center&&h.destination===cap||
      h.destination===center&&h.origin===cap)));
  assert.ok(edge?.id);
  await call('mesh.splitPokedCapEdge',{
   meshId:'gltf-mesh-0',sourceFace,sourceVertex,edgeId:edge.id});
 }
 const getEdge=async(parentId,face,vertex)=>{
  const graph=await call('mesh.getMeshData',{
   meshId:'gltf-mesh-0',full:true}),
   cap=graph.capMap.find(c=>c.sourceVertex===vertex).logicalVertexId;
  const edge=graph.edges.find(e=>e.halfedgeIds.length===2&&
   graph.halfedges.some(h=>e.halfedgeIds.includes(h.id)&&
    (h.origin===cap&&h.destination===parentId||
     h.destination===cap&&h.origin===parentId)));
  assert.ok(edge?.id);return edge.id;
 };
 const firstGraph=await call('mesh.getMeshData',{
  meshId:'gltf-mesh-0',full:true});
 const primary=firstGraph.edgeSplitRemaps.find(r=>r.sourceFace===0);
 const parent=await getEdge(primary.newLogicalVertexId,0,1);
 await call('mesh.splitPokedCapChildEdge',{
  meshId:'gltf-mesh-0',sourceFace:0,sourceVertex:1,parentEdgeId:parent});
 const one=await call('mesh.getMeshData',{
  meshId:'gltf-mesh-0',full:true});
 const daughterEdge=await getEdge(one.daughterRemap.newLogicalVertexId,0,1);
 const forged=await bridge.request({requestId:'p24.forged',
  method:'mesh.splitPokedCapGrandchildEdge',
  params:{meshId:'gltf-mesh-0',sourceFace:0,sourceVertex:1,
   parentEdgeId:daughterEdge+'-forged'}});
 assert.equal(forged.ok,false);
 assert.ok(JSON.stringify(forged.diagnostics).includes('GRANDCHILD_PARENT'));
 await call('mesh.splitPokedCapGrandchildEdge',{
  meshId:'gltf-mesh-0',sourceFace:0,sourceVertex:1,
  parentEdgeId:daughterEdge});
 const current=await call('mesh.getMeshData',{
  meshId:'gltf-mesh-0'});
 assert.equal(current.diagnostics.deepestSplitGeneration,2);
 assert.equal(current.grandchildRemap.parentEdgeId,daughterEdge);
 const save=await call('scene.save'),out=await call('scene.export');
 const opened=await openPreviewMarkscene(save.data);
 assert.equal(opened.edits.meshOperations.at(-1).kind,
  'edge.splitPokedCapGrandchild');
 assert.deepEqual((await exportEditedSourceGlb(opened)).glb,out.data);
 const duplicate=await bridge.request({requestId:'p24.duplicate',
  method:'mesh.splitPokedCapGrandchildEdge',
  params:{meshId:'gltf-mesh-0',sourceFace:0,sourceVertex:1,
   parentEdgeId:daughterEdge}});
 assert.equal(duplicate.ok,false);
 await call('history.undo');
 assert.equal((await call('mesh.getStats',{meshId:'gltf-mesh-0'}))
  .triangleCount,20);
 await call('history.redo');
 assert.deepEqual((await call('scene.export')).data,out.data);
 const other=createAiBridge({allowWrites:true});
 let i=0;const again=async(method,params={})=>{
  const r=await other.request({requestId:'other.'+(++i),method,params});
  assert.equal(r.ok,true,JSON.stringify(r.diagnostics));return r.result;
 };
 const asset=await again('asset.upload',{
  type:'markscene',name:'pass24.markscene',data:save.data});
 await again('scene.open',{assetId:asset.assetId});
 assert.deepEqual((await again('scene.export')).data,out.data);
 assert.deepEqual((await again('mesh.getMeshData',{
  meshId:'gltf-mesh-0'})).grandchildRemap,current.grandchildRemap);
});
