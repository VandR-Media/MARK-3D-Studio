import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {parseGlb,writeGlb} from '../src/glb.js';
import {createSplitSeamFixture} from '../scripts/pro-studio-seam-fixture.mjs';
import {buildRiggedFixture} from '../scripts/pro-studio-glb-fixtures.mjs';
import {normalizeExplicitSeamLinks,inspectExplicitSeamTopology}
 from '../src/pro-studio/mesh-seam-identity.js';
import {applyMeshOperations} from '../src/pro-studio/mesh-edit-core.js';
import {createPreviewMarkscene,openPreviewMarkscene,exportEditedSourceGlb}
 from '../src/pro-studio/markscene-v3-preview.js';
import {createAiBridge} from '../src/pro-studio/ai-bridge-core.js';

const input=createSplitSeamFixture(),sha=raw=>
 createHash('sha256').update(raw).digest('hex');
const sourceSha=sha(input);
const link=(a,b)=>({meshIndex:0,primitiveIndex:0,vertexA:a,vertexB:b});
const pairs=[link(1,4),link(2,5)];
const opt=(links=[],faces=[0,1])=>({
 meshIndex:0,primitiveIndex:0,sourceSha256:sourceSha,links,faces
});
test('explicit seam correspondence gives stable full-SHA source-scoped logical IDs',()=>{
 const before=input.slice();
 const base=inspectExplicitSeamTopology(input,opt([]));
 assert.equal(base.linkCount,0);
 assert.equal(base.logicalVertexCount,6);
 assert.equal(base.selection.connectedComponents,2);
 assert.equal(base.selection.validRegion,false);
 const one=inspectExplicitSeamTopology(input,opt([pairs[0]]));
 assert.equal(one.linkCount,1);
 assert.equal(one.selection.connectedComponents,2);
 const two=inspectExplicitSeamTopology(input,opt(pairs));
 assert.equal(two.linkCount,2);
 assert.equal(two.logicalVertexCount,4);
 assert.equal(two.selection.connectedComponents,1);
 assert.equal(two.selection.internalEdges,1);
 assert.equal(two.selection.boundaryEdges.length,4);
 assert.equal(two.selection.validRegion,true);
 assert.equal(two.autoWeld,false);
 assert.equal(two.editsAllowedViaLinks,false);
 assert.equal(two.stableIdsValidForTopologyMutations,false);
 assert.equal(two.stableVertexIdSample[1],two.stableVertexIdSample[4]);
 assert.equal(two.stableVertexIdSample[2],two.stableVertexIdSample[5]);
 assert.ok(two.stableVertexIdSample[1].includes(sourceSha));
 assert.equal(two.stableEdgeIdSample.length,5);
 assert.deepEqual(input,before,'No source GLB byte changed by logical join');
 assert.deepEqual(inspectExplicitSeamTopology(input,opt([...pairs].reverse())),
  two,'IDs and edge graph must not depend on user click ordering');
});

test('native archive stores strict canonical seam-link metadata; save/reopen/export lossless',async()=>{
 const native=await createPreviewMarkscene(input,{
  projectId:'pass16-links',edits:{meshSeamLinks:[
   link(5,2),link(4,1)
  ]}
 });
 const opened=await openPreviewMarkscene(native.archive);
 assert.deepEqual(opened.edits.meshSeamLinks,pairs);
 assert.deepEqual(opened.sourceGLB,input);
 assert.deepEqual((await exportEditedSourceGlb(opened)).glb,input);
 const repacked=await createPreviewMarkscene(opened.sourceGLB,{
  projectId:'pass16-links',edits:opened.edits
 });
 assert.deepEqual((await openPreviewMarkscene(repacked.archive)).edits.meshSeamLinks,
  pairs);
 assert.deepEqual(normalizeExplicitSeamLinks(input,[link(4,1),link(5,2)]),
  pairs);
 const illegal=[
  {...link(1,4),script:'alert(1)'},
  {...link(1,4),vertexB:1},
  {...link(1,4),vertexB:200}
 ];
 for(const bad of illegal){
  await assert.rejects(()=>createPreviewMarkscene(input,{
   projectId:'pass16-links',edits:{meshSeamLinks:[bad]}
  }),/MARK_SCENE3_MESH_SEAM_LINK/);
 }
});

test('conflicting geometry, duplicate IDs and non-canonical links are rejected',()=>{
 const badSets=[
  [link(0,1)], // noncoincident positions
  [link(2,5),link(2,5)], // duplicate
  [link(1,4),{...link(2,5),hidden:true}], // unknown key
  [link(1,2)], // different original corners of same face
  [{...link(1,4),meshIndex:999}], // unavailable mesh
  [link(1,4),link(2,5),link(2,5)]
 ];
 for(const bad of badSets)assert.throws(()=>
  normalizeExplicitSeamLinks(input,bad),/MARK_SEAM_/);
 for(const operation of ['vertex.move','vertex.snap','edge.split',
  'face.flip','face.delete','face.extrude','face.regionExtrude','primitive.add']){
  assert.throws(()=>normalizeExplicitSeamLinks(input,pairs,[{
   kind:operation,meshIndex:0,primitiveIndex:0
  }]),/MARK_SEAM_TOPOLOGY_REVISION/);
 }
 assert.deepEqual(input,createSplitSeamFixture());
});

