/**
 * MARK Professional Studio Release 1 preview: reproducible transport audit.
 * This intentionally does NOT claim actual renderer animation, glTFExporter
 * after authoring, or native .markscene v3. Use the report's skipped gates.
 */
import {mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {resolve,basename} from 'node:path';
import {createHash} from 'node:crypto';
import {buildRiggedFixture} from './pro-studio-glb-fixtures.mjs';
import {inspectRiggedGlb} from '../src/pro-studio/rigged-glb-audit.js';
import {createRigPreviewPack,openRigPreviewPack,reportRigPreviewRoundTrip} from '../src/pro-studio/rigpack-preview.js';

function sha(b){return createHash('sha256').update(b).digest('hex');}
export function buildRigPreviewEvidence({inputGlb,sourceName='rig70-morph2-clips3.glb',outDir='dist/pro-studio/release1-preview',sourceCommit='local-unverified'}={}){
 const bytes=inputGlb||buildRiggedFixture().bytes;
 const out=resolve(outDir);mkdirSync(out,{recursive:true});
 const inspected=inspectRiggedGlb(bytes);
 const {archive,manifest}=createRigPreviewPack(bytes,{
  projectId:'rig-transport-preview',name:'MARK Rigged GLB semantic transport preview',
  clipIndex:inspected.animations.length?0:0,sourceName});
 const reopened=openRigPreviewPack(archive);
 const proof=reportRigPreviewRoundTrip(bytes,reopened);
 const tests=[
  {testId:'RIG-FIXTURE-001',status:'pass',metrics:{skins:inspected.skins.length,
   joints:inspected.skins.reduce((n,s)=>n+s.joints,0),morphTargets:inspected.morphs.reduce((n,m)=>n+m.targets,0),
   clips:inspected.animations.length}},
  {testId:'RIG-PACK-001',status:proof.sourcePreservation.exactBytesPreserved?'pass':'fail',
   metrics:{byteExact:proof.sourcePreservation.exactBytesPreserved}},
  {testId:'RIG-VIEWPORT-001',status:'skip',reason:'No WebGL2 GLTFLoader/mixer pose screenshot in this transport-only tool'},
  {testId:'RIG-EXPORT-001',status:'skip',reason:'Original GLB bytes preserved, not GLTFExporter re-serialization of an edited mesh'},
  {testId:'RIG-NATIVE-SCENE-001',status:'skip',reason:'.markrigpack experimental; production v3 .markscene not implemented'},
  {testId:'NEON-BOY-001',status:'skip',reason:'Reference Neon Boy GLB and approved art images were not provided as verified inputs'},
  {testId:'HUAWEI-GPU-001',status:'skip',reason:'No physical Huawei device measured'}
 ];
 const failures=tests.filter(t=>t.status==='fail');
 const report={schema:'mark.qa.rig-preview/1',featureId:'RIG-001',
  appVersion:'0.7.0-alpha.0',sourceCommit,backend:'headless Node / no GPU',
  status:failures.length?'fail':'partial',
  input:{sourceName,sha256:inspected.sha256,bytes:bytes.length},
  output:{format:manifest.schema,archive:'sample.markrigpack',archiveSha256:sha(archive),
   preservedGLB:'source-roundtrip.glb',preservedGLBSha256:sha(reopened.glb)},
  tests,semantic:inspected,limitations:proof.unsupported};
 writeFileSync(resolve(out,'source-original.glb'),bytes);
 writeFileSync(resolve(out,'source-roundtrip.glb'),reopened.glb);
 writeFileSync(resolve(out,'sample.markrigpack'),archive);
 writeFileSync(resolve(out,'qa-report.json'),JSON.stringify(report,null,2)+'\n');
 if(failures.length)throw Error('Rig transport failed: '+JSON.stringify(failures));
 return report;
}
const invoked=process.argv[1]&&resolve(process.argv[1])===new URL(import.meta.url).pathname;
if(invoked){
 const filename=process.argv[2];
 const input=filename?readFileSync(filename):undefined;
 const report=buildRigPreviewEvidence({inputGlb:input,sourceName:filename?basename(filename):'rig70-morph2-clips3.glb',
  outDir:process.argv[3]||'dist/pro-studio/release1-preview',
  sourceCommit:process.env.GITHUB_SHA||'local-unverified'});
 console.log(JSON.stringify({status:report.status,sourceSha:report.input.sha256,
  tests:report.tests.map(t=>[t.testId,t.status]),out:report.output},null,2));
}

