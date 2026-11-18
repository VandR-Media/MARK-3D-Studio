/**
 * MARK Professional Studio / Release 1 experimental animated GLB viewport.
 * Separate from Visual Engine v2. This is a genuine Three.js WebGL2, GLTFLoader,
 * AnimationMixer and GLTFExporter pipeline; NOT an editable mesh/rig studio.
 * Does NOT claim approved Neon Boy, production .markscene v3 or Huawei metrics.
 */
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {GLTFExporter} from 'three/addons/exporters/GLTFExporter.js';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';

const byId=id=>document.getElementById(id);
const buf=x=>x instanceof Uint8Array?x:new Uint8Array(x);
const errorDisplay=error=>{
 byId('message').textContent='Ошибка: '+(error?.message||String(error));
 byId('message').dataset.error='yes';
 window.MARK_RIG_LAST_ERROR=String(error?.message||error);
};
const loader=new GLTFLoader();
const canvas=byId('viewport');
const renderer=new THREE.WebGLRenderer({
 canvas,antialias:true,preserveDrawingBuffer:true,powerPreference:'high-performance'
});
renderer.setPixelRatio(Math.min(devicePixelRatio||1,2));
renderer.outputColorSpace=THREE.SRGBColorSpace;
renderer.toneMapping=THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure=1.2;
renderer.shadowMap.enabled=false;
const world=new THREE.Scene();world.background=new THREE.Color('#111725');
const camera=new THREE.PerspectiveCamera(39,1,.03,100);
camera.position.set(2.6,2.2,4.7);
const controls=new OrbitControls(camera,canvas);
controls.enableDamping=true;
controls.target.set(0,.7,0);
world.add(new THREE.HemisphereLight('#c8e8ff','#555366',2.2));
const key=new THREE.DirectionalLight('#fff2db',3);
key.position.set(-3,5,6);world.add(key);
const fill=new THREE.DirectionalLight('#7fb2ff',1.5);
fill.position.set(3,2,-3);world.add(fill);
const grid=new THREE.GridHelper(3,12,'#364a60','#263344');grid.position.y=-.065;world.add(grid);
let root=null,parsed=null,mixer=null,activeAction=null,activeClip=0,playing=false,
 fixtureBytes=null,sourceBytes=null,skinned=null,loadedName='',poseSeconds=0,
 raf=0,lastTick=0,frameCounter=0;
