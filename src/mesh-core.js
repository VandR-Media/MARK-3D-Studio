import { parseGlb, writeGlb, assertSelfContainedGlb } from './glb.js';

// Edits the actual BIN chunk of a GLB, not only a Three.js BufferGeometry.
// Deliberate safety contract: non-skinned, non-morphed, non-shared, FLOAT32
// POSITION/NORMAL accessors only. All other file data is preserved.
const BIN=0x004e4942;
const clone=a=>new Float32Array(a);
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const dist2=(a,b)=>{const x=a[0]-b[0],y=a[1]-b[1],z=a[2]-b[2];return x*x+y*y+z*z;};
const key=(x,y,z)=>x+','+y+','+z;
function readAccessor(doc,bin,index,expected) {
  const a=doc.accessors?.[index];
  if(!a||a.type!==expected||a.sparse||a.normalized)throw Error('Неподдерживаемый accessor: '+index);
  const count=a.count, width=expected==='VEC3'?3:expected==='VEC2'?2:1;
  const component=a.componentType;
  const size=component===5126||component===5125?4:component===5123?2:component===5121?1:0;
  if(!size||!(count>=0))throw Error('Неподдерживаемый тип accessor.');
  const view=doc.bufferViews?.[a.bufferView];
  if(!view||view.buffer!==0)throw Error('Accessor не находится во встроенном GLB BIN.');
  const stride=view.byteStride??size*width,at=(view.byteOffset??0)+(a.byteOffset??0);
  if(stride<size*width||at<0||at+(count?((count-1)*stride+width*size):0)>bin.byteLength||
     (a.byteOffset??0)+(count?((count-1)*stride+width*size):0)>view.byteLength)throw Error('Accessor выходит за пределы BIN.');
  const dv=new DataView(bin.buffer,bin.byteOffset,bin.byteLength),out=new Float64Array(count*width);
  for(let i=0;i<count;i++)for(let j=0;j<width;j++){
    const o=at+i*stride+j*size;out[i*width+j]=component===5126?dv.getFloat32(o,true):
      component===5125?dv.getUint32(o,true):component===5123?dv.getUint16(o,true):dv.getUint8(o);
  }
  return {data:out,index,accessor:a,offset:at,stride,width,size,component,count};
}
function writeFloat32(bin,accessor,positions){
  if(accessor.component!==5126||accessor.width!==3||positions.length!==accessor.count*3)
    throw Error('Экспорт VEC3 требует FLOAT32.');
  const dv=new DataView(bin.buffer,bin.byteOffset,bin.byteLength);
  for(let i=0;i<positions.length;i++){
    const v=positions[i];if(!Number.isFinite(v))throw Error('Координата не является конечным числом.');
    dv.setFloat32(accessor.offset+Math.floor(i/3)*accessor.stride+(i%3)*4,v,true);
  }
}
function adjacencyOf(count,indices){
 const adj=Array.from({length:count},()=>new Set());
 for(let i=0;i<indices.length;i+=3){
  const a=indices[i],b=indices[i+1],c=indices[i+2];
  for(const [x,y] of [[a,b],[b,c],[c,a]]){adj[x].add(y);adj[y].add(x);}
 }
 return adj.map(a=>Array.from(a));
}
function calculateNormals(pos,indices){
 const n=new Float32Array(pos.length);
 for(let i=0;i<indices.length;i+=3){
  const a=indices[i]*3,b=indices[i+1]*3,c=indices[i+2]*3;
  const ab=[pos[b]-pos[a],pos[b+1]-pos[a+1],pos[b+2]-pos[a+2]];
  const ac=[pos[c]-pos[a],pos[c+1]-pos[a+1],pos[c+2]-pos[a+2]];
  const x=ab[1]*ac[2]-ab[2]*ac[1],y=ab[2]*ac[0]-ab[0]*ac[2],z=ab[0]*ac[1]-ab[1]*ac[0];
  for(const k of [a,b,c]){n[k]+=x;n[k+1]+=y;n[k+2]+=z;}
 }
 for(let i=0;i<n.length;i+=3){
  const l=Math.hypot(n[i],n[i+1],n[i+2])||1;
  n[i]/=l;n[i+1]/=l;n[i+2]/=l;
 }
 return n;
}
export function sceneMeshList(doc){
 const usages=new Map();
 for(const n of doc.nodes||[])if(Number.isInteger(n.mesh))usages.set(n.mesh,(usages.get(n.mesh)||0)+1);
 const out=[];
 (doc.nodes||[]).forEach((node,nodeIndex)=>{
  if(!Number.isInteger(node.mesh))return;
  const mesh=doc.meshes?.[node.mesh];
  (mesh?.primitives||[]).forEach((p,primitiveIndex)=>{
   const reasons=[];
   if(usages.get(node.mesh)>1)reasons.push('общий меш нескольких объектов');
   if(node.skin!==undefined||p.attributes?.JOINTS_0!==undefined||p.attributes?.WEIGHTS_0!==undefined)reasons.push('skinning');
   if(p.targets?.length||mesh.weights?.length||node.weights?.length)reasons.push('morph targets');
   if(p.mode!==undefined&&p.mode!==4)reasons.push('не треугольная геометрия');
   if(p.attributes?.POSITION===undefined||p.attributes?.NORMAL===undefined)reasons.push('требуются POSITION и NORMAL');
   const a=doc.accessors?.[p.attributes?.POSITION],na=doc.accessors?.[p.attributes?.NORMAL];
   if(a?.componentType!==5126||a?.type!=='VEC3'||a?.sparse||na?.componentType!==5126||na?.type!=='VEC3'||na?.sparse)reasons.push('требуются обычные FLOAT32 accessor');
   const reused=(doc.meshes||[]).flatMap(m=>m.primitives||[]).filter(q=>q.attributes?.POSITION===p.attributes?.POSITION).length;
   if(reused>1)reasons.push('общий POSITION accessor');
   out.push({nodeIndex,meshIndex:node.mesh,primitiveIndex,name:node.name||mesh.name||'Объект '+(nodeIndex+1),
     vertexCount:a?.count||0,editable:reasons.length===0,reason:reasons.join(', ')});
  });
 });
 return out;
}

