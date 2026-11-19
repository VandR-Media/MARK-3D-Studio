import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {parseGlb} from '../src/glb.js';
import {applyMeshOperations,getMeshEditStats} from '../src/pro-studio/mesh-edit-core.js';
import {normalizeExplicitSeamLinks,inspectConsumedSeamExtrude}
 from '../src/pro-studio/mesh-seam-identity.js';
import {createPreviewMarkscene,openPreviewMarkscene,exportEditedSourceGlb}
 from '../src/pro-studio/markscene-v3-preview.js';
import {createAiBridge} from '../src/pro-studio/ai-bridge-core.js';
import {inspectRiggedGlb} from '../src/pro-studio/rigged-glb-audit.js';
import {compareGlbTextures} from '../src/pro-studio/glb-texture-qa.js';
import {buildSkinnedSeamFixture} from '../scripts/pro-studio-pass17-skinned-seam-fixture.mjs';
import {createSplitSeamFixture} from '../scripts/pro-studio-seam-fixture.mjs';

const source=buildSkinnedSeamFixture();
const hash=bytes=>createHash('sha256').update(Buffer.from(bytes)).digest('hex');
const sha=hash(source);
const links=[{meshIndex:0,primitiveIndex:0,vertexA:1,vertexB:4},
 {meshIndex:0,primitiveIndex:0,vertexA:2,vertexB:5}];
