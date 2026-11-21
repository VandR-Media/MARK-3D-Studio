import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {parseGlb,writeGlb} from '../src/glb.js';
import {buildSkinnedSeamFixture}
 from '../scripts/pro-studio-pass17-skinned-seam-fixture.mjs';
import {inspectRiggedGlb} from '../src/pro-studio/rigged-glb-audit.js';
import {buildEditableMeshDataBinary,previewEditableMeshDataBinary,
 renderEditableMeshDataGlb}
 from '../src/pro-studio/editable-meshdata-binary.js';
import {createPreviewMarkscene,openPreviewMarkscene,
 exportEditedSourceGlb} from '../src/pro-studio/markscene-v3-preview.js';
import {createAiBridge} from '../src/pro-studio/ai-bridge-core.js';

const source=buildSkinnedSeamFixture(),
 sha=bytes=>createHash('sha256').update(Buffer.from(bytes)).digest('hex'),
 sourceSha256=sha(source),
 stableFace=i=>'mark-face-'+sourceSha256+'-m0-p0-source-face-'+i,
 op=(face,uvSet,delta,scope='face')=>({
  kind:'meshdata.translateUv',meshIndex:0,primitiveIndex:0,
  faceId:stableFace(face),uvSet,delta,scope
 });
const graph=(glb,ops)=>previewEditableMeshDataBinary({
 sourceGLB:glb,sourceSha256:sha(glb),
 data:buildEditableMeshDataBinary({
  sourceGLB:glb,sourceSha256:sha(glb),operations:ops})
});
const faceUv=(g,faceIndex,set)=>{
 const f=g.faces.find(x=>x.triangleIndex===faceIndex),
  corners=new Map(g.corners.map(c=>[c.id,c]));
 return f.cornerIds.map(id=>corners.get(id).attributes.uvSets['TEXCOORD_'+set]);
};
const same=(a,b)=>Math.abs(a-b)<2e-6;

function sharedSource(){
 // Make a genuine two-triangle island sharing indexed vertices [1,2].
 const parsed=parseGlb(source),doc=parsed.json,
  prim=doc.meshes[0].primitives[0],accessor=doc.accessors[prim.indices],
  view=doc.bufferViews[accessor.bufferView],
  bin=parsed.chunks.find(x=>x.type===0x004e4942).data.slice(),
  start=(view.byteOffset||0)+(accessor.byteOffset||0),
  dv=new DataView(bin.buffer,bin.byteOffset,bin.byteLength),
  unit={5121:1,5123:2,5125:4}[accessor.componentType],
  method={5121:'setUint8',5123:'setUint16',5125:'setUint32'}[
   accessor.componentType];
 for(const [j,v] of [1,3,2].entries())
  dv[method](start+(j+3)*unit,v,true);
 return writeGlb({...parsed,chunks:parsed.chunks.map(c=>c.type===0x004e4942?
  {...c,data:bin}:c)},doc);
}

test('independent binary resource has deterministic versioned header and source/corner IDs',()=>{
 const a=buildEditableMeshDataBinary({sourceGLB:source,sourceSha256}),
  b=buildEditableMeshDataBinary({sourceGLB:source,sourceSha256});
 assert.deepEqual(a,b);
 assert.equal(Buffer.from(a.subarray(0,8)).toString(),'MARKMDB1');
 assert.equal(new DataView(a.buffer,a.byteOffset).getUint32(8,true),1);
 const p=previewEditableMeshDataBinary({
  data:a,sourceGLB:source,sourceSha256});
 assert.equal(p.schema,'mark.editable-meshdata-binary/1');
 assert.equal(p.faces.length,2);
 assert.equal(p.corners.length,6);
 assert.equal(p.diagnostics.storedAttributeVertices,6);
 assert.ok(p.persisted&&p.standaloneBinary);
 assert.ok(p.faces[0].id===stableFace(0));
 assert.ok(p.corners[0].id.includes(stableFace(0)));
 assert.deepEqual(p.uvSets,['TEXCOORD_0','TEXCOORD_1']);
 assert.deepEqual(renderEditableMeshDataGlb({
  sourceGLB:source,sourceSha256,data:a
 }).glb,source);
});