export class SpatialHash {
 constructor(positions,cellSize){this.positions=positions;this.cellSize=Math.max(1e-5,cellSize);this.map=new Map();this.rebuild();}
 cell(p){return p.map(v=>Math.floor(v/this.cellSize));}
 rebuild(){
  this.map.clear();const p=this.positions,s=this.cellSize;
  for(let i=0;i<p.length;i+=3){const k=key(Math.floor(p[i]/s),Math.floor(p[i+1]/s),Math.floor(p[i+2]/s));
   let b=this.map.get(k);if(!b){b=[];this.map.set(k,b);}b.push(i/3);}
 }
 query(point,radius){
  const s=this.cellSize,a=point.map(v=>Math.floor((v-radius)/s)),b=point.map(v=>Math.floor((v+radius)/s)),out=[],r2=radius*radius;
  for(let x=a[0];x<=b[0];x++)for(let y=a[1];y<=b[1];y++)for(let z=a[2];z<=b[2];z++){
   for(const i of this.map.get(key(x,y,z))||[]){
    const j=i*3,dx=this.positions[j]-point[0],dy=this.positions[j+1]-point[1],dz=this.positions[j+2]-point[2];
    if(dx*dx+dy*dy+dz*dz<=r2)out.push(i);
   }
  }
  return out;
 }
}
export function mirrorPairs(positions,tolerance=0.002){
 const list=new Map(),n=positions.length/3, result=new Int32Array(n).fill(-1),eps=Math.max(1e-6,tolerance);
 const k=(x,y,z)=>key(Math.round(x/eps),Math.round(y/eps),Math.round(z/eps));
 for(let i=0;i<n;i++){const j=i*3;const id=k(positions[j],positions[j+1],positions[j+2]);
   if(!list.has(id))list.set(id,[]);list.get(id).push(i);}
 for(let i=0;i<n;i++){
  const j=i*3,x=positions[j],y=positions[j+1],z=positions[j+2];
  if(Math.abs(x)<eps){result[i]=i;continue;}
  let best=-1,d=Infinity;
  // Examine nearby quantization buckets so float offsets on symmetrical models do not break matching.
  const cx=Math.round(-x/eps),cy=Math.round(y/eps),cz=Math.round(z/eps);
  for(let a=-1;a<=1;a++)for(let b=-1;b<=1;b++)for(let c=-1;c<=1;c++){
   for(const m of list.get(key(cx+a,cy+b,cz+c))||[]){
    const t=m*3,dx=positions[t]+x,dy=positions[t+1]-y,dz=positions[t+2]-z,v=dx*dx+dy*dy+dz*dz;
    if(v<d&&v<=3*eps*eps){best=m;d=v;}
   }
  }
  result[i]=best;
 }
 return result;
}
function unsafeTarget(doc,descriptor){
 if(!descriptor||!descriptor.editable)throw Error('Mesh Edit заблокирован: '+(descriptor?.reason||'объект не поддерживается'));
 const p=doc.meshes[descriptor.meshIndex].primitives[descriptor.primitiveIndex];
 // Shared normals and animation targets require a separate dedicated handler.
 if((doc.meshes||[]).flatMap(m=>m.primitives||[]).filter(q=>q.attributes?.NORMAL===p.attributes.NORMAL).length>1)
  throw Error('Mesh Edit заблокирован: общий NORMAL accessor');
 return p;
}
export class MeshEditor {
 constructor(bytes,selection=0){
  this.original=parseGlb(bytes);assertSelfContainedGlb(this.original.json);
  this.doc=structuredClone(this.original.json);
  this.items=sceneMeshList(this.doc);
  this.choice=this.items[selection];
  const prim=unsafeTarget(this.doc,this.choice);
  if((this.doc.buffers?.length||0)!==1||this.doc.buffers[0].uri!==undefined)
    throw Error('Для Mesh Edit требуется GLB с одним встроенным BIN.');
  const chunk=this.original.chunks.find(c=>c.type===BIN);if(!chunk)throw Error('Отсутствует BIN блок.');
  this.bin=chunk.data.slice();
  this.posAcc=readAccessor(this.doc,this.bin,prim.attributes.POSITION,'VEC3');
  this.normalAcc=readAccessor(this.doc,this.bin,prim.attributes.NORMAL,'VEC3');
  if(this.normalAcc.count!==this.posAcc.count)throw Error('Число нормалей не совпадает с числом вершин.');
  this.positions=Float32Array.from(this.posAcc.data);
  this.normals=Float32Array.from(this.normalAcc.data);
  const index=prim.indices===undefined?null:readAccessor(this.doc,this.bin,prim.indices,'SCALAR');
  const ind=index?Array.from(index.data):Array.from({length:this.positions.length/3},(_,i)=>i);
  if(ind.length%3!==0||ind.some(i=>!Number.isInteger(i)||i>=this.positions.length/3))
    throw Error('Некорректные индексы полигонов.');
  this.indices=Uint32Array.from(ind);
  this.adj=adjacencyOf(this.positions.length/3,this.indices);
  this.history=[];this.redoStack=[];this.pending=null;this.changed=false;this._pairs=null;this.hash=null;this.hashRadius=0;
 }
 get count(){return this.positions.length/3;}
 get triangleCount(){return this.indices.length/3;}
 begin(){
  if(this.pending)throw Error('Редактирование уже началось.');
  this.pending=this.positions.slice();
 }
 commit(){
  if(!this.pending)return false;
  const previous=this.pending;this.pending=null;
  if(previous.every((v,i)=>v===this.positions[i]))return false;
  this.history.push(previous);if(this.history.length>20)this.history.shift();
  this.redoStack.length=0;this.refresh();return true;
 }
 cancel(){if(this.pending){this.positions.set(this.pending);this.pending=null;this.refresh();}}
 undo(){if(this.pending)throw Error('Завершите текущую операцию.');const previous=this.history.pop();if(!previous)return false;
  this.redoStack.push(this.positions.slice());this.positions.set(previous);this.refresh();return true;}
 redo(){if(this.pending)throw Error('Завершите текущую операцию.');const next=this.redoStack.pop();if(!next)return false;
  this.history.push(this.positions.slice());this.positions.set(next);this.refresh();return true;}
 refresh(){this.normals=calculateNormals(this.positions,this.indices);this.changed=true;this.hash=null;this._pairs=null;}
 pairMap(tolerance=.002){if(!this._pairs)this._pairs=mirrorPairs(this.positions,tolerance);return this._pairs;}
 _set(i,next){const j=i*3;this.positions[j]=next[0];this.positions[j+1]=next[1];this.positions[j+2]=next[2];}
 _get(i){const j=i*3;return [this.positions[j],this.positions[j+1],this.positions[j+2]];}
 // For mirrored edits, apply an operation on one side then mirror its exact
 // final position across the local x=0 plane. Unpaired vertices stay unpaired.
 _apply(ids,operation,symmetry){
  const pairs=symmetry?this.pairMap():null,done=new Set(),eps=.002;
  for(const i of ids){
   if(!Number.isInteger(i)||i<0||i>=this.count)throw Error('Индекс вершины вне диапазона.');
   if(done.has(i))continue;
   const other=pairs?.[i]??-1;
   if(symmetry&&other>=0&&other!==i&&ids.has?.(other)&&this._get(i)[0]<0)continue;
   const original=this._get(i),newPos=operation(i,original);
   if(!newPos||newPos.some(v=>!Number.isFinite(v)))continue;
   if(other===i)newPos[0]=0;
   this._set(i,newPos);done.add(i);
   if(symmetry&&other>=0&&other!==i){this._set(other,[-newPos[0],newPos[1],newPos[2]]);done.add(other);}
  }
 }
 transform(ids,kind,axis,value,symmetry=false){
  if(!['move','scale','rotate'].includes(kind)||!['x','y','z'].includes(axis)||!Number.isFinite(value))
   throw Error('Недопустимое преобразование.');
  const set=new Set(ids);if(!set.size)return false;
  let center=[0,0,0];for(const i of set){const p=this._get(i);for(let a=0;a<3;a++)center[a]+=p[a];}
  center=center.map(v=>v/set.size);
  const a=axis==='x'?0:axis==='y'?1:2;
  const radians=value*Math.PI/180,cs=Math.cos(radians),sn=Math.sin(radians);
  this.begin();try{
   this._apply(set,(_,p)=>{
    const out=p.slice();
    if(kind==='move')out[a]+=value;
    else if(kind==='scale')out[a]=center[a]+(out[a]-center[a])*value;
    else {
     const j=(a+1)%3,k=(a+2)%3,u=out[j]-center[j],v=out[k]-center[k];
     out[j]=center[j]+cs*u-sn*v;out[k]=center[k]+sn*u+cs*v;
    }
    return out;
   },symmetry);return this.commit();
  }catch(e){this.cancel();throw e;}
 }
 brush(point,radius,strength,mode,delta=[0,0,0],symmetry=false){
  if(!this.pending)throw Error('Вначале начните мазок кисти.');
  if(!(radius>0)||!(strength>=0&&strength<=1)||!['grab','smooth','inflate','pinch'].includes(mode))
   throw Error('Неверные настройки кисти.');
  if(!this.hash||this.hashRadius!==radius){this.hash=new SpatialHash(this.positions,radius);this.hashRadius=radius;}
  const ids=new Set(this.hash.query(point,radius)),old=this.positions.slice();
  const pairs=symmetry?this.pairMap():null;
  const centerSign=Math.abs(point[0])<.002?0:Math.sign(point[0]);
  const mod=(i,p)=>{
   const d=Math.sqrt(dist2(p,point));const f=(1-(d/radius)**2)**2*strength;
   const out=p.slice();
   if(mode==='grab')for(let a=0;a<3;a++)out[a]+=delta[a]*f;
   if(mode==='inflate')for(let a=0;a<3;a++)out[a]+=this.normals[i*3+a]*radius*.16*f;
   if(mode==='smooth'){
    const neighbors=this.adj[i];if(neighbors?.length){
     for(let a=0;a<3;a++){
      let avg=0;for(const n of neighbors)avg+=old[n*3+a];
      out[a]+=(avg/neighbors.length-p[a])*f*.6;
     }
    }
   }
   if(mode==='pinch'){
    const toward=point.map((v,a)=>v-p[a]),n=[this.normals[i*3],this.normals[i*3+1],this.normals[i*3+2]];
    const dot=toward[0]*n[0]+toward[1]*n[1]+toward[2]*n[2];
    for(let a=0;a<3;a++)out[a]+=(toward[a]-n[a]*dot)*f*.24;
   }
   return out;
  };
  const ordered=[...ids].filter(i=>!symmetry||!pairs||(pairs[i]<0||pairs[i]===i||centerSign===0||this.positions[3*i]*centerSign>=-.002));
  // Avoid double applying a central stroke to both sides.
  const touched=new Set();
  for(const i of ordered){
   if(touched.has(i))continue;
   const p=[old[i*3],old[i*3+1],old[i*3+2]],next=mod(i,p),pair=pairs?.[i]??-1;
   if(pair===i)next[0]=0;
   this._set(i,next);touched.add(i);
   if(symmetry&&pair>=0&&pair!==i){this._set(pair,[-next[0],next[1],next[2]]);touched.add(pair);}
  }
  if(ids.size){this.hash=null;}
  return touched.size;
 }
 exportGlb(){
  if(this.pending)throw Error('Завершите мазок перед экспортом.');
  const binary=this.bin.slice();
  this.normals=calculateNormals(this.positions,this.indices);
  writeFloat32(binary,this.posAcc,this.positions);
  writeFloat32(binary,this.normalAcc,this.normals);
  const pacc=this.doc.accessors[this.posAcc.index];
  pacc.min=[Infinity,Infinity,Infinity];pacc.max=[-Infinity,-Infinity,-Infinity];
  for(let i=0;i<this.positions.length;i++){
   const j=i%3;pacc.min[j]=Math.min(pacc.min[j],this.positions[i]);pacc.max[j]=Math.max(pacc.max[j],this.positions[i]);
  }
  const chunks=this.original.chunks.map(c=>({type:c.type,data:c.type===BIN?binary:c.data}));
  return writeGlb({...this.original,chunks},this.doc);
 }
}
