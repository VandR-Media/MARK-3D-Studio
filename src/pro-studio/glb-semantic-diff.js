/**
 * Numeric glTF 2.0 semantic comparison, independent of Three.js renderer.
 * It compares decoded accessor values, not JSON indices or array lengths alone.
 * Supported profile: single BIN chunk, non-sparse/non-interleaved or strided
 * FLOAT/UNSIGNED/SHORT attributes, static source + skin/morph/animation data.
 * This is deliberately NOT a claim of universal glTF semantic equality.
 */
import {parseGlb} from '../glb.js';
const TYPES={SCALAR:1,VEC2:2,VEC3:3,VEC4:4,MAT2:4,MAT3:9,MAT4:16};
const FORMATS={5120:[1,'getInt8'],5121:[1,'getUint8'],5122:[2,'getInt16'],
 5123:[2,'getUint16'],5125:[4,'getUint32'],5126:[4,'getFloat32']};
const fail=(s)=>{throw Error('MARK_SEMANTIC_'+s)};
const parse=input=>{
 const glb=parseGlb(input),bin=glb.chunks.find(x=>x.type===0x004e4942)?.data;
 if(!bin)fail('NO_BIN');
 return {doc:glb.json,bin,view:new DataView(bin.buffer,bin.byteOffset,bin.byteLength)};
};
function accessor(s,index){
 const a=s.doc.accessors?.[index];
 if(!a||a.bufferView===undefined||a.sparse)fail('UNSUPPORTED_ACCESSOR_'+index);
 const b=s.doc.bufferViews?.[a.bufferView],f=FORMATS[a.componentType],count=TYPES[a.type];
 if(!b||!f||!count||b.buffer!==0||!Number.isInteger(a.count)||a.count<0)
  fail('INVALID_ACCESSOR_'+index);
 const [unit,method]=f,elemBytes=count*unit,stride=b.byteStride||elemBytes;
 const start=(b.byteOffset||0)+(a.byteOffset||0);
 if(stride<elemBytes||start<0||
   start+(a.count?((a.count-1)*stride+elemBytes):0)>s.bin.byteLength)
  fail('ACCESSOR_RANGE_'+index);
 const numbers=[];
 for(let i=0;i<a.count;i++)for(let j=0;j<count;j++){
  const x=s.view[method](start+i*stride+j*unit,true);
  if(a.normalized&&a.componentType!==5126){
   const norm=a.componentType===5120?Math.max(x/127,-1):
    a.componentType===5121?x/255:
    a.componentType===5122?Math.max(x/32767,-1):
    a.componentType===5123?x/65535:x/4294967295;
   numbers.push(norm);
  }else numbers.push(x);
 }
 return {numbers,count:a.count,components:count,normalized:Boolean(a.normalized)};
}
function imageBytes(s,i){
 const im=s.doc.images?.[i];
 if(!im)return null;
 if(typeof im.uri==='string'){
  if(!im.uri.startsWith('data:'))fail('EXTERNAL_IMAGE');
  // Image byte comparison for URI-backed images is reported separately
  // because their PNG/JPEG encodings may differ even if pixels match.
  return null;
 }
 const b=s.doc.bufferViews?.[im.bufferView];
 if(!b||b.buffer!==0||b.byteLength>32*1024*1024)fail('IMAGE_VIEW');
 const start=b.byteOffset||0;
 if(start+b.byteLength>s.bin.length)fail('IMAGE_RANGE');
 return s.bin.slice(start,start+b.byteLength);
}
const normalizedPbr=m=>{
 const p=m?.pbrMetallicRoughness||{};
 return {
  color:p.baseColorFactor||[1,1,1,1],
  metallic:p.metallicFactor??1,roughness:p.roughnessFactor??1,
  baseColorTex:p.baseColorTexture?.texCoord??0,
  hasBaseTexture:Boolean(p.baseColorTexture),
  hasMRTexture:Boolean(p.metallicRoughnessTexture),
  hasNormal:Boolean(m?.normalTexture),
  hasOcclusion:Boolean(m?.occlusionTexture),
  emissive:m?.emissiveFactor||[0,0,0],
  alphaMode:m?.alphaMode||'OPAQUE',
  doubleSided:Boolean(m?.doubleSided),
  alphaCutoff:m?.alphaCutoff??.5
 };
};
function recordNodeNames(s){
 const map=new Map();
 for(let i=0;i<(s.doc.nodes||[]).length;i++){
  const n=s.doc.nodes[i],name=n.name||'__node_index_'+i;
  if(map.has(name))fail('DUPLICATE_NODE_NAME_'+name);
  map.set(name,{index:i,node:n});
 }
 return map;
}
function paths(s){
 const parents=new Map(),names=recordNodeNames(s);
 for(const n of s.doc.nodes||[])for(const child of n.children||[]){
  const idx=s.doc.nodes.indexOf(n);
  if(parents.has(child))fail('MULTIPLE_PARENT');
  parents.set(child,idx);
 }
 const output=new Map();
 for(const [name,{index,node}] of names){
  const parent=parents.get(index);
  output.set(name,{index,node,parentName:parent===undefined?null:
   s.doc.nodes[parent].name||'__node_index_'+parent});
 }
 return output;
}
const maxDiff=(a,b)=>{
 let largest=0;
 if(a.length!==b.length)return Infinity;
 for(let i=0;i<a.length;i++){
  if(!Number.isFinite(a[i])||!Number.isFinite(b[i]))return Infinity;
  largest=Math.max(largest,Math.abs(a[i]-b[i]));
 }
 return largest;
};
export function compareGlbSemantics(before,after,{epsilon=1e-4,
 allowEditedNodes=[],allowEditedMaterials=[]}={}){
 const a=parse(before),b=parse(after);
 const diagnostics=[],tested=[],notCompared=[];
 const add=(key,actual,expected,metric)=>{
  if(actual!==expected)diagnostics.push({key,expected,actual,metric});
  else tested.push(key);
 };
 const compare=(key,x,y,tol=epsilon)=>{
  const distance=maxDiff(x,y);
  if(!(distance<=tol))diagnostics.push({key,maxAbsError:distance,
   expectedLength:x.length,actualLength:y.length,tolerance:tol});
  else tested.push(key);
 };
 const src=a.doc,dst=b.doc;
 const catalog=['meshes','skins','animations','materials','textures','images'];
 for(const key of catalog)
  add('count.'+key,(dst[key]||[]).length,(src[key]||[]).length);
 const nodesA=paths(a),nodesB=paths(b);
 // GLTFExporter is allowed to wrap the source in an extra scene/group node.
 for(const [name,n] of nodesA){
  const m=nodesB.get(name);
  if(!m){diagnostics.push({key:'node.missing',name});continue;}
  if(allowEditedNodes.includes(name))continue;
  const fields=[['translation',[0,0,0]],['rotation',[0,0,0,1]],['scale',[1,1,1]]];
  for(const [k,defaults] of fields)compare('node.'+name+'.'+k,
   n.node[k]||defaults,m.node[k]||defaults);
  if(n.parentName!==m.parentName){
   // An extra root node may be inserted on export; only the original
   // root's parent can change, and only to a previously absent wrapper.
   if(n.parentName!==null||nodesA.has(m.parentName))
    diagnostics.push({key:'node.parent',name,before:n.parentName,after:m.parentName});
  }
 }
 for(let i=0;i<(src.meshes||[]).length;i++){
  const x=src.meshes[i],y=dst.meshes?.[i];
  if(!y)continue;
  add('mesh.'+i+'.primitives',(y.primitives||[]).length,(x.primitives||[]).length);
  for(let j=0;j<x.primitives.length;j++){
   const p=x.primitives[j],q=y.primitives?.[j];
   if(!q){diagnostics.push({key:'primitive.missing',i,j});continue;}
   for(const type of ['POSITION','NORMAL','TANGENT','TEXCOORD_0','TEXCOORD_1',
    'COLOR_0','JOINTS_0','WEIGHTS_0']){
    const u=p.attributes[type],v=q.attributes?.[type];
    if((u===undefined)!==(v===undefined)){
     diagnostics.push({key:`primitive.${i}.${j}.${type}.presence`});continue;
    }
    if(u===undefined)continue;
    const aa=accessor(a,u),bb=accessor(b,v);
    compare(`mesh.${i}.primitive.${j}.${type}`,aa.numbers,bb.numbers,
     type==='WEIGHTS_0'?Math.max(epsilon,1/32767):epsilon);
   }
   const targets=p.targets||[],targetsAfter=q.targets||[];
   add('targets.'+i+'.'+j,targetsAfter.length,targets.length);
   for(let k=0;k<targets.length;k++){
    for(const [attr,idx] of Object.entries(targets[k])){
     const newer=targetsAfter[k]?.[attr];
     if(newer===undefined){diagnostics.push({key:'morph.missing',i,j,k,attr});continue;}
     compare(`morph.${i}.${j}.${k}.${attr}`,
      accessor(a,idx).numbers,accessor(b,newer).numbers);
    }
   }
   if(p.indices!==undefined&&q.indices!==undefined)
    compare(`mesh.${i}.primitive.${j}.indices`,
     accessor(a,p.indices).numbers,accessor(b,q.indices).numbers,0);
   else if((p.indices===undefined)!==(q.indices===undefined))
    notCompared.push('Indices are not identically represented at primitive '+i+'/'+j);
  }
 }
 for(let i=0;i<(src.skins||[]).length;i++){
  const x=src.skins[i],y=dst.skins?.[i];
  if(!y)continue;
  const names=s=>s.map(z=>src.nodes[z]?.name);
  const actualNames=y.joints.map(z=>dst.nodes[z]?.name);
  add('skin.'+i+'.jointNames',JSON.stringify(actualNames),JSON.stringify(names(x.joints)));
  if(x.inverseBindMatrices===undefined||y.inverseBindMatrices===undefined)
   notCompared.push('skin '+i+' inverseBindMatrices absent');
  else compare('skin.'+i+'.inverseBindMatrices',
   accessor(a,x.inverseBindMatrices).numbers,accessor(b,y.inverseBindMatrices).numbers);
 }
 function tracks(s){
  const clips=new Map();
  for(const animation of s.doc.animations||[]){
   if(clips.has(animation.name))fail('DUPLICATE_ANIMATION_NAME');
   const entries=new Map();
   for(const channel of animation.channels){
    const sampler=animation.samplers?.[channel.sampler];
    if(!sampler)fail('INVALID_ANIMATION_SAMPLER');
    const node=s.doc.nodes?.[channel.target?.node];
    if(!node)fail('INVALID_ANIMATION_TARGET');
    const key=node.name+'|'+channel.target.path;
    if(entries.has(key))fail('DUPLICATE_TRACK');
    entries.set(key,{
     input:accessor(s,sampler.input).numbers,
     output:accessor(s,sampler.output).numbers,
     interpolation:sampler.interpolation||'LINEAR'
    });
   }
   clips.set(animation.name,entries);
  }
  return clips;
 }
 const tracksA=tracks(a),tracksB=tracks(b);
 for(const [name,ts] of tracksA){
  const other=tracksB.get(name);
  if(!other){diagnostics.push({key:'clip.missing',name});continue;}
  add('clip.'+name+'.channels',other.size,ts.size);
  for(const [key,entry] of ts){
   const newer=other.get(key);
   if(!newer){diagnostics.push({key:'track.missing',clip:name,track:key});continue;}
   add(`clip.${name}.${key}.interpolation`,newer.interpolation,entry.interpolation);
   compare(`clip.${name}.${key}.time`,entry.input,newer.input);
   compare(`clip.${name}.${key}.values`,entry.output,newer.output);
  }
 }
 for(let i=0;i<(src.materials||[]).length;i++){
  if(allowEditedMaterials.includes(i))continue;
  const x=normalizedPbr(src.materials[i]),y=normalizedPbr(dst.materials?.[i]);
  for(const key of Object.keys(x)){
   const u=x[key],v=y[key];
   if(Array.isArray(u))compare('material.'+i+'.'+key,u,v);
   else add('material.'+i+'.'+key,v,u);
  }
 }
 // Explicit scope: byte-level texture payloads and texture transforms require
 // an image decode/UV sampler normalization layer; not silently marked pass.
 if((src.images||[]).length)
  notCompared.push('Image pixel equivalence requires decoded PNG/JPEG comparison; not asserted');
 if((src.textures||[]).length)
  notCompared.push('Texture sampler/UV transform deep equality is not asserted');
 return {
  schema:'mark.glb-semantic-comparison/1',
  status:diagnostics.length?'fail':'pass_partial_profile',
  numericComparisons:tested.length,errors:diagnostics,
  unverified:notCompared,
  limits:{sparseAccessors:false,compressedExtensions:false,nonBinBuffers:false,
   imagePixels:false,textureTransforms:false,arbitraryExtensions:false},
  metrics:{sourceNodes:(src.nodes||[]).length,targetNodes:(dst.nodes||[]).length,
   sourceSkins:(src.skins||[]).length,targetSkins:(dst.skins||[]).length,
   sourceClips:(src.animations||[]).length,targetClips:(dst.animations||[]).length}
 };
}
