/**
 * MARK Professional Studio / Pass 7 / EXPERIMENTAL actual indexed triangle
 * Mesh Edit core. Edits REAL glTF binary accessors (not node transforms).
 *
 * Supported ops: vertex.move, edge.split, face.flip, face.delete.
 * Current profile: glTF 2.0 GLB, BIN-only, indexed TRIANGLES, dense accessors,
 * 5126 floats for vertex attributes, JOINTS_0 Uint8/16, WEIGHTS_0 Float32.
 * Sparse/Draco/interleaved targets are REJECTED with structured diagnostics.
 * One operation modifies only the selected mesh primitive; cloned accessors
 * are appended to a new BIN buffer. Original source GLB bytes never mutated.
 * Real rig bind matrices, animations and image buffers survive byte-for-byte.
 */
import {parseGlb,writeGlb,assertSelfContainedGlb} from '../glb.js';
const MAX_BYTES=64*1024*1024,MAX_VERTICES=500000,MAX_INDICES=3000000;
const TYPES={SCALAR:1,VEC2:2,VEC3:3,VEC4:4,MAT2:4,MAT3:9,MAT4:16};
const COMPONENTS={5121:[1,'getUint8','setUint8'],5123:[2,'getUint16','setUint16'],
 5125:[4,'getUint32','setUint32'],5126:[4,'getFloat32','setFloat32']};
const align4=x=>(x+3)&~3;
const failure=(code,message)=>{const e=Error('MARK_MESH_'+code+': '+message);e.code='MESH_'+code;throw e;};
const guard=(yes,code,reason)=>{if(!yes)failure(code,reason);};
const nat=x=>Number.isSafeInteger(x)&&x>=0;
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const bytes=x=>x instanceof ArrayBuffer?new Uint8Array(x):
 ArrayBuffer.isView(x)?new Uint8Array(x.buffer,x.byteOffset,x.byteLength):
 failure('BINARY','Expected GLB Uint8Array');
const clone=x=>structuredClone(x);

