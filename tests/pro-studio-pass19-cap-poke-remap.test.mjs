import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {parseGlb} from '../src/glb.js';
import {applyMeshOperations,getMeshEditStats} from '../src/pro-studio/mesh-edit-core.js';
import {buildMeshDataSnapshot} from '../src/pro-studio/meshdata-halfedge-preview.js';
import {createPreviewMarkscene,openPreviewMarkscene,exportEditedSourceGlb}
 from '../src/pro-studio/markscene-v3-preview.js';
import {createAiBridge} from '../src/pro-studio/ai-bridge-core.js';
import {buildSkinnedSeamFixture} from '../scripts/pro-studio-pass17-skinned-seam-fixture.mjs';
import {compareGlbTextures} from '../src/pro-studio/glb-texture-qa.js';
import {inspectRiggedGlb} from '../src/pro-studio/rigged-glb-audit.js';

const source=buildSkinnedSeamFixture();
const sha=buffer=>createHash('sha256').update(Buffer.from(buffer)).digest('hex');
const sourceSha=sha(source),first={kind:'face.regionExtrudeLinked',
 meshIndex:0,primitiveIndex:0,faces:[0,1],distance:.55,
 links:[{meshIndex:0,primitiveIndex:0,vertexA:1,vertexB:4},
        {meshIndex:0,primitiveIndex:0,vertexA:2,vertexB:5}]};
const move=(sourceVertex,delta)=>({kind:'vertex.moveLinkedCap',
 meshIndex:0,primitiveIndex:0,sourceVertex,delta});
const poke=face=>({kind:'face.pokeLinkedCap',meshIndex:0,
 primitiveIndex:0,sourceFace:face});
const sequence=[first,move(1,[.15,.02,.03]),move(2,[-.08,.04,0])];
function getRows(bytes,index){
 const parsed=parseGlb(bytes),doc=parsed.json,a=doc.accessors[index],
  v=doc.bufferViews[a.bufferView],
  n={SCALAR:1,VEC2:2,VEC3:3,VEC4:4}[a.type],
  width=a.componentType===5123?2:a.componentType===5121?1:4,
  getter={5121:'getUint8',5123:'getUint16',5125:'getUint32',
   5126:'getFloat32'}[a.componentType],
  binary=parsed.chunks.find(x=>x.type===0x004e4942).data,
  dv=new DataView(binary.buffer,binary.byteOffset,binary.byteLength),
  start=(v.byteOffset||0)+(a.byteOffset||0),stride=v.byteStride??n*width;
 return Array.from({length:a.count},(_,i)=>Array.from({length:n},
  (_,k)=>dv[getter](start+i*stride+k*width,true)));
}
const rows=(bytes,semantic)=>{
 const prim=parseGlb(bytes).json.meshes[0].primitives[0];
 return getRows(bytes,prim.attributes[semantic]);
};
function snapshot(bytes,ops){
 return buildMeshDataSnapshot({sourceGLB:source,editedGLB:bytes,
  sourceSha256:sourceSha,operations:ops});
}

test('real cap poke splits one face into three, preserves walls and source indexed rows',()=>{
 const extruded=applyMeshOperations(source,sequence);
 const edited=applyMeshOperations(source,[...sequence,poke(0)]);
 const before=parseGlb(extruded).json,after=parseGlb(edited).json;
 const idxBefore=getRows(extruded,before.meshes[0].primitives[0].indices).flat();
 const idxAfter=getRows(edited,after.meshes[0].primitives[0].indices).flat();
 assert.equal(getMeshEditStats(extruded).triangleCount,10);
 assert.equal(getMeshEditStats(edited).triangleCount,12);
 assert.equal(rows(extruded,'POSITION').length,28);
 assert.equal(rows(edited,'POSITION').length,29);
 assert.deepEqual(idxAfter.slice(0,3),[6,7,28]);
 assert.deepEqual(idxAfter.slice(3,30),idxBefore.slice(3));
 assert.deepEqual(idxAfter.slice(-6),[7,8,28,8,6,28]);
 for(const semantic of ['POSITION','NORMAL','TEXCOORD_0','TEXCOORD_1',
  'JOINTS_0','WEIGHTS_0'])
  assert.deepEqual(rows(edited,semantic).slice(0,28),
   rows(extruded,semantic),'Existing '+semantic+' rows must never change');
 const pos=rows(edited,'POSITION');
 for(let k=0;k<3;k++)
  assert.ok(Math.abs(pos[28][k]-(pos[6][k]+pos[7][k]+pos[8][k])/3)<1e-6);
 for(const uv of ['TEXCOORD_0','TEXCOORD_1']){
  const data=rows(edited,uv);
  for(let k=0;k<2;k++)
   assert.ok(Math.abs(data[28][k]-
    (data[6][k]+data[7][k]+data[8][k])/3)<1e-6);
 }
 const weights=rows(edited,'WEIGHTS_0')[28];
 assert.ok(Math.abs(weights.reduce((a,b)=>a+b,0)-1)<1e-6);
 assert.ok(weights.every(x=>x>=0));
 const joints=rows(edited,'JOINTS_0')[28];
 assert.equal(joints.length,4);
 for(const targetIndex of [0,1]){
  const m1=getRows(extruded,before.meshes[0].primitives[0]
   .targets[targetIndex].POSITION);
  const m2=getRows(edited,after.meshes[0].primitives[0]
   .targets[targetIndex].POSITION);
  assert.deepEqual(m2.slice(0,28),m1);
  for(let k=0;k<3;k++)
   assert.ok(Math.abs(m2[28][k]-
    (m1[6][k]+m1[7][k]+m1[8][k])/3)<1e-6);
 }
 assert.deepEqual(after.animations,before.animations);
 assert.deepEqual(after.materials,before.materials);
 assert.deepEqual(after.skins,before.skins);
 assert.equal(compareGlbTextures(source,edited).status,'pass_supported_png');
 const rig=inspectRiggedGlb(edited);
 assert.equal(rig.skins[0].joints,70);
 assert.equal(rig.animations.length,3);
 assert.equal(rig.morphs[0].targets,2);
 assert.equal(sha(source),sourceSha);
});

