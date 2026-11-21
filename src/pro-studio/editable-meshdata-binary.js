/**
 * MARK Pass26 / experimental independently serialized editable MeshData V1.
 * A bounded deterministic binary topology + per-FACE-CORNER UV datablock.
 * Not a general N-gon, skin-weight or full persistent half-edge core.
 * Source GLB keeps all other streams and is the lossless export authority.
 */
import {parseGlb} from '../glb.js';
import {applyMeshOperations} from './mesh-edit-core.js';
import {buildMeshDataSnapshot} from './meshdata-halfedge-preview.js';

const MAGIC='MARKMDB1',HEADER=64,VERSION=1,MAX_FACES=512,MAX_VERTICES=32768;
const fail=(code,reason)=>{const e=Error('MARK_MDB_'+code+': '+reason);e.code='MDB_'+code;throw e;};
const ok=(a,c,r)=>{if(!a)fail(c,r);};
const validInt=n=>Number.isSafeInteger(n)&&n>=0;
const hex=/^[a-f0-9]{64}$/;
const same=(a,b)=>Math.abs(a-b)<2e-6;
const asBytes=x=>x instanceof Uint8Array?x:
 x instanceof ArrayBuffer?new Uint8Array(x):
 ArrayBuffer.isView(x)?new Uint8Array(x.buffer,x.byteOffset,x.byteLength):
 fail('BINARY','MeshData block must be actual bytes');
const components={SCALAR:1,VEC2:2,VEC3:3,VEC4:4},
 types={5121:[1,'getUint8'],5123:[2,'getUint16'],5125:[4,'getUint32'],
  5126:[4,'getFloat32']};

