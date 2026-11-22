/**
 * Pass29: independent authoritative *source TRIANGLES topology* resource.
 * Source vertex/edge/face/halfedge ownership and native seam/sharp edge flags.
 * No N-gons, topology-changing commands, or GLB-standard sharp flags.
 */
import {parseGlb} from '../glb.js';
const MAGIC='MARKTOP1',VERSION=1,HEADER=96,NONE=0xffffffff;
const MAX_VERTICES=32768,MAX_FACES=512,MAX_EDGES=1536;
const bad=(id,msg)=>{const e=Error('MARK_TOPO_'+id+': '+msg);e.code='TOPO_'+id;throw e;};
const ok=(x,id,msg)=>{if(!x)bad(id,msg);};
const uint=x=>Number.isSafeInteger(x)&&x>=0;
const bits={seam:1,sharp:2};
const dense=x=>x instanceof Uint8Array?x:
 ArrayBuffer.isView(x)?new Uint8Array(x.buffer,x.byteOffset,x.byteLength):
 x instanceof ArrayBuffer?new Uint8Array(x):
 bad('BYTES','Expected binary Uint8Array/ArrayBuffer');
const vertexID=(sha,m,p,r)=>'mark-attr-'+sha+'-m'+m+'-p'+p+'-v'+r;
const faceID=(sha,m,p,f)=>'mark-face-'+sha+'-m'+m+'-p'+p+'-source-face-'+f;
const cornerID=(sha,m,p,f,k)=>'mark-corner-'+faceID(sha,m,p,f)+'-k'+k;
const halfedgeID=(sha,m,p,f,k)=>'mark-halfedge-'+sha+'-m'+m+'-p'+p+'-f'+f+'-k'+k;
export const edgeID=(sha,m,p,a,b)=>
 'mark-topo-edge-'+sha+'-m'+m+'-p'+p+
 '-a'+Math.min(a,b)+'-b'+Math.max(a,b);
const len=(nv,ne,nf,nh)=>HEADER+nv*12+ne*20+nf*8+nh*20;

