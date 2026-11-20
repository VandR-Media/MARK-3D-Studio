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

test('second source-distinct radial split adds one real midpoint and repairs exactly two triangles',()=>{
 const a=applyMeshOperations(source,withSplit),b=applyMeshOperations(source,withTwo);
 assert.equal(getMeshEditStats(a).triangleCount,16);
 assert.equal(getMeshEditStats(a).vertexCount,31);
 const stats=getMeshEditStats(b);
 assert.equal(stats.triangleCount,18);
 assert.equal(stats.vertexCount,32);
 assert.equal(stats.nonManifoldEdges,0);
 assert.equal(stats.degenerateTriangles,0);
 assert.equal(stats.conflictingWindingEdges,0);
 const xy=attr(b,'POSITION');
 assert.deepEqual(xy.slice(0,31),attr(a,'POSITION'),
  'Previously split midpoint and source corners must not change');
 for(let k=0;k<3;k++)assert.ok(Math.abs(
  xy[31][k]-(xy[9][k]+xy[29][k])/2)<1e-6);
 const ia=indices(a),ib=indices(b),changed=[];
 for(let i=0;i<16;i++){
  const original=ia.slice(i*3,i*3+3),
   next=ib.slice(i*3,i*3+3);
  if(original.join()!==next.join()){
   changed.push(i);
   assert.ok(original.includes(9)&&original.includes(29));
   assert.ok(next.includes(31));
  }
 }
 assert.equal(changed.length,2,'Each shared radial edge has two incident faces');
 const incidence=new Map();
 for(let i=0;i<ib.length;i+=3)
  for(let k=0;k<3;k++){
   const a=ib[i+k],b=ib[i+(k+1)%3],key=[a,b].sort((x,y)=>x-y).join(':');
   incidence.set(key,(incidence.get(key)||0)+1);
  }
 assert.ok(!incidence.has('9:29'),'Old edge must not survive');
 assert.equal(incidence.get('9:31'),2);
 assert.equal(incidence.get('29:31'),2);
 assert.equal(sha(source),sourceSha);
});

test('both UV sets, skin weights, morphs and rig remain intact after TWO real splits',()=>{
 const before=applyMeshOperations(source,withSplit),
  after=applyMeshOperations(source,withTwo);
 for(const semantic of ['POSITION','NORMAL','TEXCOORD_0','TEXCOORD_1',
  'JOINTS_0','WEIGHTS_0'])
  assert.deepEqual(attr(after,semantic).slice(0,31),attr(before,semantic),
   'Second split modified an unrelated '+semantic+' row');
 for(const semantic of ['TEXCOORD_0','TEXCOORD_1']){
  const uv=attr(after,semantic);
  for(let k=0;k<2;k++)assert.ok(Math.abs(
   uv[31][k]-(uv[9][k]+uv[29][k])/2)<1e-6);
 }
 const joint=attr(after,'JOINTS_0')[31],weight=attr(after,'WEIGHTS_0')[31];
 assert.equal(joint.length,4);
 assert.ok(joint.every(Number.isSafeInteger));
 assert.ok(weight.every(x=>x>=0&&Number.isFinite(x)));
 assert.ok(Math.abs(weight.reduce((x,y)=>x+y,0)-1)<1e-6);
 const a=parseGlb(before).json.meshes[0].primitives[0],
  b=parseGlb(after).json.meshes[0].primitives[0];
 for(let i=0;i<2;i++){
  const old=rows(before,a.targets[i].POSITION),
   current=rows(after,b.targets[i].POSITION);
  assert.deepEqual(current.slice(0,31),old);
  for(let k=0;k<3;k++)assert.ok(Math.abs(
   current[31][k]-(old[9][k]+old[29][k])/2)<1e-6);
 }
 const rig=inspectRiggedGlb(after),doc=parseGlb(after).json,
  origin=parseGlb(source).json;
 assert.equal(rig.skins[0].joints,70);
 assert.equal(rig.animations.length,3);
 assert.equal(rig.morphs[0].targets,2);
 assert.deepEqual(doc.skins,origin.skins);
 assert.deepEqual(doc.animations,origin.animations);
 assert.deepEqual(doc.materials,origin.materials);
 assert.equal(compareGlbTextures(source,after).status,'pass_supported_png');
});