test('halfedge topology remap retains surviving IDs, marks invalidated corners and new faces',()=>{
 const before=snapshot(applyMeshOperations(source,sequence),sequence);
 const after=snapshot(applyMeshOperations(source,[...sequence,poke(0)]),
  [...sequence,poke(0)]);
 assert.equal(before.diagnostics.triangleCount,10);
 assert.equal(after.diagnostics.triangleCount,12);
 assert.equal(after.diagnostics.cornerCount,36);
 assert.equal(after.diagnostics.halfedgeCount,36);
 assert.equal(after.diagnostics.boundaryEdges,4);
 assert.equal(after.diagnostics.nonManifoldEdges,0);
 assert.equal(after.diagnostics.windingConflicts,0);
 assert.equal(after.diagnostics.capPokeCount,1);
 assert.equal(after.diagnostics.createdLogicalVertices,1);
 assert.deepEqual(after.uvSets,['TEXCOORD_0','TEXCOORD_1']);
 const remap=after.topologyRemap;
 assert.ok(remap?.originalFaceId);
 assert.equal(remap.centerAttributeVertex,28);
 assert.equal(remap.createdFaceIds.length,2);
 assert.equal(remap.retainedCornerIds.length,2);
 assert.ok(before.faces.some(f=>f.id===remap.originalFaceId));
 assert.ok(after.faces.some(f=>f.id===remap.originalFaceId));
 assert.ok(remap.createdFaceIds.every(id=>after.faces.some(f=>f.id===id)));
 assert.ok(remap.retainedCornerIds.every(id=>before.corners.some(c=>c.id===id)&&
  after.corners.some(c=>c.id===id)));
 assert.ok(remap.invalidatedCornerIds.every(id=>
  before.corners.some(c=>c.id===id)&&!after.corners.some(c=>c.id===id)));
 assert.ok(remap.invalidatedHalfedgeIds.every(id=>
  before.halfedges.some(h=>h.id===id)&&
  !after.halfedges.some(h=>h.id===id)));
 const survivors=before.faces.filter(x=>x.id!==remap.originalFaceId);
 assert.ok(survivors.every(f=>after.faces.some(x=>x.id===f.id)));
 const halfEdges=new Map(after.halfedges.map(x=>[x.id,x]));
 for(const h of halfEdges.values()){
  assert.ok(halfEdges.has(h.next));assert.ok(halfEdges.has(h.prev));
  if(h.twin)assert.equal(halfEdges.get(h.twin)?.twin,h.id);
 }
 assert.equal(after.capMap.length,6);
 assert.deepEqual(after.capMap,before.capMap);
});

test('native .markscene retains final typed Poke and deterministic GLB with 2 UV sets',async()=>{
 const ops=[...sequence,poke(1)];
 const native=await createPreviewMarkscene(source,{
  projectId:'mark-pass19-poke',edits:{meshSeamLinks:[],meshOperations:ops}
 });
 const reopened=await openPreviewMarkscene(native.archive);
 assert.deepEqual(reopened.sourceGLB,source);
 assert.deepEqual(reopened.edits.meshOperations,ops);
 const exported=await exportEditedSourceGlb(reopened);
 const expected=applyMeshOperations(source,ops);
 assert.deepEqual(exported.glb,expected);
 assert.deepEqual((await exportEditedSourceGlb(await openPreviewMarkscene(
  native.archive))).glb,expected);
 assert.equal(snapshot(exported.glb,ops).topologyRemap.sourceFace,1);
});

