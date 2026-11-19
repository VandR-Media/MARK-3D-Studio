/**
 * MARK AI Bridge P0 / EXPERIMENTAL in-process command core.
 *
 * This is NOT an HTTP server or production Studio API. No implicit network,
 * no arbitrary URL, no eval, no arbitrary JS scripting, no file-system paths.
 * The same dispatcher can run in Node headless or against a live WebGL viewport.
 * Only implemented commands are included in capabilities. Unsafe/destructive
 * commands are not exposed. Binary commands use Uint8Array (transport adapter
 * must upload binary explicitly, not stringify it to untrusted JSON).
 */
import {parseGlb} from '../glb.js';
import {createPreviewMarkscene,openPreviewMarkscene,repackPreviewMarkscene,
 exportEditedSourceGlb,sha256} from './markscene-v3-preview.js';

export const BRIDGE_VERSION='mark.ai-bridge/0.1-preview';
const LIMITS=Object.freeze({maxAssetBytes:64*1024*1024,maxAssets:8,maxAudit:500,
 maxUndo:32,maxRequestString:256,maxBatchCommands:64});
const OP_NAMES=[
 'studio.getCapabilities','studio.getVersion',
 'asset.upload','asset.list','scene.open','scene.getHierarchy',
 'scene.getMaterials','scene.validate','scene.save','scene.export',
 'object.setTransform','material.setPbr','animation.preview',
 'transaction.begin','transaction.commit','transaction.rollback',
 'history.undo','history.redo'
];
const BRIDGE_ERR=(code,message)=>{
 const e=new Error(message);e.code=code;return e;
};
const guard=(yes,code,what)=>{
 if(!yes)throw BRIDGE_ERR(code,what);
};
const copy=value=>structuredClone(value);
const plain=x=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&
 Object.getPrototypeOf(x)===Object.prototype;
const bytesOf=input=>{
 guard(input instanceof ArrayBuffer||ArrayBuffer.isView(input),
  'INVALID_BINARY','Binary asset must be ArrayBuffer or Uint8Array');
 const raw=input instanceof ArrayBuffer?new Uint8Array(input):
  new Uint8Array(input.buffer,input.byteOffset,input.byteLength);
 guard(raw.length>0&&raw.length<=LIMITS.maxAssetBytes,'ASSET_SIZE',
  'Binary asset exceeds 64MiB profile or is empty');
 return raw.slice();
};
const numeric=x=>typeof x==='number'&&Number.isFinite(x);
const stableUuid=(uuid,prefix)=>{
 guard(typeof uuid==='string'&&uuid.startsWith(prefix),'INVALID_UUID',
  'Expected stable UUID with prefix '+prefix);
 const suffix=uuid.slice(prefix.length);
 guard(/^(0|[1-9][0-9]*)$/.test(suffix),'INVALID_UUID',
  'UUID must reference a stable glTF index');
 return Number(suffix);
};
const PROP_TRANSFORM=['translation','rotation','scale'];
const PROP_PBR=['metallicFactor','roughnessFactor','baseColorFactor'];
function normalizeTransform(value,node){
 guard(plain(value)&&Object.keys(value).length>0&&
  Object.keys(value).every(k=>PROP_TRANSFORM.includes(k)),
  'INVALID_TRANSFORM','Only translation, rotation and scale supported');
 guard(node.matrix===undefined,'MATRIX_ONLY_NODE',
  'Source node has matrix; TRS edit requires explicit decomposition');
 const result={};
 for(const [key,size] of [['translation',3],['rotation',4],['scale',3]]){
  if(value[key]===undefined)continue;
  const v=value[key];
  guard(Array.isArray(v)&&v.length===size&&v.every(n=>numeric(n)&&Math.abs(n)<10000),
   'INVALID_TRANSFORM','Invalid '+key);
  if(key==='scale')guard(v.every(x=>x>0),'INVALID_SCALE',
   'Scale must be positive for editable subset');
  if(key==='rotation')guard(Math.abs(Math.hypot(...v)-1)<1e-3,
   'INVALID_ROTATION','Quaternion must be normalized');
  result[key]=v.slice();
 }
 return result;
}
function normalizePbr(value){
 guard(plain(value)&&Object.keys(value).length>0&&
  Object.keys(value).every(k=>PROP_PBR.includes(k)),
  'INVALID_PBR','Allowed PBR overrides: metallic, roughness, baseColor');
 const result={};
 for(const [key,v] of Object.entries(value)){
  const a=key==='baseColorFactor'?v:[v];
  guard(Array.isArray(a)&&a.length===(key==='baseColorFactor'?4:1)&&
   a.every(x=>numeric(x)&&x>=0&&x<=1),'INVALID_PBR','Out-of-range '+key);
  result[key]=key==='baseColorFactor'?a.slice():v;
 }
 return result;
}
const header=(engine,requestId)=>({requestId,ok:true,sceneId:engine.sceneId,
 revision:engine.revision,appVersion:engine.appVersion,buildHash:engine.buildHash,
 diagnostics:[]});

