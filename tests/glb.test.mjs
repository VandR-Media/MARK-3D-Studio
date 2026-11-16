import {describe,it} from 'node:test';
import assert from 'node:assert/strict';
import {createSampleGlb} from '../src/sample.js';
import {parseGlb,writeGlb,assertSelfContainedGlb} from '../src/glb.js';
import {getMaterialValues,setMaterialValues,hexToLinearRgb,linearRgbToHex} from '../src/materials.js';
const sample=createSampleGlb();
describe('Actual polygonal GLB',()=>{
 it('contains a real binary polygon mesh, UVs, normals and PBR',()=>{
  const {json,chunks}=parseGlb(sample);
  assert.equal(json.asset.version,'2.0');
  assert.equal(json.accessors[0].count,6240);
  assert.equal(json.accessors[3].count,37440);
  assert.ok(json.meshes.length>0);
  assert.ok(chunks.some(c=>c.type===0x004e4942));
 });
 it('edits PBR and preserves mesh, animation/skin metadata and binary payload',()=>{
  const before=parseGlb(sample),draft=structuredClone(before.json),orig=JSON.stringify(before.json);
  setMaterialValues(draft,0,{hex:'#47b7ef',metallic:.63,roughness:.24});
  const after=parseGlb(writeGlb(before,draft));
  assert.deepEqual(after.json.meshes,before.json.meshes);
  assert.deepEqual(after.json.accessors,before.json.accessors);
  assert.deepEqual(after.json.bufferViews,before.json.bufferViews);
  assert.deepEqual(after.json.animations,before.json.animations);
  assert.deepEqual(after.json.skins,before.json.skins);
  assert.deepEqual(after.chunks.slice(1),before.chunks.slice(1));
  assert.deepEqual(getMaterialValues(after.json,0),{...getMaterialValues(draft,0)});
  assert.equal(JSON.stringify(before.json),orig);
 });
 it('roundtrips without changing GLB binary chunks',()=>{
  const original=parseGlb(sample),again=parseGlb(writeGlb(original));
  assert.deepEqual(again.json,original.json);
  assert.deepEqual(again.chunks.slice(1),original.chunks.slice(1));
 });
 it('rejects GLB external sidecars',()=>{
  assert.throws(()=>assertSelfContainedGlb({buffers:[{uri:'mesh.bin'}]}),/внешние/);
  assert.throws(()=>assertSelfContainedGlb({images:[{uri:'hair.png'}]}),/внешние/);
  assert.doesNotThrow(()=>assertSelfContainedGlb({images:[{uri:'data:image/png;base64,AA=='}]}));
 });
 it('rejects corrupted headers and chunks',()=>{
  const a=Buffer.from(sample);a.writeUInt32LE(0,0);assert.throws(()=>parseGlb(a),/сигнатура/);
  const b=Buffer.from(sample);b.writeUInt32LE(99,8);assert.throws(()=>parseGlb(b),/Длина/);
  const c=Buffer.from(sample);c.writeUInt32LE(0xffffffff,12);assert.throws(()=>parseGlb(c),/размер/);
 });
});
describe('Linear glTF materials',()=>{
 it('correctly converts sRGB <-> linear factors',()=>{
  for(const hex of ['#ffffff','#000000','#57a2df','#a52a2a'])assert.equal(linearRgbToHex(hexToLinearRgb(hex)),hex);
  assert.ok(Math.abs(hexToLinearRgb('#808080')[0]-.216)<.002);
 });
 it('keeps texture and transparency when changing color',()=>{
  const doc={materials:[{pbrMetallicRoughness:{baseColorFactor:[1,1,1,.4],baseColorTexture:{index:2}}}]};
  setMaterialValues(doc,0,{hex:'#112233',metallic:.1,roughness:.9});
  assert.equal(doc.materials[0].pbrMetallicRoughness.baseColorFactor[3],.4);
  assert.deepEqual(doc.materials[0].pbrMetallicRoughness.baseColorTexture,{index:2});
 });
 it('rejects invalid materials',()=>{
  const doc={materials:[{}]};
  assert.throws(()=>setMaterialValues(doc,0,{hex:'red',metallic:0,roughness:1}),/Цвет/);
  assert.throws(()=>setMaterialValues(doc,0,{hex:'#123456',metallic:4,roughness:1}),/Металличность/);
  assert.throws(()=>getMaterialValues(doc,1),/найден/);
 });
});