function begin(input){
 const data=bytes(input);
 guard(data.length>0&&data.length<=MAX_BYTES,'SIZE','GLB exceeds 64MiB budget');
 const parsed=parseGlb(data),doc=clone(parsed.json);
 assertSelfContainedGlb(doc);
 guard(!doc.extensionsRequired?.length,'REQUIRED_EXTENSION','Required compressed extensions not implemented');
 guard(doc.buffers?.length===1&&doc.buffers[0].uri===undefined,
  'BUFFER_PROFILE','Only one BIN buffer GLB is supported');
 const bin=parsed.chunks.find(c=>c.type===0x004e4942)?.data;
 guard(bin&&doc.buffers[0].byteLength<=bin.length,'BIN','Invalid BIN chunk');
 return{parsed,doc,bin:bin.slice(0,doc.buffers[0].byteLength)};
}
function target(ctx,meshIndex,primitiveIndex){
 guard(nat(meshIndex)&&nat(primitiveIndex),'TARGET','Mesh and primitive indices must be natural');
 const mesh=ctx.doc.meshes?.[meshIndex],primitive=mesh?.primitives?.[primitiveIndex];
 guard(primitive,'TARGET','Mesh primitive not found');
 guard((primitive.mode??4)===4,'TRIANGLES','Only triangle primitives supported');
 guard(primitive.indices!==undefined,'INDICES','Only indexed triangles supported');
 guard(primitive.attributes?.POSITION!==undefined,'POSITIONS','Missing POSITION');
 return primitive;
}
function read(ctx,index){
 const a=ctx.doc.accessors?.[index],v=ctx.doc.bufferViews?.[a?.bufferView];
 guard(a&&v&&!a.sparse&&v.buffer===0,'ACCESSOR','Unsupported external/sparse/accessor');
 const type=TYPES[a.type],c=COMPONENTS[a.componentType];
 guard(type&&c&&nat(a.count)&&a.count<=MAX_INDICES,'ACCESSOR','Invalid count/type');
 guard(!a.normalized||a.componentType===5126,'NORMALIZED',
  'Normalized integer attribute editing not yet supported');
 const unit=c[0],element=unit*type,stride=v.byteStride??element;
 const start=(v.byteOffset||0)+(a.byteOffset||0);
 guard(start%unit===0&&stride%unit===0&&stride>=element&&
  start+(a.count?((a.count-1)*stride+element):0)<=ctx.bin.length,
  'ACCESSOR_RANGE','Invalid accessor byte range');
 const dv=new DataView(ctx.bin.buffer,ctx.bin.byteOffset,ctx.bin.byteLength);
 const value=[];
 for(let i=0;i<a.count;i++){
  const row=[];
  for(let j=0;j<type;j++)row.push(dv[c[1]](start+i*stride+j*unit,true));
  value.push(row);
 }
 return {value,type:a.type,componentType:a.componentType,count:a.count,
  min:a.min,max:a.max};
}
function append(ctx,data,{type,componentType,target:usage}){
 const c=COMPONENTS[componentType],components=TYPES[type];
 guard(c&&components&&data.length<=MAX_INDICES&&
  data.every(row=>Array.isArray(row)&&row.length===components&&row.every(finite)),
  'WRITE_DATA','Invalid output accessor values');
 const needed=data.length*components*c[0],offset=align4(ctx.bin.length);
 guard(offset+needed<=MAX_BYTES,'MEMORY','Edited mesh exceeds 64MiB');
 const next=new Uint8Array(offset+needed);
 next.set(ctx.bin);const dv=new DataView(next.buffer);
 for(let i=0;i<data.length;i++)for(let j=0;j<components;j++){
  const value=data[i][j],where=offset+(i*components+j)*c[0];
  if(componentType!==5126)guard(nat(value)&&value<=
   (componentType===5121?255:componentType===5123?65535:4294967295),
   'COMPONENT_OVERFLOW','Value outside integer range');
  dv[c[2]](where,value,true);
 }
 const viewIndex=ctx.doc.bufferViews.length;
 ctx.doc.bufferViews.push({buffer:0,byteOffset:offset,byteLength:needed,
  ...(usage===undefined?{}:{target:usage})});
 const accIndex=ctx.doc.accessors.length;
 const meta={bufferView:viewIndex,byteOffset:0,componentType,
  count:data.length,type};
 if(type==='VEC3'&&componentType===5126&&data.length&&usage===34962){
  // glTF POSITION accessors require min/max after geometry editing.
  meta.min=[0,1,2].map(axis=>Math.min(...data.map(row=>row[axis])));
  meta.max=[0,1,2].map(axis=>Math.max(...data.map(row=>row[axis])));
 }
 ctx.doc.accessors.push(meta);ctx.bin=next;return accIndex;
}
function indices(ctx,primitive){
 const idx=read(ctx,primitive.indices);
 guard(idx.type==='SCALAR'&&[5121,5123,5125].includes(idx.componentType)&&
  idx.count%3===0&&idx.count>=3,
  'INDEX_PROFILE','Triangle indices must be an unsigned indexed triple list');
 const pos=read(ctx,primitive.attributes.POSITION);
 guard(pos.componentType===5126&&pos.type==='VEC3'&&pos.count>=3&&
  pos.count<=MAX_VERTICES,'POSITION_PROFILE',
  'Only bounded float32 VEC3 POSITION supported');
 const values=idx.value.map(a=>a[0]);
 guard(values.every(i=>nat(i)&&i<pos.count),'INDEX_RANGE','Invalid index value');
 return {values,positions:pos.value};
}
function writeIndices(ctx,prim,values,componentType){
 guard(values.length>=3&&values.length%3===0&&values.length<=MAX_INDICES,
  'FACE_COUNT','Indexed triangle mesh cannot become empty');
 const max=Math.max(...values);
 const type=max>65535?5125:max>255?5123:componentType;
 prim.indices=append(ctx,values.map(n=>[n]),{type:'SCALAR',
  componentType:type===5121&&max>255?5123:type,target:34963});
}
const vec=(a,size)=>Array.isArray(a)&&a.length===size&&
 a.every(x=>finite(x)&&Math.abs(x)<10000);
