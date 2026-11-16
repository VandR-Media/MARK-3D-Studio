import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {parseGlb,writeGlb,assertSelfContainedGlb} from './glb.js';
import {getMaterialValues,setMaterialValues} from './materials.js';
import {createSampleGlb} from './sample.js';

const $=id=>document.getElementById(id);
const ui={holder:$('canvasHolder'),file:$('modelFile'),name:$('modelName'),
 empty:$('emptyState'),sample:$('loadSample'),status:$('status'),
 select:$('materialSelect'),color:$('colorInput'),colorValue:$('colorValue'),
 metallic:$('metallicInput'),metallicValue:$('metallicValue'),
 roughness:$('roughnessInput'),roughnessValue:$('roughnessValue'),
 reset:$('resetButton'),export:$('exportButton'),cameraReset:$('resetCamera'),
 count:$('materialCount'),renderMode:$('renderMode'),hint:$('materialHint')};
let scene,camera,renderer,controls,grid,active=null,lastFile='mark-model.glb',timer=0,raf=0;

function notify(text,bad=false) {
 ui.status.textContent=text;ui.status.classList.toggle('error',bad);ui.status.classList.add('show');
 clearTimeout(timer);timer=setTimeout(()=>ui.status.classList.remove('show'),6500);
}
function createViewer(){
 const canvas=document.createElement('canvas');
 const context=canvas.getContext('webgl2',{antialias:true});
 if(!context){
  ui.renderMode.textContent='НЕТ WEBGL 2';
  ui.empty.querySelector('h1').textContent='WebGL 2 недоступен';
  ui.empty.querySelector('p').textContent='Откройте страницу в браузере, поддерживающем WebGL 2.';
  ui.file.disabled=true;ui.sample.disabled=true;return false;
 }
 try{renderer=new THREE.WebGLRenderer({canvas,context,antialias:true,powerPreference:'default'});}
 catch(e){ui.renderMode.textContent='ОШИБКА WEBGL';notify(e.message,true);return false;}
 renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,1.7));
 renderer.outputColorSpace=THREE.SRGBColorSpace;
 renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.3;
 ui.holder.append(renderer.domElement);
 scene=new THREE.Scene();
 camera=new THREE.PerspectiveCamera(43,1,.01,10000);camera.position.set(3,2,5);
 controls=new OrbitControls(camera,renderer.domElement);
 controls.enableDamping=true;controls.dampingFactor=.08;controls.screenSpacePanning=true;
 controls.minDistance=.01;controls.maxDistance=10000;controls.update();
 scene.add(new THREE.HemisphereLight(0xc4d6ff,0x4c506e,2.1));
 const key=new THREE.DirectionalLight(0xffffff,3.2);key.position.set(4,7,6);scene.add(key);
 const fill=new THREE.DirectionalLight(0x8b88ff,1.4);fill.position.set(-5,2,-4);scene.add(fill);
 grid=new THREE.GridHelper(10,20,0x5a608c,0x34415b);
 grid.material.transparent=true;grid.material.opacity=.4;scene.add(grid);
 renderer.domElement.addEventListener('webglcontextlost',e=>{
  e.preventDefault();cancelAnimationFrame(raf);raf=0;
  notify('Контекст WebGL потерян. Перезагрузите страницу и откройте GLB снова.',true);
 });
 function resize(){const w=Math.max(1,ui.holder.clientWidth),h=Math.max(1,ui.holder.clientHeight);
  camera.aspect=w/h;camera.updateProjectionMatrix();renderer.setSize(w,h,false);}
 new ResizeObserver(resize).observe(ui.holder);resize();
 function frame(){if(document.hidden){raf=0;return;}raf=requestAnimationFrame(frame);controls.update();renderer.render(scene,camera);}
 document.addEventListener('visibilitychange',()=>{if(!document.hidden&&!raf)frame();});
 frame();return true;
}
function reframe(){
 if(!active?.gltf?.scene)return;
 const box=new THREE.Box3().setFromObject(active.gltf.scene);if(box.isEmpty())return;
 const center=box.getCenter(new THREE.Vector3()),sphere=box.getBoundingSphere(new THREE.Sphere());
 const radius=Math.max(.05,sphere.radius);
 const distance=radius*1.8/Math.sin(THREE.MathUtils.degToRad(camera.fov*.5));
 camera.position.set(center.x+distance*.73,center.y+distance*.3,center.z+distance*.72);
 camera.near=Math.max(.001,distance/10000);camera.far=Math.max(100,distance*100);camera.updateProjectionMatrix();
 controls.target.copy(center);controls.minDistance=Math.max(.002,radius*.1);
 controls.maxDistance=Math.max(2,radius*80);controls.update();
 grid.position.y=box.min.y-radius*.015;grid.scale.setScalar(Math.max(.05,radius/2));
}
function updateStats(root,clips){
 let meshes=0,triangles=0;const bones=new Set();
 root.traverse(n=>{
  if(n.isBone)bones.add(n);
  if(n.isMesh){
   meshes++;const g=n.geometry;triangles+=Math.floor((g.index?.count??g.attributes.position?.count??0)/3);
   if(n.isSkinnedMesh)n.skeleton?.bones?.forEach(b=>bones.add(b));
  }
 });
 $('meshCount').textContent=meshes.toLocaleString('ru-RU');
 $('triangleCount').textContent=triangles.toLocaleString('ru-RU');
 $('animationCount').textContent=String(clips.length);$('boneCount').textContent=String(bones.size);
}
function bindMaterials(gltf){
 const map=new Map();
 gltf.scene.traverse(obj=>{
  if(!obj.isMesh)return;
  const materials=Array.isArray(obj.material)?obj.material:[obj.material];
  for(const material of materials){
   const idx=gltf.parser.associations.get(material)?.materials;
   if(!Number.isInteger(idx))continue;
   if(!map.has(idx))map.set(idx,new Set());map.get(idx).add(material);
  }
 });
 return map;
}
function applyLive(idx){
 if(!active)return;const v=getMaterialValues(active.draft,idx);
 for(const m of active.bindings.get(idx)||[]){
  if(m.color)m.color.set(v.hex);
  if('metalness' in m)m.metalness=v.metallic;
  if('roughness' in m)m.roughness=v.roughness;
  m.needsUpdate=true;
 }
}
function setFields(idx){
 if(!active||!Number.isInteger(idx)||idx<0)return;
 const v=getMaterialValues(active.draft,idx);
 ui.color.value=v.hex;ui.colorValue.textContent=v.hex.toUpperCase();
 ui.metallic.value=String(v.metallic);ui.metallicValue.textContent=v.metallic.toFixed(2);
 ui.roughness.value=String(v.roughness);ui.roughnessValue.textContent=v.roughness.toFixed(2);
 [ui.color,ui.metallic,ui.roughness].forEach(c=>c.disabled=false);
 ui.metallic.disabled=ui.roughness.disabled=v.unlit;
 const shown=active.bindings.get(idx)?.size||0;
 ui.hint.textContent=(v.unlit?'Материал без освещения: металличность и шероховатость недоступны. ':'')+
  (v.textured?'Цвет умножается на исходную текстуру. ':'')+
  (shown?'Материал используется в показанной сцене.':'Материал не используется показанной сценой, но сохранится в GLB.');
}
function edit(){
 if(!active)return;const idx=Number(ui.select.value);
 if(!Number.isInteger(idx)||idx<0||idx>=(active.draft.materials?.length||0))return;
 try{
  const old=getMaterialValues(active.draft,idx);
  setMaterialValues(active.draft,idx,{
   hex:ui.color.value,
   metallic:old.unlit?old.metallic:Number(ui.metallic.value),
   roughness:old.unlit?old.roughness:Number(ui.roughness.value)});
  setFields(idx);applyLive(idx);
 }catch(e){notify(e.message,true);}
}
function clearModel(){
 if(!active)return;
 scene.remove(active.gltf.scene);
 const geometries=new Set(),materials=new Set(),textures=new Set();
 active.gltf.scene.traverse(n=>{
  if(!n.isMesh)return;
  if(n.geometry)geometries.add(n.geometry);
  for(const m of (Array.isArray(n.material)?n.material:[n.material]))if(m)materials.add(m);
 });
 for(const m of materials)for(const value of Object.values(m))if(value?.isTexture)textures.add(value);
 for(const g of geometries)g.dispose();
 for(const m of materials)m.dispose();
 for(const t of textures)t.dispose();
 active=null;
}
async function openModel(bytes,name){
 const parsed=parseGlb(bytes);assertSelfContainedGlb(parsed.json);
 const gltf=await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
 if(!gltf.scene)throw new Error('В GLB нет 3D-сцены.');
 clearModel();
 const draft=structuredClone(parsed.json);
 active={parsed,draft,gltf,bindings:bindMaterials(gltf)};
 lastFile=name;scene.add(gltf.scene);ui.empty.hidden=true;ui.name.textContent=name;
 const count=draft.materials?.length||0;ui.count.textContent=String(count);ui.select.replaceChildren();
 for(let i=0;i<count;i++){
  const option=document.createElement('option');option.value=String(i);
  option.textContent=(i+1)+'. '+getMaterialValues(draft,i).name;ui.select.append(option);
 }
 ui.select.disabled=!count;ui.reset.disabled=!count;ui.export.disabled=false;ui.cameraReset.disabled=false;
 if(count){ui.select.value='0';setFields(0);}
 else{[ui.color,ui.metallic,ui.roughness].forEach(c=>c.disabled=true);
  ui.hint.textContent='В этом GLB нет явных материалов. Их создание появится позже.';}
 updateStats(gltf.scene,gltf.animations||[]);reframe();notify('GLB открыт: '+name+'. Данные остаются на устройстве.');
}
async function loadFile(file){
 if(!file)return;
 if(!file.name.toLowerCase().endsWith('.glb')){notify('Открываются только бинарные .glb.',true);return;}
 if(file.size>80*1024*1024){notify('Для MVP установлен предел 80 МБ.',true);return;}
 ui.name.textContent='Чтение: '+file.name;
 try{await openModel(new Uint8Array(await file.arrayBuffer()),file.name);}
 catch(e){ui.name.textContent=active?lastFile:'Ошибка открытия';notify('Ошибка GLB: '+e.message,true);}
}
function reset(){
 if(!active)return;
 active.draft=structuredClone(active.parsed.json);
 for(let i=0;i<(active.draft.materials?.length||0);i++)applyLive(i);
 setFields(Number(ui.select.value));notify('Изменения сброшены.');
}
function save(){
 if(!active)return;
 try{
  const bytes=writeGlb(active.parsed,active.draft);
  const blob=new Blob([bytes],{type:'model/gltf-binary'}),url=URL.createObjectURL(blob);
  const a=document.createElement('a');a.href=url;a.download=lastFile.replace(/\.glb$/i,'')+'-edited.glb';
  document.body.append(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),60000);
  notify('Экспортировано: '+(blob.size/1048576).toFixed(2)+' МБ');
 }catch(e){notify('Ошибка экспорта: '+e.message,true);}
}
ui.file.addEventListener('change',async()=>{const file=ui.file.files?.[0];ui.file.value='';await loadFile(file);});
ui.sample.addEventListener('click',async()=>{
 try{await openModel(createSampleGlb(),'cosmic-test.glb');}
 catch(e){notify('Ошибка тестовой модели: '+e.message,true);}
});
ui.select.addEventListener('change',()=>setFields(Number(ui.select.value)));
[ui.color,ui.metallic,ui.roughness].forEach(c=>c.addEventListener('input',edit));
ui.reset.addEventListener('click',reset);ui.export.addEventListener('click',save);
ui.cameraReset.addEventListener('click',reframe);
createViewer();
