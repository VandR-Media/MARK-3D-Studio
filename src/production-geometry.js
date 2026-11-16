/**
 * Deterministic mesh surfaces for v0.4. No primitive-only character assembly:
 * lofted contours, swept anatomical rims, authored sections.
 * All geometry is genuine indexed triangle mesh with UV and vertex normals.
 */
import {parseGlb,writeGlb,assertSelfContainedGlb} from './glb.js';
import {recalcNormals,inspectMesh} from './topology.js';
const BIN=0x004e4942;
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const vec3=a=>Array.isArray(a)&&a.length===3&&a.every(finite);
const clamp=(a,b,c)=>Math.min(c,Math.max(b,a));
function check(condition,msg){if(!condition)throw Error('Production geometry: '+msg);}
export function loft(sections,{closeRing=true,capStart=true,capEnd=true}={}){
 check(Array.isArray(sections)&&sections.length>=2&&sections.length<=256,'нужно 2–256 сечений');
 const n=sections[0]?.length;
 check(Number.isInteger(n)&&n>=3&&n<=512,'каждое сечение: 3–512 точек');
 check(sections.every(s=>Array.isArray(s)&&s.length===n&&s.every(vec3)),'сечения различаются или содержат неверные координаты');
 const p=[],uv=[],tri=[];
 for(let j=0;j<sections.length;j++)for(let i=0;i<n;i++){
  p.push(...sections[j][i]);uv.push(i/n,j/(sections.length-1));
 }
 const steps=closeRing?n:n-1;
 for(let j=0;j<sections.length-1;j++)for(let i=0;i<steps;i++){
  const b=j*n+i,c=j*n+((i+1)%n),d=(j+1)*n+i,e=(j+1)*n+((i+1)%n);
  tri.push(b,c,d,c,e,d);
 }
 if(closeRing){
  function cap(j,isEnd){
   const points=sections[j],cent=[0,0,0];
   for(const v of points)for(let a=0;a<3;a++)cent[a]+=v[a]/n;
   const index=p.length/3;p.push(...cent);uv.push(.5,j===0?0:1);
   for(let i=0;i<n;i++){
    const a=j*n+i,b=j*n+(i+1)%n;
    if(isEnd)tri.push(index,a,b);else tri.push(index,b,a);
   }
  }
  if(capStart)cap(0,false);
  if(capEnd)cap(sections.length-1,true);
 }
 return {positions:p,uvs:uv,indices:tri};
}
/** Swept elliptical 3D profile along a curve in 3D. No sphere/cylinder approximations. */
export function sweep(path,{radius=.03,depth=.03,radialSegments=10}={}){
 check(Array.isArray(path)&&path.length>=3&&path.length<=512&&path.every(vec3),'контур должен содержать 3–512 точек');
 check(finite(radius)&&radius>0&&radius<=2&&finite(depth)&&depth>0&&depth<=2,'неверный радиус/глубина');
 check(Number.isInteger(radialSegments)&&radialSegments>=6&&radialSegments<=32,'неверное число сечений');
 const sections=path.map((p,i)=>{
  const prev=path[Math.max(0,i-1)],next=path[Math.min(path.length-1,i+1)];
  const tx=next[0]-prev[0],ty=next[1]-prev[1];
  const len=Math.hypot(tx,ty)||1;
  const nx=-ty/len,ny=tx/len;
  const taper=Math.max(.28,Math.min(1,Math.sqrt(Math.sin(Math.PI*(i+.5)/path.length))));
  return Array.from({length:radialSegments},(_,j)=>{
   const angle=2*Math.PI*j/radialSegments;
   return [p[0]+nx*Math.cos(angle)*radius*taper,
    p[1]+ny*Math.cos(angle)*radius*taper,
    p[2]+Math.sin(angle)*depth*taper];
  });
 });
 return loft(sections);
}
export function shell(center,rx,ry,rz,{rings=16,segments=32}={}){
 check(vec3(center)&&[rx,ry,rz].every(v=>finite(v)&&v>0&&v<=5),'неверный контур оболочки');
 check(Number.isInteger(rings)&&rings>=8&&rings<=128&&Number.isInteger(segments)&&segments>=12&&segments<=128,'неверное разрешение');
 const sections=[];
 for(let i=0;i<=rings;i++){
  const theta=Math.PI*(i+.35)/(rings+.7),height=Math.cos(theta),r=Math.sin(theta);
  sections.push(Array.from({length:segments},(_,j)=>{
   const a=2*Math.PI*j/segments;
   return [center[0]+rx*r*Math.cos(a),center[1]+ry*r*Math.sin(a),center[2]+rz*height];
  }));
 }
 return loft(sections);
}
export function earShell(side,{height=.45,width=.28,depth=.18,headWidth=.5}={}){
 check(side===1||side===-1,'сторона уха должна быть +1 или -1');
 check([height,width,depth].every(v=>finite(v)&&v>.05&&v<1),'размер уха вне диапазона');
 const sections=[],cx=side*(.815+.20*(headWidth-.5)),cy=-.04,cz=.05;
 const rings=[[.08,.07],[.45,.08],[.70,.135],[.92,.14],[1,.025],[.94,-.10],[.12,-.12]];
 const n=48;
 for(const [r,z] of rings)sections.push(Array.from({length:n},(_,j)=>{
  const a=2*Math.PI*j/n,s=Math.sin(a),c=Math.cos(a);
  const lobe=1-.17*Math.max(0,-s);
  return [cx+side*width*r*c*lobe,cy+height*r*s,cz+depth*z/.15];
 }));
 return loft(sections);
}
export function eyeLens(side,{spacing=.43,width=.215,height=.145,forward=.80}={}){
 check(side===1||side===-1,'сторона глаза');
 check([spacing,width,height,forward].every(finite),'параметры глаза');
 return shell([side*spacing,.34,forward],width,height,.10,{rings:22,segments:40});
}
export function irisDisk(side,{spacing=.43,radius=.077,forward=.906}={}){
 return shell([side*spacing,.34,forward],radius,radius,.013,{rings:10,segments:32});
}
export function pupilDisk(side,{spacing=.43,radius=.036,forward=.918}={}){
 return shell([side*spacing,.34,forward],radius,radius,.012,{rings:10,segments:32});
}
export function eyelid(side,upper=true,{spacing=.43,width=.215,height=.145,forward=.86,thickness=.028,lidShape=.5}={}){
 const points=[];
 for(let i=0;i<=32;i++){
  const u=-.98+1.96*i/32,v=Math.sqrt(Math.max(0,1-u*u));
  const x=side*spacing+width*u;
  const y=.34+(upper?1:-1)*height*v*((upper?.95:.78)+.30*(lidShape-.5));
  const z=forward+.06*(1-u*u);
  points.push([x,y,z]);
 }
 return sweep(points,{radius:thickness,depth:thickness*.7});
}
export function eyebrow(side,{spacing=.43,width=.24,height=.11,forward=.84,browRaise=.5}={}){
 const path=[];
 for(let i=0;i<=28;i++){const u=-1+2*i/28;
  path.push([side*spacing+width*u,.57+height*.35*Math.cos(u*Math.PI/2)+.018*u+.17*(browRaise-.5),forward-.06*Math.abs(u)]);
 }
 return sweep(path,{radius:.023,depth:.026});
}
export function lip(upper=true,{width=.34,smile=.015,fullness=.068,forward=.81}={}){
 const path=[];
 for(let i=0;i<=48;i++){
  const u=-1+2*i/48,c=Math.max(0,1-u*u);
  const cupid=Math.exp(-(((Math.abs(u)-.21)/.17)**2));
  const y=upper?-.455+fullness*.25*cupid*c+smile*u*u:
   -.525-fullness*.3*c+smile*u*u;
  path.push([width*u,y,forward+.07*c]);
 }
 return sweep(path,{radius:fullness*(upper?.54:.67),depth:fullness*.6});
}
export function hairCap({length=.45,volume=1,headWidth=.5}={}){
 check(finite(length)&&length>=.15&&length<=.9&&finite(volume)&&volume>=.6&&volume<=1.8,'форма волос вне диапазона');
 const sections=[],rings=26,n=80;
 for(let i=0;i<=rings;i++){
  const t=i/rings;
  const y=.49+(.65+t*.055)*t;
  const r=Math.max(.012,Math.sqrt(Math.max(0,1-((y-.08)/1.15)**2)));
  sections.push(Array.from({length:n},(_,j)=>{
   const a=j*2*Math.PI/n;
   const x=.815*r*Math.sin(a)*volume*(1+.24*(headWidth-.5)),z=.795*r*Math.cos(a)*volume;
   const front=Math.max(0,Math.cos(a));
   return [x,y-(1-t)*length*.18*front,z];
  }));
 }
 return loft(sections);
}
export function hairStrand(index,{count=9,length=.35,volume=1,headWidth=.5}={}){
 check(Number.isInteger(index)&&index>=0&&index<count&&count<=40,'номер пряди');
 const x=(-.56+1.12*(index+.5)/count)*(1+.24*(headWidth-.5)),rootZ=.58;
 const tipX=x+Math.sin(index*2.2)*.055;
 const path=[];
 for(let j=0;j<=20;j++){
  const t=j/20;
  path.push([x+(tipX-x)*t,.91-length*t+.05*Math.sin(t*Math.PI),
   rootZ+.18*Math.sin(t*Math.PI)-.04*t]);
 }
 return sweep(path,{radius:.035*volume,depth:.052*volume});
}
const material=(input={})=>{
 const color=input.color||[.7,.7,.7,1];
 check(Array.isArray(color)&&color.length===4&&color.every(v=>finite(v)&&v>=0&&v<=1),'цвет RGBA должен быть [0..1] x4');
 const metallic=input.metallic??0,roughness=input.roughness??.8;
 check(finite(metallic)&&metallic>=0&&metallic<=1&&finite(roughness)&&roughness>=0&&roughness<=1,'PBR параметры вне диапазона');
 if(input.emissive)check(Array.isArray(input.emissive)&&input.emissive.length===3&&input.emissive.every(v=>finite(v)&&v>=0&&v<=1),'неверный emissive');
 return {name:String(input.name||'Material').slice(0,100),doubleSided:true,
  ...(input.emissive?{emissiveFactor:input.emissive}:{}),
  pbrMetallicRoughness:{baseColorFactor:color,metallicFactor:metallic,roughnessFactor:roughness}};
};
/** Append independent named mesh nodes. glTF source bytes left intact. */
export function appendMeshes(bytes,specs){
 check(Array.isArray(specs)&&specs.length>0&&specs.length<=120,'нужно 1–120 новых мешей');
 const parsed=parseGlb(bytes);assertSelfContainedGlb(parsed.json);
 const doc=structuredClone(parsed.json),view=parsed.chunks.find(c=>c.type===BIN);
 check(view&&doc.buffers?.length===1&&!doc.buffers[0].uri,'требуется GLB с одним встроенным BIN');
 const extras=[],added=[];
 let position=view.data.length;
 for(const spec of specs){
  check(spec&&typeof spec.name==='string'&&/^[\wА-Яа-яЁё .:+-]{1,100}$/.test(spec.name),'неверное имя объекта');
  const g=spec.geometry;
  check(g&&Array.isArray(g.positions)&&Array.isArray(g.indices)&&Array.isArray(g.uvs),'некорректная полигональная геометрия');
  check(g.positions.length>=9&&g.positions.length%3===0&&g.uvs.length===g.positions.length/3*2&&g.indices.length>=3&&g.indices.length%3===0,'несовпадение геометрических атрибутов');
  check(g.positions.every(finite)&&g.uvs.every(finite),'неконечные координаты');
  check(g.indices.every(i=>Number.isInteger(i)&&i>=0&&i<g.positions.length/3),'индекс вершины вне сетки');
  const audit=inspectMesh(g.positions,g.indices);
  check(audit.invalidTriangles===0&&audit.nonManifoldEdges===0,'вырожденные или неманифолдные грани '+spec.name);
  const normals=recalcNormals(g.positions,g.indices);
  const arrays=[Float32Array.from(g.positions),normals,Float32Array.from(g.uvs),
    g.positions.length/3<=65535?Uint16Array.from(g.indices):Uint32Array.from(g.indices)];
  const attr=[];
  for(let j=0;j<arrays.length;j++){
   const a=arrays[j];position=Math.ceil(position/4)*4;
   const v=doc.bufferViews.push({buffer:0,byteOffset:position,byteLength:a.byteLength,
    target:j===3?34963:34962})-1;
   extras.push({position,bytes:new Uint8Array(a.buffer,a.byteOffset,a.byteLength)});
   position+=a.byteLength;
   const kind=j===2?'VEC2':j===3?'SCALAR':'VEC3',den=kind==='VEC2'?2:kind==='VEC3'?3:1;
   const accessor={bufferView:v,componentType:j===3?(a instanceof Uint16Array?5123:5125):5126,
    type:kind,count:a.length/den};
   if(j===0){accessor.min=[0,1,2].map(k=>Math.min(...sampleBounds(g.positions,k)));
    accessor.max=[0,1,2].map(k=>Math.max(...sampleBounds(g.positions,k)));}
   attr.push(doc.accessors.push(accessor)-1);
  }
  const materialIndex=(doc.materials??=[]).push(material(spec.material))-1;
  const meshIndex=doc.meshes.push({name:spec.name,primitives:[{attributes:{
   POSITION:attr[0],NORMAL:attr[1],TEXCOORD_0:attr[2]},indices:attr[3],material:materialIndex}]})-1;
  const nodeIndex=doc.nodes.push({name:spec.name,mesh:meshIndex})-1;
  const scene=doc.scenes[Number.isInteger(doc.scene)?doc.scene:0];
  check(scene,'нет активной сцены');(scene.nodes??=[]).push(nodeIndex);
  added.push({name:spec.name,nodeIndex,meshIndex,materialIndex,vertices:g.positions.length/3,triangles:g.indices.length/3});
 }
 const output=new Uint8Array(Math.ceil(position/4)*4);
 output.set(view.data);
 for(const extra of extras)output.set(extra.bytes,extra.position);
 doc.buffers[0].byteLength=output.length;
 const chunks=parsed.chunks.map(c=>c.type===BIN?{type:BIN,data:output}:c);
 return {bytes:writeGlb({...parsed,chunks},doc),added};
}
function sampleBounds(p,k){const a=[];for(let i=k;i<p.length;i+=3)a.push(p[i]);return a;}

