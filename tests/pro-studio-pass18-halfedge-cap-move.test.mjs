import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {parseGlb} from '../src/glb.js';
import {applyMeshOperations} from '../src/pro-studio/mesh-edit-core.js';
import {inspectConsumedSeamExtrude}
 from '../src/pro-studio/mesh-seam-identity.js';
import {buildMeshDataSnapshot}
 from '../src/pro-studio/meshdata-halfedge-preview.js';
import {createPreviewMarkscene,openPreviewMarkscene,exportEditedSourceGlb}
 from '../src/pro-studio/markscene-v3-preview.js';
import {createAiBridge} from '../src/pro-studio/ai-bridge-core.js';
import {buildSkinnedSeamFixture}
 from '../scripts/pro-studio-pass17-skinned-seam-fixture.mjs';
import {compareGlbTextures} from '../src/pro-studio/glb-texture-qa.js';
import {inspectRiggedGlb} from '../src/pro-studio/rigged-glb-audit.js';
const original=buildSkinnedSeamFixture();
const sourceHash=createHash('sha256').update(original).digest('hex');
const first={
 kind:'face.regionExtrudeLinked',meshIndex:0,primitiveIndex:0,
 faces:[0,1],distance:.5,links:[
 {meshIndex:0,primitiveIndex:0,vertexA:1,vertexB:4},
 {meshIndex:0,primitiveIndex:0,vertexA:2,vertexB:5}
 ]};
const move=(sourceVertex,delta)=>({
 kind:'vertex.moveLinkedCap',meshIndex:0,primitiveIndex:0,
 sourceVertex,delta
});
function rows(bytes,semantic){
 const parsed=parseGlb(bytes),doc=parsed.json,
  primitive=doc.meshes[0].primitives[0],
  accessor=doc.accessors[primitive.attributes[semantic]],
  view=doc.bufferViews[accessor.bufferView],
  count={VEC2:2,VEC3:3,VEC4:4}[accessor.type],
  width=accessor.componentType===5123?2:4,
  getter=accessor.componentType===5123?'getUint16':'getFloat32',
  dv=new DataView(parsed.chunks.find(c=>c.type===0x004e4942).data.buffer);
 const offset=(view.byteOffset||0)+(accessor.byteOffset||0);
 return Array.from({length:accessor.count},(_,i)=>
  Array.from({length:count},(_,j)=>dv[getter](offset+i*(view.byteStride??count*width)+
   j*width,true)));
}

test('MeshData halfedges carry true independent face-corner UV/skin/morph arrays',()=>{
 const edited=applyMeshOperations(original,[first]);
 const mesh=buildMeshDataSnapshot({sourceGLB:original,editedGLB:edited,
  sourceSha256:sourceHash,operations:[first]});
 assert.equal(mesh.schema,'mark.meshdata-halfedge-preview/1');
 assert.equal(mesh.diagnostics.triangleCount,10);
 assert.equal(mesh.diagnostics.cornerCount,30);
 assert.equal(mesh.diagnostics.halfedgeCount,30);
 assert.equal(mesh.diagnostics.capAttributeRows,6);
 assert.equal(mesh.diagnostics.nonManifoldEdges,0);
 assert.equal(mesh.diagnostics.windingConflicts,0);
 assert.equal(mesh.diagnostics.boundaryEdges,4,
  '4 open bottom edges are expected; cap/sidewall edges must be adjacent');
 assert.deepEqual(mesh.uvSets,['TEXCOORD_0','TEXCOORD_1']);
 assert.equal(mesh.materialSlots.length,1);
 assert.ok(mesh.faces.every(f=>f.cornerIds.length===3&&
  f.topology==='TRIANGLE'&&f.holes.length===0));
 const cornerIds=new Set(mesh.corners.map(c=>c.id));
 const hids=new Set(mesh.halfedges.map(h=>h.id));
 for(const face of mesh.faces)for(const cornerId of face.cornerIds)
  assert.ok(cornerIds.has(cornerId));
 for(const edge of mesh.halfedges){
  assert.ok(hids.has(edge.next));assert.ok(hids.has(edge.prev));
  if(edge.twin)assert.ok(hids.has(edge.twin));
 }
 const cap1=mesh.corners.find(c=>c.attributeVertex===7);
 const cap4=mesh.corners.find(c=>c.attributeVertex===10);
 assert.ok(cap1&&cap4);
 assert.equal(cap1.logicalVertexId,cap4.logicalVertexId,
  'Approved seam corners must map to SAME logical cap vertex');
 assert.notDeepEqual(cap1.attributes.uvSets.TEXCOORD_0,
  cap4.attributes.uvSets.TEXCOORD_0);
 assert.notDeepEqual(cap1.attributes.uvSets.TEXCOORD_1,
  cap4.attributes.uvSets.TEXCOORD_1);
 assert.deepEqual(cap1.attributes.jointSets.JOINTS_0,
  cap4.attributes.jointSets.JOINTS_0);
 assert.equal(cap1.attributes.morphs.length,2);
 assert.ok(mesh.mappedWalls.some(w=>w.logicalVertices
  .includes(cap1.logicalVertexId)));
});

