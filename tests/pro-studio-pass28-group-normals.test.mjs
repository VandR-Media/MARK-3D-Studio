import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {parseGlb} from '../src/glb.js';
import {buildSkinnedSeamFixture}
 from '../scripts/pro-studio-pass17-skinned-seam-fixture.mjs';
import {buildEditableMeshDataBinary,previewEditableMeshDataBinary,
 renderEditableMeshDataGlb}
 from '../src/pro-studio/editable-meshdata-binary.js';
import {createPreviewMarkscene,openPreviewMarkscene,exportEditedSourceGlb}
 from '../src/pro-studio/markscene-v3-preview.js';
import {createAiBridge} from '../src/pro-studio/ai-bridge-core.js';
import {inspectRiggedGlb} from '../src/pro-studio/rigged-glb-audit.js';

const source=buildSkinnedSeamFixture(),
 sha=bytes=>createHash('sha256').update(Buffer.from(bytes)).digest('hex'),
 sourceSha256=sha(source),
 stableVertex=row=>'mark-attr-'+sourceSha256+'-m0-p0-v'+row,
 stableFace=f=>'mark-face-'+sourceSha256+'-m0-p0-source-face-'+f,
 moveGroup=(rows,delta=[0,0,.2],scope='verified-seam')=>({
  kind:'meshdata.moveVertexGroup',meshIndex:0,primitiveIndex:0,
  vertexIds:rows.map(stableVertex),scope,delta
 }),
 uv=(face,delta)=>({kind:'meshdata.translateUv',meshIndex:0,
  primitiveIndex:0,faceId:stableFace(face),
  uvSet:0,scope:'face',delta}),
 normals=()=>({kind:'meshdata.recalculateNormals',meshIndex:0,
  primitiveIndex:0,mode:'area-weighted'}),
 build=ops=>buildEditableMeshDataBinary({
  sourceGLB:source,sourceSha256,operations:ops}),
 view=ops=>previewEditableMeshDataBinary({
  data:build(ops),sourceGLB:source,sourceSha256}),
 exportReal=ops=>renderEditableMeshDataGlb({
  sourceGLB:source,sourceSha256,data:build(ops)});