test('identical XYZ but different skin/morph deformation MUST NOT be logical-linked',()=>{
 const rig=buildRiggedFixture();
 const parsed=parseGlb(rig.bytes),doc=structuredClone(parsed.json);
 const primitive=doc.meshes[0].primitives[0],pos=doc.accessors[
  primitive.attributes.POSITION],view=doc.bufferViews[pos.bufferView];
 const bin=parsed.chunks.find(c=>c.type===0x004e4942).data.slice(),
  dv=new DataView(bin.buffer,bin.byteOffset,bin.byteLength),
  offset=(view.byteOffset||0)+(pos.byteOffset||0),stride=view.byteStride??12;
 for(let k=0;k<3;k++)
  dv.setFloat32(offset+stride+k*4,dv.getFloat32(offset+k*4,true),true);
 // Make the first POSITION morph target explicitly incompatible at these
 // coincident positions, so a logical link must reject a future shape-key split.
 const m=doc.accessors[primitive.targets[0].POSITION],
  mv=doc.bufferViews[m.bufferView],mo=(mv.byteOffset||0)+(m.byteOffset||0),
  ms=mv.byteStride??12;
 dv.setFloat32(mo+ms,dv.getFloat32(mo,true)+.157,true);
 const changed=writeGlb({...parsed,chunks:parsed.chunks.map(c=>c.type===
  0x004e4942?{type:c.type,data:bin}:c)},doc);
 assert.throws(()=>normalizeExplicitSeamLinks(changed,[link(0,1)]),
  /MARK_SEAM_DEFORM_MISMATCH/,
  'Skin or morph difference must reject position-based link');
});

test('AI Bridge explicit link, region, undo/redo, user grant and project reopen',async()=>{
 const bridge=createAiBridge({allowWrites:true,buildHash:'pass16-test'});
 let seq=0;
 const call=async(method,params={})=>{
  const response=await bridge.request({
   requestId:'pass16.'+(++seq),method,params});
  assert.equal(response.ok,true,JSON.stringify(response.diagnostics));
  return response.result;
 };
 const capabilities=await call('studio.getCapabilities');
 for(const name of ['mesh.linkSeam','mesh.unlinkSeam','mesh.getLinkedRegion'])
  assert.ok(capabilities.supported.includes(name));
 const uploaded=await call('asset.upload',{name:'seam.glb',type:'glb',data:input});
 await call('scene.open',{assetId:uploaded.assetId});
 const read=async()=>call('mesh.getLinkedRegion',{
  meshId:'gltf-mesh-0',faces:[0,1]});
 assert.equal((await read()).selection.connectedComponents,2);
 const baseline=await call('mesh.getTopology',{meshId:'gltf-mesh-0'});
 assert.equal(baseline.uvSeamEdges,1);
 const originalSha=sha((await call('scene.export')).data);
 await call('mesh.linkSeam',{meshId:'gltf-mesh-0',vertexA:4,vertexB:1});
 await call('mesh.linkSeam',{meshId:'gltf-mesh-0',vertexA:5,vertexB:2});
 const joined=await read();
 assert.equal(joined.linkCount,2);
 assert.equal(joined.selection.connectedComponents,1);
 assert.equal(joined.selection.validRegion,true);
 assert.equal((await call('mesh.getTopology',{meshId:'gltf-mesh-0'}))
  .approvedSeamLinks,2);
 assert.equal(sha((await call('scene.export')).data),originalSha);
 const saved=await call('scene.save');
 assert.deepEqual((await openPreviewMarkscene(saved.data))
  .edits.meshSeamLinks,pairs);
 const attempted=await bridge.request({requestId:'p16.blocked',method:'mesh.edit',
  params:{meshId:'gltf-mesh-0',operation:{kind:'vertex.move',vertex:1,
   delta:[0,0,.2]}}});
 assert.equal(attempted.ok,false);
 assert.ok(JSON.stringify(attempted.diagnostics).includes('TOPOLOGY_REVISION'));
 assert.equal((await read()).linkCount,2);
 await call('history.undo');
 assert.equal((await read()).linkCount,1);
 await call('history.redo');
 assert.equal((await read()).linkCount,2);
 await call('mesh.unlinkSeam',{meshId:'gltf-mesh-0',vertexA:1,vertexB:4});
 assert.equal((await read()).linkCount,1);
 await call('history.undo');
 assert.equal((await read()).linkCount,2);
 // Reimport must preserve original source, and verified stable ID sample.
 const bridge2=createAiBridge({allowWrites:true});
 const request=async(method,params={})=>{
  const r=await bridge2.request({requestId:'reopen.'+method,method,params});
  assert.equal(r.ok,true,JSON.stringify(r.diagnostics));return r.result;
 };
 const savedAsset=await request('asset.upload',{
  name:'seam.markscene',type:'markscene',data:saved.data
 });
 await request('scene.open',{assetId:savedAsset.assetId});
 const after=await request('mesh.getLinkedRegion',{
  meshId:'gltf-mesh-0',faces:[1,0]});
 assert.equal(after.selection.validRegion,true);
 assert.equal(after.sourceSha256,joined.sourceSha256);
 assert.deepEqual(after.stableVertexIdSample,joined.stableVertexIdSample);
 assert.equal(sha((await request('scene.export')).data),originalSha);
});

test('no user grant blocks seam mutation but permits read-only topology queries',async()=>{
 const bridge=createAiBridge({allowWrites:()=>false});
 let n=0;
 const req=(method,params={})=>bridge.request({
  requestId:'disabled-'+(++n),method,params
 });
 const upload=await req('asset.upload',{name:'seam.glb',type:'glb',data:input});
 assert.equal(upload.ok,false);
 // Read-only access requires an opened scene; no bypass using meshId alone.
 const linked=await req('mesh.getLinkedRegion',{meshId:'gltf-mesh-0',faces:[0]});
 assert.equal(linked.ok,false);
});
