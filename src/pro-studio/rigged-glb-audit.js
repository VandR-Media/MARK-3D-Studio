/**
 * MARK Professional Studio — Release 1 strict glTF 2.0 skinned+animated
 * binary asset audit. Operates without DOM or Three.js. Never changes input.
 * This is a transport/semantic gate, NOT a renderer or mesh/rig editor.
 */
import {createHash} from 'node:crypto';
import {parseGlb,assertSelfContainedGlb} from '../glb.js';

const EXTENSIONS=new Set([
 'KHR_materials_transmission','KHR_materials_ior','KHR_materials_clearcoat',
 'KHR_materials_volume','KHR_materials_emissive_strength',
 'KHR_texture_transform','KHR_lights_punctual','KHR_materials_unlit'
]);
const COMPONENT_BYTES={5120:1,5121:1,5122:2,5123:2,5125:4,5126:4};
const ITEMS={SCALAR:1,VEC2:2,VEC3:3,VEC4:4,MAT2:4,MAT3:9,MAT4:16};
const validIndex=(idx,array)=>Number.isInteger(idx)&&idx>=0&&idx<array.length;
const assert=(good,code,detail)=>{if(!good){const e=Error('MARK_RIG_'+code+': '+detail);e.code=code;throw e;}};
const isNat=n=>Number.isInteger(n)&&n>=0;
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');

