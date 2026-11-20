import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {parseGlb} from '../src/glb.js';
import {applyMeshOperations,getMeshEditStats}
 from '../src/pro-studio/mesh-edit-core.js';
import {buildMeshDataSnapshot} from '../src/pro-studio/meshdata-halfedge-preview.js';
import {createPreviewMarkscene,openPreviewMarkscene,exportEditedSourceGlb}
 from '../src/pro-studio/markscene-v3-preview.js';
import {createAiBridge} from '../src/pro-studio/ai-bridge-core.js';
import {buildSkinnedSeamFixture}
 from '../scripts/pro-studio-pass17-skinned-seam-fixture.mjs';
import {inspectRiggedGlb} from '../src/pro-studio/rigged-glb-audit.js';
import {compareGlbTextures} from '../src/pro-studio/glb-texture-qa.js';

const source=buildSkinnedSeamFixture();
const sha=data=>createHash('sha256').update(Buffer.from(data)).digest('hex');
const sourceSha=sha(source);
const linked={kind:'face.regionExtrudeLinked',meshIndex:0,primitiveIndex:0,
 faces:[0,1],distance:.55,links:[
 {meshIndex:0,primitiveIndex:0,vertexA:1,vertexB:4},
 {meshIndex:0,primitiveIndex:0,vertexA:2,vertexB:5}]};
const move={kind:'vertex.moveLinkedCap',meshIndex:0,primitiveIndex:0,
 sourceVertex:1,delta:[.12,.015,.02]};
const poke=sourceFace=>({kind:'face.pokeLinkedCap',
 meshIndex:0,primitiveIndex:0,sourceFace});
const before=[linked,move,poke(0)],both=[linked,move,poke(0),poke(1)];
const third=[linked,move,poke(1),poke(0)];
function readRows(glb,accessorIndex){
 const parsed=parseGlb(glb),doc=parsed.json,a=doc.accessors[accessorIndex],
  v=doc.bufferViews[a.bufferView],unit={5121:1,5123:2,5125:4,5126:4}[a.componentType],
  method={5121:'getUint8',5123:'getUint16',
   5125:'getUint32',5126:'getFloat32'}[a.componentType],
  n={SCALAR:1,VEC2:2,VEC3:3,VEC4:4}[a.type],stride=v.byteStride??unit*n,
  bin=parsed.chunks.find(x=>x.type===0x004e4942).data,
  dv=new DataView(bin.buffer,bin.byteOffset,bin.byteLength),
  offset=(v.byteOffset||0)+(a.byteOffset||0);
 return Array.from({length:a.count},(_,i)=>Array.from({length:n},(_,j)=>
  dv[method](offset+i*stride+j*unit,true)));
}
const rows=(glb,semantic)=>{
 const p=parseGlb(glb).json.meshes[0].primitives[0];
 return readRows(glb,p.attributes[semantic]);
};
const snapshot=(glb,ops)=>buildMeshDataSnapshot({
 sourceGLB:source,editedGLB:glb,sourceSha256:sourceSha,operations:ops
});

test('two source-distinct Pokes append two real centroid vertices and four triangles',()=>{
 const single=applyMeshOperations(source,before);
 const edited=applyMeshOperations(source,both);
 assert.equal(getMeshEditStats(single).vertexCount,29);
 assert.equal(getMeshEditStats(single).triangleCount,12);
 assert.equal(getMeshEditStats(edited).vertexCount,30);
 assert.equal(getMeshEditStats(edited).triangleCount,14);
 for(const semantic of ['POSITION','NORMAL','TEXCOORD_0','TEXCOORD_1',
  'JOINTS_0','WEIGHTS_0'])
  assert.deepEqual(rows(edited,semantic).slice(0,29),rows(single,semantic),
   'Second Poke must not move or renumber existing '+semantic+' rows');
 const p=rows(edited,'POSITION');
 const cap=[10,9,11]; // second source cap triangle remains intact before Poke
 for(let k=0;k<3;k++)assert.ok(Math.abs(p[29][k]-
  cap.reduce((sum,i)=>sum+p[i][k]/3,0))<1e-6);
 for(const uv of ['TEXCOORD_0','TEXCOORD_1']){
  const data=rows(edited,uv);
  for(let k=0;k<2;k++)assert.ok(Math.abs(data[29][k]-
   cap.reduce((sum,i)=>sum+data[i][k]/3,0))<1e-6);
 }
 for(const target of [0,1]){
  const a=parseGlb(single).json.meshes[0].primitives[0].targets[target],
   b=parseGlb(edited).json.meshes[0].primitives[0].targets[target];
  const one=readRows(single,a.POSITION),two=readRows(edited,b.POSITION);
  assert.deepEqual(two.slice(0,29),one);
  for(let k=0;k<3;k++)assert.ok(Math.abs(two[29][k]-
   cap.reduce((sum,i)=>sum+two[i][k]/3,0))<1e-6);
 }
 const weights=rows(edited,'WEIGHTS_0')[29],joints=rows(edited,'JOINTS_0')[29];
 assert.equal(joints.length,4);
 assert.ok(Math.abs(weights.reduce((sum,w)=>sum+w,0)-1)<1e-6);
 assert.ok(weights.every(w=>w>=0));
 assert.equal(sha(source),sourceSha);
 assert.equal(compareGlbTextures(source,edited).status,'pass_supported_png');
 const rig=inspectRiggedGlb(edited);
 assert.equal(rig.skins[0].joints,70);
 assert.equal(rig.animations.length,3);
 assert.equal(rig.morphs[0].targets,2);
 const doc=parseGlb(edited).json,originalDoc=parseGlb(source).json;
 assert.deepEqual(doc.skins,originalDoc.skins);
 assert.deepEqual(doc.animations,originalDoc.animations);
 assert.deepEqual(doc.materials,originalDoc.materials);
});