function resize(){
 const rect=canvas.getBoundingClientRect();
 const w=Math.max(2,rect.width|0),h=Math.max(2,rect.height|0);
 renderer.setSize(w,h,false);camera.aspect=w/h;camera.updateProjectionMatrix();
}
function frame(now){
 const delta=lastTick?Math.min(.08,(now-lastTick)/1000):0;
 lastTick=now;
 if(playing&&mixer&&parsed?.animations?.length){
  mixer.update(delta);
  poseSeconds=mixer.time%(parsed.animations[activeClip]?.duration||1);
  byId('timeline').value=String(Math.round(poseSeconds*1000));
  byId('readout').textContent=poseSeconds.toFixed(2)+' s';
 }
 controls.update();renderer.render(world,camera);frameCounter++;
 raf=requestAnimationFrame(frame);
}
function centerView(orientation='front'){
 if(!root)return;
 const box=new THREE.Box3().setFromObject(root);
 const size=box.getSize(new THREE.Vector3()),center=box.getCenter(new THREE.Vector3());
 const radius=Math.max(.3,size.length());
 const d=Math.max(3,radius*2.2);
 const positions={
  front:[0,0,d],left:[-d,0,0],right:[d,0,0],
  back:[0,0,-d],threequarter:[d*.65,d*.36,d*.8],top:[0,d,0.01]
 };
 if(!positions[orientation])throw Error('Unknown camera view '+orientation);
 controls.target.copy(center);
 camera.position.copy(center).add(new THREE.Vector3(...positions[orientation]));
 camera.near=.01;camera.far=Math.max(100,d*9);camera.updateProjectionMatrix();
 controls.update();renderer.render(world,camera);
}
function collectPose(){
 const meshes=[],skins=[],bones=[];
 root?.traverse(node=>{
  if(node.isSkinnedMesh){
   skins.push({mesh:node.name,joints:node.skeleton?.bones?.length||0});
   meshes.push({name:node.name,morph:(node.morphTargetInfluences||[]).map(Number)});
  }
  if(node.isBone)bones.push({
   name:node.name,quaternion:node.quaternion.toArray(),
   position:node.position.toArray()
  });
 });
 return {loaded:Boolean(parsed),sourceName:loadedName,playing,seconds:poseSeconds,
  activeClip,clips:parsed?.animations?.map(a=>({name:a.name,duration:a.duration}))||[],
  skins,bonesCount:bones.length,
  selectedBoneRotations:bones.slice(0,30).filter((_,i)=>[0,14,27].includes(i)),
  meshes,frameCounter};
}
function selectClip(index){
 if(!parsed)throw Error('No imported GLB');
 if(!Number.isInteger(index)||index<0||index>=parsed.animations.length)
  throw Error('Invalid animation clip index '+index);
 playing=false;activeClip=index;poseSeconds=0;
 mixer.stopAllAction();
 mixer.time=0;activeAction=mixer.clipAction(parsed.animations[index]);
 activeAction.reset();activeAction.setLoop(THREE.LoopRepeat,Infinity);
 activeAction.clampWhenFinished=false;activeAction.play();
 mixer.setTime(0);
 byId('clip').value=String(index);
 byId('timeline').max=String(Math.round(parsed.animations[index].duration*1000));
 byId('timeline').value='0';byId('readout').textContent='0.00 s';
 byId('play').textContent='▶ Play';
 renderer.render(world,camera);
 return collectPose();
}
function seek(seconds){
 if(!parsed?.animations.length)throw Error('No imported animation');
 const duration=parsed.animations[activeClip].duration;
 if(!Number.isFinite(seconds)||seconds<0||seconds>duration)throw Error('Seek out of range');
 const wasPlaying=playing;
 playing=false;
 activeAction.paused=false;
 mixer.setTime(seconds);
 activeAction.paused=!wasPlaying;
 poseSeconds=seconds;
 root.updateMatrixWorld(true);
 byId('timeline').value=String(Math.round(seconds*1000));
 byId('readout').textContent=seconds.toFixed(2)+' s';
 renderer.render(world,camera);
 return collectPose();
}
async function loadBinary(bytes,name='local-rigged.glb'){
 const data=buf(bytes);
 if(data.length>64*1024*1024)throw Error('GLB is larger than 64 MB profile budget');
 // Loading happens in a detached graph. Failed file never destroys the active rig.
 const fresh=await loader.parseAsync(data.buffer.slice(data.byteOffset,data.byteOffset+data.byteLength),'');
 const skins=[],morphs=[];
 fresh.scene.traverse(node=>{
  if(node.isSkinnedMesh)skins.push(node);
  if(node.morphTargetInfluences?.length)morphs.push(node);
 });
 if(!fresh.scene||!skins.length)throw Error('Expected real skin and skinned mesh, not a static/flat image');
 if(!fresh.animations?.length)throw Error('No animation clips in source GLB');
 const old=root;
 playing=false;root=fresh.scene;parsed=fresh;sourceBytes=data.slice();
 mixer=new THREE.AnimationMixer(root);skinned=skins[0];loadedName=name;
 world.add(root);if(old)world.remove(old);
 const select=byId('clip');select.replaceChildren();
 parsed.animations.forEach((clip,index)=>{
  const option=document.createElement('option');option.value=String(index);
  option.textContent=clip.name+' · '+clip.duration.toFixed(2)+' s';
  select.add(option);
 });
 byId('message').dataset.error='no';
 byId('message').textContent='REAL GLB · '+skins.length+' SkinnedMesh · '+
  skinned.skeleton.bones.length+' bones · '+morphs.length+' morph-enabled mesh · '+
  parsed.animations.length+' clips. Experimental, not Neon Boy.';
 const state=selectClip(0);centerView('front');
 return state;
}
async function exportRoundTrip(){
 if(!parsed||!root)throw Error('No GLB');
 // Force rest state to avoid baking currently displayed pose into glTF node TRS.
 const saved=poseSeconds,wasPlaying=playing;playing=false;
 seek(0);
 let bytes;
 try{
  const exported=await new GLTFExporter().parseAsync(root,{
   binary:true,trs:true,onlyVisible:false,includeCustomExtensions:true,
   animations:parsed.animations
  });
  if(!(exported instanceof ArrayBuffer))throw Error('GLTFExporter returned non-binary');
  bytes=new Uint8Array(exported);
 }finally{
  seek(saved);playing=wasPlaying;
 }
 const reimported=await loader.parseAsync(bytes.buffer,'');
 const secondMeshes=[],secondMorphs=[];
 reimported.scene.traverse(n=>{
  if(n.isSkinnedMesh)secondMeshes.push(n);
  if(n.morphTargetInfluences?.length)secondMorphs.push(n.morphTargetInfluences.length);
 });
 const expected={
  jointCount:skinned.skeleton.bones.length,
  clips:parsed.animations.map(c=>c.name),
  morphTargets:skinned.morphTargetInfluences?.length||0
 };
 const result={
  glb:bytes,
  before:expected,
  after:{
   jointCount:secondMeshes[0]?.skeleton?.bones?.length||0,
   clips:reimported.animations.map(c=>c.name),
   morphTargets:secondMorphs[0]||0
  }
 };
 result.semanticPass=result.before.jointCount===result.after.jointCount&&
  result.before.morphTargets===result.after.morphTargets&&
  JSON.stringify(result.before.clips)===JSON.stringify(result.after.clips);
 if(!result.semanticPass)throw Error('GLB exporter/reimport semantic loss: '+JSON.stringify(result));
 return result;
}
function download(bytes,name){
 const url=URL.createObjectURL(new Blob([bytes],{type:'model/gltf-binary'}));
 const link=document.createElement('a');link.href=url;link.download=name;link.click();
 setTimeout(()=>URL.revokeObjectURL(url),1000);
}
byId('picker').addEventListener('change',async event=>{
 const f=event.target.files?.[0];if(!f)return;
 try{await loadBinary(new Uint8Array(await f.arrayBuffer()),f.name);}
 catch(error){errorDisplay(error);}
 event.target.value='';
});
byId('clip').addEventListener('change',e=>{
 try{selectClip(Number(e.target.value));}catch(error){errorDisplay(error);}
});
byId('timeline').addEventListener('input',e=>{
 try{seek(Number(e.target.value)/1000)}catch(error){errorDisplay(error);}
});
byId('play').addEventListener('click',()=>{
 if(!parsed)return;
 playing=!playing;
 if(activeAction)activeAction.paused=!playing;
 byId('play').textContent=playing?'Ⅱ Pause':'▶ Play';
});
for(const v of ['front','left','right','back','threequarter','top']){
 byId('view-'+v).addEventListener('click',()=>centerView(v));
}
byId('export').addEventListener('click',async()=>{
 try{
  const result=await exportRoundTrip();
  download(result.glb,'MARK-Rig-Animated-ThreeJS-RoundTrip.glb');
  byId('message').textContent='GLTFExporter → GLTFLoader passed skin/morph/clip headline inventory. '+
   'Vertex, UV, samplers, animation keyframes need a separate numeric fidelity check.';
 }catch(error){errorDisplay(error);}
});
window.MARK_RIG_VIEWER_API={
 loadBinary,selectClip,seek,pose:collectPose,centerView,
 exportRoundTrip,canvas:()=>canvas.toDataURL('image/png'),
 render:()=>{renderer.render(world,camera);return collectPose();},
 gpu:()=>{const g=renderer.getContext();return {
  webgl2:typeof WebGL2RenderingContext!=='undefined'&&g instanceof WebGL2RenderingContext,
  vendor:g.getParameter(g.VENDOR),renderer:g.getParameter(g.RENDERER),
  drawCalls:renderer.info.render.calls,triangles:renderer.info.render.triangles,
  actualHardwareUnverified:true};},
 transport:()=>({sourceBytes:sourceBytes?.length||0,loadedName})
};
window.addEventListener('resize',resize);resize();
requestAnimationFrame(frame);
if(window.MARK_EMBEDDED_RIG_BASE64){
 try{
  const base64=atob(window.MARK_EMBEDDED_RIG_BASE64);
  const data=Uint8Array.from(base64,c=>c.charCodeAt(0));
  loadBinary(data,'rig70-morph2-clips3.glb')
   .then(()=>{window.__MARK_RIG_VIEWER_READY__=true;})
   .catch(error=>{errorDisplay(error);window.__MARK_RIG_VIEWER_READY__=false;});
 }catch(error){errorDisplay(error);}
}

