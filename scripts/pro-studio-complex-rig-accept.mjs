/**
 * Real Chromium WebGL2 acceptance of generated independent multi-part rig.
 * 12 skinned meshes, 70 bones, two morph channels, three clips, four PBR
 * materials and a real PNG texture. This is NOT artist-approved Neon Boy.
 */
import {chromium} from 'playwright';
import {mkdirSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {buildComplexRigFixture} from './pro-studio-complex-rig-fixture.mjs';
import {inspectRiggedGlb} from '../src/pro-studio/rigged-glb-audit.js';
import {openPreviewMarkscene} from '../src/pro-studio/markscene-v3-preview.js';
import {compareGlbSemantics} from '../src/pro-studio/glb-semantic-diff.js';
import {compareGlbTextures} from '../src/pro-studio/glb-texture-qa.js';
const fixture=buildComplexRigFixture();
const out=resolve('dist/pro-studio/complex-rig');
mkdirSync(out,{recursive:true});
const report={schema:'mark.complex-rig-webgl2-acceptance/1',
 sourceCommit:process.env.GITHUB_SHA||'local-unverified',status:'in_progress',
 artifactClass:'procedural multi-panel engineering fixture; NOT Neon Boy art',
 backend:'Chromium SwiftShader WebGL2 (NOT Huawei hardware)',tests:[],
 screenshots:[],exports:[],errors:[],sourceSha256:fixture.sha256,
 expected:fixture.expected};
const sha=x=>createHash('sha256').update(x).digest('hex');
const fail=(id,reason)=>{report.tests.push({id,status:'fail',reason});throw Error(id+': '+reason)};
const check=(id,condition,metrics,reason)=>{
 if(!condition)fail(id,reason||JSON.stringify(metrics));
 report.tests.push({id,status:'pass',metrics});
};
function save(name,data){
 const filename=join(out,name);writeFileSync(filename,data);
 return {name,bytes:data.length,sha256:sha(data)};
}
save('complex-rig70-12parts-3clips.glb',fixture.bytes);
const browser=await chromium.launch({headless:true,args:[
 '--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'
]});
try{
 const page=await browser.newPage({viewport:{width:1280,height:780},deviceScaleFactor:1});
 const pageErrors=[];page.on('pageerror',e=>pageErrors.push(String(e)));
 await page.goto(pathToFileURL(resolve('dist/pro-studio/rig-viewer-offline.html')).href,{
  waitUntil:'load',timeout:60000});
 await page.waitForFunction(()=>window.__MARK_RIG_VIEWER_READY__||window.MARK_RIG_LAST_ERROR,
  null,{timeout:60000});
 await page.setInputFiles('#picker',join(out,'complex-rig70-12parts-3clips.glb'));
 await page.waitForFunction(()=>window.MARK_RIG_VIEWER_API?.pose().sourceName===
  'complex-rig70-12parts-3clips.glb'||window.MARK_RIG_LAST_ERROR,
  null,{timeout:60000});
 const base=await page.evaluate(()=>({
  pose:window.MARK_RIG_VIEWER_API.pose(),gpu:window.MARK_RIG_VIEWER_API.gpu(),
  error:window.MARK_RIG_LAST_ERROR||null
 }));
 if(base.error)throw Error(base.error);
 check('COMPLEX-WEBGL-SKIN-001',
  base.gpu.webgl2&&base.pose.skins.length===12&&
  base.pose.skins.every(s=>s.joints===70)&&base.pose.meshes.length===12&&
  base.pose.meshes.every(m=>m.morph.length===2)&&
  base.pose.clips.length===3,
  {gpu:base.gpu,skins:base.pose.skins.length,clips:base.pose.clips.length,
   morphMeshCount:base.pose.meshes.length},'Actual shader loaded wrong multimesh skin');
 async function screenshot(name,{view='front',clip=0,time=0}={}){
  const data=await page.evaluate(({view,clip,time})=>{
   window.MARK_RIG_VIEWER_API.selectClip(clip);
   window.MARK_RIG_VIEWER_API.seek(time);
   window.MARK_RIG_VIEWER_API.centerView(view);
   return{png:window.MARK_RIG_VIEWER_API.canvas(),pose:window.MARK_RIG_VIEWER_API.pose()};
  },{view,clip,time});
  const bytes=Buffer.from(data.png.split(',')[1]||'','base64');
  if(bytes.length<500||bytes.subarray(0,8).toString('hex')!=='89504e470d0a1a0a')
   throw Error('Renderer produced no real PNG');
  const file=save(name,bytes);
  report.screenshots.push({...file,view,clip,time});
  return {...file,pose:data.pose};
 }
 const clipResults=[];
 for(let i=0;i<3;i++){
  const a=await screenshot('multimesh-clip'+i+'-t0.png',{clip:i,time:0});
  const b=await screenshot('multimesh-clip'+i+'-t6.png',{clip:i,time:6});
  clipResults.push({clip:i,start:a.sha256,mid:b.sha256,
   morphAtT6:b.pose.meshes[0].morph});
  check('COMPLEX-CLIP-'+i+'-002',
   a.sha256!==b.sha256&&JSON.stringify(a.pose.meshes[0].morph)!==
   JSON.stringify(b.pose.meshes[0].morph),
   clipResults[i],'Rendered multimesh frame or face morph does not animate');
 }
 for(const view of ['left','right','back','threequarter']){
  await screenshot('multimesh-'+view+'-dance.png',{view,clip:2,time:6});
 }
 check('COMPLEX-VIEWS-003',report.screenshots.length===10,
  {views:['front','left','right','back','threequarter'],frames:10});
 // Verify the installed, local AI Bridge changes ONE mesh by UUID, material,
 // and clip in ONE atomic commit in the real WebGL renderer.
 // Feed bytes directly from the verified Playwright file fixture. No URLs.
 const callResult=await page.evaluate(async bytes=>{
  const api=window.MARK_AI_BRIDGE,request=async(method,params={})=>{
   const r=await api.request({requestId:'complex.cli.'+method,method,params});
   if(!r.ok)throw Error(method+' '+JSON.stringify(r.diagnostics));
   return r.result;
  };
  document.getElementById('bridge-write-grant').checked=true;
  const uploaded=await request('asset.upload',{
   name:'12-mesh.glb',type:'glb',data:new Uint8Array(bytes)
  });
  const opened=await request('scene.open',{assetId:uploaded.assetId});
  const start=await request('transaction.begin');
  await request('object.setTransform',{uuid:'gltf-node-1',
   transform:{translation:[.25,0,0]}});
  await request('material.setPbr',{materialId:'gltf-material-0',
   pbr:{roughnessFactor:.24}});
  await request('animation.preview',{clipIndex:2,timeSeconds:6});
  await request('transaction.commit',{transactionId:start.transactionId});
  const capture=await request('render.capture',{view:'threequarter',timeSeconds:6});
  const archive=await request('scene.save');
  const exported=await request('scene.export');
  return{
   opened,sha256:archive.sha256,
   project:Array.from(archive.data),glb:Array.from(exported.data),
   captureSha:capture.sha256,capture:Array.from(capture.data),
   snapshot:api.getSnapshot()
  };
 },Array.from(fixture.bytes));
 const project=save('complex-ai-bridge-edited.markscene',Buffer.from(callResult.project));
 const exportedGlb=save('complex-ai-bridge-edited.glb',Buffer.from(callResult.glb));
 const shot=save('complex-ai-bridge-capture.png',Buffer.from(callResult.capture));
 const reopened=await openPreviewMarkscene(Buffer.from(callResult.project));
 const exportedAudit=inspectRiggedGlb(Buffer.from(callResult.glb));
 const semantic=compareGlbSemantics(fixture.bytes,Buffer.from(callResult.glb),{
  allowEditedNodes:['SkinnedQuad'],allowEditedMaterials:[0]});
 const texture=compareGlbTextures(fixture.bytes,Buffer.from(callResult.glb));
 report.exports.push({project,exportedGlb,shot});
 report.numeric={status:semantic.status,numericComparisons:semantic.numericComparisons,
  errors:semantic.errors,unverified:semantic.unverified};
 report.texture={status:texture.status,stats:texture.stats,
  errors:texture.errors,unverified:texture.unverified};
 check('COMPLEX-BRIDGE-NATIVE-004',
  reopened.sourceSha256===fixture.sha256&&
  reopened.edits.selection.clipIndex===2&&
  exportedAudit.skins[0].joints===70&&
  exportedAudit.morphs.length===12&&exportedAudit.animations.length===3&&
  semantic.status==='pass_partial_profile'&&texture.status==='pass_supported_png'&&
  Buffer.from(callResult.capture).subarray(0,8).toString('hex')==='89504e470d0a1a0a',
  {projectSha:project.sha256,exportSha:exportedGlb.sha256,
   captureSha:shot.sha256,semantic:report.numeric.status,
   texture:report.texture.status},
  'Bridge lost GLB, morph, texture or failed to capture 12 meshes');
 check('COMPLEX-BROWSER-ERRORS-005',pageErrors.length===0,
  {pageErrors},'Chromium errors on 12 skinned mesh scene');
 report.status='pass';
}catch(error){report.status='fail';report.errors.push(String(error?.stack||error));}
finally{
 await browser.close();
 writeFileSync(join(out,'complex-rig-browser-report.json'),
  JSON.stringify(report,null,2)+'\n');
 console.log('MARK COMPLEX WEBGL2 '+report.status.toUpperCase(),
  JSON.stringify({sourceCommit:report.sourceCommit,
   tests:report.tests.map(t=>({id:t.id,status:t.status})),
   screenshots:report.screenshots.length,errors:report.errors}));
 if(report.status!=='pass')process.exitCode=1;
}
