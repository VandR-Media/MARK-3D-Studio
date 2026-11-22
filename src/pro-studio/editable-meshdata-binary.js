/**
 * MARK Pass26 / experimental independently serialized editable MeshData V1.
 * A bounded deterministic binary topology + per-FACE-CORNER UV datablock.
 * Not a general N-gon, skin-weight or full persistent half-edge core.
 * Source GLB keeps all other streams and is the lossless export authority.
 */
import {parseGlb,writeGlb} from '../glb.js';
import {applyMeshOperations} from './mesh-edit-core.js';
import {buildMeshDataSnapshot} from './meshdata-halfedge-preview.js';

const MAGIC='MARKMDB1',HEADER=64,VERSION=1,NORMALS_VERSION=2,
 MAX_FACES=512,MAX_VERTICES=32768;
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
 ok(pos.data.every(row=>row.every(x=>Number.isFinite(x)&&Math.abs(x)<=1e4)),
  'POSITION','Source positions outside bounded finite profile');
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
 // Retain source skin and morph POSITION deltas for safe verification
 // of explicitly identified split-UV seam duplicates. Never auto-weld
 // unrelated coincident positions or different animated vertex streams.
 const skin=['JOINTS_0','WEIGHTS_0'].map(name=>
  prim.attributes?.[name]===undefined?null:rows(prim.attributes[name]).data);
 const morph=(prim.targets||[]).map(target=>
  target.POSITION===undefined?null:rows(target.POSITION).data);
 ok(skin.every(x=>!x||x.length===pos.a.count)&&
  morph.every(x=>!x||x.length===pos.a.count),
  'SOURCE_SKIN','Skin/morph source rows must have same vertex count');
 const normals=prim.attributes.NORMAL===undefined?null:
  rows(prim.attributes.NORMAL);
 return{positions:pos.data,indices,uv:sets,mask,skin,morph,
  normals:normals?.data||null,
  normalsComponent:normals?.a.componentType||null};
}
function shape(vertices,faces,mask,version=VERSION){
 return HEADER+faces*3*4+vertices*3*4+
  ((mask&1)?faces*3*2*4:0)+((mask&2)?faces*3*2*4:0)+
  (version===NORMALS_VERSION?vertices*3*4:0);
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
 const version=d.getUint32(8,true);
 ok(Array.from(data.subarray(0,8),x=>String.fromCharCode(x)).join('')===MAGIC&&
  [VERSION,NORMALS_VERSION].includes(version),
  'BINARY_MAGIC','Wrong MeshData magic or version');
 const meshIndex=d.getUint32(12,true),primitiveIndex=d.getUint32(16,true),
  vertices=d.getUint32(20,true),faces=d.getUint32(24,true),
  mask=d.getUint32(28,true);
 ok(vertices>0&&vertices<=MAX_VERTICES&&faces>0&&faces<=MAX_FACES&&
  mask>0&&mask<=3&&data.length===shape(vertices,faces,mask,version),
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
 const normalOffset=offset;
 const normals=version===NORMALS_VERSION?
  Array.from({length:vertices},(_,i)=>
   Array.from({length:3},(_,k)=>
    d.getFloat32(normalOffset+(i*3+k)*4,true))):null;
 if(normals)ok(normals.every(v=>v.every(Number.isFinite)&&
  Math.abs(Math.hypot(...v)-1)<1e-4),
  'BINARY_NORMALS','Normal rows must be finite, normalized VEC3');
 return{sourceSha256,meshIndex,primitiveIndex,vertices,faces,mask,
  version,indices,positions,uv,offsets,normals,normalOffset,data};
}
function inspect(blob,sourceGLB,expectedSha){
 const m=decodeBinary(blob);
 ok(m.sourceSha256===expectedSha,'SOURCE_SHA','MeshData was authored on another source');
 const g=sourceGeometry(sourceGLB,m.meshIndex,m.primitiveIndex);
 ok(g.indices.length===m.indices.length&&
  g.positions.length===m.positions.length&&g.mask===m.mask&&
  g.indices.every((x,i)=>m.indices[i]===x)&&
  m.positions.every(row=>row.every(x=>
   Number.isFinite(x)&&Math.abs(x)<=1e4)),
  'SOURCE_TOPOLOGY','Source triangle indices/mask/vertex counts mismatch');
 return m;
}
const faceId=(sha,meshIndex,primitiveIndex,i)=>
 'mark-face-'+sha+'-m'+meshIndex+'-p'+primitiveIndex+'-source-face-'+i;
const cornerId=(id,k)=>'mark-corner-'+id+'-k'+k;
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
const vertexId=(sha,mesh,primitive,row)=>
 'mark-attr-'+sha+'-m'+mesh+'-p'+primitive+'-v'+row;
const vecKey=row=>row.map(x=>Math.fround(x)).join(',');
function seamNeighbors(g){
 // Only attribute rows on reversely oriented, geometric edge-matched
 // triangles count as an evidenced split seam; coincident unrelated
 // triangles are not silently fused.
 const directed=new Map(),neighbors=Array.from(
  {length:g.positions.length},()=>new Set());
 for(let i=0;i<g.indices.length;i+=3)for(let k=0;k<3;k++){
  const a=g.indices[i+k],b=g.indices[i+(k+1)%3];
  const key=vecKey(g.positions[a])+'>'+vecKey(g.positions[b]);
  const list=directed.get(key)||[];
  list.push({a,b,face:i/3});directed.set(key,list);
 }
 for(const entries of directed.values())for(const {a,b,face} of entries){
  const key=vecKey(g.positions[b])+'>'+vecKey(g.positions[a]);
  for(const reverse of directed.get(key)||[]){
   if(reverse.face===face)continue;
   if(a!==reverse.b){
    neighbors[a].add(reverse.b);neighbors[reverse.b].add(a);
   }
   if(b!==reverse.a){
    neighbors[b].add(reverse.a);neighbors[reverse.a].add(b);
   }
  }
 }
 return neighbors;
}
function moveVertex(blob,sourceGLB,sourceSha256,op){
 const m=inspect(blob,sourceGLB,sourceSha256),
  g=sourceGeometry(sourceGLB,m.meshIndex,m.primitiveIndex),
  multi=op?.kind==='meshdata.moveVertexGroup',
  keys=multi?
   ['kind','meshIndex','primitiveIndex','vertexIds','delta','scope']:
   ['kind','meshIndex','primitiveIndex','vertexId','delta','scope'];
 ok(!m.normals,'MOVE_AFTER_NORMALS',
  'Normal recalculation must be terminal. Move vertices before recomputing.');
 ok(op&&typeof op==='object'&&!Array.isArray(op)&&
  Object.keys(op).length===keys.length&&
  keys.every(k=>Object.hasOwn(op,k))&&
  ['meshdata.moveVertex','meshdata.moveVertexGroup'].includes(op.kind)&&
  op.meshIndex===m.meshIndex&&op.primitiveIndex===m.primitiveIndex&&
  ['attribute','verified-seam'].includes(op.scope)&&
  (multi?Array.isArray(op.vertexIds)&&op.vertexIds.length>=2&&
   op.vertexIds.length<=8&&op.vertexIds.every(x=>
    typeof x==='string'&&x.length<=160):
   typeof op.vertexId==='string'&&op.vertexId.length<=160)&&
  Array.isArray(op.delta)&&op.delta.length===3&&
  op.delta.every(x=>typeof x==='number'&&
   Number.isFinite(x)&&Math.abs(x)<=2)&&
  Math.hypot(...op.delta)>1e-8,
  'MOVE_ARGS','Exact source IDs (up to 8), 3D delta, scope required');
 const vertexIds=multi?op.vertexIds:[op.vertexId];
 const known=Array.from({length:m.vertices},(_,i)=>
  vertexId(sourceSha256,m.meshIndex,m.primitiveIndex,i));
 const rows=vertexIds.map(id=>known.indexOf(id));
 ok(rows.every(row=>row>=0&&g.indices.includes(row))&&
  new Set(rows).size===rows.length&&
  (!multi||rows.every((r,i)=>i===0||r>rows[i-1])),
  'MOVE_VERTEX','Distinct ordered referenced original source IDs required');
 const seams=seamNeighbors(g);
 const selected=new Set(rows),affected=new Set();
 for(const row of rows){
  const group=new Set([row]),stack=[row];
  while(stack.length){
   const current=stack.pop();
   for(const related of seams[current])if(!group.has(related)){
    group.add(related);stack.push(related);
   }
  }
  ok(op.scope!=='attribute'||[...group].every(x=>selected.has(x)),
   'MOVE_SEAM_SPLIT',
   'Single attribute edit would tear a source seam; include all seam rows or use verified-seam.');
  const groupRows=op.scope==='verified-seam'?[...group]:[row];
  if(groupRows.length>1){
   for(const other of groupRows){
    ok(g.positions[row].every((x,k)=>x===g.positions[other][k])&&
     m.positions[row].every((x,k)=>x===m.positions[other][k])&&
     g.skin.every(stream=>!stream||
      stream[row].every((x,k)=>x===stream[other][k]))&&
     g.morph.every(stream=>!stream||
      stream[row].every((x,k)=>x===stream[other][k])),
     'MOVE_SEAM_DATA','Seam rows differ in POSITION, skin or morph streams');
   }
  }
  for(const target of groupRows)affected.add(target);
 }
 const affectedRows=[...affected].sort((a,b)=>a-b);
 const next=m.data.slice(),dv=new DataView(next.buffer),
  positions=m.positions.map(row=>row.slice()),
  start=HEADER+m.faces*3*4;
 for(const i of affectedRows)for(let axis=0;axis<3;axis++){
  const v=Math.fround(positions[i][axis]+op.delta[axis]);
  ok(Number.isFinite(v)&&Math.abs(v)<=1e4,
   'MOVE_RANGE','Position outside bounded Float32 profile');
  positions[i][axis]=v;
  dv.setFloat32(start+(i*3+axis)*4,v,true);
 }
 // Prevent degenerate and inverted triangles. No silent topological
 // repairs or altered UV/normal/morph/skin semantics in this first profile.
 const triNormal=rows=>{
  const [a,b,c]=rows;
  const u=b.map((x,k)=>x-a[k]),v=c.map((x,k)=>x-a[k]);
  return[u[1]*v[2]-u[2]*v[1],
   u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]];
 };
 for(let f=0;f<m.faces;f++){
  const ids=m.indices.slice(f*3,f*3+3);
  if(!ids.some(id=>affected.has(id)))continue;
  const old=triNormal(ids.map(i=>m.positions[i])),
   now=triNormal(ids.map(i=>positions[i])),
   oldSize=Math.hypot(...old),newSize=Math.hypot(...now);
  ok(oldSize>1e-10&&newSize>1e-10&&
   newSize>oldSize*1e-4&&
   old.reduce((sum,x,i)=>sum+x*now[i],0)/
    (oldSize*newSize)>1e-6,
   'MOVE_TOPOLOGY','Move would collapse or invert an incident triangle');
 }
 return{bytes:next,changedVertices:affectedRows,
  changedVertexIds:affectedRows.map(i=>
   vertexId(sourceSha256,m.meshIndex,m.primitiveIndex,i))};
}
function recalculateNormals(blob,sourceGLB,sourceSha256,op){
 const m=inspect(blob,sourceGLB,sourceSha256),
  g=sourceGeometry(sourceGLB,m.meshIndex,m.primitiveIndex);
 ok(op&&typeof op==='object'&&!Array.isArray(op)&&
  Object.keys(op).length===4&&
  ['kind','meshIndex','primitiveIndex','mode'].every(k=>
   Object.hasOwn(op,k))&&
  op.kind==='meshdata.recalculateNormals'&&
  op.meshIndex===m.meshIndex&&op.primitiveIndex===m.primitiveIndex&&
  op.mode==='area-weighted'&&!m.normals,
  'NORMAL_ARGS','Terminal area-weighted normal operation required');
 const parsed=parseGlb(sourceGLB),doc=parsed.json,
  prim=doc.meshes[m.meshIndex].primitives[m.primitiveIndex];
 ok(g.normals&&g.normalsComponent===5126&&
  g.normals.length===m.vertices&&
  !Object.hasOwn(prim.attributes,'TANGENT')&&
  !(prim.targets||[]).some(t=>t.NORMAL!==undefined||t.TANGENT!==undefined),
  'NORMAL_PROFILE','Float32 NORMAL only, no precomputed tangents or normal morph targets');
 const sums=Array.from({length:m.vertices},()=>[0,0,0]);
 for(let i=0;i<m.indices.length;i+=3){
  const tri=m.indices.slice(i,i+3),[a,b,c]=tri.map(x=>m.positions[x]),
   u=b.map((x,k)=>x-a[k]),v=c.map((x,k)=>x-a[k]),
   n=[u[1]*v[2]-u[2]*v[1],
    u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]];
  ok(Math.hypot(...n)>1e-9,
   'NORMAL_DEGENERATE','Face has no well-defined normal');
  for(const index of tri)for(let axis=0;axis<3;axis++)
   sums[index][axis]+=n[axis];
 }
 const normals=sums.map((row,i)=>{
  const len=Math.hypot(...row);
  ok(len>1e-9,'NORMAL_ORPHAN',
   'Normal recalculation requires referenced noncancelling vertex rows');
  return row.map(x=>Math.fround(x/len));
 });
 const output=new Uint8Array(shape(m.vertices,m.faces,m.mask,NORMALS_VERSION));
 output.set(m.data);
 const dv=new DataView(output.buffer);
 dv.setUint32(8,NORMALS_VERSION,true);
 const offset=m.data.length;
 for(let i=0;i<normals.length;i++)for(let k=0;k<3;k++)
  dv.setFloat32(offset+(i*3+k)*4,normals[i][k],true);
 return{bytes:output,normals};
}
/** Public: standalone, versioned binary datablock with actual vertex and per-corner UV arrays. */
export function buildEditableMeshDataBinary({sourceGLB,sourceSha256,
 meshIndex=0,primitiveIndex=0,operations=[]}={}){
 ok(Array.isArray(operations)&&operations.length<=16,
  'OPS','Up to 16 bounded editable MeshData commands');
 let binary=encodeOriginal(sourceGLB,sourceSha256,meshIndex,primitiveIndex);
 for(const [ordinal,op] of operations.entries()){
  ok(ordinal===0||new DataView(binary.buffer,binary.byteOffset,
   binary.byteLength).getUint32(8,true)!==NORMALS_VERSION,
   'NORMAL_TERMINAL','Normal recalculation must be the last MeshData operation');
  if(op?.kind==='meshdata.translateUv')
   binary=translate(binary,sourceGLB,sourceSha256,op).bytes;
  else if(op?.kind==='meshdata.moveVertex'||
   op?.kind==='meshdata.moveVertexGroup')
   binary=moveVertex(binary,sourceGLB,sourceSha256,op).bytes;
  else if(op?.kind==='meshdata.recalculateNormals')
   binary=recalculateNormals(binary,sourceGLB,sourceSha256,op).bytes;
  else fail('OPS_KIND','Unknown editable MeshData operation kind');
 }
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
   position:m.positions[c.attributeVertex].slice(),
   ...(m.normals?{normal:m.normals[c.attributeVertex].slice()}:{}),
   uvSets:Object.fromEntries(Object.entries(m.uv).map(([set,rows])=>
    ['TEXCOORD_'+set,rows[at].slice()]))}};
 });
 const vertices=Array.from({length:m.vertices},(_,i)=>({
  id:vertexId(sourceSha256,m.meshIndex,m.primitiveIndex,i),
  sourceAttributeVertex:i,position:m.positions[i].slice(),
  ...(m.normals?{normal:m.normals[i].slice()}:{}),
  referencedBySourceFace:m.indices.some(j=>j===i)
 }));
 ok(corners.length===m.faces*3&&originalCorners.size===corners.length,
  'ID_GRAPH','Physical corner IDs not unique');
 // UI/renderers select actual physical glTF attribute rows. After UV COW
 // those indices are NOT the stable source row. Record the verified
 // export-derived provenance instead of guessing from rendered coordinates.
 const physical=renderEditableMeshDataGlb({
  sourceGLB,sourceSha256,data:m.data});
 const attributeRowProvenance=Array.from({length:m.vertices},(_,i)=>({
  physicalAttributeVertex:i,sourceAttributeVertex:i,
  vertexId:vertexId(sourceSha256,m.meshIndex,m.primitiveIndex,i)
 }));
 for(const op of physical.operations)for(let k=0;k<3;k++){
  const sourceAttributeVertex=m.indices[op.faceIndex*3+k];
  attributeRowProvenance.push({
   physicalAttributeVertex:attributeRowProvenance.length,
   sourceAttributeVertex,
   vertexId:vertexId(sourceSha256,m.meshIndex,m.primitiveIndex,
    sourceAttributeVertex)
  });
 }
 return{schema:'mark.editable-meshdata-binary/1',
  sourceSha256,meshIndex:m.meshIndex,primitiveIndex:m.primitiveIndex,
  persisted:true,standaloneBinary:true,bytes:m.data.length,
  supported:['source TRIANGLES','editable vertex POSITION',
   'verified-seam or unambiguous attribute vertex moves',
   'source face and corner IDs','UV0/UV1 per-corner Float32',
   'safe face/island UV translation',
   ...(m.normals?['area-weighted indexed vertex normals']:[])],
  uvSets:Object.keys(m.uv).map(x=>'TEXCOORD_'+x),
  faces,corners,vertices,attributeRowProvenance,
  edges:graph.edges,halfedges:graph.halfedges,
  diagnostics:{...graph.diagnostics,
   editableMeshData:true,storedAttributeVertices:m.vertices,
   faceCount:m.faces,uvSetCount:Object.keys(m.uv).length,
   uvCornerCount:corners.length,
   positionsEditable:true,
   normalsRecalculated:Boolean(m.normals),
   binaryVersion:m.version}};
}
function patchPhysicalPositions(edited,sourceGLB,m,ops){
 const original=sourceGeometry(sourceGLB,m.meshIndex,m.primitiveIndex);
 const changed=m.positions.some((p,i)=>p.some((v,k)=>
  v!==original.positions[i][k]));
 if(!changed)return edited;
 const src=parseGlb(sourceGLB),sourcePrim=src.json.meshes[m.meshIndex]
  .primitives[m.primitiveIndex],sourceAccessor=sourcePrim.attributes.POSITION;
 // A shared accessor could affect an unrelated glTF primitive. Do not
 // modify shared storage until first-class object datablock ownership exists.
 for(let mesh=0;mesh<src.json.meshes.length;mesh++)
  for(let primitive=0;primitive<src.json.meshes[mesh].primitives.length;primitive++)
   if(mesh!==m.meshIndex||primitive!==m.primitiveIndex)
    ok(src.json.meshes[mesh].primitives[primitive].attributes?.POSITION!==
     sourceAccessor,'SHARED_POSITION',
     'Other primitives sharing POSITION need explicit copy-before-edit support');
 const parsed=parseGlb(edited),doc=structuredClone(parsed.json),
  prim=doc.meshes[m.meshIndex].primitives[m.primitiveIndex],
  accessor=doc.accessors[prim.attributes.POSITION],
  view=doc.bufferViews[accessor.bufferView],
  originalChunk=parsed.chunks.find(c=>c.type===0x004e4942);
 ok(originalChunk&&accessor.type==='VEC3'&&
  accessor.componentType===5126&&!accessor.sparse&&
  !accessor.normalized&&view.buffer===0,
  'POSITION_EXPORT','Expected dense native glTF FLOAT POSITION stream');
 const allPositions=m.positions.map(row=>row.slice());
 for(const op of ops)for(let corner=0;corner<3;corner++)
  allPositions.push(m.positions[m.indices[op.faceIndex*3+corner]].slice());
 ok(accessor.count===allPositions.length,
  'POSITION_ROW_MAP','UV cloned rows differ from real mapped source vertex rows');
 const bin=originalChunk.data.slice(),
  data=new DataView(bin.buffer,bin.byteOffset,bin.byteLength),
  offset=(view.byteOffset||0)+(accessor.byteOffset||0),
  stride=view.byteStride??12;
 ok(stride>=12&&stride%4===0&&offset%4===0&&
  offset+(accessor.count-1)*stride+12<=
   Math.min(bin.byteLength,(view.byteOffset||0)+view.byteLength),
  'POSITION_ACCESSOR','Position patch would exceed accessor bounds');
 for(let i=0;i<allPositions.length;i++)
  for(let k=0;k<3;k++)
   data.setFloat32(offset+i*stride+k*4,allPositions[i][k],true);
 if(accessor.min||accessor.max){
  accessor.min=Array.from({length:3},(_,k)=>
   Math.min(...allPositions.map(row=>row[k])));
  accessor.max=Array.from({length:3},(_,k)=>
   Math.max(...allPositions.map(row=>row[k])));
 }
 const output=writeGlb({...parsed,chunks:parsed.chunks.map(c=>
  c.type===0x004e4942?{...c,data:bin}:c)},doc);
 const verified=sourceGeometry(output,m.meshIndex,m.primitiveIndex);
 ok(verified.positions.length===allPositions.length&&
  verified.positions.every((row,i)=>row.every((v,k)=>v===allPositions[i][k])),
  'POSITION_VERIFY','Exported GLB position rows disagree with MeshData');
 return output;
}
function patchPhysicalNormals(edited,sourceGLB,m,uvOps){
 if(!m.normals)return edited;
 const source=parseGlb(sourceGLB),docSource=source.json,
  primitiveSource=docSource.meshes[m.meshIndex].primitives[m.primitiveIndex],
  originalAccessor=primitiveSource.attributes.NORMAL;
 ok(Number.isSafeInteger(originalAccessor),
  'NORMAL_EXPORT','Source does not contain a writable NORMAL stream');
 // No unannounced mutation of another primitive sharing the source NORMAL.
 for(let mesh=0;mesh<docSource.meshes.length;mesh++)
  for(let primitive=0;primitive<docSource.meshes[mesh].primitives.length;primitive++)
   if(mesh!==m.meshIndex||primitive!==m.primitiveIndex)
    ok(docSource.meshes[mesh].primitives[primitive].attributes?.NORMAL!==
     originalAccessor,'SHARED_NORMAL',
     'NORMAL accessor shared by another primitive: explicit ownership required');
 const parsed=parseGlb(edited),doc=structuredClone(parsed.json),
  primitive=doc.meshes[m.meshIndex].primitives[m.primitiveIndex],
  accessor=doc.accessors[primitive.attributes.NORMAL],
  view=doc.bufferViews[accessor.bufferView],
  chunk=parsed.chunks.find(c=>c.type===0x004e4942);
 ok(chunk&&accessor.type==='VEC3'&&accessor.componentType===5126&&
  !accessor.sparse&&!accessor.normalized&&view.buffer===0,
  'NORMAL_EXPORT_PROFILE','Only dense float32 VEC3 NORMAL can be recalculated');
 const allNormals=m.normals.map(n=>n.slice());
 for(const op of uvOps)for(let k=0;k<3;k++)
  allNormals.push(m.normals[m.indices[op.faceIndex*3+k]].slice());
 ok(accessor.count===allNormals.length,
  'NORMAL_ROW_MAP','Indexed normal rows do not match physical UV COW clones');
 const bin=chunk.data.slice(),dv=new DataView(bin.buffer),
  start=(view.byteOffset||0)+(accessor.byteOffset||0),
  stride=view.byteStride??12;
 ok(start%4===0&&stride>=12&&stride%4===0&&
  start+(accessor.count-1)*stride+12<=
   Math.min(bin.byteLength,(view.byteOffset||0)+view.byteLength),
  'NORMAL_ACCESSOR_RANGE','glTF NORMAL accessor would escape its bufferView');
 for(let i=0;i<allNormals.length;i++)for(let k=0;k<3;k++)
  dv.setFloat32(start+i*stride+k*4,allNormals[i][k],true);
 if(accessor.min||accessor.max){
  accessor.min=Array.from({length:3},(_,axis)=>
   Math.min(...allNormals.map(n=>n[axis])));
  accessor.max=Array.from({length:3},(_,axis)=>
   Math.max(...allNormals.map(n=>n[axis])));
 }
 const output=writeGlb({...parsed,chunks:parsed.chunks.map(c=>
  c.type===0x004e4942?{...c,data:bin}:c)},doc);
 const physical=sourceGeometry(output,m.meshIndex,m.primitiveIndex);
 ok(physical.normals?.length===allNormals.length&&
  physical.normals.every((n,i)=>n.every((x,k)=>x===allNormals[i][k])),
  'NORMAL_VERIFY','Actual GLB normal accessor differs from MeshData binary');
 return output;
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
 const positioned=patchPhysicalPositions(edited,sourceGLB,m,ops),
  shaded=patchPhysicalNormals(positioned,sourceGLB,m,ops);
 // Verify both UV sets in the physical export actually match datablock.
 if(ops.length){
  const graph=buildMeshDataSnapshot({sourceGLB,editedGLB:shaded,
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
 return{glb:shaded,operations:ops,
  normalsRecalculated:Boolean(m.normals),
  movedVertices:m.positions.filter((p,i)=>
   p.some((v,k)=>v!==original.positions[i][k])).length};
}
