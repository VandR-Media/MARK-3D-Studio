/**
 * GLB semantic roundtrip checker. Compares decoded vertex/index data, mesh
 * primitives, PBR numbers and node matrices rather than byte hashes or counts.
 * This is a strict regression gate, not a promise of generic extension fidelity.
 */
import {parseGlb} from '../glb.js';
import {PNG} from 'pngjs';
const TYPES={SCALAR:1,VEC2:2,VEC3:3,VEC4:4,MAT2:4,MAT3:9,MAT4:16};
const COMPONENT={5120:['getInt8',1],5121:['getUint8',1],5122:['getInt16',2],
 5123:['getUint16',2],5125:['getUint32',4],5126:['getFloat32',4]};
const nearly=(a,b,e)=>Math.abs(a-b)<=e;
function accessor(doc,bin,id){
 const a=doc.accessors?.[id],v=doc.bufferViews?.[a?.bufferView];
 if(!a||!v||a.sparse)throw Error('Unsupported/sparse accessor '+id);
 if(v.buffer!==0)throw Error('External buffer in accessor '+id);
 const [getter,size]=COMPONENT[a.componentType]||[];
 const components=TYPES[a.type];
 if(!getter||!components)throw Error('Unknown accessor layout '+id);
 const stride=v.byteStride||components*size;
 const view=new DataView(bin.buffer,bin.byteOffset,bin.byteLength);
 const values=[];
 for(let i=0;i<a.count;i++)for(let j=0;j<components;j++){
  const offset=(v.byteOffset||0)+(a.byteOffset||0)+i*stride+j*size;
  if(offset+size>bin.length)throw Error('Truncated vertex/index data '+id);
  let value=view[getter](offset,true);
  if(a.normalized&&a.componentType!==5126){
   if([5120,5122].includes(a.componentType))value=Math.max(-1,value/(a.componentType===5120?127:32767));
   else value=value/(a.componentType===5121?255:a.componentType===5123?65535:4294967295);
  }
  values.push(value);
 }
 return values;
}
function assertEqual(a,b,path,epsilon=1e-5){
 if(Array.isArray(a)||Array.isArray(b)){
  if(!Array.isArray(a)||!Array.isArray(b)||a.length!==b.length)
   throw Error(path+' array length/shape mismatch');
  for(let i=0;i<a.length;i++)assertEqual(a[i],b[i],path+'['+i+']',epsilon);
 }else if(a&&b&&typeof a==='object'&&typeof b==='object'){
  const keys=Object.keys(a);
  if(keys.length!==Object.keys(b).length)throw Error(path+' keys mismatch');
  for(const k of keys){
   if(!Object.hasOwn(b,k))throw Error(path+' missing key '+k);
   assertEqual(a[k],b[k],path+'.'+k,epsilon);
  }
 }else if(typeof a==='number'&&typeof b==='number'){
  if(!nearly(a,b,epsilon))throw Error(path+' numerical drift '+a+' vs '+b);
 }else if(a!==b)throw Error(path+' mismatch '+String(a)+' vs '+String(b));
}
function semanticMaterial(m){
 const p=m?.pbrMetallicRoughness||{},ext=m?.extensions||{};
 const transmission=ext.KHR_materials_transmission?.transmissionFactor??0;
 const ior=ext.KHR_materials_ior?.ior??1.5;
 return {
  color:p.baseColorFactor||[1,1,1,1],
  metallic:p.metallicFactor??1,roughness:p.roughnessFactor??1,
  emissive:m?.emissiveFactor||[0,0,0],alphaMode:m?.alphaMode||'OPAQUE',
  alphaCutoff:m?.alphaCutoff??.5,doubleSided:m?.doubleSided||false,
  transmission,ior,
  textureSlots:['baseColorTexture','metallicRoughnessTexture'].map(k=>Boolean(p[k]))
   .concat(['normalTexture','occlusionTexture','emissiveTexture'].map(k=>Boolean(m?.[k]))),
 };
}
function binData(parsed){
 return parsed.chunks.find(c=>c.type===0x004e4942)?.data||new Uint8Array();
}
function imageBytes(doc,bin,image){
 if(image.bufferView!==undefined){
  const v=doc.bufferViews[image.bufferView];
  if(!v||v.buffer!==0)throw Error('Missing embedded image buffer view');
  return bin.slice(v.byteOffset||0,(v.byteOffset||0)+v.byteLength);
 }
 if(image.uri?.startsWith('data:')){
  const encoded=image.uri.split(',')[1];
  return image.uri.includes(';base64,')?
   Uint8Array.from(Buffer.from(encoded,'base64')):new TextEncoder().encode(decodeURIComponent(encoded));
 }
 throw Error('GLB image is not embedded');
}
function compareImages(A,ab,B,bb,epsilon){
 if((A.images?.length||0)!==(B.images?.length||0))throw Error('Embedded image count changed');
 for(let i=0;i<(A.images||[]).length;i++){
  const x=A.images[i],y=B.images[i];
  const left=imageBytes(A,ab,x),right=imageBytes(B,bb,y);
  if((x.mimeType==='image/png'||left[0]===137)&&
     (y.mimeType==='image/png'||right[0]===137)){
   const a=PNG.sync.read(Buffer.from(left)),b=PNG.sync.read(Buffer.from(right));
   if(a.width!==b.width||a.height!==b.height)throw Error('Texture dimensions changed '+i);
   if(!Buffer.from(a.data).equals(Buffer.from(b.data)))
    throw Error('Embedded texture pixel data changed '+i);
  }else if(!Buffer.from(left).equals(Buffer.from(right)))
   throw Error('Embedded non-PNG image bytes changed '+i+'; manual decoding required');
 }
}
function localTRS(n){
 if(n.matrix)return {matrix:n.matrix};
 return {translation:n.translation||[0,0,0],rotation:n.rotation||[0,0,0,1],
  scale:n.scale||[1,1,1]};
}
function parents(nodes){
 const p=nodes.map(()=>-1);
 nodes.forEach((n,i)=>(n.children||[]).forEach(k=>{if(p[k]!==-1)throw Error('Multiple parents '+k);p[k]=i;}));
 return p;
}
const I=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];
function multiply(a,b){
 const out=Array(16).fill(0);
 for(let c=0;c<4;c++)for(let r=0;r<4;r++)
  for(let k=0;k<4;k++)out[c*4+r]+=a[k*4+r]*b[c*4+k];
 return out;
}
function matrix(n){
 if(n.matrix)return n.matrix;
 const [x,y,z,w]=n.rotation||[0,0,0,1];
 const [sx,sy,sz]=n.scale||[1,1,1];
 const [tx,ty,tz]=n.translation||[0,0,0];
 return [
  (1-2*(y*y+z*z))*sx,2*(x*y+w*z)*sx,2*(x*z-w*y)*sx,0,
  2*(x*y-w*z)*sy,(1-2*(x*x+z*z))*sy,2*(y*z+w*x)*sy,0,
  2*(x*z+w*y)*sz,2*(y*z-w*x)*sz,(1-2*(x*x+y*y))*sz,0,
  tx,ty,tz,1
 ];
}
function nodeWorlds(doc){
 const nodes=doc.nodes||[],parent=parents(nodes),cache=new Map(),active=new Set();
 function world(i){
  if(cache.has(i))return cache.get(i);
  if(active.has(i))throw Error('GLB hierarchy cycle at '+i);
  active.add(i);
  const result=multiply(parent[i]<0?I:world(parent[i]),matrix(nodes[i]));
  active.delete(i);cache.set(i,result);
  return result;
 }
 return nodes.map((_,i)=>world(i));
}
function meshParentTree(doc){
 const nodes=doc.nodes||[],parent=parents(nodes);
 return nodes.map((n,i)=>{
  if(n.mesh===undefined)return undefined;
  let p=parent[i];
  while(p>=0&&nodes[p].mesh===undefined)p=parent[p];
  return p<0?null:nodes[p].mesh;
 }).filter(x=>x!==undefined);
}
export function compareGlbFidelity(before,after,{epsilon=1e-5,allowChangedMeshes=[]}={}){
 const a=parseGlb(before),b=parseGlb(after),A=a.json,B=b.json;
 const allowed=new Set(allowChangedMeshes);
 const findings={epsilon,meshesCompared:0,accessorValuesCompared:0,materialsCompared:0,
  nodesCompared:0,imagesCompared:0,ignoredChanges:allowChangedMeshes};
 assertEqual(A.meshes?.length||0,B.meshes?.length||0,'meshes.length');
 const ab=binData(a),bb=binData(b);
 for(let i=0;i<(A.meshes||[]).length;i++){
  const x=A.meshes[i],y=B.meshes[i];
  assertEqual(x.primitives.length,y.primitives.length,'mesh['+i+'].primitives');
  for(let k=0;k<x.primitives.length;k++){
   const p=x.primitives[k],q=y.primitives[k];
   assertEqual(p.mode??4,q.mode??4,'mesh['+i+'].topology');
   if((p.indices!==undefined)!==(q.indices!==undefined))throw Error('index presence mismatch');
   for(const semantic of ['POSITION','NORMAL','TEXCOORD_0','TEXCOORD_1','TANGENT']){
    const ax=p.attributes?.[semantic],bx=q.attributes?.[semantic];
    if((ax===undefined)!==(bx===undefined))throw Error('Attribute lost '+i+'.'+semantic);
    if(ax!==undefined){
     const av=accessor(A,ab,ax),bv=accessor(B,bb,bx);
     assertEqual(av,bv,'mesh['+i+'].'+semantic,epsilon);
     findings.accessorValuesCompared+=av.length;
    }
   }
   if(p.indices!==undefined){
    const av=accessor(A,ab,p.indices),bv=accessor(B,bb,q.indices);
    assertEqual(av,bv,'mesh['+i+'].indices',0);
    findings.accessorValuesCompared+=av.length;
   }
   if(!allowed.has(i)){
    assertEqual(semanticMaterial(A.materials?.[p.material]),
     semanticMaterial(B.materials?.[q.material]),'mesh['+i+'].material',epsilon);
    findings.materialsCompared++;
   }
  }
  findings.meshesCompared++;
 }
 // Exporters may include cameras and lights as extra nodes. Preserve the mesh
 // ownership tree and local transforms, independently from non-mesh extras.
 const meshNodes=doc=>(doc.nodes||[]).map((n,index)=>({n,index})).filter(x=>x.n.mesh!==undefined);
 const am=meshNodes(A),bm=meshNodes(B);
 assertEqual(am.length,bm.length,'meshNode count');
 assertEqual(meshParentTree(A),meshParentTree(B),'mesh parent hierarchy');
 const worldA=nodeWorlds(A),worldB=nodeWorlds(B);
 for(let i=0;i<am.length;i++){
  assertEqual(am[i].n.mesh,bm[i].n.mesh,'meshNode['+i+'].geometry');
  if(!allowed.has(am[i].n.mesh)){
   assertEqual(worldA[am[i].index],worldB[bm[i].index],
    'meshNode['+i+'].worldMatrix',epsilon);
  }
  findings.nodesCompared++;
 }
 // Do not silently lose embedded textures, even if their PNG encoding changes.
 assertEqual(A.images?.length||0,B.images?.length||0,'image count');
 assertEqual(A.textures?.length||0,B.textures?.length||0,'texture count');
 compareImages(A,ab,B,bb,epsilon);
 findings.imagesCompared=A.images?.length||0;
 return {status:'pass',...findings};
}
