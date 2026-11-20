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

test('physical split changes exactly two cap incident triangles with no T junction',()=>{
 const before=applyMeshOperations(source,originalOps),
  after=applyMeshOperations(source,withSplit);
 const oldStats=getMeshEditStats(before),newStats=getMeshEditStats(after);
 assert.equal(oldStats.vertexCount,30);
 assert.equal(oldStats.triangleCount,14);
 assert.equal(newStats.vertexCount,31);
 assert.equal(newStats.triangleCount,16);
 assert.equal(newStats.nonManifoldEdges,0);
 assert.equal(newStats.degenerateTriangles,0);
 const pos=attr(after,'POSITION');
 assert.deepEqual(attr(after,'POSITION').slice(0,30),attr(before,'POSITION'));
 for(let k=0;k<3;k++)assert.ok(Math.abs(pos[30][k]-
  (pos[7][k]+pos[28][k])/2)<1e-6);
 const beforeIdx=indices(before),afterIdx=indices(after);
 const changed=[],newIndex=30;
 for(let f=0;f<14;f++){
  const oldTri=beforeIdx.slice(f*3,f*3+3),newTri=afterIdx.slice(f*3,f*3+3);
  if(oldTri.join(',')!==newTri.join(','))changed.push(f);
 }
 assert.equal(changed.length,2);
 assert.ok(changed.every(f=>beforeIdx.slice(f*3,f*3+3).includes(7)&&
  beforeIdx.slice(f*3,f*3+3).includes(28)));
 assert.ok(changed.every(f=>afterIdx.slice(f*3,f*3+3).includes(newIndex)));
 assert.ok(afterIdx.slice(-6).includes(newIndex));
 assert.equal(beforeIdx.filter(x=>x===newIndex).length,0);
 assert.equal(afterIdx.filter(x=>x===newIndex).length,4);
 // Both incident faces must be split; old internal shared edge disappears.
 const edges=(indicesArray)=>{
  const incidence=new Map();
  for(let f=0;f<indicesArray.length;f+=3)
   for(let k=0;k<3;k++){
    const a=indicesArray[f+k],b=indicesArray[f+(k+1)%3],
     key=Math.min(a,b)+':'+Math.max(a,b);
    incidence.set(key,(incidence.get(key)||0)+1);
   }
  return incidence;
 };
 const graph=edges(afterIdx);
 assert.ok(!graph.has('7:28'));
 assert.equal(graph.get('7:30'),2);
 assert.equal(graph.get('28:30'),2);
 assert.equal(sha(source),sourceSha);
});

test('midpoint preserves independent UV0/UV1, morphs, exact four-bone blend and PNG',()=>{
 const before=applyMeshOperations(source,originalOps),
  after=applyMeshOperations(source,withSplit);
 for(const name of ['POSITION','NORMAL','TEXCOORD_0','TEXCOORD_1',
  'JOINTS_0','WEIGHTS_0'])
  assert.deepEqual(attr(after,name).slice(0,30),attr(before,name),
   'No old attribute row is renumbered or overwritten: '+name);
 for(const name of ['TEXCOORD_0','TEXCOORD_1']){
  const uv=attr(after,name);
  for(let k=0;k<2;k++)assert.ok(Math.abs(uv[30][k]-
   (uv[7][k]+uv[28][k])/2)<1e-6);
 }
 const weights=attr(after,'WEIGHTS_0')[30],
  joints=attr(after,'JOINTS_0')[30];
 assert.ok(joints.every(Number.isSafeInteger));
 assert.ok(weights.every(w=>w>=0));
 assert.ok(Math.abs(weights.reduce((sum,w)=>sum+w,0)-1)<1e-6);
 const pBefore=parseGlb(before).json.meshes[0].primitives[0],
  pAfter=parseGlb(after).json.meshes[0].primitives[0];
 for(const m of [0,1]){
  const old=rows(before,pBefore.targets[m].POSITION),
   next=rows(after,pAfter.targets[m].POSITION);
  assert.deepEqual(next.slice(0,30),old);
  for(let k=0;k<3;k++)assert.ok(Math.abs(next[30][k]-
   (old[7][k]+old[28][k])/2)<1e-6);
 }
 const parsed=parseGlb(after).json,orig=parseGlb(source).json;
 assert.deepEqual(parsed.skins,orig.skins);
 assert.deepEqual(parsed.animations,orig.animations);
 assert.deepEqual(parsed.materials,orig.materials);
 assert.equal(compareGlbTextures(source,after).status,'pass_supported_png');
 const audit=inspectRiggedGlb(after);
 assert.equal(audit.skins[0].joints,70);
 assert.equal(audit.morphs[0].targets,2);
 assert.equal(audit.animations.length,3);
});

