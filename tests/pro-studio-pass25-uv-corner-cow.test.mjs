import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {parseGlb,writeGlb} from '../src/glb.js';
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

const source=buildSkinnedSeamFixture(),
 sha=x=>createHash('sha256').update(Buffer.from(x)).digest('hex');
const sourceSha=sha(source);
const uv=(faceIndex,uvSet,delta)=>({kind:'uv.offsetFaceCorners',
 meshIndex:0,primitiveIndex:0,faceIndex,uvSet,delta});
const first=uv(0,0,[.25,-.125]),second=uv(1,1,[.175,.2]),
 third=uv(0,0,[-.05,.1]);
const operations=[first,second],repeated=[...operations,third];
function rows(glb,accessorIndex){
 const p=parseGlb(glb),doc=p.json,a=doc.accessors[accessorIndex],
  view=doc.bufferViews[a.bufferView],
  bin=p.chunks.find(c=>c.type===0x004e4942).data,
  bytes={5121:1,5123:2,5125:4,5126:4}[a.componentType],
  getter={5121:'getUint8',5123:'getUint16',5125:'getUint32',
   5126:'getFloat32'}[a.componentType],
  count={SCALAR:1,VEC2:2,VEC3:3,VEC4:4,MAT4:16}[a.type],
  stride=view.byteStride??bytes*count,
  start=(view.byteOffset||0)+(a.byteOffset||0),
  data=new DataView(bin.buffer,bin.byteOffset,bin.byteLength);
 return Array.from({length:a.count},(_,i)=>Array.from({length:count},
  (_,j)=>data[getter](start+i*stride+j*bytes,true)));
}
const attr=(glb,name)=>{
 const prim=parseGlb(glb).json.meshes[0].primitives[0];
 return rows(glb,prim.attributes[name]);
};
const faceIdx=glb=>{
 const prim=parseGlb(glb).json.meshes[0].primitives[0];
 const idx=rows(glb,prim.indices).map(x=>x[0]);
 return Array.from({length:idx.length/3},(_,f)=>idx.slice(f*3,f*3+3));
};
function graph(src,ops){
 return buildMeshDataSnapshot({
  sourceGLB:src,editedGLB:applyMeshOperations(src,ops),
  sourceSha256:sha(src),meshIndex:0,primitiveIndex:0,operations:ops
 });
}
const tolerance=(a,b)=>Math.abs(a-b)<2e-6;

test('real GLB copy-on-write UV0 edits one source triangle only, retains indices and triangles',()=>{
 const result=applyMeshOperations(source,[first]);
 const stats=getMeshEditStats(result);
 assert.equal(stats.vertexCount,9);
 assert.equal(stats.triangleCount,2);
 assert.deepEqual(faceIdx(result)[0],[6,7,8]);
 assert.deepEqual(faceIdx(result)[1],faceIdx(source)[1]);
 assert.deepEqual(attr(result,'POSITION').slice(0,6),attr(source,'POSITION'));
 for(const name of ['NORMAL','TEXCOORD_0','TEXCOORD_1',
  'JOINTS_0','WEIGHTS_0'])
  assert.deepEqual(attr(result,name).slice(0,6),attr(source,name),
   'Source rows must not be overwritten: '+name);
 for(let c=0;c<3;c++){
  const src=faceIdx(source)[0][c],uv0=attr(result,'TEXCOORD_0');
  assert.ok(tolerance(uv0[6+c][0],uv0[src][0]+.25));
  assert.ok(tolerance(uv0[6+c][1],uv0[src][1]-.125));
  assert.deepEqual(attr(result,'TEXCOORD_1')[6+c],
   attr(source,'TEXCOORD_1')[src]);
 }
 assert.equal(sha(source),sourceSha);
 assert.equal(stats.degenerateTriangles,0);
});

