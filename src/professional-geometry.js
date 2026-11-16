/**
 * MARK Geometry Core — first independent editable topology kernel.
 * Stable vertex/edge/face IDs, explicit directed half-edges and adjacency.
 * Geometry is edited here, never in glTF BIN bytes. GLB is an interchange format.
 * Stage 1: manifold polygon surfaces, corner UV, one PBR material per object.
 * Limitations are explicit: no skinned/morphed GLB, texture transfer, multi-material
 * polygon assignment, non-manifold editing, automatic retopology or booleans.
 */
import {createContourHeadGlb} from './cosmic-head.js';
import {readPrimitive} from './topology.js';
import {writeGlb} from './glb.js';
import {appendMeshes} from './production-geometry.js';
const EPS=1e-10;
const num=x=>typeof x==='number'&&Number.isFinite(x);
const vec=(p,n=3)=>Array.isArray(p)&&p.length===n&&p.every(num);
const add=(a,b)=>a.map((v,i)=>v+b[i]);
const sub=(a,b)=>a.map((v,i)=>v-b[i]);
const mul=(a,k)=>a.map(v=>v*k);
const dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0);
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const norm=a=>Math.hypot(...a);
const unit=a=>mul(a,1/(norm(a)||1));
const edgeKey=(a,b)=>a<b?a+'|'+b:b+'|'+a;
const clamp=x=>Math.max(0,Math.min(1,x));
function insist(ok,message){if(!ok)throw Error('MARK Geometry Core: '+message);}
function clone(x){return structuredClone(x);} // preserves signed zero and exact FLOAT64 on binary re-import
function triangulatePolygon(ids,lookup){
 if(ids.length===3)return [[0,1,2]];
 // Ear clipping for simple planar concave polygons; fails closed if not triangulable.
 const v=ids.map(id=>lookup.get(id).position),normal=[0,0,0];
 for(let i=0;i<v.length;i++){const a=v[i],b=v[(i+1)%v.length];
  normal[0]+=(a[1]-b[1])*(a[2]+b[2]);
  normal[1]+=(a[2]-b[2])*(a[0]+b[0]);
  normal[2]+=(a[0]-b[0])*(a[1]+b[1]);
 }
 const axis=normal.map(Math.abs).indexOf(Math.max(...normal.map(Math.abs)));
 const dim=axis===0?[1,2]:axis===1?[0,2]:[0,1];
 const p=v.map(q=>[q[dim[0]],q[dim[1]]]);
 const signed=p.reduce((s,a,i)=>{const b=p[(i+1)%p.length];return s+a[0]*b[1]-a[1]*b[0];},0);
 insist(Math.abs(signed)>EPS,'вырожденный полигон');
 const orient=Math.sign(signed),order=p.map((_,i)=>i),faces=[];
 const area=(i,j,k)=>{const a=p[i],b=p[j],c=p[k];return (b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);};
 let count=0;
 while(order.length>3){
  insist(count++<ids.length*ids.length,'некорректный контур (самопересечение или непланарный полигон)');
  let found=false;
  for(let j=0;j<order.length;j++){
   const a=order[(j+order.length-1)%order.length],b=order[j],c=order[(j+1)%order.length];
   if(area(a,b,c)*orient<=EPS)continue;
   const inside=order.some(d=>{
    if(d===a||d===b||d===c)return false;
    return area(a,b,d)*orient>=-EPS&&area(b,c,d)*orient>=-EPS&&area(c,a,d)*orient>=-EPS;
   });
   if(inside)continue;
   faces.push([a,b,c]);order.splice(j,1);found=true;break;
  }
  insist(found,'триангуляция заблокирована: контур неразрешим');
 }
 faces.push(order);
 return faces;
}
export class EditableMesh {
 constructor({name='Editable mesh',material=null}={}){
  this.name=name;this.material=material||{name:'MARK Core PBR',color:[.77,.54,.42,1],roughness:.8,metallic:0};
  this.vertices=new Map();this.faces=new Map();this.edges=new Map();this.halfEdges=new Map();
  this.adj=new Map();this._edgeIds=new Map();this._next={v:1,e:1,f:1};
  this.selection=new Set();this.masks=new Map();this.landmarks={};this.regions={};this.referenceViews={};this.history=[];this.future=[];this.revision=0;this.maxHistory=20;
  this._spatial=null;
 }
 static fromGeometry(geom,options={}){
  const m=new EditableMesh(options),{positions,indices,uvs}=geom;
  insist(positions?.length>=9&&positions.length%3===0&&indices?.length%3===0,'некорректная индексированная сетка');
  insist(uvs===null||uvs===undefined||uvs.length===positions.length/3*2,'количество UV отличается от вершин');
  const ids=[];
  for(let i=0;i<positions.length;i+=3)
   ids.push(m._vertex([positions[i],positions[i+1],positions[i+2]],
    uvs?[uvs[(i/3)*2],uvs[(i/3)*2+1]]:[0,0]));
  for(let i=0;i<indices.length;i+=3){
   const tri=[indices[i],indices[i+1],indices[i+2]];
   insist(tri.every(k=>Number.isInteger(k)&&k>=0&&k<ids.length),'индекс выходит за сетку');
   m._face(tri.map(k=>ids[k]),tri.map(k=>m.vertices.get(ids[k]).uv));
  }
  m._rebuild();m.validate({strict:true});
  return m;
 }
 static fromGlb(bytes,{nodeIndex=0,primitiveIndex=0}={}){
  const ctx=readPrimitive(bytes,nodeIndex,primitiveIndex),source=ctx.doc;
  const p=ctx.primitive;
  insist(p.targets===undefined&&!ctx.selected.reason,'неподдерживаемые skin/morph/общие меши');
  const input=source.materials?.[p.material]||{};
  const base=input.pbrMetallicRoughness||{};
  insist(!base.baseColorTexture&&!base.metallicRoughnessTexture&&!input.normalTexture&&!input.occlusionTexture&&!input.emissiveTexture,
   'текстурированный GLB требует сохранения текстур; импорт в Core v1 заблокирован');
  const material={name:input.name||'Imported PBR',color:base.baseColorFactor||[1,1,1,1],
   roughness:base.roughnessFactor??1,metallic:base.metallicFactor??1};
  if(input.emissiveFactor)material.emissive=input.emissiveFactor;
  return EditableMesh.fromGeometry(ctx,{name:ctx.selected.name,material});
 }
 static candidate(){return EditableMesh.fromGlb(createContourHeadGlb());}
 _vertex(position,uv=[0,0]){
  insist(vec(position)&&vec(uv,2),'вершина должна содержать XYZ и UV');
  const id='v'+this._next.v++;this.vertices.set(id,{id,position:[...position],uv:[...uv]});return id;
 }
 _face(ids,cornerUV=null,id=null){
  insist(Array.isArray(ids)&&ids.length>=3&&ids.length<=1024&&ids.every(k=>this.vertices.has(k)),'некорректный полигон');
  insist(new Set(ids).size===ids.length,'полигон содержит дублирующиеся вершины');
  const uv=cornerUV||ids.map(k=>this.vertices.get(k).uv);
  insist(uv.length===ids.length&&uv.every(q=>vec(q,2)),'неверные UV углов');
  const fid=id||'f'+this._next.f++;
  this.faces.set(fid,{id:fid,vertices:[...ids],uv:uv.map(a=>[...a]),material:0});return fid;
 }
 _rebuild(){
  this.edges=new Map();this.halfEdges=new Map();this.adj=new Map();this.incidentFaces=new Map();
  for(const id of this.vertices.keys()){this.adj.set(id,new Set());this.incidentFaces.set(id,new Set());}
  const twins=new Map();
  for(const face of this.faces.values()){
   const n=face.vertices.length,halfIds=[];
   for(let i=0;i<n;i++){
    const from=face.vertices[i],to=face.vertices[(i+1)%n],k=edgeKey(from,to);
    let edge=this.edges.get(k);
    if(!edge){
     const id=this._edgeIds.get(k)||'e'+this._next.e++;
     this._edgeIds.set(k,id);edge={id,a:from,b:to,faces:[],halfEdges:[]};
     this.edges.set(k,edge);
    }
    edge.faces.push(face.id);
    const hid='h:'+face.id+':'+i;
    const he={id:hid,edgeId:edge.id,face:face.id,from,to,next:null,prev:null,twin:null};
    this.halfEdges.set(hid,he);halfIds.push(hid);edge.halfEdges.push(hid);
    this.adj.get(from).add(to);this.adj.get(to).add(from);this.incidentFaces.get(from).add(face.id);
    const opposite=twins.get(to+'>'+from);
    if(opposite){he.twin=opposite;this.halfEdges.get(opposite).twin=hid;}
    twins.set(from+'>'+to,hid);
   }
   for(let i=0;i<n;i++){
    const h=this.halfEdges.get(halfIds[i]);
    h.next=halfIds[(i+1)%n];h.prev=halfIds[(i+n-1)%n];
   }
  }
  this._spatial=null;
 }
 _state(){
  return {name:this.name,material:clone(this.material),vertices:[...this.vertices.values()].map(clone),
   faces:[...this.faces.values()].map(clone),selection:[...this.selection],
   masks:[...this.masks].map(([name,items])=>[name,[...items]]),
   next:clone(this._next),edgeIds:[...this._edgeIds],landmarks:clone(this.landmarks),regions:clone(this.regions),referenceViews:clone(this.referenceViews),revision:this.revision};
 }
 _restore(s){
  this.name=s.name;this.material=clone(s.material);this.vertices=new Map(s.vertices.map(v=>[v.id,clone(v)]));
  this.faces=new Map(s.faces.map(f=>[f.id,clone(f)]));this.selection=new Set(s.selection);
  this.masks=new Map(s.masks.map(([name,items])=>[name,new Map(items)]));
  this._next=clone(s.next);this._edgeIds=new Map(s.edgeIds);this.landmarks=clone(s.landmarks||{});this.regions=clone(s.regions||{});this.referenceViews=clone(s.referenceViews||{});this.revision=s.revision;
  this._rebuild();
 }
 transact(label,fn){
  insist(typeof fn==='function','транзакция требует операцию');
  const before=this._state();
  try{
   const result=fn(this);
   this._rebuild();this.validate({strict:true});
   this.history.push({label,kind:'topology',before});if(this.history.length>this.maxHistory)this.history.shift();
   this.future=[];this.revision++;
   return result;
  }catch(e){this._restore(before);throw e;}
 }
 /** Coordinate-only transactions never allocate full mesh snapshots.
  * Deltas retain only changed IDs and exact FLOAT64 before/after coordinates.
  */
 _coordinateEdit(label,updates){
  const entries=[];
  for(const [id,next] of updates){
   const v=this.vertices.get(id);
   insist(v&&vec(next),'invalid coordinate edit: '+id);
   if(v.position.some((x,i)=>x!==next[i]))entries.push([id,[...v.position],[...next]]);
  }
  if(!entries.length)return 0;
  const selected=new Set(entries.map(a=>a[0]));
  try{
   for(const [id,,after] of entries)this.vertices.get(id).position=after;
   // Validate only incident polygon triangles; topology/adjacency are unchanged.
   const affected=new Set();
   for(const he of this.halfEdges.values())if(selected.has(he.from))affected.add(he.face);
   for(const id of affected){
    const f=this.faces.get(id);
    for(const [a,b,c] of triangulatePolygon(f.vertices,this.vertices)){
     const p=this.vertices.get(f.vertices[a]).position;
     const q=this.vertices.get(f.vertices[b]).position;
     const r=this.vertices.get(f.vertices[c]).position;
     insist(norm(cross(sub(q,p),sub(r,p)))>EPS,'brush creates degenerate face '+id);
    }
   }
  }catch(e){
   for(const [id,before] of entries)this.vertices.get(id).position=before;
   throw e;
  }
  this._spatial=null;
  this.history.push({kind:'coordinates',label,changes:entries});
  if(this.history.length>this.maxHistory)this.history.shift();
  this.future=[];this.revision++;
  return entries.length;
 }
 undo(){
  const prev=this.history.pop();if(!prev)return false;
  if(prev.kind==='coordinates'){
   for(const [id,before] of prev.changes)this.vertices.get(id).position=[...before];
   this._spatial=null;this.future.push(prev);this.revision++;return true;
  }
  this.future.push({label:prev.label,kind:'topology',before:this._state()});
  this._restore(prev.before);return true;
 }
 redo(){
  const next=this.future.pop();if(!next)return false;
  if(next.kind==='coordinates'){
   for(const [id,,after] of next.changes)this.vertices.get(id).position=[...after];
   this._spatial=null;this.history.push(next);this.revision++;return true;
  }
  this.history.push({label:next.label,kind:'topology',before:this._state()});
  this._restore(next.before);return true;
 }
 select(ids){
  insist(Array.isArray(ids)&&ids.every(k=>this.vertices.has(k)),'неизвестный vertex ID');
  this.selection=new Set(ids);return ids.length;
 }
 selectBox(min,max){
  insist(vec(min)&&vec(max)&&min.every((v,i)=>v<=max[i]),'box min/max неверны');
  return this.select([...this.vertices.values()].filter(v=>v.position.every((p,i)=>p>=min[i]&&p<=max[i])).map(v=>v.id));
 }
 selectRadius(point,radius){
  insist(vec(point)&&num(radius)&&radius>0,'радиус области неверен');
  const r2=radius*radius;return this.select([...this.vertices.values()]
   .filter(v=>dot(sub(v.position,point),sub(v.position,point))<=r2).map(v=>v.id));
 }
 vertexNeighbors(id){return [...(this.adj.get(id)||[])];}
 moveSelected(delta,{weight=1}={}){
  insist(vec(delta)&&num(weight)&&weight>=0&&weight<=1,'перемещение должно содержать XYZ и weight');
  insist(this.selection.size>0,'сначала выделите область');
  const updates=new Map();
  for(const id of this.selection)updates.set(id,add(this.vertices.get(id).position,mul(delta,weight)));
  return {verticesChanged:this._coordinateEdit('mesh.edit',updates)};
 }
 faceSubdivide(faceId){
  return this.transact('mesh.subdivide',()=>{
   const f=this.faces.get(faceId);insist(f,'неверный face ID');
   const ids=f.vertices,center=ids.reduce((a,id)=>add(a,this.vertices.get(id).position),[0,0,0]).map(v=>v/ids.length);
   const uv=f.uv.reduce((a,v)=>add(a,v),[0,0]).map(v=>v/ids.length);
   const middle=this._vertex(center,uv);this.faces.delete(faceId);
   for(let i=0;i<ids.length;i++)this._face([ids[i],ids[(i+1)%ids.length],middle],[f.uv[i],f.uv[(i+1)%ids.length],uv]);
   return {removedFace:faceId,centerVertex:middle,addedFaces:ids.length};
  });
 }
 faceExtrude(faceId,distance){
  insist(num(distance)&&Math.abs(distance)>EPS&&Math.abs(distance)<=2,'Extrude distance должно быть −2…2');
  return this.transact('mesh.extrude',()=>{
   const f=this.faces.get(faceId);insist(f,'неверный face ID');
   const ids=f.vertices,normals=triangulatePolygon(ids,this.vertices);
   const a=this.vertices.get(ids[normals[0][0]]).position,b=this.vertices.get(ids[normals[0][1]]).position,
    c=this.vertices.get(ids[normals[0][2]]).position;
   const n=unit(cross(sub(b,a),sub(c,a)));
   insist(norm(n)>EPS,'нельзя выдавить вырожденную грань');
   const newIds=ids.map((id,i)=>this._vertex(add(this.vertices.get(id).position,mul(n,distance)),f.uv[i]));
   this.faces.delete(faceId);this._face(newIds,f.uv,faceId);
   for(let i=0;i<ids.length;i++){
    const j=(i+1)%ids.length;
    this._face([ids[i],ids[j],newIds[j],newIds[i]],[f.uv[i],f.uv[j],f.uv[j],f.uv[i]]);
   }
   return {face:faceId,newVertices:newIds,sideFaces:ids.length};
  });
 }
 _spatialIndex(cell){
  if(this._spatial&&this._spatial.cell===cell)return this._spatial;
  const map=new Map(),inv=1/cell;
  const cellAt=p=>p.map(v=>Math.floor(v*inv));
  for(const v of this.vertices.values()){
   const c=cellAt(v.position),k=c.join(',');
   if(!map.has(k))map.set(k,[]);
   map.get(k).push(v.id);
  }
  return this._spatial={cell,map,cellAt};
 }
 brush({center,radius,strength,mode='grab',delta=[0,0,0],symmetry=false,mask=null}={}){
  insist(vec(center)&&num(radius)&&radius>.001&&radius<=5&&num(strength)&&strength>=0&&strength<=1,
   'кисть требует center/radius/strength');
  insist(['grab','inflate','clay','smooth','relax','pinch','flatten','crease'].includes(mode),'неподдерживаемая кисть');
  insist(vec(delta),'delta должен быть XYZ');
  insist(mask===null||this.masks.has(mask),'название маски неизвестно');
  const src=this._spatialIndex(radius),orig=new Map([...this.vertices].map(([id,v])=>[id,v.position]));
  const brushAt=(point)=>{
   const near=[],min=src.cellAt(point).map(v=>v-1),max=src.cellAt(point).map(v=>v+1),r2=radius*radius;
   for(let x=min[0];x<=max[0];x++)for(let y=min[1];y<=max[1];y++)for(let z=min[2];z<=max[2];z++){
    for(const id of src.map.get([x,y,z].join(','))||[]){
     const pos=orig.get(id),d2=dot(sub(pos,point),sub(pos,point));
     if(d2<=r2){const t=1-Math.sqrt(d2)/radius;near.push([id,t*t*(3-2*t)]);}
    }
   }
   return near;
  };
  const groups=[{point:center,reflect:false},...(symmetry&&Math.abs(center[0])>1e-7?[{point:[-center[0],center[1],center[2]],reflect:true}]:[])];
  // Area-weighted face normals: no approximate Laplacian "curvature normal".
  // Collect only faces incident to an affected vertex, then sum oriented area.
  const normalAt=id=>{
   const incident=this.incidentFaces.get(id);
   if(!incident?.size)return [0,0,1];
   let sum=[0,0,0];
   for(const fid of incident){
    const f=this.faces.get(fid);
    for(const [a,b,c] of triangulatePolygon(f.vertices,this.vertices)){
     const p=orig.get(f.vertices[a]),q=orig.get(f.vertices[b]),r=orig.get(f.vertices[c]);
     sum=add(sum,cross(sub(q,p),sub(r,p)));
    }
   }
   return norm(sum)>EPS?unit(sum):[0,0,1];
  };
  const affected=new Map();
  for(const g of groups)for(const [id,w] of brushAt(g.point)){
   if(affected.has(id)&&w<=affected.get(id).weight)continue;
   affected.set(id,{weight:w,center:g.point,reflect:g.reflect});
  }
  insist(affected.size>0,'кисть не попала на полигональную поверхность');
  const updates=new Map();
   for(const [id,hit] of affected){
    const pos=orig.get(id),center=hit.center,masked=mask?this.masks.get(mask).get(id)??0:1;
    const weight=hit.weight*strength*masked;
    if(weight===0)continue;
    let change=[0,0,0];
    if(mode==='grab')change=mul(hit.reflect?[-delta[0],delta[1],delta[2]]:delta,weight);
    else if(mode==='pinch')change=mul(sub(center,pos),weight*.24);
    else if(mode==='inflate'||mode==='clay')change=mul(normalAt(id),weight*(mode==='clay'?.08:.12));
    else if(mode==='smooth'||mode==='relax'){
     const neighbors=[...(this.adj.get(id)||[])],avg=neighbors.reduce((a,k)=>add(a,orig.get(k)),[0,0,0]);
     if(neighbors.length)change=mul(sub(mul(avg,1/neighbors.length),pos),weight*(mode==='relax'?.6:1));
    }else if(mode==='flatten')change=mul([0,0,center[2]-pos[2]],weight);
    else if(mode==='crease')change=add(mul(sub(center,pos),weight*.20),mul(normalAt(id),-weight*.038));
    updates.set(id,add(pos,change));
   }
   const touched=this._coordinateEdit('sculpt.'+mode,updates);
   return {touched,mode,symmetry};
 }
 setMask(name,ids,weight=1){
  insist(typeof name==='string'&&/^[a-z0-9_-]{1,60}$/.test(name),'неверное имя маски');
  insist(Array.isArray(ids)&&ids.every(id=>this.vertices.has(id))&&num(weight)&&weight>=0&&weight<=1,'неверная маска');
  this.masks.set(name,new Map(ids.map(id=>[id,weight])));return ids.length;
 }
 inspect(){
  let triangles=0,degenerate=0;
  for(const f of this.faces.values()){
   const trianglesLocal=triangulatePolygon(f.vertices,this.vertices);
   triangles+=trianglesLocal.length;
   for(const [a,b,c] of trianglesLocal){
    const p=this.vertices.get(f.vertices[a]).position,q=this.vertices.get(f.vertices[b]).position,
      r=this.vertices.get(f.vertices[c]).position;
    if(norm(cross(sub(q,p),sub(r,p)))<EPS)degenerate++;
   }
  }
  const counts=[...this.edges.values()].map(e=>e.faces.length);
  return {vertices:this.vertices.size,edges:this.edges.size,faces:this.faces.size,
   triangles,halfEdges:this.halfEdges.size,boundaryEdges:counts.filter(v=>v===1).length,
   nonManifoldEdges:counts.filter(v=>v>2).length,degenerateFaces:degenerate,
   selection:this.selection.size,revision:this.revision};
 }
 validate({strict=false}={}){
  insist(this.vertices.size>0&&this.faces.size>0,'модель пуста');
  for(const [id,v] of this.vertices)insist(v.id===id&&vec(v.position)&&vec(v.uv,2),'невалидная вершина '+id);
  for(const [id,f] of this.faces){
   insist(f.id===id&&f.vertices.length===f.uv.length,'сломанный полигон '+id);
   insist(f.vertices.length>=3&&new Set(f.vertices).size===f.vertices.length,'вырожденный контур '+id);
   insist(f.vertices.every(v=>this.vertices.has(v)),'полигон содержит неизвестные вершины '+id);
   insist(f.uv.every(v=>vec(v,2)),'невалидный UV '+id);
  }
  for(const e of this.edges.values()){
   insist(e.faces.length<=2,'неманифолдное ребро '+e.id);
   if(e.faces.length===2){
    const [h1,h2]=e.halfEdges.map(id=>this.halfEdges.get(id));
    insist(h1.from===h2.to&&h1.to===h2.from,'неверная ориентация общей грани '+e.id);
   }
  }
  if(strict){const d=this.inspect();insist(d.degenerateFaces===0,'вырожденные треугольники');}
  return true;
 }
 toGeometry(){
  this.validate({strict:true});
  const positions=[],uvs=[],indices=[],lookup=new Map();
  for(const f of this.faces.values()){
   insist(f.material===0,'несколько материалов по граням ещё не поддерживаются при экспорте');
   const local=[];
   for(let k=0;k<f.vertices.length;k++){
    const id=f.vertices[k],uv=f.uv[k],key=id+':'+uv[0]+':'+uv[1];
    if(!lookup.has(key)){
     const pos=this.vertices.get(id).position;
     lookup.set(key,positions.length/3);positions.push(...pos);uvs.push(...uv);
    }
    local.push(lookup.get(key));
   }
   for(const tri of triangulatePolygon(f.vertices,this.vertices))
    indices.push(local[tri[0]],local[tri[1]],local[tri[2]]);
  }
  return {positions,indices,uvs};
 }
 toGlb(){
  const doc={asset:{version:'2.0',generator:'MARK Geometry Core stage 1'},
   scene:0,scenes:[{nodes:[]}],nodes:[],meshes:[],materials:[],accessors:[],bufferViews:[],buffers:[{byteLength:0}]};
  const empty=writeGlb({chunks:[{type:0x4e4f534a,data:new Uint8Array(0)},
   {type:0x004e4942,data:new Uint8Array(0)}]},doc);
  return appendMeshes(empty,[{name:this.name,geometry:this.toGeometry(),material:this.material}]).bytes;
 }
 toProject({includeUndo=false}={}){
  return {schema:'mark3d/0.1',engine:'MARK Geometry Core stage 1',
   mesh:this._state(),...(includeUndo?{undo:clone(this.history),redo:clone(this.future)}:{})};
 }
 static fromProject(input){
  const project=typeof input==='string'?JSON.parse(input):input;
  insist(project?.schema==='mark3d/0.1'&&project.mesh,'неподдерживаемый .mark3d');
  const mesh=new EditableMesh();mesh._restore(project.mesh);mesh.validate({strict:true});
  if(project.undo){mesh.history=clone(project.undo);mesh.future=clone(project.redo||[]);}
  return mesh;
 }
}
