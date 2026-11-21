/**
 * MARK Professional Studio / Pass 7 / EXPERIMENTAL actual indexed triangle
 * Mesh Edit core. Edits REAL glTF binary accessors (not node transforms).
 *
 * Supported ops: vertex.move, vertex.snap, edge.split, face.flip, face.delete,
 * face.extrude (individual triangle), face.regionExtrude (disk-only),
 * face.regionExtrudeLinked (explicit UV-seam / one-shot operation),
 * normal.recalculate, primitive.add.
 * Current profile: glTF 2.0 GLB, BIN-only, indexed TRIANGLES, dense accessors,
 * 5126 floats for vertex attributes, JOINTS_0 Uint8/16, WEIGHTS_0 Float32.
 * Sparse/Draco/interleaved targets are REJECTED with structured diagnostics.
 * One operation modifies only the selected mesh primitive; cloned accessors
 * are appended to a new BIN buffer. Original source GLB bytes never mutated.
 * Real rig bind matrices, animations and image buffers survive byte-for-byte.
 */
import {parseGlb,writeGlb,assertSelfContainedGlb} from '../glb.js';
import {primitiveGeometry} from './primitive-geometry.js';
import {normalizeExplicitSeamLinks} from './mesh-seam-identity.js';
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
  const lower=[Infinity,Infinity,Infinity],upper=[-Infinity,-Infinity,-Infinity];
  for(const row of data)for(let axis=0;axis<3;axis++){
   lower[axis]=Math.min(lower[axis],row[axis]);
   upper[axis]=Math.max(upper[axis],row[axis]);
  }
  meta.min=lower;meta.max=upper;
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
 let max=0;for(const n of values){if(n>max)max=n;}
 const type=max>65535?5125:max>255?5123:componentType;
 prim.indices=append(ctx,values.map(n=>[n]),{type:'SCALAR',
  componentType:type===5121&&max>255?5123:type,target:34963});
}
const vec=(a,size)=>Array.isArray(a)&&a.length===size&&
 a.every(x=>finite(x)&&Math.abs(x)<10000);
