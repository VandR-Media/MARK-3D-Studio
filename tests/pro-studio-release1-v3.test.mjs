import test from 'node:test';
import assert from 'node:assert/strict';
import {buildRiggedFixture} from '../scripts/pro-studio-glb-fixtures.mjs';
import {inspectRiggedGlb} from '../src/pro-studio/rigged-glb-audit.js';
import {parseGlb,writeGlb} from '../src/glb.js';
import {createPreviewMarkscene,openPreviewMarkscene,repackPreviewMarkscene,
 exportEditedSourceGlb,sha256} from '../src/pro-studio/markscene-v3-preview.js';
import {compareGlbSemantics} from '../src/pro-studio/glb-semantic-diff.js';
const {bytes}=buildRiggedFixture();
const nodeName='SkinnedQuad';
const edits={
 nodeTransforms:{'1':{translation:[.33,0,0]}},
 materialPbr:{'0':{roughnessFactor:.18,metallicFactor:.55}},
 selection:{clipIndex:2,timeSeconds:6}
};

test('experimental native .markscene v3 saves exact original GLB separately from editable project metadata',async()=>{
 const saved=await createPreviewMarkscene(bytes,{
  projectId:'release1-rig-qa',name:'Rig Preview',
  license:'internal-fixture',edits,extra:{artistNote:'preserve unknown optional'}
 });
 const opened=await openPreviewMarkscene(saved.archive);
 assert.equal(opened.manifest.schema,'mark.professional-scene/3-preview');
 assert.equal(opened.manifest.schemaVersion,3);
 assert.equal(opened.manifest.sceneGraph.length,72);
 assert.equal(opened.manifest.assetManifest.length,1);
 assert.equal(opened.manifest.sourceSummary.skinJoints[0],70);
 assert.deepEqual(opened.manifest.sourceSummary.morphCounts,[2]);
 assert.equal(opened.manifest.sourceSummary.clips.length,3);
 assert.deepEqual(opened.edits,edits);
 assert.equal(opened.manifest.extensions.artistNote,'preserve unknown optional');
 assert.deepEqual(opened.sourceGLB,bytes);
 assert.equal(opened.sourceSha256,await sha256(bytes));
 assert.equal(opened.manifest.checksums['assets/source.glb'],await sha256(bytes));
 assert.equal(opened.manifest.units,'meters');
});

test('re-open and edit existing project, then export true GLB with modified TRS/PBR and unmodified skin/animation BIN',async()=>{
 const first=await openPreviewMarkscene((await createPreviewMarkscene(bytes)).archive);
 const modified=await repackPreviewMarkscene(first,edits);
 const opened=await openPreviewMarkscene(modified.archive);
 assert.equal(opened.edits.nodeTransforms['1'].translation[0],.33);
 const exported=await exportEditedSourceGlb(opened);
 assert.equal(exported.modifiedNodeCount,1);
 assert.equal(exported.modifiedMaterialCount,1);
 assert.equal(exported.preservesOriginalBinary,true);
 const a=parseGlb(bytes),b=parseGlb(exported.glb);
 assert.deepEqual(b.json.nodes[1].translation,[.33,0,0]);
 assert.equal(b.json.materials[0].pbrMetallicRoughness.roughnessFactor,.18);
 assert.equal(b.json.materials[0].pbrMetallicRoughness.metallicFactor,.55);
 assert.deepEqual(b.chunks.at(-1).data,a.chunks.at(-1).data);
 const inventory=inspectRiggedGlb(exported.glb);
 assert.equal(inventory.skins[0].joints,70);
 assert.equal(inventory.animations.length,3);
 assert.equal(inventory.morphs[0].targets,2);
 const numeric=compareGlbSemantics(bytes,exported.glb,{
  allowEditedNodes:[nodeName],allowEditedMaterials:[0]});
 assert.equal(numeric.status,'pass_partial_profile',JSON.stringify(numeric.errors));
 assert.ok(numeric.numericComparisons>30);
});

test('repack keeps unknown optional manifest keys and source SHA without dropping user metadata',async()=>{
 const created=await createPreviewMarkscene(bytes,{extra:{custom:'one'}});
 const opened=await openPreviewMarkscene(created.archive);
 opened.manifest.futureOptional={vendor:'MARK',value:5};
 const updated=await repackPreviewMarkscene(opened,edits);
 const read=await openPreviewMarkscene(updated.archive);
 assert.deepEqual(read.manifest.futureOptional,{vendor:'MARK',value:5});
 assert.deepEqual(read.manifest.extensions,{custom:'one'});
 assert.equal(read.sourceSha256,opened.sourceSha256);
});

test('modified GLB fails comparison if edits were not authorized',async()=>{
 const p=await openPreviewMarkscene((await createPreviewMarkscene(bytes,{edits})).archive);
 const out=await exportEditedSourceGlb(p);
 const diff=compareGlbSemantics(bytes,out.glb);
 assert.equal(diff.status,'fail');
 assert.ok(diff.errors.some(x=>x.key?.includes('node.SkinnedQuad.translation')));
 assert.ok(diff.errors.some(x=>x.key?.includes('material.0.roughness')));
});

test('numeric semantic comparator detects animation sampler loss without relying on counts',()=>{
 const a=parseGlb(bytes),doc=structuredClone(a.json);
 doc.animations[0].samplers[0].output=doc.animations[0].samplers[0].input;
 const altered=writeGlb(a,doc);
 assert.equal(inspectRiggedGlb(altered).animations.length,3);
 const result=compareGlbSemantics(bytes,altered);
 assert.equal(result.status,'fail');
 assert.ok(result.errors.some(x=>x.key?.includes('.values')));
});

test('native archive refuses corruption, unknown schema, invalid edits and out-of-budget metadata',async()=>{
 const packed=await createPreviewMarkscene(bytes);
 const broken=packed.archive.slice();
 // A single byte change in the archived GLB must be rejected before parse.
 const marker=new TextEncoder().encode('glTF');
 let pos=-1;
 for(let i=0;i<broken.length-marker.length;i++){
  if(marker.every((b,j)=>broken[i+j]===b)){pos=i;break;}
 }
 assert.ok(pos>=0);
 broken[pos]^=1;
 await assert.rejects(()=>openPreviewMarkscene(broken),/ZIP_CRC|ASSET_SHA/);
 const cases=[
  {nodeTransforms:{'999':{translation:[0,0,0]}}},
  {nodeTransforms:{'1':{scale:[0,1,1]}}},
  {nodeTransforms:{'1':{rotation:[0,0,0,2]}}},
  {materialPbr:{'0':{roughnessFactor:12}}},
  {selection:{clipIndex:12,timeSeconds:0}}
 ];
 for(const value of cases)
  await assert.rejects(()=>createPreviewMarkscene(bytes,{edits:value}),/MARK_SCENE3_/);
 await assert.rejects(()=>createPreviewMarkscene(bytes,{extra:{text:'x'.repeat(300000)}}),
  /MANIFEST_BUDGET/);
});

test('v3 subset is distinguishable from legacy JSON v2 and old transport .markrigpack',async()=>{
 const newer=await createPreviewMarkscene(bytes);
 const opened=await openPreviewMarkscene(newer.archive);
 assert.equal(opened.manifest.formatStatus,'EXPERIMENTAL_EDITABLE_SUBSET');
 assert.notEqual(opened.manifest.schema,'mark.visual-scene/2');
 assert.notEqual(opened.manifest.schema,'mark.rigpack-preview/1');
 assert.deepEqual(opened.manifest.unimplemented.includes('weight paint'),true);
});
