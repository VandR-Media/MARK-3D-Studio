/**
 * MARK Visual Engine v2 — TRUE Three.js 3D, PBR, stereo motion and glTF export.
 * Objects remain editable in the declarative scene graph; no prerendered plates.
 */
import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {GLTFExporter} from 'three/addons/exporters/GLTFExporter.js';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {RGBELoader} from 'three/addons/loaders/RGBELoader.js';
import {RoomEnvironment} from 'three/addons/environments/RoomEnvironment.js';
import {EffectComposer} from 'three/addons/postprocessing/EffectComposer.js';
import {RenderPass} from 'three/addons/postprocessing/RenderPass.js';
import {UnrealBloomPass} from 'three/addons/postprocessing/UnrealBloomPass.js';
import {OutputPass} from 'three/addons/postprocessing/OutputPass.js';
import {validateVisualScene} from './scene-model.js';
import {inspectVisualImport} from './glb-guard.js';
import {validateStereoFrame} from './audio-frame.js';
const clamp=x=>Math.max(0,Math.min(1,x));
function shapeRect(w,h,r){
 const s=new THREE.Shape(),x=-w/2,y=-h/2;
 r=Math.min(r,w/2-.001,h/2-.001);
 s.moveTo(x+r,y);s.lineTo(x+w-r,y);s.quadraticCurveTo(x+w,y,x+w,y+r);
 s.lineTo(x+w,y+h-r);s.quadraticCurveTo(x+w,y+h,x+w-r,y+h);
 s.lineTo(x+r,y+h);s.quadraticCurveTo(x,y+h,x,y+h-r);
 s.lineTo(x,y+r);s.quadraticCurveTo(x,y,x+r,y);
 return s;
}
export function makeVisualGeometry(g,quality='normal'){
 const radial=quality==='eco'?12:quality==='high'?36:24;
 switch(g.type){
  case 'group':case 'imported':return null;
  case 'box':return new THREE.BoxGeometry(g.width||1,g.height||1,g.depth||1);
  case 'bevel-box':{
   const w=g.width||1,h=g.height||1,d=g.depth||.15,bevel=Math.min(g.bevel||.015,d*.40);
   const base=Math.max(.002,d-2*bevel);
   const result=new THREE.ExtrudeGeometry(shapeRect(w-2*bevel,h-2*bevel,g.radius||.04),
    {depth:base,steps:1,bevelEnabled:bevel>.001,bevelSize:bevel,bevelThickness:bevel,
     bevelSegments:quality==='eco'?1:quality==='high'?4:2,curveSegments:quality==='eco'?3:7});
   result.translate(0,0,-base/2);
   return result;
  }
  case 'cylinder':return new THREE.CylinderGeometry(g.radiusTop||.1,g.radiusBottom||.1,g.height||.1,
   g.radialSegments||radial,1,false);
  case 'sphere':return new THREE.SphereGeometry(g.radius||.5,radial,quality==='eco'?8:20);
  case 'torus':return new THREE.TorusGeometry(g.radius||.5,g.tube||.05,radial,radial*2);
  case 'disk':return new THREE.CircleGeometry(g.radius||.5,radial*2);
  case 'plane':return new THREE.PlaneGeometry(g.width||1,g.height||1);
  case 'needle':{
   const w=g.width||.045,l=g.length||1,d=g.depth||.02;
   const outline=new THREE.Shape();
   outline.moveTo(-w*1.5,-.04);outline.lineTo(w*1.5,-.04);
   outline.lineTo(w*.65,l*.69);outline.lineTo(0,l);
   outline.lineTo(-w*.65,l*.69);outline.closePath();
   const r=new THREE.ExtrudeGeometry(outline,{steps:1,depth:d,bevelEnabled:false});
   r.translate(0,0,-d/2);return r;
  }
  case 'tube':{
   const r=g.radius||.03,length=g.length||1;
   return new THREE.CylinderGeometry(r,r,length,radial);
  }
  default:throw Error('Visual Engine geometry not implemented '+g.type);
 }
}
function makeMaterial(m){
 const props={color:m.color,metalness:m.metalness,roughness:m.roughness,
  emissive:m.emissive||'#000000',emissiveIntensity:m.emissiveIntensity||0,
  opacity:m.opacity??1,transparent:(m.opacity??1)<1,
  side:THREE.FrontSide,depthWrite:(m.opacity??1)===1};
 if(m.type==='physical')return new THREE.MeshPhysicalMaterial({...props,
  transmission:m.transmission??0,thickness:m.thickness??.08,ior:m.ior??1.48,
  envMapIntensity:1.3,clearcoat:.12,clearcoatRoughness:.12});
 if(m.type==='basic')return new THREE.MeshBasicMaterial(props);
 return new THREE.MeshStandardMaterial(props);
}
async function loadTextureData(data,slot){
 const tx=await new THREE.TextureLoader().loadAsync(data);
 if(slot==='baseColor'||slot==='emissive')tx.colorSpace=THREE.SRGBColorSpace;
 tx.flipY=false;tx.needsUpdate=true;return tx;
}
function applyMap(material,slot,texture){
 const key={baseColor:'map',normal:'normalMap',metallicRoughness:'metalnessMap',
  emissive:'emissiveMap',ao:'aoMap'}[slot];
 material[key]=texture;
 if(slot==='metallicRoughness')material.roughnessMap=texture;
 material.needsUpdate=true;
}
const dimensions={eco:{pixel:1,bloom:false,shadows:false,env:false},
 normal:{pixel:1.4,bloom:true,shadows:true,env:true},
 high:{pixel:2,bloom:true,shadows:true,env:true}};