test('second different UV set does not bleed into earlier UV0, skin, morphs, PBR or animation',()=>{
 const firstGlb=applyMeshOperations(source,[first]),
  both=applyMeshOperations(source,operations);
 assert.equal(getMeshEditStats(both).vertexCount,12);
 assert.equal(getMeshEditStats(both).triangleCount,2);
 assert.deepEqual(faceIdx(both),[[6,7,8],[9,10,11]]);
 for(const name of ['POSITION','NORMAL','TEXCOORD_0','TEXCOORD_1',
  'JOINTS_0','WEIGHTS_0'])
  assert.deepEqual(attr(both,name).slice(0,9),attr(firstGlb,name),
   'No previous source/UV corner may be changed: '+name);
 for(let c=0;c<3;c++){
  const src=faceIdx(source)[1][c];
  for(const name of ['POSITION','NORMAL','JOINTS_0','WEIGHTS_0',
   'TEXCOORD_0'])
   assert.deepEqual(attr(both,name)[9+c],attr(source,name)[src],
    'Full row must be copied for '+name);
  for(let k=0;k<2;k++)assert.ok(tolerance(
   attr(both,'TEXCOORD_1')[9+c][k],
   attr(source,'TEXCOORD_1')[src][k]+second.delta[k]));
 }
 const a=parseGlb(both).json,b=parseGlb(source).json,
  primA=a.meshes[0].primitives[0],primB=b.meshes[0].primitives[0];
 for(let i=0;i<2;i++){
  const mA=rows(both,primA.targets[i].POSITION),
   mB=rows(source,primB.targets[i].POSITION);
  assert.deepEqual(mA.slice(0,6),mB);
  for(let c=0;c<3;c++)
   assert.deepEqual(mA[9+c],mB[faceIdx(source)[1][c]]);
 }
 assert.deepEqual(a.skins,b.skins);
 assert.deepEqual(a.animations,b.animations);
 assert.deepEqual(a.materials,b.materials);
 const audit=inspectRiggedGlb(both);
 assert.equal(audit.skins[0].joints,70);
 assert.equal(audit.morphs[0].targets,2);
 assert.equal(audit.animations.length,3);
 assert.equal(compareGlbTextures(source,both).status,'pass_supported_png');
});

test('re-editing same UV face preserves stable face/corner/vertex identity and earlier history',()=>{
 const two=graph(source,operations),
  three=graph(source,repeated),
  out=applyMeshOperations(source,repeated);
 assert.equal(getMeshEditStats(out).vertexCount,15);
 assert.equal(getMeshEditStats(out).triangleCount,2);
 assert.deepEqual(faceIdx(out),[[12,13,14],[9,10,11]]);
 assert.equal(three.diagnostics.uvCornerEditCount,3);
 assert.equal(three.diagnostics.uvCopyOnWriteAttributeRows,9);
 assert.equal(three.uvCornerRemaps.length,3);
 assert.deepEqual(three.uvCornerRemaps.slice(0,2),two.uvCornerRemaps);
 assert.deepEqual(three.uvCornerRemaps[2].beforeAttributeVertices,[6,7,8]);
 assert.deepEqual(three.uvCornerRemaps[2].newAttributeVertices,[12,13,14]);
 assert.deepEqual(three.uvCornerRemaps[0].cornerIds,
  three.uvCornerRemaps[2].cornerIds);
 assert.deepEqual(three.uvCornerRemaps[0].retainedLogicalVertexIds,
  three.uvCornerRemaps[2].retainedLogicalVertexIds);
 assert.deepEqual(three.faces.map(f=>f.id),two.faces.map(f=>f.id));
 assert.deepEqual(three.faces.map(f=>f.cornerIds),
  two.faces.map(f=>f.cornerIds));
 assert.equal(three.diagnostics.nonManifoldEdges,0);
 assert.equal(three.diagnostics.windingConflicts,0);
 assert.equal(three.diagnostics.boundaryEdges,6);
 assert.equal(three.uvSets.length,2);
 for(let c=0;c<3;c++){
  const old=attr(out,'TEXCOORD_0')[6+c],
   now=attr(out,'TEXCOORD_0')[12+c];
  assert.ok(tolerance(now[0],old[0]-.05));
  assert.ok(tolerance(now[1],old[1]+.1));
 }
});

test('UV operations in opposite order preserve face/corner semantic identities and final UV coordinates',()=>{
 const a=graph(source,operations),
  b=graph(source,[second,first]);
 assert.deepEqual(a.faces.map(f=>f.id),b.faces.map(f=>f.id));
 assert.deepEqual(a.faces.map(f=>f.cornerIds),
  b.faces.map(f=>f.cornerIds));
 const uvByFace=(g,set)=>Object.fromEntries(g.faces.map(face=>[
  face.id,face.cornerIds.map(id=>g.corners.find(c=>c.id===id)
   .attributes.uvSets[set])]));
 for(const set of ['TEXCOORD_0','TEXCOORD_1'])
  assert.deepEqual(uvByFace(a,set),uvByFace(b,set));
 const bySource=g=>Object.fromEntries(g.uvCornerRemaps.map(r=>[
  r.sourceFace,r.newAttributeVertices]));
 assert.notDeepEqual(bySource(a),bySource(b),
  'Physical row offsets are not persistent semantic vertex IDs');
});

