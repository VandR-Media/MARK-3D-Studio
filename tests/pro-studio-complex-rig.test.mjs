import test from 'node:test';
import assert from 'node:assert/strict';
import {buildComplexRigFixture} from '../scripts/pro-studio-complex-rig-fixture.mjs';
import {inspectRiggedGlb} from '../src/pro-studio/rigged-glb-audit.js';
import {parseGlb} from '../src/glb.js';
import {createAiBridge} from '../src/pro-studio/ai-bridge-core.js';
import {createPreviewMarkscene,openPreviewMarkscene,exportEditedSourceGlb}
 from '../src/pro-studio/markscene-v3-preview.js';
import {compareGlbSemantics} from '../src/pro-studio/glb-semantic-diff.js';
import {compareGlbTextures} from '../src/pro-studio/glb-texture-qa.js';

const fixture=buildComplexRigFixture();
test('independent technical multi-mesh GLB has 12 independently placed skinned meshes, 70 joints, 2 morphs, 3 clips, valid PBR PNG',()=>{
 const doc=parseGlb(fixture.bytes).json;
 const audit=inspectRiggedGlb(fixture.bytes);
 assert.equal(doc.meshes.length,12);
 assert.equal(doc.materials.length,4);
 assert.equal(doc.nodes.filter(n=>n.skin!==undefined).length,12);
 assert.equal(doc.skins[0].joints.length,70);
 assert.equal(audit.skins[0].joints,70);
 assert.equal(audit.animations.length,3);
 assert.equal(audit.morphs.length,12);
 assert.ok(audit.morphs.every(x=>x.targets===2));
 assert.equal(audit.skinPrimitiveCount,12);
 assert.ok(doc.materials.every(m=>m.pbrMetallicRoughness.baseColorTexture.index===0));
 assert.equal(compareGlbTextures(fixture.bytes,fixture.bytes).status,'pass_supported_png');
 assert.equal(fixture.doc.asset.extras.artisticApproval,false);
});
test('complex model original GLB exact source survives native project + edit/export + reopening',async()=>{
 const initial=await createPreviewMarkscene(fixture.bytes,{
  projectId:'complex-70-technical',name:'12-skinned-part stress fixture',
  license:'generated-test-fixture',
  edits:{nodeTransforms:{'1':{translation:[.22,0,0]}},
   materialPbr:{'0':{roughnessFactor:.35}},
   selection:{clipIndex:2,timeSeconds:6}}
 });
 const loaded=await openPreviewMarkscene(initial.archive);
 assert.equal(loaded.sourceSha256,fixture.sha256);
 assert.equal(loaded.manifest.sceneGraph.length,fixture.doc.nodes.length);
 assert.equal(loaded.manifest.sourceSummary.clips.length,3);
 assert.equal(loaded.manifest.sourceSummary.morphCounts.length,12);
 const exported=await exportEditedSourceGlb(loaded);
 const second=inspectRiggedGlb(exported.glb);
 assert.equal(second.skins[0].joints,70);
 assert.equal(second.morphs.length,12);
 assert.equal(second.animations.length,3);
 const diff=compareGlbSemantics(fixture.bytes,exported.glb,{
  allowEditedNodes:['SkinnedQuad'],allowEditedMaterials:[0]});
 assert.equal(diff.status,'pass_partial_profile',JSON.stringify(diff.errors.slice(0,5)));
 assert.equal(compareGlbTextures(fixture.bytes,exported.glb).status,'pass_supported_png');
});
test('AI Bridge transaction edits 12-mesh character without changing original GLB asset',async()=>{
 const b=createAiBridge({allowWrites:true,buildHash:'12-mesh-test'});
 const call=async(method,params)=>{
  const r=await b.request({requestId:'stress-'+method,method,params});
  assert.equal(r.ok,true,JSON.stringify(r.diagnostics));
  return r.result;
 };
 const upload=await call('asset.upload',{
  name:'complex-rig.glb',type:'glb',data:fixture.bytes});
 await call('scene.open',{assetId:upload.assetId});
 const info=await call('scene.getHierarchy');
 assert.equal(info.nodes.length,fixture.doc.nodes.length);
 const transaction=await call('transaction.begin',{});
 await call('object.setTransform',{
  uuid:'gltf-node-1',transform:{translation:[.2,0,0]}});
 await call('material.setPbr',{
  materialId:'gltf-material-0',pbr:{roughnessFactor:.25}});
 await call('animation.preview',{clipIndex:2,timeSeconds:8});
 await call('transaction.commit',{transactionId:transaction.transactionId});
 const project=await call('scene.save');
 const opened=await openPreviewMarkscene(project.data);
 assert.equal(opened.sourceSha256,fixture.sha256);
 assert.equal(opened.edits.selection.clipIndex,2);
 assert.equal(opened.edits.selection.timeSeconds,8);
 const output=await call('scene.export');
 assert.equal(parseGlb(output.data).json.materials[0].pbrMetallicRoughness.roughnessFactor,.25);
});
