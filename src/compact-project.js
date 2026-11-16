/**
 * MARK3D v2 — portable binary container, independent from GLB.
 * Header: "MARK3D02" (8 bytes), version u16, flags u16, compressedLength u32,
 * rawLength u32, crc32(raw) u32 (little endian).
 * Payload: gzip( u32 metadataLength | UTF-8 JSON metadata | typed-array sections ).
 * Typed arrays: stable numeric IDs, FLOAT64 XYZ + UV, indexed variable-length
 * polygon loops with independent per-corner FLOAT64 UV, edge-ID mapping.
 * Recoverable half-edges are rebuilt deterministically from polygons.
 * Legacy JSON mark3d/0.1 is detected and migrated without discarding history.
 */
import {gzipSync,gunzipSync} from 'fflate';
import {EditableMesh} from './professional-geometry.js';
const TE=new TextEncoder(),TD=new TextDecoder('utf-8',{fatal:true});
const MAGIC=TE.encode('MARK3D02'),VERSION=2,HEADER=24;
const MAX_RAW=512*1024*1024,MAX_COMP=128*1024*1024;
const numericId=(name,prefix)=>{
 if(typeof name!=='string'||!new RegExp('^'+prefix+'[1-9][0-9]*$').test(name))throw Error('Unsupported stable '+prefix+' ID: '+name);
 const n=Number(name.slice(1));if(!Number.isSafeInteger(n)||n>0xffffffff)throw Error('ID overflow '+name);
 return n;
};
let table;
function crc32(bytes){
 if(!table){table=new Uint32Array(256);for(let i=0;i<256;i++){
  let c=i;for(let j=0;j<8;j++)c=c&1?0xedb88320^(c>>>1):c>>>1;
  table[i]=c>>>0;
 }}
 let crc=0xffffffff;for(const b of bytes)crc=table[(crc^b)&255]^(crc>>>8);
 return (crc^0xffffffff)>>>0;
}
const bytesOf=x=>x instanceof Uint8Array?x:x instanceof ArrayBuffer?new Uint8Array(x):ArrayBuffer.isView(x)?new Uint8Array(x.buffer,x.byteOffset,x.byteLength):null;
function typedFrom(raw,meta,name,type){
 const info=meta.sections[name];
 if(!info||info.type!==type)throw Error('MARK3D malformed typed array '+name);
 const stride=type==='f64'?8:4,count=info.length,offset=meta.dataStart+info.offset;
 if(!Number.isSafeInteger(count)||count<0||offset<0||offset+count*stride>raw.length)
  throw Error('MARK3D section overflow: '+name);
 const v=new DataView(raw.buffer,raw.byteOffset+offset,count*stride);
 const out=type==='f64'?new Float64Array(count):new Uint32Array(count);
 for(let i=0;i<count;i++)out[i]=type==='f64'?v.getFloat64(i*8,true):v.getUint32(i*4,true);
 return out;
}
function sectionWriter(){
 const sections={},arrays=[],data=[];
 function add(name,array,type){
  const bpe=type==='f64'?8:4,offset=data.reduce((n,a)=>n+a.length,0);
  const bytes=new Uint8Array(array.length*bpe),dv=new DataView(bytes.buffer);
  for(let i=0;i<array.length;i++){
   if(type==='f64')dv.setFloat64(i*8,array[i],true);
   else dv.setUint32(i*4,array[i],true);
  }
  sections[name]={offset,length:array.length,type};
  data.push(bytes);arrays.push(name);
 }
 return {add,sections,data};
}
export function encodeMark3d(mesh,{includeUndo=true,level=6}={}){
 if(!(mesh instanceof EditableMesh))throw Error('MARK3D needs EditableMesh');
 mesh.validate({strict:true});
 const v=[...mesh.vertices.values()],faces=[...mesh.faces.values()],lookup=new Map(v.map((p,i)=>[p.id,i]));
 if(v.length>1000000||faces.length>1500000)throw Error('MARK3D model exceeds safe limits');
 const writer=sectionWriter();
 writer.add('vertexIds',v.map(a=>numericId(a.id,'v')),'u32');
 writer.add('xyz',v.flatMap(a=>a.position),'f64');
 writer.add('vertexUV',v.flatMap(a=>a.uv),'f64');
 const offsets=[0],corners=[],cornerUV=[];
 for(const f of faces){
  if(!f.vertices.every(id=>lookup.has(id)))throw Error('MARK3D references missing vertex');
  corners.push(...f.vertices.map(id=>lookup.get(id)));
  cornerUV.push(...f.uv.flat());
  offsets.push(corners.length);
 }
 writer.add('faceIds',faces.map(f=>numericId(f.id,'f')),'u32');
 writer.add('faceMaterial',faces.map(f=>f.material),'u32');
 writer.add('faceOffsets',offsets,'u32');
 writer.add('corners',corners,'u32');
 writer.add('cornerUV',cornerUV,'f64');
 const edgeFrom=[],edgeTo=[],edgeIds=[];
 for(const [key,value] of mesh._edgeIds){
  const [a,b]=key.split('|');
  if(!lookup.has(a)||!lookup.has(b))continue; // historical removed edges are not live
  edgeFrom.push(lookup.get(a));edgeTo.push(lookup.get(b));edgeIds.push(numericId(value,'e'));
 }
 writer.add('edgeFrom',edgeFrom,'u32');
 writer.add('edgeTo',edgeTo,'u32');
 writer.add('edgeIds',edgeIds,'u32');
 writer.add('selected',[...mesh.selection].map(id=>lookup.get(id)),'u32');
 const masks=[...mesh.masks].map(([name,values])=>[name,[...values].map(([id,w])=>[lookup.get(id),w])]);
 const meta={schema:'mark3d/binary-v2',name:mesh.name,material:mesh.material,
  next:mesh._next,revision:mesh.revision,maxHistory:mesh.maxHistory,
  masks,history:includeUndo?mesh.history:[],future:includeUndo?mesh.future:[],
  sections:writer.sections,metadata:{coordinatePrecision:'float64',cornerUVPrecision:'float64',
   ids:'numeric stable prefixes v/f/e',halfEdges:'rebuild-from-polygons'}};
 const j=TE.encode(JSON.stringify(meta));
 const total=4+j.length+writer.data.reduce((n,b)=>n+b.length,0);
 if(total>MAX_RAW)throw Error('MARK3D payload exceeds safe limit');
 const raw=new Uint8Array(total),dv=new DataView(raw.buffer);
 dv.setUint32(0,j.length,true);raw.set(j,4);
 let ptr=4+j.length;for(const chunk of writer.data){raw.set(chunk,ptr);ptr+=chunk.length;}
 const compressed=gzipSync(raw,{level});
 if(compressed.length>MAX_COMP)throw Error('MARK3D compressed file too large');
 const output=new Uint8Array(HEADER+compressed.length),header=new DataView(output.buffer);
 output.set(MAGIC);
 header.setUint16(8,VERSION,true);header.setUint16(10,1,true);
 header.setUint32(12,compressed.length,true);header.setUint32(16,total,true);
 header.setUint32(20,crc32(raw),true);output.set(compressed,HEADER);
 return output;
}
export function decodeMark3d(input){
 if(typeof input==='string'){
  const project=JSON.parse(input);
  if(project.schema!=='mark3d/0.1')throw Error('Only legacy mark3d/0.1 JSON supported');
  return {mesh:EditableMesh.fromProject(project),migrated:true,version:1};
 }
 const bytes=bytesOf(input);if(!bytes)throw Error('Expected binary MARK3D or JSON text');
 // Backward compatibility with legacy JSON files saved as UTF-8 bytes.
 let head=0;while(head<bytes.length&&[9,10,13,32].includes(bytes[head]))head++;
 if(bytes[head]===123)return decodeMark3d(TD.decode(bytes));
 if(bytes.length<HEADER||MAGIC.some((c,i)=>c!==bytes[i]))throw Error('Invalid MARK3D magic');
 const h=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
 if(h.getUint16(8,true)!==VERSION||h.getUint16(10,true)!==1)throw Error('Unsupported MARK3D binary version/compression');
 const count=h.getUint32(12,true),size=h.getUint32(16,true);
 if(count!==bytes.length-HEADER||count>MAX_COMP||size>MAX_RAW)throw Error('MARK3D invalid length');
 const raw=gunzipSync(bytes.subarray(HEADER));
 if(raw.length!==size||crc32(raw)!==h.getUint32(20,true))throw Error('MARK3D payload integrity checksum mismatch');
 if(raw.length<4)throw Error('MARK3D truncated metadata');
 const jl=new DataView(raw.buffer,raw.byteOffset,raw.byteLength).getUint32(0,true);
 if(jl<4||jl>raw.length-4)throw Error('MARK3D invalid metadata length');
 const meta=JSON.parse(TD.decode(raw.subarray(4,4+jl)));
 if(meta.schema!=='mark3d/binary-v2')throw Error('MARK3D unrecognized metadata schema');
 meta.dataStart=4+jl;
 const arr=(name,t)=>typedFrom(raw,meta,name,t),ids=arr('vertexIds','u32'),
  xyz=arr('xyz','f64'),uv=arr('vertexUV','f64'),
  faceIds=arr('faceIds','u32'),fmat=arr('faceMaterial','u32'),
  offsets=arr('faceOffsets','u32'),corners=arr('corners','u32'),
  cuv=arr('cornerUV','f64'),edgeFrom=arr('edgeFrom','u32'),edgeTo=arr('edgeTo','u32'),
  edgeIds=arr('edgeIds','u32'),selected=arr('selected','u32');
 if(xyz.length!==ids.length*3||uv.length!==ids.length*2||
  offsets.length!==faceIds.length+1||fmat.length!==faceIds.length||
  corners.length*2!==cuv.length||edgeFrom.length!==edgeTo.length||edgeTo.length!==edgeIds.length)
  throw Error('MARK3D inconsistent typed arrays');
 if(offsets[0]!==0||offsets[offsets.length-1]!==corners.length)
  throw Error('MARK3D face corner offsets invalid');
 const vertices=Array.from(ids,(id,i)=>({id:'v'+id,position:Array.from(xyz.slice(i*3,i*3+3)),
  uv:Array.from(uv.slice(i*2,i*2+2))}));
 const faces=Array.from(faceIds,(id,i)=>{
  const start=offsets[i],end=offsets[i+1];
  if(end<start||end>corners.length)throw Error('MARK3D invalid face span');
  return {id:'f'+id,vertices:Array.from(corners.slice(start,end),index=>{
   if(index>=ids.length)throw Error('MARK3D invalid vertex reference');
   return 'v'+ids[index];
  }),uv:Array.from({length:end-start},(_,j)=>Array.from(cuv.slice((start+j)*2,(start+j)*2+2))),
  material:fmat[i]};
 });
 const edgePairs=Array.from(edgeIds,(id,i)=>{
  if(edgeFrom[i]>=ids.length||edgeTo[i]>=ids.length)throw Error('MARK3D invalid edge ref');
  const a='v'+ids[edgeFrom[i]],b='v'+ids[edgeTo[i]];
  return [[a,b].sort().join('|'),'e'+id];
 });
 const select=Array.from(selected,i=>{
  if(i>=ids.length)throw Error('MARK3D invalid selection vertex');
  return 'v'+ids[i];
 });
 const masks=(meta.masks||[]).map(([name,values])=>[name,values.map(([i,w])=>{
  if(!Number.isInteger(i)||i<0||i>=ids.length)throw Error('MARK3D invalid mask vertex');
  return ['v'+ids[i],w];
 })]);
 const mesh=EditableMesh.fromProject({schema:'mark3d/0.1',mesh:{
  name:meta.name,material:meta.material,vertices,faces,selection:select,masks,
  edgeIds:edgePairs,next:meta.next,revision:meta.revision
 },undo:meta.history||[],redo:meta.future||[]});
 mesh.maxHistory=meta.maxHistory||20;
 return {mesh,migrated:false,version:2};
}
export function migrateLegacyProject(input,options={}){
 const {mesh,migrated}=decodeMark3d(input);
 return {bytes:encodeMark3d(mesh,options),migrated};
}