function meshStatistics(input,meshIndex=0,primitiveIndex=0){
 const ctx=begin(input),prim=target(ctx,meshIndex,primitiveIndex);
 const {values,positions}=indices(ctx,prim),edges=new Set(),used=new Set();
 const edgeIncidence=new Map(),faceKeys=new Set();
 let bad=0,duplicateFaces=0;
 for(let i=0;i<values.length;i+=3){
  const a=values[i],b=values[i+1],c=values[i+2];
  used.add(a);used.add(b);used.add(c);
  const va=positions[a],vb=positions[b],vc=positions[c];
  const ab=vb.map((x,j)=>x-va[j]),ac=vc.map((x,j)=>x-va[j]);
  const area=Math.hypot(ab[1]*ac[2]-ab[2]*ac[1],
   ab[2]*ac[0]-ab[0]*ac[2],ab[0]*ac[1]-ab[1]*ac[0]);
  if(area<1e-9)bad++;
  const faceKey=[a,b,c].sort((x,y)=>x-y).join(':');
  if(faceKeys.has(faceKey))duplicateFaces++;else faceKeys.add(faceKey);
  for(const [from,to] of [[a,b],[b,c],[c,a]]){
   const key=Math.min(from,to)+':'+Math.max(from,to);
   edges.add(key);
   const entry=edgeIncidence.get(key)||{count:0,directions:[]};
   entry.count++;entry.directions.push(from<to?1:-1);edgeIncidence.set(key,entry);
  }
 }
 const boundaryEdges=[...edgeIncidence.values()].filter(e=>e.count===1).length;
 const nonManifoldEdges=[...edgeIncidence.values()].filter(e=>e.count>2).length;
 const conflictingWindingEdges=[...edgeIncidence.values()].filter(e=>
  e.count===2&&e.directions[0]===e.directions[1]).length;
 return {meshIndex,primitiveIndex,vertexCount:positions.length,
  triangleCount:values.length/3,edgeCount:edges.size,
  boundaryEdges,nonManifoldEdges,conflictingWindingEdges,duplicateFaces,
  unusedVertexCount:positions.length-used.size,
  degenerateTriangles:bad,skinNodes:(ctx.doc.nodes||[]).filter(n=>n.mesh===meshIndex&&n.skin!==undefined).length,
  morphTargets:prim.targets?.length||0,topology:'indexed triangles; no n-gons'};
}
function editOnce(ctx,operation,linkedSource=null){
 guard(operation&&Object.getPrototypeOf(operation)===Object.prototype,
  'OPERATION','Expected typed mesh operation');
 const {kind,meshIndex,primitiveIndex}=operation;
 guard(['vertex.move','edge.split','face.flip','face.delete',
  'normal.recalculate','primitive.add','vertex.snap','face.extrude',
  'face.regionExtrude','face.regionExtrudeLinked','vertex.moveLinkedCap',
  'face.pokeLinkedCap','edge.splitPokedCap',
  'edge.splitPokedCapChild','edge.splitPokedCapGrandchild',
  'uv.offsetFaceCorners'].includes(kind),
  'OPERATION','Unsupported mesh edit operation');
 if(kind==='primitive.add'){
  const geometry=primitiveGeometry({
   shape:operation.shape,size:operation.size??1,segments:operation.segments??12
  });
  const attributes={
   POSITION:append(ctx,geometry.position,{
    type:'VEC3',componentType:5126,target:34962}),
   NORMAL:append(ctx,geometry.normal,{
    type:'VEC3',componentType:5126,target:34962}),
   TEXCOORD_0:append(ctx,geometry.uv,{
    type:'VEC2',componentType:5126,target:34962})
  };
  const indicesAccessor=append(ctx,geometry.index.map(v=>[v]),{
   type:'SCALAR',componentType:5123,target:34963
  });
  ctx.doc.materials||=[];
  if(!ctx.doc.materials.length)ctx.doc.materials.push({
   name:'MARK Default PBR Material',doubleSided:true,
   pbrMetallicRoughness:{
    baseColorFactor:[.65,.73,.85,1],metallicFactor:.1,roughnessFactor:.6
   }
  });
  const mat=operation.materialIndex??0;
  guard(nat(mat)&&mat<ctx.doc.materials.length,
   'MATERIAL','Primitive material index is invalid');
  ctx.doc.meshes||=[];ctx.doc.nodes||=[];ctx.doc.scenes||=[{nodes:[]}];
  const createdMeshIndex=ctx.doc.meshes.length;
  ctx.doc.meshes.push({name:geometry.name,
   primitives:[{attributes,indices:indicesAccessor,material:mat,mode:4}]});
  const createdNodeIndex=ctx.doc.nodes.length;
  ctx.doc.nodes.push({
   name:geometry.name+' node '+createdMeshIndex,mesh:createdMeshIndex,
   // New objects are spaced apart by default; otherwise a small sphere
   // added into a box would be invisible until the user edits transforms.
   translation:[createdMeshIndex===0?0:
    createdMeshIndex*((operation.size??1)+.6),0,0]
  });
  const sceneIdx=ctx.doc.scene??0;
  guard(ctx.doc.scenes[sceneIdx]&&Array.isArray(ctx.doc.scenes[sceneIdx].nodes),
   'SCENE_GRAPH','Cannot attach primitive to invalid active scene');
  ctx.doc.scenes[sceneIdx].nodes.push(createdNodeIndex);
  return {kind,meshIndex:createdMeshIndex,nodeIndex:createdNodeIndex,
   addedVertices:geometry.position.length,
   addedTriangles:geometry.index.length/3};
 }
 const prim=target(ctx,meshIndex,primitiveIndex);
 const {values,positions}=indices(ctx,prim);
 const oldIndex=read(ctx,prim.indices),count=positions.length;
 if(kind==='uv.offsetFaceCorners'){
  // First persistent UV per-corner editing profile. Source face IDs and
  // corner IDs remain stable; all 3 triangle corners get independent
  // glTF attribute rows so NO shared UV, skin or morph data is mutated.
  // Geometry indices remain triangle-order stable for subsequent UV edits.
  guard(!linkedSource,'UV_TOPOLOGY_PROFILE',
   'UV face-corner editing currently requires source-only topology');
  const allowed=['kind','meshIndex','primitiveIndex','faceIndex','uvSet','delta'];
  guard(Object.keys(operation).length===allowed.length&&
   allowed.every(k=>Object.hasOwn(operation,k)),
   'UV_FIELDS','Exact typed UV operation required');
  const {faceIndex,uvSet,delta}=operation;
  guard(nat(faceIndex)&&faceIndex<values.length/3&&
   nat(uvSet)&&uvSet<=1&&Array.isArray(delta)&&delta.length===2&&
   delta.every(x=>finite(x)&&Math.abs(x)<=1)&&
   Math.hypot(...delta)>1e-8,
   'UV_ARGS','Valid face, UV0/UV1 and nonzero bounded delta required');
  const semantic='TEXCOORD_'+uvSet;
  guard(Object.hasOwn(prim.attributes,semantic),
   'UV_SET','Target UV set not present in physical GLB');
  const uv=read(ctx,prim.attributes[semantic]);
  guard(uv.type==='VEC2'&&uv.componentType===5126&&
   uv.count===count,
   'UV_PROFILE','Dense float32 VEC2 UV stream required');
  guard(count+3<=MAX_VERTICES,'UV_BUDGET',
   'Copy-on-write UV corner rows exceed vertex budget');
  const start=faceIndex*3,parents=values.slice(start,start+3),
   childRows=[count,count+1,count+2];
  guard(new Set(parents).size===3,'UV_FACE',
   'Degenerate indexed triangle cannot be UV-edited safely');
  // Clone EVERY vertex stream and morph stream. This preserves JOINTS,
  // WEIGHTS, POSITION, normals, tangents and texture UV1 unchanged,
  // except the selected UV set in three newly appended rows.
  for(const [name,accessor] of Object.entries({...prim.attributes})){
   const stream=read(ctx,accessor);
   guard(stream.count===count,'UV_ATTRIBUTE_COUNT',
    'All vertex streams must have matching dense attribute rows');
   // For this initial profile require lossless copyable component types.
   guard([5121,5123,5125,5126].includes(stream.componentType)&&
    stream.value.every(row=>row.every(finite)),
    'UV_ATTRIBUTE','Unsupported vertex stream');
   const additions=parents.map(row=>{
    const x=stream.value[row].slice();
    if(name===semantic)for(let j=0;j<2;j++){
     x[j]+=delta[j];
     guard(finite(x[j])&&Math.abs(x[j])<=1e4,
      'UV_RANGE','UV translation creates invalid coordinates');
    }
    return x;
   });
   prim.attributes[name]=append(ctx,[...stream.value,...additions],{
    type:stream.type,componentType:stream.componentType,target:34962});
  }
  for(const morph of prim.targets||[])
   for(const [name,accessor] of Object.entries({...morph})){
    const stream=read(ctx,accessor);
    guard(stream.count===count&&stream.componentType===5126&&
     ['POSITION','NORMAL','TANGENT'].includes(name),
     'UV_MORPH','Unsupported morph target stream profile');
    morph[name]=append(ctx,[
     ...stream.value,...parents.map(i=>stream.value[i].slice())
    ],{type:stream.type,componentType:stream.componentType,target:34962});
   }
  const newer=values.slice();
  newer.splice(start,3,...childRows);
  writeIndices(ctx,prim,newer,oldIndex.componentType);
  return{kind,faceIndex,uvSet,delta:delta.slice(),
   previousAttributeRows:parents,newAttributeRows:childRows,
   addedVertices:3,addedTriangles:0,preservedFaceAndCornerIds:true};
 }
 if(['edge.splitPokedCap','edge.splitPokedCapChild',
  'edge.splitPokedCapGrandchild'].includes(kind)){
  const child=kind==='edge.splitPokedCapChild',
   grandchild=kind==='edge.splitPokedCapGrandchild';
  // Primary: up to eight distinct source-face splits. Child: at most one
  // terminal re-split of the daughter edge joining source cap and midpoint.
  // Both incident cap triangles
  // share identical attribute rows for its endpoints; no UV-seam welding,
  // no T-junction, and no lossy truncation of skin weights.
  guard(linkedSource?.operation?.kind==='face.regionExtrudeLinked'&&
   Array.isArray(linkedSource.pokes)&&linkedSource.pokes.length>=1,
   'RADIAL_CONTEXT','Split needs previous validated source cap Poke');
  guard(Object.keys(operation).length===5&&
   ['kind','meshIndex','primitiveIndex','sourceFace','sourceVertex']
    .every(k=>Object.hasOwn(operation,k)),'RADIAL_FIELDS',
   'Radial split requires exact source face and cap vertex provenance');
  const {sourceFace,sourceVertex}=operation,
   pokeIndex=linkedSource.pokes.findIndex(p=>p.sourceFace===sourceFace);
  guard(nat(sourceFace)&&nat(sourceVertex)&&pokeIndex>=0,
   'RADIAL_SOURCE','Source face has not been Poked');
  const tri=linkedSource.sourceFaceVertices.get(sourceFace);
  guard(tri?.includes(sourceVertex),'RADIAL_SOURCE',
   'Radial edge endpoint is not a verified source face corner');
  const capIndex=linkedSource.capSources.indexOf(sourceVertex);
  guard(capIndex>=0,'RADIAL_CAP','Unknown canonical cap attribute row');
  const splitOrdinal=linkedSource.splits.findIndex(op=>op===operation);
  const parentOrdinal=linkedSource.splits.findIndex(op=>
   op.sourceFace===sourceFace&&op.sourceVertex===sourceVertex);
  guard(grandchild?
   linkedSource.grandchildSplit===operation&&
    linkedSource.childSplit?.sourceFace===sourceFace&&
    linkedSource.childSplit?.sourceVertex===sourceVertex:
   child?linkedSource.childSplit===operation&&parentOrdinal>=0:
   splitOrdinal>=0,'RADIAL_SEQUENCE',
   'Split must belong to the approved source-bound radial lineage');
  // Before a primary split, count includes preceding primaries only;
  // after the full primary sequence, the parent midpoint is in the
  // source-linked split row suffix. No child index can alias a Poke center.
  const cap=linkedSource.sourceCount+capIndex,
   center=grandchild?count-1:
    child?count-linkedSource.splits.length+parentOrdinal:
    count-linkedSource.pokes.length-splitOrdinal+pokeIndex;
  guard(center>cap&&center<count,'RADIAL_LAYOUT',
   'Verified Poke center / existing parent midpoint row not found');
  const affected=[];
  for(let face=0;face<values.length/3;face++){
   const t=values.slice(face*3,face*3+3),i=t.indexOf(cap),j=t.indexOf(center);
   if(i>=0&&j>=0){
    const k=t.findIndex((v,index)=>v===cap&&t[(index+1)%3]===center||
     v===center&&t[(index+1)%3]===cap);
    guard(k>=0,'RADIAL_WINDING','Incident edge is not directed in its triangle');
    affected.push({face,tri:t,k,from:t[k],to:t[(k+1)%3],
     opposite:t[(k+2)%3]});
   }
  }
  guard(affected.length===2&&
   affected[0].from===affected[1].to&&
   affected[0].to===affected[1].from,
   'RADIAL_INCIDENCE','Expected exactly two oppositely oriented cap triangles');
  const wallFree=affected.every(e=>
   e.tri.every(v=>v>=linkedSource.sourceCount&&v<count));
  guard(wallFree,'RADIAL_FACE_PROFILE','Cannot split a side-wall or original face');
  guard(count+1<=MAX_VERTICES&&values.length+6<=MAX_INDICES,
   'RADIAL_BUDGET','New split vertex or two triangles exceed mesh budget');
  const midpoint=(a,b)=>a.map((v,i)=>(v+b[i])/2);
  const x=positions[cap],y=positions[center],point=midpoint(x,y);
  const cross=(a,b,c)=>{
   const u=b.map((v,k)=>v-a[k]),v=c.map((w,k)=>w-a[k]);
   return[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],
    u[0]*v[1]-u[1]*v[0]];
  };
  const newIndex=count,mergedSkin={};
  guard(!prim.attributes.TANGENT,
   'RADIAL_TANGENT','Precomputed tangents require accurate re-computation');
  for(const morph of prim.targets||[])
   guard(Object.keys(morph).every(k=>k==='POSITION'),
    'RADIAL_MORPH','Only POSITION morph deltas supported');
  if(prim.attributes.JOINTS_0!==undefined||
   prim.attributes.WEIGHTS_0!==undefined){
   guard(prim.attributes.JOINTS_0!==undefined&&
    prim.attributes.WEIGHTS_0!==undefined&&
    Object.keys(prim.attributes).every(name=>
     !/^(JOINTS|WEIGHTS)_[1-9][0-9]*$/.test(name)),
    'RADIAL_SKIN','Only complete JOINTS_0/WEIGHTS_0 supported');
   const j=read(ctx,prim.attributes.JOINTS_0),
    w=read(ctx,prim.attributes.WEIGHTS_0);
   guard(j.type==='VEC4'&&[5121,5123].includes(j.componentType)&&
    w.type==='VEC4'&&w.componentType===5126&&
    j.count===count&&w.count===count,
    'RADIAL_SKIN','Expected dense four-influence skin streams');
   const influences=new Map();
   for(const v of [cap,center]){
    const sum=w.value[v].reduce((n,k)=>n+k,0);
    guard(Math.abs(sum-1)<.02&&w.value[v].every(n=>n>=0&&finite(n)),
     'RADIAL_WEIGHT','Invalid source skin weight vector');
    for(let i=0;i<4;i++){
     const joint=j.value[v][i],weight=w.value[v][i]/2;
     influences.set(joint,(influences.get(joint)||0)+weight);
    }
   }
   const active=[...influences].filter(x=>x[1]>1e-7)
    .sort((a,b)=>b[1]-a[1]||a[0]-b[0]);
   guard(active.length>=1&&active.length<=4,
    'RADIAL_INFLUENCES',
    'Exact midpoint requires >4 bones; no lossy influence truncation allowed');
   const total=active.reduce((n,row)=>n+row[1],0);
   const joints=active.map(x=>x[0]),
    weights=active.map(x=>x[1]/total);
   while(joints.length<4){joints.push(0);weights.push(0);}
   mergedSkin.JOINTS_0=joints;mergedSkin.WEIGHTS_0=weights;
  }
  for(const [name,accessor] of Object.entries({...prim.attributes})){
   const stream=read(ctx,accessor);
   guard(stream.count===count,'RADIAL_ATTRIBUTE',
    'Source attribute count mismatch');
   let row;
   if(name==='POSITION')row=point;
   else if(name==='JOINTS_0'||name==='WEIGHTS_0')
    row=mergedSkin[name];
   else{
    guard(stream.componentType===5126&&
     ['SCALAR','VEC2','VEC3','VEC4'].includes(stream.type),
     'RADIAL_ATTRIBUTE','Only float corner UV/colors/normals interpolated');
    row=midpoint(stream.value[cap],stream.value[center]);
    if(name==='NORMAL'){
     guard(row.length===3,'RADIAL_NORMAL','Expected vec3 source normals');
     const mag=Math.hypot(...row);
     guard(mag>1e-9,'RADIAL_NORMAL','Opposed split normals cannot be merged');
     row=row.map(n=>n/mag);
    }
   }
   prim.attributes[name]=append(ctx,[...stream.value,row],{
    type:stream.type,componentType:stream.componentType,target:34962
   });
  }
  for(const morph of prim.targets||[])
   for(const [name,accessor] of Object.entries({...morph})){
    const stream=read(ctx,accessor);
    guard(name==='POSITION'&&stream.type==='VEC3'&&
     stream.componentType===5126&&stream.count===count,
     'RADIAL_MORPH','Only dense float32 POSITION morph accepted');
    morph[name]=append(ctx,[...stream.value,
     midpoint(stream.value[cap],stream.value[center])],{
     type:'VEC3',componentType:5126,target:34962
    });
   }
  const next=values.slice(),added=[];
  for(const e of affected){
   const replacement=e.tri.slice();
   replacement[(e.k+1)%3]=newIndex;
   const child=[];
   child[e.k]=newIndex;child[(e.k+1)%3]=e.to;
   child[(e.k+2)%3]=e.opposite;
   for(const t of [replacement,child]){
    const area=Math.hypot(...cross(...t.map(v=>
     v===newIndex?point:positions[v])));
    guard(area>1e-9,'RADIAL_DEGENERATE','Split creates zero-area triangle');
   }
   next.splice(e.face*3,3,...replacement);
   added.push(...child);
  }
  next.push(...added);
  writeIndices(ctx,prim,next,oldIndex.componentType);
  return{kind,sourceFace,sourceVertex,
   parentMidpointRow:child||grandchild?center:null,
   newVertexIndex:newIndex,
   parentFaceIndices:affected.map(x=>x.face),addedVertices:1,
   addedTriangles:2,splitIncidentFaces:2};
 }
 if(kind==='face.pokeLinkedCap'){
  // Each bounded source-cap face may be poked exactly once. Center rows
  // append in command order; original cap and wall attribute IDs do not move.
  // A true centroid row and two triangles are added per approved face.
  // No existing vertex/cap/wall indices are renumbered. This preserves all
  // pre-existing source-scoped IDs except corners/halfedges replaced in the
  // selected triangle. No T-junction: the point lies inside this triangle.
  guard(linkedSource?.operation?.kind==='face.regionExtrudeLinked',
   'POKE_CONTEXT','Poke requires a previously confirmed linked extrusion');
  guard(Object.keys(operation).length===4&&
   Object.keys(operation).every(k=>['kind','meshIndex','primitiveIndex',
    'sourceFace'].includes(k)),
   'POKE_FIELDS','Unexpected or missing cap poke fields');
  const sourceFace=operation.sourceFace,first=linkedSource.operation;
  guard(nat(sourceFace)&&first.faces.includes(sourceFace),
   'POKE_FACE','Poke target must be an original selected cap face');
  const capStart=linkedSource.sourceFaces-first.faces.length;
  const sortedFaces=[...first.faces].sort((a,b)=>a-b);
  const capFaceIndex=capStart+sortedFaces.indexOf(sourceFace);
  const face=values.slice(capFaceIndex*3,capFaceIndex*3+3);
  const [a,b,c]=face;
  const capStartVertex=linkedSource.sourceCount,
   capEndVertex=capStartVertex+linkedSource.capSources.length;
  guard(face.length===3&&face.every(i=>nat(i)&&
   i>=capStartVertex&&i<capEndVertex),
   'POKE_LAYOUT','Stable indexed cap triangle not found');
  guard(count+1<=MAX_VERTICES,'POKE_BUDGET','Vertex budget exceeded');
  const midpoint=rows=>rows[0].map((_,j)=>
   (rows[0][j]+rows[1][j]+rows[2][j])/3);
  const corners=face.map(i=>positions[i]),center=midpoint(corners);
  const cross=(x,y,z)=>{
   const u=y.map((n,j)=>n-x[j]),v=z.map((n,j)=>n-x[j]);
   return [u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],
    u[0]*v[1]-u[1]*v[0]];
  };
  const normal=cross(...corners),magnitude=Math.hypot(...normal);
  guard(magnitude>1e-9,'POKE_DEGENERATE',
   'Cannot subdivide a zero-area cap triangle');
  const unitNormal=normal.map(n=>n/magnitude);
  guard(!prim.attributes.TANGENT,
   'POKE_TANGENT','Precomputed tangent streams need a dedicated recompute');
  for(const target of prim.targets||[])
   guard(!Object.keys(target).some(k=>k!=='POSITION'),
    'POKE_MORPH','Only POSITION morph deltas supported in cap poke');
  // Skin centroid: accumulate the exact linear blend weights from each
  // corner, sum influences by joint ID, then represent WITHOUT truncation.
  // Fail closed if this would need >4 influences on a single glTF vertex.
  let blendedSkin=null;
  if(prim.attributes.JOINTS_0!==undefined||
   prim.attributes.WEIGHTS_0!==undefined){
   guard(prim.attributes.JOINTS_0!==undefined&&
    prim.attributes.WEIGHTS_0!==undefined&&
    Object.keys(prim.attributes).every(n=>
     !/^JOINTS_[1-9][0-9]*$|^WEIGHTS_[1-9][0-9]*$/.test(n)),
    'POKE_SKIN_PROFILE','Only JOINTS_0 / WEIGHTS_0 skin supported');
   const joints=read(ctx,prim.attributes.JOINTS_0),
    weights=read(ctx,prim.attributes.WEIGHTS_0);
   guard(joints.type==='VEC4'&&
    [5121,5123].includes(joints.componentType)&&
    weights.type==='VEC4'&&weights.componentType===5126&&
    joints.count===count&&weights.count===count,
    'POKE_SKIN_PROFILE','Expected dense four-influence skin attributes');
   const totals=new Map();
   for(const vertex of face){
    let sum=0;
    for(let k=0;k<4;k++){
     const w=weights.value[vertex][k];
     guard(finite(w)&&w>=0,'POKE_WEIGHT','Invalid skin influence');
     sum+=w;
     const joint=joints.value[vertex][k];
     totals.set(joint,(totals.get(joint)||0)+w/3);
    }
    guard(Math.abs(sum-1)<.02,'POKE_WEIGHT_NORMALIZATION',
     'Source skin weights must be normalized');
   }
   const ordered=[...totals].filter(([joint,w])=>w>1e-7)
    .sort((x,y)=>y[1]-x[1]||x[0]-y[0]);
   guard(ordered.length>0&&ordered.length<=4,
    'POKE_SKIN_INFLUENCES',
    'Centroid needs more than four bones; no lossy skin approximation');
   const total=ordered.reduce((n,row)=>n+row[1],0);
   const ji=ordered.map(x=>x[0]),wi=ordered.map(x=>x[1]/total);
   while(ji.length<4){ji.push(0);wi.push(0);}
   blendedSkin={joints:ji,weights:wi};
  }
  const attributes={...prim.attributes};
  for(const [semantic,accessor] of Object.entries(attributes)){
   const stream=read(ctx,accessor);
   guard(stream.count===count,'POKE_ATTRIBUTE',
    'Corner attribute count must match POSITION');
   let newRow;
   if(semantic==='POSITION')newRow=center;
   else if(semantic==='NORMAL'){
    guard(stream.type==='VEC3'&&stream.componentType===5126,
     'POKE_NORMAL','Only float32 face normals supported');
    newRow=unitNormal;
   }else if(semantic==='JOINTS_0')newRow=blendedSkin.joints;
   else if(semantic==='WEIGHTS_0')newRow=blendedSkin.weights;
   else{
    guard(stream.componentType===5126&&
     ['VEC2','VEC3','VEC4','SCALAR'].includes(stream.type),
     'POKE_ATTRIBUTE','Unsupported corner interpolation '+semantic);
    newRow=midpoint(face.map(i=>stream.value[i]));
   }
   prim.attributes[semantic]=append(ctx,[...stream.value,newRow],{
    type:stream.type,componentType:stream.componentType,target:34962
   });
  }
  for(const target of prim.targets||[]){
   for(const [semantic,accessor] of Object.entries(target)){
    guard(semantic==='POSITION','POKE_MORPH',
     'Only POSITION morph targets supported');
    const morph=read(ctx,accessor);
    guard(morph.type==='VEC3'&&morph.componentType===5126&&
     morph.count===count,'POKE_MORPH','Unsupported morph target');
    target[semantic]=append(ctx,[...morph.value,
     midpoint(face.map(i=>morph.value[i]))],{
     type:morph.type,componentType:morph.componentType,target:34962
    });
   }
  }
  const centerIndex=count,newIndices=values.slice();
  newIndices.splice(capFaceIndex*3,3,a,b,centerIndex);
  newIndices.push(b,c,centerIndex,c,a,centerIndex);
  writeIndices(ctx,prim,newIndices,oldIndex.componentType);
  return{kind,sourceFace,capFaceIndex,centerVertex:centerIndex,
   addedVertices:1,addedTriangles:2,skinInfluences:blendedSkin?
    blendedSkin.weights.filter(w=>w>0).length:0};
 }
 if(kind==='vertex.moveLinkedCap'){
  guard(Object.keys(operation).length===5&&
   Object.keys(operation).every(k=>['kind','meshIndex','primitiveIndex',
    'sourceVertex','delta'].includes(k)),
   'CAP_FIELDS','Unknown or omitted cap move fields');
  // Pass 18 narrow sequential vertex movement over the *already generated*
  // linked cap, preserving UV/skin/morph attributes and moving all wall
  // upper corners belonging to the same verified source logical vertex.
  guard(linkedSource&&linkedSource.operation?.kind==='face.regionExtrudeLinked',
   'CAP_CONTEXT','Cap move needs a verified first source extrusion');
  const {operation:first,sourceCount,sourceFaces,capSources}=linkedSource;
  const {sourceVertex,delta}=operation;
  guard(nat(sourceVertex)&&sourceVertex<sourceCount&&
   vec(delta,3)&&delta.every(n=>Math.abs(n)<=2)&&Math.hypot(...delta)>1e-8,
   'CAP_DELTA','Expected bounded nonzero cap translation');
  const parents=Array.from({length:sourceCount},(_,i)=>i);
  const find=i=>{while(parents[i]!==i)i=parents[i];return i;};
  for(const pair of first.links){
   const a=find(pair.vertexA),b=find(pair.vertexB);
   if(a!==b)parents[Math.max(a,b)]=Math.min(a,b);
  }
  const root=find(sourceVertex);
  guard(root===sourceVertex,
   'CAP_ROOT','Use canonical lowest source attribute index of linked cap');
  const group=capSources.filter(v=>find(v)===root);
  guard(group.length>=1,'CAP_NOT_SELECTED',
   'Stable source vertex is not a selected cap corner');
  const capCount=capSources.length,topStart=sourceCount+capCount;
  guard(count>=topStart&&(count-topStart)%4===0,
   'CAP_LAYOUT','Current mesh no longer matches source-to-cap layout');
  const capIndex=source=>sourceCount+capSources.indexOf(source);
  // Detect positional conflicts with *unlinked* groups before associating
  // side walls; do not infer new welds from accidental coordinate overlap.
  const key=row=>row.join(',');
  const capPositions=new Map();
  for(const source of capSources){
   const k=key(positions[capIndex(source)]),previous=capPositions.get(k);
   if(previous!==undefined)
    guard(previous===find(source),'CAP_AMBIGUOUS',
     'Unapproved coincident cap vertices prevent safe side-wall remapping');
   capPositions.set(k,find(source));
  }
  const moveSet=new Set(group.map(capIndex));
  const bottomIndices=[];
  for(let index=topStart;index<count;index+=4){
   const [bottomA,bottomB,topB,topA]=
    positions.slice(index,index+4);
   const lowerB=capPositions.get(key(topB)),
    lowerA=capPositions.get(key(topA));
   guard(lowerA!==undefined&&lowerB!==undefined,
    'CAP_WALL_MAP','Cannot link a side-wall top to a verified cap');
   if(lowerB===root)moveSet.add(index+2);
   if(lowerA===root)moveSet.add(index+3);
   bottomIndices.push(index);
  }
  const revised=positions.map(row=>row.slice());
  for(const index of moveSet)
   revised[index]=revised[index].map((value,k)=>value+delta[k]);
  guard([...moveSet].every(i=>revised[i].every(n=>
   finite(n)&&Math.abs(n)<10000)),
   'CAP_BOUNDS','Moved cap coordinates exceed safe domain');
  const normalIndex=prim.attributes.NORMAL;
  guard(normalIndex!==undefined,'CAP_NORMAL','Output needs float32 normals');
  const normalStream=read(ctx,normalIndex);
  guard(normalStream.type==='VEC3'&&normalStream.componentType===5126&&
   normalStream.count===count,'CAP_NORMAL','Unsupported output normals');
  const updatedNormals=normalStream.value.map(row=>row.slice());
  const cross=(a,b,c)=>{
   const u=b.map((x,k)=>x-a[k]),v=c.map((x,k)=>x-a[k]);
   return[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],
    u[0]*v[1]-u[1]*v[0]];
  };
  const normalized=n=>{
   const length=Math.hypot(...n);
   guard(length>1e-9,'CAP_DEGENERATE',
    'Cap translation created a degenerate wall or cap triangle');
   return n.map(x=>x/length);
  };
  // Keep cap face orientation consistent with glTF triangle winding.
  const capStart=sourceFaces-first.faces.length;
  const caps=values.slice(capStart*3,(capStart+first.faces.length)*3);
  const sums=new Map();
  for(let i=0;i<caps.length;i+=3){
   const tri=caps.slice(i,i+3);
   guard(tri.every(x=>x>=sourceCount&&x<topStart),
    'CAP_FACE_MAP','Cap index topology changed unexpectedly');
   const normal=cross(...tri.map(index=>revised[index]));
   normalized(normal);
   for(const v of tri){
    const sum=sums.get(v)||[0,0,0];
    for(let k=0;k<3;k++)sum[k]+=normal[k];
    sums.set(v,sum);
   }
  }
  for(const [i,normal] of sums)updatedNormals[i]=normalized(normal);
  for(const index of bottomIndices){
   const a=revised[index],b=revised[index+1],
    c=revised[index+2],d=revised[index+3];
   // Quad may become non-coplanar; two real triangles remain valid.
   const n1=cross(a,b,c),n2=cross(a,c,d);
   normalized(n1);normalized(n2);
   const n=normalized(n1.map((value,k)=>value+n2[k]));
   for(let k=0;k<4;k++)updatedNormals[index+k]=n.slice();
  }
  prim.attributes.POSITION=append(ctx,revised,
   {type:'VEC3',componentType:5126,target:34962});
  prim.attributes.NORMAL=append(ctx,updatedNormals,
   {type:'VEC3',componentType:5126,target:34962});
  return{kind,sourceVertex,logicalLinkedCapCount:group.length,
   movedAttributeRows:moveSet.size,delta:delta.slice(),
   capGeometryVersion:1,unchangedCornerStreams:true};
 }
 if(kind==='normal.recalculate'){
  const accumulated=Array.from({length:count},()=>[0,0,0]);
  let zeroArea=0;
  for(let i=0;i<values.length;i+=3){
   const [a,b,c]=values.slice(i,i+3);
   const x=positions[a],y=positions[b],z=positions[c];
   const u=y.map((q,j)=>q-x[j]),v=z.map((q,j)=>q-x[j]);
   const cross=[
    u[1]*v[2]-u[2]*v[1],
    u[2]*v[0]-u[0]*v[2],
    u[0]*v[1]-u[1]*v[0]
   ];
   if(Math.hypot(...cross)<1e-10){zeroArea++;continue;}
   for(const index of [a,b,c])for(let k=0;k<3;k++)
    accumulated[index][k]+=cross[k];
  }
  const normals=accumulated.map(n=>{
   const len=Math.hypot(...n);
   return len>1e-10?n.map(x=>x/len):[0,0,1];
  });
  prim.attributes.NORMAL=append(ctx,normals,
   {type:'VEC3',componentType:5126,target:34962});
  // Preexisting tangent frames no longer agree with recomputed normals.
  // Do not pretend that previous tangents remain valid.
  if(prim.attributes.TANGENT!==undefined)delete prim.attributes.TANGENT;
  return {kind,zeroAreaFaces:zeroArea,
   normalsRecomputed:count,addedVertices:0,addedTriangles:0};
 }
 if(kind==='vertex.snap'){
  // Snap POSITION in the underlying mesh datablock, not skinned/morphed
  // viewport coordinates. Preserve UV, skin weights and morph deltas.
  const {vertex,targetVertex}=operation;
  guard(nat(vertex)&&vertex<count&&nat(targetVertex)&&targetVertex<count,
   'VERTEX','Snap vertex indices out of range');
  guard(vertex!==targetVertex,'SNAP_TARGET','Cannot snap a vertex to itself');
  const original=positions[vertex],destination=positions[targetVertex];
  const revised=positions.map(row=>row.slice());
  revised[vertex]=destination.slice();
  prim.attributes.POSITION=append(ctx,revised,
   {type:'VEC3',componentType:5126,target:34962});
  // Snapping overlapping positions is not a topological weld.
  return {kind,changedVertices:1,addedVertices:0,addedTriangles:0,
   distance:Math.hypot(...original.map((x,i)=>x-destination[i])),
   topologyMerged:false};
 }
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
 if(kind==='face.regionExtrude'||kind==='face.regionExtrudeLinked'){
  const linked=kind==='face.regionExtrudeLinked';
  // Links have been canonicalized against the *immutable* source GLB by
  // applyMeshOperations. Only this one-shot operation may consume them.
  const explicitLinks=linked?operation.links:[];
  const roots=Array.from({length:count},(_,i)=>i);
  const findRoot=index=>{
   while(roots[index]!==index)index=roots[index];
   return index;
  };
  for(const pair of explicitLinks){
   const a=findRoot(pair.vertexA),b=findRoot(pair.vertexB);
   if(a!==b)roots[Math.max(a,b)]=Math.min(a,b);
  }
  const logical=index=>findRoot(index);
  // Pass 13 constrained REGIONAL extrusion: one connected, orientable,
  // single-boundary disk of indexed triangles. Duplicated cap vertices
  // are shared by adjacent selected faces, unlike individual extrusion.
  // Each boundary quad gets four seam-specific wall vertices.
  const {faces,distance}=operation,totalFaces=values.length/3;
  guard(Array.isArray(faces)&&faces.length>=1&&faces.length<=128&&
   faces.every(i=>nat(i)&&i<totalFaces)&&
   new Set(faces).size===faces.length,
   'REGION_FACES','Expected 1–128 distinct triangle indices');
  guard(finite(distance)&&distance>=.001&&distance<=50,
   'EXTRUDE_DISTANCE','Distance must be within [0.001, 50] meters');
  const selected=[...faces].sort((a,b)=>a-b),selectedSet=new Set(selected);
  const edges=new Map(),faceNormals=new Map();
  const faceTriples=Array.from({length:totalFaces},(_,f)=>values.slice(f*3,f*3+3));
  for(let f=0;f<totalFaces;f++){
   const tri=faceTriples[f];
   if(selectedSet.has(f)){
    guard(new Set(tri).size===3,
     'REGION_DEGENERATE','Repeated vertex in selected triangle');
    const [a,b,c]=tri.map(i=>positions[i]),ab=b.map((x,i)=>x-a[i]),
     ac=c.map((x,i)=>x-a[i]);
    const cross=[ab[1]*ac[2]-ab[2]*ac[1],
     ab[2]*ac[0]-ab[0]*ac[2],ab[0]*ac[1]-ab[1]*ac[0]];
    guard(Math.hypot(...cross)>1e-9,'REGION_DEGENERATE',
     'Selected face has zero area');
    faceNormals.set(f,cross);
   }
   for(let i=0;i<3;i++){
    const from=tri[i],to=tri[(i+1)%3],
     mappedFrom=logical(from),mappedTo=logical(to),key=
     Math.min(mappedFrom,mappedTo)+':'+Math.max(mappedFrom,mappedTo);
    const list=edges.get(key)||[];
    list.push({face:f,from,to,mappedFrom,mappedTo});edges.set(key,list);
   }
  }
  const neighbors=new Map(selected.map(f=>[f,new Set()]));
  const borders=[];
  for(const list of edges.values()){
   const hasSelected=list.some(e=>selectedSet.has(e.face));
   if(!hasSelected)continue;
   guard(list.length<=2,'REGION_NONMANIFOLD',
    'An edge touching selected region belongs to over two triangles');
   if(list.length===2)
    guard(list[0].mappedFrom===list[1].mappedTo&&
     list[0].mappedTo===list[1].mappedFrom,
     'REGION_WINDING','Adjacent faces must have opposite edge winding');
   const within=list.filter(e=>selectedSet.has(e.face));
   if(within.length===2){
    neighbors.get(within[0].face).add(within[1].face);
    neighbors.get(within[1].face).add(within[0].face);
   }else if(within.length===1)borders.push(within[0]);
  }
  if(linked){
   // Explicit approval must bridge an actual selected seam, not arbitrary
   // coincident XYZ elsewhere in the same primitive.
   const covered=new Set(selected.flatMap(f=>faceTriples[f]));
   guard(explicitLinks.length>0&&explicitLinks.every(l=>
    covered.has(l.vertexA)&&covered.has(l.vertexB)),
    'LINKED_UNUSED','Every approved link must belong to the chosen faces');
   let newlyJoined=0;
   for(const list of edges.values()){
    const within=list.filter(e=>selectedSet.has(e.face));
    if(within.length===2&&!(
      within[0].from===within[1].to&&
      within[0].to===within[1].from))newlyJoined++;
   }
   guard(newlyJoined>0,'LINKED_UNUSED',
    'No selected face edge was joined using approved seam links');
  }
  // Shared vertex alone is NOT an edge connection; reject separate islands.
  const visited=new Set([selected[0]]),pending=[selected[0]];
  while(pending.length){
   for(const adjacent of neighbors.get(pending.pop())){
    if(!visited.has(adjacent)){visited.add(adjacent);pending.push(adjacent);}
   }
  }
  guard(visited.size===selected.length,'REGION_DISCONNECTED',
   'Faces must be connected through common indexed edges');
  guard(borders.length>=3&&borders.length<=256,
   'REGION_BOUNDARY','Expected 3–256 exposed directed region edges');
  // A single simple perimeter: each boundary vertex one incoming/outgoing.
  // Reject bow-tie vertices, open chains and holes rather than silently
  // producing non-manifold walls in the limited preview topology engine.
  const outgoing=new Map(),incoming=new Map();
  for(const e of borders){
   guard(!outgoing.has(e.mappedFrom)&&!incoming.has(e.mappedTo),
    'REGION_BOUNDARY','Repeated directed perimeter vertex (non-disk region)');
   outgoing.set(e.mappedFrom,e);incoming.set(e.mappedTo,e);
  }
  const ordered=[],start=borders[0].mappedFrom;
  let current=start;
  for(let i=0;i<borders.length;i++){
   const e=outgoing.get(current);
   guard(e&&!ordered.includes(e),'REGION_BOUNDARY',
    'Perimeter is not one simple closed loop');
   ordered.push(e);current=e.mappedTo;
  }
  guard(current===start&&ordered.length===borders.length,
   'REGION_BOUNDARY','Region has multiple boundary loops or a hole');
  const sum=[0,0,0];
  for(const face of selected){
   const norm=faceNormals.get(face);
   for(let j=0;j<3;j++)sum[j]+=norm[j];
  }
  const length=Math.hypot(...sum);
  guard(length>1e-9,'REGION_NORMAL','Region normals cancel each other');
  const normal=sum.map(x=>x/length);
  for(const cross of faceNormals.values()){
   guard(cross.reduce((v,x,i)=>v+x*normal[i],0)/
    Math.hypot(...cross)>=.2,'REGION_FOLD',
    'Selected faces have incompatible normals for a uniform offset');
  }
  const offset=normal.map(x=>x*distance);
  const capSources=[...new Set(selected.flatMap(i=>faceTriples[i]))]
   .sort((a,b)=>a-b);
  const newCount=capSources.length+ordered.length*4;
  guard(count+newCount<=MAX_VERTICES&&
   values.length+ordered.length*6<=MAX_INDICES,
   'TOPOLOGY_LIMIT','Region extrusion exceeds mesh budgets');
  const sourceAttributes={};
  for(const [name,index] of Object.entries(prim.attributes)){
   guard(name!=='TANGENT','TANGENT_PROFILE',
    'Region extrusion cannot preserve precomputed tangent frames');
   const stream=read(ctx,index);
   guard(stream.count===count&&
    (stream.componentType===5126||
     name==='JOINTS_0'&&[5121,5123].includes(stream.componentType)),
    'ATTRIBUTE_PROFILE','Unsupported attribute format: '+name);
   sourceAttributes[name]=stream;
  }
  guard(sourceAttributes.POSITION?.type==='VEC3'&&
   sourceAttributes.NORMAL?.type==='VEC3'&&
   sourceAttributes.NORMAL?.componentType===5126,
   'NORMAL_PROFILE','Region extrusion requires Float32 VEC3 normals');
  guard(Boolean(sourceAttributes.JOINTS_0)===
   Boolean(sourceAttributes.WEIGHTS_0),
   'SKIN_PROFILE','JOINTS_0 and WEIGHTS_0 must coexist');
  for(const [name,stream] of Object.entries(sourceAttributes)){
   if(/^TEXCOORD_/.test(name))guard(stream.type==='VEC2',
    'UV_PROFILE','Region extrusion expects VEC2 UV sets');
  }
  const morphs=(prim.targets||[]).map(target=>{
   const result={};
   for(const [name,index] of Object.entries(target)){
    guard(name==='POSITION','MORPH_PROFILE',
     'Region extrusion supports POSITION morph deltas only');
    const stream=read(ctx,index);
    guard(stream.componentType===5126&&stream.type==='VEC3'&&
     stream.count===count,'MORPH_PROFILE','Invalid morph buffer');
    result[name]=stream;
   }
   return result;
  });
  const cap=new Map(capSources.map((v,i)=>[v,count+i]));
  const sourceForNew=capSources.slice();
  const capCount=sourceForNew.length;
  const wallNormals=new Map(),wallUvs=new Map(),wallTriangles=[];
  for(let e=0;e<ordered.length;e++){
   const {from,to}=ordered[e],base=count+capCount+4*e;
   const ids=[base,base+1,base+2,base+3];
   sourceForNew.push(from,to,to,from);
   const dir=positions[to].map((x,i)=>x-positions[from][i]);
   const cross=[dir[1]*offset[2]-dir[2]*offset[1],
    dir[2]*offset[0]-dir[0]*offset[2],
    dir[0]*offset[1]-dir[1]*offset[0]];
   const scale=Math.hypot(...cross);
   guard(scale>1e-9,'REGION_WALL',
    'Perimeter direction parallel to extrusion offset');
   const sideNormal=cross.map(x=>x/scale);
   for(const id of ids)wallNormals.set(id,sideNormal);
   [[0,0],[1,0],[1,1],[0,1]].forEach((uv,i)=>wallUvs.set(ids[i],uv));
   wallTriangles.push(ids[0],ids[1],ids[2],ids[0],ids[2],ids[3]);
  }
  for(const [name,stream] of Object.entries(sourceAttributes)){
   const expanded=stream.value.map(row=>row.slice());
   for(let j=0;j<sourceForNew.length;j++){
    const index=count+j,source=sourceForNew[j];
    let row=stream.value[source].slice();
    if(name==='POSITION'&&(j<capCount||
      ((j-capCount)%4)>=2))
     row=row.map((v,i)=>v+offset[i]);
    else if(name==='NORMAL'&&wallNormals.has(index))
     row=wallNormals.get(index).slice();
    else if(/^TEXCOORD_/.test(name)&&wallUvs.has(index))
     row=wallUvs.get(index).slice();
    expanded.push(row);
   }
   prim.attributes[name]=append(ctx,expanded,
    {type:stream.type,componentType:stream.componentType,target:34962});
  }
  (prim.targets||[]).forEach((targets,i)=>{
   for(const [name,stream] of Object.entries(morphs[i])){
    targets[name]=append(ctx,[
     ...stream.value.map(row=>row.slice()),
     ...sourceForNew.map(source=>stream.value[source].slice())
    ],{type:stream.type,componentType:5126,target:34962});
   }
  });
  const newer=[];
  for(let i=0;i<totalFaces;i++)
   if(!selectedSet.has(i))newer.push(...faceTriples[i]);
  for(const face of selected)
   newer.push(...faceTriples[face].map(v=>cap.get(v)));
  newer.push(...wallTriangles);
  writeIndices(ctx,prim,newer,oldIndex.componentType);
  return {kind,faces:selected,distance,addedVertices:newCount,
   addedTriangles:ordered.length*2,boundaryEdges:ordered.length,
   capVertices:capSources.length,changedVertices:0,
   singleBoundaryLoop:true,sourceLinksConsumed:linked,
   seamPairs:explicitLinks.length};
 }
 if(kind==='face.extrude'){
  // Individual indexed TRIANGLE extrusion. No N-gons or region extrusion.
  // Original face becomes a raised cap with three new vertices; three
  // independent quad sides are triangulated. Wall vertices are deliberately
  // split at UV/normal corners. No original accessor is modified in-place.
  const {face,distance}=operation;
  guard(nat(face)&&face<values.length/3,'FACE','Invalid face for extrusion');
  guard(finite(distance)&&distance>=.001&&distance<=50,
   'EXTRUDE_DISTANCE','Distance must be within [0.001, 50] meters');
  const tri=values.slice(face*3,face*3+3);
  guard(new Set(tri).size===3,'DEGENERATE_FACE','Repeated face vertex');
  const [a,b,c]=tri.map(index=>positions[index]);
  const u=b.map((v,i)=>v-a[i]),v=c.map((q,i)=>q-a[i]);
  const cross=[u[1]*v[2]-u[2]*v[1],
   u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]];
  const magnitude=Math.hypot(...cross);
  guard(magnitude>1e-9,'DEGENERATE_FACE','Cannot extrude zero-area face');
  const offset=cross.map(q=>q/magnitude*distance);
  guard(count+15<=MAX_VERTICES&&values.length+18<=MAX_INDICES,
   'TOPOLOGY_LIMIT','Extrusion exceeds bounded mesh limits');
  const sourceAttributes={};
  for(const [name,index] of Object.entries(prim.attributes)){
   // Reusing old tangent vectors for new sidewalls gives wrong normal maps.
   guard(name!=='TANGENT','TANGENT_PROFILE',
    'Extrusion requires tangent regeneration; tangent meshes unsupported');
   const stream=read(ctx,index);
   guard(stream.count===count,'ATTRIBUTE_PROFILE','Attribute vertex count mismatch');
   guard(stream.componentType===5126||
    name==='JOINTS_0'&&[5121,5123].includes(stream.componentType),
    'ATTRIBUTE_PROFILE','Unsupported normalized or integer vertex stream: '+name);
   sourceAttributes[name]=stream;
  }
  guard(sourceAttributes.POSITION?.type==='VEC3','POSITION_PROFILE',
   'Expected Float32 VEC3 positions');
  if(sourceAttributes.NORMAL)
   guard(sourceAttributes.NORMAL.type==='VEC3','NORMAL_PROFILE',
    'Expected VEC3 normal stream');
  for(const [name,stream] of Object.entries(sourceAttributes)){
   if(/^TEXCOORD_/.test(name))guard(stream.type==='VEC2',
    'UV_PROFILE','Expected VEC2 texture coordinates');
  }
  const sourceMorphs=(prim.targets||[]).map(targets=>{
   const entries={};
   for(const [name,index] of Object.entries(targets)){
    // Morph normal deltas require a corresponding sidewall normal solver;
    // reject rather than silently corrupting facial normal animation.
    guard(name==='POSITION','MORPH_PROFILE',
     'Only POSITION morph deltas supported for extrusion');
    const stream=read(ctx,index);
    guard(stream.componentType===5126&&stream.type==='VEC3'&&
     stream.count===count,'MORPH_PROFILE','Invalid POSITION morph stream');
    entries[name]=stream;
   }
   return entries;
  });
  const cap=tri.map((_,i)=>count+i);
  const walls=[];
  const sourceForNew=[...tri];
  const topForNew=[true,true,true];
  const wallNormals=new Map(),wallUvs=new Map();
  for(let edge=0;edge<3;edge++){
   const from=tri[edge],to=tri[(edge+1)%3];
   const start=count+3+edge*4;
   const ids=[start,start+1,start+2,start+3];
   sourceForNew.push(from,to,to,from);
   topForNew.push(false,false,true,true);
   const direction=positions[to].map((q,i)=>q-positions[from][i]);
   const outward=[
    direction[1]*offset[2]-direction[2]*offset[1],
    direction[2]*offset[0]-direction[0]*offset[2],
    direction[0]*offset[1]-direction[1]*offset[0]
   ];
   const norm=Math.hypot(...outward);
   guard(norm>1e-9,'DEGENERATE_WALL','Extrusion wall has no area');
   const wallNormal=outward.map(q=>q/norm);
   for(const id of ids)wallNormals.set(id,wallNormal);
   [[0,0],[1,0],[1,1],[0,1]].forEach((uv,i)=>wallUvs.set(ids[i],uv));
   // Oriented outward for a source CCW face, including negative local normal.
   walls.push(ids[0],ids[1],ids[2],ids[0],ids[2],ids[3]);
  }
  for(const [name,stream] of Object.entries(sourceAttributes)){
   const data=stream.value.map(row=>row.slice());
   for(let j=0;j<sourceForNew.length;j++){
    const index=count+j,source=sourceForNew[j];
    let row=stream.value[source].slice();
    if(name==='POSITION'&&topForNew[j])
     row=row.map((q,k)=>q+offset[k]);
    else if(name==='NORMAL'&&wallNormals.has(index))
     row=wallNormals.get(index).slice();
    else if(/^TEXCOORD_/.test(name)&&wallUvs.has(index))
     row=wallUvs.get(index).slice();
    data.push(row);
   }
   prim.attributes[name]=append(ctx,data,{
    type:stream.type,componentType:stream.componentType,target:34962
   });
  }
  (prim.targets||[]).forEach((targets,k)=>{
   for(const [name,stream] of Object.entries(sourceMorphs[k])){
    targets[name]=append(ctx,[
     ...stream.value.map(row=>row.slice()),
     ...sourceForNew.map(i=>stream.value[i].slice())
    ],{type:stream.type,componentType:5126,target:34962});
   }
  });
  const newer=values.slice();newer.splice(face*3,3);
  newer.push(...cap,...walls);
  writeIndices(ctx,prim,newer,oldIndex.componentType);
  return{kind,face,distance,capVertexIndices:cap,
   addedVertices:15,addedTriangles:6,changedVertices:0,
   wallUv:'per-edge rectangular coordinates',
   supportedMorphAttributes:['POSITION']};
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
 const linkedOperations=operations.filter(o=>o?.kind==='face.regionExtrudeLinked');
 const uvOps=operations.filter(o=>o?.kind==='uv.offsetFaceCorners');
 guard(!uvOps.length||
  !linkedOperations.length&&operations.length<=8&&
  operations.every(op=>op?.kind==='uv.offsetFaceCorners'&&
   op.meshIndex===operations[0].meshIndex&&
   op.primitiveIndex===operations[0].primitiveIndex),
  'UV_SEQUENCE',
  'Up to eight persistent UV-only face-corner edits on a source primitive');
 let linkedSource=null;
 if(linkedOperations.length){
  guard(linkedOperations.length===1&&
   operations[0]?.kind==='face.regionExtrudeLinked'&&
   operations.length<=35,
   'LINKED_SEQUENCE','One approved linked extrusion is required');
  const following=operations.slice(1),
   firstSplit=following.findIndex(o=>o?.kind==='edge.splitPokedCap'),
   earlier=firstSplit<0?following:following.slice(0,firstSplit),
   rest=firstSplit<0?[]:following.slice(firstSplit),
   grandchildSplit=rest.at(-1)?.kind==='edge.splitPokedCapGrandchild'?
    rest.at(-1):null,
   withoutGrandchild=grandchildSplit?rest.slice(0,-1):rest,
   childSplit=withoutGrandchild.at(-1)?.kind==='edge.splitPokedCapChild'?
    withoutGrandchild.at(-1):null,
   splits=childSplit?withoutGrandchild.slice(0,-1):withoutGrandchild,
   pokeIndex=earlier.findIndex(o=>o?.kind==='face.pokeLinkedCap'),
   pokes=earlier.filter(o=>o?.kind==='face.pokeLinkedCap');
  guard(earlier.every((op,i)=>
    op?.kind==='vertex.moveLinkedCap'&&
     i<(pokeIndex<0?earlier.length:pokeIndex)||
    op?.kind==='face.pokeLinkedCap'&&i>=pokeIndex)&&
   earlier.filter(x=>x?.kind==='vertex.moveLinkedCap').length<=16&&
   pokes.length>=splits.length&&pokes.length<=8&&
   new Set(pokes.map(o=>o.sourceFace)).size===pokes.length&&
   splits.length<=8&&
   splits.every(o=>o?.kind==='edge.splitPokedCap'&&
    nat(o.sourceFace)&&nat(o.sourceVertex)&&
    pokes.some(p=>p.sourceFace===o.sourceFace))&&
   new Set(splits.map(o=>o.sourceFace)).size===splits.length&&
   (!childSplit||
    nat(childSplit.sourceFace)&&nat(childSplit.sourceVertex)&&
    splits.some(o=>o.sourceFace===childSplit.sourceFace&&
     o.sourceVertex===childSplit.sourceVertex))&&
   (!grandchildSplit||
    childSplit&&nat(grandchildSplit.sourceFace)&&
    nat(grandchildSplit.sourceVertex)&&
    grandchildSplit.sourceFace===childSplit.sourceFace&&
    grandchildSplit.sourceVertex===childSplit.sourceVertex),
   'LINKED_SEQUENCE',
   'Approved sequence: cap moves, Pokes, primaries, daughter, terminal grandchild');
  const op=linkedOperations[0];
  guard(Array.isArray(op.links)&&op.links.length>=1,
   'LINKED_APPROVAL','Approved source seam links required');
  const canonical=normalizeExplicitSeamLinks(input,op.links,[]);
  guard(JSON.stringify(canonical)===JSON.stringify(op.links)&&
   canonical.every(l=>l.meshIndex===op.meshIndex&&
    l.primitiveIndex===op.primitiveIndex),
   'LINKED_CANONICAL','Approved links are not canonical for the source');
  const originalCtx=begin(input),originalPrim=target(originalCtx,
   op.meshIndex,op.primitiveIndex),original=indices(originalCtx,originalPrim);
  const chosen=[...new Set(op.faces.flatMap(f=>{
   guard(nat(f)&&f<original.values.length/3,
    'CAP_SOURCE_FACE','Invalid original selected cap face');
   return original.values.slice(f*3,f*3+3);
  }))].sort((a,b)=>a-b);
  linkedSource={operation:op,sourceCount:original.positions.length,
   sourceFaces:original.values.length/3,capSources:chosen,pokes,splits,
   childSplit,grandchildSplit,
   sourceFaceVertices:new Map(op.faces.map(f=>[
    f,original.values.slice(f*3,f*3+3)]))};
  for(const next of following)guard(next.meshIndex===op.meshIndex&&
   next.primitiveIndex===op.primitiveIndex,'CAP_TARGET',
   'All cap edits must remain on the approved source primitive');
 }else{
  guard(!operations.some(o=>['vertex.moveLinkedCap',
   'face.pokeLinkedCap','edge.splitPokedCap',
   'edge.splitPokedCapChild','edge.splitPokedCapGrandchild'].includes(o?.kind)),
   'CAP_CONTEXT','Source-approved linked extrusion required for cap changes');
 }
 if(operations.length===0)return bytes(input).slice();
 let current=bytes(input).slice();
 for(let i=0;i<operations.length;i++){
  const ctx=begin(current);
  try{editOnce(ctx,operations[i],linkedSource);}
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
