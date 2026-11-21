/**
 * P25 real Chromium WebGL2 + Canvas2D UV workstation acceptance.
 * Physical glTF per-corner UV COW, no fake geometry or invented Huawei QA.
 */
import {chromium} from 'playwright';
import {createHash} from 'node:crypto';
import {mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {PNG} from 'pngjs';
import {buildSkinnedSeamFixture}
 from './pro-studio-pass17-skinned-seam-fixture.mjs';
import {openPreviewMarkscene,exportEditedSourceGlb}
 from '../src/pro-studio/markscene-v3-preview.js';
import {parseGlb} from '../src/glb.js';
import {inspectRiggedGlb} from '../src/pro-studio/rigged-glb-audit.js';

const root=resolve('dist/pro-studio/pass25-acceptance');
mkdirSync(root,{recursive:true});
const sha=data=>createHash('sha256').update(Buffer.from(data)).digest('hex');
const source=buildSkinnedSeamFixture(),sourceSha=sha(source),
 buildSha=process.env.MARK_SOURCE_SHA||'local-unverified';
const report={schema:'mark.pass25-copy-on-write-uv-webgl2/1',
 buildSha,sourceSha,backend:'Chromium WebGL2/SwiftShader + actual Canvas2D UV',
 device:'Linux CI, not Huawei',huaweiTested:false,
 status:'in_progress',tests:[],artifacts:[],errors:[]};
function artifact(name,data,extra={}){
 const bytes=Buffer.from(data);writeFileSync(join(root,name),bytes);
 const a={name,sha256:sha(bytes),bytes:bytes.length,...extra};
 report.artifacts.push(a);return a;
}
function check(id,ok,metrics,note){
 report.tests.push({id,status:ok?'pass':'fail',metrics,note:ok?'':note});
 if(!ok)throw Error(id+': '+note+' '+JSON.stringify(metrics));
}
const sourceArtifact=artifact('rigged-uv-source.glb',source);
const browser=await chromium.launch({headless:true,args:[
 '--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'
]});
try{
 const page=await browser.newPage({viewport:{width:1280,height:780}});
 const errors=[];
 page.on('pageerror',e=>errors.push(String(e)));
 page.on('console',e=>{if(e.type()==='error')errors.push(e.text());});
 page.on('dialog',d=>d.accept());
 await page.goto(pathToFileURL(resolve('dist/pro-studio/rig-viewer-offline.html')).href,
  {waitUntil:'load'});
 await page.waitForFunction(()=>window.__MARK_RIG_VIEWER_READY__||
  window.MARK_RIG_LAST_ERROR,null,{timeout:60000});
 const init=await page.evaluate(()=>({
  error:window.MARK_RIG_LAST_ERROR||null,
  gpu:window.MARK_RIG_VIEWER_API?.gpu()
 }));
 check('UV25-WEBGL-READY-01',!init.error&&Boolean(init.gpu),
  init,'Real viewer did not initialize');
 await page.evaluate(bytes=>window.MARK_RIG_VIEWER_API.loadBinary(
  new Uint8Array(bytes)),Array.from(source));
 await page.locator('#bridge-write-grant').check();
 await page.locator('#mesh-open').click();
 await page.waitForFunction(()=>document.querySelector('#mesh-output')
  ?.textContent?.includes('UV-швов'),null,{timeout:30000});
 const call=async(method,params={})=>{
  const r=await page.evaluate(async({method,params})=>
   window.MARK_AI_BRIDGE.request({requestId:'p25.'+method,
    method,params}),{method,params});
  if(!r.ok)throw Error(method+': '+JSON.stringify(r.diagnostics));
  return r.result;
 };
 const original=await call('mesh.getMeshData',
  {meshId:'gltf-mesh-0',primitiveIndex:0,full:true});
 check('UV25-IMPORTED-70BONE-02',
  original.diagnostics.triangleCount===2&&
  original.uvSets.join(',')==='TEXCOORD_0,TEXCOORD_1'&&
  original.faces.length===2&&original.corners.length===6,
  {triangles:original.diagnostics.triangleCount,
   uvSets:original.uvSets,corners:original.corners.length},
  'Real 2-set UV corner graph not available');
 const byCorner=graph=>new Map(graph.corners.map(c=>[c.id,c]));
 const faceUV=(graph,faceIndex,set)=>{
  const f=graph.faces.find(x=>x.triangleIndex===faceIndex),
   corners=byCorner(graph);
  return f.cornerIds.map(id=>corners.get(id).attributes.uvSets[set]);
 };
 const originalFace0UV0=faceUV(original,0,'TEXCOORD_0'),
  originalFace1UV0=faceUV(original,1,'TEXCOORD_0'),
  originalFace0UV1=faceUV(original,0,'TEXCOORD_1'),
  originalFace1UV1=faceUV(original,1,'TEXCOORD_1');
 // Select a physical indexed triangle via a real mouse raycast.
 await page.locator('#mesh-pick-toggle').click();
 await page.locator('#mesh-pick-mode').selectOption('face');
 await page.evaluate(()=>window.MARK_RIG_VIEWER_API.centerView('front'));
 const projected=await page.evaluate(()=>
  window.MARK_MESH_PICK_API.projectFace(0,0));
 await page.locator('#viewport').scrollIntoViewIfNeeded();
 const bbox=await page.locator('#viewport').boundingBox();
 check('UV25-PICK-ONSCREEN-03',
  Boolean(bbox)&&projected.visible&&projected.x>0&&
  projected.y>0&&projected.x<bbox.width&&
  projected.y<bbox.height,
  {projected,bbox},'Original face outside viewport');
 await page.mouse.click(bbox.x+projected.x,bbox.y+projected.y);
 const picked=await page.evaluate(()=>window.MARK_MESH_PICK_API.selection());
 check('UV25-REAL-FACE-PICK-04',
  picked?.mode==='face'&&picked.face===0,
  {picked},'Source face0 must be clicked by genuine mouse');
 await page.locator('#mesh-uv-set').selectOption('0');
 await page.locator('#mesh-a').fill('0');
 await page.locator('#mesh-uv-preview').click();
 await page.waitForFunction(()=>document.querySelector('#mesh-uv-output')
  ?.textContent?.includes('UV0: 2'),null,{timeout:15000});
 const uvShot=async name=>{
  const b64=await page.evaluate(()=>document.querySelector(
   '#mesh-uv-canvas').toDataURL('image/png'));
  if(!b64.startsWith('data:image/png;base64,'))
   throw Error('No actual UV Canvas2D data');
  return artifact(name,Buffer.from(b64.split(',')[1],'base64'),
   {source:'Canvas2D from current read-only MeshData corner UVs'});
 };
 const panelBefore=await uvShot('uv0-before-real-corners.png');
 const canvasOrig=PNG.sync.read(readFileSync(join(root,panelBefore.name)));
 check('UV25-UV-CANVAS-DRAW-05',
  canvasOrig.width===260&&canvasOrig.height===260,
  {canvas:panelBefore,width:canvasOrig.width,height:canvasOrig.height},
  'UV panel must contain a genuine drawn canvas');
 // Wrong numeric source face proves that the actual picked stable face ID
 // is resolved by the GUI, not trusted from an unvalidated text box.
 await page.locator('#mesh-a').fill('999');
 await page.locator('#mesh-uv-du').fill('.25');
 await page.locator('#mesh-uv-dv').fill('-.125');
 await page.locator('#mesh-uv-apply').click();
 await page.waitForFunction(()=>window.MARK_AI_BRIDGE.getSnapshot()
  .edits?.meshOperations?.length===1,null,{timeout:30000});
 const first=await call('mesh.getMeshData',
  {meshId:'gltf-mesh-0',primitiveIndex:0,full:true});
 const firstUV=faceUV(first,0,'TEXCOORD_0');
 const tol=(x,y)=>Math.abs(x-y)<2e-6;
 check('UV25-COW-UV0-06',
  first.diagnostics.uvCornerEditCount===1&&
  first.diagnostics.triangleCount===2&&
  first.uvCornerRemaps[0].faceId===original.faces[0].id&&
  first.uvCornerRemaps[0].newAttributeVertices.join(',')==='6,7,8'&&
  firstUV.every((p,i)=>p.every((v,k)=>
   tol(v,originalFace0UV0[i][k]+[.25,-.125][k]))),
  {stats:first.diagnostics,uv:firstUV,remap:first.uvCornerRemaps[0]},
  'Physical per-corner UV0 should move with stable face provenance');
 check('UV25-NO-SEAM-BLEED-07',
  JSON.stringify(faceUV(first,1,'TEXCOORD_0'))===
   JSON.stringify(originalFace1UV0)&&
  JSON.stringify(faceUV(first,0,'TEXCOORD_1'))===
   JSON.stringify(originalFace0UV1)&&
  JSON.stringify(faceUV(first,1,'TEXCOORD_1'))===
   JSON.stringify(originalFace1UV1)&&
  first.faces.map(x=>x.id).join(',')===
   original.faces.map(x=>x.id).join(','),
  {uv0Other:faceUV(first,1,'TEXCOORD_0')},
  'Unselected face and UV1 must not change');
 // Draw with same numeric face focus as before to prove UV polygon moved.
 await page.locator('#mesh-a').fill('0');
 await page.locator('#mesh-uv-preview').click();
 const panelAfter=await uvShot('uv0-after-cow-face0.png');
 const a=PNG.sync.read(readFileSync(join(root,panelBefore.name))),
  b=PNG.sync.read(readFileSync(join(root,panelAfter.name)));
 let changed=0;
 for(let i=0;i<a.data.length;i+=4)
  if(Math.abs(a.data[i]-b.data[i])+
   Math.abs(a.data[i+1]-b.data[i+1])+
   Math.abs(a.data[i+2]-b.data[i+2])>24)changed++;
 check('UV25-PHYSICAL-UV-PIXELS-08',changed>80,
  {changed,panelBefore,panelAfter},
  'Real Canvas2D UV polygon did not visibly move');
 // Second real UV set is independently edited on the neighboring face.
 await page.locator('#mesh-uv-set').selectOption('1');
 await page.locator('#mesh-a').fill('1');
 await page.locator('#mesh-uv-du').fill('.175');
 await page.locator('#mesh-uv-dv').fill('.2');
 await page.locator('#mesh-uv-apply').click();
 await page.waitForFunction(()=>window.MARK_AI_BRIDGE.getSnapshot()
  .edits?.meshOperations?.length===2,null,{timeout:30000});
 const second=await call('mesh.getMeshData',
  {meshId:'gltf-mesh-0',primitiveIndex:0,full:true});
 check('UV25-UV1-PERSISTENT-09',
  second.diagnostics.uvCornerEditCount===2&&
  second.uvCornerRemaps[1].uvSet==='TEXCOORD_1'&&
  second.uvCornerRemaps[1].newAttributeVertices.join(',')==='9,10,11'&&
  faceUV(second,1,'TEXCOORD_1').every((p,i)=>p.every((x,k)=>
   tol(x,originalFace1UV1[i][k]+[.175,.2][k])))&&
  JSON.stringify(faceUV(second,0,'TEXCOORD_0'))===
   JSON.stringify(firstUV),
  {secondRemap:second.uvCornerRemaps[1],
   uv1:faceUV(second,1,'TEXCOORD_1')},
  'Independent second-set UV edit lost first UV or actual second corners');
 const uv1Shot=await uvShot('uv1-after-cow-face1.png');
 const physical=await call('scene.export');
 const native=await call('scene.save');
 const glbArtifact=artifact('uv-per-corner-real.glb',physical.data),
  nativeArtifact=artifact('uv-editable.markscene',native.data);
 const opened=await openPreviewMarkscene(native.data),
  replay=await exportEditedSourceGlb(opened),
  audit=inspectRiggedGlb(Buffer.from(physical.data)),
  doc=parseGlb(Buffer.from(physical.data)).json,
  srcDoc=parseGlb(source).json;
 check('UV25-BINARY-RIG-NATIVE-10',
  opened.sourceSha256===sourceSha&&
  opened.edits.meshOperations.length===2&&
  opened.edits.meshOperations.every(o=>o.kind==='uv.offsetFaceCorners')&&
  sha(replay.glb)===sha(physical.data)&&
  audit.skins[0].joints===70&&
  audit.animations.length===3&&
  audit.morphs[0].targets===2&&
  JSON.stringify(doc.skins)===JSON.stringify(srcDoc.skins)&&
  JSON.stringify(doc.animations)===JSON.stringify(srcDoc.animations)&&
  JSON.stringify(doc.materials)===JSON.stringify(srcDoc.materials),
  {nativeArtifact,glbArtifact,uv1Shot,
   glbHash:sha(physical.data),skin:audit.skins[0]},
  'Real UV GLB/native replay damaged 70-joint skinned rig or textures');
 await page.locator('#mesh-undo').click();
 await page.waitForFunction(()=>window.MARK_AI_BRIDGE.getSnapshot()
  .edits?.meshOperations?.length===1,null,{timeout:30000});
 const undo=await call('mesh.getMeshData',{meshId:'gltf-mesh-0'});
 check('UV25-GEOMETRY-UNDO-11',
  undo.diagnostics.uvCornerEditCount===1,
  {undo:undo.diagnostics},'Undo must revert actual second UV edit');
 await page.locator('#mesh-redo').click();
 await page.waitForFunction(()=>window.MARK_AI_BRIDGE.getSnapshot()
  .edits?.meshOperations?.length===2,null,{timeout:30000});
 const redo=await call('scene.export');
 check('UV25-BINARY-REDO-12',sha(redo.data)===sha(physical.data),
  {expected:sha(physical.data),actual:sha(redo.data)},
  'Redo must reproduce identical real GLB bytes');
 check('UV25-NO-BROWSER-ERRORS-13',errors.length===0,{errors},
  'Browser console/page error in real WebGL2 UV workflow');
 report.status='pass';
}catch(error){report.status='fail';report.errors.push(String(error?.stack||error));}
finally{
 await browser.close();
 report.completedAt=new Date().toISOString();
 writeFileSync(join(root,'pass25-report.json'),JSON.stringify(report,null,2)+'\n');
 console.log('PASS25 '+report.status.toUpperCase()+' '+JSON.stringify({
  tests:report.tests.map(t=>({id:t.id,status:t.status})),
  errors:report.errors,artifacts:report.artifacts.length
 }));
 if(report.status!=='pass')process.exitCode=1;
}
