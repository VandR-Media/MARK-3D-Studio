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
import {getMeshEditStats,validateMeshOperation,applyMeshOperations} from './mesh-edit-core.js';
import {createPrimitiveGlb} from './primitive-factory.js';
import {normalizeExplicitSeamLinks,inspectExplicitSeamTopology,
 inspectConsumedSeamExtrude} from './mesh-seam-identity.js';
import {inspectGlbCornerTopology} from './mesh-corner-topology.js';
import {buildMeshDataSnapshot} from './meshdata-halfedge-preview.js';
import {createPreviewMarkscene,openPreviewMarkscene,repackPreviewMarkscene,
 exportEditedSourceGlb,sha256} from './markscene-v3-preview.js';

export const BRIDGE_VERSION='mark.ai-bridge/0.1-preview';
const LIMITS=Object.freeze({maxAssetBytes:64*1024*1024,
 maxTotalAssetBytes:96*1024*1024,maxAssets:8,maxAudit:500,
 maxUndo:32,maxRequestString:256,maxBatchCommands:64});
const OP_NAMES=[
 'studio.getCapabilities','studio.getVersion',
 'asset.upload','asset.list','scene.new','scene.open','scene.getHierarchy',
 'scene.getMaterials','scene.validate','scene.save','scene.export',
 'object.setTransform','material.setPbr','animation.preview',
 'mesh.getStats','mesh.getTopology','mesh.getLinkedRegion','mesh.getMeshData',
 'mesh.linkSeam','mesh.unlinkSeam','mesh.extrudeLinkedRegion',
 'mesh.moveLinkedCap','mesh.pokeLinkedCap',
 'mesh.edit','mesh.create',
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
 const editedDoc=()=>parseGlb(applyMeshOperations(engine.opened.sourceGLB,
  selectedEdits().meshOperations||[])).json;
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
   scene:'new standalone primitive scene / imported GLB / markscene v3-preview',
   object:'existing glTF node TRS only, stable gltf-node-N UUID',
   material:'existing PBR factors only, gltf-material-N stable ID',
   mesh:'indexed triangle editing + read-only halfedge/corner MeshData + bounded stable-cap deformation',
   animation:'existing clip selection/time only',
   transactions:'one active transaction, commit/rollback, 32 undo/redo snapshots',
   render:typeof adapter.capture==='function'?'real viewport via renderer adapter':'unsupported',
   camera:typeof adapter.camera==='function'?'provided viewport adapter':'unsupported'
  },
  unsupported:['mesh.bevel','mesh.boolean','mesh.uvUnwrap',
   'mesh.ngon','mesh.sculpt','rig.setWeights','rig.solveIK',
   'animation.setKeys','texture.assign','uv.unwrap','audio.analyze',
   'jobs','network transport','production .markscene v3',
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
   const occupied=[...engine.assets.values()].reduce((sum,a)=>sum+a.byteLength,0);
   guard(occupied+(params?.data?.byteLength||0)<=LIMITS.maxTotalAssetBytes,
    'TOTAL_ASSET_QUOTA','Aggregate in-process asset budget exceeded (96 MiB)');
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
  'scene.new':async params=>{
   assertGrant();assertIdle();
   guard(plain(params),'SCENE_NEW_ARGS','Expected validated scene parameters');
   guard(Object.keys(params).every(k=>['shape','size','segments','projectId','name'].includes(k)),
    'SCENE_NEW_ARGS','Unsupported scene new parameter');
   const cfg={shape:params.shape||'box',size:params.size??1,
    segments:params.segments??12};
   const generated=createPrimitiveGlb(cfg);
   const packageResult=await createPreviewMarkscene(generated.glb,{
    projectId:params.projectId||'studio-new-primitive',
    name:params.name||'MARK independent native primitive',
    license:'original generated by MARK Studio'
   });
   const next=await openPreviewMarkscene(packageResult.archive);
   await openVisible(next);
   engine.opened=next;engine.sceneId=makeSceneId(next);
   engine.revision++;engine.undo=[];engine.redo=[];
   return {sceneId:engine.sceneId,revision:engine.revision,
    meshId:'gltf-mesh-0',shape:cfg.shape,stats:generated.stats,
    sourceSha256:next.sourceSha256,createdWithoutBlender:true};
  },
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
   const doc=editedDoc(),parents=new Map();
   for(let i=0;i<doc.nodes.length;i++)
    for(const child of doc.nodes[i].children||[])parents.set(child,i);
   const nodes=doc.nodes.map((node,i)=>({
    uuid:'gltf-node-'+i,legacyIndex:i,
    displayName:node.name||'Node '+i,meshId:
     Number.isInteger(node.mesh)?'gltf-mesh-'+node.mesh:null,
    type:node.skin!==undefined?'skinned-mesh':
     node.mesh!==undefined?'mesh':node.camera!==undefined?'camera':'group',
    parentUUID:parents.has(i)?'gltf-node-'+parents.get(i):null
   }));
   return {sceneId:engine.sceneId,nodes,staged:Boolean(engine.transaction)};
  },
  'scene.getMaterials':async()=>{
   assertScene();const doc=editedDoc();
   return {materials:(doc.materials||[]).map((m,i)=>({
    materialId:'gltf-material-'+i,name:m.name||'Material '+i,
    currentPbr:{...(m.pbrMetallicRoughness||{}),
     ...selectedEdits().materialPbr[String(i)]}
   }))};
  },
  'scene.validate':async()=>{
   assertScene();const checked=await materialize(selectedEdits());
   const actual=editedDoc();
   return {format:checked.manifest.schema,sourceSha256:checked.sourceSha256,
    nodes:actual.nodes.length,
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
  'mesh.create':async params=>mutate(edits=>{
   guard(plain(params)&&Object.keys(params).every(k=>
    ['shape','size','segments','materialIndex'].includes(k)),
    'MESH_CREATE_ARGS','Unexpected primitive creation parameters');
   const operation={kind:'primitive.add',meshIndex:0,primitiveIndex:0,
    shape:params.shape||'box',size:params.size??1,
    segments:params.segments??12,materialIndex:params.materialIndex??0};
   const existing=edits.meshOperations||[];
   guard(!existing.some(o=>o.kind==='face.regionExtrudeLinked'),
    'MESH_LINKED_SEQUENCE','Cannot create further mesh after linked extrusion');
   guard(existing.length<32,'MESH_EDIT_LIMIT','Preview max 32 geometry edits');
   if(edits.meshSeamLinks?.length)normalizeExplicitSeamLinks(
    engine.opened.sourceGLB,edits.meshSeamLinks,[...existing,operation]);
   const next=validateMeshOperation(engine.opened.sourceGLB,
    existing,operation);
   edits.meshOperations=next.operations;
  }),
  'mesh.getStats':async params=>{
   assertScene();
   const meshIndex=stableUuid(params?.meshId,'gltf-mesh-');
   const primIndex=params?.primitiveIndex??0;
   const stats=getMeshEditStats(engine.opened.sourceGLB,
    meshIndex,primIndex,selectedEdits().meshOperations||[]);
   return {meshId:params.meshId,topologyRevision:
    (selectedEdits().meshOperations||[]).filter(x=>x.meshIndex===meshIndex).length,
    ...stats,mode:'real binary glTF indexed triangle editing (preview)'};
  },
  'mesh.getTopology':async params=>{
   assertScene();
   const meshIndex=stableUuid(params?.meshId,'gltf-mesh-');
   const primitiveIndex=params?.primitiveIndex??0;
   guard(Number.isSafeInteger(primitiveIndex)&&primitiveIndex>=0,
    'MESH_TARGET','Invalid primitive index');
   const operations=selectedEdits().meshOperations||[];
   // Analyze the same currently edited GLB as mesh.getStats; this query
   // never writes coordinates, UV, skeletons or native edit logs.
   const edited=applyMeshOperations(engine.opened.sourceGLB,operations);
   const topology=inspectGlbCornerTopology(edited,{meshIndex,primitiveIndex});
   const diagnostics=topology.diagnostics;
   return{
    meshId:params.meshId,primitiveIndex,revision:engine.revision,
    topologyRevision:operations.filter(o=>o.meshIndex===meshIndex&&
     o.primitiveIndex===primitiveIndex).length,
    schema:topology.schema,mode:'read-only; candidate position joins are NOT edits',
    ...diagnostics,uvSets:topology.uvSets,
    seamSample:topology.edges.filter(e=>e.uvSeamSets.length)
     .slice(0,16).map(e=>({geometricEdgeId:e.geometricEdgeId,
      uvSeamSets:e.uvSeamSets.slice(),faces:e.incidents.map(i=>i.face)})),
    splitAttributeGroupsSample:topology.geometricVertices
     .filter(g=>g.attributeVertices.length>1).slice(0,16)
     .map(g=>({geometricVertex:g.geometricVertex,
      attributeVertices:g.attributeVertices.slice(0,16)})),
    approvedSeamLinks:(selectedEdits().meshSeamLinks||[])
     .filter(l=>l.meshIndex===meshIndex&&
      l.primitiveIndex===primitiveIndex).length,
    logicalIdentity:(selectedEdits().meshSeamLinks||[])
     .some(l=>l.meshIndex===meshIndex&&l.primitiveIndex===primitiveIndex)?
      inspectExplicitSeamTopology(engine.opened.sourceGLB,{
       meshIndex,primitiveIndex,sourceSha256:engine.opened.sourceSha256,
       links:selectedEdits().meshSeamLinks,operations}):null
   };
  },
  'mesh.getLinkedRegion':async params=>{
   assertScene();
   const meshIndex=stableUuid(params?.meshId,'gltf-mesh-');
   const primitiveIndex=params?.primitiveIndex??0;
   guard(Number.isSafeInteger(primitiveIndex)&&primitiveIndex>=0,
    'MESH_TARGET','Invalid primitive index');
   const consumed=(selectedEdits().meshOperations||[]).find(op=>
    op.kind==='face.regionExtrudeLinked'&&
    op.meshIndex===meshIndex&&op.primitiveIndex===primitiveIndex);
   if(consumed)return inspectConsumedSeamExtrude(engine.opened.sourceGLB,{
    sourceSha256:engine.opened.sourceSha256,operation:consumed});
   return inspectExplicitSeamTopology(engine.opened.sourceGLB,{
    meshIndex,primitiveIndex,sourceSha256:engine.opened.sourceSha256,
    links:selectedEdits().meshSeamLinks||[],
    operations:selectedEdits().meshOperations||[],faces:params?.faces
   });
  },
  'mesh.getMeshData':async params=>{
   assertScene();
   const meshIndex=stableUuid(params?.meshId,'gltf-mesh-');
   const primitiveIndex=params?.primitiveIndex??0;
   guard(Number.isSafeInteger(primitiveIndex)&&primitiveIndex>=0&&
    plain(params)&&Object.keys(params).every(k=>
     ['meshId','primitiveIndex','full'].includes(k)),
    'MESHDATA_TARGET','Expected supported mesh and primitive target');
   const ops=selectedEdits().meshOperations||[];
   const geometry=applyMeshOperations(engine.opened.sourceGLB,ops);
   const result=buildMeshDataSnapshot({
    sourceGLB:engine.opened.sourceGLB,editedGLB:geometry,
    sourceSha256:engine.opened.sourceSha256,meshIndex,primitiveIndex,
    operations:ops
   });
   const full=params.full===true;
   guard(!full||result.faces.length<=512,'MESHDATA_FULL_LIMIT',
    'Full halfedge snapshot limited to 512 triangles');
   return{
    schema:result.schema,meshId:params.meshId,primitiveIndex,
    revision:engine.revision,sourceSha256:result.sourceSha256,
    profile:result.profile,diagnostics:result.diagnostics,
    uvSets:result.uvSets,colorSets:result.colorSets,
    materialSlots:result.materialSlots,stableIdScope:result.stableIdScope,
    persistedAs:result.persistedAs,topologyRemap:result.topologyRemap,
    topologyRemaps:result.topologyRemaps,
    ...(full?{faces:result.faces,edges:result.edges,
     halfedges:result.halfedges,corners:result.corners,
     capMap:result.capMap,mappedWalls:result.mappedWalls}:{
     faceSample:result.faces.slice(0,8),
     edgeSample:result.edges.slice(0,12),
     cornerSample:result.corners.slice(0,12).map(c=>({
      id:c.id,attributeVertex:c.attributeVertex,
      logicalVertexId:c.logicalVertexId,
      uvSets:c.attributes.uvSets
     })),capMap:result.capMap.slice(0,16)})
   };
  },
  'mesh.linkSeam':async params=>mutate(edits=>{
   const meshIndex=stableUuid(params?.meshId,'gltf-mesh-');
   const primitiveIndex=params?.primitiveIndex??0;
   guard(Number.isSafeInteger(primitiveIndex)&&primitiveIndex>=0,
    'MESH_TARGET','Invalid primitive index');
   guard(plain(params)&&Object.keys(params).every(k=>
    ['meshId','primitiveIndex','vertexA','vertexB'].includes(k)),
    'MESH_LINK_FIELDS','Unexpected seam linking arguments');
   edits.meshSeamLinks=normalizeExplicitSeamLinks(
    engine.opened.sourceGLB,[...(edits.meshSeamLinks||[]),{
     meshIndex,primitiveIndex,vertexA:params.vertexA,vertexB:params.vertexB
    }],edits.meshOperations||[]);
  }),
  'mesh.unlinkSeam':async params=>mutate(edits=>{
   const meshIndex=stableUuid(params?.meshId,'gltf-mesh-');
   const primitiveIndex=params?.primitiveIndex??0;
   guard(Number.isSafeInteger(primitiveIndex)&&primitiveIndex>=0&&
    Number.isSafeInteger(params?.vertexA)&&Number.isSafeInteger(params?.vertexB)&&
    params.vertexA>=0&&params.vertexB>=0,
    'MESH_LINK_FIELDS','Invalid seam unlink endpoints');
   guard(plain(params)&&Object.keys(params).every(k=>
    ['meshId','primitiveIndex','vertexA','vertexB'].includes(k)),
    'MESH_LINK_FIELDS','Unexpected seam unlink arguments');
   const vertexA=Math.min(params.vertexA,params.vertexB),
    vertexB=Math.max(params.vertexA,params.vertexB);
   const before=edits.meshSeamLinks||[];
   const after=before.filter(l=>!(l.meshIndex===meshIndex&&
    l.primitiveIndex===primitiveIndex&&l.vertexA===vertexA&&l.vertexB===vertexB));
   guard(after.length<before.length,'MESH_LINK_NOT_FOUND','No such source seam link');
   edits.meshSeamLinks=normalizeExplicitSeamLinks(
    engine.opened.sourceGLB,after,edits.meshOperations||[]);
  }),
  'mesh.extrudeLinkedRegion':async params=>mutate(edits=>{
   const meshIndex=stableUuid(params?.meshId,'gltf-mesh-');
   const primitiveIndex=params?.primitiveIndex??0;
   guard(Number.isSafeInteger(primitiveIndex)&&primitiveIndex>=0&&
    plain(params)&&Object.keys(params).every(k=>[
     'meshId','primitiveIndex','faces','distance'].includes(k)),
    'MESH_LINKED_FIELDS','Unexpected linked extrusion arguments');
   // Hard limit one edit to preserve deterministic source->cap identity.
   guard((edits.meshOperations||[]).length===0,
    'MESH_LINKED_SEQUENCE','Linked extrusion requires unedited source');
   const current=edits.meshSeamLinks||[];
   const matching=current.filter(l=>l.meshIndex===meshIndex&&
    l.primitiveIndex===primitiveIndex);
   guard(matching.length>=2&&matching.length===current.length,
    'MESH_LINKED_APPROVAL',
    'Approve at least 2 seam pairs on this primitive; no other pending links');
   const canonical=normalizeExplicitSeamLinks(
    engine.opened.sourceGLB,matching,[]);
   const op={kind:'face.regionExtrudeLinked',meshIndex,primitiveIndex,
    faces:params.faces,distance:params.distance,links:canonical};
   // The same physical GLB binary kernel is used for validation and replay.
   const output=validateMeshOperation(engine.opened.sourceGLB,[],op);
   edits.meshOperations=output.operations;
   // After this one-shot action, original IDs are no longer current.
   // The provenance stays in op.links and source->cap remap is queryable.
   edits.meshSeamLinks=[];
  }),
  'mesh.moveLinkedCap':async params=>mutate(edits=>{
   const meshIndex=stableUuid(params?.meshId,'gltf-mesh-');
   const primitiveIndex=params?.primitiveIndex??0;
   guard(plain(params)&&Object.keys(params).length>=3&&
    Object.keys(params).length<=4&&
    ['meshId','capStableId','delta'].every(k=>Object.hasOwn(params,k))&&
    Object.keys(params).every(k=>[
     'meshId','primitiveIndex','capStableId','delta'].includes(k))&&
    Number.isSafeInteger(primitiveIndex)&&primitiveIndex>=0&&
    typeof params.capStableId==='string'&&
    params.capStableId.length<=256&&
    Array.isArray(params.delta)&&params.delta.length===3&&
    params.delta.every(n=>numeric(n)&&Math.abs(n)<=2)&&
    Math.hypot(...params.delta)>1e-8,
    'CAP_MOVE_ARGS','Expected exact stable ID and bounded displacement');
   const existing=edits.meshOperations||[],first=existing[0];
   guard(first?.kind==='face.regionExtrudeLinked'&&
    first.meshIndex===meshIndex&&first.primitiveIndex===primitiveIndex&&
    existing.length<=16&&existing.slice(1).every(x=>
     x.kind==='vertex.moveLinkedCap'),
    'CAP_MOVE_SEQUENCE',
    'Only 16 stable logical-cap moves after one linked extrusion');
   const consumed=inspectConsumedSeamExtrude(engine.opened.sourceGLB,{
    sourceSha256:engine.opened.sourceSha256,operation:first});
   const matched=consumed.capRemap.find(c=>
    c.capStableId===params.capStableId);
   guard(matched,'CAP_STABLE_ID','Unknown or stale cap identity');
   let sourceRoot=matched.sourceVertex;
   // A confirmed pair is one movable logical corner. The lower source ID
   // is the stable canonical root for all copies across the seam.
   for(const pair of first.links)
    if(pair.vertexA===sourceRoot||pair.vertexB===sourceRoot)
     sourceRoot=Math.min(pair.vertexA,pair.vertexB);
   const op={kind:'vertex.moveLinkedCap',meshIndex,primitiveIndex,
    sourceVertex:sourceRoot,delta:params.delta.slice()};
   const next=validateMeshOperation(engine.opened.sourceGLB,existing,op);
   edits.meshOperations=next.operations;
  }),
  'mesh.pokeLinkedCap':async params=>mutate(edits=>{
   const meshIndex=stableUuid(params?.meshId,'gltf-mesh-'),
    primitiveIndex=params?.primitiveIndex??0;
   guard(plain(params)&&Object.keys(params).every(k=>
    ['meshId','primitiveIndex','capFaceId'].includes(k))&&
    ['meshId','capFaceId'].every(k=>Object.hasOwn(params,k))&&
    Number.isSafeInteger(primitiveIndex)&&primitiveIndex>=0&&
    typeof params.capFaceId==='string'&&
    params.capFaceId.length<=256,'POKE_ARGS',
    'Expected exact source-bound stable cap face ID');
   const existing=edits.meshOperations||[],first=existing[0];
   const afterExtrude=existing.slice(1),
    firstPoke=afterExtrude.findIndex(op=>op.kind==='face.pokeLinkedCap'),
    earlierPokes=afterExtrude.filter(op=>op.kind==='face.pokeLinkedCap');
   guard(first?.kind==='face.regionExtrudeLinked'&&
    first.meshIndex===meshIndex&&first.primitiveIndex===primitiveIndex&&
    existing.length<25&&earlierPokes.length<8&&
    afterExtrude.every((op,i)=>
     (op.kind==='vertex.moveLinkedCap'&&
      (firstPoke<0||i<firstPoke))||
     (op.kind==='face.pokeLinkedCap'&&i>=firstPoke)),
    'POKE_SEQUENCE',
    'Up to eight distinct cap face Pokes after stable-cap moves');
   const geometry=applyMeshOperations(engine.opened.sourceGLB,existing);
   const data=buildMeshDataSnapshot({
    sourceGLB:engine.opened.sourceGLB,editedGLB:geometry,
    sourceSha256:engine.opened.sourceSha256,
    meshIndex,primitiveIndex,operations:existing
   });
   const cap=data.faces.find(face=>face.id===params.capFaceId&&
    /^mark-face-.*-cap-face-[0-9]+$/.test(face.id));
   guard(cap,'POKE_STABLE_FACE',
    'Cap stable face ID missing or no longer supports Poke');
   const suffix=cap.id.split('-cap-face-')[1];
   guard(/^(0|[1-9][0-9]*)$/.test(suffix),
    'POKE_STABLE_FACE','Invalid source provenance for cap face');
   const sourceFace=Number(suffix);
   guard(first.faces.includes(sourceFace),
    'POKE_STABLE_FACE','Face was not part of approved source region');
   guard(!earlierPokes.some(op=>op.sourceFace===sourceFace),
    'POKE_ALREADY_SPLIT','Source cap face already poked; use another face');
   const op={kind:'face.pokeLinkedCap',meshIndex,primitiveIndex,sourceFace};
   const next=validateMeshOperation(engine.opened.sourceGLB,existing,op);
   edits.meshOperations=next.operations;
  }),
  'mesh.edit':async params=>mutate(edits=>{
   guard(params&&typeof params.meshId==='string',
    'MESH_TARGET','Mesh ID is required');
   const meshIndex=stableUuid(params.meshId,'gltf-mesh-');
   const primIndex=params.primitiveIndex??0;
   guard(Number.isInteger(primIndex)&&primIndex>=0,
    'MESH_TARGET','Primitive index must be nonnegative');
   guard(plain(params.operation),'MESH_OPERATION','Expected typed operation');
   const operation={...copy(params.operation),meshIndex,
    primitiveIndex:primIndex};
   const existing=edits.meshOperations||[];
   guard(!existing.some(o=>o.kind==='face.regionExtrudeLinked'),
    'MESH_LINKED_SEQUENCE','No subsequent edit without safe identity remap');
   guard(params.operation.kind!=='face.regionExtrudeLinked',
    'MESH_LINKED_APPROVAL',
    'Use mesh.extrudeLinkedRegion after explicitly approving seam links');
   guard(existing.length<32,'MESH_EDIT_LIMIT',
    'Preview native project supports up to 32 geometry edits');
   // Validation applies the real glTF BIN kernel to a temporary copy,
   // not a fake metadata transform; failure cannot poison transaction.
   if(edits.meshSeamLinks?.length)normalizeExplicitSeamLinks(
    engine.opened.sourceGLB,edits.meshSeamLinks,[...existing,operation]);
   const next=validateMeshOperation(engine.opened.sourceGLB,existing,operation);
   edits.meshOperations=next.operations;
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
