/** MARK Visual Engine v2 — strict, editable, deterministic JSON scene graph. */
import {buildInstrument} from './instrument-factory.js';
export const SCENE_SCHEMA='mark.visual-scene/2',RECIPE_SCHEMA='mark.visual-recipe/2';
export const SIGNALS=['left','right'].flatMap(c=>[c+'.rms',c+'.peak',c+'.low',c+'.mid',c+'.high',c+'.waveform']).concat(['beat','bass']);
const idPattern=/^[a-z][a-z0-9_.-]{1,79}$/,finite=x=>typeof x==='number'&&Number.isFinite(x);
const vec3=x=>Array.isArray(x)&&x.length===3&&x.every(finite);
const clone=x=>structuredClone(x),hex=x=>typeof x==='string'&&/^#[0-9a-f]{6}$/i.test(x);
const check=(p,msg)=>{if(!p)throw Error('Visual Engine: '+msg);};
const range=(x,a,b)=>finite(x)&&x>=a&&x<=b;
const geometries=new Set(['group','box','bevel-box','cylinder','sphere','torus','needle','plane','tube','disk']);
const responses=new Set(['needle','led-column','scale-y','rotation-z','emissive','position-y']);
export function newVisualScene({id='visual-scene',name='MARK Visual Scene'}={}){
 check(idPattern.test(id),'invalid scene ID');
 return {schema:SCENE_SCHEMA,id,name,quality:'normal',
  camera:{position:[0,0,13],target:[0,0,0],fov:37,near:.05,far:100},
  environment:{color:'#07101d',intensity:.6,hdri:null},
  lights:[
   {id:'key',type:'directional',position:[-4,7,8],color:'#d6efff',intensity:3.3,castShadow:true},
   {id:'fill',type:'directional',position:[6,1,5],color:'#77a5ff',intensity:1.3,castShadow:false},
   {id:'rim',type:'directional',position:[0,5,-6],color:'#cf5bdb',intensity:2.1,castShadow:false}
  ],materials:{},objects:[],overlays:[],bindings:[],animation:{clips:[]},
  metadata:{createdBy:'MARK Visual Engine v2',signalContract:'mark.audio.stereo/1'}};
}
export function createVisualObject({id,parent=null,name=id,geometry={type:'group'},material=null,
 position=[0,0,0],rotation=[0,0,0],scale=[1,1,1],visible=true,meta={}}={}){
 return {id,parent,name,geometry,material,position,rotation,scale,visible,meta};
}
export function validateVisualScene(s){
 check(s?.schema===SCENE_SCHEMA&&idPattern.test(s.id),'unsupported scene schema/id');
 check(['eco','normal','high'].includes(s.quality),'invalid quality');
 const c=s.camera;
 check(c&&vec3(c.position)&&vec3(c.target)&&range(c.fov,12,100)&&
  range(c.near,.001,10)&&range(c.far,10,10000)&&c.far>c.near,'invalid camera');
 check(s.environment&&hex(s.environment.color)&&range(s.environment.intensity,0,5)&&
  range(s.environment.exposure??1.14,.25,2.5),'invalid environment/exposure');
 check(s.environment.hdri==null||(typeof s.environment.hdri==='string'&&
  s.environment.hdri.startsWith('data:')&&s.environment.hdri.length<20000000),'HDRI must be embedded');
 check(Array.isArray(s.lights)&&s.lights.length<=12,'too many lights');
 for(const l of s.lights)
  check(idPattern.test(l.id)&&['ambient','directional','point','spot'].includes(l.type)&&vec3(l.position)&&
   hex(l.color)&&range(l.intensity,0,40),'invalid light');
 check(s.materials&&typeof s.materials==='object'&&!Array.isArray(s.materials)&&
  Object.keys(s.materials).length<=128,'invalid materials');
 for(const [id,m] of Object.entries(s.materials)){
  check(idPattern.test(id)&&['standard','physical','basic'].includes(m.type)&&hex(m.color)&&
   range(m.metalness,0,1)&&range(m.roughness,0,1)&&hex(m.emissive||'#000000')&&
   range(m.emissiveIntensity??0,0,30)&&range(m.opacity??1,0,1)&&
   range(m.transmission??0,0,1),'invalid material '+id);
  for(const [slot,data] of Object.entries(m.maps||{}))
   check(['baseColor','normal','metallicRoughness','emissive','ao'].includes(slot)&&
    typeof data==='string'&&data.startsWith('data:image/')&&data.length<=10000000,
    'external/invalid texture '+id+'.'+slot);
 }
 check(Array.isArray(s.objects)&&s.objects.length<=3500,'scene object count exceeded');
 const ids=new Set();
 for(const o of s.objects){
  check(idPattern.test(o.id)&&!ids.has(o.id),'duplicate/invalid object ID '+o.id);
  ids.add(o.id);
  check(typeof o.name==='string'&&geometries.has(o.geometry?.type),'invalid geometry '+o.id);
  check((o.material==null||s.materials[o.material])&&vec3(o.position)&&vec3(o.rotation)&&vec3(o.scale)&&
   o.scale.every(v=>v>0&&v<=100)&&typeof o.visible==='boolean','invalid object '+o.id);
  for(const [k,v] of Object.entries(o.geometry))
   if(k!=='type')check(range(v,0,200),'invalid geometry parameter '+o.id+'.'+k);
 }
 const byId=new Map(s.objects.map(o=>[o.id,o]));
 for(const o of s.objects){
  check(o.parent==null||byId.has(o.parent),'orphan parent '+o.id);
  const seen=new Set([o.id]);let cursor=o;
  while(cursor.parent){
   check(!seen.has(cursor.parent),'cyclic hierarchy '+o.id);
   seen.add(cursor.parent);cursor=byId.get(cursor.parent);
  }
 }
 check(!s.attachments||Array.isArray(s.attachments),'attachments must be array');
 if(s.attachments){
  check(s.attachments.length<=12,'too many external GLB attachments');
  for(const asset of s.attachments)
   check(typeof asset.name==='string'&&asset.name.length<=160&&
    typeof asset.data==='string'&&asset.data.startsWith('data:model/gltf-binary;base64,')&&
    asset.data.length<23000000,'unsupported/non-embedded GLB attachment');
 }
 check(Array.isArray(s.bindings)&&s.bindings.length<=3600,'invalid binding count');
 for(const b of s.bindings)check(ids.has(b.target)&&SIGNALS.includes(b.signal)&&responses.has(b.response)&&
  (b.gain===undefined||range(b.gain,0,10)),'invalid binding '+JSON.stringify(b));
 check(Array.isArray(s.overlays)&&s.overlays.length<=120,'too many 2D labels');
 for(const o of s.overlays)check(typeof o.text==='string'&&o.text.length<=80&&
  range(o.x,0,1)&&range(o.y,0,1)&&hex(o.color||'#ffffff'),'invalid overlay');
 check(s.animation&&Array.isArray(s.animation.clips)&&s.animation.clips.length<=50,'invalid animations');
 for(const clip of s.animation.clips){
  check(idPattern.test(clip.id)&&range(clip.duration,.01,300)&&
   Array.isArray(clip.tracks)&&clip.tracks.length<=500,'invalid animation clip');
  for(const track of clip.tracks){
   check(ids.has(track.target)&&['position','rotation','scale'].includes(track.property)&&
    Array.isArray(track.keys)&&track.keys.length>=2&&track.keys.length<=1000,
    'unsupported keyframe track');
   let last=-1;
   for(const key of track.keys){
    check(range(key.time,0,clip.duration)&&key.time>last&&vec3(key.value)&&
     key.value.every(v=>Math.abs(v)<200),'invalid keyframe');
    last=key.time;
   }
  }
 }
 return s;
}
function object(s,id){const found=s.objects.find(o=>o.id===id);check(found,'unknown object '+id);return found;}
function exec(s,c){
 const a=c.args||{};
 switch(c.operation){
  case 'instrument.create':{
   const x=buildInstrument(a.kind,a.params||{});
   for(const id of Object.keys(x.materials))check(!s.materials[id],'material collision '+id);
   Object.assign(s.materials,x.materials);s.objects.push(...x.objects);
   s.overlays.push(...x.overlays);s.bindings.push(...x.bindings);s.name=x.name;
   return {created:x.objects.length,bindings:x.bindings.length};
  }
  case 'object.add':s.objects.push(createVisualObject(a));return {created:a.id};
  case 'object.transform':{
   const o=object(s,a.id);
   for(const key of ['position','rotation','scale'])if(a[key]!==undefined)o[key]=clone(a[key]);
   return {updated:o.id};
  }
  case 'object.material':object(s,a.id).material=a.material;return {updated:a.id};
  case 'object.group':object(s,a.id).parent=a.parent??null;return {updated:a.id};
  case 'object.rename':object(s,a.id).name=a.name;return {updated:a.id};
  case 'object.remove':{
   check(s.objects.some(o=>o.id===a.id),'unknown object');
   const remove=new Set([a.id]);
   for(let i=0;i<s.objects.length;i++)for(const o of s.objects)
    if(remove.has(o.parent))remove.add(o.id);
   s.objects=s.objects.filter(o=>!remove.has(o.id));
   s.bindings=s.bindings.filter(b=>!remove.has(b.target));
   return {removed:remove.size};
  }
  case 'object.clone':{
   const old=object(s,a.id),newObj=clone(old);
   newObj.id=a.newId;newObj.name=a.name||old.name+' copy';
   newObj.parent=a.parent??old.parent;newObj.position=a.position??old.position;
   s.objects.push(newObj);return {created:a.newId};
  }
  case 'material.set':s.materials[a.id]=clone(a.material);return {material:a.id};
  case 'camera.set':s.camera={...s.camera,...clone(a)};return {camera:true};
  case 'environment.set':s.environment={...s.environment,...clone(a)};return {environment:true};
  case 'lighting.set':s.lights=clone(a.lights);return {lights:s.lights.length};
  case 'overlay.add':s.overlays.push(clone(a));return {overlay:true};
  case 'signal.bind':s.bindings.push(clone(a));return {binding:a.target};
  case 'animation.set':{
   check(a.clip&&typeof a.clip.id==='string','animation.set needs clip');
   s.animation.clips=s.animation.clips.filter(x=>x.id!==a.clip.id);
   s.animation.clips.push(clone(a.clip));return {clip:a.clip.id};
  }
  case 'quality.set':s.quality=a.profile;return {quality:a.profile};
  default:throw Error('Unsupported visual command: '+c.operation);
 }
}
export function runVisualRecipe(recipe){
 check(recipe?.schema===RECIPE_SCHEMA&&idPattern.test(recipe.id),'invalid recipe');
 check(Array.isArray(recipe.commands)&&recipe.commands.length>0&&recipe.commands.length<=1000,'invalid commands');
 let s=newVisualScene({id:recipe.id,name:recipe.name||recipe.id});
 const report=[];
 for(const [index,c] of recipe.commands.entries()){
  check(c&&typeof c.operation==='string'&&c.args&&typeof c.args==='object'&&!Array.isArray(c.args),'invalid command');
  const prior=clone(s);
  try{const result=exec(s,c);validateVisualScene(s);report.push({index,operation:c.operation,result});}
  catch(error){s=prior;throw Error('Step '+index+' '+c.operation+': '+error.message);}
 }
 return {scene:s,report};
}
export function serializeVisualScene(s){return JSON.stringify(validateVisualScene(s),null,2)+'\n';}
export function deserializeVisualScene(s){return validateVisualScene(typeof s==='string'?JSON.parse(s):clone(s));}