export function inspectRiggedGlb(bytes,{maxBytes=64*1024*1024}={}){
 const data=bytes instanceof Uint8Array?bytes:new Uint8Array(bytes);
 assert(data.byteLength<=maxBytes,'SIZE_LIMIT','GLB exceeds import budget');
 const parsed=parseGlb(data),doc=parsed.json;
 assertSelfContainedGlb(doc);
 const bad=(doc.extensionsUsed||[]).filter(x=>!EXTENSIONS.has(x));
 const required=(doc.extensionsRequired||[]).filter(x=>!EXTENSIONS.has(x));
 assert(bad.length===0&&required.length===0,'UNSUPPORTED_EXTENSION',
  'unsupported extension(s): '+[...new Set([...bad,...required])].join(', '));
 const bin=parsed.chunks.find(c=>c.type===0x004e4942)?.data;
 const buffers=doc.buffers||[];
 assert(buffers.length===1&&buffers[0].uri===undefined&&isNat(buffers[0].byteLength),
  'BUFFER','one internal binary buffer is required');
 assert(bin&&bin.length>=buffers[0].byteLength&&bin.length-buffers[0].byteLength<=3,
  'BUFFER_LENGTH','missing, truncated or excessive BIN chunk padding');
 const views=doc.bufferViews||[],acc=doc.accessors||[];
 assert(views.length<=30000&&acc.length<=30000,'RESOURCE_LIMIT','too many views/accessors');
 for(const [i,v] of views.entries()){
  const offset=v.byteOffset||0;
  assert(v.buffer===0&&isNat(offset)&&isNat(v.byteLength)&&offset+v.byteLength<=buffers[0].byteLength,
   'BUFFERVIEW_RANGE','view '+i+' out of BIN bounds');
  assert(v.byteStride===undefined||(isNat(v.byteStride)&&v.byteStride>=4&&v.byteStride<=252&&v.byteStride%4===0),
   'BUFFERVIEW_STRIDE','bad interleaved stride '+i);
 }
 for(const [i,a] of acc.entries()){
  assert(validIndex(a.bufferView,views)&&!a.sparse,'ACCESSOR_UNSUPPORTED',
   'accessor '+i+' must use a dense internal bufferView (sparse unsupported)');
  assert(isNat(a.count)&&a.count<=1e7&&COMPONENT_BYTES[a.componentType]&&ITEMS[a.type],
   'ACCESSOR_TYPE','bad component/count/type on accessor '+i);
  const v=views[a.bufferView],local=a.byteOffset||0;
  const element=COMPONENT_BYTES[a.componentType]*ITEMS[a.type];
  // For simple MAT4 float alignment this is sufficient; sparse and non-float
  // matrix padding remain explicitly unsupported in Release 1.
  assert(local%COMPONENT_BYTES[a.componentType]===0,
   'ACCESSOR_ALIGNMENT','accessor '+i+' unaligned');
  const stride=v.byteStride||element;
  assert(stride>=element&&isNat(local)&&
   local+(a.count?((a.count-1)*stride+element):0)<=v.byteLength,
   'ACCESSOR_RANGE','accessor '+i+' reads outside bufferView');
 }
 function readAccessor(index){
  assert(validIndex(index,acc),'ACCESSOR_INDEX','unknown accessor '+index);
  const a=acc[index],v=views[a.bufferView],n=ITEMS[a.type],stride=v.byteStride||n*COMPONENT_BYTES[a.componentType];
  const dv=new DataView(bin.buffer,bin.byteOffset,bin.byteLength),off=(v.byteOffset||0)+(a.byteOffset||0);
  const result=[];let get;
  switch(a.componentType){
   case 5120:get=i=>dv.getInt8(i);break;case 5121:get=i=>dv.getUint8(i);break;
   case 5122:get=i=>dv.getInt16(i,true);break;case 5123:get=i=>dv.getUint16(i,true);break;
   case 5125:get=i=>dv.getUint32(i,true);break;case 5126:get=i=>dv.getFloat32(i,true);break;
  }
  const size=COMPONENT_BYTES[a.componentType];
  for(let j=0;j<a.count;j++){
   const row=[];for(let k=0;k<n;k++)row.push(get(off+j*stride+k*size));result.push(row);
  }return result;
 }
 const nodes=doc.nodes||[],meshes=doc.meshes||[],skins=doc.skins||[],animations=doc.animations||[];
 assert(nodes.length<=10000&&meshes.length<=5000&&skins.length<=200&&animations.length<=300,
  'RESOURCE_LIMIT','too many scene nodes/meshes/skins/animations');
 const parent=new Map();
 nodes.forEach((node,i)=>{
  for(const child of node.children||[]){
   assert(validIndex(child,nodes),'NODE_INDEX','node '+i+' has invalid child '+child);
   assert(!parent.has(child),'NODE_MULTIPARENT','child '+child+' has multiple parents');parent.set(child,i);
  }
  if(node.mesh!==undefined)assert(validIndex(node.mesh,meshes),'MESH_INDEX','node '+i+' has invalid mesh');
  if(node.skin!==undefined)assert(validIndex(node.skin,skins)&&node.mesh!==undefined,
   'SKIN_INDEX','node '+i+' has invalid skin/mesh link');
 });
 for(let i=0;i<nodes.length;i++){
  const seen=new Set([i]);let n=i;while(parent.has(n)){
   n=parent.get(n);assert(!seen.has(n),'NODE_CYCLE','node '+i+' has cyclic parents');seen.add(n);
  }
 }
 const morphs=[];let skinPrimitiveCount=0,indexCount=0;
 for(const [meshIdx,mesh] of meshes.entries()){
  assert(Array.isArray(mesh.primitives)&&mesh.primitives.length>0,
   'PRIMITIVES','mesh '+meshIdx+' has no primitives');
  const count=(mesh.primitives[0]?.targets||[]).length;
  if(mesh.weights!==undefined)assert(mesh.weights.length===count,
   'MORPH_WEIGHTS','mesh '+meshIdx+' weights count must equal target count');
  for(const [pidx,p] of mesh.primitives.entries()){
   assert(p.attributes&&validIndex(p.attributes.POSITION,acc),
    'POSITION','mesh '+meshIdx+' primitive '+pidx+' lacks POSITION');
   const vertexCount=acc[p.attributes.POSITION].count;
   assert(acc[p.attributes.POSITION].type==='VEC3'&&acc[p.attributes.POSITION].componentType===5126,
    'POSITION_TYPE','POSITION must be Float32 VEC3 in this profile');
   for(const [name,index] of Object.entries(p.attributes)){
    assert(validIndex(index,acc)&&acc[index].count===vertexCount,'ATTRIBUTE_COUNT',name+' count mismatch');
   }
   if(p.indices!==undefined){
    assert(validIndex(p.indices,acc)&&acc[p.indices].type==='SCALAR'&&
     [5121,5123,5125].includes(acc[p.indices].componentType),'INDICES_TYPE','bad index accessor');
    const indices=readAccessor(p.indices);
    for(const [i] of indices)assert(i<vertexCount,'INDEX_RANGE','triangle index beyond vertexCount');
    indexCount+=indices.length;
   }
   for(const target of p.targets||[]){
    for(const [kind,index] of Object.entries(target)){
     assert(['POSITION','NORMAL','TANGENT'].includes(kind)&&validIndex(index,acc),
      'MORPH_TYPE','unsupported morph attribute '+kind);
     assert(acc[index].count===vertexCount&&acc[index].componentType===5126,
      'MORPH_COUNT','morph attribute invalid count/type');
    }
   }
   assert((p.targets||[]).length===count,'MORPH_PRIMITIVE_COUNT','morph target count differs between primitives');
   const skinned=nodes.some(n=>n.mesh===meshIdx&&n.skin!==undefined);
   if(skinned){
    const ji=p.attributes.JOINTS_0,wi=p.attributes.WEIGHTS_0;
    assert(validIndex(ji,acc)&&validIndex(wi,acc),'SKIN_ATTRIBUTES','skinned mesh requires JOINTS_0 and WEIGHTS_0');
    assert(acc[ji].type==='VEC4'&&[5121,5123].includes(acc[ji].componentType)&&
     acc[wi].type==='VEC4'&&[5126,5121,5123].includes(acc[wi].componentType),
     'SKIN_ATTRIBUTE_TYPE','invalid skin attribute types');
    // validate every vertex, do not just check accessor names exist
    const rawWeights=readAccessor(wi),joints=readAccessor(ji);
    const skinnedNodes=nodes.filter(n=>n.mesh===meshIdx&&n.skin!==undefined);
    for(let v=0;v<vertexCount;v++){
     const vals=rawWeights[v].map(w=>acc[wi].componentType===5126?w:
      acc[wi].normalized?w/(acc[wi].componentType===5121?255:65535):w);
     assert(vals.every(w=>Number.isFinite(w)&&w>=0&&w<=1)&&Math.abs(vals.reduce((a,b)=>a+b,0)-1)<.01,
      'SKIN_WEIGHT_SUM','mesh '+meshIdx+' vertex '+v+' weights do not sum to 1');
     for(const idx of joints[v])for(const n of skinnedNodes){
      assert(idx<skins[n.skin].joints.length,'SKIN_JOINT_RANGE','joint index outside skin palette');
     }
    }skinPrimitiveCount++;
   }
  }
  morphs.push({mesh:meshIdx,targets:count,weights:mesh.weights||[]});
 }
 const skinSummaries=[];
 skins.forEach((s,i)=>{
  assert(Array.isArray(s.joints)&&s.joints.length>0&&s.joints.length<=256,
   'SKIN_JOINTS','skin '+i+' has invalid joint count');
  assert(new Set(s.joints).size===s.joints.length&&s.joints.every(idx=>validIndex(idx,nodes)),
   'SKIN_JOINTS','skin '+i+' has invalid or duplicate nodes');
  assert(validIndex(s.inverseBindMatrices,acc),'SKIN_BIND_MATRICES','skin '+i+' missing inverse bind accessor');
  const a=acc[s.inverseBindMatrices];
  assert(a.type==='MAT4'&&a.componentType===5126&&a.count===s.joints.length,
   'SKIN_BIND_MATRICES','skin '+i+' inverseBindMatrices type/count mismatch');
  for(const mat of readAccessor(s.inverseBindMatrices))assert(mat.every(Number.isFinite),
   'SKIN_BIND_MATRICES','non-finite inverse bind matrix value');
  if(s.skeleton!==undefined)assert(validIndex(s.skeleton,nodes),'SKIN_SKELETON','invalid skeleton root');
  skinSummaries.push({index:i,joints:s.joints.length,inverseBindMatrices:a.count,root:s.skeleton??null});
 });
 const animationSummaries=[];
 for(const [i,anim] of animations.entries()){
  assert(Array.isArray(anim.channels)&&Array.isArray(anim.samplers)&&anim.channels.length>0,
   'ANIMATION_EMPTY','animation '+i+' is empty');
  const paths=[];let duration=0;
  for(const [j,ch] of anim.channels.entries()){
   assert(validIndex(ch.sampler,anim.samplers)&&validIndex(ch.target?.node,nodes)&&
    ['translation','rotation','scale','weights'].includes(ch.target?.path),
    'ANIMATION_CHANNEL','invalid target/sampler '+i+'/'+j);
   const smp=anim.samplers[ch.sampler],mode=smp.interpolation||'LINEAR';
   assert(['LINEAR','STEP','CUBICSPLINE'].includes(mode)&&
    validIndex(smp.input,acc)&&validIndex(smp.output,acc),'ANIMATION_SAMPLER','invalid sampler');
   const inp=acc[smp.input],out=acc[smp.output],times=readAccessor(smp.input);
   assert(inp.type==='SCALAR'&&inp.componentType===5126&&times.length>0&&
    times.every(([t],k)=>Number.isFinite(t)&&t>=0&&(k===0||t>times[k-1][0])),
    'ANIMATION_TIMES','animation '+i+' has invalid/nonmonotonic times');
   duration=Math.max(duration,times.at(-1)[0]);
   const target=ch.target.path;let requiredCount=times.length*(mode==='CUBICSPLINE'?3:1),expectedType;
   if(target==='weights'){
    const mesh=meshes[nodes[ch.target.node].mesh];
    assert(mesh&&mesh.primitives?.[0]?.targets?.length,'ANIMATION_MORPH','weights target lacks morph mesh');
    requiredCount*=mesh.primitives[0].targets.length;expectedType='SCALAR';
   }else expectedType=target==='rotation'?'VEC4':'VEC3';
   assert(out.count===requiredCount&&out.type===expectedType&&out.componentType===5126,
    'ANIMATION_OUTPUT','animation '+i+' output size/type mismatch for '+target);
   paths.push(target);
  }
  animationSummaries.push({name:anim.name||'clip-'+i,channels:anim.channels.length,durationSeconds:duration,paths});
 }
 for(const [i,img] of (doc.images||[]).entries()){
  assert(img.uri===undefined&&validIndex(img.bufferView,views)&&
   ['image/png','image/jpeg','image/webp'].includes(img.mimeType),
   'IMAGE_SOURCE','image '+i+' must be embedded in BIN');
 }
 const summary={schema:'mark.rigged-glb-audit/1',sha256:sha(data),bytes:data.length,
  sceneCount:doc.scenes?.length||0,nodes:nodes.length,meshCount:meshes.length,
  skinPrimitiveCount,indexCount,skins:skinSummaries,morphs,
  animations:animationSummaries,images:doc.images?.length||0,
  textures:doc.textures?.length||0,materials:doc.materials?.length||0,
  extensions:doc.extensionsUsed||[],warnings:[],
  limitations:['Transport/semantic inspection only: does not prove GLTFLoader skin deformation, visual rendering or GLTFExporter fidelity.',
   'Sparse accessors, unsupported required extensions and non-dense interleaved matrix types are not supported in this Release 1 preview.']};
 return summary;
}

/**
 * Export-verification for this first transport slice. Exact source bytes must
 * match for archive/reopen-only workflows. Editing/exporting with Three.js
 * needs a distinct semantic and renderer roundtrip gate (not claimed here).
 */
export function comparePreservedRiggedGlb(before,after){
 const a=inspectRiggedGlb(before),b=inspectRiggedGlb(after);
 const same=a.sha256===b.sha256;
 return {status:same?'pass':'fail',sourceSha256:a.sha256,exportSha256:b.sha256,
  exactBytesPreserved:same,
  source:{skins:a.skins,animations:a.animations,morphs:a.morphs},
  export:{skins:b.skins,animations:b.animations,morphs:b.morphs},
  note:same?'Original unmodified GLB exact-byte preservation':'Only source-byte preservation checked; no claim of authoring export fidelity'};
}

