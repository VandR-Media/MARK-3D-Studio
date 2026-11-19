import test from 'node:test';
import assert from 'node:assert/strict';
import {buildRiggedFixture} from '../scripts/pro-studio-glb-fixtures.mjs';
import {createAiBridge,BRIDGE_VERSION} from '../src/pro-studio/ai-bridge-core.js';
import {parseGlb} from '../src/glb.js';
import {openPreviewMarkscene} from '../src/pro-studio/markscene-v3-preview.js';
import {compareGlbSemantics} from '../src/pro-studio/glb-semantic-diff.js';
import {compareGlbTextures} from '../src/pro-studio/glb-texture-qa.js';

const fixture=buildRiggedFixture();
const api=(bridge,method,params={})=>bridge.request({
 requestId:'test.'+method,method,params
});
const expectError=(res,code)=>{
 assert.equal(res.ok,false,'Expected failure for '+code);
 assert.equal(res.diagnostics[0].code,code);
 assert.equal(res.result,null);
};
async function opened(options={}){
 const bridge=createAiBridge({allowWrites:true,buildHash:'test-unit',...options});
 const up=await api(bridge,'asset.upload',{
  name:'70-bone-morph.glb',type:'glb',data:fixture.bytes
 });
 assert.equal(up.ok,true,JSON.stringify(up.diagnostics));
 const op=await api(bridge,'scene.open',{assetId:up.result.assetId});
 assert.equal(op.ok,true,JSON.stringify(op.diagnostics));
 return bridge;
}
test('AI Bridge capability discovery is honest, stable, no network or sculpt claims',async()=>{
 const apiBridge=createAiBridge({buildHash:'unit-test'});
 const r=await api(apiBridge,'studio.getCapabilities');
 assert.equal(r.ok,true);
 assert.equal(r.result.schema,BRIDGE_VERSION);
 assert.equal(r.buildHash,'unit-test');
 assert.ok(r.result.supported.includes('transaction.rollback'));
 assert.ok(r.result.supported.includes('scene.save'));
 assert.ok(r.result.supported.includes('mesh.edit'));
 assert.ok(r.result.supported.includes('mesh.getStats'));
 assert.ok(r.result.supported.includes('mesh.create'));
 assert.ok(r.result.supported.includes('scene.new'));
 assert.ok(!r.result.supported.includes('render.capture'));
 assert.match(r.result.transport,/in-process/);
 assert.ok(r.result.unsupported.includes('network transport'));
 assert.equal((await api(apiBridge,'studio.getVersion')).result.appVersion,'0.7.0-alpha.0');
});
test('read-only authorization prevents uploads, edits, transactions and audit logs carry request IDs',async()=>{
 let grant=false;
 const b=createAiBridge({allowWrites:()=>grant});
 expectError(await api(b,'asset.upload',{
  name:'rig.glb',type:'glb',data:fixture.bytes
 }),'WRITE_PERMISSION_DENIED');
 grant=true;
 const up=await api(b,'asset.upload',{name:'rig.glb',type:'glb',data:fixture.bytes});
 assert.equal(up.ok,true);
 const open=await api(b,'scene.open',{assetId:up.result.assetId});
 assert.equal(open.ok,true);
 grant=false;
 expectError(await api(b,'transaction.begin'),'WRITE_PERMISSION_DENIED');
 expectError(await api(b,'object.setTransform',{
  uuid:'gltf-node-1',transform:{translation:[.2,0,0]}
 }),'WRITE_PERMISSION_DENIED');
 assert.equal((await api(b,'scene.getHierarchy')).ok,true);
 assert.equal((await api(b,'asset.list')).result.assets.length,1);
 assert.ok(b.getAudit().some(x=>x.method==='transaction.begin'&&x.code==='WRITE_PERMISSION_DENIED'));
});
test('client receives structured diagnostic for unsupported methods, non UUIDs and bad uploads',async()=>{
 const b=await opened();
 expectError(await api(b,'mesh.edit',{script:'eval("foo")'}),'MESH_TARGET');
 expectError(await api(b,'mesh.create',{script:'eval("foo")'}),'MESH_CREATE_ARGS');
 expectError(await api(b,'modifier.add',{script:'eval("foo")'}),'UNSUPPORTED_OPERATION');
 expectError(await api(b,'object.setTransform',{
  uuid:'SkinnedQuad',transform:{translation:[.2,0,0]}
 }),'INVALID_UUID');
 expectError(await api(b,'object.setTransform',{
  uuid:'gltf-node-9999',transform:{translation:[.2,0,0]}
 }),'OBJECT_NOT_FOUND');
 expectError(await api(b,'material.setPbr',{
  materialId:'gltf-material-0',pbr:{roughnessFactor:17}
 }),'INVALID_PBR');
 expectError(await api(b,'asset.upload',{
  name:'external.glb',type:'glb',data:new TextEncoder().encode('https://malicious.invalid')
 }),'ASSET_TYPE_MISMATCH');
 const unknown=await b.request({requestId:'foo-uuid',method:'missing',params:{}});
 assert.equal(unknown.requestId,'foo-uuid');
 expectError(unknown,'UNSUPPORTED_OPERATION');
});
test('atomic begin/edit/edit/commit produces one revision and preserves old GLB binary',async()=>{
 const b=await opened(),before=b.getSnapshot();
 const graph=(await api(b,'scene.getHierarchy')).result.nodes;
 assert.ok(graph.find(n=>n.uuid==='gltf-node-1'&&n.displayName==='SkinnedQuad'));
 const materials=(await api(b,'scene.getMaterials')).result.materials;
 assert.equal(materials[0].materialId,'gltf-material-0');
 const t=await api(b,'transaction.begin');
 assert.equal(t.ok,true);
 const tx=t.result.transactionId;
 for(const request of [
  {method:'object.setTransform',params:{
   uuid:'gltf-node-1',transform:{translation:[.42,0,0]}}},
  {method:'material.setPbr',params:{
   materialId:'gltf-material-0',pbr:{roughnessFactor:.31,baseColorFactor:[1,.6,.4,1]}}},
  {method:'animation.preview',params:{clipIndex:2,timeSeconds:6}}
 ]){
  const r=await api(b,request.method,request.params);
  assert.equal(r.ok,true,JSON.stringify(r.diagnostics));
  assert.equal(r.result.staged,true);
 }
 assert.equal(b.getSnapshot().revision,before.revision);
 assert.equal(b.getSnapshot().edits.nodeTransforms['1'],undefined);
 const validated=await api(b,'scene.validate');
 assert.equal(validated.ok,true);
 assert.equal(validated.result.currentEdits.selection.clipIndex,2);
 const committed=await api(b,'transaction.commit',{transactionId:tx});
 assert.equal(committed.ok,true,JSON.stringify(committed.diagnostics));
 assert.equal(committed.result.commands,3);
 assert.equal(b.getSnapshot().revision,before.revision+1);
 assert.equal(b.getSnapshot().edits.materialPbr['0'].roughnessFactor,.31);
 const saved=await api(b,'scene.save'),out=await api(b,'scene.export');
 assert.equal(saved.ok,true);
 assert.equal(out.ok,true);
 const reopened=await openPreviewMarkscene(saved.result.data);
 assert.equal(reopened.sourceSha256,fixture.sha256);
 assert.equal(reopened.edits.nodeTransforms['1'].translation[0],.42);
 assert.equal(reopened.edits.selection.clipIndex,2);
 const doc=parseGlb(out.result.data).json;
 assert.equal(doc.materials[0].pbrMetallicRoughness.roughnessFactor,.31);
 assert.equal(doc.nodes[1].translation[0],.42);
 const semantic=compareGlbSemantics(fixture.bytes,out.result.data,{
  allowEditedNodes:['SkinnedQuad'],allowEditedMaterials:[0]});
 assert.equal(semantic.status,'pass_partial_profile',JSON.stringify(semantic.errors));
 assert.equal(compareGlbTextures(fixture.bytes,out.result.data).status,'pass_supported_png');
});
test('atomic rollback, invalid staged command, stale transaction and history undo/redo',async()=>{
 const b=await opened(),initial=b.getSnapshot();
 const start=await api(b,'transaction.begin');
 const tx=start.result.transactionId;
 const val=await api(b,'material.setPbr',{
  materialId:'gltf-material-0',pbr:{roughnessFactor:.25}
 });
 assert.equal(val.ok,true);
 expectError(await api(b,'object.setTransform',{
  uuid:'gltf-node-1',transform:{rotation:[0,0,0,2]}
 }),'INVALID_ROTATION');
 assert.equal(b.getSnapshot().stagedEdits.materialPbr['0'].roughnessFactor,.25);
 assert.equal(Object.keys(b.getSnapshot().stagedEdits.nodeTransforms).length,0);
 expectError(await api(b,'transaction.commit',{transactionId:'tx-wrong'}),'TRANSACTION_ID');
 const undone=await api(b,'transaction.rollback',{transactionId:tx});
 assert.equal(undone.ok,true);
 assert.equal(b.getSnapshot().revision,initial.revision);
 assert.equal(b.getSnapshot().edits.materialPbr['0'],undefined);
 expectError(await api(b,'history.undo'),'HISTORY_EMPTY');
 const direct=await api(b,'material.setPbr',{materialId:'gltf-material-0',
  pbr:{roughnessFactor:.27}});
 assert.equal(direct.ok,true);
 const rev=b.getSnapshot().revision;
 const undo=await api(b,'history.undo');
 assert.equal(undo.ok,true);
 assert.equal(b.getSnapshot().edits.materialPbr['0'],undefined);
 assert.equal(b.getSnapshot().revision,rev+1);
 const redo=await api(b,'history.redo');
 assert.equal(redo.ok,true);
 assert.equal(b.getSnapshot().edits.materialPbr['0'].roughnessFactor,.27);
 assert.equal(b.getSnapshot().redoDepth,0);
});
test('bad command cannot modify a committed scene; failing renderer rolls back logically',async()=>{
 let fail=false,opens=0;
 const b=await opened({adapter:{openGLB:async()=>{
  opens++;if(fail)throw Error('Simulated headless viewport failure');
 }}});
 const snapshot=b.getSnapshot();
 fail=true;
 const r=await api(b,'object.setTransform',{
  uuid:'gltf-node-1',transform:{translation:[1,0,0]}
 });
 expectError(r,'COMMAND_FAILED');
 assert.deepEqual(b.getSnapshot().edits,snapshot.edits);
 assert.equal(b.getSnapshot().revision,snapshot.revision);
 fail=false;
 assert.equal((await api(b,'object.setTransform',{
  uuid:'gltf-node-1',transform:{translation:[.3,0,0]}
 })).ok,true);
 assert.equal(b.getSnapshot().revision,snapshot.revision+1);
 assert.ok(opens>=3);
});
test('native archive upload and reopen across new bridge reconstruct exact source',async()=>{
 const b=await opened();
 await api(b,'animation.preview',{clipIndex:1,timeSeconds:3});
 const a=(await api(b,'scene.save')).result.data;
 const next=createAiBridge({allowWrites:true});
 const uploaded=await api(next,'asset.upload',{name:'session.markscene',
  type:'markscene',data:a});
 assert.equal(uploaded.ok,true,JSON.stringify(uploaded.diagnostics));
 const loaded=await api(next,'scene.open',{assetId:uploaded.result.assetId});
 assert.equal(loaded.ok,true);
 assert.equal(loaded.result.sourceSha256,fixture.sha256);
 assert.equal(next.getSnapshot().edits.selection.clipIndex,1);
 assert.equal(next.getSnapshot().edits.selection.timeSeconds,3);
});
test('in-process viewport adapter exposes camera and capture only when connected',async()=>{
 const png=Uint8Array.from([137,80,78,71,13,10,26,10,1,2,3,4]);
 let set=0,shots=0;
 const b=await opened({adapter:{
  openGLB:async()=>{},
  camera:async view=>{assert.equal(view,'back');set++;},
  capture:async options=>{assert.equal(options.view,'front');shots++;
   return {data:png,width:8,height:8,renderer:'test adapter, NOT WebGL2'};}
 }});
 assert.ok((await api(b,'studio.getCapabilities')).result.supported.includes('render.capture'));
 assert.equal((await api(b,'camera.set',{view:'back'})).ok,true);
 const shot=await api(b,'render.capture',{view:'front',timeSeconds:0});
 assert.equal(shot.ok,true);
 assert.equal(shot.result.width,8);
 assert.equal(shot.result.renderer,'test adapter, NOT WebGL2');
 assert.equal(shots,1);assert.equal(set,1);
});