test('different UV sets persist in actual MeshData and export skinned GLB without loss',()=>{
 const before=graph(source,[]),ops=[
  op(0,0,[.25,-.125]),op(1,1,[.125,.2])
 ],after=graph(source,ops);
 assert.deepEqual(after.faces.map(x=>x.id),before.faces.map(x=>x.id));
 assert.deepEqual(after.faces.map(x=>x.cornerIds),
  before.faces.map(x=>x.cornerIds));
 assert.deepEqual(faceUv(after,1,0),faceUv(before,1,0));
 assert.deepEqual(faceUv(after,0,1),faceUv(before,0,1));
 for(let k=0;k<3;k++){
  for(let axis=0;axis<2;axis++){
   assert.ok(same(faceUv(after,0,0)[k][axis],
    faceUv(before,0,0)[k][axis]+[.25,-.125][axis]));
   assert.ok(same(faceUv(after,1,1)[k][axis],
    faceUv(before,1,1)[k][axis]+[.125,.2][axis]));
  }
 }
 const data=buildEditableMeshDataBinary({sourceGLB:source,sourceSha256,
  operations:ops});
 const edited=renderEditableMeshDataGlb({sourceGLB:source,sourceSha256,data});
 assert.equal(edited.operations.length,2);
 const doc=parseGlb(edited.glb).json,original=parseGlb(source).json;
 assert.equal(doc.meshes[0].primitives[0].targets.length,2);
 assert.deepEqual(doc.materials,original.materials);
 assert.deepEqual(doc.animations,original.animations);
 assert.deepEqual(doc.skins,original.skins);
 assert.deepEqual(doc.textures,original.textures);
 assert.deepEqual(doc.images,original.images);
 const rig=inspectRiggedGlb(edited.glb);
 assert.equal(rig.skins[0].joints,70);
 assert.equal(rig.animations.length,3);
 assert.equal(rig.morphs[0].targets,2);
 assert.equal(sha(source),sourceSha256);
});

test('real UV island transform follows shared opposite glTF index edges without welding',()=>{
 const glb=sharedSource(),s=sha(glb),
  sourcePreview=graph(glb,[]),
  faceId='mark-face-'+s+'-m0-p0-source-face-0',
  edit={kind:'meshdata.translateUv',meshIndex:0,primitiveIndex:0,
   faceId,uvSet:0,delta:[.2,.05],scope:'island'},
  after=graph(glb,[edit]);
 assert.deepEqual(after.faces.map(x=>x.id),
  sourcePreview.faces.map(x=>x.id));
 assert.deepEqual(after.faces.map(x=>x.cornerIds),
  sourcePreview.faces.map(x=>x.cornerIds));
 for(let f=0;f<2;f++)for(let c=0;c<3;c++)
  for(let k=0;k<2;k++)assert.ok(same(faceUv(after,f,0)[c][k],
   faceUv(sourcePreview,f,0)[c][k]+[.2,.05][k]));
 const one={...edit,scope:'face'};
 const single=graph(glb,[one]);
 assert.deepEqual(faceUv(single,1,0),faceUv(sourcePreview,1,0));
 assert.deepEqual(faceUv(single,0,1),faceUv(sourcePreview,0,1));
 const real=renderEditableMeshDataGlb({sourceGLB:glb,sourceSha256:s,
  data:buildEditableMeshDataBinary({sourceGLB:glb,sourceSha256:s,
   operations:[edit]})});
 assert.equal(real.operations.length,2);
});

test('binary source/hash/length/tampering guards reject wrong resources before export',()=>{
 const bytes=buildEditableMeshDataBinary({sourceGLB:source,sourceSha256});
 const badHeader=bytes.slice();badHeader[0]=0;
 assert.throws(()=>previewEditableMeshDataBinary({
  data:badHeader,sourceGLB:source,sourceSha256}),/MARK_MDB_BINARY_MAGIC/);
 const badBody=bytes.slice();badBody[64]=255;
 assert.throws(()=>previewEditableMeshDataBinary({
  data:badBody,sourceGLB:source,sourceSha256}),/MARK_MDB_SOURCE_TOPOLOGY|MARK_MDB_BINARY_DATA/);
 assert.throws(()=>previewEditableMeshDataBinary({
  data:bytes.subarray(0,bytes.length-1),sourceGLB:source,sourceSha256
 }),/MARK_MDB_BINARY_SHAPE/);
 assert.throws(()=>previewEditableMeshDataBinary({
  data:bytes,sourceGLB:source,sourceSha256:'0'.repeat(64)
 }),/MARK_MDB_SOURCE_SHA/);
 const invalid=[
  op(0,2,[.1,0]),op(0,0,[0,0]),
  op(0,0,[100,0]),
  {...op(0,0,[.1,0]),faceId:'unknown'},
  {...op(0,0,[.1,0]),evil:true}
 ];
 for(const bad of invalid)assert.throws(()=>buildEditableMeshDataBinary({
  sourceGLB:source,sourceSha256,operations:[bad]
 }),/MARK_MDB_/);
 assert.throws(()=>buildEditableMeshDataBinary({
  sourceGLB:source,sourceSha256,
  operations:Array.from({length:17},()=>op(0,0,[.01,0]))
 }),/MARK_MDB_OPS/);
});