const linked=(distance=.4)=>({
 kind:'face.regionExtrudeLinked',meshIndex:0,primitiveIndex:0,
 faces:[0,1],distance,links
});
function getRows(bytes,accessorIndex){
 const parsed=parseGlb(bytes),doc=parsed.json,acc=doc.accessors[accessorIndex],
  view=doc.bufferViews[acc.bufferView],bin=parsed.chunks.find(
   c=>c.type===0x004e4942).data;
 const [n,width,get]={
  VEC2:{5126:[2,4,'getFloat32']},
  VEC3:{5126:[3,4,'getFloat32']},
  VEC4:{5123:[4,2,'getUint16'],5126:[4,4,'getFloat32']},
  SCALAR:{5121:[1,1,'getUint8'],5123:[1,2,'getUint16'],
   5125:[1,4,'getUint32']}
 }[acc.type][acc.componentType];
 const offset=(view.byteOffset||0)+(acc.byteOffset||0),step=view.byteStride??n*width,
  dv=new DataView(bin.buffer,bin.byteOffset,bin.byteLength);
 return Array.from({length:acc.count},(_,i)=>Array.from({length:n},(_,k)=>
  dv[get](offset+i*step+k*width,true)));
}
function geometry(bytes){
 const doc=parseGlb(bytes).json,prim=doc.meshes[0].primitives[0];
 const attrs={};
 for(const [name,index] of Object.entries(prim.attributes))
  attrs[name]=getRows(bytes,index);
 return{doc,prim,attrs,
  faces:getRows(bytes,prim.indices).map(x=>x[0]),
  morphs:prim.targets.map(t=>getRows(bytes,t.POSITION))};
}
test('actual skinned UV-seam RegionExtrude produces 2 caps + only 4 exterior walls',()=>{
 const before=source.slice(),src=geometry(before);
 const output=applyMeshOperations(source,[linked()]),dst=geometry(output);
 assert.deepEqual(before,source,'source GLB must remain byte-identical');
 assert.equal(src.attrs.POSITION.length,6);
 assert.equal(dst.attrs.POSITION.length,28,'6 separate cap rows + 4 walls x 4');
 assert.equal(dst.faces.length,30,'2 cap faces + 8 outer wall faces');
 assert.equal(getMeshEditStats(output).triangleCount,10);
 assert.deepEqual(dst.faces.slice(0,6),[6,7,8,10,9,11]);
 assert.equal(dst.faces.slice(6).length,24);
 for(let i=0;i<6;i++){
  const a=src.attrs.POSITION[i],b=dst.attrs.POSITION[6+i];
  assert.ok(Math.abs(b[0]-a[0])<1e-6);
  assert.ok(Math.abs(b[1]-a[1])<1e-6);
  assert.ok(Math.abs(b[2]-a[2]-.4)<1e-5);
  for(const semantic of ['TEXCOORD_0','TEXCOORD_1',
   'JOINTS_0','WEIGHTS_0'])
   assert.deepEqual(dst.attrs[semantic][6+i],src.attrs[semantic][i],
    'Cap must preserve individual '+semantic+' face-corner rows');
  for(let m=0;m<2;m++)
   assert.deepEqual(dst.morphs[m][6+i],src.morphs[m][i],
    'Skin/morph deformation must match the same original cap corner');
 }
 assert.notDeepEqual(dst.attrs.TEXCOORD_0[7],dst.attrs.TEXCOORD_0[10],
  'UV seam must remain physically split in glTF cap');
 assert.notDeepEqual(dst.attrs.TEXCOORD_1[8],dst.attrs.TEXCOORD_1[11],
  'Second UV seam set must survive without silent weld');
 for(let i=12;i<28;i++)assert.ok(
  Math.abs(Math.hypot(...dst.attrs.NORMAL[i])-1)<1e-5);
 const rig=inspectRiggedGlb(output);
 assert.equal(rig.skins[0].joints,70);
 assert.equal(rig.animations.length,3);
 assert.equal(rig.morphs[0].targets,2);
 assert.deepEqual(dst.doc.animations,src.doc.animations);
 assert.deepEqual(dst.doc.skins,src.doc.skins);
 assert.deepEqual(dst.doc.materials,src.doc.materials);
 assert.equal(compareGlbTextures(source,output).status,'pass_supported_png');
});
test('canonical consumed-source cap remap survives native ZIP reopen and GLB replay',async()=>{
 const op=linked(.23),manifest=await createPreviewMarkscene(source,{
  projectId:'pass17-linked',edits:{meshOperations:[op],meshSeamLinks:[]}
 });
 const reopened=await openPreviewMarkscene(manifest.archive);
 assert.deepEqual(reopened.sourceGLB,source);
 assert.deepEqual(reopened.edits.meshOperations,[op]);
 assert.deepEqual(reopened.edits.meshSeamLinks,[]);
 const exported=await exportEditedSourceGlb(reopened);
 assert.deepEqual(exported.glb,applyMeshOperations(source,[op]));
 const again=await exportEditedSourceGlb(await openPreviewMarkscene(manifest.archive));
 assert.deepEqual(exported.glb,again.glb);
 const remap=inspectConsumedSeamExtrude(source,{
  sourceSha256:sha,operation:op});
 assert.equal(remap.sourceLinksConsumed,true);
 assert.equal(remap.capRemap.length,6);
 assert.deepEqual(remap.pairedCaps.map(x=>x.capAttributeVertices),
  [[7,10],[8,11]]);
 assert.equal(remap.sourceRegion.validRegion,true);
 assert.ok(remap.capRemap.every(x=>x.capStableId.includes(sha)));
});
test('unsafe, unapproved and noncanonical linked extrusion operations fail',async()=>{
 const staticBytes=createSplitSeamFixture();
 const badOps=[
  {...linked(),links:[]},
  {...linked(),links:[links[0]]},
  {...linked(),links:[...links].reverse()},
  {...linked(),links:[...links,{...links[0]}]},
  {...linked(),links:[{...links[0],vertexA:0},links[1]]},
  {...linked(),links:[{...links[0],meshIndex:1},links[1]]},
  {...linked(),faces:[0,0]},
  {...linked(),faces:[0]},
  {...linked(),faces:[0,999]},
  {...linked(),distance:0},
  {...linked(),distance:51}
 ];
 for(const op of badOps)assert.throws(()=>
  applyMeshOperations(source,[op]),/MARK_MESH_|MARK_SEAM_/);
 assert.throws(()=>applyMeshOperations(source,[
  {kind:'normal.recalculate',meshIndex:0,primitiveIndex:0},linked()]),
 /MARK_MESH_LINKED_SEQUENCE/);
 assert.throws(()=>applyMeshOperations(source,[
  linked(),{kind:'vertex.move',meshIndex:0,primitiveIndex:0,
   vertex:0,delta:[0,0,.2]}]),/MARK_MESH_LINKED_SEQUENCE/);
 assert.throws(()=>applyMeshOperations(staticBytes,[
  {...linked(),links:[...links].reverse()}]),/MARK_MESH_/);
 await assert.rejects(()=>createPreviewMarkscene(source,{
  edits:{meshOperations:[{...linked(),evil:'script'}]}}),
 /MARK_SCENE3_MESH_EDIT_FIELDS/);
 await assert.rejects(()=>createPreviewMarkscene(source,{
  edits:{meshOperations:[linked()],meshSeamLinks:links}}),
 /MARK_SCENE3_MESH_SEAM_LINK|MARK_SCENE3_MESH_LINKED_CONSUMED/);
 assert.equal(hash(source),sha);
});
test('bridge does a one-shot user-approved binary extrusion, reversible native undo/redo',async()=>{
 const bridge=createAiBridge({allowWrites:true,buildHash:'p17-test'});
 let id=0;
 const call=async(method,params={})=>{
  const r=await bridge.request({requestId:'p17.'+(++id),method,params});
  assert.equal(r.ok,true,JSON.stringify(r.diagnostics));return r.result;
 };
 const imported=await call('asset.upload',{name:'rig-seam.glb',type:'glb',
  data:source});
 await call('scene.open',{assetId:imported.assetId});
 const granted=await call('studio.getCapabilities');
 assert.ok(granted.supported.includes('mesh.extrudeLinkedRegion'));
 const before=await call('scene.export');
 assert.equal(hash(before.data),sha);
 for(const pair of links)await call('mesh.linkSeam',{
  meshId:'gltf-mesh-0',vertexA:pair.vertexA,vertexB:pair.vertexB});
 const peek=await call('mesh.getLinkedRegion',{meshId:'gltf-mesh-0',
  faces:[0,1]});
 assert.equal(peek.selection.validRegion,true);
 await call('mesh.extrudeLinkedRegion',{meshId:'gltf-mesh-0',
  faces:[0,1],distance:.42});
 const stats=await call('mesh.getStats',{meshId:'gltf-mesh-0'});
 assert.equal(stats.vertexCount,28);
 assert.equal(stats.triangleCount,10);
 const after=await call('scene.export');
 assert.equal(geometry(after.data).faces.length,30);
 const native=await call('scene.save');
 const reopened=await openPreviewMarkscene(native.data);
 assert.deepEqual(reopened.sourceGLB,source);
 assert.deepEqual(reopened.edits.meshSeamLinks,[]);
 assert.deepEqual(reopened.edits.meshOperations[0].links,links);
 const remap=await call('mesh.getLinkedRegion',{meshId:'gltf-mesh-0'});
 assert.equal(remap.sourceLinksConsumed,true);
 assert.deepEqual(remap.pairedCaps.map(x=>x.capAttributeVertices),
  [[7,10],[8,11]]);
 const blocked=await bridge.request({requestId:'p17.blocked',method:'mesh.edit',
  params:{meshId:'gltf-mesh-0',operation:{kind:'vertex.move',
   vertex:0,delta:[0,0,.1]}}});
 assert.equal(blocked.ok,false);
 assert.ok(JSON.stringify(blocked.diagnostics).includes('MESH_LINKED_SEQUENCE'));
 await call('history.undo');
 assert.equal((await call('mesh.getStats',{meshId:'gltf-mesh-0'})).vertexCount,6);
 assert.equal((await call('mesh.getLinkedRegion',{meshId:'gltf-mesh-0',
  faces:[0,1]})).selection.validRegion,true);
 await call('history.redo');
 assert.equal((await call('mesh.getStats',{meshId:'gltf-mesh-0'})).vertexCount,28);
 const afterRedo=await call('scene.export');
 assert.deepEqual(afterRedo.data,after.data);
 const fresh=createAiBridge({allowWrites:true,buildHash:'p17-reopen'});
 const imp=await fresh.request({requestId:'fresh.upload',method:'asset.upload',
  params:{type:'markscene',name:'seam.markscene',data:native.data}});
 assert.equal(imp.ok,true,JSON.stringify(imp.diagnostics));
 const opened=await fresh.request({requestId:'fresh.open',method:'scene.open',
  params:{assetId:imp.result.assetId}});
 assert.equal(opened.ok,true,JSON.stringify(opened.diagnostics));
 const ext=await fresh.request({requestId:'fresh.export',method:'scene.export'});
 assert.equal(ext.ok,true,JSON.stringify(ext.diagnostics));
 assert.deepEqual(ext.result.data,after.data);
});
