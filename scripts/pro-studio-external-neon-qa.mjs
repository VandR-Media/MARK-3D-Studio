/**
 * Transient EXTERNAL BENCHMARK: asset from a separate (Blender Cloud) GitHub
 * workflow, without making Blender a runtime dependency of MARK Studio.
 *
 * Note: This source is a *stylized interpretation*, not owner-art-approved.
 * It only has 17 bones, 1 animation, 0 morphs. A PASS for supported import
 * cannot close the 70-joint / 3-clip / face-morph production acceptance gate.
 */
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {chromium} from 'playwright';
import {inspectRiggedGlb} from '../src/pro-studio/rigged-glb-audit.js';
import {createPreviewMarkscene,openPreviewMarkscene,exportEditedSourceGlb}
 from '../src/pro-studio/markscene-v3-preview.js';
import {compareGlbSemantics} from '../src/pro-studio/glb-semantic-diff.js';
import {compareGlbTextures} from '../src/pro-studio/glb-texture-qa.js';
import {parseGlb} from '../src/glb.js';

const provenance={
 source:'VandR-Media/MARK-3D-Studio, separate Blender Cloud experimental branch',
 workflowRun:44398211839,workflowArtifact:'MARK-Neon-Boy-Review',
 file:'output/NEON_BOY_DANCE.glb',
 expectedSha256:'195775972bbfa60db770fe57ad435b58325ac694f29898f1da9c2af5f79d255a',
 artApproved:false,sourceBones:17,sourceClips:1,sourceMorphs:0
};
const SHA=b=>createHash('sha256').update(b).digest('hex');
const output=resolve('dist/pro-studio/external-benchmark');
mkdirSync(output,{recursive:true});
const report={
 schema:'mark.external-neon-qa/1',provenance,sourceCommit:process.env.MARK_SOURCE_SHA||process.env.GITHUB_SHA||'local-unverified',
 device:'CI Chromium SwiftShader, not real Huawei',
 status:'not_run',tests:[],artifacts:[],blockers:[],
 supportedProfile:'skinned-mesh + animation + material + native transport, NO sculpt / weight edit'
};
function test(id,condition,metrics,reason=''){
 const status=condition?'pass':'fail';report.tests.push({testId:id,status,metrics,reason:condition?'':reason});
 if(!condition)throw Error(id+': '+reason);
}
function save(name,data){
 const path=join(output,name);writeFileSync(path,data);
 const record={path:name,bytes:data.length,sha256:SHA(data)};
 report.artifacts.push(record);return record;
}
function finish(){
 report.status=report.tests.some(x=>x.status==='fail')?'fail':
  report.tests.every(x=>x.status==='skip')?'skip':'pass_supported_profile';
 report.blockers=['Owner has not approved source artwork', '17 bones rather than target 70',
  '1 dance clip rather than target 3', 'No face morphs', 'No 3D mesh/weight authoring',
  'No performance run on real Huawei device'];
 writeFileSync(join(output,'external-neon-report.json'),JSON.stringify(report,null,2)+'\n');
 console.log('MARK EXTERNAL NEON',report.status.toUpperCase(),
  JSON.stringify({sourceCommit:report.sourceCommit,
   tests:report.tests.map(x=>({id:x.testId,status:x.status})),errors:report.errors||[],
   files:report.artifacts.map(x=>x.path)}));
 if(report.status==='fail')process.exitCode=1;
}
const filename=process.env.MARK_EXTERNAL_GLB;
if(!filename){
 report.tests.push({testId:'EXT-ASSET-AVAILABILITY',status:'skip',
  reason:'External GitHub Actions artifact not supplied or expired; not a PASS'});
 finish();
}else{
 let browser;
 try{
  const glb=readFileSync(resolve(filename)),hash=SHA(glb);
  test('EXT-NEON-PROVENANCE-001',hash===provenance.expectedSha256,
   {actual:hash,expected:provenance.expectedSha256},'Artifact file SHA changed unexpectedly');
  const inventory=inspectRiggedGlb(glb);
  const doc=parseGlb(glb).json;
  test('EXT-NEON-IMPORT-002',doc.nodes.length===296&&doc.meshes.length===278&&
   doc.materials.length===24&&inventory.skins.length===1&&
   inventory.skins[0].joints===17&&inventory.animations.length===1,
   {nodes:doc.nodes.length,meshes:doc.meshes.length,
    materials:doc.materials.length,skins:inventory.skins,clips:inventory.animations,
    morphs:inventory.morphs},'Real external glTF audit does not match known source inventory');
  const native=await createPreviewMarkscene(glb,{
   projectId:'neon-boy-external-qa',name:'Neon Boy external source (technical QA)',
   license:'owner-repository-generated-evidence',extra:{provenance,artApproved:false}
  });
  const reopened=await openPreviewMarkscene(native.archive);
  test('EXT-NEON-NATIVE-003',reopened.sourceSha256===hash&&
   reopened.manifest.sceneGraph.length===296&&
   reopened.manifest.sourceSummary.clips.length===1,
   {sha256:reopened.sourceSha256,nodes:reopened.manifest.sceneGraph.length},
   'Native v3 subset failed exact source preservation');
  const edited=await createPreviewMarkscene(glb,{
   projectId:'neon-boy-external-edit',name:'Neon Boy GLB material revision',
   edits:{materialPbr:{'0':{roughnessFactor:.35}},selection:{clipIndex:0,timeSeconds:1}}
  });
  const editReopened=await openPreviewMarkscene(edited.archive);
  const result=await exportEditedSourceGlb(editReopened);
  const numeric=compareGlbSemantics(glb,result.glb,{allowEditedMaterials:[0]});
  const texture=compareGlbTextures(glb,result.glb);
  report.numeric={status:numeric.status,comparisons:numeric.numericComparisons,
   errors:numeric.errors.slice(0,10),unverified:numeric.unverified};
  report.texture={status:texture.status,stats:texture.stats,
   errors:texture.errors,unverified:texture.unverified};
  test('EXT-NEON-GLB-EDIT-004',numeric.status==='pass_partial_profile'&&
   texture.errors.length===0&&
   parseGlb(result.glb).json.materials[0].pbrMetallicRoughness.roughnessFactor===.35,
   {numeric:report.numeric,texture:report.texture},
   'Native GLB export lost untouched topology/rig/animation/PBR semantics');
  save('external-neon-edited.markscene',edited.archive);
  save('external-neon-edited.glb',result.glb);
  browser=await chromium.launch({headless:true,args:[
   '--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'
  ]});
  const page=await browser.newPage({viewport:{width:1280,height:780}});
  const errors=[];page.on('pageerror',e=>errors.push(String(e)));
  await page.goto(pathToFileURL(resolve('dist/pro-studio/rig-viewer-offline.html')).href,
   {waitUntil:'load',timeout:60000});
  await page.waitForFunction(()=>window.__MARK_RIG_VIEWER_READY__||window.MARK_RIG_LAST_ERROR,
   null,{timeout:60000});
  await page.setInputFiles('#picker',resolve(filename));
  await page.waitForFunction(()=>
   window.MARK_RIG_VIEWER_API?.transport().loadedName==='NEON_BOY_DANCE.glb'||
   window.MARK_RIG_LAST_ERROR,null,{timeout:90000});
  if(errors.length||await page.evaluate(()=>window.MARK_RIG_LAST_ERROR))
   throw Error('Browser GLTFLoader error: '+JSON.stringify(errors)+' '+
    await page.evaluate(()=>window.MARK_RIG_LAST_ERROR));
  const pose=await page.evaluate(()=>window.MARK_RIG_VIEWER_API.pose());
  test('EXT-NEON-WEBGL-005',pose.skins[0]?.joints===17&&pose.clips.length===1,
   {skins:pose.skins,clipNames:pose.clips,meshes:pose.meshes.length,
    hasMorphs:pose.meshes.some(x=>x.morph.length>0)},
   'Real external humanoid did not load in Three.js WebGL2');
  const snapshots=[];
  for(const item of [
   {name:'neon-front-t0.png',view:'front',time:0},
   {name:'neon-front-mid.png',view:'front',time:2},
   {name:'neon-side-mid.png',view:'left',time:2},
   {name:'neon-back-mid.png',view:'back',time:2},
   {name:'neon-threequarter-mid.png',view:'threequarter',time:2},
   {name:'neon-front-end.png',view:'front',time:3.9}
  ]){
   const snapshot=await page.evaluate(({view,time})=>{
    window.MARK_RIG_VIEWER_API.seek(time);
    window.MARK_RIG_VIEWER_API.centerView(view);
    window.MARK_RIG_VIEWER_API.render();
    return window.MARK_RIG_VIEWER_API.canvas();
   },item);
   if(!snapshot.startsWith('data:image/png;base64,'))throw Error('Missing real canvas capture');
   const png=Buffer.from(snapshot.split(',')[1],'base64');
   snapshots.push({...item,...save(item.name,png)});
  }
  test('EXT-NEON-ANIMATION-006',snapshots[0].sha256!==snapshots[1].sha256,
   {frontRest:snapshots[0].sha256,frontDance:snapshots[1].sha256,
    captured:snapshots.length},'Real scene did not visually animate');
  report.render={backend:'Chromium WebGL2 / SwiftShader',
   viewport:'1280x780',sourceSha256:hash,screenshots:snapshots.map(x=>x.name)};
  await browser.close();browser=null;
 }catch(error){
  report.errors=[String(error?.stack||error)];
  report.tests.push({testId:'EXT-NEON-RUN',status:'fail',reason:String(error?.message||error)});
 }finally{
  if(browser)await browser.close();
  finish();
 }
}
