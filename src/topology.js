/**
 * MARK 3D Studio v0.3: conservative, binary-persistent topology edits.
 * Every operation creates new unique, aligned FLOAT32 attribute/accessor data
 * for the edited primitive. Other GLB buffer views, skins, materials, textures,
 * nodes and animations remain byte-for-byte untouched.
 */
import {parseGlb,writeGlb,assertSelfContainedGlb} from './glb.js';
import {MeshEditor,sceneMeshList} from './mesh-core.js';
const BIN=0x004e4942, EPS=1e-12;
function fail(message){throw new Error('Топология: '+message);}
function getAccessor(doc,bin,id,type){
 const a=doc.accessors?.[id],v=doc.bufferViews?.[a?.bufferView];
 if(!a||!v||a.type!==type||a.sparse||a.normalized||v.buffer!==0)fail('неподдерживаемый accessor '+id);
 const width=type==='VEC2'?2:type==='VEC3'?3:1;
 const size=a.componentType===5126||a.componentType===5125?4:a.componentType===5123?2:a.componentType===5121?1:0;
 if(!size)fail('тип данных accessor не поддерживается');
 const stride=v.byteStride??size*width,offset=(v.byteOffset??0)+(a.byteOffset??0);
 if(stride<size*width||offset<0||offset+(a.count-1)*stride+size*width>bin.length)fail('accessor выходит за BIN');
 const data=new Array(a.count*width),dv=new DataView(bin.buffer,bin.byteOffset,bin.byteLength);
 for(let i=0;i<a.count;i++)for(let j=0;j<width;j++){
  const p=offset+i*stride+j*size;
  data[i*width+j]=a.componentType===5126?dv.getFloat32(p,true):
   a.componentType===5125?dv.getUint32(p,true):a.componentType===5123?dv.getUint16(p,true):dv.getUint8(p);
 }
 return data;
}
export function inspectMesh(positions,indices){
 const edges=new Map(),bad=[],skinny=[];
 for(let k=0;k<indices.length;k+=3){
  const a=indices[k],b=indices[k+1],c=indices[k+2],n=positions.length/3;
  if(![a,b,c].every(i=>Number.isInteger(i)&&i>=0&&i<n)){bad.push(k/3);continue;}
  const p=[a,b,c].map(i=>positions.slice(i*3,i*3+3));
  const u=p[1].map((v,i)=>v-p[0][i]),v=p[2].map((q,i)=>q-p[0][i]);
  const cross=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]];
  const area=Math.hypot(...cross)*.5;
  if(a===b||b===c||a===c||area<EPS)bad.push(k/3);
  const length=[Math.hypot(...u),Math.hypot(...v),Math.hypot(...p[2].map((q,i)=>q-p[1][i]))];
  if(area>EPS&&Math.max(...length)**2/area>60)skinny.push(k/3);
  for(const [i,j] of [[a,b],[b,c],[c,a]]){
   const key=Math.min(i,j)+':'+Math.max(i,j);
   edges.set(key,(edges.get(key)||0)+1);
  }
 }
 const count=Array.from(edges.values());
 return {vertices:positions.length/3,triangles:indices.length/3,
  invalidTriangles:bad.length,degenerateFaces:bad,skinnyTriangles:skinny.length,
  boundaryEdges:count.filter(n=>n===1).length,nonManifoldEdges:count.filter(n=>n>2).length};
}
export function recalcNormals(positions,indices){
 const out=new Float32Array(positions.length);
 for(let k=0;k<indices.length;k+=3){
  const a=indices[k]*3,b=indices[k+1]*3,c=indices[k+2]*3;
  const ax=positions[b]-positions[a],ay=positions[b+1]-positions[a+1],az=positions[b+2]-positions[a+2];
  const bx=positions[c]-positions[a],by=positions[c+1]-positions[a+1],bz=positions[c+2]-positions[a+2];
  const x=ay*bz-az*by,y=az*bx-ax*bz,z=ax*by-ay*bx;
  for(const i of [a,b,c]){out[i]+=x;out[i+1]+=y;out[i+2]+=z;}
 }
 for(let i=0;i<out.length;i+=3){const d=Math.hypot(out[i],out[i+1],out[i+2])||1;
  out[i]/=d;out[i+1]/=d;out[i+2]/=d;}
 return out;
}
export function readPrimitive(bytes,nodeIndex=0,primitiveIndex=0){
 const parsed=parseGlb(bytes);assertSelfContainedGlb(parsed.json);
 const doc=parsed.json,bin=parsed.chunks.find(c=>c.type===BIN)?.data;
 if(!bin||doc.buffers?.length!==1||doc.buffers[0].uri!==undefined)fail('требуется один встроенный BIN');
 const selected=sceneMeshList(doc).find(d=>d.nodeIndex===nodeIndex&&d.primitiveIndex===primitiveIndex);
 if(!selected)fail('объект или примитив не найден');
 if(!selected.editable)fail('операция заблокирована: '+selected.reason);
 const p=doc.meshes[selected.meshIndex].primitives[primitiveIndex];
 const attrs=Object.keys(p.attributes||{}),allowed=['POSITION','NORMAL','TEXCOORD_0'];
 if(attrs.some(x=>!allowed.includes(x)))fail('дополнительные атрибуты требуют переноса весов/цветов/тангентов: '+attrs.filter(x=>!allowed.includes(x)).join(', '));
 if(p.extensions&&Object.keys(p.extensions).length)fail('расширения примитива не поддерживают редактирование топологии');
 // Constructing MeshEditor also verifies shared normal accessors, stride and indices.
 const index=sceneMeshList(doc).findIndex(d=>d.nodeIndex===nodeIndex&&d.primitiveIndex===primitiveIndex);
 const editor=new MeshEditor(bytes,index);
 const positions=Array.from(editor.positions),indices=Array.from(editor.indices);
 const uvs=p.attributes.TEXCOORD_0===undefined?null:getAccessor(doc,bin,p.attributes.TEXCOORD_0,'VEC2');
 if(uvs&&uvs.length!==positions.length/3*2)fail('число UV не соответствует вершинам');
 const original=inspectMesh(positions,indices);
 if(original.invalidTriangles||original.nonManifoldEdges)fail('исходная сетка содержит вырожденные грани или неманифолдные рёбра');
 return {parsed,doc,bin,selected,primitive:p,positions,indices,uvs,original};
}
function appendViews(ctx,positions,indices,uvs){
 const {doc,parsed,primitive}=ctx;
 const norm=recalcNormals(positions,indices),p=Float32Array.from(positions);
 const index=positions.length/3<=65535?Uint16Array.from(indices):Uint32Array.from(indices);
 const arrays=[p,norm,...(uvs?[Float32Array.from(uvs)]:[]),index];
 let bin=ctx.bin,viewIds=[],accIds=[];
 for(const [i,array] of arrays.entries()){
  const offset=Math.ceil(bin.length/4)*4,newBytes=new Uint8Array(offset+array.byteLength);
  newBytes.set(bin);newBytes.set(new Uint8Array(array.buffer,array.byteOffset,array.byteLength),offset);
  bin=newBytes;const target=i===arrays.length-1?34963:34962;
  const v=doc.bufferViews.push({buffer:0,byteOffset:offset,byteLength:array.byteLength,target})-1;
  const type=i===arrays.length-1?'SCALAR':i===2&&Boolean(uvs)?'VEC2':'VEC3';
  const accessor={bufferView:v,componentType:i===arrays.length-1?(index instanceof Uint16Array?5123:5125):5126,
   count:array.length/(type==='VEC3'?3:type==='VEC2'?2:1),type};
  if(i===0){
   accessor.min=[Infinity,Infinity,Infinity];accessor.max=[-Infinity,-Infinity,-Infinity];
   for(let k=0;k<positions.length;k++){const a=k%3;accessor.min[a]=Math.min(accessor.min[a],positions[k]);accessor.max[a]=Math.max(accessor.max[a],positions[k]);}
  }
  const id=doc.accessors.push(accessor)-1;viewIds.push(v);accIds.push(id);
 }
 primitive.attributes.POSITION=accIds[0];primitive.attributes.NORMAL=accIds[1];
 if(uvs)primitive.attributes.TEXCOORD_0=accIds[2];
 primitive.indices=accIds.at(-1);
 doc.buffers[0].byteLength=bin.length;
 const chunks=parsed.chunks.map(c=>c.type===BIN?{type:BIN,data:bin}:c);
 return writeGlb({...parsed,chunks},doc);
}
export function topologyEdit(bytes,{nodeIndex=0,primitiveIndex=0,operation='subdivide',faceIndex=0,amount=0.15,ratio=0.3,vertices=[],threshold=.002}={}){
 const ctx=readPrimitive(bytes,nodeIndex,primitiveIndex),{positions:p,indices:idx,uvs}=ctx;
 if(p.length/3>100000||idx.length/3>180000)fail('слишком много полигонов для безопасной операции на смартфоне');
 const tri=idx.length/3,face=Number(faceIndex);
 if(!Number.isInteger(face)||face<0||face>=tri)fail('выделите существующий полигон');
 const ia=idx.slice(face*3,face*3+3);
 const at=i=>p.slice(i*3,i*3+3),uv=i=>uvs?.slice(i*2,i*2+2);
 function add(position,tex){
  if(position.some(x=>!Number.isFinite(x)))fail('неверные координаты');
  const id=p.length/3;p.push(...position);if(uvs)uvs.push(...tex);return id;
 }
 const center=[0,1,2].map(axis=>(p[ia[0]*3+axis]+p[ia[1]*3+axis]+p[ia[2]*3+axis])/3);
 const centerUV=uvs?[0,1].map(axis=>(uvs[ia[0]*2+axis]+uvs[ia[1]*2+axis]+uvs[ia[2]*2+axis])/3):null;
 const replace=triangles=>idx.splice(face*3,3,...triangles.flat());
 if(operation==='subdivide'){
  const mid=add(center,centerUV);
  replace([[ia[0],ia[1],mid],[ia[1],ia[2],mid],[ia[2],ia[0],mid]]);
 }else if(operation==='inset'||operation==='extrude'){
  const amountSafe=Number(amount),t=Number(ratio);
  if(!Number.isFinite(amountSafe)||Math.abs(amountSafe)>2||!(t>.02&&t<.9))fail('допустимый Inset: 0.02–0.90; Extrude: −2…2');
  const normal=(()=>{const a=at(ia[0]),b=at(ia[1]),c=at(ia[2]),u=b.map((x,i)=>x-a[i]),v=c.map((x,i)=>x-a[i]);
   const n=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]],l=Math.hypot(...n);if(l<EPS)fail('нельзя выдавить вырожденную грань');return n.map(x=>x/l);})();
  const top=ia.map(i=>{
   const orig=at(i),pt=operation==='inset'?orig.map((v,k)=>v*(1-t)+center[k]*t):orig.map((v,k)=>v+normal[k]*amountSafe);
   const uv0=uv(i);return add(pt,operation==='inset'?uv0?.map((v,k)=>v*(1-t)+centerUV[k]*t):uv0);
  });
  const faces=[[top[0],top[1],top[2]]];
  for(let j=0;j<3;j++){const k=(j+1)%3;
   faces.push([ia[j],ia[k],top[k]],[ia[j],top[k],top[j]]);
  }
  replace(faces);
 }else if(operation==='weld'||operation==='merge'){
  const selected=Array.from(new Set(vertices.map(Number)));
  if(selected.length<2)fail('выделите как минимум две вершины');
  if(selected.some(i=>!Number.isInteger(i)||i<0||i>=p.length/3))fail('неверный индекс вершины');
  if(!(threshold>0&&threshold<=.1))fail('порог Weld должен быть от 0 до 0.1');
  const remap=Array.from({length:p.length/3},(_,i)=>i);
  for(let k=1;k<selected.length;k++){
   const a=selected[0],b=selected[k];
   const d=Math.hypot(...at(a).map((v,i)=>v-at(b)[i]));
   if(d>threshold)fail('Merge/Weld блокирован: вершины слишком далеко друг от друга');
   if(uvs&&Math.hypot(...uv(a).map((v,i)=>v-uv(b)[i]))>.00001)fail('Merge/Weld блокирован: разные UV швов');
   remap[b]=a;
  }
  const newIndex=idx.map(i=>remap[i]);
  if(newIndex.some((v,k)=>newIndex[Math.floor(k/3)*3+(k+1)%3]===v||newIndex[Math.floor(k/3)*3+(k+2)%3]===v))
   fail('объединение создаёт вырожденные грани; операция отменена');
  for(let i=0;i<idx.length;i++)idx[i]=newIndex[i]; // Preserve unattached seam-safe vertices.
 }else if(operation==='normals'){
  // no topology change; still rewrite accessor to ensure normal vectors stored in BIN.
 }else if(operation==='delete'){
  fail('удаление граней создаёт отверстия; операция заблокирована до инструмента закрытия границ');
 }else if(operation==='loopcut'){
  fail('Loop Cut доступен только на подходящих кольцах квадов; текущая треугольная сетка не поддерживается');
 }else fail('неизвестная операция');
 const audit=inspectMesh(p,idx);
 if(audit.invalidTriangles||audit.nonManifoldEdges)fail('операция создаёт повреждённую геометрию');
 if(ctx.original.boundaryEdges===0&&audit.boundaryEdges>0)fail('операция создаёт отверстие в замкнутой сетке');
 const out=appendViews(ctx,p,idx,uvs);
 return {bytes:out,before:ctx.original,after:audit,operation};
}