test('two sequential cap moves preserve split cap pairs and ALL attached top wall corners',()=>{
 const originalHash=sourceHash,
  afterExtrude=applyMeshOperations(original,[first]);
 const before=rows(afterExtrude,'POSITION'),
  beforeUvs=rows(afterExtrude,'TEXCOORD_0');
 const ops=[first,move(1,[.12,0,.04]),move(2,[-.07,.035,.01])];
 const final=applyMeshOperations(original,ops),
  after=rows(final,'POSITION');
 for(const [a,b,delta] of [[7,10,[.12,0,.04]],[8,11,[-.07,.035,.01]]]){
  for(const index of [a,b])
   for(let k=0;k<3;k++)
    assert.ok(Math.abs(after[index][k]-before[index][k]-delta[k])<1e-5);
  assert.deepEqual(after[a],after[b],
   'Confirmed logical seam corners remain position-coincident after all moves');
 }
 for(let i=0;i<6;i++)assert.deepEqual(after[i],before[i]);
 for(let i=12;i<28;i++){
  const slot=(i-12)%4;
  if(slot<2){assert.deepEqual(after[i],before[i]);continue;}
  const matched=[7,8,10,11,6,9].filter(v=>
   before[v].every((n,k)=>Math.abs(n-before[i][k])<1e-6));
  assert.ok(matched.length>=1);
  assert.ok(matched.some(v=>after[v].every((n,k)=>
   Math.abs(n-after[i][k])<1e-6)),
  'Top wall corner detached from moved cap vertex');
 }
 assert.deepEqual(rows(final,'TEXCOORD_0'),beforeUvs);
 assert.deepEqual(rows(final,'TEXCOORD_1'),rows(afterExtrude,'TEXCOORD_1'));
 assert.deepEqual(rows(final,'JOINTS_0'),rows(afterExtrude,'JOINTS_0'));
 assert.deepEqual(rows(final,'WEIGHTS_0'),rows(afterExtrude,'WEIGHTS_0'));
 assert.deepEqual(parseGlb(final).json.animations,parseGlb(original).json.animations);
 assert.equal(compareGlbTextures(original,final).status,'pass_supported_png');
 const audit=inspectRiggedGlb(final);
 assert.equal(audit.skins[0].joints,70);
 assert.equal(audit.animations.length,3);
 assert.equal(audit.morphs[0].targets,2);
 assert.equal(createHash('sha256').update(original).digest('hex'),originalHash);
 const halfedge=buildMeshDataSnapshot({sourceGLB:original,editedGLB:final,
  sourceSha256:sourceHash,operations:ops});
 assert.equal(halfedge.diagnostics.boundaryEdges,4);
 assert.equal(halfedge.diagnostics.nonManifoldEdges,0);
 assert.equal(halfedge.diagnostics.linkedCapMoveCount,2);
});

test('source-scoped vertex/face/halfedge ID sets remain stable across supported moves',()=>{
 const baseline=buildMeshDataSnapshot({sourceGLB:original,
  editedGLB:applyMeshOperations(original,[first]),
  sourceSha256:sourceHash,operations:[first]});
 const moved=buildMeshDataSnapshot({sourceGLB:original,
  editedGLB:applyMeshOperations(original,[first,move(1,[.1,0,0])]),
  sourceSha256:sourceHash,operations:[first,move(1,[.1,0,0])]});
 for(const key of ['faces','edges','halfedges','corners'])
  assert.deepEqual(baseline[key].map(x=>x.id),
   moved[key].map(x=>x.id),'ID remap changed stable '+key);
 assert.deepEqual(baseline.capMap,moved.capMap);
 assert.notDeepEqual(baseline.corners[1].attributes.position,
  moved.corners[1].attributes.position);
});

test('native project stores exact typed cap moves with source GLB unchanged',async()=>{
 const edits={meshSeamLinks:[],
  meshOperations:[first,move(1,[.1,0,.03]),move(2,[0,.07,0])]};
 const archive=await createPreviewMarkscene(original,{projectId:'p18-halfedge',edits});
 const reopened=await openPreviewMarkscene(archive.archive);
 assert.deepEqual(reopened.edits.meshOperations,edits.meshOperations);
 assert.deepEqual(reopened.sourceGLB,original);
 const out=await exportEditedSourceGlb(reopened);
 assert.deepEqual(out.glb,applyMeshOperations(original,edits.meshOperations));
 const twice=await exportEditedSourceGlb(await openPreviewMarkscene(archive.archive));
 assert.deepEqual(out.glb,twice.glb);
 assert.equal(buildMeshDataSnapshot({sourceGLB:original,editedGLB:twice.glb,
  sourceSha256:sourceHash,operations:edits.meshOperations})
  .diagnostics.boundaryEdges,4);
});