test('multi-Poke halfedge graph has stable deterministic provenance for all children',()=>{
 const one=snapshot(applyMeshOperations(source,before),before);
 const two=snapshot(applyMeshOperations(source,both),both);
 assert.equal(one.diagnostics.capPokeCount,1);
 assert.equal(two.diagnostics.capPokeCount,2);
 assert.equal(two.diagnostics.triangleCount,14);
 assert.equal(two.diagnostics.cornerCount,42);
 assert.equal(two.diagnostics.halfedgeCount,42);
 assert.equal(two.diagnostics.nonManifoldEdges,0);
 assert.equal(two.diagnostics.windingConflicts,0);
 assert.equal(two.diagnostics.boundaryEdges,4);
 assert.deepEqual(two.uvSets,['TEXCOORD_0','TEXCOORD_1']);
 assert.equal(two.topologyRemaps.length,2);
 assert.deepEqual(two.topologyRemap,two.topologyRemaps[1]);
 assert.equal(two.topologyRemaps[0].sourceFace,0);
 assert.equal(two.topologyRemaps[1].sourceFace,1);
 assert.deepEqual(two.topologyRemaps.map(r=>r.centerAttributeVertex),[28,29]);
 assert.deepEqual(two.topologyRemaps[0],one.topologyRemap,
  'First Poke must not lose source/face/corner/halfedge IDs after a second');
 assert.notEqual(two.topologyRemaps[0].centerLogicalVertexId,
  two.topologyRemaps[1].centerLogicalVertexId);
 assert.ok(one.faces.every(f=>two.faces.some(x=>x.id===f.id)),
  'No already-created face identity may disappear after an independent Poke');
 assert.ok(two.topologyRemaps.every(r=>r.createdFaceIds.every(id=>
  two.faces.some(f=>f.id===id))));
 for(const r of two.topologyRemaps){
  for(const id of r.retainedCornerIds)assert.ok(two.corners.some(c=>c.id===id));
  for(const id of r.invalidatedCornerIds)assert.ok(!two.corners.some(c=>c.id===id));
  for(const id of r.invalidatedHalfedgeIds)assert.ok(
   !two.halfedges.some(h=>h.id===id));
 }
 const halves=new Map(two.halfedges.map(h=>[h.id,h]));
 for(const h of halves.values()){
  assert.ok(halves.has(h.next)&&halves.has(h.prev));
  if(h.twin)assert.equal(halves.get(h.twin)?.twin,h.id);
 }
 assert.equal(two.capMap.length,6);
 assert.deepEqual(two.capMap,one.capMap);
});

test('reverse Poke order yields same semantic logical IDs per original face',()=>{
 const a=snapshot(applyMeshOperations(source,both),both);
 const b=snapshot(applyMeshOperations(source,third),third);
 const ids=m=>Object.fromEntries(m.topologyRemaps.map(r=>
  [r.sourceFace,{center:r.centerLogicalVertexId,
   originals:r.originalFaceId,created:r.createdFaceIds,
   kept:r.retainedCornerIds,invalid:r.invalidatedHalfedgeIds}]));
 assert.deepEqual(ids(a),ids(b),'Stable IDs must not depend on click/order');
 assert.deepEqual(a.faces.map(f=>f.id).sort(),b.faces.map(f=>f.id).sort());
 assert.notDeepEqual(a.topologyRemaps.map(x=>x.centerAttributeVertex),
  b.topologyRemaps.map(x=>x.centerAttributeVertex),
  'Real glTF row offsets are not stable IDs and should not be misrepresented');
});

test('markscene ZIP save/reopen and binary exported GLB remain deterministic',async()=>{
 const firstSave=await createPreviewMarkscene(source,{
  projectId:'pass20-multiple-poke',edits:{meshSeamLinks:[],meshOperations:both}
 });
 const reopened=await openPreviewMarkscene(firstSave.archive);
 assert.deepEqual(reopened.sourceGLB,source);
 assert.deepEqual(reopened.edits.meshOperations,both);
 const exported=await exportEditedSourceGlb(reopened);
 assert.deepEqual(exported.glb,applyMeshOperations(source,both));
 const repacked=await createPreviewMarkscene(reopened.sourceGLB,{
  projectId:'pass20-multiple-poke',edits:reopened.edits
 });
 assert.deepEqual((await exportEditedSourceGlb(
  await openPreviewMarkscene(repacked.archive))).glb,exported.glb);
 assert.deepEqual(snapshot(exported.glb,both).topologyRemaps,
  snapshot(applyMeshOperations(source,both),both).topologyRemaps);
});