const near=(a,b)=>Math.abs(a-b)<2e-6;
function rows(glb,semantic){
 const parsed=parseGlb(glb),doc=parsed.json,
  prim=doc.meshes[0].primitives[0],
  accessor=doc.accessors[prim.attributes[semantic]],
  buffer=doc.bufferViews[accessor.bufferView],
  bin=parsed.chunks.find(c=>c.type===0x004e4942).data,
  dv=new DataView(bin.buffer,bin.byteOffset,bin.byteLength),
  count={SCALAR:1,VEC2:2,VEC3:3,VEC4:4}[accessor.type],
  size={5121:1,5123:2,5125:4,5126:4}[accessor.componentType],
  method={5121:'getUint8',5123:'getUint16',
   5125:'getUint32',5126:'getFloat32'}[accessor.componentType],
  start=(buffer.byteOffset||0)+(accessor.byteOffset||0),
  stride=buffer.byteStride??size*count;
 return Array.from({length:accessor.count},(_,i)=>
  Array.from({length:count},(_,k)=>
   dv[method](start+i*stride+k*size,true)));
}
function preserveRig(out){
 const a=parseGlb(source).json,b=parseGlb(out).json;
 for(const section of ['skins','animations','materials','images','textures'])
  assert.deepEqual(b[section],a[section],section+' changed');
 const audit=inspectRiggedGlb(out);
 assert.equal(audit.skins[0].joints,70);
 assert.equal(audit.morphs[0].targets,2);
 assert.equal(audit.animations.length,3);
 const srcPrim=a.meshes[0].primitives[0],dstPrim=b.meshes[0].primitives[0];
 for(let i=0;i<2;i++){
  const readMorph=(glb,prim)=> {
   const p=parseGlb(glb),acc=p.json.accessors[prim.targets[i].POSITION],
    view=p.json.bufferViews[acc.bufferView],chunk=p.chunks.find(c=>c.type===0x004e4942).data,
    dv=new DataView(chunk.buffer,chunk.byteOffset,chunk.byteLength),
    base=(view.byteOffset||0)+(acc.byteOffset||0);
   return Array.from({length:acc.count*3},(_,j)=>dv.getFloat32(base+j*4,true));
  };
  assert.deepEqual(readMorph(out,dstPrim).slice(0,18),
   readMorph(source,srcPrim));
 }
}
test('atomic source vertex group moves verified seam copies but not UV, skin or morph streams',()=>{
 const before=view([]),ops=[moveGroup([2,3])],after=view(ops),
  output=exportReal(ops).glb;
 assert.equal(after.diagnostics.binaryVersion,1);
 assert.deepEqual(before.vertices.map(v=>v.id),after.vertices.map(v=>v.id));
 assert.deepEqual(before.faces.map(f=>f.cornerIds),
  after.faces.map(f=>f.cornerIds));
 for(const row of [2,3,5]){
  assert.ok(near(after.vertices[row].position[2],
   before.vertices[row].position[2]+.2));
  assert.ok(near(rows(output,'POSITION')[row][2],
   rows(source,'POSITION')[row][2]+.2));
 }
 for(const row of [0,1,4])
  assert.deepEqual(after.vertices[row].position,before.vertices[row].position);
 for(const name of ['NORMAL','TEXCOORD_0','TEXCOORD_1','JOINTS_0','WEIGHTS_0'])
  assert.deepEqual(rows(output,name),rows(source,name),
   'POSITION-only group must preserve '+name);
 preserveRig(output);
 assert.equal(sha(source),sourceSha256);
});
test('group moved after UV copy-on-write changes all physical clone positions with stable provenance',()=>{
 const ops=[uv(0,[.125,0]),moveGroup([2,3],[0,0,.15])],
  data=build(ops),preview=previewEditableMeshDataBinary({
   data,sourceGLB:source,sourceSha256}),
  result=renderEditableMeshDataGlb({sourceGLB:source,sourceSha256,data});
 assert.equal(result.movedVertices,3);
 assert.equal(preview.attributeRowProvenance.length,9);
 assert.deepEqual(preview.attributeRowProvenance.slice(6).map(r=>
  r.sourceAttributeVertex),[0,1,2]);
 assert.ok(near(rows(result.glb,'POSITION')[8][2],.15));
 assert.ok(near(rows(result.glb,'POSITION')[2][2],.15));
 assert.equal(rows(result.glb,'POSITION').length,9);
 assert.deepEqual(rows(result.glb,'TEXCOORD_1').slice(0,6),
  rows(source,'TEXCOORD_1'));
 preserveRig(result.glb);
});
test('version 2 binary normal layer stores normalized physical values and preserves original 2-set UV, skins, morphs',()=>{
 const ops=[uv(0,[.125,.025]),moveGroup([2,3],[0,0,.2]),normals()],
  binary=build(ops),m=view(ops),exported=exportReal(ops);
 assert.equal(Buffer.from(binary.slice(0,8)).toString(),'MARKMDB1');
 assert.equal(new DataView(binary.buffer).getUint32(8,true),2);
 assert.equal(binary.length,build(ops.slice(0,-1)).length+6*12);
 assert.equal(m.diagnostics.binaryVersion,2);
 assert.equal(m.diagnostics.normalsRecalculated,true);
 assert.equal(m.vertices.length,6);
 assert.deepEqual(m.vertices.map(v=>v.id),view([]).vertices.map(v=>v.id));
 assert.deepEqual(m.faces.map(f=>f.cornerIds),
  view([]).faces.map(f=>f.cornerIds));
 assert.ok(m.vertices.every(v=>near(Math.hypot(...v.normal),1)));
 assert.ok(m.vertices[2].normal.some((n,k)=>
  Math.abs(n-rows(source,'NORMAL')[2][k])>0.02));
 const glbNormals=rows(exported.glb,'NORMAL');
 assert.equal(glbNormals.length,9);
 for(let i=0;i<6;i++)assert.deepEqual(glbNormals[i],m.vertices[i].normal);
 for(let k=0;k<3;k++)assert.deepEqual(glbNormals[6+k],
  m.vertices[[0,1,2][k]].normal);
 assert.deepEqual(rows(exported.glb,'TEXCOORD_1').slice(0,6),
  rows(source,'TEXCOORD_1'));
 assert.deepEqual(rows(exported.glb,'JOINTS_0').slice(0,6),
  rows(source,'JOINTS_0'));
 assert.deepEqual(rows(exported.glb,'WEIGHTS_0').slice(0,6),
  rows(source,'WEIGHTS_0'));
 preserveRig(exported.glb);
});
test('invalid group, forged IDs, stale normal, repeated normal and source tamper fail closed',()=>{
 const invalid=[
  moveGroup([3,2]),moveGroup([2,2]),moveGroup([2]),moveGroup([1,3],[0,0,.2],'attribute'),
  moveGroup([0,2],[100,0,0]),moveGroup([0,2],[0,0,0]),
  {...moveGroup([0,2]),evil:true},{...moveGroup([0,2]),vertexIds:['forged',stableVertex(2)]},
  {...moveGroup([0,2]),scope:'unknown'},
  {...moveGroup([0,2]),delta:[.1,NaN,0]}
 ];
 for(const op of invalid)assert.throws(()=>build([op]),/MARK_MDB_/);
 assert.throws(()=>build([moveGroup([2,3],[0,-3,0])]),/MARK_MDB_/);
 assert.throws(()=>build([normals(),uv(0,[.1,0])]),/MARK_MDB_NORMAL_TERMINAL/);
 assert.throws(()=>build([normals(),moveGroup([2,3])]),/MARK_MDB_NORMAL_TERMINAL/);
 assert.throws(()=>build([normals(),normals()]),/MARK_MDB_NORMAL_TERMINAL/);
 assert.throws(()=>build([{...normals(),mode:'unsafe'}]),/MARK_MDB_NORMAL_ARGS/);
 assert.throws(()=>build([{...normals(),foreign:true}]),/MARK_MDB_NORMAL_ARGS/);
 const binary=build([moveGroup([2,3]),normals()]),corrupt=binary.slice();
 corrupt[corrupt.length-4]=255;
 assert.throws(()=>previewEditableMeshDataBinary({
  sourceGLB:source,sourceSha256,data:corrupt
 }),/MARK_MDB_BINARY_NORMALS/);
});
test('native 3-file markscene v2 group + normal replay matches bytewise GLB and reopens legacy v1',async()=>{
 const old=await createPreviewMarkscene(source,{
  projectId:'pass28-legacy',edits:{meshDataOperations:[uv(0,[.1,0])]}
 });
 const oldOpened=await openPreviewMarkscene(old.archive);
 assert.equal(new DataView(oldOpened.meshDataBinary.buffer,
  oldOpened.meshDataBinary.byteOffset).getUint32(8,true),1);
 const operations=[uv(0,[.125,0]),moveGroup([2,3],[0,0,.2]),normals()],
  project=await createPreviewMarkscene(source,{
   projectId:'pass28-normals',edits:{meshDataOperations:operations}
  }),reopened=await openPreviewMarkscene(project.archive);
 assert.equal(reopened.manifest.assetManifest.length,2);
 assert.deepEqual(reopened.edits.meshDataOperations,operations);
 assert.equal(new DataView(reopened.meshDataBinary.buffer,
  reopened.meshDataBinary.byteOffset).getUint32(8,true),2);
 const glb=(await exportEditedSourceGlb(reopened)).glb;
 assert.deepEqual(glb,exportReal(operations).glb);
 const second=await createPreviewMarkscene(source,{
  projectId:'pass28-normals',edits:reopened.edits});
 assert.deepEqual(second.archive,project.archive);
 const tampered=project.archive.slice(),
  offset=Buffer.from(tampered).indexOf(Buffer.from('MARKMDB1'));
 assert.ok(offset>0);tampered[offset+64]^=1;
 await assert.rejects(()=>openPreviewMarkscene(tampered),
  /MARK_SCENE3_ZIP_CRC|MARK_SCENE3_MESHDATA_SHA/);
 preserveRig(glb);
});
test('Bridge group and normal ops are authorized, visible, block later edits and undo/redo true GLB',async()=>{
 const bridge=createAiBridge({allowWrites:true,buildHash:'pass28'}),count={n:0},
  ask=async(method,params={})=>{
   const r=await bridge.request({requestId:'p28.'+(++count.n),
    method,params});
   assert.equal(r.ok,true,JSON.stringify(r.diagnostics));
   return r.result;
  };
 const cap=await ask('studio.getCapabilities');
 assert.ok(cap.supported.includes('meshdata.moveVertexGroup'));
 assert.ok(cap.supported.includes('meshdata.recalculateNormals'));
 const upload=await ask('asset.upload',{
  name:'pass28-70-bone.glb',type:'glb',data:source
 });
 await ask('scene.open',{assetId:upload.assetId});
 await ask('meshdata.begin',{meshId:'gltf-mesh-0',primitiveIndex:0});
 await ask('meshdata.translateUv',{meshId:'gltf-mesh-0',
  primitiveIndex:0,faceId:stableFace(0),scope:'face',
  uvSet:0,delta:[.125,0]});
 const bad=await bridge.request({requestId:'p28.invalid',
  method:'meshdata.moveVertexGroup',params:{meshId:'gltf-mesh-0',
   primitiveIndex:0,vertexIds:[stableVertex(3),stableVertex(2)],
   scope:'verified-seam',delta:[0,0,.2]}});
 assert.equal(bad.ok,false);
 assert.ok(JSON.stringify(bad.diagnostics).includes('MDB_GROUP_STALE'));
 await ask('meshdata.moveVertexGroup',{meshId:'gltf-mesh-0',
  primitiveIndex:0,vertexIds:[stableVertex(2),stableVertex(3)],
  scope:'verified-seam',delta:[0,0,.2]});
 await ask('meshdata.recalculateNormals',{meshId:'gltf-mesh-0',
  primitiveIndex:0,mode:'area-weighted'});
 const view=await ask('meshdata.get',{meshId:'gltf-mesh-0',full:true});
 assert.equal(view.operationCount,3);
 assert.equal(view.diagnostics.binaryVersion,2);
 assert.equal(view.diagnostics.normalsRecalculated,true);
 const blocked=await bridge.request({requestId:'p28.blocked',
  method:'meshdata.moveVertex',params:{meshId:'gltf-mesh-0',
   primitiveIndex:0,vertexId:stableVertex(0),scope:'attribute',
   delta:[.1,0,0]}});
 assert.equal(blocked.ok,false);
 assert.ok(JSON.stringify(blocked.diagnostics).includes('NORMAL_TERMINAL'));
 const native=await ask('scene.save'),exported=await ask('scene.export');
 const reopened=await openPreviewMarkscene(native.data);
 assert.deepEqual((await exportEditedSourceGlb(reopened)).glb,exported.data);
 preserveRig(exported.data);
 await ask('history.undo');
 assert.equal((await ask('meshdata.get',{meshId:'gltf-mesh-0'}))
  .diagnostics.binaryVersion,1);
 await ask('history.redo');
 assert.deepEqual((await ask('scene.export')).data,exported.data);
 const other=createAiBridge({allowWrites:true}),seq={n:0},
  request=async(method,params={})=>{
   const r=await other.request({requestId:'reopen.'+(++seq.n),
    method,params});
   assert.equal(r.ok,true,JSON.stringify(r.diagnostics));
   return r.result;
  };
 const asset=await request('asset.upload',{
  type:'markscene',name:'pass28-native.markscene',data:native.data});
 await request('scene.open',{assetId:asset.assetId});
 assert.deepEqual((await request('scene.export')).data,exported.data);
});