test('MeshData retains first radial remap, stable IDs, all halfedge twins, two child pairs',()=>{
 const before=data(applyMeshOperations(source,withSplit),withSplit);
 const after=data(applyMeshOperations(source,withTwo),withTwo);
 assert.equal(after.diagnostics.radialSplitCount,2);
 assert.equal(after.diagnostics.triangleCount,18);
 assert.equal(after.diagnostics.cornerCount,54);
 assert.equal(after.diagnostics.halfedgeCount,54);
 assert.equal(after.diagnostics.boundaryEdges,4);
 assert.equal(after.diagnostics.nonManifoldEdges,0);
 assert.equal(after.diagnostics.windingConflicts,0);
 assert.equal(after.edgeSplitRemaps.length,2);
 assert.deepEqual(after.edgeSplitRemap,after.edgeSplitRemaps[1]);
 assert.deepEqual(after.edgeSplitRemaps[0],before.edgeSplitRemap);
 assert.deepEqual(after.topologyRemaps,before.topologyRemaps);
 assert.deepEqual(after.edgeSplitRemaps.map(x=>x.newAttributeVertex),[30,31]);
 assert.deepEqual(after.edgeSplitRemaps.map(x=>x.sourceFace),[0,1]);
 for(const remap of after.edgeSplitRemaps){
  assert.equal(remap.newFaceIds.length,2);
  assert.equal(remap.modifiedFaceIds.length,2);
  assert.equal(remap.invalidatedCornerIds.length,2);
  assert.equal(remap.invalidatedHalfedgeIds.length,4);
  assert.ok(remap.newFaceIds.every(id=>after.faces.some(x=>x.id===id)));
  assert.ok(remap.invalidatedCornerIds.every(id=>
   !after.corners.some(x=>x.id===id)));
  assert.ok(remap.invalidatedHalfedgeIds.every(id=>
   !after.halfedges.some(x=>x.id===id)));
  assert.ok(remap.createdEdgeIds.length>=3);
  assert.ok(!after.edges.some(e=>e.id===remap.sourceEdgeId));
 }
 const twins=new Map(after.halfedges.map(h=>[h.id,h]));
 assert.equal(twins.size,after.halfedges.length);
 for(const h of twins.values()){
  assert.ok(twins.has(h.next)&&twins.has(h.prev));
  if(h.twin)assert.equal(twins.get(h.twin)?.twin,h.id);
 }
});

test('source-face logical midpoint IDs are invariant when independent splits reverse order',()=>{
 const forward=data(applyMeshOperations(source,withTwo),withTwo);
 const backwards=data(applyMeshOperations(source,reverse),reverse);
 const semantic=m=>Object.fromEntries(m.edgeSplitRemaps.map(r=>
  [r.sourceFace,{id:r.newLogicalVertexId,
   faces:r.newFaceIds,edge:r.sourceEdgeId,created:r.createdEdgeIds,
   kept:r.modifiedFaceIds,invalid:r.invalidatedHalfedgeIds}]));
 assert.deepEqual(semantic(forward),semantic(backwards));
 assert.deepEqual(forward.faces.map(f=>f.id).sort(),
  backwards.faces.map(f=>f.id).sort());
 const physicalOffsets=m=>Object.fromEntries(m.edgeSplitRemaps.map(r=>
  [r.sourceFace,r.newAttributeVertex]));
 assert.notDeepEqual(physicalOffsets(forward),physicalOffsets(backwards),
  'Source-keyed physical glTF row indices vary with edit order; IDs must not');
});

test('native .markscene saves two splits and restores byte-for-byte GLB and all ID records',async()=>{
 const native=await createPreviewMarkscene(source,{
  projectId:'pass22-multiple-radial',
  edits:{meshOperations:withTwo,meshSeamLinks:[]}
 });
 const open=await openPreviewMarkscene(native.archive);
 assert.deepEqual(open.sourceGLB,source);
 assert.deepEqual(open.edits.meshOperations,withTwo);
 const glb=await exportEditedSourceGlb(open);
 assert.deepEqual(glb.glb,applyMeshOperations(source,withTwo));
 assert.deepEqual((await exportEditedSourceGlb(
  await openPreviewMarkscene(native.archive))).glb,glb.glb);
 assert.deepEqual(data(glb.glb,withTwo).edgeSplitRemaps,
  data(applyMeshOperations(source,withTwo),withTwo).edgeSplitRemaps);
});

test('reject repeated same face, unapproved sources, split/move reordering or forged fields',async()=>{
 const invalid=[
  [...withSplit,split(0,2)],
  [...withSplit,split(0,1)],
  [...withSplit,split(3,3)],
  [...withSplit,split(1,0)],
  [...withSplit,split(1,99)],
  [...withSplit,poke(1)],
  [...withSplit,move],
  [...withSplit,{...split(1,3),payload:'injection'}]
 ];
 for(const ops of invalid)assert.throws(()=>
  applyMeshOperations(source,ops),/MARK_MESH_/);
 await assert.rejects(()=>createPreviewMarkscene(source,{
  edits:{meshOperations:[...withSplit,split(0,2)]}
 }),/MARK_SCENE3_MESH_LINKED_SEQUENCE/);
 await assert.rejects(()=>createPreviewMarkscene(source,{
  edits:{meshOperations:[...withSplit,move]}
 }),/MARK_SCENE3_MESH_LINKED_SEQUENCE/);
 await assert.rejects(()=>createPreviewMarkscene(source,{
  edits:{meshOperations:[...withSplit,{...split(1,3),evil:true}]}
 }),/MARK_SCENE3_MESH_EDIT_FIELDS/);
});