test('copy-on-write keeps neighboring face untouched even when the two faces share original indices',()=>{
 const parsed=parseGlb(source),doc=parsed.json,
  prim=doc.meshes[0].primitives[0],idx=doc.accessors[prim.indices],
  view=doc.bufferViews[idx.bufferView],
  bin=parsed.chunks.find(c=>c.type===0x004e4942).data.slice(),
  offset=(view.byteOffset||0)+(idx.byteOffset||0),
  dv=new DataView(bin.buffer,bin.byteOffset,bin.byteLength),
  unit={5121:1,5123:2,5125:4}[idx.componentType],
  set={5121:'setUint8',5123:'setUint16',5125:'setUint32'}[idx.componentType];
 assert.equal(idx.count,6);
 for(const [k,v] of [1,3,2].entries())dv[set](offset+(k+3)*unit,v,true);
 const glb=writeGlb({...parsed,chunks:parsed.chunks.map(c=>
  c.type===0x004e4942?{...c,data:bin}:c)},doc);
 const originalIndices=faceIdx(glb),edited=applyMeshOperations(glb,[first]);
 assert.deepEqual(originalIndices[1],[1,3,2]);
 assert.deepEqual(faceIdx(edited)[0],[6,7,8]);
 assert.deepEqual(faceIdx(edited)[1],originalIndices[1]);
 assert.deepEqual(attr(edited,'TEXCOORD_0').slice(0,6),
  attr(glb,'TEXCOORD_0'));
 assert.deepEqual(attr(edited,'TEXCOORD_1').slice(0,6),
  attr(glb,'TEXCOORD_1'));
 assert.deepEqual(attr(edited,'WEIGHTS_0').slice(0,6),
  attr(glb,'WEIGHTS_0'));
 const g=graph(glb,[first]);
 assert.equal(g.diagnostics.uvCornerEditCount,1);
 assert.equal(g.diagnostics.nonManifoldEdges,0);
 assert.equal(g.faces[0].cornerIds.length,3);
 assert.equal(g.faces[1].cornerIds.length,3);
 // Original vertex 1 is shared across the two faces and stays unchanged.
 assert.deepEqual(attr(edited,'TEXCOORD_0')[1],
  attr(glb,'TEXCOORD_0')[1]);
 assert.ok(g.uvCornerRemaps[0].newAttributeVertices.includes(6));
});

test('reject unsupported UV set, out-of-range face, invalid delta, other topology mixes and unknown fields',async()=>{
 const bad=[
  [uv(99,0,[.1,.1])],
  [uv(0,3,[.1,.1])],
  [uv(0,0,[0,0])],
  [uv(0,0,[2,.1])],
  [{...first,evil:true}],
  [...Array.from({length:9},()=>first)],
  [first,{kind:'face.flip',meshIndex:0,primitiveIndex:0,face:0}],
  [{kind:'face.flip',meshIndex:0,primitiveIndex:0,face:0},first]
 ];
 for(const ops of bad)assert.throws(()=>
  applyMeshOperations(source,ops),/MARK_MESH_/);
 await assert.rejects(()=>createPreviewMarkscene(source,{
  edits:{meshOperations:[{...first,evil:true}]}
 }),/MARK_SCENE3_MESH_EDIT_FIELDS/);
 await assert.rejects(()=>createPreviewMarkscene(source,{
  edits:{meshOperations:[first,{kind:'face.flip',meshIndex:0,
   primitiveIndex:0,face:0}]}
 }),/MARK_SCENE3_MESH_UV_SEQUENCE/);
});

