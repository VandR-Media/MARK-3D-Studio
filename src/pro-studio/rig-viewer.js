/**
 * MARK Professional Studio / Release 1 experimental animated GLB viewport.
 * Separate from Visual Engine v2. This is a genuine Three.js WebGL2, GLTFLoader,
 * AnimationMixer and GLTFExporter pipeline; NOT an editable mesh/rig studio.
 * Does NOT claim approved Neon Boy, production .markscene v3 or Huawei metrics.
 */
import * as THREE from 'three';
import {createViewportPicker} from './viewport-picking.js';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {GLTFExporter} from 'three/addons/exporters/GLTFExporter.js';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {parseGlb} from '../glb.js';
import {createAiBridge} from './ai-bridge-core.js';
import {createPreviewMarkscene,openPreviewMarkscene,repackPreviewMarkscene,exportEditedSourceGlb} from './markscene-v3-preview.js';

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
let cachedSourceDoc=null;
let root=null,parsed=null,mixer=null,activeAction=null,activeClip=0,playing=false,
 fixtureBytes=null,sourceBytes=null,skinned=null,loadedName='',poseSeconds=0,
 raf=0,lastTick=0,frameCounter=0;
let nativeProjectSource=null,nativeProjectOpened=null,nativeNodeIndex=0,
 nativeMaterialIndex=0,nativeEdits={
  nodeTransforms:{},materialPbr:{},selection:{clipIndex:0,timeSeconds:0}
 };
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
 controls.update();
 if(typeof meshPicker!=='undefined')meshPicker.update();
 renderer.render(world,camera);frameCounter++;
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
  }
  if(node.isMesh){
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
 nativeEdits.selection={clipIndex:index,timeSeconds:0};
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
 nativeEdits.selection={clipIndex:activeClip,timeSeconds:seconds};
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
 if(!fresh.scene||!fresh.scene.children.length)
  throw Error('GLB scene has no visible nodes');
 const visibleMeshes=[];fresh.scene.traverse(node=>{if(node.isMesh)visibleMeshes.push(node);});
 if(!visibleMeshes.length)throw Error('GLB scene contains no renderable geometry');
 const old=root;
 playing=false;root=fresh.scene;parsed=fresh;sourceBytes=data.slice();
 nativeProjectSource=data.slice();nativeProjectOpened=null;
 nativeEdits={nodeTransforms:{},materialPbr:{},selection:{clipIndex:0,timeSeconds:0}};
 const doc=parseGlb(data).json;
 cachedSourceDoc=doc;
 nativeNodeIndex=Math.max(0,doc.nodes.findIndex(x=>x.mesh!==undefined));
 nativeMaterialIndex=0;
 mixer=new THREE.AnimationMixer(root);skinned=skins[0]||visibleMeshes[0];loadedName=name;
 world.add(root);if(old)world.remove(old);
 const select=byId('clip');select.replaceChildren();
 parsed.animations.forEach((clip,index)=>{
  const option=document.createElement('option');option.value=String(index);
  option.textContent=clip.name+' · '+clip.duration.toFixed(2)+' s';
  select.add(option);
 });
 byId('message').dataset.error='no';
 byId('message').textContent='REAL GLB · '+visibleMeshes.length+
  ' mesh · '+skins.length+' skinned · '+
  (skinned.skeleton?.bones?.length||0)+' bones · '+morphs.length+
  ' morph-enabled · '+parsed.animations.length+
  ' clips. Standalone native primitive scenes are supported (preview).';
 byId('play').disabled=parsed.animations.length===0;
 byId('clip').disabled=parsed.animations.length===0;
 byId('timeline').disabled=parsed.animations.length===0;
 const state=parsed.animations.length?selectClip(0):collectPose();
 centerView('front');
 byId('rig-x').value=String(skinned.position.x);
 byId('rig-rough').value=String((Array.isArray(skinned.material)?
  skinned.material[0]:skinned.material)?.roughness??.6);
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
function download(bytes,name,type='model/gltf-binary'){
 const url=URL.createObjectURL(new Blob([bytes],{type}));
 const link=document.createElement('a');link.href=url;link.download=name;link.click();
 setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function projectEdits(){
 return structuredClone(nativeEdits);
}
function applyProjectEdit({translationX,roughnessFactor}={}){
 if(!nativeProjectSource||!skinned)throw Error('Open a skinned GLB first');
 const sourceDoc=parseGlb(nativeProjectSource).json;
 if(translationX!==undefined){
  if(!Number.isFinite(translationX)||Math.abs(translationX)>25)
   throw Error('Translation X outside editor preview range');
  const origin=sourceDoc.nodes[nativeNodeIndex].translation?.slice()||[0,0,0];
  origin[0]=translationX;
  nativeEdits.nodeTransforms[String(nativeNodeIndex)]={translation:origin};
  skinned.position.x=translationX;
  byId('rig-x').value=String(translationX);
 }
 if(roughnessFactor!==undefined){
  if(!Number.isFinite(roughnessFactor)||roughnessFactor<0||roughnessFactor>1)
   throw Error('Roughness outside PBR range');
  if(!sourceDoc.materials?.[nativeMaterialIndex])
   throw Error('No editable PBR material in this GLB');
  nativeEdits.materialPbr[String(nativeMaterialIndex)]={roughnessFactor};
  const material=Array.isArray(skinned.material)?skinned.material[0]:skinned.material;
  if(material){material.roughness=roughnessFactor;material.needsUpdate=true;}
  byId('rig-rough').value=String(roughnessFactor);
 }
 root.updateMatrixWorld(true);renderer.render(world,camera);
 return {edits:projectEdits(),skinnedX:skinned.position.x,
  roughness:(Array.isArray(skinned.material)?skinned.material[0]:skinned.material)?.roughness};
}
async function saveNativeProject(){
 if(!nativeProjectSource)throw Error('Open GLB before saving .markscene');
 const result=nativeProjectOpened?
  await repackPreviewMarkscene(nativeProjectOpened,nativeEdits):
  await createPreviewMarkscene(nativeProjectSource,{
   projectId:'mark-rig-experimental',name:loadedName,
   license:'source-unknown',edits:nativeEdits});
 const reopened=await openPreviewMarkscene(result.archive);
 if(JSON.stringify(reopened.edits)!==JSON.stringify(nativeEdits))
  throw Error('Native project test reopen changed edit data');
 return {archive:result.archive,sha256:result.archiveSha256,
  manifest:reopened.manifest,sourceSha256:reopened.sourceSha256};
}
async function openNativeProject(bytes){
 const loaded=await openPreviewMarkscene(bytes);
 const exported=await exportEditedSourceGlb(loaded);
 // Reconstruct the working scene from the exact original binary + saved edits.
 await loadBinary(exported.glb,loaded.manifest.name+'.markscene');
 nativeProjectSource=loaded.sourceGLB.slice();
 nativeProjectOpened=loaded;
 nativeEdits=structuredClone(loaded.edits);
 const originDoc=parseGlb(nativeProjectSource).json;
 nativeNodeIndex=Math.max(0,originDoc.nodes.findIndex(x=>x.skin!==undefined));
 const savedX=nativeEdits.nodeTransforms[String(nativeNodeIndex)]?.translation?.[0];
 const savedR=nativeEdits.materialPbr[String(nativeMaterialIndex)]?.roughnessFactor;
 byId('rig-x').value=String(savedX??skinned.position.x);
 const material=Array.isArray(skinned.material)?skinned.material[0]:skinned.material;
 byId('rig-rough').value=String(savedR??material?.roughness??.6);
 const clip=nativeEdits.selection.clipIndex;
 const time=nativeEdits.selection.timeSeconds;
 if(parsed.animations.length){
  selectClip(clip);
  seek(Math.min(parsed.animations[clip].duration,time));
 }
 byId('message').textContent='Открыт собственный .markscene v3 (эксперимент): original GLB SHA-256 '+
  loaded.sourceSha256.slice(0,12)+' · TRS/PBR правки восстановлены · 3D и анимации сохранены.';
 return {manifest:loaded.manifest,edits:projectEdits(),sourceSha256:loaded.sourceSha256,
  pose:collectPose()};
}
async function exportNativeEditedGLB(){
 const saved=await saveNativeProject(),opened=await openPreviewMarkscene(saved.archive);
 return exportEditedSourceGlb(opened);
}
byId('project-save').addEventListener('click',async()=>{
 try{
  const saved=await saveNativeProject();
  download(saved.archive,'MARK-Rig-Experiment.markscene','application/zip');
  byId('message').textContent='Проект v3-preview сохранён. Исходный GLB и изменения TRS/PBR защищены хэшами.';
 }catch(error){errorDisplay(error);}
});
byId('project-open').addEventListener('change',async e=>{
 const file=e.target.files?.[0];if(!file)return;
 try{await openNativeProject(new Uint8Array(await file.arrayBuffer()));}
 catch(error){errorDisplay(error);}
 e.target.value='';
});
byId('project-export').addEventListener('click',async()=>{
 try{
  const result=await exportNativeEditedGLB();
  download(result.glb,'MARK-Rig-Edited-Project.glb');
  byId('message').textContent='Создан новый GLB с применёнными TRS/PBR правками. '+
   'Бинарные данные скелета, морфов, UV, текстур и клипов сохранены.';
 }catch(error){errorDisplay(error);}
});
for(const [id,field] of [['rig-x','translationX'],['rig-rough','roughnessFactor']]){
 byId(id).addEventListener('input',e=>{
  try{applyProjectEdit({[field]:Number(e.target.value)});}
  catch(error){errorDisplay(error);}
 });
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
 applyProjectEdit,projectEdits,saveNativeProject,openNativeProject,exportNativeEditedGLB,
 exportRoundTrip,canvas:()=>canvas.toDataURL('image/png'),
 render:()=>{renderer.render(world,camera);return collectPose();},
 gpu:()=>{const g=renderer.getContext();return {
  webgl2:typeof WebGL2RenderingContext!=='undefined'&&g instanceof WebGL2RenderingContext,
  vendor:g.getParameter(g.VENDOR),renderer:g.getParameter(g.RENDERER),
  drawCalls:renderer.info.render.calls,triangles:renderer.info.render.triangles,
  actualHardwareUnverified:true};},
 transport:()=>({sourceBytes:sourceBytes?.length||0,loadedName})
};

/**
 * AI Bridge connects to THE SAME real local WebGL2 renderer. There is no
 * HTTP listener. Mutations require the user's visible checkbox grant.
 */
const bridge=createAiBridge({
 appVersion:'0.7.0-alpha.0',buildHash:'experimental-branch-no-reproducible-hash',
 allowWrites:()=>byId('bridge-write-grant')?.checked===true,
 adapter:{
  openGLB:async(bytes,context={})=>{
   await loadBinary(bytes,'MARK AI Bridge committed GLB');
   const select=context.edits?.selection||{};
   if(parsed.animations.length){
    const clip=Math.min(select.clipIndex||0,parsed.animations.length-1);
    selectClip(clip);
    seek(Math.min(select.timeSeconds||0,parsed.animations[clip].duration));
   }
  },
  camera:async view=>centerView(view),
  capture:async ({view,timeSeconds})=>{
   if(!parsed)throw Error('No glTF loaded in real renderer');
   if(parsed.animations.length){
    const idx=Math.min(bridge.getSnapshot().edits?.selection?.clipIndex||0,
     parsed.animations.length-1);
    selectClip(idx);seek(Math.min(timeSeconds,parsed.animations[idx].duration));
   }else if(timeSeconds!==0)
    throw Error('Static primitive has no timeline: capture time must be 0');
   centerView(view);renderer.render(world,camera);
   const encoded=canvas.toDataURL('image/png').split(',')[1];
   if(!encoded)throw Error('WebGL2 toDataURL capture is empty');
   const binary=atob(encoded);
   const output=Uint8Array.from(binary,c=>c.charCodeAt(0));
   return {data:output,width:canvas.width,height:canvas.height,
    renderer:'Three.js WebGL2 / connected live viewer, not Huawei device'};
  }
 }
});
window.MARK_AI_BRIDGE={
 request:request=>bridge.request(request),
 getSnapshot:()=>bridge.getSnapshot(),
 getAudit:()=>bridge.getAudit()
};
const meshPicker=createViewportPicker({
 canvas,scene:world,camera,
 getRoot:()=>root,getParsed:()=>parsed,getSourceDoc:()=>cachedSourceDoc,
 render:()=>renderer.render(world,camera)
});
const meshPickState=()=>meshPicker.getSelection();
function reportPickedElement(selection){
 const status=byId('mesh-selection');
 if(!selection){status.textContent='Элемент не выбран. Коснитесь вершины, ребра или треугольника на модели.';return;}
 byId('mesh-id').value=String(selection.meshIndex);
 byId('mesh-a').value=String(selection.mode==='vertex'?selection.vertex:
  selection.mode==='edge'?selection.edge[0]:selection.face);
 if(selection.mode==='edge')byId('mesh-b').value=String(selection.edge[1]);
 if(selection.mode==='vertex')
  byId('mesh-op').value='vertex.move';
 else if(selection.mode==='edge')
  byId('mesh-op').value='edge.split';
 else
  byId('mesh-op').value='face.flip';
 status.textContent='Выбрано: '+selection.meshId+' / '+selection.mode+' #'+
  (selection.mode==='vertex'?selection.vertex:
   selection.mode==='edge'?selection.edge.join('–'):selection.face)+
  ' (настоящая геометрия WebGL2).';
}
byId('mesh-pick-toggle').addEventListener('click',()=>{
 if(!meshSession){
  byId('mesh-selection').textContent='Сначала нажмите «Открыть Edit Mode».';
  return;
 }
 const next=!meshPicker.getEnabled();
 meshPicker.setEnabled(next);
 byId('mesh-pick-toggle').setAttribute('aria-pressed',String(next));
 byId('mesh-pick-toggle').textContent='Выделение в 3D: '+(next?'включено':'выключено');
 if(next)meshPicker.setMode(byId('mesh-pick-mode').value);
 else reportPickedElement(null);
});
byId('mesh-pick-mode').addEventListener('change',e=>{
 meshPicker.setMode(e.target.value);
 meshPicker.clear();reportPickedElement(null);
});
canvas.addEventListener('click',event=>{
 if(!meshSession||!meshPicker.getEnabled())return;
 const rect=canvas.getBoundingClientRect();
 try{
  const selected=meshPicker.pickAt(event.clientX-rect.left,event.clientY-rect.top);
  reportPickedElement(selected);
 }catch(error){
  byId('mesh-selection').textContent='Не удалось выбрать элемент: '+String(error?.message||error);
 }
});
window.MARK_MESH_PICK_API={
 enable:v=>meshPicker.setEnabled(v),
 setMode:v=>meshPicker.setMode(v),
 pickAt:(x,y,mode)=>{const hit=meshPicker.pickAt(x,y,mode);reportPickedElement(hit);return hit;},
 projectVertex:(meshIndex,vertexIndex,primitiveIndex=0)=>
  meshPicker.projectVertex(meshIndex,vertexIndex,primitiveIndex),
 projectEdge:(meshIndex,start,end,primitiveIndex=0)=>
  meshPicker.projectEdge(meshIndex,start,end,primitiveIndex),
 projectFace:(meshIndex,faceIndex,primitiveIndex=0)=>
  meshPicker.projectFace(meshIndex,faceIndex,primitiveIndex),
 selection:meshPickState
};

byId('bridge-demo').addEventListener('click',async()=>{
 const outcome=byId('bridge-output');
 outcome.textContent='Выполняется локальная транзакция…';
 let seq=0,assetId=null,tx=null;
 const doCall=async(method,params={})=>{
  const reply=await bridge.request({requestId:'ui.'+(++seq),method,params});
  if(!reply.ok)throw Error(reply.diagnostics[0]?.code+': '+
   reply.diagnostics[0]?.message);
  return reply.result;
 };
 try{
  if(!byId('bridge-write-grant').checked)
   throw Error('Разрешите изменения через флажок AI Bridge.');
  if(!sourceBytes)throw Error('Сначала откройте GLB.');
  const upload=await doCall('asset.upload',{
   name:'local-rig-from-ui.glb',type:'glb',data:sourceBytes
  });assetId=upload.assetId;
  await doCall('scene.open',{assetId});
  const started=await doCall('transaction.begin');tx=started.transactionId;
  await doCall('object.setTransform',{uuid:'gltf-node-1',
   transform:{translation:[.25,0,0]}});
  await doCall('material.setPbr',{materialId:'gltf-material-0',
   pbr:{roughnessFactor:.27}});
  await doCall('animation.preview',{clipIndex:Math.min(2,parsed.animations.length-1),
   timeSeconds:Math.min(3,parsed.animations[0].duration)});
  const commit=await doCall('transaction.commit',{transactionId:tx});tx=null;
  const shot=await doCall('render.capture',{view:'threequarter',timeSeconds:3});
  const saved=await doCall('scene.save');
  const exported=await doCall('scene.export');
  download(shot.data,'MARK-AI-Bridge-REAL-WebGL2.png','image/png');
  download(saved.data,'MARK-AI-Bridge-Editable.markscene','application/zip');
  outcome.textContent='Сделано: revision '+commit.revision+
   ', настоящее WebGL2 '+shot.width+'×'+shot.height+
   ', scene SHA '+saved.sha256.slice(0,12)+
   ', GLB SHA '+exported.sha256.slice(0,12)+
   '. Получены PNG и .markscene. API доступен только в этой странице.';
 }catch(error){
  if(tx)await bridge.request({requestId:'ui.rollback',method:'transaction.rollback',
   params:{transactionId:tx}});
  outcome.textContent='Ошибка AI Bridge: '+String(error?.message||error);
 }
});

// Mesh Edit Mode P7: in-process real indexed-triangle binary edit controls.
let meshSession=false,meshCallSeq=0;
const meshOutput=()=>byId('mesh-output');
const meshCall=async(method,params={})=>{
 const r=await bridge.request({requestId:'mesh.ui.'+(++meshCallSeq),method,params});
 if(!r.ok)throw Error(r.diagnostics[0]?.code+': '+r.diagnostics[0]?.message);
 return r.result;
};
const meshId=()=> 'gltf-mesh-'+Number(byId('mesh-id').value);
const meshShow=async(prefix='Mesh Edit')=>{
 const stats=await meshCall('mesh.getStats',{meshId:meshId()});
 meshOutput().textContent=prefix+': '+stats.vertexCount+' вершин, '+
  stats.edgeCount+' рёбер, '+stats.triangleCount+' треугольников, '+
  stats.morphTargets+' морфа, topology rev '+stats.topologyRevision+
  '. Настоящий GLB, сохраните проект через AI Bridge.';
};
async function createPrimitiveInViewport(method){
 if(!byId('bridge-write-grant').checked)
  throw Error('Для создания сцены требуется разрешить изменения AI Bridge.');
 const args={
  shape:byId('primitive-shape').value,
  size:Number(byId('primitive-size').value),
  segments:Number(byId('primitive-segments').value)
 };
 const result=await meshCall(method,args);
 const hierarchy=await meshCall('scene.getHierarchy');
 const last=[...hierarchy.nodes].reverse().find(n=>n.meshId);
 if(last){
  byId('mesh-id').value=last.meshId.replace('gltf-mesh-','');
 }
 meshSession=true;meshPicker.clear();
 const summary=method==='scene.new'?'Создан проект с пустой сцены':'Добавлен новый mesh datablock';
 const stats=await meshCall('mesh.getStats',{meshId:meshId()});
 byId('primitive-output').textContent=summary+': '+args.shape+
  ', '+stats.vertexCount+' вершин / '+stats.triangleCount+
  ' треугольников. Результат — настоящий GLB, а не концептуальный рендер.';
 await meshShow(summary);
 return{...result,meshId:meshId(),stats};
}
for(const [id,method] of [
 ['primitive-new','scene.new'],
 ['primitive-add','mesh.create']
]){
 byId(id).addEventListener('click',async()=>{
  try{await createPrimitiveInViewport(method);}
  catch(error){byId('primitive-output').textContent=
   'Не удалось создать примитив: '+String(error?.message||error);}
 });
}
window.MARK_PRIMITIVE_API={
 newScene:()=>createPrimitiveInViewport('scene.new'),
 add:()=>createPrimitiveInViewport('mesh.create')
};
byId('mesh-open').addEventListener('click',async()=>{
 try{
  if(!byId('bridge-write-grant').checked)
   throw Error('Требуется разрешение записи AI Bridge.');
  if(!sourceBytes)throw Error('Сначала загрузите GLB.');
  const upload=await meshCall('asset.upload',{
   name:'mesh-edit-input.glb',type:'glb',data:sourceBytes
  });
  await meshCall('scene.open',{assetId:upload.assetId});
  meshSession=true;meshPicker.clear();
  await meshShow('Режим геометрии открыт');
 }catch(error){meshOutput().textContent='Ошибка: '+String(error?.message||error);}
});
byId('mesh-apply').addEventListener('click',async()=>{
 try{
  if(!meshSession)throw Error('Нажмите «Открыть Edit Mode».');
  if(!byId('bridge-write-grant').checked)
   throw Error('Требуется разрешение записи AI Bridge.');
  const kind=byId('mesh-op').value;
  const a=Number(byId('mesh-a').value),b=Number(byId('mesh-b').value);
  const d=['mesh-dx','mesh-dy','mesh-dz'].map(id=>Number(byId(id).value));
  const operation=kind==='vertex.move'?{kind,vertex:a,delta:d}:
   kind==='vertex.snap'?{kind,vertex:a,targetVertex:b}:
   kind==='edge.split'?{kind,start:a,end:b,factor:.5}:
   kind==='normal.recalculate'?{kind}:
   {kind,face:a};
  if(kind==='face.delete'&&!window.confirm(
   'Удалить треугольную грань '+a+' из геометрии? Undo будет доступен.'))return;
  const result=await meshCall('mesh.edit',{meshId:meshId(),operation});
  await meshShow(kind+' сохранено, scene rev '+result.revision);
 }catch(error){meshOutput().textContent='Ошибка: '+String(error?.message||error);}
});
for(const [id,method] of [['mesh-undo','history.undo'],['mesh-redo','history.redo']]){
 byId(id).addEventListener('click',async()=>{
  try{
   if(!meshSession)throw Error('Откройте Edit Mode.');
   await meshCall(method);
   await meshShow(method);
  }catch(error){meshOutput().textContent='Ошибка: '+String(error?.message||error);}
 });
}

for(const [id,method,type,name] of [
 ['mesh-save','scene.save','application/zip','MARK-Mesh-Edit-v3-preview.markscene'],
 ['mesh-export','scene.export','model/gltf-binary','MARK-Mesh-Edit-Real-Geometry.glb']
]){
 byId(id).addEventListener('click',async()=>{
  try{
   if(!meshSession)throw Error('Сначала откройте Edit Mode.');
   const file=await meshCall(method);
   download(file.data,name,type);
   meshOutput().textContent='Экспортирован настоящий '+name+
    ', '+file.bytes+' байт, SHA-256 '+file.sha256.slice(0,16)+'.';
  }catch(error){meshOutput().textContent='Ошибка: '+String(error?.message||error);}
 });
}

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