function sourceGeometry(sourceGLB,meshIndex,primitiveIndex){
 const parsed=parseGlb(asBytes(sourceGLB)),doc=parsed.json,
  prim=doc.meshes?.[meshIndex]?.primitives?.[primitiveIndex];
 ok(!doc.extensionsRequired?.length&&prim&&(prim.mode??4)===4&&
  prim.indices!==undefined&&prim.attributes?.POSITION!==undefined,
  'SOURCE_PROFILE','Expected indexed uncompressed glTF triangle primitive');
 const bin=parsed.chunks.find(c=>c.type===0x004e4942)?.data;
 ok(bin&&doc.buffers?.length===1&&doc.buffers[0].uri===undefined,
  'SOURCE_BIN','Single embedded glTF BIN required');
 const dv=new DataView(bin.buffer,bin.byteOffset,bin.byteLength);
 function rows(index){
  const a=doc.accessors?.[index],v=doc.bufferViews?.[a?.bufferView];
  ok(a&&v&&v.buffer===0&&!a.sparse&&
   components[a.type]&&types[a.componentType]&&
   validInt(a.count)&&a.count<=MAX_VERTICES*3&&
   (!a.normalized||a.componentType===5126),
   'ACCESSOR','Sparse, normalized, compressed or malformed accessor');
  const count=components[a.type],
   [unit,get]=types[a.componentType],stride=v.byteStride??unit*count,
   base=(v.byteOffset||0)+(a.byteOffset||0);
  ok(stride>=count*unit&&stride%unit===0&&base%unit===0&&
   base+(a.count?(a.count-1)*stride+count*unit:0)<=
    Math.min(bin.byteLength,(v.byteOffset||0)+v.byteLength),
   'ACCESSOR_RANGE','glTF accessor escaped its binary bufferView');
  return{a,data:Array.from({length:a.count},(_,i)=>
   Array.from({length:count},(_,j)=>dv[get](base+i*stride+j*unit,true)))};
 }
 const pos=rows(prim.attributes.POSITION),ind=rows(prim.indices);
 ok(pos.a.type==='VEC3'&&pos.a.componentType===5126&&
  pos.a.count>0&&pos.a.count<=MAX_VERTICES&&
  ind.a.type==='SCALAR'&&[5121,5123,5125].includes(ind.a.componentType)&&
  ind.a.count>=3&&ind.a.count%3===0&&ind.a.count/3<=MAX_FACES,
  'BOUNDS','Experimental MeshData supports up to 512 triangles');
 const indices=ind.data.map(x=>x[0]);
 ok(indices.every(x=>validInt(x)&&x<pos.a.count),
  'INDICES','Source has invalid indices');
 const sets={};let mask=0;
 for(let i=0;i<=1;i++){
  if(prim.attributes['TEXCOORD_'+i]===undefined)continue;
  const uv=rows(prim.attributes['TEXCOORD_'+i]);
  ok(uv.a.type==='VEC2'&&uv.a.componentType===5126&&
   uv.a.count===pos.a.count,
   'UV_STREAM','UV sets must contain dense float32 pairs');
  ok(uv.data.every(r=>r.every(Number.isFinite)),
   'UV_STREAM','Non-finite source UV');
  sets[i]=uv.data;mask|=1<<i;
 }
 ok(mask>0,'UV_MISSING','At least one Float32 UV set required');
 return{positions:pos.data,indices,uv:sets,mask};
}
function shape(vertices,faces,mask){
 return HEADER+faces*3*4+vertices*3*4+
  ((mask&1)?faces*3*2*4:0)+((mask&2)?faces*3*2*4:0);
}
function layout(geometry){
 const faces=geometry.indices.length/3,vertices=geometry.positions.length,
  indicesOffset=HEADER,positionsOffset=indicesOffset+faces*3*4,
  uv0Offset=positionsOffset+vertices*3*4,
  uv1Offset=uv0Offset+((geometry.mask&1)?faces*3*2*4:0);
 return{indicesOffset,positionsOffset,uv0Offset,uv1Offset,
  bytes:shape(vertices,faces,geometry.mask),faces,vertices,mask:geometry.mask};
}
function encodeOriginal(sourceGLB,sourceSha256,meshIndex,primitiveIndex){
 ok(validInt(meshIndex)&&validInt(primitiveIndex)&&hex.test(sourceSha256),
  'SOURCE_ID','Required original SHA-256 and mesh/primitive IDs');
 const g=sourceGeometry(sourceGLB,meshIndex,primitiveIndex),l=layout(g),
  bytes=new Uint8Array(l.bytes),d=new DataView(bytes.buffer);
 for(let i=0;i<8;i++)bytes[i]=MAGIC.charCodeAt(i);
 for(const [offset,value] of [[8,VERSION],[12,meshIndex],[16,primitiveIndex],
  [20,l.vertices],[24,l.faces],[28,l.mask]])
  d.setUint32(offset,value,true);
 for(let i=0;i<32;i++)bytes[32+i]=parseInt(sourceSha256.slice(i*2,i*2+2),16);
 g.indices.forEach((x,i)=>d.setUint32(l.indicesOffset+i*4,x,true));
 g.positions.forEach((row,i)=>row.forEach((v,k)=>
  d.setFloat32(l.positionsOffset+(i*3+k)*4,v,true)));
 for(const set of [0,1])if(l.mask&(1<<set)){
  const base=set===0?l.uv0Offset:l.uv1Offset;
  for(let corner=0;corner<g.indices.length;corner++)
   for(let k=0;k<2;k++)
    d.setFloat32(base+(corner*2+k)*4,
     g.uv[set][g.indices[corner]][k],true);
 }
 return bytes;
}
function decodeBinary(blob){
 const data=asBytes(blob);
 ok(data.length>=HEADER,'BINARY_SIZE','Truncated MeshData header');
 const d=new DataView(data.buffer,data.byteOffset,data.byteLength);
 ok(Array.from(data.subarray(0,8),x=>String.fromCharCode(x)).join('')===MAGIC&&
  d.getUint32(8,true)===VERSION,
  'BINARY_MAGIC','Wrong MeshData magic or version');
 const meshIndex=d.getUint32(12,true),primitiveIndex=d.getUint32(16,true),
  vertices=d.getUint32(20,true),faces=d.getUint32(24,true),
  mask=d.getUint32(28,true);
 ok(vertices>0&&vertices<=MAX_VERTICES&&faces>0&&faces<=MAX_FACES&&
  mask>0&&mask<=3&&data.length===shape(vertices,faces,mask),
  'BINARY_SHAPE','Invalid counts or trailing/truncated MeshData payload');
 const sourceSha256=Array.from(data.subarray(32,64),
  x=>x.toString(16).padStart(2,'0')).join(''),
  offsetIdx=HEADER,offsetPos=offsetIdx+faces*3*4;
 const indices=Array.from({length:faces*3},(_,i)=>
  d.getUint32(offsetIdx+i*4,true)),
  positions=Array.from({length:vertices},(_,i)=>
   Array.from({length:3},(_,k)=>d.getFloat32(offsetPos+(i*3+k)*4,true)));
 ok(indices.every(x=>x<vertices)&&positions.flat().every(Number.isFinite),
  'BINARY_DATA','Non-finite position or invalid source index');
 const offsets={},uv={};let offset=offsetPos+vertices*3*4;
 for(const set of [0,1])if(mask&(1<<set)){
  offsets[set]=offset;
  uv[set]=Array.from({length:faces*3},(_,i)=>
   Array.from({length:2},(_,k)=>d.getFloat32(offset+(i*2+k)*4,true)));
  offset+=faces*3*2*4;
  ok(uv[set].flat().every(x=>Number.isFinite(x)&&Math.abs(x)<=1e4),
   'BINARY_UV','Invalid UV coordinate');
 }
 return{sourceSha256,meshIndex,primitiveIndex,vertices,faces,mask,
  indices,positions,uv,offsets,data};
}
function inspect(blob,sourceGLB,expectedSha){
 const m=decodeBinary(blob);
 ok(m.sourceSha256===expectedSha,'SOURCE_SHA','MeshData was authored on another source');
 const g=sourceGeometry(sourceGLB,m.meshIndex,m.primitiveIndex);
 ok(g.indices.length===m.indices.length&&
  g.positions.length===m.positions.length&&g.mask===m.mask&&
  g.indices.every((x,i)=>m.indices[i]===x)&&
  g.positions.every((row,i)=>row.every((x,k)=>same(x,m.positions[i][k]))),
  'SOURCE_TOPOLOGY','Source has different vertex positions or triangle indices');
 return m;
}
const faceId=(sha,meshIndex,primitiveIndex,i)=>
 'mark-face-'+sha+'-m'+meshIndex+'-p'+primitiveIndex+'-source-face-'+i;
