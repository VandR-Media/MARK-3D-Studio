import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {buildRiggedFixture,buildStaticFixture} from '../scripts/pro-studio-glb-fixtures.mjs';
import {inspectRiggedGlb,comparePreservedRiggedGlb} from '../src/pro-studio/rigged-glb-audit.js';
import {createRigPreviewPack,openRigPreviewPack,reportRigPreviewRoundTrip} from '../src/pro-studio/rigpack-preview.js';
import {parseGlb,writeGlb} from '../src/glb.js';
import {inspectVisualImport} from '../src/visual-engine/glb-guard.js';
const fixture=buildRiggedFixture();
const modified=(change)=>{const parsed=parseGlb(fixture.bytes),doc=structuredClone(parsed.json);change(doc);
 return writeGlb(parsed,doc);};
function expectReject(bytes,code){assert.throws(()=>inspectRiggedGlb(bytes),error=>error.code===code,
 'required strict rejection of '+code);}

test('real binary fixture: 70 joint skin, 2 morph targets, 3 independent 12-second clips',()=>{
 const {bytes,doc,sha256}=fixture,audit=inspectRiggedGlb(bytes);
 assert.equal(sha256,createHash('sha256').update(bytes).digest('hex'));
 assert.equal(audit.skins.length,1);assert.equal(audit.skins[0].joints,70);
 assert.equal(audit.skinPrimitiveCount,1);assert.equal(audit.morphs[0].targets,2);
 assert.equal(audit.animations.length,3);
 assert.deepEqual(audit.animations.map(a=>a.durationSeconds),[12,12,12]);
 assert.ok(audit.animations.every(a=>a.channels===2&&a.paths.includes('weights')&&a.paths.includes('rotation')));
 assert.equal(audit.images,1);assert.equal(audit.textures,1);assert.equal(audit.materials,1);
 assert.equal(doc.nodes[1].skin,0);
 assert.equal(audit.warnings.length,0);
});

test('minimal static baseline is actually nonrigged and still inspectable',()=>{
 const s=buildStaticFixture(),audit=inspectRiggedGlb(s.bytes);
 assert.equal(audit.skins.length,0);assert.equal(audit.animations.length,0);
 assert.equal(audit.morphs[0].targets,0);assert.equal(audit.meshCount,1);
});

test('rig preview ZIP save → close → reopen → source GLB export is exactly lossless',()=>{
 const {archive,manifest,archiveSha256}=createRigPreviewPack(fixture.bytes,{
  projectId:'rig70-qa',name:'Animated rig transport QA',clipIndex:2,license:'test generated source'});
 assert.equal(manifest.selection.clipIndex,2);assert.equal(manifest.asset.sha256,fixture.sha256);
 const opened=openRigPreviewPack(archive);
 assert.equal(opened.manifest.selection.clipIndex,2);
 assert.equal(opened.archiveSha256,archiveSha256);
 assert.deepEqual(opened.glb,fixture.bytes);
 const report=reportRigPreviewRoundTrip(fixture.bytes,opened);
 assert.equal(report.status,'transport-only');
 assert.equal(report.sourcePreservation.status,'pass');
 assert.equal(report.sourcePreservation.exactBytesPreserved,true);
 assert.equal(comparePreservedRiggedGlb(fixture.bytes,opened.glb).status,'pass');
 assert.ok(report.unsupported.length);
});

test('reject invalid glTF joint references, missing bind matrices and unnormalized weights',()=>{
 expectReject(modified(d=>{d.skins[0].joints[1]=50000;}),'SKIN_JOINTS');
 expectReject(modified(d=>{d.skins[0].inverseBindMatrices=9999;}),'SKIN_BIND_MATRICES');
 expectReject(modified(d=>{d.meshes[0].primitives[0].attributes.WEIGHTS_0=undefined;}),'SKIN_ATTRIBUTES');
 expectReject(modified(d=>{d.meshes[0].primitives[0].attributes.WEIGHTS_0=d.meshes[0].primitives[0].attributes.POSITION;}),'SKIN_ATTRIBUTE_TYPE');
});