/** Wearable cap geometry defined by authored sectional profiles, not spheres. */
export function capCrown(){
 const n=64,levels=[[.69,1],[.79,.99],[.91,.92],[1.04,.78],[1.14,.48],[1.20,.09]];
 const rings=levels.map(([y,r])=>Array.from({length:n},(_,j)=>{
  const a=j*2*Math.PI/n;return [.785*r*Math.sin(a),y,.755*r*Math.cos(a)-.035];
 }));
 return loft(rings);
}
export function capVisor(){
 const n=28,loop=[];
 for(let i=0;i<=n;i++){
  const x=-.67+1.34*i/n,z=.75+.37*Math.pow(Math.max(0,1-(x/.68)**2),.7);
  loop.push([x,.692-.035*Math.abs(x),z]);
 }
 for(let i=n;i>=0;i--){
  const x=-.67+1.34*i/n;loop.push([x,.692-.035*Math.abs(x),.535]);
 }
 return loft([loop.map(p=>[p[0],p[1],p[2]]),loop.map(p=>[p[0],p[1]-.026,p[2]])]);
}
export function capEmblem(){
 const path=[[-.13,.98,.72],[-.12,1.09,.69],[-.025,1.013,.73],
  [.025,1.013,.73],[.12,1.09,.69],[.13,.98,.72]];
 return sweep(path,{radius:.014,depth:.015});
}
export function headphoneBand(){
 const path=[];
 for(let i=0;i<=48;i++){
  const t=Math.PI*i/48;
  path.push([1.055*Math.cos(t),.17+1.28*Math.sin(t),-.09]);
 }
 return sweep(path,{radius:.047,depth:.063});
}
export function headphoneCup(side){
 check(side===-1||side===1,'сторона чашки наушника');
 const n=48,levels=[[.88,.23],[.97,.30],[1.055,.275],[1.11,.235]];
 const rings=levels.map(([x,r])=>Array.from({length:n},(_,j)=>{
  const a=j*2*Math.PI/n;
  return [x*side,.075+r*Math.cos(a),.035+r*.87*Math.sin(a)];
 }));
 return loft(rings);
}
export function headphoneNeonRim(side){
 check(side===-1||side===1,'сторона кольца подсветки');
 const n=48,r=.256;
 const rings=[1.062,1.084].map(x=>Array.from({length:n},(_,j)=>{
  const a=2*Math.PI*j/n;
  return [x*side,.075+r*Math.cos(a),.035+r*.87*Math.sin(a)];
 }));
 return loft(rings,{capStart:false,capEnd:false});
}
