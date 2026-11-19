/**
 * Pass 12: actual Chromium/SwiftShader WebGL2 evidence for a real, native
 * triangle extrusion. Never substitute generated artwork for viewport pixels.
 */
import {chromium} from 'playwright';
import {PNG} from 'pngjs';
import {createHash} from 'node:crypto';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {parseGlb} from '../src/glb.js';
import {buildRiggedFixture} from './pro-studio-glb-fixtures.mjs';
import {openPreviewMarkscene,exportEditedSourceGlb} from
 '../src/pro-studio/markscene-v3-preview.js';
import {inspectRiggedGlb} from '../src/pro-studio/rigged-glb-audit.js';

const sha=process.env.MARK_SOURCE_SHA||'local-not-a-release-sha';
const path=resolve('dist/pro-studio/pass12-acceptance');
mkdirSync(path,{recursive:true});
const digest=data=>createHash('sha256').update(data).digest('hex');
const report={schema:'mark.pass12-webgl-extrude/1',buildSha:sha,
 backend:'Chromium WebGL2 / SwiftShader (software)',
 physicalHuaweiTest:false,status:'in_progress',tests:[],artifacts:[],errors:[]};
const save=(file,data,metadata={})=>{
 const bytes=Buffer.from(data);
 writeFileSync(join(path,file),bytes);
 const item={file,sha256:digest(bytes),bytes:bytes.length,...metadata};
 report.artifacts.push(item);return item;
};
const check=(id,ok,metrics,reason)=>{
 report.tests.push({testId:id,status:ok?'pass':'fail',reason:ok?'':reason,
  metrics,buildSha:sha});
 if(!ok)throw Error(id+': '+reason+' '+JSON.stringify(metrics));
};
const pngFromData=data=>Buffer.from(data.split(',')[1],'base64');
const difference=(left,right)=>{
 const a=PNG.sync.read(left),b=PNG.sync.read(right);
 if(a.width!==b.width||a.height!==b.height)return {changedPixels:0,totalPixels:0};
 let changed=0;
 for(let i=0;i<a.data.length;i+=4){
  if(Math.abs(a.data[i]-b.data[i])+Math.abs(a.data[i+1]-b.data[i+1])+
   Math.abs(a.data[i+2]-b.data[i+2])>24)changed++;
 }
 return {changedPixels:changed,totalPixels:a.width*a.height,
  changedFraction:changed/(a.width*a.height)};
};
const browser=await chromium.launch({headless:true,args:[
 '--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'
]});
try{
 const page=await browser.newPage({viewport:{width:1280,height:780}});
 const errors=[];
 page.on('pageerror',e=>errors.push(String(e)));
 page.on('console',e=>{if(e.type()==='error')errors.push(e.text());});
 await page.goto(pathToFileURL(resolve('dist/pro-studio/rig-viewer-offline.html')).href,
  {waitUntil:'load'});
 await page.waitForFunction(()=>window.__MARK_RIG_VIEWER_READY__||
  window.MARK_RIG_LAST_ERROR,{},{timeout:60000});
 const startup=await page.evaluate(()=>({
  error:window.MARK_RIG_LAST_ERROR||null,gpu:window.MARK_RIG_VIEWER_API?.gpu()
 }));
 check('P12-WEBGL-START-001',!startup.error&&Boolean(startup.gpu),startup,
  'Real renderer did not initialize');
 const fixture=buildRiggedFixture();
 await page.evaluate(bytes=>window.MARK_RIG_VIEWER_API.loadBinary(
  new Uint8Array(bytes)),Array.from(fixture.bytes));
 await page.evaluate(()=>window.MARK_RIG_VIEWER_API.centerView('front'));
 await page.locator('#bridge-write-grant').check();
 await page.locator('#mesh-open').click();
 await page.locator('#mesh-pick-toggle').click();
 await page.locator('#mesh-pick-mode').selectOption('face');
 // Real DOM pointer event against projected indexed triangle, not a fake ID.
 await page.locator('#viewport').scrollIntoViewIfNeeded();
 const face=await page.evaluate(()=>window.MARK_MESH_PICK_API.projectFace(0,0));
 const box=await page.locator('#viewport').boundingBox();
 await page.mouse.click(box.x+face.x,box.y+face.y);
 const selection=await page.evaluate(()=>window.MARK_MESH_PICK_API.selection());
 check('P12-REAL-POINTER-FACE-002',
  selection?.mode==='face'&&selection.face===0&&selection.meshId==='gltf-mesh-0',
  {faceProjection:face,selection},'Actual mouse click failed to pick triangle');
 // Removing selection overlay ensures pixel diff measures mesh change.
 await page.evaluate(()=>window.MARK_MESH_PICK_API.enable(false));
 await page.evaluate(()=>window.MARK_RIG_VIEWER_API.centerView('threequarter'));
 const before=pngFromData(await page.evaluate(()=>
  window.MARK_RIG_VIEWER_API.canvas()));
 const beforeArtifact=save('extrude-before-threequarter-webgl.png',before,
  {camera:'threequarter',width:1280,height:780,frame:0,type:'real WebGL2'});
 await page.locator('#mesh-op').selectOption('face.extrude');
 await page.locator('#mesh-a').fill('0');
 await page.locator('#mesh-extrude-distance').fill('0.55');
 await page.locator('#mesh-apply').click();
 await page.waitForFunction(()=>window.MARK_AI_BRIDGE.getSnapshot()
  .edits?.meshOperations?.some(op=>op.kind==='face.extrude'),
  null,{timeout:30000});
 // Force real redraw at the same animation time, camera and quality.
 await page.evaluate(()=>window.MARK_RIG_VIEWER_API.seek(0));
 const after=pngFromData(await page.evaluate(()=>
  window.MARK_RIG_VIEWER_API.canvas()));
 const afterArtifact=save('extrude-after-threequarter-webgl.png',after,
  {camera:'threequarter',width:1280,height:780,frame:0,type:'real WebGL2'});
 const diff=difference(before,after);
 check('P12-REAL-PIXEL-DIFF-003',
  diff.changedPixels>100, {before:beforeArtifact.sha256,
   after:afterArtifact.sha256,...diff},
  'Extruded geometry did not change enough viewport pixels');
 const result=await page.evaluate(async()=>{
  const api=window.MARK_AI_BRIDGE;
  const call=async(method,params={})=>{
   const r=await api.request({requestId:'pass12.'+method,method,params});
   if(!r.ok)throw Error(method+' '+JSON.stringify(r.diagnostics));
   return r.result;
  };
  const stats=await call('mesh.getStats',{meshId:'gltf-mesh-0'});
  const native=await call('scene.save');
  const exported=await call('scene.export');
  return {stats,native:Array.from(native.data),glb:Array.from(exported.data),
   revision:api.getSnapshot().revision};
 });
 const nativeFile=save('extrude-editable.markscene',result.native);
 const glbFile=save('extrude-result.glb',result.glb);
 const opened=await openPreviewMarkscene(Buffer.from(result.native));
 const roundtrip=await exportEditedSourceGlb(opened);
 const editedDoc=parseGlb(Buffer.from(result.glb)).json;
 const actual=inspectRiggedGlb(Buffer.from(result.glb));
 check('P12-NATIVE-ROUNDTRIP-004',
  opened.sourceSha256===fixture.sha256&&
  opened.edits.meshOperations.length===1&&
  opened.edits.meshOperations[0].kind==='face.extrude'&&
  Buffer.compare(Buffer.from(roundtrip.glb),Buffer.from(result.glb))===0&&
  result.stats.vertexCount===19&&result.stats.triangleCount===8&&
  actual.skins[0].joints===70&&actual.animations.length===3&&
  actual.morphs[0].targets===2,
  {native:nativeFile,glb:glbFile,stats:result.stats,
   meshes:editedDoc.meshes.length,sourceSha256:opened.sourceSha256},
  'Extruded binary/native/rig semantics did not survive reopen and export');
 await page.evaluate(()=>window.MARK_RIG_VIEWER_API.centerView('front'));
 const threequarter=pngFromData(await page.evaluate(()=>
  window.MARK_RIG_VIEWER_API.canvas()));
 save('extrude-after-front-webgl.png',threequarter,
  {camera:'front',width:1280,height:780,frame:0,type:'real WebGL2'});
 check('P12-BROWSER-ERRORS-005',errors.length===0,{errors},
  'WebGL viewer threw a browser error');
 report.status='pass';
}catch(error){report.status='fail';report.errors.push(String(error?.stack||error));}
finally{
 await browser.close();
 report.completedAt=new Date().toISOString();
 writeFileSync(join(path,'pass12-report.json'),JSON.stringify(report,null,2)+'\n');
 console.log('PASS12 '+report.status.toUpperCase()+' '+JSON.stringify({
  tests:report.tests.map(t=>({id:t.testId,status:t.status})),errors:report.errors
 }));
 if(report.status!=='pass')process.exitCode=1;
}