test('reject unapproved, unsupported, duplicated, stale or wrongly sequenced cap Poke',async()=>{
 const bad=[
  [poke(0)],
  [first,poke(77)],
  [first,poke(0),move(1,[.1,0,0])],
  [first,poke(0),poke(0)],
  [first,{...poke(0),payload:'unexpected'}],
  [first,move(1,[.1,0,0]),{...poke(0),sourceFace:-1}]
 ];
 for(const ops of bad)assert.throws(()=>
  applyMeshOperations(source,ops),/MARK_MESH_/);
 await assert.rejects(()=>createPreviewMarkscene(source,{
  edits:{meshOperations:[first,{...poke(0),extra:'not-allowed'}]}}),
 /MARK_SCENE3_MESH_EDIT_FIELDS/);
 await assert.rejects(()=>createPreviewMarkscene(source,{
  edits:{meshOperations:[first,poke(1),move(1,[.1,0,0])]}}),
 /MARK_SCENE3_MESH_LINKED_SEQUENCE/);
});

test('AI Bridge Poke stable face ID, Undo/Redo, forged ID rejection and native reopen',async()=>{
 const bridge=createAiBridge({allowWrites:true,buildHash:'pass19'});
 let i=0;
 const req=async(method,params={})=>{
  const r=await bridge.request({requestId:'p19.'+(++i),method,params});
  assert.equal(r.ok,true,JSON.stringify(r.diagnostics));return r.result;
 };
 const caps=await req('studio.getCapabilities');
 assert.ok(caps.supported.includes('mesh.pokeLinkedCap'));
 const asset=await req('asset.upload',{type:'glb',name:'skin-seam.glb',data:source});
 await req('scene.open',{assetId:asset.assetId});
 for(const l of first.links)await req('mesh.linkSeam',{
  meshId:'gltf-mesh-0',vertexA:l.vertexA,vertexB:l.vertexB
 });
 await req('mesh.extrudeLinkedRegion',{meshId:'gltf-mesh-0',
  faces:first.faces,distance:first.distance});
 const current=await req('mesh.getMeshData',{meshId:'gltf-mesh-0',full:true});
 const target=current.faces.find(f=>f.id.endsWith('cap-face-0'));
 assert.ok(target?.id);
 const bad=await bridge.request({requestId:'p19.badface',
  method:'mesh.pokeLinkedCap',
  params:{meshId:'gltf-mesh-0',capFaceId:target.id+'-fake'}});
 assert.equal(bad.ok,false);
 assert.ok(JSON.stringify(bad.diagnostics).includes('POKE_STABLE_FACE'));
 await req('mesh.pokeLinkedCap',{meshId:'gltf-mesh-0',capFaceId:target.id});
 const state=await req('mesh.getMeshData',{meshId:'gltf-mesh-0',full:true});
 assert.equal(state.diagnostics.triangleCount,12);
 assert.equal(state.topologyRemap.originalFaceId,target.id);
 const exported=await req('scene.export'),saved=await req('scene.save');
 const native=await openPreviewMarkscene(saved.data);
 assert.equal(native.edits.meshOperations[1].kind,'face.pokeLinkedCap');
 assert.deepEqual((await exportEditedSourceGlb(native)).glb,exported.data);
 const invalidMove=await bridge.request({requestId:'p19.no-future',
  method:'mesh.moveLinkedCap',params:{
   meshId:'gltf-mesh-0',capStableId:current.capMap[0].stableCapAttributeId,
   delta:[.1,0,0]}});
 assert.equal(invalidMove.ok,false);
 await req('history.undo');
 assert.equal((await req('mesh.getStats',{meshId:'gltf-mesh-0'}))
  .triangleCount,10);
 await req('history.redo');
 assert.deepEqual((await req('scene.export')).data,exported.data);
 const second=createAiBridge({allowWrites:true});
 let count=0;
 const call=async(method,params={})=>{
  const r=await second.request({requestId:'reopen.'+(++count),method,params});
  assert.equal(r.ok,true,JSON.stringify(r.diagnostics));return r.result;
 };
 const artifact=await call('asset.upload',{type:'markscene',
  name:'p19.markscene',data:saved.data});
 await call('scene.open',{assetId:artifact.assetId});
 assert.deepEqual((await call('scene.export')).data,exported.data);
 assert.deepEqual((await call('mesh.getMeshData',{meshId:'gltf-mesh-0'}))
  .topologyRemap,state.topologyRemap);
});
