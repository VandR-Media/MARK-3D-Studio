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
  case 'group':return null;
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
  opacity:m.opacity??1,transparent:(m.opacity??1)<1||m.transmission>0,
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
  const previous=this.root;
  this.root=new THREE.Group();this.root.name=scene.name;this.world.add(this.root);
  this.world.remove(previous);
  previous.traverse(o=>{if(o.isMesh){
   o.geometry.dispose();if(Array.isArray(o.material))o.material.forEach(m=>m.dispose());
   else o.material.dispose();
  }});
  this.nodes=new Map();this.boundScene=structuredClone(scene);
  this.renderer.toneMappingExposure=scene.environment.exposure??1.14;
  this.world.background=new THREE.Color(scene.environment.color);
  this.world.environment=null;
  this.environmentTexture?.dispose();this.environmentTexture=null;
  for(const object of [...this.world.children])if(object.userData.visualLight)this.world.remove(object);
  const q=dimensions[this.profile];
  if(q.env){
   const generator=this.pmrem||(this.pmrem=new THREE.PMREMGenerator(this.renderer));
   try{
    if(scene.environment.hdri){
     // Embeddable HDRI supplied as a data URI; no CDN or network required.
     const hdr=await new RGBELoader().loadAsync(scene.environment.hdri);
     this.environmentTexture=generator.fromEquirectangular(hdr).texture;
     hdr.dispose?.();
    }else{
     const room=new RoomEnvironment();
     this.environmentTexture=generator.fromScene(room).texture;
     room.dispose();
    }
    this.world.environment=this.environmentTexture;
    this.world.environmentIntensity=scene.environment.intensity;
   }catch(error){
    console.warn('MARK Visual Engine: environment fallback to three direct PBR lights',error);
   }
  }
  for(const l of scene.lights){
   let light;
   if(l.type==='ambient')light=new THREE.AmbientLight(l.color,l.intensity);
   else if(l.type==='point')light=new THREE.PointLight(l.color,l.intensity,40);
   else if(l.type==='spot')light=new THREE.SpotLight(l.color,l.intensity,40);
   else light=new THREE.DirectionalLight(l.color,l.intensity);
   light.position.set(...l.position);light.castShadow=Boolean(l.castShadow&&q.shadows);
   if(light.castShadow){light.shadow.mapSize.set(this.profile==='high'?2048:1024,
    this.profile==='high'?2048:1024);light.shadow.bias=-.0002;light.shadow.camera.near=.1;
    light.shadow.camera.far=40;}
   light.userData.visualLight=true;this.world.add(light);
  }
  this.camera.position.set(...scene.camera.position);
  this.camera.near=scene.camera.near;this.camera.far=scene.camera.far;this.camera.fov=scene.camera.fov;
  this.controls.target.set(...scene.camera.target);this.camera.updateProjectionMatrix();this.controls.update();
  const mats=new Map();
  for(const [id,record] of Object.entries(scene.materials)){
   const material=makeMaterial(record);
   for(const [slot,data] of Object.entries(record.maps||{}))
    await applyMap(material,slot,await loadTextureData(data,slot));
   mats.set(id,material);
  }
  for(const object of scene.objects){
   const geo=makeVisualGeometry(object.geometry,this.profile);
   const mat=mats.get(object.material);
   if(geo&&mat?.aoMap&&geo.attributes.uv&&!geo.attributes.uv2)
    geo.setAttribute('uv2',geo.attributes.uv.clone());
   const target=geo?new THREE.Mesh(geo,mat||new THREE.MeshBasicMaterial({color:'#ffffff'})):new THREE.Group();
   target.name=object.name;target.userData.markId=object.id;target.userData.meta=structuredClone(object.meta||{});
   target.position.set(...object.position);target.rotation.set(...object.rotation);
   target.scale.set(...object.scale);target.visible=object.visible;
   if(target.isMesh){target.castShadow=true;target.receiveShadow=true;
    if(target.userData.meta.role==='led'){
     // Separate material per lens: independent real emission per frequency band.
     target.material=mat.clone();target.userData.onColor=mat.color.clone();
     target.material.emissiveIntensity=0;target.material.color.set('#15212b');
    }
   }
   this.nodes.set(object.id,target);
  }
  for(const o of scene.objects){
   const target=this.nodes.get(o.id),parent=o.parent?this.nodes.get(o.parent):this.root;
   parent.add(target);
  }
  this.resize();
  return {objects:this.nodes.size,meshes:[...this.nodes.values()].filter(x=>x.isMesh).length};
 }
 applyFrame(frame){
  validateStereoFrame(frame);
  if(!this.boundScene)return;
  for(const b of this.boundScene.bindings){
   const target=this.nodes.get(b.target);if(!target)continue;
   const path=b.signal.split('.');
   const value=frame.playing?(path.length===2?frame[path[0]]?.[path[1]]:frame[b.signal])||0:0;
   const magnitude=clamp(value);
   if(b.response==='needle')target.rotation.z=(b.offset??-.95)+magnitude*(b.gain??1);
   else if(b.response==='led-column'){
    for(const led of target.children){
     if(!led.isMesh||led.userData.meta?.role!=='led')continue;
     const isOn=clamp(magnitude*(b.gain??1))>=led.userData.meta.threshold;
     led.material.emissiveIntensity=isOn?2.2:0;
     led.material.color.copy(isOn?led.userData.onColor:new THREE.Color('#15212b'));
    }
   }else if(b.response==='scale-y')target.scale.y=Math.max(.005,magnitude);
   else if(b.response==='rotation-z')target.rotation.z=(b.offset??0)+magnitude;
   else if(b.response==='position-y')target.position.y=(b.offset??0)+magnitude;
   else if(b.response==='emissive'&&target.isMesh)target.material.emissiveIntensity=magnitude*4;
  }
  this.render();
 }
 render(){
  if(!this.renderer||!this.camera)return;
  if(this.composer)this.composer.render();else this.renderer.render(this.world,this.camera);
 }
 setView(view){
  const views={front:[0,0,13],left:[-8,1,10],right:[8,1,10],threequarter:[5,3,12],
   side:[13,0,0],back:[0,0,-13]};
  if(!views[view])throw Error('Unknown camera view '+view);
  this.camera.position.set(...views[view]);this.controls.target.set(0,0,0);
  this.controls.update();this.render();
 }
 async importGlb(input){
  const bytes=input instanceof ArrayBuffer?input:input.buffer.slice(input.byteOffset,input.byteOffset+input.byteLength);
  const gltf=await new GLTFLoader().parseAsync(bytes,'');
  gltf.scene.userData.visualImported=true;
  gltf.scene.name='Imported genuine glTF scene';
  this.root.add(gltf.scene);this.render();
  return {objects:gltf.scene.children.length,meshes:(()=>{let n=0;gltf.scene.traverse(o=>{if(o.isMesh)n++;});return n;})()};
 }
 async exportGlb(){
  const exporter=new GLTFExporter();
  const exportRoot=this.root.clone(true);
  exportRoot.add(this.camera.clone());
  for(const object of this.world.children)
   if(object.userData.visualLight)exportRoot.add(object.clone());
  const data=await exporter.parseAsync(exportRoot,{
   binary:true,trs:true,onlyVisible:false,includeCustomExtensions:true});
  return new Uint8Array(data);
 }
 dispose(){
  this.controls.dispose();this.composer?.dispose();this.environmentTexture?.dispose();
  this.pmrem?.dispose();this.renderer.dispose();
 }
}
