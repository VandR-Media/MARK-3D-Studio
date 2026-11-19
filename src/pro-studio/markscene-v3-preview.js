/**
 * MARK Professional Studio, experimental V3 SUBSET: an editable native
 * ZIP/STORE project with original animated GLB bytes and reversible typed edits.
 *
 * It is intentionally NOT Blender-style mesh/skin/UV authoring. It saves
 * separate object transform and PBR edits; GLB buffer/animation/rig stay intact.
 * Pure browser/Node JS; no arbitrary code execution or external downloads.
 */
import {parseGlb,writeGlb,assertSelfContainedGlb} from '../glb.js';
import {applyMeshOperations} from './mesh-edit-core.js';

const E=new TextEncoder(),D=new TextDecoder('utf-8',{fatal:true});
const FILES=['manifest.json','assets/source.glb'];
const MAG={local:0x04034b50,central:0x02014b50,end:0x06054b50};
const MAX_SOURCE=64*1024*1024,MAX_META=256*1024,MAX_ARCHIVE=MAX_SOURCE+MAX_META+4096;
const ID=/^[a-z][a-z0-9_.-]{1,79}$/;
const FMT='mark.professional-scene/3-preview',STATUS='EXPERIMENTAL_EDITABLE_SUBSET';
const isUInt=x=>Number.isInteger(x)&&x>=0;
const good=(yes,code,message)=>{
 if(!yes){const error=Error('MARK_SCENE3_'+code+': '+message);error.code=code;throw error;}
};
const bytesOf=x=>{
 good(x instanceof ArrayBuffer||ArrayBuffer.isView(x),'BYTES','input must be binary');
 // Normalize Node Buffer to an ordinary Uint8Array VIEW. Buffer.slice()
 // returns a shared-view, not a copy, so digest(x.slice().buffer) on a
 // Buffer can silently hash unrelated pooled bytes outside its byteOffset.
 if(ArrayBuffer.isView(x))return new Uint8Array(x.buffer,x.byteOffset,x.byteLength);
 return new Uint8Array(x);
};
const bytesHex=bytes=>Array.from(bytes,x=>x.toString(16).padStart(2,'0')).join('');
export async function sha256(bytes){
 const b=bytesOf(bytes);
 good(Boolean(globalThis.crypto?.subtle),'HASH_UNAVAILABLE','SHA-256 WebCrypto required');
 return bytesHex(new Uint8Array(await crypto.subtle.digest('SHA-256',b.slice().buffer)));
}
const table=Uint32Array.from({length:256},(_,i)=>{
 let a=i;for(let j=0;j<8;j++)a=(a&1)?0xedb88320^(a>>>1):a>>>1;
 return a>>>0;
});
function crc32(bytes){let c=0xffffffff;for(const b of bytes)c=table[(c^b)&255]^(c>>>8);return (c^0xffffffff)>>>0;}
function createArchive(entries){
 good(entries.length===2&&entries.map(x=>x[0]).join('|')===FILES.join('|'),
  'ARCHIVE_FILES','only strict manifest+binary GLB are supported');
 const info=entries.map(([name,value],i)=>{
  const data=bytesOf(value),key=E.encode(name);
  good(data.length<=(i===0?MAX_META:MAX_SOURCE),'ARCHIVE_BUDGET','oversized project resource '+name);
  return{data,key,crc:crc32(data)};
 });
 const len=22+info.reduce((s,f)=>s+30+f.key.length+f.data.length+46+f.key.length,0);
 good(len<=MAX_ARCHIVE,'ARCHIVE_BUDGET','project exceeds file budget');
 const out=new Uint8Array(len),v=new DataView(out.buffer),offsets=[];
 let offset=0;
 for(const f of info){
  offsets.push(offset);v.setUint32(offset,MAG.local,true);
  v.setUint16(offset+4,20,true);
  v.setUint32(offset+14,f.crc,true);
  v.setUint32(offset+18,f.data.length,true);v.setUint32(offset+22,f.data.length,true);
  v.setUint16(offset+26,f.key.length,true);
  out.set(f.key,offset+30);out.set(f.data,offset+30+f.key.length);
  offset+=30+f.key.length+f.data.length;
 }
 const centralStart=offset;
 for(let i=0;i<info.length;i++){
  const f=info[i];v.setUint32(offset,MAG.central,true);
  v.setUint16(offset+4,20,true);v.setUint16(offset+6,20,true);
  v.setUint32(offset+16,f.crc,true);v.setUint32(offset+20,f.data.length,true);
  v.setUint32(offset+24,f.data.length,true);v.setUint16(offset+28,f.key.length,true);
  v.setUint32(offset+42,offsets[i],true);out.set(f.key,offset+46);
  offset+=46+f.key.length;
 }
 v.setUint32(offset,MAG.end,true);v.setUint16(offset+8,2,true);
 v.setUint16(offset+10,2,true);v.setUint32(offset+12,offset-centralStart,true);
 v.setUint32(offset+16,centralStart,true);
 good(offset+22===len,'ARCHIVE_INTERNAL','ZIP writer length mismatch');
 return out;
}
function readArchive(input){
 const data=bytesOf(input);
 good(data.length>=22&&data.length<=MAX_ARCHIVE,'ARCHIVE_BUDGET','ZIP size invalid');
 const v=new DataView(data.buffer,data.byteOffset,data.byteLength),end=data.length-22;
 good(v.getUint32(end,true)===MAG.end,'ZIP_END','missing terminal ZIP directory');
 const count=v.getUint16(end+10,true),central=v.getUint32(end+16,true),size=v.getUint32(end+12,true);
 good(count===2&&v.getUint16(end+8,true)===2&&central+size===end,'ZIP_DIRECTORY','invalid ZIP directory');
 const found=new Map();let pos=central;const occupied=[];
 for(let i=0;i<count;i++){
  good(pos+46<=end&&v.getUint32(pos,true)===MAG.central,'ZIP_CENTRAL','invalid central header');
  const flag=v.getUint16(pos+8,true),method=v.getUint16(pos+10,true),
   crc=v.getUint32(pos+16,true),packed=v.getUint32(pos+20,true),length=v.getUint32(pos+24,true),
   nameSize=v.getUint16(pos+28,true),extra=v.getUint16(pos+30,true),
   comment=v.getUint16(pos+32,true),local=v.getUint32(pos+42,true);
  good(flag===0&&method===0&&packed===length&&nameSize>0&&extra===0&&comment===0&&
   pos+46+nameSize<=end,'ZIP_ENTRY','unexpected ZIP compression or extra field');
  const name=D.decode(data.subarray(pos+46,pos+46+nameSize));
  good(FILES.includes(name)&&!found.has(name),'ZIP_NAME','duplicate or unsafe archive path');
  good(length<=(name===FILES[0]?MAX_META:MAX_SOURCE),'ZIP_BUDGET','expanded file too large');
  good(local+30<=central&&v.getUint32(local,true)===MAG.local,'ZIP_LOCAL','bad local header');
  const localNameLen=v.getUint16(local+26,true),localExtra=v.getUint16(local+28,true);
  const start=local+30+localNameLen+localExtra;
  good(v.getUint16(local+6,true)===0&&v.getUint16(local+8,true)===0&&
   v.getUint32(local+14,true)===crc&&v.getUint32(local+18,true)===packed&&
   v.getUint32(local+22,true)===length&&localExtra===0&&
   start+length<=central&&
   D.decode(data.subarray(local+30,local+30+localNameLen))===name,
   'ZIP_LOCAL','conflicting central/local entry');
  occupied.push([local,start+length]);
  const copy=data.slice(start,start+length);
  good(crc32(copy)===crc,'ZIP_CRC','bad resource CRC '+name);
  found.set(name,copy);pos+=46+nameSize;
 }
 occupied.sort((a,b)=>a[0]-b[0]);
 good(pos===end&&found.size===2&&occupied[0][0]===0&&
  occupied[0][1]===occupied[1][0]&&occupied[1][1]===central,
  'ZIP_LAYOUT','extra bytes or overlap inside archive');
 return found;
}
function gltf(bytes){
 const parsed=parseGlb(bytes);
 assertSelfContainedGlb(parsed.json);
 good(parsed.json.nodes?.length>0&&parsed.json.meshes?.length>0,
  'GLTF_GRAPH','GLB has no nodes or meshes');
 good((parsed.json.extensionsRequired||[]).length===0,
  'GLTF_EXTENSION','unknown required glTF extensions are not accepted by this subset');
 return parsed;
}
const clone=x=>structuredClone(x),keyed=x=>x&&typeof x==='object'&&!Array.isArray(x);
function normalizeEdits(edits,doc,sourceGLB){
 good(keyed(edits),'EDITS','expected structured edits');
 const out={nodeTransforms:{},materialPbr:{},selection:{clipIndex:0,timeSeconds:0}};
 for(const [k,value] of Object.entries(edits.nodeTransforms||{})){
  const id=Number(k);
  good(String(id)===k&&isUInt(id)&&id<doc.nodes.length&&keyed(value),
   'EDIT_NODE','invalid glTF node index');
  good(!Object.hasOwn(doc.nodes[id],'matrix'),'EDIT_MATRIX','node uses a matrix; TRS edit blocked');
  const safe={};
  for(const [field,n] of [['translation',3],['rotation',4],['scale',3]]){
   if(value[field]===undefined)continue;
   const a=value[field];
   good(Array.isArray(a)&&a.length===n&&a.every(x=>typeof x==='number'&&Number.isFinite(x)&&Math.abs(x)<10000),
    'EDIT_TRS','invalid '+field);
   if(field==='scale')good(a.every(x=>x>0),'EDIT_SCALE','scale must be positive');
   if(field==='rotation'){
    const norm=Math.hypot(...a);
    good(Math.abs(norm-1)<.001,'EDIT_QUAT','quaternion must be normalized');
   }
   safe[field]=a.slice();
  }
  good(Object.keys(safe).length>0&&Object.keys(value).every(x=>Object.hasOwn(safe,x)),
   'EDIT_FIELDS','unsupported transform field');
  out.nodeTransforms[k]=safe;
 }
 for(const [k,value] of Object.entries(edits.materialPbr||{})){
  const id=Number(k);
  good(String(id)===k&&isUInt(id)&&id<(doc.materials||[]).length&&keyed(value),
   'EDIT_MATERIAL','invalid material index');
  const allowed=['metallicFactor','roughnessFactor','baseColorFactor'];
  good(Object.keys(value).length>0&&Object.keys(value).every(x=>allowed.includes(x)),
   'EDIT_MATERIAL','unsupported PBR parameter');
  const safe={};
  for(const f of allowed){
   if(value[f]===undefined)continue;
   const val=value[f],arr=f==='baseColorFactor'?val:[val];
   good(Array.isArray(arr)&&arr.length===(f==='baseColorFactor'?4:1)&&
    arr.every(x=>typeof x==='number'&&Number.isFinite(x)&&x>=0&&x<=1),
    'EDIT_PBR','invalid PBR '+f);
   safe[f]=f==='baseColorFactor'?arr.slice():val;
  }
  out.materialPbr[k]=safe;
 }
 const selection=edits.selection||{};
 const clip=selection.clipIndex??0,time=selection.timeSeconds??0;
 good(isUInt(clip)&&clip<(doc.animations?.length||1)&&
  typeof time==='number'&&Number.isFinite(time)&&time>=0&&time<=3600,
  'EDIT_CLIP','invalid clip/time selection');
 out.selection={clipIndex:clip,timeSeconds:time};
 if(edits.meshOperations!==undefined){
  good(Array.isArray(edits.meshOperations)&&edits.meshOperations.length<=32,
   'MESH_EDIT_COUNT','up to 32 geometry operations per native preview project');
  const canonical=[];
  for(const input of edits.meshOperations){
   good(keyed(input),'MESH_EDIT','operation must be typed object');
   const kind=input.kind;
   good(['vertex.move','edge.split','face.flip','face.delete',
    'normal.recalculate','primitive.add','vertex.snap','face.extrude',
    'face.regionExtrude'].includes(kind),
    'MESH_EDIT_TYPE','Unsupported geometry operation');
   const allowed=kind==='vertex.move'?['kind','meshIndex','primitiveIndex','vertex','delta']:
    kind==='vertex.snap'?['kind','meshIndex','primitiveIndex','vertex','targetVertex']:
    kind==='face.extrude'?['kind','meshIndex','primitiveIndex','face','distance']:
    kind==='face.regionExtrude'?['kind','meshIndex','primitiveIndex','faces','distance']:
    kind==='edge.split'?['kind','meshIndex','primitiveIndex','start','end','factor']:
    kind==='normal.recalculate'?['kind','meshIndex','primitiveIndex']:
    kind==='primitive.add'?['kind','meshIndex','primitiveIndex','shape',
      'size','segments','materialIndex']:
    ['kind','meshIndex','primitiveIndex','face'];
   good(Object.keys(input).every(k=>allowed.includes(k))&&
    Number.isInteger(input.meshIndex)&&input.meshIndex>=0&&
    Number.isInteger(input.primitiveIndex)&&input.primitiveIndex>=0,
    'MESH_EDIT_FIELDS','Unexpected fields or invalid mesh/primitive indices');
   const op={kind,meshIndex:input.meshIndex,primitiveIndex:input.primitiveIndex};
   if(kind==='vertex.move'){
    good(Number.isInteger(input.vertex)&&input.vertex>=0&&
     Array.isArray(input.delta)&&input.delta.length===3&&
     input.delta.every(x=>Number.isFinite(x)&&Math.abs(x)<10000),
     'MESH_MOVE','Invalid vertex/delta');
    op.vertex=input.vertex;op.delta=input.delta.slice();
   }else if(kind==='vertex.snap'){
    good(Number.isInteger(input.vertex)&&input.vertex>=0&&
     Number.isInteger(input.targetVertex)&&input.targetVertex>=0&&
     input.vertex!==input.targetVertex,
     'MESH_SNAP','Expected distinct valid vertex indices');
    op.vertex=input.vertex;op.targetVertex=input.targetVertex;
   }else if(kind==='face.regionExtrude'){
    good(Array.isArray(input.faces)&&input.faces.length>=1&&
     input.faces.length<=128&&input.faces.every(isUInt)&&
     new Set(input.faces).size===input.faces.length&&
     typeof input.distance==='number'&&Number.isFinite(input.distance)&&
     input.distance>=.001&&input.distance<=50,
     'MESH_REGION_EXTRUDE','Invalid region face list or distance');
    op.faces=[...input.faces].sort((a,b)=>a-b);
    op.distance=input.distance;
   }else if(kind==='face.extrude'){
    good(Number.isInteger(input.face)&&input.face>=0&&
     typeof input.distance==='number'&&Number.isFinite(input.distance)&&
     input.distance>=.001&&input.distance<=50,
     'MESH_EXTRUDE','Invalid face extrusion distance/index');
    op.face=input.face;op.distance=input.distance;
   }else if(kind==='edge.split'){
    good(Number.isInteger(input.start)&&input.start>=0&&
     Number.isInteger(input.end)&&input.end>=0&&
     Number.isFinite(input.factor??.5)&&
     (input.factor??.5)>0&&(input.factor??.5)<1,
     'MESH_SPLIT','Invalid edge or interpolation');
    op.start=input.start;op.end=input.end;
    op.factor=input.factor??.5;
   }else if(kind==='normal.recalculate'){
    // No optional fields: source-specific face winding defines the normals.
   }else if(kind==='primitive.add'){
    good(['plane','grid','box','uv-sphere','cylinder'].includes(input.shape)&&
     typeof input.size==='number'&&Number.isFinite(input.size)&&
     input.size>=.01&&input.size<=50&&
     Number.isInteger(input.segments)&&input.segments>=3&&input.segments<=48,
     'PRIMITIVE_FIELDS','Unsupported shape/size/segments');
    const materialIndex=input.materialIndex??0;
    good(Number.isInteger(materialIndex)&&materialIndex>=0,
     'PRIMITIVE_MATERIAL','Invalid material index');
    Object.assign(op,{shape:input.shape,size:input.size,
     segments:input.segments,materialIndex});
   }else{
    good(Number.isInteger(input.face)&&input.face>=0,
     'MESH_FACE','Invalid face index');
    op.face=input.face;
   }
   canonical.push(op);
  }
  if(sourceGLB&&canonical.length){
   // The exact same binary topology kernel validates each persisted command.
   // No malformed manifest can smuggle a geometry edit into export later.
   try{applyMeshOperations(sourceGLB,canonical);}
   catch(error){good(false,'MESH_KERNEL',String(error?.message||error));}
  }
  out.meshOperations=canonical;
 }
 return out;
}
function summary(doc){return{
 nodeCount:doc.nodes.length,skinJoints:(doc.skins||[]).map(x=>x.joints.length),
 morphCounts:(doc.meshes||[]).flatMap(m=>(m.primitives||[]).map(p=>(p.targets||[]).length)),
 clips:(doc.animations||[]).map(a=>({name:a.name||'',channels:a.channels.length})),
 materials:(doc.materials||[]).length,images:(doc.images||[]).length
};}
function graph(doc){
 const parents=new Map();
 for(let i=0;i<doc.nodes.length;i++)
  for(const c of doc.nodes[i].children||[]){
   good(isUInt(c)&&c<doc.nodes.length&&!parents.has(c),'GRAPH_PARENT','invalid or multiple parents');
   parents.set(c,i);
  }
 return doc.nodes.map((node,i)=>({
  uuid:'gltf-node-'+i,legacyIndex:i,
  displayName:node.name||'Node '+i,
  type:node.skin!==undefined?'skinned-mesh':node.mesh!==undefined?'mesh':node.camera!==undefined?'camera':'group',
  parentUUID:parents.has(i)?'gltf-node-'+parents.get(i):null
 }));
}
function validateManifest(m,source,doc){
 good(m?.schema===FMT&&m.formatStatus===STATUS&&m.schemaVersion===3,
  'MANIFEST_SCHEMA','not experimental MARK v3 subset');
 good(ID.test(m.projectId)&&Array.isArray(m.assetManifest)&&m.assetManifest.length===1&&
  m.assetManifest[0].uri===FILES[1]&&m.assetManifest[0].kind==='source'&&
  m.assetManifest[0].sha256===m.checksums?.[FILES[1]]&&
  m.assetManifest[0].byteLength===source.length,'MANIFEST_ASSET','invalid asset manifest');
 good(Array.isArray(m.sceneGraph)&&m.sceneGraph.length===doc.nodes.length&&
  JSON.stringify(m.sceneGraph)===JSON.stringify(graph(doc)),
  'MANIFEST_GRAPH','source GLB hierarchy and node IDs mismatch');
 good(JSON.stringify(m.sourceSummary)===JSON.stringify(summary(doc)),
  'MANIFEST_SEMANTICS','source skeleton/morph/clip inventory changed');
 good(Array.isArray(m.collections)&&Array.isArray(m.dependencies)&&
  Array.isArray(m.audioBindings)&&m.upAxis==='Y'&&m.units==='meters'&&
  m.fps>0&&m.fps<=240&&keyed(m.colorManagement),
  'MANIFEST_FIELDS','missing required native project fields');
 return normalizeEdits(m.edits,doc,source);
}
export async function createPreviewMarkscene(input,{
 projectId='experimental-rig-project',name='MARK rigged scene',license='unknown',
 edits={},extra={}
}={}){
 const bytes=bytesOf(input).slice(),doc=gltf(bytes).json;
 good(bytes.length<=MAX_SOURCE,'GLB_BUDGET','source too large');
 good(ID.test(projectId)&&typeof name==='string'&&name.length<=160&&
  typeof license==='string'&&license.length<=160&&keyed(extra),
  'PROJECT_META','invalid project identification');
 const hash=await sha256(bytes),normalized=normalizeEdits(edits,doc,bytes);
 const manifest={
  schema:FMT,formatStatus:STATUS,schemaVersion:3,
  appVersion:'0.7.0-alpha.0+rig-preview',minReaderVersion:'3-preview',
  projectId,name,units:'meters',upAxis:'Y',fps:30,
  colorManagement:{workingSpace:'linear-srgb',displaySpace:'srgb'},
  assetManifest:[{uuid:'asset-gltf-source',kind:'source',uri:FILES[1],sha256:hash,
   byteLength:bytes.length,license}],
  sceneGraph:graph(doc),collections:[{uuid:'collection-main',name:'Imported GLB',
   nodeUUIDs:doc.nodes.map((_,i)=>'gltf-node-'+i)}],
  dependencies:[],audioBindings:[],checksums:{[FILES[1]]:hash},
  sourceSummary:summary(doc),edits:normalized,
  authoringFeatures:['node TRS override','material metallic/roughness/baseColor override',
   'clip view state','bounded indexed-triangle edits, vertex snap, triangle extrusion, normal recalculation and primitive.add'],
  unimplemented:['full mesh Edit Mode','N-gons/holes','arbitrary sculpt','weight paint',
   'rig editing','IK','UV unwrapping','native v2 scene migration','crash recovery',
   'audio graph authoring'],
  extensions:clone(extra)
 };
 const encoded=E.encode(JSON.stringify(manifest,null,2)+'\n');
 good(encoded.length<=MAX_META,'MANIFEST_BUDGET','scene manifest too large');
 const archive=createArchive([[FILES[0],encoded],[FILES[1],bytes]]);
 return {archive,manifest,archiveSha256:await sha256(archive)};
}
export async function openPreviewMarkscene(input){
 const archive=bytesOf(input),files=readArchive(archive),source=files.get(FILES[1]);
 let manifest;
 try{manifest=JSON.parse(D.decode(files.get(FILES[0])));}
 catch(err){good(false,'MANIFEST_JSON',String(err));}
 const doc=gltf(source).json;
 const edits=validateManifest(manifest,source,doc);
 good(manifest.assetManifest[0].sha256===await sha256(source),
  'ASSET_SHA','stored source hash mismatch');
 good(JSON.stringify(edits)===JSON.stringify(manifest.edits),
  'EDITS_CANONICAL','non-canonical edit data');
 return {manifest:clone(manifest),sourceGLB:source,edits,
  archiveSha256:await sha256(archive),sourceSha256:await sha256(source)};
}
export async function repackPreviewMarkscene(opened,edits){
 good(keyed(opened?.manifest),'REPACK_INPUT','open project first');
 const original=opened.manifest;
 const generated=await createPreviewMarkscene(opened.sourceGLB,{
  projectId:original.projectId,name:original.name,
  license:original.assetManifest[0].license,edits,
  extra:original.extensions
 });
 // Preserve unknown optional, forward-compatible fields. Never overwrite
 // the computed required fields / checksums with untrusted archive content.
 for(const [key,value] of Object.entries(original))
  if(!Object.hasOwn(generated.manifest,key))generated.manifest[key]=clone(value);
 const manifestBytes=E.encode(JSON.stringify(generated.manifest,null,2)+'\n');
 good(manifestBytes.length<=MAX_META,'MANIFEST_BUDGET','edited manifest exceeds budget');
 generated.archive=createArchive([[FILES[0],manifestBytes],[FILES[1],opened.sourceGLB]]);
 generated.archiveSha256=await sha256(generated.archive);
 return generated;
}
export async function exportEditedSourceGlb(opened){
 good(opened?.sourceGLB&&opened?.edits,'EXPORT_INPUT','open native project before export');
 const original=gltf(opened.sourceGLB);
 const edits=normalizeEdits(opened.edits,original.json,opened.sourceGLB);
 const geometryModified=Boolean(edits.meshOperations?.length);
 const updatedBinary=geometryModified?
  applyMeshOperations(opened.sourceGLB,edits.meshOperations):null;
 const parsed=updatedBinary?gltf(updatedBinary):original;
 const doc=clone(parsed.json);
 for(const [index,fields] of Object.entries(edits.nodeTransforms))
  Object.assign(doc.nodes[Number(index)],fields);
 for(const [index,fields] of Object.entries(edits.materialPbr))
  Object.assign(doc.materials[Number(index)].pbrMetallicRoughness ||= {},fields);
 const exported=writeGlb(parsed,doc);
 return {glb:exported,sha256:await sha256(exported),
  summary:summary(doc),modifiedNodeCount:Object.keys(edits.nodeTransforms).length,
  modifiedMaterialCount:Object.keys(edits.materialPbr).length,
  meshOperations:edits.meshOperations?.length||0,
  geometryModified,preservesOriginalBinary:!geometryModified,
  originalSourcePreservedInNative:true};
}