export class VisualRenderer{
 constructor(canvas,{profile='normal'}={}){
  this.canvas=canvas;this.profile=profile;
  this.renderer=new THREE.WebGLRenderer({canvas,antialias:true,alpha:false,preserveDrawingBuffer:true,powerPreference:'high-performance'});
  this.renderer.outputColorSpace=THREE.SRGBColorSpace;
  this.renderer.toneMapping=THREE.ACESFilmicToneMapping;
  this.renderer.toneMappingExposure=1.14;
  this.renderer.shadowMap.type=THREE.PCFSoftShadowMap;
  this.world=new THREE.Scene();
  this.camera=new THREE.PerspectiveCamera(37,1,.05,100);
  this.camera.position.set(0,0,13);
  this.controls=new OrbitControls(this.camera,canvas);
  this.controls.enableDamping=true;this.controls.dampingFactor=.13;
  this.controls.minDistance=4;this.controls.maxDistance=35;
  this.controls.addEventListener('change',()=>this.render());
  this.root=new THREE.Group();this.root.name='MARK Visual Scene';
  this.world.add(this.root);
  this.nodes=new Map();this.boundScene=null;this.ownedGeometry=[];this.ownedMaterials=[];
  this.motionLevels=new Map();this.lastMotionAt=null;
  this.occluders=[];this.raycaster=new THREE.Raycaster();this.onRender=null;
  this.pmrem=null;this.composer=null;this.environmentTexture=null;this.setProfile(profile);
 }
 setProfile(profile){
  if(!dimensions[profile])throw Error('Unknown quality '+profile);
  this.profile=profile;const q=dimensions[profile];
  this.renderer.shadowMap.enabled=q.shadows;
  const dpr=typeof devicePixelRatio==='number'?devicePixelRatio:1;
  this.renderer.setPixelRatio(Math.min(dpr,q.pixel));
  this.rebuildPostprocess();this.resize();
 }
 rebuildPostprocess(){
  this.composer?.dispose();this.composer=null;
  if(!dimensions[this.profile].bloom)return;
  this.composer=new EffectComposer(this.renderer);
  this.composer.addPass(new RenderPass(this.world,this.camera));
  this.composer.addPass(new UnrealBloomPass(new THREE.Vector2(512,512),
    this.profile==='high'?.48:.29,.48,.79));
  this.composer.addPass(new OutputPass());
 }
 resize(width=this.canvas.clientWidth,height=this.canvas.clientHeight){
  width=Math.max(1,Math.floor(width||640));height=Math.max(1,Math.floor(height||480));
  this.renderer.setSize(width,height,false);
  this.camera.aspect=width/height;this.camera.updateProjectionMatrix();
  this.composer?.setSize(width,height);this.render();
 }
 async setScene(scene){
  validateVisualScene(scene);
  // Phase 1: all asynchronous GLB/image/IBL work and geometry construction
  // happen in a DETACHED graph. Active scene, camera and GPU materials remain
  // usable until every component is ready.
  const stagedRoot=new THREE.Group();
  stagedRoot.name=scene.name;
  const stagedNodes=new Map();
  const stagedLights=[];
  const stagedGeometries=new Set(),stagedMaterials=new Set(),stagedTextures=new Set();
  let stagedEnvironment=null,committed=false;
  try{
   const importedGraphs=await Promise.all((scene.attachments||[]).map(async asset=>{
    const binary=Uint8Array.from(atob(asset.data.split(',')[1]),c=>c.charCodeAt(0));
    inspectVisualImport(binary);
    const gltf=await new GLTFLoader().parseAsync(binary.buffer,'');
    const nodes=[];gltf.scene.traverse(node=>nodes.push(node));
    return nodes;
   }));
   for(const obj of scene.objects)if(obj.geometry.type==='imported'){
    const graph=importedGraphs[obj.geometry.asset];
    const source=graph?.[obj.geometry.node];
    if(!source)throw Error('Missing GLB node '+obj.id);
    const parent=source.parent;
    const index=parent?graph.indexOf(parent):-1;
    const expected=index<0?null:scene.objects.find(x=>x.geometry.type==='imported'&&
     x.geometry.asset===obj.geometry.asset&&x.geometry.node===index)?.id;
    if(index>=0&&obj.parent!==expected)
     throw Error('GLB hierarchy mismatch '+obj.id);
   }
   const mats=new Map();
   for(const [id,record] of Object.entries(scene.materials)){
    const material=makeMaterial(record);
    stagedMaterials.add(material);
    for(const [slot,data] of Object.entries(record.maps||{})){
     const texture=await loadTextureData(data,slot);
     stagedTextures.add(texture);applyMap(material,slot,texture);
    }
    mats.set(id,material);
   }
   const q=dimensions[this.profile];
   if(q.env){
    const generator=this.pmrem||(this.pmrem=new THREE.PMREMGenerator(this.renderer));
    try{
     if(scene.environment.hdri){
      const hdr=await new RGBELoader().loadAsync(scene.environment.hdri);
      try{stagedEnvironment=generator.fromEquirectangular(hdr).texture;}
      finally{hdr.dispose?.();}
     }else{
      const room=new RoomEnvironment();
      try{stagedEnvironment=generator.fromScene(room).texture;}
      finally{room.dispose();}
     }
    }catch(error){
     if(scene.environment.hdri)throw Error('HDRI preparation failed: '+error.message);
     console.warn('MARK Visual Engine: using direct PBR lights',error);
    }
   }
   for(const light of scene.lights){
    let target;
    if(light.type==='ambient')target=new THREE.AmbientLight(light.color,light.intensity);
    else if(light.type==='point')target=new THREE.PointLight(light.color,light.intensity,40);
    else if(light.type==='spot')target=new THREE.SpotLight(light.color,light.intensity,40);
    else target=new THREE.DirectionalLight(light.color,light.intensity);
    target.position.set(...light.position);
    target.castShadow=Boolean(light.castShadow&&q.shadows);
    if(target.castShadow){
     target.shadow.mapSize.set(this.profile==='high'?2048:1024,
      this.profile==='high'?2048:1024);
     target.shadow.bias=-.0002;target.shadow.camera.near=.1;
     target.shadow.camera.far=40;
    }
    target.userData.visualLight=true;
    stagedLights.push(target);
   }
   for(const obj of scene.objects){
    const source=obj.geometry.type==='imported'?
     importedGraphs[obj.geometry.asset]?.[obj.geometry.node]:null;
    const geo=source?.isMesh?source.geometry:makeVisualGeometry(obj.geometry,this.profile);
    const mat=mats.get(obj.material);
    if(geo&&!source)stagedGeometries.add(geo);
    if(source?.isMesh)stagedGeometries.add(source.geometry);
    if(geo&&mat?.aoMap&&geo.attributes.uv&&!geo.attributes.uv2)
     geo.setAttribute('uv2',geo.attributes.uv.clone());
    const target=source?source.clone(false):
     geo?new THREE.Mesh(geo,mat||new THREE.MeshBasicMaterial({color:'#ffffff'})):new THREE.Group();
    if(source?.isMesh&&mat)target.material=mat;
    target.name='mark_'+Array.from(obj.id,c=>c.charCodeAt(0).toString(16).padStart(2,'0')).join('');
    target.userData.displayName=obj.name;target.userData.markId=obj.id;
    target.userData.meta=structuredClone(obj.meta||{});
    target.position.set(...obj.position);target.rotation.set(...obj.rotation);
    target.scale.set(...obj.scale);target.visible=obj.visible;
    if(target.isMesh){
     const materials=Array.isArray(target.material)?target.material:[target.material];
     materials.forEach(m=>stagedMaterials.add(m));
     const transmissive=materials.some(m=>m?.transmission>0);
     target.castShadow=!transmissive;target.receiveShadow=!transmissive;
     if(target.userData.meta.role==='led'){
      target.material=mat.clone();stagedMaterials.add(target.material);
      target.userData.onColor=mat.color.clone();
      target.material.emissiveIntensity=0;target.material.color.set('#15212b');
     }
    }
    stagedNodes.set(obj.id,target);
   }
   for(const obj of scene.objects)
    (obj.parent?stagedNodes.get(obj.parent):stagedRoot).add(stagedNodes.get(obj.id));
   stagedRoot.updateMatrixWorld(true);
   const occluders=[...stagedNodes.values()].filter(o=>
    o.isMesh&&o.material?.opacity>=1&&!o.material.transparent&&
    !(o.material?.transmission>0));
   // Phase 2: commit. No asynchronous operations or creation of materials/meshes.
   const oldRoot=this.root,oldEnvironment=this.environmentTexture;
   const oldLights=this.world.children.filter(o=>o.userData.visualLight);
   this.world.remove(oldRoot,...oldLights);
   this.root=stagedRoot;this.world.add(stagedRoot,...stagedLights);
   this.world.background=new THREE.Color(scene.environment.color);
   this.world.environment=stagedEnvironment;
   this.environmentTexture=stagedEnvironment;
   this.world.environmentIntensity=scene.environment.intensity;
   this.renderer.toneMappingExposure=scene.environment.exposure??1.14;
   this.camera.position.set(...scene.camera.position);
   this.camera.near=scene.camera.near;this.camera.far=scene.camera.far;
   this.camera.fov=scene.camera.fov;this.camera.updateProjectionMatrix();
   this.controls.target.set(...scene.camera.target);
   this.nodes=stagedNodes;this.occluders=occluders;
   this.boundScene=structuredClone(scene);
   this.motionLevels.clear();this.lastMotionAt=null;
   committed=true;
   // Cleanup is after the successful switch: the previous project is still
   // fully rendered until this point. Dispose distinct owned GPU resources.
   const oldGeo=new Set(),oldMat=new Set(),oldTx=new Set();
   oldRoot.traverse(o=>{if(o.isMesh){
    oldGeo.add(o.geometry);
    for(const m of Array.isArray(o.material)?o.material:[o.material]){
     if(!m)continue;
     oldMat.add(m);
     for(const slot of ['map','normalMap','metalnessMap','roughnessMap','emissiveMap','aoMap'])
      if(m[slot])oldTx.add(m[slot]);
    }
   }});
   oldGeo.forEach(g=>g.dispose());
   oldMat.forEach(m=>m.dispose());
   oldTx.forEach(t=>t.dispose());
   if(oldEnvironment&&oldEnvironment!==stagedEnvironment)oldEnvironment.dispose();
   this.controls.update();this.resize();
   return {objects:this.nodes.size,meshes:[...this.nodes.values()].filter(o=>o.isMesh).length};
  }finally{
   if(!committed){
    stagedGeometries.forEach(g=>g.dispose());
    stagedMaterials.forEach(m=>m.dispose());
    stagedTextures.forEach(t=>t.dispose());
    stagedEnvironment?.dispose();
   }
  }
 }
 applyFrame(frame){
  validateStereoFrame(frame);
  if(!this.boundScene)return;
  const now=typeof performance==='object'?performance.now():Date.now();
  const dt=this.lastMotionAt===null?1/30:
   Math.min(.10,Math.max(.001,(now-this.lastMotionAt)/1000));
  this.lastMotionAt=now;
  for(const b of this.boundScene.bindings){
   const target=this.nodes.get(b.target);if(!target)continue;
   const path=b.signal.split('.');
   const raw=frame.playing?(path.length===2?frame[path[0]]?.[path[1]]:frame[b.signal])||0:0;
   const goal=clamp(raw);
   const previous=this.motionLevels.get(b.target)||{value:0,peak:0,holdUntil:0};
   const attack=(b.attackMs??(b.response==='needle'?85:40))/1000;
   const release=(b.releaseMs??(b.response==='needle'?260:175))/1000;
   const tau=goal>previous.value?Math.max(.001,attack):Math.max(.001,release);
   const value=frame.playing?
    previous.value+(goal-previous.value)*(1-Math.exp(-dt/tau)):0;
   const effective=clamp(value*(b.gain??1));
   let peak=previous.peak,holdUntil=previous.holdUntil;
   if(!frame.playing){peak=0;holdUntil=0;}
   else if(value>=peak){peak=value;holdUntil=now+(b.peakHoldMs??260);}
   else if(now>holdUntil){peak=Math.max(value,peak-dt*.8);}
   this.motionLevels.set(b.target,{value,peak,holdUntil});
   if(b.response==='needle')target.rotation.z=(b.offset??-.95)+effective;
   else if(b.response==='led-column'){
    const segments=target.children.filter(led=>led.isMesh&&led.userData.meta?.role==='led');
    const heldIndex=Math.min(segments.length-1,
     Math.max(0,Math.ceil(clamp(peak*(b.gain??1))*segments.length)-1));
    for(const [index,led] of segments.entries()){
     const held=frame.playing&&peak>value+.02&&index===heldIndex;
     const isOn=effective>=led.userData.meta.threshold||held;
     led.material.emissiveIntensity=isOn?(held?1.25:2.2):0;
     led.material.color.copy(isOn?led.userData.onColor:new THREE.Color('#15212b'));
    }
   }else if(b.response==='scale-y')target.scale.y=Math.max(.005,effective);
   else if(b.response==='rotation-z')target.rotation.z=(b.offset??0)+effective;
   else if(b.response==='position-y')target.position.y=(b.offset??0)+effective;
   else if(b.response==='emissive'&&target.isMesh)target.material.emissiveIntensity=effective*4;
  }
  this.render();
 }
 /**
  * World-space anchored 2D typography: follows yaw/pitch/zoom and node
  * transforms. Opaque front geometry hides labels; transmissive glazing does
  * not. HUD-only overlays can still use normalized x/y without an anchor.
  */
 projectOverlay(item){
  if(!item.anchor)return {x:item.x,y:item.y,visible:true};
  const node=this.nodes.get(item.anchor);
  if(!node||!Array.isArray(item.offset))return {x:0,y:0,visible:false};
  this.root.updateMatrixWorld(true);this.camera.updateMatrixWorld();
  const world=node.localToWorld(new THREE.Vector3(...item.offset));
  const projected=world.clone().project(this.camera);
  if(projected.z< -1||projected.z>1||Math.abs(projected.x)>1.05||Math.abs(projected.y)>1.05)
   return {x:0,y:0,visible:false};
  const direction=world.clone().sub(this.camera.position),distance=direction.length();
  let occluded=false;
  if(distance>.05){
   this.raycaster.set(this.camera.position,direction.normalize());
   this.raycaster.near=.01;this.raycaster.far=Math.max(.01,distance-.025);
   occluded=this.raycaster.intersectObjects(this.occluders,false).length>0;
  }
  return {x:.5+projected.x*.5,y:.5-projected.y*.5,visible:!occluded};
 }
 render(){
  if(!this.renderer||!this.camera)return;
  if(this.composer)this.composer.render();else this.renderer.render(this.world,this.camera);
  this.onRender?.();
 }
 setView(view){
  const views={front:[0,0,13],detail:[0,0,8],left:[-8,1,10],right:[8,1,10],left30:[-6.5,0,11.26],right30:[6.5,0,11.26],threequarter:[5,3,12],
   side:[13,0,0],back:[0,0,-13]};
  if(!views[view])throw Error('Unknown camera view '+view);
  this.camera.position.set(...views[view]);this.controls.target.set(0,0,0);
  this.controls.update();this.render();
 }
 applyAnimation(clipId,time){
  const clip=this.boundScene?.animation?.clips?.find(x=>x.id===clipId);
  if(!clip)throw Error('Unknown animation clip '+clipId);
  const t=clip.loop?((time%clip.duration)+clip.duration)%clip.duration:
   Math.min(clip.duration,Math.max(0,time));
  for(const track of clip.tracks){
   const o=this.nodes.get(track.target);if(!o)continue;
   const keys=track.keys;
   let i=0;while(i<keys.length-2&&keys[i+1].time<t)i++;
   const first=keys[i],last=keys[i+1];
   const alpha=Math.max(0,Math.min(1,(t-first.time)/(last.time-first.time)));
   const values=first.value.map((a,j)=>a+(last.value[j]-a)*alpha);
   if(track.property==='position')o.position.set(...values);
   else if(track.property==='scale')o.scale.set(...values);
   else if(track.property==='rotation')o.rotation.set(...values);
  }
  this.render();
  return {clip:clipId,time:t};
 }
 async importGlb(input){
  // Describe the native hierarchy, retaining original PBR textures and geometry
  // in its embedded attachment. The caller adds these editable references.
  const bytes=input instanceof ArrayBuffer?input:input.buffer.slice(input.byteOffset,input.byteOffset+input.byteLength);
  const gltf=await new GLTFLoader().parseAsync(bytes,'');
  const nodes=[],parents=[];
  const walk=(o,parent)=>{
   const index=nodes.length;
   nodes.push({name:o.name||('GLB part '+index),parent,sourceMarkId:o.userData?.markId||null,
    position:o.position.toArray(),rotation:[o.rotation.x,o.rotation.y,o.rotation.z],
    scale:o.scale.toArray(),visible:o.visible,isMesh:Boolean(o.isMesh)});
   for(const child of o.children)walk(child,index);
  };
  walk(gltf.scene,null);
  return {objects:nodes.length,meshes:nodes.filter(x=>x.isMesh).length,nodes};
 }
 async exportGlb(){
  const exporter=new GLTFExporter();
  const exportRoot=this.root.clone(true);
  exportRoot.add(this.camera.clone());
  for(const object of this.world.children)
   if(object.userData.visualLight)exportRoot.add(object.clone());
  const animations=[];
  for(const clip of this.boundScene?.animation?.clips||[]){
   const tracks=[];
   for(const track of clip.tracks){
    const times=track.keys.map(k=>k.time);
    if(track.property==='rotation'){
     const values=track.keys.flatMap(k=>new THREE.Quaternion()
      .setFromEuler(new THREE.Euler(...k.value)).toArray());
     tracks.push(new THREE.QuaternionKeyframeTrack(this.nodes.get(track.target).name+'.quaternion',times,values));
    }else{
     const values=track.keys.flatMap(k=>k.value);
     tracks.push(new THREE.VectorKeyframeTrack(this.nodes.get(track.target).name+'.'+track.property,times,values));
    }
   }
   animations.push(new THREE.AnimationClip(clip.id,clip.duration,tracks));
  }
  const data=await exporter.parseAsync(exportRoot,{
   binary:true,trs:true,onlyVisible:false,includeCustomExtensions:true,animations});
  return new Uint8Array(data);
 }
 dispose(){
  this.controls.dispose();this.composer?.dispose();this.environmentTexture?.dispose();
  this.pmrem?.dispose();this.renderer.dispose();
 }
}