test('reject duplicate source face, third-party faces, stale edit sequence and fields',async()=>{
 const malformed=[
  [linked,poke(0),poke(0)],
  [linked,poke(0),move],
  [linked,poke(0),poke(1),poke(0)],
  [linked,poke(999)],
  [linked,{...poke(1),script:'unsafe'}],
  [linked,poke(0),{kind:'face.flip',meshIndex:0,primitiveIndex:0,face:0}]
 ];
 for(const ops of malformed)assert.throws(()=>applyMeshOperations(source,ops),
  /MARK_MESH_/);
 await assert.rejects(()=>createPreviewMarkscene(source,{
  edits:{meshOperations:[linked,poke(0),poke(0)]}}),/MARK_SCENE3_MESH_LINKED_SEQUENCE/);
 await assert.rejects(()=>createPreviewMarkscene(source,{
  edits:{meshOperations:[linked,poke(0),move]}}),/MARK_SCENE3_MESH_LINKED_SEQUENCE/);
 await assert.rejects(()=>createPreviewMarkscene(source,{
  edits:{meshOperations:[linked,poke(1),{...poke(0),evil:true}]}}),
  /MARK_SCENE3_MESH_EDIT_FIELDS/);
});

test('Bridge two Pokes via exact stable cap face IDs, undo/redo and reopened native project',async()=>{
 const bridge=createAiBridge({allowWrites:true,buildHash:'pass20-test'});
 let n=0;
 const call=async(method,params={})=>{
  const r=await bridge.request({requestId:'p20.'+(++n),method,params});
  assert.equal(r.ok,true,JSON.stringify(r.diagnostics));return r.result;
 };
 const asset=await call('asset.upload',{name:'two-seam-caps.glb',
  type:'glb',data:source});
 await call('scene.open',{assetId:asset.assetId});
 for(const l of linked.links)await call('mesh.linkSeam',{
  meshId:'gltf-mesh-0',vertexA:l.vertexA,vertexB:l.vertexB});
 await call('mesh.extrudeLinkedRegion',{meshId:'gltf-mesh-0',
  faces:linked.faces,distance:linked.distance});
 const initial=await call('mesh.getMeshData',{meshId:'gltf-mesh-0',full:true});
 const id0=initial.faces.find(f=>f.id.endsWith('-cap-face-0')).id,
  id1=initial.faces.find(f=>f.id.endsWith('-cap-face-1')).id;
 await call('mesh.pokeLinkedCap',{meshId:'gltf-mesh-0',capFaceId:id0});
 const once=await call('mesh.getMeshData',{meshId:'gltf-mesh-0',full:true});
 assert.equal(once.diagnostics.capPokeCount,1);
 const duplicate=await bridge.request({
  requestId:'p20.duplicate',method:'mesh.pokeLinkedCap',
  params:{meshId:'gltf-mesh-0',capFaceId:id0}});
 assert.equal(duplicate.ok,false);
 assert.ok(JSON.stringify(duplicate.diagnostics).includes('POKE_ALREADY_SPLIT'));
 await call('mesh.pokeLinkedCap',{meshId:'gltf-mesh-0',capFaceId:id1});
 const result=await call('mesh.getMeshData',{meshId:'gltf-mesh-0',full:true});
 assert.equal(result.diagnostics.capPokeCount,2);
 assert.equal(result.diagnostics.triangleCount,14);
 assert.deepEqual(result.topologyRemaps.map(x=>x.sourceFace),[0,1]);
 assert.deepEqual(result.topologyRemaps[0],once.topologyRemap);
 const exported=await call('scene.export');
 const saved=await call('scene.save');
 const reopened=await openPreviewMarkscene(saved.data);
 assert.equal(reopened.edits.meshOperations.length,3);
 assert.deepEqual((await exportEditedSourceGlb(reopened)).glb,exported.data);
 await call('history.undo');
 assert.equal((await call('mesh.getStats',{meshId:'gltf-mesh-0'}))
  .triangleCount,12);
 await call('history.redo');
 assert.deepEqual((await call('scene.export')).data,exported.data);
 const clone=createAiBridge({allowWrites:true});
 let i=0;
 const req=async(method,params={})=>{
  const r=await clone.request({requestId:'clone.'+(++i),method,params});
  assert.equal(r.ok,true,JSON.stringify(r.diagnostics));return r.result;
 };
 const up=await req('asset.upload',{name:'two-poke.markscene',
  type:'markscene',data:saved.data});
 await req('scene.open',{assetId:up.assetId});
 assert.deepEqual((await req('scene.export')).data,exported.data);
 assert.deepEqual((await req('mesh.getMeshData',{meshId:'gltf-mesh-0'}))
  .topologyRemaps,result.topologyRemaps);
});
