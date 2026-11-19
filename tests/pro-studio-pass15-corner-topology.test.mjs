import test from 'node:test';
import assert from 'node:assert/strict';
import {parseGlb,writeGlb} from '../src/glb.js';
import {buildCornerTopology,inspectGlbCornerTopology}
 from '../src/pro-studio/mesh-corner-topology.js';
import {analyzeIndexedFaceRegion} from '../src/pro-studio/topology-selection.js';
import {applyMeshOperations} from '../src/pro-studio/mesh-edit-core.js';
import {createPreviewMarkscene,openPreviewMarkscene,exportEditedSourceGlb}
 from '../src/pro-studio/markscene-v3-preview.js';
import {createAiBridge} from '../src/pro-studio/ai-bridge-core.js';
import {buildRiggedFixture} from '../scripts/pro-studio-glb-fixtures.mjs';

const positions=[
 [-1,-1,0],[1,-1,0],[-1,1,0],[1,1,0],[1,-1,0],[-1,1,0]
];
const triangles=[0,1,2,4,3,5]; // geometric shared edge 1:2, distinct attribute rows 4,5
const uv=[
 [0,0],[1,0],[0,1],[1,1],[.61,.1],[.12,.77]
];
const normals=positions.map(()=>[0,0,1]);

function glbWithSeam(){
 const chunks=[],bufferViews=[],accessors=[];
 let byteLength=0;
 const add=(rows,type,componentType,target)=>{
  const components=type==='SCALAR'?1:type==='VEC2'?2:3;
  const flat=rows.flat(),width=componentType===5123?2:4;
  const data=new Uint8Array(flat.length*width),view=new DataView(data.buffer);
  flat.forEach((v,i)=>componentType===5123?
   view.setUint16(i*width,v,true):view.setFloat32(i*width,v,true));
  const byteOffset=byteLength;
  bufferViews.push({buffer:0,byteOffset,byteLength:data.length,target});
  chunks.push(data);byteLength+=data.length;
  accessors.push({bufferView:bufferViews.length-1,
   componentType,type,count:rows.length});
  assert.equal(flat.length,components*rows.length);
  return accessors.length-1;
 };
 const POSITION=add(positions,'VEC3',5126,34962);
 const NORMAL=add(normals,'VEC3',5126,34962);
 const TEXCOORD_0=add(uv,'VEC2',5126,34962);
 const indices=add(triangles.map(i=>[i]),'SCALAR',5123,34963);
 const bin=new Uint8Array(byteLength);
 let offset=0;for(const chunk of chunks){bin.set(chunk,offset);offset+=chunk.length;}
 const doc={
  asset:{version:'2.0',generator:'MARK Pass15 seam regression fixture'},
  scene:0,scenes:[{nodes:[0]}],nodes:[{name:'SplitCornerQuad',mesh:0}],
  meshes:[{primitives:[{mode:4,attributes:{
   POSITION,NORMAL,TEXCOORD_0
  },indices}]}],buffers:[{byteLength}],bufferViews,accessors
 };
 return writeGlb({chunks:[{type:0x4e4f534a,data:new Uint8Array(0)},
  {type:0x004e4942,data:bin}]},doc);
}
const seamSource=glbWithSeam();

test('separate glTF attribute-vertex identity and exact-position geometric candidates',()=>{
 const analysis=buildCornerTopology({positions,indices:triangles,
  uvSets:{TEXCOORD_0:uv},normals});
 assert.deepEqual(analysis.attributeToGeometric,[0,1,2,3,1,2]);
 assert.equal(analysis.diagnostics.attributeVertexCount,6);
 assert.equal(analysis.diagnostics.geometricVertexCandidates,4);
 assert.equal(analysis.diagnostics.coincidentAttributeGroups,2);
 assert.equal(analysis.diagnostics.coincidentExtraAttributeRows,2);
 assert.equal(analysis.corners.length,6);
 assert.deepEqual(analysis.corners.map(c=>c.cornerId),[0,1,2,3,4,5]);
 assert.equal(analysis.diagnostics.geometricBoundaryEdges,4);
 assert.equal(analysis.diagnostics.splitIndexEdges,1);
 assert.equal(analysis.diagnostics.uvSeamEdges,1);
 assert.equal(analysis.diagnostics.indexedEdgeCount,6);
 assert.equal(analysis.diagnostics.geometricEdgeCandidates,5);
 const seam=analysis.edges.find(e=>e.uvSeamSets.length);
 assert.deepEqual(seam.geometricVertices,[1,2]);
 assert.deepEqual(seam.incidents.map(i=>i.face),[0,1]);
 assert.deepEqual(seam.uvSeamSets,['TEXCOORD_0']);
 assert.equal(seam.normalSplit,false);
 assert.equal(analysis.diagnostics.positionJoinIsAuthoritative,false);
 assert.equal(analysis.diagnostics.editsAllowedFromThisMap,false);
 // Existing INDEX-based RegionExtrude must still reject this seam!
 const old=analyzeIndexedFaceRegion({
  indices:triangles,vertexCount:6,faces:[0,1]
 });
 assert.equal(old.diagnostics.connectedComponents,2);
 assert.equal(old.diagnostics.validRegion,false);
});