test('Bridge allows second verified source face, rejects reuse, persists scene and exact Undo/Redo',async()=>{
 const bridge=createAiBridge({allowWrites:true,buildHash:'p22-multi'});
 let seq=0;
 const call=async(method,params={})=>{
  const r=await bridge.request({
   requestId:'p22.'+(++seq),method,params});
  assert.equal(r.ok,true,JSON.stringify(r.diagnostics));return r.result;
 };
 const up=await call('asset.upload',{type:'glb',name:'rig-seam.glb',data:source});
 await call('scene.open',{assetId:up.assetId});
 for(const link of extrusion.links)await call('mesh.linkSeam',{
  meshId:'gltf-mesh-0',vertexA:link.vertexA,vertexB:link.vertexB
 });
 await call('mesh.extrudeLinkedRegion',{meshId:'gltf-mesh-0',
  faces:[0,1],distance:.55});
 const pokeFace=async face=>{
  const mesh=await call('mesh.getMeshData',{meshId:'gltf-mesh-0',full:true});
  const id=mesh.faces.find(f=>f.id.endsWith('cap-face-'+face)).id;
  await call('mesh.pokeLinkedCap',{meshId:'gltf-mesh-0',capFaceId:id});
 };
 await pokeFace(0);await pokeFace(1);
 const getRadial=async(sourceFace,sourceVertex)=>{
  const graph=await call('mesh.getMeshData',{meshId:'gltf-mesh-0',full:true});
  const center=graph.topologyRemaps.find(r=>
   r.sourceFace===sourceFace)?.centerLogicalVertexId;
  const cap=graph.capMap.find(r=>r.sourceVertex===sourceVertex)?.logicalVertexId;
  const edge=graph.edges.find(e=>e.halfedgeIds.length===2&&
   !e.nonManifold&&!e.windingConflict&&graph.halfedges.some(h=>
    e.halfedgeIds.includes(h.id)&&
    (h.origin===center&&h.destination===cap||
     h.destination===center&&h.origin===cap)));
  assert.ok(edge?.id,'Existing radial edge must be found by stable ID');
  return edge.id;
 };
 const edge0=await getRadial(0,1);
 await call('mesh.splitPokedCapEdge',{meshId:'gltf-mesh-0',
  sourceFace:0,sourceVertex:1,edgeId:edge0});
 const once=await call('mesh.getMeshData',{meshId:'gltf-mesh-0'});
 assert.equal(once.diagnostics.radialSplitCount,1);
 const stale=await bridge.request({requestId:'p22.stale',
  method:'mesh.splitPokedCapEdge',params:{
   meshId:'gltf-mesh-0',sourceFace:0,sourceVertex:2,edgeId:edge0}});
 assert.equal(stale.ok,false,'Cannot split a previously processed source face');
 const edge1=await getRadial(1,3);
 await call('mesh.splitPokedCapEdge',{meshId:'gltf-mesh-0',
  sourceFace:1,sourceVertex:3,edgeId:edge1});
 const mesh=await call('mesh.getMeshData',{meshId:'gltf-mesh-0'});
 assert.equal(mesh.diagnostics.radialSplitCount,2);
 assert.deepEqual(mesh.edgeSplitRemaps[0],once.edgeSplitRemap);
 const stats=await call('mesh.getStats',{meshId:'gltf-mesh-0'});
 assert.equal(stats.vertexCount,32);assert.equal(stats.triangleCount,18);
 const exported=await call('scene.export'),saved=await call('scene.save');
 const reopened=await openPreviewMarkscene(saved.data);
 assert.equal(reopened.edits.meshOperations.length,5);
 assert.deepEqual((await exportEditedSourceGlb(reopened)).glb,exported.data);
 await call('history.undo');
 assert.equal((await call('mesh.getStats',{meshId:'gltf-mesh-0'}))
  .triangleCount,16);
 await call('history.redo');
 assert.deepEqual((await call('scene.export')).data,exported.data);
 const fresh=createAiBridge({allowWrites:true});
 let c=0;const again=async(method,params={})=>{
  const r=await fresh.request({
   requestId:'fresh.'+(++c),method,params});
  assert.equal(r.ok,true,JSON.stringify(r.diagnostics));return r.result;
 };
 const asset=await again('asset.upload',{
  name:'pass22.markscene',type:'markscene',data:saved.data});
 await again('scene.open',{assetId:asset.assetId});
 assert.deepEqual((await again('scene.export')).data,exported.data);
 assert.deepEqual((await again('mesh.getMeshData',{meshId:'gltf-mesh-0'}))
  .edgeSplitRemaps,mesh.edgeSplitRemaps);
});
