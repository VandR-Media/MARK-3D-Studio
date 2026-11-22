/**
 * Pass30: bounded GLB edge split materializer. This is a one-shot GLB export,
 * NOT a MARKTOP1/.markscene migration or committed Edit Mode operation.
 * Original BIN bytes remain an exact prefix; every altered primitive accessor
 * is copied to a new bufferView and no other primitive is rewritten.
 */
import {parseGlb,writeGlb} from '../glb.js';
import {planOwnedEdgeSplit} from './owned-edge-split-plan.js';
const sizes={5120:1,5121:1,5122:2,5123:2,5125:4,5126:4};
const readers={5120:'getInt8',5121:'getUint8',5122:'getInt16',5123:'getUint16',5125:'getUint32',5126:'getFloat32'};
const writers={5120:'setInt8',5121:'setUint8',5122:'setInt16',5123:'setUint16',5125:'setUint32',5126:'setFloat32'};
const dim={SCALAR:1,VEC2:2,VEC3:3,VEC4:4,MAT2:4,MAT3:9,MAT4:16};
const err=(code,msg)=>{const e=new Error('MARK_SPLIT_EXPORT_'+code+': '+msg);e.code='SPLIT_EXPORT_'+code;throw e;};
const check=(x,c,m)=>{if(!x)err(c,m);};
const align=n=>(n+3)&~3;
const bytes=x=>x instanceof Uint8Array?x:ArrayBuffer.isView(x)?
 new Uint8Array(x.buffer,x.byteOffset,x.byteLength):
 x instanceof ArrayBuffer?new Uint8Array(x):err('BYTES','GLB bytes expected');
const near=(a,b)=>Math.abs(a-b)<1e-6;

function accessorRows(doc,bin,index){
 const a=doc.accessors?.[index],view=doc.bufferViews?.[a?.bufferView];
 check(a&&view&&view.buffer===0&&!a.sparse&&!a.normalized&&
  dim[a.type]&&sizes[a.componentType]&&
  Number.isSafeInteger(a.count)&&a.count>0,
  'ACCESSOR','Only dense, non-normalized accessors supported');
 const count=dim[a.type],size=sizes[a.componentType],step=count*size,
  stride=view.byteStride??step,
  start=(view.byteOffset||0)+(a.byteOffset||0);
 check(start%size===0&&stride>=step&&stride%size===0&&
  start+(a.count-1)*stride+step<=
  Math.min(bin.length,(view.byteOffset||0)+view.byteLength),
  'BOUNDS','Accessor escapes its buffer view');
 const dv=new DataView(bin.buffer,bin.byteOffset,bin.byteLength),r=readers[a.componentType];
 const rows=Array.from({length:a.count},(_,i)=>
  Array.from({length:count},(_,k)=>dv[r](start+i*stride+k*size,true)));
 check(rows.every(v=>v.every(Number.isFinite)),
  'FINITE','Non-finite attribute values');
 return{a,rows,count,size,step};
}
function interpolate(semantic,left,right,t,componentType){
 check(left.length===right.length,'DIM','Attribute tuple length mismatch');
 if(semantic.startsWith('JOINTS_')){
  check(left.every((n,i)=>n===right[i]),'JOINTS',
   'Joint palettes differ across split edge; lossless skin remap not implemented');
  return left.slice();
 }
 if(componentType!==5126){
  check(left.every((n,i)=>n===right[i]),'INTEGER',
   'Different integer endpoint attributes require explicit remap');
  return left.slice();
 }
 const result=left.map((n,i)=>Math.fround(n*(1-t)+right[i]*t));
 check(result.every(Number.isFinite),'FINITE','Interpolated attribute overflow');
 if(semantic==='NORMAL'||semantic==='TANGENT'){
  if(semantic==='TANGENT')check(near(left[3],right[3]),
   'TANGENT_SIGN','Opposite tangent handedness cannot be interpolated');
  const length=Math.hypot(...result.slice(0,3));
  check(length>1e-8,'NORMAL','Interpolated direction vanishes');
  for(let i=0;i<3;i++)result[i]=Math.fround(result[i]/length);
  if(semantic==='TANGENT')result[3]=left[3];
 }
 if(semantic.startsWith('WEIGHTS_')){
  const sum=result.reduce((a,b)=>a+b,0);
  check(sum>1e-8&&result.every(n=>n>=-1e-6),
   'WEIGHTS','Invalid interpolated skin weights');
  return result.map(n=>Math.fround(Math.max(0,n)/sum));
 }
 return result;
}
/**
 * Writes an independently exported, genuinely remeshed GLB. Fails closed on
 * unknown/unsupported packed formats, differing joint palettes, nonfinite
 * values, malformed index streams and an over-limit resulting topology.
 * Does not mutate input, saved .markscene, or the Pass29 topology catalog.
 */