test('native editable .markscene persists UV operation history and lossless 70-joint GLB replay',async()=>{
 const native=await createPreviewMarkscene(source,{
  projectId:'pass25-uv-face-corner',edits:{
   meshSeamLinks:[],meshOperations:repeated}
 });
 const opened=await openPreviewMarkscene(native.archive);
 assert.deepEqual(opened.sourceGLB,source);
 assert.deepEqual(opened.edits.meshOperations,repeated);
 const exported=await exportEditedSourceGlb(opened);
 assert.deepEqual(exported.glb,applyMeshOperations(source,repeated));
 assert.equal(sha(opened.sourceGLB),sourceSha);
 assert.equal(compareGlbTextures(source,exported.glb).status,'pass_supported_png');
 const again=await createPreviewMarkscene(opened.sourceGLB,{
  projectId:'pass25-uv-face-corner',edits:opened.edits
 });
 assert.deepEqual((await exportEditedSourceGlb(
  await openPreviewMarkscene(again.archive))).glb,exported.glb);
 assert.deepEqual(graph(source,repeated).uvCornerRemaps,
  graph(opened.sourceGLB,opened.edits.meshOperations).uvCornerRemaps);
});

test('AI Bridge edits UV0+UV1 using CURRENT stable face ID, rejects fake face and restores undo',async()=>{
 const bridge=createAiBridge({allowWrites:true,buildHash:'p25'});
 let n=0;const call=async(method,params={})=>{
  const r=await bridge.request({requestId:'p25.'+(++n),method,params});
  assert.equal(r.ok,true,JSON.stringify(r.diagnostics));return r.result;
 };
 const caps=await call('studio.getCapabilities');
 assert.ok(caps.supported.includes('mesh.offsetUvFace'));
 const upload=await call('asset.upload',{
  type:'glb',name:'uv-70-bone.glb',data:source});
 await call('scene.open',{assetId:upload.assetId});
 const initial=await call('mesh.getMeshData',{
  meshId:'gltf-mesh-0',full:true});
 const ids=initial.faces.map(f=>f.id);
 assert.equal(ids.length,2);
 assert.ok(initial.uvSets.includes('TEXCOORD_0'));
 assert.ok(initial.uvSets.includes('TEXCOORD_1'));
 const forged=await bridge.request({
  requestId:'p25.forged',method:'mesh.offsetUvFace',
  params:{meshId:'gltf-mesh-0',primitiveIndex:0,
   faceId:ids[0]+'-forged',uvSet:0,delta:[.25,-.125]}
 });
 assert.equal(forged.ok,false);
 assert.ok(JSON.stringify(forged.diagnostics).includes('UV_STALE_FACE'));
 await call('mesh.offsetUvFace',{
  meshId:'gltf-mesh-0',primitiveIndex:0,
  faceId:ids[0],uvSet:0,delta:[.25,-.125]});
 await call('mesh.offsetUvFace',{
  meshId:'gltf-mesh-0',primitiveIndex:0,
  faceId:ids[1],uvSet:1,delta:[.175,.2]});
 const current=await call('mesh.getMeshData',{
  meshId:'gltf-mesh-0',full:true});
 assert.equal(current.diagnostics.uvCornerEditCount,2);
 assert.equal(current.diagnostics.triangleCount,2);
 assert.equal(current.uvCornerRemaps.length,2);
 assert.deepEqual(current.faces.map(f=>f.id),ids);
 const output=await call('scene.export'),saved=await call('scene.save');
 assert.deepEqual(output.data,applyMeshOperations(source,operations));
 const opened=await openPreviewMarkscene(saved.data);
 assert.deepEqual(opened.edits.meshOperations,operations);
 assert.deepEqual((await exportEditedSourceGlb(opened)).glb,output.data);
 await call('history.undo');
 assert.equal((await call('mesh.getStats',{
  meshId:'gltf-mesh-0'})).vertexCount,9);
 await call('history.redo');
 assert.deepEqual((await call('scene.export')).data,output.data);
 const clone=createAiBridge({allowWrites:true});
 let i=0;const ask=async(method,params={})=>{
  const r=await clone.request({
   requestId:'new.'+(++i),method,params});
  assert.equal(r.ok,true,JSON.stringify(r.diagnostics));return r.result;
 };
 const up=await ask('asset.upload',{
  type:'markscene',name:'p25.markscene',data:saved.data});
 await ask('scene.open',{assetId:up.assetId});
 assert.deepEqual((await ask('scene.export')).data,output.data);
 assert.deepEqual((await ask('mesh.getMeshData',{
  meshId:'gltf-mesh-0'})).uvCornerRemaps,current.uvCornerRemaps);
});
