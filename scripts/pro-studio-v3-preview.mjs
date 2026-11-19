/**
 * Reproducible headless release-1 native .markscene v3 subset evidence.
 * The exact original skinned/morphed/animated GLB remains in archive;
 * only a declared node TRS and PBR override are exported as modifications.
 */
import {mkdirSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {buildRiggedFixture} from './pro-studio-glb-fixtures.mjs';
import {createPreviewMarkscene,openPreviewMarkscene,
 exportEditedSourceGlb,repackPreviewMarkscene} from '../src/pro-studio/markscene-v3-preview.js';
import {inspectRiggedGlb} from '../src/pro-studio/rigged-glb-audit.js';
import {compareGlbSemantics} from '../src/pro-studio/glb-semantic-diff.js';
const output=resolve('dist/pro-studio/native-scene');
mkdirSync(output,{recursive:true});
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
function save(path,data){
 const dest=join(output,path);writeFileSync(dest,data);
 return{file:path,bytes:data.length,sha256:sha(data)};
}
try{
 const fixture=buildRiggedFixture();
 const project=await createPreviewMarkscene(fixture.bytes,{
  projectId:'mark-rig-p4',name:'MARK rig 70 joints - editable native subset',
  license:'internal-generated-fixture',extra:{
   provenance:'Deterministically generated GLB, not owner-approved Neon Boy'
  }
 });
 const opened=await openPreviewMarkscene(project.archive);
 const edits={nodeTransforms:{'1':{translation:[.36,0,0]}},
  materialPbr:{'0':{roughnessFactor:.23}},
  selection:{clipIndex:2,timeSeconds:6}};
 const saved=await repackPreviewMarkscene(opened,edits);
 const reopened=await openPreviewMarkscene(saved.archive);
 const exported=await exportEditedSourceGlb(reopened);
 const checked=inspectRiggedGlb(exported.glb);
 const numeric=compareGlbSemantics(fixture.bytes,exported.glb,{
  allowEditedNodes:['SkinnedQuad'],allowEditedMaterials:[0]});
 const archive=save('rig-70-morph-3clips-experimental.markscene',saved.archive);
 const outputGLB=save('rig-70-edited-native-export.glb',exported.glb);
 const sourceGLB=save('rig-70-original.glb',fixture.bytes);
 const tests=[
  {testId:'MARKSCENE-V3-NATIVE-001',status:reopened.sourceSha256===fixture.sha256?'pass':'fail',
   metrics:{originalSha256:fixture.sha256,nativeSourceHash:reopened.sourceSha256}},
  {testId:'MARKSCENE-V3-EDITS-002',status:
   reopened.edits.nodeTransforms['1'].translation[0]===.36&&
   reopened.edits.materialPbr['0'].roughnessFactor===.23?'pass':'fail'},
  {testId:'MARKSCENE-V3-RIG-003',status:checked.skins[0].joints===70&&
   checked.morphs[0].targets===2&&checked.animations.length===3?'pass':'fail'},
  {testId:'MARKSCENE-V3-NUMERIC-004',status:numeric.status==='pass_partial_profile'?'pass':'fail',
   metrics:{comparisons:numeric.numericComparisons,unverified:numeric.unverified,
    errors:numeric.errors}}
 ];
 const status=tests.every(t=>t.status==='pass')?'pass':'fail';
 const report={
  schema:'mark.experimental-native-scene-proof/1',status,
  sourceCommit:process.env.MARK_SOURCE_SHA||process.env.GITHUB_SHA||'local-unverified',
  backend:'headless Node.js, NOT physical Huawei and NOT WebGL',
  format:'mark.professional-scene/3-preview',
  artifactStatus:'experimental editable subset; no mesh/rig weight authoring',
  files:{archive,outputGLB,sourceGLB},tests,numeric,
  remaining:['production .markscene v3 transaction/recovery','mesh/UV/weight editing',
   'full glTF texture/image/sampler fidelity','artistic Neon Boy and real Huawei GPU']
 };
 writeFileSync(join(output,'native-scene-report.json'),JSON.stringify(report,null,2)+'\n');
 console.log('MARK NATIVE V3 '+status.toUpperCase(),
  JSON.stringify({sourceCommit:report.sourceCommit,
   tests:tests.map(t=>({id:t.testId,status:t.status})),
   archive:archive.sha256,export:outputGLB.sha256}));
 if(status!=='pass')process.exitCode=1;
}catch(error){console.error('MARK NATIVE V3 FAIL',error);process.exitCode=1;}