test('MeshData retains prior Poke IDs and traces new midpoint, edges and split faces',()=>{
 const before=data(applyMeshOperations(source,originalOps),originalOps),
  after=data(applyMeshOperations(source,withSplit),withSplit);
 assert.equal(before.diagnostics.triangleCount,14);
 assert.equal(after.diagnostics.triangleCount,16);
 assert.equal(after.diagnostics.cornerCount,48);
 assert.equal(after.diagnostics.halfedgeCount,48);
 assert.equal(after.diagnostics.nonManifoldEdges,0);
 assert.equal(after.diagnostics.windingConflicts,0);
 assert.equal(after.diagnostics.boundaryEdges,4);
 assert.equal(after.diagnostics.radialSplitCount,1);
 assert.deepEqual(after.topologyRemaps,before.topologyRemaps);
 const remap=after.edgeSplitRemap;
 assert.equal(remap.schema,'mark.radial-cap-edge-split/1');
 assert.equal(remap.newAttributeVertex,30);
 assert.equal(remap.sourceFace,0);
 assert.equal(remap.sourceVertex,1);
 assert.equal(remap.modifiedFaceIds.length,2);
 assert.equal(remap.newFaceIds.length,2);
 assert.equal(remap.invalidatedCornerIds.length,2);
 assert.equal(remap.invalidatedHalfedgeIds.length,4);
 assert.ok(remap.newFaceIds.every(id=>after.faces.some(f=>f.id===id)));
 assert.ok(!after.edges.some(e=>e.id===remap.sourceEdgeId));
 assert.ok(remap.createdEdgeIds.length>=3);
 for(const id of remap.invalidatedCornerIds){
  assert.ok(before.corners.some(c=>c.id===id));
  assert.ok(!after.corners.some(c=>c.id===id));
 }
 for(const id of remap.invalidatedHalfedgeIds){
  assert.ok(before.halfedges.some(h=>h.id===id));
  assert.ok(!after.halfedges.some(h=>h.id===id));
 }
 assert.ok(before.faces.every(face=>after.faces.some(f=>f.id===face.id)));
 const halfedgeMap=new Map(after.halfedges.map(e=>[e.id,e]));
 for(const h of halfedgeMap.values()){
  assert.ok(halfedgeMap.has(h.next)&&halfedgeMap.has(h.prev));
  if(h.twin)assert.equal(halfedgeMap.get(h.twin).twin,h.id);
 }
});

test('native .markscene preserves source binary, final split operation and id remap',async()=>{
 const native=await createPreviewMarkscene(source,{projectId:'pass21-radial',
  edits:{meshOperations:withSplit,meshSeamLinks:[]}});
 const reopened=await openPreviewMarkscene(native.archive);
 assert.deepEqual(reopened.sourceGLB,source);
 assert.deepEqual(reopened.edits.meshOperations,withSplit);
 const output=await exportEditedSourceGlb(reopened);
 assert.deepEqual(output.glb,applyMeshOperations(source,withSplit));
 const second=await openPreviewMarkscene(native.archive);
 assert.deepEqual((await exportEditedSourceGlb(second)).glb,output.glb);
 assert.deepEqual(data(output.glb,withSplit).edgeSplitRemap,
  data(applyMeshOperations(source,withSplit),withSplit).edgeSplitRemap);
});

test('reject missing Poke, repeated radial split, original wall edge and unknown fields',async()=>{
 const bad=[
  [split(0,1)],
  [extrusion,split(0,1)],
  [...originalOps,split(7,1)],
  [...originalOps,split(0,99)],
  [...originalOps,split(0,4)],
  [...originalOps,split(0,1),split(0,1)],
  [...originalOps,split(0,1),poke(0)],
  [...originalOps,{...split(0,1),script:'bad'}]
 ];
 for(const list of bad)
  assert.throws(()=>applyMeshOperations(source,list),/MARK_MESH_/);
 await assert.rejects(()=>createPreviewMarkscene(source,{
  edits:{meshOperations:[...originalOps,split(0,1),split(0,1)]}
 }),/MARK_SCENE3_MESH_LINKED_SEQUENCE/);
 await assert.rejects(()=>createPreviewMarkscene(source,{
  edits:{meshOperations:[...originalOps,{...split(0,1),evil:true}]}
 }),/MARK_SCENE3_MESH_EDIT_FIELDS/);
});