export function materializeOwnedEdgeSplitGLB({
 sourceGLB,sourceSha256,data,edgeId,t=0.5
}={}){
 const plan=planOwnedEdgeSplit({sourceGLB,sourceSha256,data,edgeId,t});
 check(plan.resultingFaceCount<=512,'FACE_LIMIT','Result exceeds 512 triangle profile');
 const parsed=parseGlb(bytes(sourceGLB)),doc=structuredClone(parsed.json);
 check(!doc.extensionsRequired?.length&&doc.buffers?.length===1&&
  doc.buffers[0].uri===undefined,'PROFILE','Embedded uncompressed GLB required');
 const original=parsed.chunks.find(c=>c.type===0x004e4942);
 check(original,'BIN','Missing binary chunk');
 const prim=doc.meshes?.[plan.meshIndex]?.primitives?.[plan.primitiveIndex];
 check(prim&&prim.indices!==undefined&&(prim.mode??4)===4,
  'PRIMITIVE','Indexed triangle primitive required');
 const sourceIndex=accessorRows(doc,original.data,prim.indices);
 check(sourceIndex.a.type==='SCALAR'&&[5121,5123,5125].includes(sourceIndex.a.componentType),
  'INDICES','Unsigned index accessor expected');
 const indexRows=sourceIndex.rows.map(x=>x[0]);
 check(indexRows.length===plan.sourceFaceCount*3,'FACE_COUNT','Source face count changed');
 const newRow=accessorRows(doc,original.data,prim.attributes.POSITION).rows.length;
 check(newRow<32768,'VERTEX_LIMIT','Result exceeds supported vertex profile');
 const faceChanges=new Map(plan.children.map(c=>[c.sourceFace,c]));
 const indices=[];
 for(let f=0;f<plan.sourceFaceCount;f++){
  const children=faceChanges.get(f);
  if(!children){indices.push(...indexRows.slice(f*3,f*3+3));continue;}
  for(const tri of children.childIndices)for(const vertex of tri)
   indices.push(vertex===plan.newVertexId?newRow:vertex);
 }
 check(indices.length===plan.resultingFaceCount*3&&
  indices.every(x=>Number.isSafeInteger(x)&&x>=0&&x<=newRow),
  'REMAP','Invalid remapped triangle index');
 const append=[];
 function put(data,target){
  const byteOffset=align(original.data.length+
   append.reduce((n,part)=>n+part.data.length+part.pad,0));
  const current=original.data.length+
   append.reduce((n,part)=>n+part.data.length+part.pad,0);
  append.push({pad:byteOffset-current,data,target,byteOffset});
  const bufferView=doc.bufferViews.length;
  doc.bufferViews.push({buffer:0,byteOffset,byteLength:data.length,
   ...(target===undefined?{}:{target})});
  return bufferView;
 }
 function addAccessor(index,semantic){
  const {a,rows,count,size,step}=accessorRows(doc,original.data,index);
  check(rows.length===newRow,'ROWS','All vertex attributes require equal row counts');
  if(semantic.startsWith('WEIGHTS_'))
   check(prim.attributes['JOINTS_'+semantic.slice(8)]!==undefined,
    'SKIN_PAIR','Weights have no matching joints');
  if(semantic.startsWith('JOINTS_'))
   check(prim.attributes['WEIGHTS_'+semantic.slice(7)]!==undefined,
    'SKIN_PAIR','Joints have no matching weights');
  const [left,right]=plan.sourceRows;
  const inserted=interpolate(semantic,rows[left],rows[right],t,a.componentType);
  const all=[...rows,inserted],buffer=new Uint8Array(all.length*step),
   dv=new DataView(buffer.buffer);
  const setter=writers[a.componentType];
  for(let r=0;r<all.length;r++)for(let k=0;k<count;k++)
   dv[setter](r*step+k*size,all[r][k],true);
  const bufferView=put(buffer,34962);
  const copy={...a,bufferView,byteOffset:0,count:all.length};
  if(semantic==='POSITION'){
   copy.min=Array.from({length:3},(_,k)=>Math.min(...all.map(x=>x[k])));
   copy.max=Array.from({length:3},(_,k)=>Math.max(...all.map(x=>x[k])));
  }else {delete copy.min;delete copy.max;}
  const newAccessor=doc.accessors.length;doc.accessors.push(copy);
  return newAccessor;
 }
 for(const [semantic,index] of Object.entries(prim.attributes))
  prim.attributes[semantic]=addAccessor(index,semantic);
 for(let i=0;i<(prim.targets||[]).length;i++){
  const target=prim.targets[i];
  for(const [semantic,index] of Object.entries(target))
   target[semantic]=addAccessor(index,'MORPH_'+semantic);
 }
 const indexData=new Uint8Array(indices.length*4),dv=new DataView(indexData.buffer);
 indices.forEach((v,i)=>dv.setUint32(i*4,v,true));
 const newIndexView=put(indexData,34963);
 const idx=doc.accessors.length;doc.accessors.push({
  bufferView:newIndexView,byteOffset:0,componentType:5125,
  count:indices.length,type:'SCALAR',
  min:[Math.min(...indices)],max:[Math.max(...indices)]
 });
 prim.indices=idx;
 const total=align(original.data.length+
  append.reduce((n,x)=>n+x.pad+x.data.length,0));
 const out=new Uint8Array(total);out.set(original.data);
 for(const part of append)out.set(part.data,part.byteOffset);
 doc.buffers[0].byteLength=total;
 const exported=writeGlb({...parsed,chunks:parsed.chunks.map(c=>
  c.type===0x004e4942?{...c,data:out}:c)},doc);
 return{glb:exported,plan,vertexCount:newRow+1,faceCount:indices.length/3,
  sourceBinPrefixBytes:original.data.length};
}