function readIndexedSource(sourceGLB,meshIndex,primitiveIndex){
 const parsed=parseGlb(dense(sourceGLB)),doc=parsed.json,
  prim=doc.meshes?.[meshIndex]?.primitives?.[primitiveIndex];
 ok(prim&&(prim.mode??4)===4&&prim.indices!==undefined&&
  prim.attributes?.POSITION!==undefined&&
  !(doc.extensionsRequired||[]).length,
  'PROFILE','Expected source indexed TRIANGLES with no mandatory extensions');
 const p=doc.accessors[prim.attributes.POSITION],
  a=doc.accessors[prim.indices],view=doc.bufferViews[a.bufferView],
  bin=parsed.chunks.find(c=>c.type===0x004e4942)?.data;
 ok(bin&&doc.buffers?.length===1&&
  p&&p.type==='VEC3'&&p.componentType===5126&&!p.sparse&&
  a&&a.type==='SCALAR'&&!a.sparse&&!a.normalized&&
  [5121,5123,5125].includes(a.componentType)&&
  p.count>0&&p.count<=MAX_VERTICES&&
  a.count>=3&&a.count%3===0&&a.count/3<=MAX_FACES&&
  view&&view.buffer===0,'PROFILE','Unsupported source index accessor');
 const size={5121:1,5123:2,5125:4}[a.componentType],
  method={5121:'getUint8',5123:'getUint16',5125:'getUint32'}[
   a.componentType],
  stride=view.byteStride??size,
  start=(view.byteOffset||0)+(a.byteOffset||0);
 ok(start%size===0&&stride>=size&&stride%size===0&&
  start+(a.count-1)*stride+size<=
   Math.min(bin.length,(view.byteOffset||0)+view.byteLength),
  'ACCESSOR','Index accessor out of bounds');
 const dv=new DataView(bin.buffer,bin.byteOffset,bin.byteLength),
  indices=Array.from({length:a.count},(_,i)=>
   dv[method](start+i*stride,true));
 ok(indices.every(x=>x<p.count),'INDICES','Invalid source triangle index');
 for(let i=0;i<indices.length;i+=3)
  ok(new Set(indices.slice(i,i+3)).size===3,
   'FACE_DUPLICATE','Degenerate identical-index triangle');
 return{indices,vertexCount:p.count,faceCount:indices.length/3};
}
function makeRecords(g){
 const nv=g.vertexCount,nf=g.faceCount,nh=g.indices.length,
  vertices=Array.from({length:nv},(_,row)=>({
   sourceRow:row,firstHalfedge:NONE,outgoingCount:0})),
  face=Array.from({length:nf},(_,f)=>({
   sourceFace:f,firstHalfedge:3*f})),
  halfedges=Array.from({length:nh},(_,i)=>({
   sourceRow:g.indices[i],destinationRow:g.indices[3*Math.floor(i/3)+(i+1)%3],
   sourceFace:Math.floor(i/3),next:3*Math.floor(i/3)+(i+1)%3,
   twin:NONE
  }));
 const pairKey=(a,b)=>Math.min(a,b)+':'+Math.max(a,b),
  keyToInc=new Map();
 for(let h=0;h<nh;h++){
  const he=halfedges[h],v=vertices[he.sourceRow];
  if(v.firstHalfedge===NONE)v.firstHalfedge=h;
  v.outgoingCount++;
  const key=pairKey(he.sourceRow,he.destinationRow),list=keyToInc.get(key)||[];
  list.push(h);keyToInc.set(key,list);
 }
 const edges=[...keyToInc.entries()].map(([key,list])=>{
  const [a,b]=key.split(':').map(Number);
  ok(list.length<=2,'NONMANIFOLD','Edge has more than two incident faces');
  if(list.length===2){
   const x=halfedges[list[0]],y=halfedges[list[1]];
   ok(x.sourceRow===y.destinationRow&&x.destinationRow===y.sourceRow,
    'WINDING','Two incident faces must have opposite edge orientation');
   x.twin=list[1];y.twin=list[0];
  }
  return{a,b,halfedgeA:list[0],halfedgeB:list[1]??NONE,flags:0};
 }).sort((x,y)=>x.a-y.a||x.b-y.b);
 ok(edges.length<=MAX_EDGES,'EDGES','Too many physical indexed edges');
 return{vertices,faces:face,edges,halfedges};
}
function sourceRecords(sourceGLB,meshIndex,primitiveIndex){
 const g=readIndexedSource(sourceGLB,meshIndex,primitiveIndex);
 return makeRecords(g);
}
function writeRecords(sourceSha256,meshIndex,primitiveIndex,r){
 ok(/^[a-f0-9]{64}$/.test(sourceSha256)&&
  uint(meshIndex)&&uint(primitiveIndex),
  'SOURCE_ID','Expected source SHA-256 and numeric glTF mesh IDs');
 const nv=r.vertices.length,ne=r.edges.length,nf=r.faces.length,
  nh=r.halfedges.length,raw=new Uint8Array(len(nv,ne,nf,nh)),
  dv=new DataView(raw.buffer);
 for(let i=0;i<8;i++)raw[i]=MAGIC.charCodeAt(i);
 const header=[[8,VERSION],[12,meshIndex],[16,primitiveIndex],
  [20,nv],[24,ne],[28,nf],[32,nh],[36,0]];
 for(const [at,v] of header)dv.setUint32(at,v,true);
 for(let i=0;i<32;i++)
  raw[40+i]=parseInt(sourceSha256.slice(2*i,2*i+2),16);
 let offset=HEADER;
 for(const v of r.vertices){
  dv.setUint32(offset,v.sourceRow,true);
  dv.setUint32(offset+4,v.firstHalfedge,true);
  dv.setUint32(offset+8,v.outgoingCount,true);offset+=12;
 }
 for(const e of r.edges){
  for(const [i,n] of [e.a,e.b,e.halfedgeA,e.halfedgeB,e.flags].entries())
   dv.setUint32(offset+4*i,n,true);
  offset+=20;
 }
 for(const f of r.faces){
  dv.setUint32(offset,f.sourceFace,true);
  dv.setUint32(offset+4,f.firstHalfedge,true);offset+=8;
 }
 for(const h of r.halfedges){
  for(const [i,n] of [h.sourceRow,h.destinationRow,h.sourceFace,h.next,
   h.twin].entries())dv.setUint32(offset+4*i,n,true);
  offset+=20;
 }
 ok(offset===raw.length,'INTERNAL','Unexpected topology serialization size');
 return raw;
}
function decodeBinary(input){
 const data=dense(input);
 ok(data.length>=HEADER,'HEADER','Truncated topology header');
 const view=new DataView(data.buffer,data.byteOffset,data.byteLength);
 ok(Array.from(data.slice(0,8),x=>String.fromCharCode(x)).join('')===
  MAGIC&&view.getUint32(8,true)===VERSION,
  'MAGIC','Unknown topology binary format or version');
 const meshIndex=view.getUint32(12,true),primitiveIndex=view.getUint32(16,true),
  nv=view.getUint32(20,true),ne=view.getUint32(24,true),
  nf=view.getUint32(28,true),nh=view.getUint32(32,true);
 ok(nv>0&&nv<=MAX_VERTICES&&ne>0&&ne<=MAX_EDGES&&
  nf>0&&nf<=MAX_FACES&&nh===nf*3&&
  view.getUint32(36,true)===0&&
  data.length===len(nv,ne,nf,nh)&&
  data.slice(72,HEADER).every(x=>x===0),
  'SHAPE','Unexpected resource size, count or reserved field');
 const sha=Array.from(data.slice(40,72),x=>
  x.toString(16).padStart(2,'0')).join('');
 let at=HEADER;
 const vertices=Array.from({length:nv},()=>{
  const r={sourceRow:view.getUint32(at,true),
   firstHalfedge:view.getUint32(at+4,true),
   outgoingCount:view.getUint32(at+8,true)};at+=12;return r;
 });
 const edges=Array.from({length:ne},()=>{
  const r={a:view.getUint32(at,true),b:view.getUint32(at+4,true),
   halfedgeA:view.getUint32(at+8,true),
   halfedgeB:view.getUint32(at+12,true),
   flags:view.getUint32(at+16,true)};at+=20;return r;
 });
 const faces=Array.from({length:nf},()=>{
  const r={sourceFace:view.getUint32(at,true),
   firstHalfedge:view.getUint32(at+4,true)};at+=8;return r;
 });
 const halfedges=Array.from({length:nh},()=>{
  const r={sourceRow:view.getUint32(at,true),
   destinationRow:view.getUint32(at+4,true),
   sourceFace:view.getUint32(at+8,true),
   next:view.getUint32(at+12,true),
   twin:view.getUint32(at+16,true)};at+=20;return r;
 });
 return{data,sha,meshIndex,primitiveIndex,vertices,edges,faces,halfedges};
}
function applyEdgeFlag(bytes,sourceSha256,op){
 const graph=decodeBinary(bytes),
  keys=['kind','meshIndex','primitiveIndex','edgeId','flag','enabled'];
 ok(op&&typeof op==='object'&&!Array.isArray(op)&&
  Object.keys(op).length===keys.length&&
  keys.every(k=>Object.hasOwn(op,k))&&
  op.kind==='mesh.topologySetEdgeFlag'&&
  op.meshIndex===graph.meshIndex&&
  op.primitiveIndex===graph.primitiveIndex&&
  typeof op.edgeId==='string'&&op.edgeId.length<180&&
  Object.hasOwn(bits,op.flag)&&typeof op.enabled==='boolean',
  'OP_FIELDS','Exact typed source edge ID and seam/sharp boolean required');
 const index=graph.edges.findIndex(e=>
  edgeID(sourceSha256,graph.meshIndex,graph.primitiveIndex,e.a,e.b)===
  op.edgeId);
 ok(index>=0,'EDGE_STALE','Edge ID absent from owned current topology');
 const next=graph.data.slice(),dv=new DataView(next.buffer),
  flagOffset=HEADER+graph.vertices.length*12+index*20+16,
  old=dv.getUint32(flagOffset,true),flag=bits[op.flag];
 dv.setUint32(flagOffset,op.enabled?old|flag:old&~flag,true);
 return next;
}
export function buildOwnedTopologyBinary({
 sourceGLB,sourceSha256,meshIndex=0,primitiveIndex=0,operations=[]
}={}){
 ok(Array.isArray(operations)&&operations.length<=32,
  'OPS','Max 32 typed edge flag edits');
 const source=sourceRecords(sourceGLB,meshIndex,primitiveIndex);
 let bytes=writeRecords(sourceSha256,meshIndex,primitiveIndex,source);
 for(const op of operations)bytes=applyEdgeFlag(bytes,sourceSha256,op);
 verifyOwnedTopologyBinary({sourceGLB,sourceSha256,data:bytes});
 return bytes;
}
export function verifyOwnedTopologyBinary({sourceGLB,sourceSha256,data}={}){
 const parsed=decodeBinary(data);
 ok(parsed.sha===sourceSha256,'SOURCE_SHA','Source GLB hash does not match topology');
 const derived=sourceRecords(sourceGLB,parsed.meshIndex,parsed.primitiveIndex);
 ok(derived.vertices.length===parsed.vertices.length&&
  derived.edges.length===parsed.edges.length&&
  derived.faces.length===parsed.faces.length&&
  derived.halfedges.length===parsed.halfedges.length,
  'TOPO_COUNTS','Topology differs from source primitive');
 const expected=writeRecords(sourceSha256,parsed.meshIndex,parsed.primitiveIndex,
  derived),v=new DataView(parsed.data.buffer,parsed.data.byteOffset,
   parsed.data.byteLength),e=new DataView(expected.buffer);
 // Exact structural correspondence to the same source GLB, with only
 // explicit two-bit seam/sharp annotations allowed to diverge.
 const flags=new Set(derived.edges.map((_,i)=>
  HEADER+derived.vertices.length*12+i*20+16));
 for(let offset=0;offset<parsed.data.length;offset++){
  if(flags.has(offset)||flags.has(offset-1)||
   flags.has(offset-2)||flags.has(offset-3))continue;
  ok(parsed.data[offset]===expected[offset],
   'SOURCE_REPLAY','Structural records differ from original source');
 }
 for(const [i,edge] of parsed.edges.entries())
  ok(edge.flags<=3&&edge.a<edge.b&&
   (i===0||parsed.edges[i-1].a<edge.a||
    parsed.edges[i-1].a===edge.a&&parsed.edges[i-1].b<edge.b),
   'EDGE_FLAGS','Invalid marker flags or unsorted owned edges');
 return parsed;
}
export function previewOwnedTopology({sourceGLB,sourceSha256,data}={}){
 const m=verifyOwnedTopologyBinary({sourceGLB,sourceSha256,data}),
  mesh=m.meshIndex,primitive=m.primitiveIndex;
 const vertices=m.vertices.map((v,i)=>({
  id:vertexID(sourceSha256,mesh,primitive,i),
  sourceAttributeVertex:v.sourceRow,
  firstHalfedgeId:v.firstHalfedge===NONE?null:
   halfedgeID(sourceSha256,mesh,primitive,
    Math.floor(v.firstHalfedge/3),v.firstHalfedge%3),
  outgoingCount:v.outgoingCount
 }));
 const edges=m.edges.map(e=>({
  id:edgeID(sourceSha256,mesh,primitive,e.a,e.b),
  sourceRows:[e.a,e.b],vertexIds:[
   vertexID(sourceSha256,mesh,primitive,e.a),
   vertexID(sourceSha256,mesh,primitive,e.b)],
  halfedgeIds:[e.halfedgeA,e.halfedgeB].filter(x=>x!==NONE)
   .map(h=>halfedgeID(sourceSha256,mesh,primitive,
    Math.floor(h/3),h%3)),
  boundary:e.halfedgeB===NONE,seam:Boolean(e.flags&1),
  sharp:Boolean(e.flags&2)
 }));
 const faces=m.faces.map(f=>({
  id:faceID(sourceSha256,mesh,primitive,f.sourceFace),
  sourceFace:f.sourceFace,
  halfedgeIds:Array.from({length:3},(_,k)=>
   halfedgeID(sourceSha256,mesh,primitive,f.sourceFace,k)),
  cornerIds:Array.from({length:3},(_,k)=>
   cornerID(sourceSha256,mesh,primitive,f.sourceFace,k))
 }));
 const halfedges=m.halfedges.map((h,i)=>({
  id:halfedgeID(sourceSha256,mesh,primitive,h.sourceFace,i%3),
  origin:vertexID(sourceSha256,mesh,primitive,h.sourceRow),
  destination:vertexID(sourceSha256,mesh,primitive,h.destinationRow),
  faceId:faceID(sourceSha256,mesh,primitive,h.sourceFace),
  next:halfedgeID(sourceSha256,mesh,primitive,
   Math.floor(h.next/3),h.next%3),
  twin:h.twin===NONE?null:halfedgeID(sourceSha256,mesh,primitive,
   Math.floor(h.twin/3),h.twin%3)
 }));
 return{schema:'mark.owned-topology/1',meshIndex:mesh,
  primitiveIndex:primitive,sourceSha256,storedBinaryBytes:m.data.length,
  persistedVertexEdgeFaceHalfedge:true,vertices,edges,faces,halfedges,
  diagnostics:{vertexCount:vertices.length,edgeCount:edges.length,
   faceCount:faces.length,halfedgeCount:halfedges.length,
   boundaryEdges:edges.filter(e=>e.boundary).length,
   interiorEdges:edges.filter(e=>!e.boundary).length,
   markedSeams:edges.filter(e=>e.seam).length,
   markedSharpEdges:edges.filter(e=>e.sharp).length,
   topologyChanged:false}};
}
export function ownedTopologyAnnotations({sourceGLB,sourceSha256,data}={}){
 const graph=previewOwnedTopology({sourceGLB,sourceSha256,data});
 return{schema:'mark.owned-topology-edge-flags/1',
  sourceSha256,meshIndex:graph.meshIndex,
  primitiveIndex:graph.primitiveIndex,
  edges:graph.edges.filter(e=>e.seam||e.sharp).map(e=>({
   id:e.id,sourceRows:e.sourceRows,seam:e.seam,sharp:e.sharp
  }))};
}