function meshStatistics(input,meshIndex=0,primitiveIndex=0){
 const ctx=begin(input),prim=target(ctx,meshIndex,primitiveIndex);
 const {values,positions}=indices(ctx,prim),edges=new Set(),used=new Set();
 let bad=0;
 for(let i=0;i<values.length;i+=3){
  const a=values[i],b=values[i+1],c=values[i+2];
  used.add(a);used.add(b);used.add(c);
  const va=positions[a],vb=positions[b],vc=positions[c];
  const ab=vb.map((x,j)=>x-va[j]),ac=vc.map((x,j)=>x-va[j]);
  const area=Math.hypot(ab[1]*ac[2]-ab[2]*ac[1],
   ab[2]*ac[0]-ab[0]*ac[2],ab[0]*ac[1]-ab[1]*ac[0]);
  if(area<1e-9)bad++;
  for(const pair of [[a,b],[b,c],[c,a]])edges.add(pair.sort((x,y)=>x-y).join(':'));
 }
 return {meshIndex,primitiveIndex,vertexCount:positions.length,
  triangleCount:values.length/3,edgeCount:edges.size,
  unusedVertexCount:positions.length-used.size,
  degenerateTriangles:bad,skinNodes:(ctx.doc.nodes||[]).filter(n=>n.mesh===meshIndex&&n.skin!==undefined).length,
  morphTargets:prim.targets?.length||0,topology:'indexed triangles; no n-gons'};
}
function editOnce(ctx,operation){
 guard(operation&&Object.getPrototypeOf(operation)===Object.prototype,
  'OPERATION','Expected typed mesh operation');
 const {kind,meshIndex,primitiveIndex}=operation;
 guard(['vertex.move','edge.split','face.flip','face.delete'].includes(kind),
  'OPERATION','Unsupported mesh edit operation');
 const prim=target(ctx,meshIndex,primitiveIndex);
 const {values,positions}=indices(ctx,prim);
 const oldIndex=read(ctx,prim.indices),count=positions.length;
 if(kind==='vertex.move'){
  guard(nat(operation.vertex)&&operation.vertex<count,
   'VERTEX','Selected vertex index out of range');
  guard(vec(operation.delta,3),'DELTA','Expected finite translation XYZ');
  const revised=positions.map(x=>x.slice());
  revised[operation.vertex]=revised[operation.vertex].map((x,j)=>x+operation.delta[j]);
  guard(revised[operation.vertex].every(x=>finite(x)&&Math.abs(x)<10000),
   'DELTA','Position out of bound');
  prim.attributes.POSITION=append(ctx,revised,
   {type:'VEC3',componentType:5126,target:34962});
  return {kind,changedVertices:1,addedVertices:0,addedTriangles:0};
 }
 if(kind==='face.flip'||kind==='face.delete'){
  const face=operation.face;
  guard(nat(face)&&face<values.length/3,'FACE','Selected face index out of range');
  if(kind==='face.delete')guard(values.length>3,
   'LAST_FACE','Cannot delete final triangle in this preview');
  const newer=values.slice();
  if(kind==='face.flip'){
   [newer[face*3+1],newer[face*3+2]]=[newer[face*3+2],newer[face*3+1]];
  }else newer.splice(face*3,3);
  writeIndices(ctx,prim,newer,oldIndex.componentType);
  return {kind,changedVertices:0,addedVertices:0,
   addedTriangles:kind==='face.delete'?-1:0};
 }
 // Exact split of an edge and ALL incident indexed triangles. Each original
 // triangle [a,b,c] becomes 2, winding preserved and links remain valid.
 const a=operation.start,b=operation.end,t=operation.factor??.5;
 guard(nat(a)&&nat(b)&&a<count&&b<count&&a!==b,
  'EDGE','Invalid endpoints');
 guard(finite(t)&&t>0&&t<1,'FACTOR','Edge interpolation factor must be (0,1)');
 const affected=[];
 for(let face=0;face<values.length/3;face++){
  const tri=values.slice(face*3,face*3+3);
  const i=tri.indexOf(a),j=tri.indexOf(b);
  if(i!==-1&&j!==-1)affected.push(face);
 }
 guard(affected.length>0,'EDGE_NOT_FOUND','Mesh has no face sharing the selected edge');
 guard(affected.length<=8,'NONMANIFOLD','Edge touches >8 faces; split refused in preview');
 guard(count+1<=MAX_VERTICES&&values.length+affected.length*3<=MAX_INDICES,
  'TOPOLOGY_LIMIT','Vertex or triangle resource budget exceeded');
 const newIndex=count;
 // Interpolate ALL source vertex streams, including UV and morph deltas.
 // Joint influences are merged and renormalized to max four for JOINTS_0,
 // WEIGHTS_0. No silent destruction of target morph streams.
 const attributeValues={};
 for(const [attr,index] of Object.entries(prim.attributes)){
  const src=read(ctx,index);
  guard(src.count===count,'SHARED_ACCESSOR','Vertex attribute count mismatch');
  guard(src.componentType===5126||attr==='JOINTS_0'&&
   [5121,5123].includes(src.componentType),'ATTRIBUTE_PROFILE',
   'Editing '+attr+' requires float attribute or integer joints');
  attributeValues[attr]=src;
 }
 if(attributeValues.JOINTS_0||attributeValues.WEIGHTS_0){
  guard(attributeValues.JOINTS_0&&attributeValues.WEIGHTS_0,
   'SKIN_ATTRIBUTES','JOINTS_0 and WEIGHTS_0 must both be present');
 }
 let skinJoint=null,skinWeight=null;
 if(attributeValues.JOINTS_0){
  const joints=attributeValues.JOINTS_0.value,weights=attributeValues.WEIGHTS_0.value;
  guard(joints[a].length===4&&joints[b].length===4&&
   weights[a].length===4&&weights[b].length===4,
   'SKIN_PROFILE','Only four influences per vertex are supported');
  const influence=new Map();
  for(const [vertex,factor] of [[a,1-t],[b,t]]){
   for(let i=0;i<4;i++){
    const w=weights[vertex][i]*factor,j=joints[vertex][i];
    influence.set(j,(influence.get(j)||0)+w);
   }
  }
  const sorted=[...influence].filter(([,w])=>w>0)
   .sort((x,y)=>y[1]-x[1]||x[0]-y[0]).slice(0,4);
  const total=sorted.reduce((s,[,w])=>s+w,0);
  guard(total>0,'SKIN_WEIGHTS','Interpolated skin weights are zero');
  skinJoint=Array.from({length:4},(_,i)=>sorted[i]?.[0]??0);
  skinWeight=Array.from({length:4},(_,i)=>(sorted[i]?.[1]||0)/total);
 }
 for(const [attr,src] of Object.entries(attributeValues)){
  const left=src.value[a],right=src.value[b];
  const merged=attr==='JOINTS_0'?skinJoint:attr==='WEIGHTS_0'?skinWeight:
   left.map((x,j)=>x*(1-t)+right[j]*t);
  const array=[...src.value.map(x=>x.slice()),merged];
  if(attr==='NORMAL'||attr==='TANGENT'){
   const limit=attr==='TANGENT'?3:array[newIndex].length;
   const norm=Math.hypot(...array[newIndex].slice(0,limit));
   if(norm>1e-9)for(let i=0;i<limit;i++)array[newIndex][i]/=norm;
  }
  prim.attributes[attr]=append(ctx,array,{type:src.type,componentType:src.componentType,
   target:34962});
 }
 for(const targets of prim.targets||[]){
  for(const [name,index] of Object.entries(targets)){
   const src=read(ctx,index);
   guard(src.componentType===5126&&src.count===count,
    'MORPH_PROFILE','Expected dense float morph delta, one per old vertex');
   const interpolation=src.value[a].map((x,j)=>x*(1-t)+src.value[b][j]*t);
   targets[name]=append(ctx,[...src.value,interpolation],{
    type:src.type,componentType:5126,target:34962
   });
  }
 }
 const newer=[];
 for(let face=0;face<values.length/3;face++){
  const tri=values.slice(face*3,face*3+3);
  if(!affected.includes(face)){newer.push(...tri);continue;}
  const ai=tri.indexOf(a),bi=tri.indexOf(b);
  // Orient by the order in which the endpoints occur on this triangle.
  // [a,b,c] -> [a,m,c],[m,b,c] ; reversed directed edge is symmetric.
  let from,to,third;
  if((ai+1)%3===bi){from=a;to=b;third=tri[(bi+1)%3];}
  else {from=b;to=a;third=tri[(ai+1)%3];}
  newer.push(from,newIndex,third,newIndex,to,third);
 }
 writeIndices(ctx,prim,newer,oldIndex.componentType);
 return {kind,newVertexIndex:newIndex,changedVertices:0,
  addedVertices:1,addedTriangles:affected.length};
}
export function applyMeshOperations(input,operations=[]){
 guard(Array.isArray(operations)&&operations.length<=64,
  'OPS_BUDGET','Up to 64 typed mesh operations per native scene');
 if(operations.length===0)return bytes(input).slice();
 let current=bytes(input).slice();
 for(let i=0;i<operations.length;i++){
  const ctx=begin(current);
  try{editOnce(ctx,operations[i]);}
  catch(e){if(e.code)throw e;throw Error('Mesh op '+i+': '+e.message);}
  ctx.doc.buffers[0].byteLength=ctx.bin.length;
  const padded=new Uint8Array(align4(ctx.bin.length));padded.set(ctx.bin);
  const chunks=ctx.parsed.chunks.map(c=>c.type===0x004e4942?
   {type:c.type,data:padded}:c);
  current=writeGlb({...ctx.parsed,chunks},ctx.doc);
  guard(current.length<=MAX_BYTES,'OUTPUT_BUDGET','Edited GLB exceeds budget');
 }
 return current;
}
export function getMeshEditStats(input,meshIndex=0,primitiveIndex=0,operations=[]){
 return meshStatistics(applyMeshOperations(input,operations),meshIndex,primitiveIndex);
}
export function validateMeshOperation(input,operations,operation){
 const original=operations||[];
 const all=[...original,clone(operation)];
 const edited=applyMeshOperations(input,all);
 return {operations:all,stats:meshStatistics(edited,
  operation.meshIndex,operation.primitiveIndex),bytes:edited.length};
}
