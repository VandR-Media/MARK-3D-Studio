/**
 * Real Chromium WebGL2/SwiftShader Pass 15 acceptance.
 * A seam-split quad must remain TWO indexed islands for safe RegionExtrude,
 * while a separate read-only query can identify its geometric edge candidate.
 */
import {chromium} from 'playwright';
import {createHash} from 'node:crypto';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createSplitSeamFixture} from './pro-studio-seam-fixture.mjs';
import {openPreviewMarkscene,exportEditedSourceGlb}
 from '../src/pro-studio/markscene-v3-preview.js';

const buildSha=process.env.MARK_SOURCE_SHA||'local-unverified';
const root=resolve('dist/pro-studio/pass15-acceptance');
mkdirSync(root,{recursive:true});
const SHA=data=>createHash('sha256').update(data).digest('hex');
const original=createSplitSeamFixture(),sourceSha=SHA(original);
const report={schema:'mark.pass15-seam-webgl/1',buildSha,sourceSha,
 backend:'Chromium WebGL2 / SwiftShader software GPU',device:'CI Linux',
 huaweiHardwareTested:false,status:'in_progress',tests:[],artifacts:[],errors:[]};
const artifact=(name,bytes,extra={})=>{
 const data=Buffer.from(bytes);writeFileSync(join(root,name),data);
 const result={name,sha256:SHA(data),bytes:data.length,...extra};
 report.artifacts.push(result);return result;
};
const assertCheck=(id,ok,metrics,message)=>{
 report.tests.push({testId:id,status:ok?'pass':'fail',
  reason:ok?'':message,metrics,buildSha});
 if(!ok)throw Error(id+': '+message+' '+JSON.stringify(metrics));
};
const screenshot=async(page,name,description)=>{
 const url=await page.evaluate(()=>window.MARK_RIG_VIEWER_API.canvas());
 if(!url.startsWith('data:image/png;base64,'))throw Error('No genuine WebGL2 PNG');
 return artifact(name,Buffer.from(url.split(',')[1],'base64'),
  {description,source:'actual canvas.toDataURL; not AI-generated'});
};
artifact('source-seam-quad.glb',original,{purpose:'original bytes, never welded'});
const browser=await chromium.launch({headless:true,args:[
 '--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'
]});
try{
 const page=await browser.newPage({viewport:{width:1280,height:780}});
 const errors=[];
 page.on('pageerror',e=>errors.push(String(e)));
 page.on('console',e=>{if(e.type()==='error')errors.push(e.text());});
 page.on('dialog',d=>d.dismiss());
 await page.goto(pathToFileURL(resolve('dist/pro-studio/rig-viewer-offline.html')).href,
  {waitUntil:'load'});
 await page.waitForFunction(()=>window.__MARK_RIG_VIEWER_READY__||
  window.MARK_RIG_LAST_ERROR,null,{timeout:60000});
 const initial=await page.evaluate(()=>({
  error:window.MARK_RIG_LAST_ERROR||null,gpu:window.MARK_RIG_VIEWER_API?.gpu()
 }));
 assertCheck('P15-OPEN-WEBGL-001',!initial.error&&Boolean(initial.gpu),initial,
  'Actual WebGL2 viewer did not initialize');
 await page.evaluate(bytes=>window.MARK_RIG_VIEWER_API.loadBinary(
  new Uint8Array(bytes)),Array.from(original));
 await page.locator('#bridge-write-grant').check();
 await page.locator('#mesh-open').click();
 const status=await page.locator('#mesh-output').innerText();
 const analyzed=await page.evaluate(async()=>{
  const r=await window.MARK_AI_BRIDGE.request({requestId:'p15.topology',
   method:'mesh.getTopology',params:{meshId:'gltf-mesh-0'}});
  if(!r.ok)throw Error(JSON.stringify(r.diagnostics));
  return r.result;
 });
 assertCheck('P15-READONLY-SEAM-DIAG-002',
  analyzed.attributeVertexCount===6&&
  analyzed.geometricVertexCandidates===4&&
  analyzed.uvSeamEdges===1&&
  analyzed.splitIndexEdges===1&&
  analyzed.positionJoinIsAuthoritative===false&&
  status.includes('UV-швов 1'),
  {analyzed,status},'UI and read-only seam analysis diverged');
 await page.evaluate(()=>window.MARK_RIG_VIEWER_API.centerView('front'));
 const originalShot=await screenshot(page,'seamed-quad-before-webgl.png',
  'Real glTF quad with visually split attribute vertices');
 await page.locator('#mesh-pick-toggle').click();
 await page.locator('#mesh-pick-mode').selectOption('face');
 await page.locator('#viewport').scrollIntoViewIfNeeded();
 const pick=async(face,shift=false)=>{
  const coord=await page.evaluate(f=>
   window.MARK_MESH_PICK_API.projectFace(0,f),face);
  const box=await page.locator('#viewport').boundingBox();
  if(shift)await page.keyboard.down('Shift');
  try{await page.mouse.click(box.x+coord.x,box.y+coord.y);}
  finally{if(shift)await page.keyboard.up('Shift');}
 };
 await pick(0);await pick(1,true);
 const region=await page.evaluate(()=>window.MARK_MESH_PICK_API.region());
 assertCheck('P15-CORNER-REGION-SAFETY-003',
  region?.faces?.join(',')==='0,1'&&
  region.diagnostics.connectedComponents===2&&
  region.diagnostics.validRegion===false&&
  region.boundaryEdges.length===6,
  {region},'Region picker must not silently merge UV corner indices');
 const selectionShot=await screenshot(page,'seam-two-faces-overlay-webgl.png',
  'Real selected faces stay separate by glTF indexed edges');
 await page.locator('#mesh-op').selectOption('face.regionExtrude');
 await page.locator('#mesh-extrude-distance').fill('0.3');
 await page.locator('#mesh-apply').click();
 await page.waitForFunction(()=>document.querySelector('#mesh-output')?.
  textContent?.includes('Ошибка:'),null,{timeout:15000});
 const rejection=await page.locator('#mesh-output').innerText();
 const snapshot=await page.evaluate(()=>window.MARK_AI_BRIDGE.getSnapshot());
 assertCheck('P15-NO-UNSAFE-WELD-004',
  rejection.includes('REGION_DISCONNECTED')&&
  (snapshot.edits?.meshOperations?.length??0)===0,
  {rejection,revision:snapshot.revision,ops:snapshot.edits?.meshOperations?.length||0},
  'Unsafe region extrusion should reject seam-split glTF primitives');
 const exported=await page.evaluate(async()=>{
  const call=async method=>{
   const r=await window.MARK_AI_BRIDGE.request({
    requestId:'p15.'+method,method,params:{}});
   if(!r.ok)throw Error(JSON.stringify(r.diagnostics));
   return Array.from(r.result.data);
  };
  return{native:await call('scene.save'),glb:await call('scene.export')};
 });
 const nativeFile=artifact('seam-source.markscene',exported.native);
 const exportedFile=artifact('seam-export.glb',exported.glb);
 const opened=await openPreviewMarkscene(Buffer.from(exported.native));
 const replay=await exportEditedSourceGlb(opened);
 assertCheck('P15-NATIVE-BINARY-PRESERVATION-005',
  SHA(exported.glb)===sourceSha&&
  SHA(opened.sourceGLB)===sourceSha&&
  SHA(replay.glb)===sourceSha,
  {sourceSha,exported:exportedFile,native:nativeFile,
   replaySha:SHA(replay.glb),screenshots:[originalShot,selectionShot]},
  'UV/positions changed after rejected edit, native save or replay');
 assertCheck('P15-BROWSER-ERRORS-006',errors.length===0,{errors},
  'Uncaught browser error during seam analysis');
 report.status='pass';
}catch(error){report.status='fail';report.errors.push(String(error?.stack||error));}
finally{
 await browser.close();report.completedAt=new Date().toISOString();
 writeFileSync(join(root,'pass15-report.json'),JSON.stringify(report,null,2)+'\n');
 console.log('PASS15 '+report.status.toUpperCase()+' '+JSON.stringify({
  tests:report.tests.map(t=>({id:t.testId,status:t.status})),
  errors:report.errors,artifacts:report.artifacts.length
 }));
 if(report.status!=='pass')process.exitCode=1;
}
