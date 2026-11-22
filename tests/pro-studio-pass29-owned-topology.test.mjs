import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {parseGlb,writeGlb} from '../src/glb.js';
import {buildSkinnedSeamFixture}
 from '../scripts/pro-studio-pass17-skinned-seam-fixture.mjs';
import {buildOwnedTopologyBinary,verifyOwnedTopologyBinary,
 previewOwnedTopology,edgeID,ownedTopologyAnnotations}
 from '../src/pro-studio/owned-topology-binary.js';
import {createPreviewMarkscene,openPreviewMarkscene,
 exportEditedSourceGlb} from '../src/pro-studio/markscene-v3-preview.js';
import {createAiBridge} from '../src/pro-studio/ai-bridge-core.js';
import {inspectRiggedGlb} from '../src/pro-studio/rigged-glb-audit.js';
const source=buildSkinnedSeamFixture(),
 sha=x=>createHash('sha256').update(Buffer.from(x)).digest('hex'),
 sourceSha=sha(source);
function sharedIndexed(){
 const p=parseGlb(source),json=p.json,
  prim=json.meshes[0].primitives[0],
  acc=json.accessors[prim.indices],view=json.bufferViews[acc.bufferView],
  original=p.chunks.find(c=>c.type===0x004e4942),
  binary=original.data.slice(),
  dv=new DataView(binary.buffer,binary.byteOffset,binary.byteLength),
  size={5121:1,5123:2,5125:4}[acc.componentType],
  write={5121:'setUint8',5123:'setUint16',
   5125:'setUint32'}[acc.componentType],
  start=(view.byteOffset||0)+(acc.byteOffset||0);
 for(const [i,vertex] of [1,3,2].entries())
  dv[write](start+(i+3)*size,vertex,true);
 return writeGlb({...p,chunks:p.chunks.map(c=>
  c.type===0x004e4942?{...c,data:binary}:c)},json);
}
const sourceShared=sharedIndexed(),sharedSha=sha(sourceShared);
const marker=(binary,sha256,a,b,flag,enabled=true)=>({
 kind:'mesh.topologySetEdgeFlag',meshIndex:0,primitiveIndex:0,
 edgeId:edgeID(sha256,0,0,a,b),flag,enabled
});
const owned=(g=source,operations=[])=>buildOwnedTopologyBinary({
 sourceGLB:g,sourceSha256:sha(g),operations
});
const graph=(g=source,operations=[])=>previewOwnedTopology({
 sourceGLB:g,sourceSha256:sha(g),data:owned(g,operations)
});
const rigCheck=glb=>{
 const a=parseGlb(source).json,b=parseGlb(glb).json;
 for(const section of ['skins','animations','materials','images','textures'])
  assert.deepEqual(b[section],a[section]);
 const audit=inspectRiggedGlb(glb);
 assert.equal(audit.skins[0].joints,70);
 assert.equal(audit.morphs[0].targets,2);
 assert.equal(audit.animations.length,3);
};
test('exact independently serialized topology has stable source vertices, faces, halfedges and boundary IDs',()=>{
 const bytes=owned(),second=owned();
 assert.deepEqual(bytes,second);
 assert.equal(Buffer.from(bytes.slice(0,8)).toString(),'MARKTOP1');
 assert.equal(new DataView(bytes.buffer).getUint32(8,true),1);
 const g=graph();
 assert.equal(g.persistedVertexEdgeFaceHalfedge,true);
 assert.equal(g.schema,'mark.owned-topology/1');
 assert.equal(g.diagnostics.vertexCount,6);
 assert.equal(g.diagnostics.faceCount,2);
 assert.equal(g.diagnostics.edgeCount,6);
 assert.equal(g.diagnostics.halfedgeCount,6);
 assert.equal(g.diagnostics.boundaryEdges,6);
 assert.equal(g.diagnostics.interiorEdges,0);
 assert.equal(g.halfedges[0].twin,null);
 assert.equal(g.vertices[0].id,'mark-attr-'+sourceSha+'-m0-p0-v0');
 assert.equal(g.faces[0].id,'mark-face-'+sourceSha+'-m0-p0-source-face-0');
 assert.ok(g.faces[0].cornerIds[0].includes(g.faces[0].id));
 assert.equal(g.edges[0].sourceRows.length,2);
 assert.ok(g.edges.every(e=>e.id.startsWith('mark-topo-edge-'+sourceSha)));
 assert.deepEqual(verifyOwnedTopologyBinary({
  sourceGLB:source,sourceSha256:sourceSha,data:bytes}).data,bytes);
});
test('a genuine indexed interior edge has reciprocal halfedge twins, sorted stable edge identity',()=>{
 const g=graph(sourceShared),interior=g.edges.filter(e=>!e.boundary);
 assert.equal(g.diagnostics.vertexCount,6);
 assert.equal(g.diagnostics.edgeCount,5);
 assert.equal(g.diagnostics.interiorEdges,1);
 assert.equal(g.diagnostics.boundaryEdges,4);
 assert.equal(interior.length,1);
 assert.equal(interior[0].id,edgeID(sharedSha,0,0,1,2));
 assert.deepEqual(interior[0].sourceRows,[1,2]);
 const halfedges=interior[0].halfedgeIds.map(id=>
  g.halfedges.find(h=>h.id===id));
 assert.equal(halfedges.length,2);
 assert.equal(halfedges[0].twin,halfedges[1].id);
 assert.equal(halfedges[1].twin,halfedges[0].id);
 assert.equal(halfedges[0].origin,halfedges[1].destination);
 assert.equal(halfedges[0].destination,halfedges[1].origin);
 assert.equal(g.faces[0].id.replace(sharedSha,sourceSha),
  graph(source).faces[0].id);
});
test('real native seam/sharp edit persists only edge flags, preserves all topology IDs and has honest glTF metadata',async()=>{
 const seam=marker(null,sharedSha,1,2,'seam'),
  sharp=marker(null,sharedSha,1,2,'sharp'),
  unmark=marker(null,sharedSha,1,2,'seam',false),
  initial=graph(sourceShared),
  selected=graph(sourceShared,[seam,sharp]),
  cleared=graph(sourceShared,[seam,sharp,unmark]);
 assert.deepEqual(selected.vertices,initial.vertices);
 assert.deepEqual(selected.faces,initial.faces);
 assert.deepEqual(selected.halfedges,initial.halfedges);
 assert.deepEqual(selected.edges.map(x=>x.id),
  initial.edges.map(x=>x.id));
 const changed=selected.edges.find(x=>x.sourceRows.join(',')==='1,2');
 assert.ok(changed.seam&&changed.sharp);
 assert.equal(selected.diagnostics.markedSeams,1);
 assert.equal(selected.diagnostics.markedSharpEdges,1);
 assert.equal(cleared.diagnostics.markedSeams,0);
 assert.equal(cleared.diagnostics.markedSharpEdges,1);
 assert.equal(initial.diagnostics.markedSeams,0);
 const a=owned(sourceShared,[seam,sharp]);
 assert.notDeepEqual(a,owned(sourceShared));
 const annotations=ownedTopologyAnnotations({
  sourceGLB:sourceShared,sourceSha256:sharedSha,data:a
 });
 assert.equal(annotations.edges.length,1);
 assert.equal(annotations.edges[0].id,changed.id);
 const project=await createPreviewMarkscene(sourceShared,{
  projectId:'pass29-owned-topology',edits:{
   meshDataOperations:[],meshTopologyOperations:[seam,sharp]}
 });
 const opened=await openPreviewMarkscene(project.archive);
 assert.equal(opened.manifest.assetManifest.length,3);
 assert.equal(opened.manifest.ownedTopologyResource.schema,'mark.owned-topology/1');
 assert.equal(opened.manifest.ownedTopologyResource.sha256,sha(opened.ownedTopologyBinary));
 assert.deepEqual(opened.sourceGLB,sourceShared);
 assert.deepEqual(opened.ownedTopologyBinary,a);
 assert.deepEqual(opened.edits.meshTopologyOperations,[seam,sharp]);
 const exported=(await exportEditedSourceGlb(opened)).glb;
 const doc=parseGlb(exported).json,
  extra=doc.meshes[0].primitives[0].extras?.MARK_topologyAnnotations;
 assert.deepEqual(extra,annotations);
 assert.deepEqual(doc.meshes[0].primitives[0].attributes,
  parseGlb(sourceShared).json.meshes[0].primitives[0].attributes);
 rigCheck(exported);
 const repeated=await createPreviewMarkscene(sourceShared,{
  projectId:'pass29-owned-topology',edits:opened.edits
 });
 assert.deepEqual(repeated.archive,project.archive);
 assert.deepEqual((await exportEditedSourceGlb(
  await openPreviewMarkscene(repeated.archive))).glb,exported);
});
test('old 2/3 file native projects remain readable, 4-file topology resource tampering rejected',async()=>{
 const old=await createPreviewMarkscene(source,{
  projectId:'pass29-original-glb',edits:{}
 }),oldOpened=await openPreviewMarkscene(old.archive);
 assert.equal(oldOpened.ownedTopologyBinary,undefined);
 assert.equal(oldOpened.manifest.assetManifest.length,1);
 const p28=await createPreviewMarkscene(source,{
  projectId:'pass29-p28',edits:{meshDataOperations:[]}
 }),p28Opened=await openPreviewMarkscene(p28.archive);
 assert.equal(p28Opened.manifest.assetManifest.length,2);
 assert.equal(p28Opened.ownedTopologyBinary,undefined);
 const seam=marker(null,sourceSha,0,1,'seam'),
  created=await createPreviewMarkscene(source,{
   projectId:'pass29-tamper',edits:{
    meshDataOperations:[],meshTopologyOperations:[seam]}
  });
 const damaged=created.archive.slice(),
  position=Buffer.from(damaged).indexOf(Buffer.from('MARKTOP1'));
 assert.ok(position>0);
 damaged[position+113]^=1;
 await assert.rejects(()=>openPreviewMarkscene(damaged),
  /MARK_SCENE3_ZIP_CRC|MARK_SCENE3_TOPOLOGY_SHA/);
 const topo=owned(source,[seam]),forged=topo.slice();
 const offset=96+6*12+16;
 new DataView(forged.buffer).setUint32(offset,8,true);
 assert.throws(()=>verifyOwnedTopologyBinary({
  sourceGLB:source,sourceSha256:sourceSha,data:forged
 }),/MARK_TOPO_SOURCE_REPLAY|MARK_TOPO_EDGE_FLAGS/);
 assert.throws(()=>verifyOwnedTopologyBinary({
  sourceGLB:source,sourceSha256:'0'.repeat(64),data:topo
 }),/MARK_TOPO_SOURCE_SHA/);
 assert.throws(()=>verifyOwnedTopologyBinary({
  sourceGLB:source,sourceSha256:sourceSha,
  data:topo.slice(0,topo.length-4)
 }),/MARK_TOPO_SHAPE/);
});
test('bad/stale edge references, unknown flags/fields and unsupported nonmanifold source fail closed',()=>{
 const bad=[
  {...marker(null,sourceSha,0,1,'seam'),edgeId:'forged'},
  {...marker(null,sourceSha,0,1,'seam'),flag:'edgeDelete'},
  {...marker(null,sourceSha,0,1,'sharp'),enabled:'true'},
  {...marker(null,sourceSha,0,1,'sharp'),code:'eval'}
 ];
 for(const op of bad)assert.throws(()=>owned(source,[op]),/MARK_TOPO_/);
 assert.throws(()=>owned(source,Array.from({length:33},()=>marker(
  null,sourceSha,0,1,'sharp'))),/MARK_TOPO_OPS/);
 // A second incident edge with matching source endpoints but the same
 // winding is a structural error; no silent auto-correction.
 const parsed=parseGlb(sourceShared),doc=parsed.json,
  acc=doc.accessors[doc.meshes[0].primitives[0].indices],
  view=doc.bufferViews[acc.bufferView],
  bin=parsed.chunks.find(c=>c.type===0x004e4942).data.slice(),
  dv=new DataView(bin.buffer,bin.byteOffset,bin.byteLength),
  start=(view.byteOffset||0)+(acc.byteOffset||0),
  size={5121:1,5123:2,5125:4}[acc.componentType],
  set={5121:'setUint8',5123:'setUint16',5125:'setUint32'}[acc.componentType];
 for(const [i,n] of [2,3,1].entries())dv[set](start+(i+3)*size,n,true);
 const wrong=writeGlb({...parsed,chunks:parsed.chunks.map(x=>
  x.type===0x004e4942?{...x,data:bin}:x)},doc);
 assert.throws(()=>owned(wrong),/MARK_TOPO_WINDING/);
});
test('Bridge owned topology via write grant persists edge IDs, GLB extras, native and Undo/Redo',async()=>{
 const bridge=createAiBridge({allowWrites:true,buildHash:'pass29'});
 let n=0;const call=async(method,params={})=>{
  const result=await bridge.request({requestId:'p29.'+(++n),method,params});
  assert.equal(result.ok,true,JSON.stringify(result.diagnostics));
  return result.result;
 };
 const capabilities=await call('studio.getCapabilities');
 for(const name of ['meshdata.ownedTopologyBegin','meshdata.getOwnedTopology',
  'meshdata.setOwnedEdgeFlag'])
  assert.ok(capabilities.supported.includes(name));
 const upload=await call('asset.upload',{
  type:'glb',name:'pass29-70-joints.glb',data:sourceShared
 });
 await call('scene.open',{assetId:upload.assetId});
 assert.equal((await call('meshdata.getOwnedTopology',{
  meshId:'gltf-mesh-0'})).enabled,false);
 await call('meshdata.begin',{meshId:'gltf-mesh-0',primitiveIndex:0});
 await call('meshdata.ownedTopologyBegin',{
  meshId:'gltf-mesh-0',primitiveIndex:0
 });
 const g=await call('meshdata.getOwnedTopology',{
  meshId:'gltf-mesh-0',primitiveIndex:0,full:true
 });
 assert.equal(g.enabled,true);
 assert.equal(g.diagnostics.interiorEdges,1);
 const selected=g.edges.find(x=>!x.boundary);
 const forged=await bridge.request({
  requestId:'p29.bad',method:'meshdata.setOwnedEdgeFlag',params:{
   meshId:'gltf-mesh-0',primitiveIndex:0,edgeId:selected.id+'-bad',
   flag:'seam',enabled:true}});
 assert.equal(forged.ok,false);
 assert.ok(JSON.stringify(forged.diagnostics).includes('TOPO_EDGE_STALE'));
 await call('meshdata.setOwnedEdgeFlag',{
  meshId:'gltf-mesh-0',primitiveIndex:0,edgeId:selected.id,
  flag:'seam',enabled:true
 });
 await call('meshdata.setOwnedEdgeFlag',{
  meshId:'gltf-mesh-0',primitiveIndex:0,edgeId:selected.id,
  flag:'sharp',enabled:true
 });
 const current=await call('meshdata.getOwnedTopology',{
  meshId:'gltf-mesh-0',full:true});
 assert.equal(current.operationCount,2);
 assert.equal(current.edges.filter(e=>e.seam&&e.sharp).length,1);
 assert.deepEqual(current.faces,g.faces);
 assert.deepEqual(current.halfedges,g.halfedges);
 const saved=await call('scene.save'),exp=await call('scene.export');
 const opened=await openPreviewMarkscene(saved.data);
 assert.equal(opened.manifest.assetManifest.length,3);
 assert.equal(sha(opened.ownedTopologyBinary),
  opened.manifest.ownedTopologyResource.sha256);
 assert.deepEqual((await exportEditedSourceGlb(opened)).glb,exp.data);
 const exported=parseGlb(exp.data).json;
 assert.equal(exported.meshes[0].primitives[0].extras
  .MARK_topologyAnnotations.edges.length,1);
 rigCheck(exp.data);
 await call('history.undo');
 assert.equal((await call('meshdata.getOwnedTopology',{
  meshId:'gltf-mesh-0'})).diagnostics.markedSharpEdges,0);
 await call('history.redo');
 assert.deepEqual((await call('scene.export')).data,exp.data);
 const clone=createAiBridge({allowWrites:true});let z=0;
 const ask=async(method,params={})=>{
  const r=await clone.request({requestId:'reopen.'+(++z),method,params});
  assert.equal(r.ok,true,JSON.stringify(r.diagnostics));return r.result;
 };
 const native=await ask('asset.upload',{
  type:'markscene',name:'pass29.markscene',data:saved.data
 });
 await ask('scene.open',{assetId:native.assetId});
 assert.deepEqual((await ask('scene.export')).data,exp.data);
 assert.equal((await ask('meshdata.getOwnedTopology',{
  meshId:'gltf-mesh-0'})).diagnostics.markedSeams,1);
});