test('seam-aware GLB inspection does not alter any POSITION, UV, BIN or material bytes',()=>{
 const before=seamSource.slice(),doc=parseGlb(before).json;
 const result=inspectGlbCornerTopology(seamSource,{meshIndex:0,primitiveIndex:0});
 assert.equal(result.diagnostics.uvSeamEdges,1);
 assert.equal(result.diagnostics.splitIndexEdges,1);
 assert.deepEqual(result.uvSets,['TEXCOORD_0']);
 assert.equal(result.sourcePreserved,true);
 assert.deepEqual(before,seamSource);
 assert.deepEqual(parseGlb(seamSource).json,doc);
 assert.throws(()=>applyMeshOperations(seamSource,[{
  kind:'face.regionExtrude',meshIndex:0,primitiveIndex:0,
  faces:[0,1],distance:.3
 }]),/MARK_MESH_REGION_DISCONNECTED/,
 'The new diagnostic must not silently weld seam-separated triangles');
});

test('coincident opposite shells are flagged as candidates, not silently welded',()=>{
 const duplicate=buildCornerTopology({
  positions:[...positions.slice(0,3),...positions.slice(0,3)],
  indices:[0,1,2,3,4,5]
 });
 assert.equal(duplicate.diagnostics.geometricVertexCandidates,3);
 assert.equal(duplicate.diagnostics.duplicateGeometricFaces,1);
 assert.equal(duplicate.diagnostics.positionJoinIsAuthoritative,false);
 assert.equal(duplicate.diagnostics.editsAllowedFromThisMap,false);
});

test('normal-only discontinuity and UV-only seam are diagnosed separately',()=>{
 const splitNormals=normals.map(n=>n.slice());
 splitNormals[4]=[0,1,0];splitNormals[5]=[0,1,0];
 const sharedUv=uv.map(x=>x.slice());
 sharedUv[4]=sharedUv[1].slice();sharedUv[5]=sharedUv[2].slice();
 const result=buildCornerTopology({positions,indices:triangles,
  uvSets:{TEXCOORD_0:sharedUv},normals:splitNormals});
 assert.equal(result.diagnostics.uvSeamEdges,0);
 assert.equal(result.diagnostics.normalSplitEdges,1);
 assert.equal(result.diagnostics.splitIndexEdges,1);
});

test('malformed/sparse glTF accessors and bad corner indices fail without write',()=>{
 for(const input of [
  {positions,indices:[0,1,9]},
  {positions,indices:[0,1,2,4]},
  {positions,indices:triangles,uvSets:{TEXCOORD_0:[[0,0]]}}
 ]){
  assert.throws(()=>buildCornerTopology(input),/MARK_CORNER_/);
 }
 const parsed=parseGlb(seamSource),doc=structuredClone(parsed.json);
 doc.accessors[doc.meshes[0].primitives[0].attributes.TEXCOORD_0].sparse={
  count:1,indices:{bufferView:0,componentType:5121},values:{bufferView:1}
 };
 const changed=writeGlb(parsed,doc);
 assert.throws(()=>inspectGlbCornerTopology(changed),/MARK_CORNER_ACCESSOR/);
});

test('AI Bridge read-only mesh.getTopology reports current geometry and respects undo',async()=>{
 const bridge=createAiBridge({allowWrites:true,buildHash:'pass15-test'});
 let seq=0;
 const call=async(method,params={})=>{
  const reply=await bridge.request({requestId:'pass15.'+(++seq),method,params});
  assert.equal(reply.ok,true,JSON.stringify(reply.diagnostics));return reply.result;
 };
 const caps=await call('studio.getCapabilities');
 assert.ok(caps.supported.includes('mesh.getTopology'));
 const uploaded=await call('asset.upload',{
  name:'seamed-quad.glb',type:'glb',data:seamSource
 });
 await call('scene.open',{assetId:uploaded.assetId});
 const revision=bridge.getSnapshot().revision;
 const topology=await call('mesh.getTopology',{meshId:'gltf-mesh-0'});
 assert.equal(topology.attributeVertexCount,6);
 assert.equal(topology.geometricVertexCandidates,4);
 assert.equal(topology.uvSeamEdges,1);
 assert.deepEqual(topology.uvSets,['TEXCOORD_0']);
 assert.equal(topology.seamSample.length,1);
 assert.equal(topology.topologyRevision,0);
 assert.equal(bridge.getSnapshot().revision,revision,
  'read-only query must not create a mutation');
 const saved=await call('scene.export');
 assert.deepEqual(saved.data,seamSource);
 // Position edit intentionally un-aligns one seam row: exactly 1 remaining
 // candidate split, no UV seam between the two triangles.
 await call('mesh.edit',{meshId:'gltf-mesh-0',
  operation:{kind:'vertex.move',vertex:4,delta:[0,0,.2]}});
 const moved=await call('mesh.getTopology',{meshId:'gltf-mesh-0'});
 assert.equal(moved.geometricVertexCandidates,5);
 assert.equal(moved.uvSeamEdges,0);
 assert.equal(moved.topologyRevision,1);
 await call('history.undo');
 const restored=await call('mesh.getTopology',{meshId:'gltf-mesh-0'});
 assert.equal(restored.uvSeamEdges,1);
 await call('history.redo');
 assert.equal((await call('mesh.getTopology',{meshId:'gltf-mesh-0'})).uvSeamEdges,0);
});

test('native .markscene roundtrip preserves seam topology and source byte identity',async()=>{
 const before=seamSource.slice();
 const native=await createPreviewMarkscene(seamSource,{
  projectId:'pass15-seam',edits:{meshOperations:[]}
 });
 const opened=await openPreviewMarkscene(native.archive);
 assert.deepEqual(opened.sourceGLB,before);
 const output=await exportEditedSourceGlb(opened);
 assert.deepEqual(output.glb,before);
 assert.equal(inspectGlbCornerTopology(output.glb).diagnostics.uvSeamEdges,1);
 const rig=buildRiggedFixture();
 assert.equal(inspectGlbCornerTopology(rig.bytes).diagnostics.uvSeamEdges,0);
});