const cornerId=(id,k)=>'mark-corner-'+id+'-k'+k;
function chosenFaces(m,op){
 ok(op&&typeof op==='object'&&!Array.isArray(op)&&
  Object.keys(op).length===6&&
  ['kind','meshIndex','primitiveIndex','faceId','uvSet','delta','scope']
   .every(k=>Object.hasOwn(op,k))===false,
  'ARGS','Dummy'); // replaced below by strict canonical guard
}
function translate(blob,sourceGLB,sourceSha256,op){
 const m=inspect(blob,sourceGLB,sourceSha256);
 ok(op&&typeof op==='object'&&!Array.isArray(op)&&
  Object.keys(op).length===7&&
  ['kind','meshIndex','primitiveIndex','faceId','uvSet','delta','scope']
   .every(k=>Object.hasOwn(op,k))&&
  op.kind==='meshdata.translateUv'&&
  op.meshIndex===m.meshIndex&&op.primitiveIndex===m.primitiveIndex&&
  typeof op.faceId==='string'&&op.faceId.length<256&&
  validInt(op.uvSet)&&op.uvSet<=1&&
  m.mask&(1<<op.uvSet)&&
  ['face','island'].includes(op.scope)&&
  Array.isArray(op.delta)&&op.delta.length===2&&
  op.delta.every(x=>typeof x==='number'&&Number.isFinite(x)&&
   Math.abs(x)<=1)&&Math.hypot(...op.delta)>1e-8,
  'ARGS','Require exact source-bound UV face/island transform');
 const f=Array.from({length:m.faces},(_,i)=>
  faceId(m.sourceSha256,m.meshIndex,m.primitiveIndex,i))
  .indexOf(op.faceId);
 ok(f>=0,'STALE_FACE','Stable source face ID not found');
 const selected=new Set([f]);
 if(op.scope==='island'){
  // UV island adjacency requires TWO opposed glTF-index edges and the
  // SAME selected UV coordinates on both endpoints. Never position-weld.
  const incidences=new Map();
  for(let i=0;i<m.faces;i++)for(let k=0;k<3;k++){
   const a=m.indices[i*3+k],b=m.indices[i*3+(k+1)%3],
    key=Math.min(a,b)+':'+Math.max(a,b);
   if(!incidences.has(key))incidences.set(key,[]);
   incidences.get(key).push({face:i,a,b,k});
  }
  const neighbors=Array.from({length:m.faces},()=>[]);
  for(const incidents of incidences.values()){
   ok(incidents.length<=2,'NON_MANIFOLD','UV island source edge has >2 faces');
   if(incidents.length!==2)continue;
   const [a,b]=incidents;
   if(a.a!==b.b||a.b!==b.a)continue;
   const uv=m.uv[op.uvSet],
    aStart=uv[a.face*3+a.k],
    aEnd=uv[a.face*3+(a.k+1)%3],
    bEnd=uv[b.face*3+(b.k+1)%3],
    bStart=uv[b.face*3+b.k];
   if(aStart.every((x,k)=>same(x,bEnd[k]))&&
    aEnd.every((x,k)=>same(x,bStart[k]))){
    neighbors[a.face].push(b.face);
    neighbors[b.face].push(a.face);
   }
  }
  const todo=[f];
  while(todo.length){
   const current=todo.pop();
   for(const next of neighbors[current])if(!selected.has(next)){
    selected.add(next);todo.push(next);
   }
  }
 }
 const next=m.data.slice(),dv=new DataView(next.buffer);
 for(const face of selected)for(let k=0;k<3;k++)
  for(let axis=0;axis<2;axis++){
   const index=face*3+k,offset=m.offsets[op.uvSet]+
    (index*2+axis)*4,
    value=Math.fround(m.uv[op.uvSet][index][axis]+op.delta[axis]);
   ok(Number.isFinite(value)&&Math.abs(value)<=1e4,
    'UV_RANGE','UV transform escapes supported Float32 bounds');
   dv.setFloat32(offset,value,true);
  }
 return{bytes:next,changedFaces:[...selected].sort((a,b)=>a-b)};
}
/** Public: standalone, versioned binary datablock with actual vertex and per-corner UV arrays. */
export function buildEditableMeshDataBinary({sourceGLB,sourceSha256,
 meshIndex=0,primitiveIndex=0,operations=[]}={}){
 ok(Array.isArray(operations)&&operations.length<=16,
  'OPS','Up to 16 UV datablock commands');
 let binary=encodeOriginal(sourceGLB,sourceSha256,meshIndex,primitiveIndex);
 for(const op of operations)binary=translate(binary,sourceGLB,sourceSha256,op).bytes;
 // Verify current structure and origin after replay before persistence.
 inspect(binary,sourceGLB,sourceSha256);
 return binary;
}
export function previewEditableMeshDataBinary({data,sourceGLB,sourceSha256}={}){
 const m=inspect(data,sourceGLB,sourceSha256),
  graph=buildMeshDataSnapshot({
   sourceGLB,editedGLB:sourceGLB,sourceSha256,
   meshIndex:m.meshIndex,primitiveIndex:m.primitiveIndex,operations:[]
  });
 const originalCorners=new Map(graph.corners.map(c=>[c.id,c]));
 const faces=graph.faces.map(f=>({...f,
  uvSetNames:Object.keys(m.uv).map(x=>'TEXCOORD_'+x)}));
 const corners=graph.corners.map(c=>{
  const face=graph.faces.find(f=>f.id===c.faceId),
   at=face.triangleIndex*3+c.slot;
  return{...c,attributes:{...c.attributes,
   uvSets:Object.fromEntries(Object.entries(m.uv).map(([set,rows])=>
    ['TEXCOORD_'+set,rows[at].slice()]))}};
 });
 ok(corners.length===m.faces*3&&originalCorners.size===corners.length,
  'ID_GRAPH','Physical corner IDs not unique');
 return{schema:'mark.editable-meshdata-binary/1',
  sourceSha256,meshIndex:m.meshIndex,primitiveIndex:m.primitiveIndex,
  persisted:true,standaloneBinary:true,bytes:m.data.length,
  supported:['source TRIANGLES','vertex positions','source face and corner IDs',
   'UV0/UV1 per-corner Float32','safe face/island UV translation'],
  uvSets:Object.keys(m.uv).map(x=>'TEXCOORD_'+x),
  faces,corners,edges:graph.edges,halfedges:graph.halfedges,
  diagnostics:{...graph.diagnostics,
   editableMeshData:true,storedAttributeVertices:m.vertices,
   faceCount:m.faces,uvSetCount:Object.keys(m.uv).length,
   uvCornerCount:corners.length}};
}
export function renderEditableMeshDataGlb({sourceGLB,sourceSha256,data}={}){
 const m=inspect(data,sourceGLB,sourceSha256),
  src=encodeOriginal(sourceGLB,sourceSha256,m.meshIndex,m.primitiveIndex),
  original=decodeBinary(src),ops=[];
 for(let f=0;f<m.faces;f++)for(const set of [0,1])if(m.mask&(1<<set)){
  const delta=m.uv[set][f*3].map((x,k)=>
   Math.fround(x-original.uv[set][f*3][k]));
  let altered=false;
  for(let c=0;c<3;c++)for(let k=0;k<2;k++){
   const d=m.uv[set][f*3+c][k]-original.uv[set][f*3+c][k];
   ok(same(d,delta[k]),'UNSUPPORTED_CORNER_SHAPE',
    'Exporter currently supports uniform UV translation per face and set');
   altered ||=Math.abs(d)>2e-6;
  }
  if(altered){
   ok(delta.every(x=>Math.abs(x)<=1),'UV_EXPORT_RANGE',
    'Source-relative UV translation exceeds existing core profile');
   ops.push({kind:'uv.offsetFaceCorners',
    meshIndex:m.meshIndex,primitiveIndex:m.primitiveIndex,
    faceIndex:f,uvSet:set,delta});
  }
 }
 ok(ops.length<=8,'EXPORT_LIMIT',
  'At most eight changed face/UV-set pairs in initial exporter');
 const edited=applyMeshOperations(sourceGLB,ops);
 // Verify both UV sets in the physical export actually match datablock.
 if(ops.length){
  const graph=buildMeshDataSnapshot({sourceGLB,editedGLB:edited,
   sourceSha256,meshIndex:m.meshIndex,primitiveIndex:m.primitiveIndex,
   operations:ops});
  const byCorner=new Map(graph.corners.map(c=>[c.id,c]));
  for(const face of graph.faces)for(let k=0;k<3;k++)
   for(const set of [0,1])if(m.mask&(1<<set)){
    const actual=byCorner.get(face.cornerIds[k]).attributes.uvSets[
     'TEXCOORD_'+set],target=m.uv[set][face.triangleIndex*3+k];
    ok(actual.every((x,i)=>same(x,target[i])),'EXPORT_DIVERGENCE',
     'GLB UV corner values differ from independent MeshData binary resource');
   }
 }
 return{glb:edited,operations:ops};
}
