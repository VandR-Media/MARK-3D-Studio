/**
 * Real Chromium WebGL2/SwiftShader Pass 22 acceptance.
 * A seam-split quad must remain TWO indexed islands for safe RegionExtrude,
 * while a separate read-only query can identify its geometric edge candidate.
 */
import {chromium} from 'playwright';
import {createHash} from 'node:crypto';
import {mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {buildSkinnedSeamFixture} from './pro-studio-pass17-skinned-seam-fixture.mjs';
import {inspectRiggedGlb} from '../src/pro-studio/rigged-glb-audit.js';
import {parseGlb} from '../src/glb.js';
import {PNG} from 'pngjs';
import {openPreviewMarkscene,exportEditedSourceGlb}
 from '../src/pro-studio/markscene-v3-preview.js';

const buildSha=process.env.MARK_SOURCE_SHA||'local-unverified';
const root=resolve('dist/pro-studio/pass22-acceptance');
mkdirSync(root,{recursive:true});
const SHA=data=>createHash('sha256').update(Buffer.from(data)).digest('hex');
const original=buildSkinnedSeamFixture(),sourceSha=SHA(original);
const report={schema:'mark.pass22-radial-edge-split-webgl/1',buildSha,sourceSha,
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
artifact('source-skinned-seam-quad.glb',original,{purpose:'original bytes, never welded'});
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
 const initial=await page.evaluate(()=>({
  error:window.MARK_RIG_LAST_ERROR||null,gpu:window.MARK_RIG_VIEWER_API?.gpu()
 }));
 assertCheck('P22-OPEN-WEBGL-001',!initial.error&&Boolean(initial.gpu),initial,
  'Actual WebGL2 viewer did not initialize');
 await page.evaluate(bytes=>window.MARK_RIG_VIEWER_API.loadBinary(
  new Uint8Array(bytes)),Array.from(original));
 await page.locator('#bridge-write-grant').check();
 await page.locator('#mesh-open').click();
 // Import/rigged renderer rebuild is asynchronous; wait for the real
 // completed Mesh Edit diagnostics rather than sampling stale placeholder.
 await page.waitForFunction(()=>document.querySelector('#mesh-output')?.textContent?.includes('UV-швов'),null,{timeout:30000});
 const status=await page.locator('#mesh-output').innerText();
 const analyzed=await page.evaluate(async()=>{
  const r=await window.MARK_AI_BRIDGE.request({requestId:'p15.topology',
   method:'mesh.getTopology',params:{meshId:'gltf-mesh-0'}});
  if(!r.ok)throw Error(JSON.stringify(r.diagnostics));
  return r.result;
 });
 assertCheck('P22-READONLY-SEAM-DIAG-002',
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
 assertCheck('P22-CORNER-REGION-SAFETY-003',
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
 assertCheck('P22-NO-UNSAFE-WELD-004',
  rejection.includes('REGION_DISCONNECTED')&&
  (snapshot.edits?.meshOperations?.length??0)===0,
  {rejection,revision:snapshot.revision,ops:snapshot.edits?.meshOperations?.length||0},
  'Unsafe region extrusion should reject seam-split glTF primitives');
 // User explicitly confirms each source pair. No new geometry is created.
 await page.locator('#mesh-a').fill('4');
 await page.locator('#mesh-b').fill('1');
 await page.locator('#mesh-link-seam').click();
 await page.waitForFunction(()=>window.MARK_AI_BRIDGE.getSnapshot()
  .edits?.meshSeamLinks?.length===1,null,{timeout:15000});
 await page.locator('#mesh-a').fill('5');
 await page.locator('#mesh-b').fill('2');
 await page.locator('#mesh-link-seam').click();
 await page.waitForFunction(()=>window.MARK_AI_BRIDGE.getSnapshot()
  .edits?.meshSeamLinks?.length===2,null,{timeout:15000});
 const approved=await page.evaluate(async()=>{
  const api=window.MARK_AI_BRIDGE,call=async(method,params)=>{
   const r=await api.request({requestId:'p16.'+method,method,params});
   if(!r.ok)throw Error(JSON.stringify(r.diagnostics));
   return r.result;
  };
  const region=await call('mesh.getLinkedRegion',{
   meshId:'gltf-mesh-0',faces:[0,1]});
  const diag=await call('mesh.getTopology',{meshId:'gltf-mesh-0'});
  return {region,approved:diag.approvedSeamLinks};
 });
 assertCheck('P22-APPROVED-LOGICAL-REGION-005',
  approved.region.selection.validRegion===true&&
  approved.region.selection.connectedComponents===1&&
  approved.region.selection.boundaryEdges.length===4&&
  approved.region.linkCount===2&&approved.approved===2&&
  approved.region.autoWeld===false,
  {approved},'User-approved seam links did not create read-only region graph');
 // Disable the selection overlay so PNG changes prove real geometry.
 await page.evaluate(()=>window.MARK_MESH_PICK_API.enable(false));
 await page.evaluate(()=>window.MARK_RIG_VIEWER_API.centerView('threequarter'));
 const beforeImage=await screenshot(page,'seam-before-extrude-webgl.png',
  'Actual skinned GLB with approved seam links, before extrusion');
 await page.locator('#mesh-op').selectOption('face.regionExtrudeLinked');
 await page.locator('#mesh-extrude-distance').fill('0.55');
 await page.locator('#mesh-apply').click();
 await page.waitForFunction(()=>window.MARK_AI_BRIDGE.getSnapshot()
  .edits?.meshOperations?.[0]?.kind==='face.regionExtrudeLinked',
  null,{timeout:30000});
 const extrudedSnapshot=await page.evaluate(()=>window.MARK_AI_BRIDGE.getSnapshot());
 assertCheck('P22-PHYSICAL-EXTRUDE-006',
  extrudedSnapshot.edits.meshOperations.length===1&&
  extrudedSnapshot.edits.meshOperations[0].links.length===2&&
  extrudedSnapshot.edits.meshSeamLinks.length===0,
  {operation:extrudedSnapshot.edits.meshOperations[0],revision:extrudedSnapshot.revision},
  'Source links were not atomically converted into true glTF geometry');
 await page.evaluate(()=>window.MARK_RIG_VIEWER_API.centerView('threequarter'));
 await page.evaluate(()=>window.MARK_RIG_VIEWER_API.seek(0));
 const afterImage=await screenshot(page,'seam-after-extrude-webgl.png',
  'Actual 70-joint skinned rig with physical side walls and a raised seam-split cap');
 const a=PNG.sync.read(readFileSync(join(root,beforeImage.name)));
 const b=PNG.sync.read(readFileSync(join(root,afterImage.name)));
 let changedPixels=0;
 for(let i=0;i<a.data.length;i+=4)
  if(Math.abs(a.data[i]-b.data[i])+
   Math.abs(a.data[i+1]-b.data[i+1])+
   Math.abs(a.data[i+2]-b.data[i+2])>24)changedPixels++;
 assertCheck('P22-REAL-PIXELS-007',changedPixels>100,
  {changedPixels,beforeSha:beforeImage.sha256,afterSha:afterImage.sha256},
  'No visible real WebGL2 geometry difference');
 const exported=await page.evaluate(async()=>{
  const request=async(method,params={})=>{
   const r=await window.MARK_AI_BRIDGE.request({
    requestId:'p17.'+method,method,params});
   if(!r.ok)throw Error(JSON.stringify(r.diagnostics));
   return r.result;
  };
  const native=await request('scene.save');
  const glb=await request('scene.export');
  const stats=await request('mesh.getStats',{meshId:'gltf-mesh-0'});
  const consumed=await request('mesh.getLinkedRegion',{meshId:'gltf-mesh-0'});
  return{native:Array.from(native.data),glb:Array.from(glb.data),stats,consumed};
 });
 const savedNative=artifact('seam-extruded-editable.markscene',exported.native);
 const savedGlb=artifact('seam-extruded-result.glb',exported.glb);
 const reopened=await openPreviewMarkscene(Buffer.from(exported.native));
 const replay=await exportEditedSourceGlb(reopened);
 const rig=inspectRiggedGlb(Buffer.from(exported.glb));
 const binary=parseGlb(Buffer.from(exported.glb));
 assertCheck('P22-NATIVE-RIG-PRESERVATION-008',
  reopened.sourceSha256===sourceSha&&
  Buffer.compare(Buffer.from(replay.glb),Buffer.from(exported.glb))===0&&
  exported.stats.vertexCount===28&&exported.stats.triangleCount===10&&
  rig.skins[0].joints===70&&rig.animations.length===3&&
  rig.morphs[0].targets===2&&
  binary.json.meshes[0].primitives[0].attributes.TEXCOORD_1!==undefined,
  {sourceSha,native:savedNative,exported:savedGlb,stats:exported.stats,
   joints:rig.skins[0].joints,clips:rig.animations.length},
  'Native replay lost UV, rig, animation, morph or geometry');
 assertCheck('P22-CAP-ID-REMAP-009',
  exported.consumed.sourceLinksConsumed&&
  exported.consumed.capRemap.length===6&&
  exported.consumed.pairedCaps[0].capAttributeVertices.join(',')==='7,10'&&
  exported.consumed.pairedCaps[1].capAttributeVertices.join(',')==='8,11'&&
  exported.consumed.futureTopologyMutationBlocked,
  {remap:exported.consumed},'Source-to-cap stable remap missing');
 const blocked=await page.evaluate(async()=>{
  const r=await window.MARK_AI_BRIDGE.request({
   requestId:'p17.block-follow-up',method:'mesh.edit',
   params:{meshId:'gltf-mesh-0',
    operation:{kind:'vertex.move',vertex:0,delta:[0,0,.1]}}});
  return{ok:r.ok,diagnostics:r.diagnostics};
 });
 assertCheck('P22-SUBSEQUENT-EDIT-BLOCK-010',
  blocked.ok===false&&JSON.stringify(blocked.diagnostics)
   .includes('MESH_LINKED_SEQUENCE'),blocked,
  'An unsafe edit was applied after identity-consuming extrusion');
 await page.locator('#mesh-undo').click();
 await page.waitForFunction(()=>window.MARK_AI_BRIDGE.getSnapshot()
  .edits?.meshSeamLinks?.length===2,null,{timeout:30000});
 await page.locator('#mesh-redo').click();
 await page.waitForFunction(()=>window.MARK_AI_BRIDGE.getSnapshot()
  .edits?.meshOperations?.[0]?.kind==='face.regionExtrudeLinked',
  null,{timeout:30000});
 const redo=await page.evaluate(async()=>{
  const r=await window.MARK_AI_BRIDGE.request({
   requestId:'p17.redo-export',method:'scene.export',params:{}});
  return r.ok?Array.from(r.result.data):null;
 });
 assertCheck('P22-BROWSER-UNDO-REDO-011',
  Array.isArray(redo)&&SHA(redo)===SHA(exported.glb),
  {sourceSha,outputSha:SHA(exported.glb),redoSha:redo?SHA(redo):null},
  'Undo/redo did not restore exact physical linked mesh bytes');
 // Pass18: a SECOND real edit, targeting a stable source-bound cap ID.
 // No direct mesh-index mutation, no dummy vertex clones.
 const meshDataBefore=await page.evaluate(async()=>{
  const r=await window.MARK_AI_BRIDGE.request({
   requestId:'p18.data.before',method:'mesh.getMeshData',
   params:{meshId:'gltf-mesh-0',full:true}});
  if(!r.ok)throw Error(JSON.stringify(r.diagnostics));
  return r.result;
 });
 assertCheck('P22-HALFEDGE-001',
  meshDataBefore.diagnostics.triangleCount===10&&
  meshDataBefore.diagnostics.cornerCount===30&&
  meshDataBefore.diagnostics.halfedgeCount===30&&
  meshDataBefore.diagnostics.boundaryEdges===4&&
  meshDataBefore.uvSets.includes('TEXCOORD_1'),
  {diagnostics:meshDataBefore.diagnostics},
  'Live renderer GLB has incorrect source-bound MeshData graph');
 await page.locator('#mesh-a').fill('4');
 await page.locator('#mesh-dx').fill('0.18');
 await page.locator('#mesh-dy').fill('0.10');
 await page.locator('#mesh-dz').fill('0.03');
 await page.locator('#mesh-move-cap').click();
 await page.waitForFunction(()=>window.MARK_AI_BRIDGE.getSnapshot()
  .edits?.meshOperations?.length===2,null,{timeout:30000});
 const meshDataAfter=await page.evaluate(async()=>{
  const r=await window.MARK_AI_BRIDGE.request({
   requestId:'p18.data.after',method:'mesh.getMeshData',
   params:{meshId:'gltf-mesh-0',full:true}});
  if(!r.ok)throw Error(JSON.stringify(r.diagnostics));
  return r.result;
 });
 assertCheck('P22-STABLE-FACE-CORNER-002',
  meshDataAfter.diagnostics.boundaryEdges===4&&
  meshDataAfter.diagnostics.nonManifoldEdges===0&&
  meshDataAfter.diagnostics.linkedCapMoveCount===1&&
  meshDataAfter.corners.map(x=>x.id).join(',')===
   meshDataBefore.corners.map(x=>x.id).join(',')&&
  meshDataAfter.capMap.map(x=>x.stableCapAttributeId).join(',')===
   meshDataBefore.capMap.map(x=>x.stableCapAttributeId).join(','),
  {before:meshDataBefore.diagnostics,after:meshDataAfter.diagnostics},
  'Sequential cap edit broke logical face corners or persistent IDs');
 await page.evaluate(()=>window.MARK_RIG_VIEWER_API.centerView('threequarter'));
 await page.evaluate(()=>window.MARK_RIG_VIEWER_API.seek(0));
 const movedShot=await screenshot(page,'seam-cap-moved-threequarter-webgl.png',
  'Real sequential logical-cap translation and attached side walls');
 const beforePixels=PNG.sync.read(readFileSync(join(root,afterImage.name)));
 const afterPixels=PNG.sync.read(readFileSync(join(root,movedShot.name)));
 let capChanged=0;
 for(let i=0;i<beforePixels.data.length;i+=4)
  if(Math.abs(beforePixels.data[i]-afterPixels.data[i])+
   Math.abs(beforePixels.data[i+1]-afterPixels.data[i+1])+
   Math.abs(beforePixels.data[i+2]-afterPixels.data[i+2])>24)capChanged++;
 assertCheck('P22-CAP-VIEWPORT-PIXELS-003',capChanged>100,
  {changedPixels:capChanged,beforeSha:afterImage.sha256,
   afterSha:movedShot.sha256},'Cap moved only in metadata, not real WebGL geometry');
 const movedFiles=await page.evaluate(async()=>{
  const request=async(method,params={})=>{
   const r=await window.MARK_AI_BRIDGE.request({
    requestId:'p18.out.'+method,method,params});
   if(!r.ok)throw Error(JSON.stringify(r.diagnostics));
   return r.result;
  };
  const native=await request('scene.save'),
   exported=await request('scene.export');
  return {native:Array.from(native.data),glb:Array.from(exported.data)};
 });
 const capArchive=artifact('cap-moved-native.markscene',movedFiles.native);
 const capGlb=artifact('cap-moved-real.glb',movedFiles.glb);
 const replayed=await openPreviewMarkscene(Buffer.from(movedFiles.native));
 const rendered=await exportEditedSourceGlb(replayed);
 const capRig=inspectRiggedGlb(Buffer.from(movedFiles.glb));
 assertCheck('P22-SEQUENTIAL-NATIVE-004',
  replayed.sourceSha256===sourceSha&&
  replayed.edits.meshOperations.length===2&&
  replayed.edits.meshOperations[1].kind==='vertex.moveLinkedCap'&&
  SHA(rendered.glb)===SHA(movedFiles.glb)&&
  capRig.skins[0].joints===70&&capRig.animations.length===3&&
  capRig.morphs[0].targets===2,
  {archive:capArchive,glb:capGlb,sha:SHA(movedFiles.glb)},
  'Real sequential cap position/rig corrupted during project save/reopen');
 await page.locator('#mesh-undo').click();
 await page.waitForFunction(()=>window.MARK_AI_BRIDGE.getSnapshot()
  .edits?.meshOperations?.length===1,null,{timeout:30000});
 await page.locator('#mesh-redo').click();
 await page.waitForFunction(()=>window.MARK_AI_BRIDGE.getSnapshot()
  .edits?.meshOperations?.length===2,null,{timeout:30000});
 const capRedone=await page.evaluate(async()=>{
  const r=await window.MARK_AI_BRIDGE.request({
   requestId:'p18.redo',method:'scene.export',params:{}});
  return r.ok?Array.from(r.result.data):null;
 });
 assertCheck('P22-MOVE-UNDO-REDO-005',
  Array.isArray(capRedone)&&SHA(capRedone)===SHA(movedFiles.glb),
  {redoSha:capRedone?SHA(capRedone):null,expectSha:SHA(movedFiles.glb)},
  'Sequential cap movement changed binary output after Undo/Redo');
 // A THIRD genuine edit in the GUI: triangulate one approved CAP face.
 // The visual surface is unchanged by subdivision; prove new topology by
 // ray-picking a NEW indexed child triangle and recording its real wire overlay.
 await page.locator('#mesh-a').fill('0');
 await page.locator('#mesh-poke-cap').click();
 await page.waitForFunction(()=>window.MARK_AI_BRIDGE.getSnapshot()
  .edits?.meshOperations?.[2]?.kind==='face.pokeLinkedCap',
  null,{timeout:30000});
 const meshPoked=await page.evaluate(async()=>{
  const r=await window.MARK_AI_BRIDGE.request({
   requestId:'p19.poked-data',method:'mesh.getMeshData',
   params:{meshId:'gltf-mesh-0',full:true}});
  if(!r.ok)throw Error(JSON.stringify(r.diagnostics));
  return r.result;
 });
 assertCheck('P22-TOPOLOGY-POKE-001',
  meshPoked.diagnostics.triangleCount===12&&
  meshPoked.diagnostics.cornerCount===36&&
  meshPoked.diagnostics.halfedgeCount===36&&
  meshPoked.diagnostics.capPokeCount===1&&
  meshPoked.diagnostics.boundaryEdges===4&&
  meshPoked.diagnostics.nonManifoldEdges===0&&
  meshPoked.topologyRemap.createdFaceIds.length===2&&
  meshPoked.topologyRemap.centerAttributeVertex===28,
  {remap:meshPoked.topologyRemap,
   diagnostics:meshPoked.diagnostics},'Real cap split did not update MeshData');
 // Save the unselected physical glTF before adding a selection overlay.
 await page.evaluate(()=>window.MARK_RIG_VIEWER_API.centerView('front'));
 const plainPoke=await screenshot(page,'cap-poke-physical-unselected-webgl.png',
  'Actual physical Poke on skinned cap, no overlays');
 // Use real raycaster click at face 10, which exists ONLY after Poke.
 await page.locator('#mesh-pick-mode').selectOption('face');
 // Earlier CI steps disable the picker through its debug API without
 // changing the visible button state. Enable the real raycaster explicitly
 // here so the pointer click is an actual viewport face selection.
 await page.evaluate(()=>window.MARK_MESH_PICK_API.enable(true));
 const child=await page.evaluate(()=>
  window.MARK_MESH_PICK_API.projectFace(0,10));
 await page.locator('#viewport').scrollIntoViewIfNeeded();
 const vp=await page.locator('#viewport').boundingBox();
 assertCheck('P22-CANVAS-VISIBLE-000',
  Boolean(vp)&&child.x>0&&child.x<vp.width&&
  child.y>0&&child.y<vp.height&&
  vp.y>=0&&vp.y+vp.height<=780,
  {vp,child},'Real ray pick target is outside scrolled viewport canvas');
 await page.mouse.click(vp.x+child.x,vp.y+child.y);
 const selectedChild=await page.evaluate(()=>({
  selection:window.MARK_MESH_PICK_API.selection(),
  region:window.MARK_MESH_PICK_API.region()
 }));
 assertCheck('P22-PICK-NEW-CHILD-002',
  selectedChild.selection?.face===10&&
  selectedChild.region?.faces?.join(',')==='10'&&
  selectedChild.region.boundaryEdges.length===3,
  {selectedChild,child,vp},
  'New cap Poke child was not actually selectable in WebGL2');
 const chosenShot=await screenshot(page,'cap-poke-new-child-selected-webgl.png',
  'New real indexed cap triangle #10 selected by Chromium mouse click');
 const without=PNG.sync.read(readFileSync(join(root,plainPoke.name)));
 const chosen=PNG.sync.read(readFileSync(join(root,chosenShot.name)));
 let selectedPixels=0;
 for(let i=0;i<without.data.length;i+=4)
  if(Math.abs(without.data[i]-chosen.data[i])+
   Math.abs(without.data[i+1]-chosen.data[i+1])+
   Math.abs(without.data[i+2]-chosen.data[i+2])>24)selectedPixels++;
 assertCheck('P22-CHILD-WEBGL-PIXELS-003',
  selectedPixels>100,{changedPixels:selectedPixels},
  'New real selected triangle did not create visible viewport overlay');
 await page.evaluate(()=>window.MARK_MESH_PICK_API.enable(false));
 const physical=await page.evaluate(async()=>{
  const request=async(method,params={})=>{
   const r=await window.MARK_AI_BRIDGE.request({
    requestId:'p19.poke.'+method,method,params});
   if(!r.ok)throw Error(JSON.stringify(r.diagnostics));
   return r.result;
  };
  const native=await request('scene.save');
  const exported=await request('scene.export');
  const stats=await request('mesh.getStats',{meshId:'gltf-mesh-0'});
  return{native:Array.from(native.data),glb:Array.from(exported.data),stats};
 });
 const pokeArchive=artifact('cap-poke-editable.markscene',physical.native);
 const pokeGlb=artifact('cap-poke-real.glb',physical.glb);
 const opened=await openPreviewMarkscene(Buffer.from(physical.native));
 const pokeReplay=await exportEditedSourceGlb(opened);
 const pokedRig=inspectRiggedGlb(Buffer.from(physical.glb));
 assertCheck('P22-POKE-NATIVE-RIG-004',
  opened.sourceSha256===sourceSha&&
  opened.edits.meshOperations.length===3&&
  opened.edits.meshOperations[2].sourceFace===0&&
  SHA(pokeReplay.glb)===SHA(physical.glb)&&
  physical.stats.triangleCount===12&&physical.stats.vertexCount===29&&
  pokedRig.skins[0].joints===70&&
  pokedRig.animations.length===3&&pokedRig.morphs[0].targets===2,
  {archive:pokeArchive,glb:pokeGlb,stats:physical.stats},
  'Physical Poke damaged native save, skin, morphs or true GLB indices');
 const illegal=await page.evaluate(async()=>{
  const r=await window.MARK_AI_BRIDGE.request({
   requestId:'p19.second-poke',method:'mesh.pokeLinkedCap',
   params:{meshId:'gltf-mesh-0',
    capFaceId:'mark-face-'+window.MARK_AI_BRIDGE.getSnapshot()
     .sourceSha256+'-m0-p0-cap-face-0'}});
  return{ok:r.ok,diagnostics:r.diagnostics};
 });
 assertCheck('P22-POKE-ONCE-GUARD-005',illegal.ok===false,illegal,
  'Repeating an already poked source face must be rejected');
 // Pass20 — the next genuine topology mutation uses DIFFERENT
 // original source cap face, while the first Poke retains its stable IDs.
 await page.locator('#mesh-a').fill('1');
 await page.locator('#mesh-poke-cap').click();
 await page.waitForFunction(()=>window.MARK_AI_BRIDGE.getSnapshot()
  .edits?.meshOperations?.[3]?.kind==='face.pokeLinkedCap',
  null,{timeout:30000});
 const multiMeshData=await page.evaluate(async()=>{
  const r=await window.MARK_AI_BRIDGE.request({
   requestId:'p20.topo.after-second',method:'mesh.getMeshData',
   params:{meshId:'gltf-mesh-0',full:true}});
  if(!r.ok)throw Error(JSON.stringify(r.diagnostics));
  return r.result;
 });
 assertCheck('P22-MULTI-POKE-007',
  multiMeshData.diagnostics.triangleCount===14&&
  multiMeshData.diagnostics.cornerCount===42&&
  multiMeshData.diagnostics.halfedgeCount===42&&
  multiMeshData.diagnostics.nonManifoldEdges===0&&
  multiMeshData.diagnostics.boundaryEdges===4&&
  multiMeshData.diagnostics.capPokeCount===2&&
  multiMeshData.topologyRemaps?.length===2&&
  multiMeshData.topologyRemaps[0].sourceFace===0&&
  multiMeshData.topologyRemaps[1].sourceFace===1&&
  multiMeshData.topologyRemaps[0].centerAttributeVertex===28&&
  multiMeshData.topologyRemaps[1].centerAttributeVertex===29&&
  JSON.stringify(multiMeshData.topologyRemaps[0])===
   JSON.stringify(meshPoked.topologyRemap),
  {diagnostics:multiMeshData.diagnostics,remaps:multiMeshData.topologyRemaps},
  'Second Poke did not retain first face/corner/halfedge provenance');
 await page.evaluate(()=>window.MARK_RIG_VIEWER_API.centerView('front'));
 const secondPlain=await screenshot(page,'second-poke-no-overlay-webgl.png',
  'Real two-Poke skinned geometry, no selection overlay');
 await page.locator('#mesh-pick-mode').selectOption('face');
 await page.evaluate(()=>window.MARK_MESH_PICK_API.enable(true));
 const secondChild=await page.evaluate(()=>
  window.MARK_MESH_PICK_API.projectFace(0,12));
 await page.locator('#viewport').scrollIntoViewIfNeeded();
 const secondBox=await page.locator('#viewport').boundingBox();
 assertCheck('P22-SECOND-PICK-ONSCREEN-008',
  Boolean(secondBox)&&secondChild.visible&&secondChild.x>0&&
  secondChild.y>0&&secondChild.x<secondBox.width&&
  secondChild.y<secondBox.height&&secondBox.y>=0&&
  secondBox.y+secondBox.height<=780,
  {secondBox,secondChild},'New Poke child raycast target outside canvas');
 await page.mouse.click(secondBox.x+secondChild.x,
  secondBox.y+secondChild.y);
 const secondSelected=await page.evaluate(()=>({
  selection:window.MARK_MESH_PICK_API.selection(),
  region:window.MARK_MESH_PICK_API.region()
 }));
 assertCheck('P22-SECOND-CHILD-RAYPICK-009',
  secondSelected.selection?.face===12&&
  secondSelected.region?.faces?.join(',')==='12'&&
  secondSelected.region.boundaryEdges.length===3,
  {secondSelected,secondChild,secondBox},
  'New second Poke child was not selected by an actual Chromium mouse click');
 const secondChosen=await screenshot(page,'second-poke-child12-selected-webgl.png',
  'Real face #12 from second Poke selected in WebGL2 canvas');
 const unselected=PNG.sync.read(readFileSync(join(root,secondPlain.name)));
 const selected=PNG.sync.read(readFileSync(join(root,secondChosen.name)));
 let secondChanged=0;
 for(let i=0;i<unselected.data.length;i+=4)
  if(Math.abs(unselected.data[i]-selected.data[i])+
   Math.abs(unselected.data[i+1]-selected.data[i+1])+
   Math.abs(unselected.data[i+2]-selected.data[i+2])>24)secondChanged++;
 assertCheck('P22-SECOND-REAL-OVERLAY-010',secondChanged>100,
  {secondChanged,before:secondPlain.sha256,after:secondChosen.sha256},
  'Second new triangle was not visible in actual WebGL2 overlay');
 await page.evaluate(()=>window.MARK_MESH_PICK_API.enable(false));
 const twoPhysical=await page.evaluate(async()=>{
  const request=async(method,params={})=>{
   const r=await window.MARK_AI_BRIDGE.request({
    requestId:'p20.two.'+method,method,params});
   if(!r.ok)throw Error(JSON.stringify(r.diagnostics));
   return r.result;
  };
  const native=await request('scene.save');
  const exported=await request('scene.export');
  const stats=await request('mesh.getStats',{meshId:'gltf-mesh-0'});
  return{native:Array.from(native.data),glb:Array.from(exported.data),stats};
 });
 const twoNative=artifact('two-pokes-editable.markscene',twoPhysical.native);
 const twoGlb=artifact('two-pokes-real.glb',twoPhysical.glb);
 const twoOpen=await openPreviewMarkscene(Buffer.from(twoPhysical.native));
 const twoReplay=await exportEditedSourceGlb(twoOpen);
 const twoRig=inspectRiggedGlb(Buffer.from(twoPhysical.glb));
 assertCheck('P22-TWO-POKE-NATIVE-011',
  twoOpen.sourceSha256===sourceSha&&
  twoOpen.edits.meshOperations.length===4&&
  twoOpen.edits.meshOperations[2].sourceFace===0&&
  twoOpen.edits.meshOperations[3].sourceFace===1&&
  SHA(twoReplay.glb)===SHA(twoPhysical.glb)&&
  twoPhysical.stats.triangleCount===14&&
  twoPhysical.stats.vertexCount===30&&
  twoRig.skins[0].joints===70&&twoRig.animations.length===3&&
  twoRig.morphs[0].targets===2,
  {native:twoNative,glb:twoGlb,stats:twoPhysical.stats},
  'Second Poke lost native project, rig/morph streams or binary topology');
 await page.locator('#mesh-undo').click();
 await page.waitForFunction(()=>window.MARK_AI_BRIDGE.getSnapshot()
  .edits?.meshOperations?.length===3,null,{timeout:30000});
 await page.locator('#mesh-redo').click();
 await page.waitForFunction(()=>window.MARK_AI_BRIDGE.getSnapshot()
  .edits?.meshOperations?.length===4,null,{timeout:30000});
 const redoPoke=await page.evaluate(async()=>{
  const r=await window.MARK_AI_BRIDGE.request({
   requestId:'p19.poke-redo-export',method:'scene.export',params:{}});
  return r.ok?Array.from(r.result.data):null;
 });
 assertCheck('P22-POKE-UNDO-REDO-006',
  Array.isArray(redoPoke)&&SHA(redoPoke)===SHA(twoPhysical.glb),
  {after:SHA(twoPhysical.glb),
   redo:redoPoke?SHA(redoPoke):null},
  'Poke does not replay exactly after Undo/Redo');
 // Split the REAL radial edge connecting the Poked source corner 1
 // to the new center of source face 0. This command must repair BOTH
 // incident indexed cap triangles, unlike a visual-only overlay.
 await page.locator('#mesh-a').fill('0');
 await page.locator('#mesh-b').fill('1');
 await page.locator('#mesh-split-cap-edge').click();
 await page.waitForFunction(()=>window.MARK_AI_BRIDGE.getSnapshot()
  .edits?.meshOperations?.[4]?.kind==='edge.splitPokedCap',
  null,{timeout:30000});
 const radialData=await page.evaluate(async()=>{
  const reply=await window.MARK_AI_BRIDGE.request({
   requestId:'p21.split.meshdata',method:'mesh.getMeshData',
   params:{meshId:'gltf-mesh-0',full:true}});
  if(!reply.ok)throw Error(JSON.stringify(reply.diagnostics));
  return reply.result;
 });
 assertCheck('P22-RADIAL-TOPOLOGY-012',
  radialData.diagnostics.triangleCount===16&&
  radialData.diagnostics.cornerCount===48&&
  radialData.diagnostics.halfedgeCount===48&&
  radialData.diagnostics.boundaryEdges===4&&
  radialData.diagnostics.nonManifoldEdges===0&&
  radialData.diagnostics.radialSplitCount===1&&
  radialData.edgeSplitRemap.newAttributeVertex===30&&
  radialData.edgeSplitRemap.modifiedFaceIds.length===2&&
  radialData.edgeSplitRemap.newFaceIds.length===2&&
  radialData.edgeSplitRemap.createdEdgeIds.length>=3,
  {diagnostics:radialData.diagnostics,remap:radialData.edgeSplitRemap},
  'Real radial split did not update both incident cap triangles');
 await page.evaluate(()=>window.MARK_RIG_VIEWER_API.centerView('front'));
 const splitUnselected=await screenshot(page,'radial-split-unselected-webgl.png',
  'Actual skinned two-Poke cap after split, no fake geometry overlay');
 await page.locator('#mesh-pick-mode').selectOption('face');
 await page.evaluate(()=>window.MARK_MESH_PICK_API.enable(true));
 const radialChild=await page.evaluate(()=>
  window.MARK_MESH_PICK_API.projectFace(0,14));
 await page.locator('#viewport').scrollIntoViewIfNeeded();
 const radialBox=await page.locator('#viewport').boundingBox();
 assertCheck('P22-RADIAL-CHILD-ONSCREEN-013',
  Boolean(radialBox)&&radialChild.visible&&radialChild.x>0&&
  radialChild.y>0&&radialChild.x<radialBox.width&&
  radialChild.y<radialBox.height&&radialBox.y>=0&&
  radialBox.y+radialBox.height<=780,
  {radialChild,radialBox},
  'Real newly added split child #16 outside WebGL canvas');
 await page.mouse.click(radialBox.x+radialChild.x,
  radialBox.y+radialChild.y);
 const selectedRadial=await page.evaluate(()=>({
  selection:window.MARK_MESH_PICK_API.selection(),
  region:window.MARK_MESH_PICK_API.region()
 }));
 assertCheck('P22-RADIAL-CHILD-RAYPICK-014',
  selectedRadial.selection?.face===14&&
  selectedRadial.region?.faces?.join(',')==='14',
  {selectedRadial,radialChild,radialBox},
  'The real new radial triangle is not ray-pickable');
 const splitSelected=await screenshot(page,'radial-child14-selected-webgl.png',
  'Face #16 physically created by radial Edge Split, selected by mouse click');
 const radialBefore=PNG.sync.read(readFileSync(join(root,splitUnselected.name))),
  radialAfter=PNG.sync.read(readFileSync(join(root,splitSelected.name)));
 let changed=0;
 for(let i=0;i<radialBefore.data.length;i+=4)
  if(Math.abs(radialBefore.data[i]-radialAfter.data[i])+
   Math.abs(radialBefore.data[i+1]-radialAfter.data[i+1])+
   Math.abs(radialBefore.data[i+2]-radialAfter.data[i+2])>24)changed++;
 assertCheck('P22-RADIAL-CANVAS-PIXELS-015',changed>100,
  {changed,before:splitUnselected.sha256,after:splitSelected.sha256},
  'No visible highlight for newly created real cap triangle');
 await page.evaluate(()=>window.MARK_MESH_PICK_API.enable(false));
 const radialFiles=await page.evaluate(async()=>{
  const request=async(method,params={})=>{
   const r=await window.MARK_AI_BRIDGE.request({
    requestId:'p21.export.'+method,method,params});
   if(!r.ok)throw Error(JSON.stringify(r.diagnostics));
   return r.result;
  };
  const native=await request('scene.save'),
   glb=await request('scene.export'),
   stats=await request('mesh.getStats',{meshId:'gltf-mesh-0'});
  return{native:Array.from(native.data),glb:Array.from(glb.data),stats};
 });
 const nativeArtifact=artifact('radial-edge-split.markscene',radialFiles.native),
  glbArtifact=artifact('radial-edge-split-real.glb',radialFiles.glb);
 const openSplit=await openPreviewMarkscene(Buffer.from(radialFiles.native)),
  splitReplay=await exportEditedSourceGlb(openSplit),
  rigSplit=inspectRiggedGlb(Buffer.from(radialFiles.glb));
 assertCheck('P22-RADIAL-NATIVE-RIG-016',
  openSplit.sourceSha256===sourceSha&&
  openSplit.edits.meshOperations.length===5&&
  openSplit.edits.meshOperations[4].kind==='edge.splitPokedCap'&&
  SHA(splitReplay.glb)===SHA(radialFiles.glb)&&
  radialFiles.stats.triangleCount===16&&
  radialFiles.stats.vertexCount===31&&
  rigSplit.skins[0].joints===70&&
  rigSplit.animations.length===3&&rigSplit.morphs[0].targets===2,
  {nativeArtifact,glbArtifact,stats:radialFiles.stats},
  'Native replay lost verified source GLB or rig/morph animation');
 const illegalSplit=await page.evaluate(async()=>{
  const r=await window.MARK_AI_BRIDGE.request({
   requestId:'p21.duplicate.radial',method:'mesh.splitPokedCapEdge',
   params:{meshId:'gltf-mesh-0',sourceFace:0,sourceVertex:1,
    edgeId:'mark-not-a-current-edge'}});
  return{ok:r.ok,diagnostics:r.diagnostics};
 });
 assertCheck('P22-RADIAL-FOLLOWUP-GUARD-017',
  illegalSplit.ok===false,illegalSplit,
  'Unsupported second radial split was not rejected');
 await page.locator('#mesh-undo').click();
 await page.waitForFunction(()=>window.MARK_AI_BRIDGE.getSnapshot()
  .edits?.meshOperations?.length===4,null,{timeout:30000});
 await page.locator('#mesh-redo').click();
 await page.waitForFunction(()=>window.MARK_AI_BRIDGE.getSnapshot()
  .edits?.meshOperations?.length===5,null,{timeout:30000});
 const redoneSplit=await page.evaluate(async()=>{
  const r=await window.MARK_AI_BRIDGE.request({
   requestId:'p21.radial-redo',method:'scene.export',params:{}});
  return r.ok?Array.from(r.result.data):null;
 });
 assertCheck('P22-RADIAL-UNDO-REDO-018',
  Array.isArray(redoneSplit)&&SHA(redoneSplit)===SHA(radialFiles.glb),
  {expected:SHA(radialFiles.glb),
   redo:redoneSplit?SHA(redoneSplit):null},
  'Radial split failed to replay byte-for-byte after native Undo/Redo');
 // A second genuine user-approved Edge Split on a DIFFERENT Poke face.
 // Edge IDs come from the actual current WebGL2-backed MeshData graph;
 // the split is not a visual-only overlay and cannot reuse the first edge.
 await page.locator('#mesh-a').fill('1');
 await page.locator('#mesh-b').fill('3');
 await page.locator('#mesh-split-cap-edge').click();
 await page.waitForFunction(()=>window.MARK_AI_BRIDGE.getSnapshot()
  .edits?.meshOperations?.[5]?.kind==='edge.splitPokedCap',
  null,{timeout:30000});
 const multiRadial=await page.evaluate(async()=>{
  const r=await window.MARK_AI_BRIDGE.request({
   requestId:'p22.two.radial-data',method:'mesh.getMeshData',
   params:{meshId:'gltf-mesh-0',full:true}});
  if(!r.ok)throw Error(JSON.stringify(r.diagnostics));
  return r.result;
 });
 assertCheck('P22-MULTI-RADIAL-019',
  multiRadial.diagnostics.radialSplitCount===2&&
  multiRadial.diagnostics.triangleCount===18&&
  multiRadial.diagnostics.cornerCount===54&&
  multiRadial.diagnostics.halfedgeCount===54&&
  multiRadial.diagnostics.boundaryEdges===4&&
  multiRadial.diagnostics.nonManifoldEdges===0&&
  multiRadial.diagnostics.windingConflicts===0&&
  multiRadial.edgeSplitRemaps.length===2&&
  JSON.stringify(multiRadial.edgeSplitRemaps[0])===
   JSON.stringify(radialData.edgeSplitRemap)&&
  multiRadial.edgeSplitRemaps[1].sourceFace===1&&
  multiRadial.edgeSplitRemaps[1].sourceVertex===3&&
  multiRadial.edgeSplitRemaps[1].newAttributeVertex===31,
  {diagnostics:multiRadial.diagnostics,
   remaps:multiRadial.edgeSplitRemaps},
  'Second split did not preserve first stable edge/corner provenance');
 await page.evaluate(()=>window.MARK_RIG_VIEWER_API.centerView('front'));
 const twoBefore=await screenshot(page,'two-radial-splits-no-selection-webgl.png',
  'Rigged GLB with two real radial splits, no selection overlays');
 await page.locator('#mesh-pick-mode').selectOption('face');
 await page.evaluate(()=>window.MARK_MESH_PICK_API.enable(true));
 // 14 triangles before Pass21; first split created 14,15;
 // second creates 16,17. These are real rendered indexed faces 0..17.
 const child2=await page.evaluate(()=>
  window.MARK_MESH_PICK_API.projectFace(0,16));
 await page.locator('#viewport').scrollIntoViewIfNeeded();
 const viewport2=await page.locator('#viewport').boundingBox();
 assertCheck('P22-SECOND-SPLIT-ONSCREEN-020',
  Boolean(viewport2)&&child2.visible&&child2.x>0&&child2.y>0&&
  child2.x<viewport2.width&&child2.y<viewport2.height&&
  viewport2.y>=0&&viewport2.y+viewport2.height<=780,
  {child2,viewport2},'Second new face must project onto actual canvas');
 await page.mouse.click(viewport2.x+child2.x,viewport2.y+child2.y);
 const selection2=await page.evaluate(()=>({
  selection:window.MARK_MESH_PICK_API.selection(),
  region:window.MARK_MESH_PICK_API.region()
 }));
 assertCheck('P22-SECOND-SPLIT-MOUSE-PICK-021',
  selection2.selection?.face===16&&
  selection2.region?.faces?.join(',')==='16',
  {selection2,child2,viewport2},
  'Real Chromium mouse must pick newly created second split face #16');
 const twoAfter=await screenshot(page,'two-radial-splits-face16-selected-webgl.png',
  'New indexed face #16 of second split genuinely picked by mouse');
 const noSelection=PNG.sync.read(readFileSync(join(root,twoBefore.name))),
  withSelection=PNG.sync.read(readFileSync(join(root,twoAfter.name)));
 let selectionPixels=0;
 for(let i=0;i<noSelection.data.length;i+=4)
  if(Math.abs(noSelection.data[i]-withSelection.data[i])+
   Math.abs(noSelection.data[i+1]-withSelection.data[i+1])+
   Math.abs(noSelection.data[i+2]-withSelection.data[i+2])>24)selectionPixels++;
 assertCheck('P22-SECOND-REAL-PIXELS-022',selectionPixels>100,
  {selectionPixels,unselected:twoBefore.sha256,selected:twoAfter.sha256},
  'Genuine second split triangle must have visible selected contour');
 await page.evaluate(()=>window.MARK_MESH_PICK_API.enable(false));
 const twoFiles=await page.evaluate(async()=>{
  const request=async(method,params={})=>{
   const r=await window.MARK_AI_BRIDGE.request({
    requestId:'p22.saved.'+method,method,params});
   if(!r.ok)throw Error(JSON.stringify(r.diagnostics));
   return r.result;
  };
  const native=await request('scene.save'),
   glb=await request('scene.export'),
   stats=await request('mesh.getStats',{meshId:'gltf-mesh-0'});
  return{native:Array.from(native.data),glb:Array.from(glb.data),stats};
 });
 const twoNative=artifact('two-radial-splits.markscene',twoFiles.native),
  twoGlb=artifact('two-radial-splits-edited.glb',twoFiles.glb);
 const secondOpen=await openPreviewMarkscene(Buffer.from(twoFiles.native)),
  secondReplay=await exportEditedSourceGlb(secondOpen),
  secondRig=inspectRiggedGlb(Buffer.from(twoFiles.glb));
 assertCheck('P22-SECOND-SPLIT-NATIVE-023',
  secondOpen.sourceSha256===sourceSha&&
  secondOpen.edits.meshOperations.length===6&&
  secondOpen.edits.meshOperations[5].sourceFace===1&&
  secondOpen.edits.meshOperations[5].sourceVertex===3&&
  SHA(secondReplay.glb)===SHA(twoFiles.glb)&&
  twoFiles.stats.triangleCount===18&&twoFiles.stats.vertexCount===32&&
  secondRig.skins[0].joints===70&&
  secondRig.morphs[0].targets===2&&secondRig.animations.length===3,
  {twoNative,twoGlb,stats:twoFiles.stats},
  'Second split damaged native save, skinned geometry or replay');
 const duplicate=await page.evaluate(async()=>{
  const r=await window.MARK_AI_BRIDGE.request({
   requestId:'p22.duplicate',method:'mesh.splitPokedCapEdge',
   params:{meshId:'gltf-mesh-0',sourceFace:1,sourceVertex:4,
    edgeId:'forged-non-existing'}});
  return{ok:r.ok,diagnostics:r.diagnostics};
 });
 assertCheck('P22-SECOND-DUPLICATE-BLOCK-024',
  !duplicate.ok&&JSON.stringify(duplicate.diagnostics)
   .includes('RADIAL_SEQUENCE'),duplicate,
  'Already split Poke face must reject another split');
 await page.locator('#mesh-undo').click();
 await page.waitForFunction(()=>window.MARK_AI_BRIDGE.getSnapshot()
  .edits?.meshOperations?.length===5,null,{timeout:30000});
 await page.locator('#mesh-redo').click();
 await page.waitForFunction(()=>window.MARK_AI_BRIDGE.getSnapshot()
  .edits?.meshOperations?.length===6,null,{timeout:30000});
 const redoTwo=await page.evaluate(async()=>{
  const r=await window.MARK_AI_BRIDGE.request({
   requestId:'p22.redo2',method:'scene.export',params:{}});
  return r.ok?Array.from(r.result.data):null;
 });
 assertCheck('P22-SECOND-SPLIT-UNDO-REDO-025',
  Array.isArray(redoTwo)&&SHA(redoTwo)===SHA(twoFiles.glb),
  {expected:SHA(twoFiles.glb),redo:redoTwo?SHA(redoTwo):null},
  'Two sequential splits must replay byte-for-byte after Undo/Redo');
 assertCheck('P22-BROWSER-ERRORS-006',errors.length===0,{errors},
  'Uncaught browser error during seam analysis');
 report.status='pass';
}catch(error){report.status='fail';report.errors.push(String(error?.stack||error));}
finally{
 await browser.close();report.completedAt=new Date().toISOString();
 writeFileSync(join(root,'pass22-report.json'),JSON.stringify(report,null,2)+'\n');
 console.log('PASS22 '+report.status.toUpperCase()+' '+JSON.stringify({
  tests:report.tests.map(t=>({id:t.testId,status:t.status})),
  errors:report.errors,artifacts:report.artifacts.length
 }));
 if(report.status!=='pass')process.exitCode=1;
}