test('AI Bridge validates actual stable edge; prevents forged ID and saves replayed GLB',async()=>{
 const bridge=createAiBridge({allowWrites:true,buildHash:'pass21'});
 let n=0;
 const req=async(method,params={})=>{
  const r=await bridge.request({requestId:'p21.'+(++n),method,params});
  assert.equal(r.ok,true,JSON.stringify(r.diagnostics));return r.result;
 };
 const caps=await req('studio.getCapabilities');
 assert.ok(caps.supported.includes('mesh.splitPokedCapEdge'));
 const up=await req('asset.upload',{type:'glb',name:'rig-seam.glb',data:source});
 await req('scene.open',{assetId:up.assetId});
 for(const l of extrusion.links)await req('mesh.linkSeam',{
  meshId:'gltf-mesh-0',vertexA:l.vertexA,vertexB:l.vertexB
 });
 await req('mesh.extrudeLinkedRegion',{meshId:'gltf-mesh-0',
  faces:[0,1],distance:.55});
 for(const sourceFace of [0,1]){
  const graph=await req('mesh.getMeshData',{meshId:'gltf-mesh-0',full:true});
  const face=graph.faces.find(f=>f.id.endsWith('cap-face-'+sourceFace));
  await req('mesh.pokeLinkedCap',{meshId:'gltf-mesh-0',capFaceId:face.id});
 }
 const before=await req('mesh.getMeshData',{meshId:'gltf-mesh-0',full:true});
 const center=before.topologyRemaps[0].centerLogicalVertexId,
  vertex=before.capMap.find(r=>r.sourceVertex===1).logicalVertexId;
 const radial=before.edges.find(e=>e.halfedgeIds.length===2&&
  before.halfedges.some(h=>e.halfedgeIds.includes(h.id)&&
   (h.origin===center&&h.destination===vertex||
    h.destination===center&&h.origin===vertex)));
 assert.ok(radial?.id);
 const bad=await bridge.request({requestId:'p21.bad',method:'mesh.splitPokedCapEdge',
  params:{meshId:'gltf-mesh-0',sourceFace:0,sourceVertex:1,
   edgeId:radial.id+'-forged'}});
 assert.equal(bad.ok,false);
 assert.ok(JSON.stringify(bad.diagnostics).includes('RADIAL_STALE'));
 await req('mesh.splitPokedCapEdge',{
  meshId:'gltf-mesh-0',sourceFace:0,sourceVertex:1,edgeId:radial.id});
 const stats=await req('mesh.getStats',{meshId:'gltf-mesh-0'});
 assert.equal(stats.vertexCount,31);
 assert.equal(stats.triangleCount,16);
 const snap=await req('mesh.getMeshData',{meshId:'gltf-mesh-0'});
 assert.equal(snap.diagnostics.radialSplitCount,1);
 assert.equal(snap.edgeSplitRemap.sourceFace,0);
 const native=await req('scene.save');
 const exported=await req('scene.export');
 const opened=await openPreviewMarkscene(native.data);
 assert.deepEqual((await exportEditedSourceGlb(opened)).glb,exported.data);
 await req('history.undo');
 assert.equal((await req('mesh.getStats',{meshId:'gltf-mesh-0'}))
  .triangleCount,14);
 await req('history.redo');
 assert.deepEqual((await req('scene.export')).data,exported.data);
 const second=createAiBridge({allowWrites:true});
 let counter=0;
 const call=async(method,params={})=>{
  const r=await second.request({
   requestId:'second.'+(++counter),method,params});
  assert.equal(r.ok,true,JSON.stringify(r.diagnostics));return r.result;
 };
 const asset=await call('asset.upload',{name:'pass21.markscene',
  type:'markscene',data:native.data});
 await call('scene.open',{assetId:asset.assetId});
 assert.deepEqual((await call('scene.export')).data,exported.data);
 assert.deepEqual((await call('mesh.getMeshData',{meshId:'gltf-mesh-0'}))
  .edgeSplitRemap,snap.edgeSplitRemap);
});