/**
 * createAiBridge(options)
 * allowWrites is an explicit consent function (browser) or boolean (headless
 * CLI invoked by user). Not an open localhost listener.
 * adapter.openGLB(bytes): replace visible THREE scene with edited GLB
 * adapter.capture({view,timeSeconds}): real WebGL render PNG bytes, metadata
 * adapter.camera(view): set actual Three.js camera, no mock capture.
 */
export function createAiBridge({
 appVersion='0.7.0-alpha.0',buildHash='unverified-local',
 allowWrites=false,adapter={}
}={}){
 const engine={
  appVersion,buildHash,sceneId:null,revision:0,opened:null,assets:new Map(),
  nextAsset:0,transaction:null,nextTransaction:0,
  undo:[],redo:[],audit:[],calls:0
 };
 const canWrite=()=>typeof allowWrites==='function'?Boolean(allowWrites()):allowWrites===true;
 const assertGrant=()=>guard(canWrite(),'WRITE_PERMISSION_DENIED',
  'User grant required for scene mutation and asset upload');
 const assertScene=()=>guard(Boolean(engine.opened),'NO_OPEN_SCENE',
  'Open a native project or GLB asset first');
 const assertIdle=()=>guard(!engine.transaction,'ACTIVE_TRANSACTION',
  'Commit or rollback the active transaction before this operation');
 const selectedEdits=()=>engine.transaction?engine.transaction.edits:engine.opened.edits;
 const manifest=()=>engine.opened.manifest;
 const glbDoc=()=>parseGlb(engine.opened.sourceGLB).json;
 const audit=(method,ok,requestId,code)=>{
  engine.audit.push({seq:++engine.calls,requestId,method,ok,
   revision:engine.revision,...(code?{code}:{})});
  if(engine.audit.length>LIMITS.maxAudit)engine.audit.shift();
 };
 async function materialize(edits){
  const fresh=await repackPreviewMarkscene(engine.opened,edits);
  return openPreviewMarkscene(fresh.archive);
 }
 const makeSceneId=opened=>'scene.'+opened.manifest.projectId;
 const getCaps=()=>({
  schema:BRIDGE_VERSION,profile:'experimental-in-process-commands',
  transport:'in-process (Uint8Array); HTTP/WebSocket NOT implemented',
  appVersion,buildHash,
  maxAssetBytes:LIMITS.maxAssetBytes,limits:copy(LIMITS),
  supported:OP_NAMES.concat(typeof adapter.capture==='function'?['render.capture']:[],
   typeof adapter.camera==='function'?['camera.set']:[]),
  implemented:{
   scene:'single imported GLB or markscene v3-preview',
   object:'existing glTF node TRS only, stable gltf-node-N UUID',
   material:'existing PBR factors only, gltf-material-N stable ID',
   animation:'existing clip selection/time only',
   transactions:'one active transaction, commit/rollback, 32 undo/redo snapshots',
   render:typeof adapter.capture==='function'?'real viewport via renderer adapter':'unsupported',
   camera:typeof adapter.camera==='function'?'provided viewport adapter':'unsupported'
  },
  unsupported:['mesh.create','mesh.edit','rig.setWeights','rig.solveIK',
   'animation.setKeys','texture.assign','uv.unwrap','audio.analyze',
   'scene.new','jobs','network transport','production .markscene v3',
   'multi-scene','independent procedural artist'],
  writePermissionGranted:canWrite(),sceneOpen:Boolean(engine.opened)
 });
 const serializedOpen=async input=>{
  // First sniff bytes, then invoke strict glTF/ZIP format parser.
  const bytes=bytesOf(input);
  const d=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  if(bytes.length>=4&&d.getUint32(0,true)===0x46546c67){
   const project=await createPreviewMarkscene(bytes,{
    projectId:'bridge-import-scene',name:'Imported GLB via AI Bridge',
    license:'source-unknown'});
   return openPreviewMarkscene(project.archive);
  }
  if(bytes.length>=4&&d.getUint32(0,true)===0x04034b50)
   return openPreviewMarkscene(bytes);
  throw BRIDGE_ERR('UNSUPPORTED_ASSET_FORMAT','Only validated .glb and v3-preview .markscene accepted');
 };
 const openVisible=async opened=>{
  if(typeof adapter.openGLB!=='function')return;
  const exported=await exportEditedSourceGlb(opened);
  await adapter.openGLB(exported.glb,{edits:copy(opened.edits),sourceSha256:opened.sourceSha256});
 };
 const commitTo=async (edits,{pushHistory=true}={})=>{
  const next=await materialize(edits);
  // No mutation of committed scene until renderer confirms it can load.
  await openVisible(next);
  if(pushHistory){
   engine.undo.push(copy(engine.opened.edits));
   if(engine.undo.length>LIMITS.maxUndo)engine.undo.shift();
   engine.redo=[];
  }
  engine.opened=next;engine.revision++;
  return {revision:engine.revision,edits:copy(next.edits),
   sourceSha256:next.sourceSha256};
 };
 const mutate=async change=>{
  assertScene();assertGrant();
  if(engine.transaction){
   guard(engine.transaction.commands<LIMITS.maxBatchCommands,
    'TRANSACTION_LIMIT','Transaction max command count exceeded');
   // Invalid commands may not leave partial changes in an atomic group.
   const pending=copy(engine.transaction.edits);
   change(pending);
   engine.transaction.edits=pending;
   engine.transaction.commands++;
   return {staged:true,transactionId:engine.transaction.id,
    commands:engine.transaction.commands};
  }
  const pending=copy(engine.opened.edits);change(pending);
  return commitTo(pending);
 };
 const commands={
  'studio.getVersion':async()=>({schema:BRIDGE_VERSION,appVersion,buildHash}),
  'studio.getCapabilities':async()=>getCaps(),
  'asset.upload':async params=>{
   assertGrant();guard(plain(params),'INVALID_ARGUMENT','asset.upload requires params');
   guard(engine.assets.size<LIMITS.maxAssets,'ASSET_LIMIT','Too many assets');
   guard(['glb','markscene'].includes(params.type),'ASSET_TYPE',
    'Only glb and markscene supported by current profile');
   guard(typeof params.name==='string'&&params.name.length<=LIMITS.maxRequestString,
    'ASSET_NAME','Asset name must be a bounded string');
   const bytes=bytesOf(params.data);
   const isGlb=bytes.length>=4&&new DataView(bytes.buffer).getUint32(0,true)===0x46546c67;
   guard((isGlb&&params.type==='glb')||(!isGlb&&params.type==='markscene'),
    'ASSET_TYPE_MISMATCH','Asset media type conflicts with binary content');
   const imported=await serializedOpen(bytes);
   const sha=await sha256(bytes);
   const assetId='asset.'+(++engine.nextAsset);
   engine.assets.set(assetId,{assetId,name:params.name,type:params.type,
    sha256:sha,byteLength:bytes.length,bytes});
   return {assetId,sha256:sha,byteLength:bytes.length,
    sourceSha256:imported.sourceSha256,kind:params.type};
  },
  'asset.list':async()=>({
   assets:Array.from(engine.assets.values(),({bytes,...metadata})=>({...metadata}))
  }),
  'scene.open':async params=>{
   assertGrant();assertIdle();
   guard(typeof params?.assetId==='string','ASSET_ID','Expected uploaded assetId');
   const asset=engine.assets.get(params.assetId);
   guard(Boolean(asset),'ASSET_NOT_FOUND','Unknown asset ID');
   const next=await serializedOpen(asset.bytes);
   // Repaint the visible scene only once strict validation succeeds.
   await openVisible(next);
   engine.opened=next;engine.sceneId=makeSceneId(next);
   engine.revision++;engine.undo=[];engine.redo=[];
   return {sceneId:engine.sceneId,revision:engine.revision,
    sourceSha256:next.sourceSha256,nodes:manifest().sceneGraph.length,
    clips:manifest().sourceSummary.clips.length,
    skins:manifest().sourceSummary.skinJoints};
  },
  'scene.getHierarchy':async()=>{
   assertScene();
   return {sceneId:engine.sceneId,nodes:copy(manifest().sceneGraph),
    staged:Boolean(engine.transaction)};
  },
  'scene.getMaterials':async()=>{
   assertScene();const doc=glbDoc();
   return {materials:(doc.materials||[]).map((m,i)=>({
    materialId:'gltf-material-'+i,name:m.name||'Material '+i,
    currentPbr:{...(m.pbrMetallicRoughness||{}),
     ...selectedEdits().materialPbr[String(i)]}
   }))};
  },
  'scene.validate':async()=>{
   assertScene();const checked=await materialize(selectedEdits());
   return {format:checked.manifest.schema,sourceSha256:checked.sourceSha256,
    nodes:checked.manifest.sceneGraph.length,
    clips:checked.manifest.sourceSummary.clips.length,
    currentEdits:copy(selectedEdits()),
    sourceUnmodified:true,errors:[],warnings:[
     'Experimental native v3 subset only: no vertex/weight/UV/rig editing'
    ]};
  },
  'scene.save':async()=>{
   assertScene();assertIdle();
   const packed=await repackPreviewMarkscene(engine.opened,engine.opened.edits);
   return {fileName:'MARK-AI-Bridge-'+manifest().projectId+'.markscene',
    data:packed.archive,sha256:packed.archiveSha256,sourceSha256:engine.opened.sourceSha256,
    bytes:packed.archive.length,format:packed.manifest.schema};
  },
  'scene.export':async()=>{
   assertScene();assertIdle();const out=await exportEditedSourceGlb(engine.opened);
   return {fileName:'MARK-AI-Bridge-Edited.glb',data:out.glb,
    sha256:out.sha256,sourceSha256:engine.opened.sourceSha256,
    bytes:out.glb.length,format:'model/gltf-binary',
    notes:['Exported supported TRS/PBR overrides, original BIN preserved']};
  },
  'object.setTransform':async params=>mutate(edits=>{
   const id=stableUuid(params?.uuid,'gltf-node-'),doc=glbDoc();
   guard(id<doc.nodes.length,'OBJECT_NOT_FOUND','Unknown glTF node UUID');
   const fields=normalizeTransform(params?.transform,doc.nodes[id]);
   const key=String(id);
   edits.nodeTransforms[key]={...(edits.nodeTransforms[key]||{}),...fields};
  }),
  'material.setPbr':async params=>mutate(edits=>{
   const id=stableUuid(params?.materialId,'gltf-material-'),doc=glbDoc();
   guard(id<(doc.materials||[]).length,'MATERIAL_NOT_FOUND','Unknown glTF material ID');
   const fields=normalizePbr(params?.pbr),key=String(id);
   edits.materialPbr[key]={...(edits.materialPbr[key]||{}),...fields};
  }),
  'animation.preview':async params=>mutate(edits=>{
   const doc=glbDoc();
   const clip=params?.clipIndex,seconds=params?.timeSeconds;
   guard(Number.isInteger(clip)&&clip>=0&&clip<(doc.animations||[]).length,
    'CLIP_NOT_FOUND','No animation clip at index '+clip);
   guard(numeric(seconds)&&seconds>=0&&seconds<=3600,
    'INVALID_TIMELINE','Time must be within the supported project limits');
   edits.selection={clipIndex:clip,timeSeconds:seconds};
  }),
  'transaction.begin':async()=>{
   assertScene();assertGrant();assertIdle();
   const id='tx-'+(++engine.nextTransaction);
   engine.transaction={id,edits:copy(engine.opened.edits),commands:0};
   return {transactionId:id,baseRevision:engine.revision};
  },
  'transaction.commit':async params=>{
   assertScene();assertGrant();
   const tx=engine.transaction;
   guard(Boolean(tx),'NO_TRANSACTION','No staged transaction');
   guard(params?.transactionId===tx.id,'TRANSACTION_ID','Wrong transaction ID');
   guard(tx.commands>0,'EMPTY_TRANSACTION','No changes to commit');
   const result=await commitTo(tx.edits);
   engine.transaction=null;
   return {...result,transactionId:tx.id,commands:tx.commands};
  },
  'transaction.rollback':async params=>{
   assertScene();assertGrant();
   const tx=engine.transaction;
   guard(Boolean(tx),'NO_TRANSACTION','No staged transaction');
   guard(params?.transactionId===tx.id,'TRANSACTION_ID','Wrong transaction ID');
   engine.transaction=null;
   return {rolledBack:true,transactionId:tx.id,revision:engine.revision};
  },

 };
 // Undo needs the PRE-COMMIT snapshot for redo. Keep it separate from command
 // table construction to avoid duplicating commit/renderer logic.
 commands['history.undo']=async()=>{
  assertScene();assertGrant();assertIdle();
  guard(engine.undo.length>0,'HISTORY_EMPTY','No committed revision to undo');
  const previous=engine.undo.at(-1),old=copy(engine.opened.edits);
  await commitTo(previous,{pushHistory:false});
  engine.undo.pop();engine.redo.push(old);
  return {revision:engine.revision,undoDepth:engine.undo.length,redoDepth:engine.redo.length};
 };
 commands['history.redo']=async()=>{
  assertScene();assertGrant();assertIdle();
  guard(engine.redo.length>0,'HISTORY_EMPTY','No redo revision available');
  const future=engine.redo.at(-1),old=copy(engine.opened.edits);
  await commitTo(future,{pushHistory:false});
  engine.redo.pop();engine.undo.push(old);
  if(engine.undo.length>LIMITS.maxUndo)engine.undo.shift();
  return {revision:engine.revision,undoDepth:engine.undo.length,redoDepth:engine.redo.length};
 };
 if(typeof adapter.camera==='function'){
  commands['camera.set']=async params=>{
   guard(typeof params?.view==='string'&&
    ['front','back','left','right','threequarter','top'].includes(params.view),
    'CAMERA_VIEW','Unknown camera view');
   await adapter.camera(params.view);
   return {view:params.view,backend:'connected real viewport'};
  };
 }
 if(typeof adapter.capture==='function'){
  commands['render.capture']=async params=>{
   assertScene();
   const view=params?.view||'front',timeSeconds=params?.timeSeconds??0;
   guard(['front','back','left','right','threequarter','top'].includes(view),
    'CAMERA_VIEW','Unknown camera view');
   guard(numeric(timeSeconds)&&timeSeconds>=0&&timeSeconds<=3600,
    'CAPTURE_TIME','Time out of range');
   const image=await adapter.capture({view,timeSeconds});
   guard(image&&image.data&&(image.data instanceof ArrayBuffer||
    ArrayBuffer.isView(image.data))&&image.width>0&&image.height>0,
    'CAPTURE_FAILED','Renderer did not return real PNG bytes');
   const bytes=bytesOf(image.data);
   guard(bytes.length>8&&bytes[0]===137&&bytes[1]===80&&bytes[2]===78,
    'CAPTURE_INVALID','Invalid PNG evidence');
   return {data:bytes,sha256:await sha256(bytes),bytes:bytes.length,
    width:image.width,height:image.height,view,timeSeconds,
    renderer:image.renderer||'connected viewport; hardware unverified'};
  };
 }
 const processRequest=async request=>{
  const id=typeof request?.requestId==='string'&&request.requestId.length<=LIMITS.maxRequestString?
   request.requestId:'req-invalid';
  const method=typeof request?.method==='string'?request.method:'';
  try{
   guard(plain(request),'INVALID_REQUEST','Expected request object');
   guard(typeof request.requestId==='string'&&request.requestId.length>0&&
    request.requestId.length<=LIMITS.maxRequestString,'INVALID_REQUEST_ID',
    'Request ID must be a bounded nonempty string');
   guard(OP_NAMES.includes(method)||Object.hasOwn(commands,method),
    'UNSUPPORTED_OPERATION','Operation '+method+' is not implemented');
   guard(Object.hasOwn(commands,method),'UNSUPPORTED_OPERATION',
    'Operation '+method+' has no connected backend');
   const result=await commands[method](request.params||{});
   audit(method,true,id);
   return {...header(engine,id),result};
  }catch(error){
   const code=error?.code||'COMMAND_FAILED';
   audit(method,false,id,code);
   return {...header(engine,id),ok:false,result:null,diagnostics:[{
    code,message:String(error?.message||error),
    category:'bridge',severity:'error'
   }]};
  }
 };
 return {
  request:processRequest,
  getAudit:()=>copy(engine.audit),
  getSnapshot:()=>({
   sceneId:engine.sceneId,revision:engine.revision,
   edits:engine.opened?copy(engine.opened.edits):null,
   stagedEdits:engine.transaction?copy(engine.transaction.edits):null,
   transactionId:engine.transaction?.id||null,
   sourceSha256:engine.opened?.sourceSha256||null,
   undoDepth:engine.undo.length,redoDepth:engine.redo.length
  })
 };
}