test('orphan, stale, unsafe, tampered and non-canonical cap move operations fail',async()=>{
 const invalid=[
  [move(1,[.1,0,0])],
  [first,move(4,[.1,0,0])], // noncanonical linked source ID
  [first,move(99,[.1,0,0])],
  [first,move(0,[0,0,0])],
  [first,move(0,[3,0,0])],
  [first,{...move(1,[.1,0,0]),unknown:'payload'}],
  [first,{kind:'vertex.move',meshIndex:0,primitiveIndex:0,
   vertex:7,delta:[.1,0,0]}],
  [first,move(1,[.1,0,0]),first]
 ];
 for(const sequence of invalid){
  assert.throws(()=>applyMeshOperations(original,sequence),
   /MARK_MESH_|MARK_SEAM_/);
 }
 await assert.rejects(()=>createPreviewMarkscene(original,{
  edits:{meshOperations:[first,move(1,[3,0,0])]}}),
  /MARK_SCENE3_MESH_CAP_MOVE/);
 await assert.rejects(()=>createPreviewMarkscene(original,{
  edits:{meshOperations:[first,{...move(1,[.1,0,0]),evil:1} ]}}),
  /MARK_SCENE3_MESH_EDIT_FIELDS/);
});

test('AI Bridge only moves verified stable cap ID, requires grant, Undo/Redo, full MeshData',async()=>{
 const bridge=createAiBridge({allowWrites:true,buildHash:'pass18-test'});
 let counter=0;
 const call=async(method,params={})=>{
  const reply=await bridge.request({requestId:'p18.'+(++counter),method,params});
  assert.equal(reply.ok,true,JSON.stringify(reply.diagnostics));return reply.result;
 };
 const caps=await call('studio.getCapabilities');
 assert.ok(caps.supported.includes('mesh.moveLinkedCap'));
 assert.ok(caps.supported.includes('mesh.getMeshData'));
 const asset=await call('asset.upload',{name:'skinned-seam.glb',
  type:'glb',data:original});
 await call('scene.open',{assetId:asset.assetId});
 await call('mesh.linkSeam',{meshId:'gltf-mesh-0',vertexA:1,vertexB:4});
 await call('mesh.linkSeam',{meshId:'gltf-mesh-0',vertexA:2,vertexB:5});
 await call('mesh.extrudeLinkedRegion',{meshId:'gltf-mesh-0',
  faces:[0,1],distance:.5});
 const consumed=await call('mesh.getLinkedRegion',{meshId:'gltf-mesh-0'});
 const key=consumed.capRemap.find(x=>x.sourceVertex===4).capStableId;
 const snap=await call('mesh.getMeshData',{meshId:'gltf-mesh-0'});
 assert.equal(snap.diagnostics.triangleCount,10);
 assert.equal(snap.diagnostics.boundaryEdges,4);
 const result=await call('mesh.moveLinkedCap',{
  meshId:'gltf-mesh-0',capStableId:key,delta:[.1,0,.03]});
 assert.equal(result.edits.meshOperations.length,2);
 const full=await call('mesh.getMeshData',{meshId:'gltf-mesh-0',full:true});
 assert.equal(full.halfedges.length,30);
 assert.equal(full.corners.length,30);
 assert.equal(full.diagnostics.linkedCapMoveCount,1);
 const after=await call('scene.export');
 const saved=await call('scene.save');
 assert.deepEqual((await openPreviewMarkscene(saved.data)).sourceGLB,original);
 const bad=await bridge.request({requestId:'p18.bad',method:'mesh.moveLinkedCap',
  params:{meshId:'gltf-mesh-0',capStableId:'mark-cap-forged',delta:[0,.1,0]}});
 assert.equal(bad.ok,false);
 assert.ok(JSON.stringify(bad.diagnostics).includes('CAP_STABLE_ID'));
 const previous=await call('history.undo');
 assert.equal(previous.undoDepth>=0,true);
 assert.equal(bridge.getSnapshot().edits.meshOperations.length,1);
 assert.equal((await call('mesh.getMeshData',{meshId:'gltf-mesh-0'}))
  .diagnostics.linkedCapMoveCount,0);
 const redone=await call('history.redo');
 assert.equal(redone.redoDepth>=0,true);
 assert.equal(bridge.getSnapshot().edits.meshOperations.length,2);
 assert.deepEqual((await call('scene.export')).data,after.data);
 const clone=createAiBridge({allowWrites:true});
 let i=0;
 const reopen=async(method,params={})=>{
  const r=await clone.request({requestId:'reopen.'+(++i),method,params});
  assert.equal(r.ok,true,JSON.stringify(r.diagnostics));return r.result;
 };
 const project=await reopen('asset.upload',{name:'p18.markscene',
  type:'markscene',data:saved.data});
 await reopen('scene.open',{assetId:project.assetId});
 assert.deepEqual((await reopen('scene.export')).data,after.data);
 assert.equal((await reopen('mesh.getMeshData',{meshId:'gltf-mesh-0'}))
  .diagnostics.linkedCapMoveCount,1);
});
