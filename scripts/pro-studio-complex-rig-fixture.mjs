/**
 * Self-contained real multimesh skinned + morphed 3-clip binary GLB fixture.
 * Procedurally assembled from original valid binary glTF 2.0 accessors.
 *
 * Intended as a mesh/skin/clip roundtrip technical TEST ONLY.
 * Its 12 flat PBR panels form a segmented character silhouette; this is
 * NOT a volumetric artist-approved Neon Boy, and NO authored weight painting.
 * Blender is NOT used to generate this fixture.
 */
import {buildRiggedFixture} from './pro-studio-glb-fixtures.mjs';
import {parseGlb,writeGlb} from '../src/glb.js';
import {createHash} from 'node:crypto';
import {resolve,dirname} from 'node:path';
import {mkdirSync,writeFileSync} from 'node:fs';

export function buildComplexRigFixture(){
 const base=buildRiggedFixture({bones:70,morphs:2,clips:3});
 const source=parseGlb(base.bytes),doc=structuredClone(source.json);
 doc.asset.generator='MARK Studio independent 12-part GLB rig stress fixture, P6';
 doc.asset.extras={
  ...doc.asset.extras,rigTechnicalBenchmark:true,
  artisticApproval:false,
  geometryMethod:'12 planar panels, not organic manifold human',
  blenderRequired:false
 };
 doc.materials.push(
  {name:'Ruby Cloth',pbrMetallicRoughness:{
   baseColorFactor:[.9,.17,.23,1],baseColorTexture:{index:0},metallicFactor:.15,
   roughnessFactor:.52},doubleSided:true},
  {name:'Dark Pants',pbrMetallicRoughness:{
   baseColorFactor:[.18,.21,.29,1],baseColorTexture:{index:0},metallicFactor:.05,
   roughnessFactor:.81},doubleSided:true},
  {name:'Skin Tone',pbrMetallicRoughness:{
   baseColorFactor:[.92,.63,.44,1],baseColorTexture:{index:0},metallicFactor:0,
   roughnessFactor:.66},doubleSided:true}
 );
 doc.meshes[0].name='Torso base / skinned morph';
 doc.nodes[1].name='SkinnedQuad'; // old name preserved for v2 QA, not the final art label
 doc.nodes[1].scale=[.72,.88,.52];
 doc.nodes[1].translation=[0,.55,0];
 // These are independent glTF mesh nodes and materials while sharing the
 // same validated 70-joint rig, baked weights, UVs and 2 real morph arrays.
 const additional=[
  ['head-front', 0,1.74,.08, .52,.40,.70,3],
  ['head-back',0,1.74,-.08, .52,.40,.70,3],
  ['arm-upper-L',-.59,1.05,0, .30,.53,.47,1],
  ['arm-upper-R', .59,1.05,0, .30,.53,.47,1],
  ['arm-fore-L',-.62,.66,0,.23,.42,.47,3],
  ['arm-fore-R', .62,.66,0,.23,.42,.47,3],
  ['leg-upper-L',-.22,-.38,0,.36,.72,.50,2],
  ['leg-upper-R', .22,-.38,0,.36,.72,.50,2],
  ['leg-lower-L',-.22,-.93,0,.28,.55,.50,2],
  ['leg-lower-R', .22,-.93,0,.28,.55,.50,2],
  ['backpack',0,.86,-.17,.55,.60,.55,1]
 ];
 for(const [name,x,y,z,sx,sy,sz,material] of additional){
  const mesh=structuredClone(doc.meshes[0]);
  mesh.name=name+'-skin-morph';
  mesh.primitives[0].material=material;
  mesh.weights=[0,0];
  const meshId=doc.meshes.length;doc.meshes.push(mesh);
  const nodeId=doc.nodes.length;
  doc.nodes.push({name,mesh:meshId,skin:0,
   translation:[x,y,z],scale:[sx,sy,sz]});
  doc.nodes[0].children.push(nodeId);
 }
 // 12 unique mesh datablocks and 12 skinned mesh nodes.
 const bytes=writeGlb(source,doc);
 return {bytes,doc,sha256:createHash('sha256').update(bytes).digest('hex'),
  expected:{skins:1,bones:70,clips:3,morphsPerMesh:2,
   meshes:12,materials:4,skinnedMeshes:12,embeddedPng:1,
   method:'procedural flat-panel test, not Neon Boy'}};
}
if(process.argv[1]?.endsWith('pro-studio-complex-rig-fixture.mjs')){
 const path=resolve(process.argv[2]||'dist/pro-studio/complex-rig/complex-rig70-12parts-3clips.glb');
 const fixture=buildComplexRigFixture();mkdirSync(dirname(path),{recursive:true});
 writeFileSync(path,fixture.bytes);
 console.log('MARK COMPLEX GLB FIXTURE',JSON.stringify({
  path,sha256:fixture.sha256,bytes:fixture.bytes.length,
  expected:fixture.expected
 }));
}