test('reject invalid glTF morph target count and animation channels/times',()=>{
 expectReject(modified(d=>{d.meshes[0].primitives[0].targets.pop();}),'MORPH_WEIGHTS');
 expectReject(modified(d=>{d.animations[0].channels[0].target.node=9999;}),'ANIMATION_CHANNEL');
 expectReject(modified(d=>{d.animations[0].samplers[0].output=d.animations[0].samplers[1].output;}),'ANIMATION_OUTPUT');
 expectReject(modified(d=>{d.animations[0].samplers[0].interpolation='MAGIC';}),'ANIMATION_SAMPLER');
});

test('reject unknown required extensions, truncated bufferViews, cycles, unsupported sparse data',()=>{
 expectReject(modified(d=>{d.extensionsUsed=['KHR_draco_mesh_compression'];
 d.extensionsRequired=['KHR_draco_mesh_compression'];}),'UNSUPPORTED_EXTENSION');
 expectReject(modified(d=>{d.bufferViews[0].byteLength=d.buffers[0].byteLength+100;}),'BUFFERVIEW_RANGE');
 expectReject(modified(d=>{d.nodes[2].children=[0];}),'NODE_CYCLE');
 expectReject(modified(d=>{d.accessors[0].sparse={count:1};}),'ACCESSOR_UNSUPPORTED');
});

test('ZIP tampering, wrong clip index, excessive assets and altered semantic data fail closed',()=>{
 const {archive}=createRigPreviewPack(fixture.bytes);
 const changed=archive.slice();changed[500]^=5;
 assert.throws(()=>openRigPreviewPack(changed),e=>/ZIP_CRC|ZIP_LOCAL|MANIFEST_JSON|ASSET_HASH/.test(e.message));
 assert.throws(()=>createRigPreviewPack(fixture.bytes,{clipIndex:20}),e=>e.code==='CLIP_INDEX');
 assert.throws(()=>createRigPreviewPack(fixture.bytes,{projectId:'../escape'}),e=>e.code==='PROJECT_ID');
 assert.throws(()=>openRigPreviewPack(new Uint8Array(80*1024*1024)),e=>e.code==='ZIP_BUDGET');
 assert.equal(comparePreservedRiggedGlb(fixture.bytes,buildStaticFixture().bytes).exactBytesPreserved,false);
});

test('the fixture generator is deterministic and clearly separate from the Neon Boy art gate',()=>{
 const again=buildRiggedFixture();assert.deepEqual(again.bytes,fixture.bytes);
 assert.match(fixture.doc.asset.extras.purpose,/not Neon Boy/);
 assert.ok(fixture.doc.scenes[0].name.includes('demonstrator'));
});

test('Release 1 prototype never changes v2 import compatibility or weakens its loss-prevention gate',()=>{
 const staticExample=buildStaticFixture();
 assert.equal(inspectVisualImport(staticExample.bytes).meshes,1);
 assert.throws(()=>inspectVisualImport(fixture.bytes),/Скелетный GLB/);
 const inspection=inspectRiggedGlb(fixture.bytes);
 assert.equal(inspection.skins[0].joints,70);
});



test('real BIN corruption: reject invalid joint palette indices, vertex weight sums and keyframe times',()=>{
 const corrupt=(accessorIndex,patch)=>{
  const p=parseGlb(fixture.bytes),doc=structuredClone(p.json);
  const copy=p.chunks.map(x=>({type:x.type,data:x.data.slice()}));
  const bin=copy.find(x=>x.type===0x004e4942).data;
  const a=doc.accessors[accessorIndex],view=doc.bufferViews[a.bufferView];
  const dv=new DataView(bin.buffer,bin.byteOffset,bin.byteLength);
  patch(dv,(view.byteOffset||0)+(a.byteOffset||0));
  return writeGlb({json:doc,chunks:copy},doc);
 };
 const attrs=fixture.doc.meshes[0].primitives[0].attributes;
 expectReject(corrupt(attrs.JOINTS_0,(dv,p)=>dv.setUint16(p,999,true)),'SKIN_JOINT_RANGE');
 expectReject(corrupt(attrs.WEIGHTS_0,(dv,p)=>dv.setFloat32(p,1.5,true)),'SKIN_WEIGHT_SUM');
 const time=fixture.doc.animations[0].samplers[0].input;
 expectReject(corrupt(time,(dv,p)=>dv.setFloat32(p+4,-2,true)),'ANIMATION_TIMES');
});
