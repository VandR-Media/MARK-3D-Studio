/**
 * MARK Pro Studio R1: Node-only, bounded texture/UV/sampler fidelity audit.
 *
 * Compare by MATERIAL USAGE and decoded PNG RGBA, not by png bytes, because
 * GLTFExporter recompresses PNG data and renumbers images/samplers.
 * JPEG, KTX2, unknown extensions: explicit SKIP/unsupported, never "pass".
 * No GUI/WebGL assumptions. Every unsupported texture slot is reported.
 */
import {PNG} from 'pngjs';
import {parseGlb} from '../glb.js';

const SLOTS=[
 ['baseColor','pbrMetallicRoughness','baseColorTexture'],
 ['metallicRoughness','pbrMetallicRoughness','metallicRoughnessTexture'],
 ['normal',null,'normalTexture'],
 ['occlusion',null,'occlusionTexture'],
 ['emissive',null,'emissiveTexture'],
 ['clearcoat','KHR_materials_clearcoat','clearcoatTexture'],
 ['clearcoatRoughness','KHR_materials_clearcoat','clearcoatRoughnessTexture'],
 ['clearcoatNormal','KHR_materials_clearcoat','clearcoatNormalTexture'],
 ['transmission','KHR_materials_transmission','transmissionTexture'],
 ['thickness','KHR_materials_volume','thicknessTexture'],
 ['sheenColor','KHR_materials_sheen','sheenColorTexture'],
 ['sheenRoughness','KHR_materials_sheen','sheenRoughnessTexture'],
 ['specular','KHR_materials_specular','specularTexture'],
 ['specularColor','KHR_materials_specular','specularColorTexture'],
 ['iridescence','KHR_materials_iridescence','iridescenceTexture'],
 ['iridescenceThickness','KHR_materials_iridescence','iridescenceThicknessTexture'],
 ['anisotropy','KHR_materials_anisotropy','anisotropyTexture']
];
const ACCEPTED_EXTENSIONS=new Set([
 'KHR_texture_transform','KHR_materials_clearcoat','KHR_materials_transmission',
 'KHR_materials_volume','KHR_materials_ior','KHR_materials_emissive_strength',
 'KHR_lights_punctual','KHR_materials_unlit'
]);
const safeUint=x=>Number.isInteger(x)&&x>=0;
const identical=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
function extract(input){
 const glb=parseGlb(input),doc=glb.json;
 const bin=glb.chunks.find(x=>x.type===0x004e4942)?.data;
 if(!bin)throw Error('TEXTURE_QA_NO_BIN');
 return {doc,bin};
}
function refIndex(arr,i,label){
 if(!safeUint(i)||i>=arr.length)throw Error('TEXTURE_QA_BAD_'+label+'_INDEX');
 return arr[i];
}
function imageContent(ctx,imageIndex,{maxBytes=16*1024*1024}={}){
 const image=refIndex(ctx.doc.images||[],imageIndex,'IMAGE');
 let data,mime=image.mimeType||null;
 if(image.bufferView!==undefined){
  const view=refIndex(ctx.doc.bufferViews||[],image.bufferView,'BUFFER_VIEW');
  const start=view.byteOffset||0,length=view.byteLength;
  if(view.buffer!==0||!safeUint(start)||!safeUint(length)||
   length>maxBytes||start+length>ctx.bin.length)
   throw Error('TEXTURE_QA_IMAGE_BUFFER_RANGE');
  data=ctx.bin.subarray(start,start+length);
 }else if(typeof image.uri==='string'){
  const match=/^data:(image\/(?:png|jpeg|webp));base64,([a-zA-Z0-9+/=]+)$/.exec(image.uri);
  if(!match)throw Error('TEXTURE_QA_EXTERNAL_OR_BAD_DATA_URI');
  mime=mime||match[1];
  const encoded=match[2];
  if(encoded.length>maxBytes*1.4)throw Error('TEXTURE_QA_IMAGE_URI_BUDGET');
  data=Buffer.from(encoded,'base64');
  if(data.length>maxBytes)throw Error('TEXTURE_QA_IMAGE_URI_BUDGET');
 }else throw Error('TEXTURE_QA_MISSING_IMAGE_SOURCE');
 if(mime!=='image/png')return {supported:false,mime:mime||'unknown',reason:'decoder for '+mime+' unavailable'};
 if(data.length<33||Buffer.from(data.subarray(0,8)).toString('hex')!=='89504e470d0a1a0a')
  throw Error('TEXTURE_QA_BAD_PNG');
 const header=new DataView(data.buffer,data.byteOffset,data.byteLength);
 const width=header.getUint32(16,false),height=header.getUint32(20,false);
 if(width<1||height<1||width>4096||height>4096||width*height>16_000_000)
  throw Error('TEXTURE_QA_PNG_PIXEL_BUDGET');
 let bitmap;
 try{bitmap=PNG.sync.read(Buffer.from(data),{checkCRC:true});}
 catch(error){throw Error('TEXTURE_QA_PNG_DECODE: '+String(error?.message||error));}
 if(bitmap.width!==width||bitmap.height!==height||bitmap.data.length!==width*height*4)
  throw Error('TEXTURE_QA_PNG_DIMENSIONS');
 return {supported:true,mime:'image/png',width,height,pixels:bitmap.data};
}
function resolveSlot(ctx,ref,slot,maxImageBytes){
 const texture=refIndex(ctx.doc.textures||[],ref.index,'TEXTURE');
 const used=texture.extensions||{};
 if(Object.keys(used).some(x=>x!=='KHR_texture_basisu'))
  throw Error('TEXTURE_QA_UNKNOWN_TEXTURE_EXTENSION');
 if(used.KHR_texture_basisu)throw Error('TEXTURE_QA_BASISU_UNSUPPORTED');
 const sampler=texture.sampler===undefined?{}:
  refIndex(ctx.doc.samplers||[],texture.sampler,'SAMPLER');
 const normSampler={
  magFilter:sampler.magFilter??9729,minFilter:sampler.minFilter??9987,
  wrapS:sampler.wrapS??10497,wrapT:sampler.wrapT??10497
 };
 const usedExtensions=ref.extensions||{};
 const unknown=Object.keys(usedExtensions).filter(x=>x!=='KHR_texture_transform');
 if(unknown.length)throw Error('TEXTURE_QA_UNKNOWN_REF_EXTENSION: '+unknown.join(','));
 const t=usedExtensions.KHR_texture_transform||{};
 const vec=(v,defaultValue)=>{
  if(v===undefined)return defaultValue;
  if(!Array.isArray(v)||v.length!==2||v.some(x=>!Number.isFinite(x)))
   throw Error('TEXTURE_QA_TRANSFORM_VECTOR');
  return v;
 };
 const uvRef=ref.texCoord??0,uvFinal=t.texCoord??uvRef;
 if(!safeUint(uvFinal)||uvFinal>7)throw Error('TEXTURE_QA_TEXCOORD_RANGE');
 const uv={index:uvFinal,offset:vec(t.offset,[0,0]),scale:vec(t.scale,[1,1]),
  rotation:t.rotation??0};
 if(!Number.isFinite(uv.rotation))throw Error('TEXTURE_QA_TRANSFORM_ROTATION');
 if(texture.source===undefined)throw Error('TEXTURE_QA_TEXTURE_NO_SOURCE');
 const pixels=imageContent(ctx,texture.source,{maxBytes:maxImageBytes});
 return {slot,uv,sampler:normSampler,pixels,
  scale:ref.scale??1,strength:ref.strength??1,
  textureExtensions:Object.keys(used)};
}
function slotRef(material,[,path,field]){
 return path==='pbrMetallicRoughness'?
  material.pbrMetallicRoughness?.[field]:
  path?.startsWith('KHR_')?material.extensions?.[path]?.[field]:
  material[field];
}
function materialList(ctx){
 const seen=new Set();
 return (ctx.doc.materials||[]).map((m,i)=>{
  const name=m.name||'__material_'+i;
  if(seen.has(name))throw Error('TEXTURE_QA_DUPLICATE_MATERIAL_NAME: '+name);
  seen.add(name);return{name,material:m};
 });
}
const difference=(a,b,epsilon=1e-5)=>{
 if(Array.isArray(a)&&Array.isArray(b)){
  if(a.length!==b.length)return Infinity;
  return Math.max(0,...a.map((x,i)=>difference(x,b[i],epsilon)));
 }
 if(typeof a==='number'&&typeof b==='number')return Math.abs(a-b);
 return a===b?0:Infinity;
};
export function compareGlbTextures(before,after,{
 tolerance=1e-5,maxImageBytes=16*1024*1024
}={}){
 if(!Number.isFinite(tolerance)||tolerance<0||tolerance>1)
  throw Error('TEXTURE_QA_TOLERANCE');
 if(!safeUint(maxImageBytes)||maxImageBytes<64||maxImageBytes>64*1024*1024)
  throw Error('TEXTURE_QA_IMAGE_BUDGET');
 const a=extract(before),b=extract(after),errors=[],unverified=[],passed=[],stats={
  materials:0,textureSlots:0,imagesDecoded:0,pixelsCompared:0,samplerChecks:0,
  uvTransformChecks:0,unsupportedTextures:0
 };
 for(const ext of new Set([...(a.doc.extensionsUsed||[]),...(b.doc.extensionsUsed||[])]))
  if(!ACCEPTED_EXTENSIONS.has(ext))
   unverified.push('Unsupported glTF extension '+ext+' not covered by texture QA');
 const aa=materialList(a),bb=materialList(b),mapped=new Map(bb.map(x=>[x.name,x.material]));
 if(aa.length!==bb.length)errors.push({key:'material.count',expected:aa.length,actual:bb.length});
 for(const {name,material:from} of aa){
  const to=mapped.get(name);
  if(!to){errors.push({key:'material.missing',name});continue;}
  stats.materials++;
  for(const spec of SLOTS){
   const slot=spec[0],x=slotRef(from,spec),y=slotRef(to,spec);
   if(Boolean(x)!==Boolean(y)){
    errors.push({key:name+'.'+slot+'.presence'});continue;
   }
   if(!x)continue;
   stats.textureSlots++;
   let u,v;
   try{
    u=resolveSlot(a,x,slot,maxImageBytes);v=resolveSlot(b,y,slot,maxImageBytes);
   }catch(error){
    errors.push({key:name+'.'+slot+'.invalid',reason:String(error?.message||error)});
    continue;
   }
   stats.samplerChecks++;
   if(!identical(u.sampler,v.sampler))
    errors.push({key:name+'.'+slot+'.sampler',before:u.sampler,after:v.sampler});
   else passed.push(name+'.'+slot+'.sampler');
   stats.uvTransformChecks++;
   if(difference(u.uv.index,v.uv.index)>0||
    difference(u.uv.offset,v.uv.offset)>tolerance||
    difference(u.uv.scale,v.uv.scale)>tolerance||
    difference(u.uv.rotation,v.uv.rotation)>tolerance)
    errors.push({key:name+'.'+slot+'.uvTransform',before:u.uv,after:v.uv});
   else passed.push(name+'.'+slot+'.uvTransform');
   for(const scalar of ['scale','strength']){
    if(difference(u[scalar],v[scalar])>tolerance)
     errors.push({key:name+'.'+slot+'.'+scalar,before:u[scalar],after:v[scalar]});
   }
   if(!u.pixels.supported||!v.pixels.supported){
    stats.unsupportedTextures++;
    unverified.push(name+'.'+slot+': '+u.pixels.mime+' / '+v.pixels.mime+
     ' pixel equivalence not verified');
    continue;
   }
   stats.imagesDecoded+=2;
   if(u.pixels.width!==v.pixels.width||u.pixels.height!==v.pixels.height){
    errors.push({key:name+'.'+slot+'.size',before:[u.pixels.width,u.pixels.height],
     after:[v.pixels.width,v.pixels.height]});continue;
   }
   const rawA=u.pixels.pixels,rawB=v.pixels.pixels;let diffCount=0,maxError=0;
   for(let i=0;i<rawA.length;i++){
    const d=Math.abs(rawA[i]-rawB[i]);
    if(d>tolerance*255){diffCount++;maxError=Math.max(maxError,d);}
   }
   stats.pixelsCompared+=u.pixels.width*u.pixels.height;
   if(diffCount)errors.push({key:name+'.'+slot+'.rgbaPixels',
    changedChannels:diffCount,maxAbsoluteChannelError:maxError,
    width:u.pixels.width,height:u.pixels.height});
   else passed.push(name+'.'+slot+'.rgbaPixels');
  }
 }
 if(stats.textureSlots===0)unverified.push('No referenced material textures: image pixel fidelity not exercised');
 // Safeguard: texture slots not attached to materials are unverified resource
 // garbage, never silently counted as checked image semantics.
 const referenced=(ctx)=>new Set((ctx.doc.materials||[])
  .flatMap(m=>SLOTS.map(s=>slotRef(m,s)?.index))
  .filter(x=>x!==undefined));
 for(const [tag,ctx] of [['source',a],['target',b]]){
  const used=referenced(ctx);
  for(let i=0;i<(ctx.doc.textures||[]).length;i++)
   if(!used.has(i))unverified.push(tag+' unreferenced texture index '+i);
 }
 return {
  schema:'mark.glb-texture-qa/1',status:errors.length?'fail':
   unverified.length?'partial_unverified':'pass_supported_png',
  errors,unverified,stats,passed,
  coverage:{pngRgbaPixels:true,materialTextureSlots:true,
   samplerFilterWrap:true,khrTextureTransform:true,uvSetSelector:true,
   jpegPixels:false,ktx2Pixels:false,sparseAccessors:false,
   textureColorManagementConversion:false},
  note:'Only supported PNG PBR material slots evaluated, not general glTF 2.0 fidelity'
 };
}