test('native scene uses three physically stored ZIP resources and still opens two-file P25',async()=>{
 const legacy=await createPreviewMarkscene(source,{
  projectId:'p26-legacy-glb',edits:{
   meshOperations:[{kind:'uv.offsetFaceCorners',
    meshIndex:0,primitiveIndex:0,faceIndex:0,uvSet:0,
    delta:[.125,0]}]
  }});
 const old=await openPreviewMarkscene(legacy.archive);
 assert.equal(old.meshDataBinary,undefined);
 assert.equal(old.manifest.assetManifest.length,1);
 const ops=[op(0,0,[.25,0]),op(1,1,[0,.125])];
 const created=await createPreviewMarkscene(source,{
  projectId:'p26-meshdata-binary',edits:{meshDataOperations:ops}});
 const reopened=await openPreviewMarkscene(created.archive);
 assert.equal(created.manifest.assetManifest.length,2);
 assert.equal(reopened.manifest.assetManifest.length,2);
 assert.equal(reopened.manifest.editableMeshDataResource.uri,
  'mesh/editable-meshdata.bin');
 assert.equal(reopened.manifest.editableMeshDataResource.sha256,
  sha(reopened.meshDataBinary));
 assert.deepEqual(reopened.edits.meshDataOperations,ops);
 assert.deepEqual(reopened.meshDataBinary,created.meshDataBinary);
 assert.deepEqual((await exportEditedSourceGlb(reopened)).glb,
  renderEditableMeshDataGlb({sourceGLB:source,sourceSha256,
   data:created.meshDataBinary}).glb);
 const altered=created.archive.slice();
 const locate=Buffer.from(altered).indexOf(Buffer.from('MARKMDB1'));
 assert.ok(locate>0);
 altered[locate+65]^=1;
 await assert.rejects(()=>openPreviewMarkscene(altered),
  /MARK_SCENE3_ZIP_CRC|MARK_SCENE3_MESHDATA_SHA/);
 const repeat=await createPreviewMarkscene(source,{
  projectId:'p26-meshdata-binary',edits:reopened.edits});
 assert.deepEqual(repeat.archive,created.archive);
});

test('AI Bridge opt-in MeshData source scoped UV island, native resource and Undo/Redo',async()=>{
 const bridge=createAiBridge({allowWrites:true,buildHash:'p26'});
 let n=0;const call=async(method,params={})=>{
  const r=await bridge.request({requestId:'p26.'+(++n),method,params});
  assert.equal(r.ok,true,JSON.stringify(r.diagnostics));return r.result;
 };
 const caps=await call('studio.getCapabilities');
 assert.ok(caps.supported.includes('meshdata.begin'));
 assert.ok(caps.supported.includes('meshdata.translateUv'));
 assert.ok(caps.supported.includes('meshdata.get'));
 const uploaded=await call('asset.upload',{type:'glb',
  name:'p26-skinned.glb',data:source});
 await call('scene.open',{assetId:uploaded.assetId});
 const notYet=await call('meshdata.get',{
  meshId:'gltf-mesh-0',primitiveIndex:0});
 assert.equal(notYet.enabled,false);
 await call('meshdata.begin',{meshId:'gltf-mesh-0',primitiveIndex:0});
 const initialized=await call('meshdata.get',{
  meshId:'gltf-mesh-0',primitiveIndex:0,full:true});
 assert.equal(initialized.enabled,true);
 assert.equal(initialized.operationCount,0);
 assert.equal(initialized.faces.length,2);
 assert.equal(initialized.corners.length,6);
 const invalid=await bridge.request({requestId:'p26.invalid',
  method:'meshdata.translateUv',params:{
   meshId:'gltf-mesh-0',primitiveIndex:0,
   faceId:stableFace(0)+'-forged',uvSet:0,
   scope:'island',delta:[.25,0]}});
 assert.equal(invalid.ok,false);
 assert.ok(JSON.stringify(invalid.diagnostics).includes('MDB_STALE_FACE'));
 await call('meshdata.translateUv',{meshId:'gltf-mesh-0',
  primitiveIndex:0,faceId:stableFace(0),uvSet:0,
  scope:'face',delta:[.25,-.125]});
 await call('meshdata.translateUv',{meshId:'gltf-mesh-0',
  primitiveIndex:0,faceId:stableFace(1),uvSet:1,
  scope:'island',delta:[0,.1]});
 const current=await call('meshdata.get',{meshId:'gltf-mesh-0',full:true});
 assert.equal(current.operationCount,2);
 assert.equal(current.diagnostics.editableMeshData,true);
 assert.equal(current.faces[0].id,stableFace(0));
 const saved=await call('scene.save'),out=await call('scene.export');
 const opened=await openPreviewMarkscene(saved.data);
 assert.equal(opened.manifest.assetManifest.length,2);
 assert.equal(opened.edits.meshDataOperations.length,2);
 assert.equal(sha(opened.meshDataBinary),
  opened.manifest.editableMeshDataResource.sha256);
 assert.deepEqual((await exportEditedSourceGlb(opened)).glb,out.data);
 await call('history.undo');
 const undone=await call('meshdata.get',{meshId:'gltf-mesh-0'});
 assert.equal(undone.operationCount,1);
 await call('history.redo');
 assert.deepEqual((await call('scene.export')).data,out.data);
 const other=createAiBridge({allowWrites:true});let count=0;
 const again=async(method,params={})=>{
  const r=await other.request({requestId:'p26.reopen.'+(++count),
   method,params});
  assert.equal(r.ok,true,JSON.stringify(r.diagnostics));return r.result;
 };
 const file=await again('asset.upload',{type:'markscene',
  name:'p26-native.markscene',data:saved.data});
 await again('scene.open',{assetId:file.assetId});
 assert.deepEqual((await again('scene.export')).data,out.data);
 const check=await again('meshdata.get',{meshId:'gltf-mesh-0'});
 assert.equal(check.operationCount,2);
});
