import * as THREE from 'three';
import {MeshEditor,sceneMeshList} from './mesh-core.js';
import {parseGlb,writeGlb} from './glb.js';

// Mobile interaction lives separately from the binary deformation engine.
// Mesh Edit and Camera have mutually exclusive pointer handling.
export function initMeshUi(api){
 const root=document.getElementById('meshUi');
 if(!root)return {onModel(){},clear(){},exportGlb:null};
 root.innerHTML=[
 '<div class="mesh-title"><strong>Геометрия · v0.3</strong><small>Тестовый редактор формы</small></div>',
 '<div class="mesh-buttons" role="group" aria-label="Режим">',
 ' <button id="modeObject" class="mesh-btn chosen">Объекты</button>',
 ' <button id="modeEdit" class="mesh-btn">Mesh Edit</button></div>',
 '<label class="field-label" for="meshObject">Объект сцены</label>',
 '<select id="meshObject" disabled><option>Откройте GLB</option></select>',
 '<p id="meshSafety" class="mesh-note">Доступность редактирования определяется структурой GLB.</p>',
 '<div id="meshControls" hidden>',
 ' <div class="mesh-tabs" role="group" aria-label="Выделение">',
 '  <button id="meshNavigate" class="mesh-btn chosen">Камера</button>',
 '  <button id="meshPick" class="mesh-btn">Выделить</button>',
 '  <button id="meshSculpt" class="mesh-btn">Скульпт</button></div>',
 ' <div id="meshSelectionControls" hidden>',
 '  <div class="mesh-buttons"><button data-select="vertex" class="mesh-btn chosen">Вершина</button>',
 '  <button data-select="edge" class="mesh-btn">Ребро</button><button data-select="face" class="mesh-btn">Полигон</button></div>',
 '  <label class="mesh-check"><input type="checkbox" id="multiSelect"> Добавлять к выделению</label>',
 '  <div class="mesh-note" id="selectedInfo">Выбрано: 0</div>',
 '  <div class="mesh-grid3"><select id="transformMode" aria-label="Преобразование"><option value="move">Переместить</option><option value="scale">Масштаб</option><option value="rotate">Вращать</option></select>',
 '  <select id="transformAxis" aria-label="Ось"><option value="x">X</option><option value="y">Y</option><option value="z" selected>Z</option></select>',
 '  <input type="number" id="transformValue" aria-label="Величина" value="0.05" step="0.01"></div>',
 '  <button id="applyTransform" class="mesh-btn primary full-width">Применить к вершинам</button>',
 '  <div class="mesh-buttons"><button id="transformMinus" class="mesh-btn">− шаг</button><button id="transformPlus" class="mesh-btn">+ шаг</button></div>',
 ' </div>',
 ' <div id="meshBrushControls" hidden>',
 '  <div class="mesh-buttons wrap">',
 '  <button data-brush="grab" class="mesh-btn chosen">Grab</button><button data-brush="smooth" class="mesh-btn">Smooth</button>',
 '  <button data-brush="inflate" class="mesh-btn">Inflate</button><button data-brush="pinch" class="mesh-btn">Pinch</button>',
 '  <button data-brush="flatten" class="mesh-btn">Flatten</button><button data-brush="crease" class="mesh-btn">Crease</button>',
 '  <button data-brush="clay" class="mesh-btn">Clay</button><button data-brush="relax" class="mesh-btn">Relax</button></div>',
 '  <label class="mesh-slider">Радиус <output id="brushRadiusLabel">0.35</output><input id="brushRadius" type="range" min="0.04" max="1.4" step="0.01" value="0.35"></label>',
 '  <label class="mesh-slider">Сила <output id="brushStrengthLabel">0.45</output><input id="brushStrength" type="range" min="0.01" max="1" step="0.01" value="0.45"></label>',
 '  <label class="field-label" for="brushFalloff">Профиль затухания</label>',
 '  <select id="brushFalloff"><option value="smooth">Плавный</option><option value="linear">Линейный</option><option value="sharp">Чёткий контур</option></select>',
 '  <p class="mesh-note">Одним пальцем — кисть. Нажмите «Камера», чтобы снова вращать модель.</p>',
 ' </div>',
 ' <label class="mesh-check"><input type="checkbox" id="meshSymmetry" checked> Симметрия X=0</label>',
 ' <div class="mesh-buttons"><button class="mesh-btn" id="meshUndo">↶ Отмена</button><button class="mesh-btn" id="meshRedo">↷ Повтор</button></div>',
 '</div>',
 '<div class="mesh-divider"></div>',
 '<div class="mesh-title"><strong>Камера и контроль</strong></div>',
 '<div class="mesh-buttons wrap"><button class="mesh-btn" data-view="front">Спереди</button><button class="mesh-btn" data-view="side">Сбоку</button>',
 '<button class="mesh-btn" data-view="top">Сверху</button><button class="mesh-btn" data-view="perspective">3/4</button>',
 '<button class="mesh-btn" id="orthographic">Ортографическая</button></div>',
 '<label class="mesh-check"><input id="meshWire" type="checkbox"> Wireframe поверх</label>',
 '<label class="mesh-check"><input id="meshNormals" type="checkbox"> Показать нормали</label>',
 '<div class="mesh-divider"></div>',
 '<div class="mesh-title"><strong>Художественные референсы</strong><small>Локальные файлы, не экспортируются</small></div>',
 '<select id="referenceType" aria-label="Ракурс референса"><option value="front">Спереди</option><option value="side">Сбоку</option>',
 '<option value="threequarter">Три четверти</option></select>',
 '<label class="button secondary mesh-file" for="referenceImage">Загрузить изображение</label>',
 '<input id="referenceImage" type="file" accept="image/png,image/jpeg,image/webp" hidden>',
 '<label class="mesh-slider">Прозрачность <output id="referenceOpacityLabel">0.45</output><input type="range" id="referenceOpacity" min="0.05" max="1" step="0.05" value="0.45"></label>',
 '<label class="mesh-slider">Размер <output id="referenceScaleLabel">1.00</output><input type="range" id="referenceScale" min="0.2" max="4" step="0.05" value="1"></label>',
 '<div class="mesh-grid3">',
 '<label>Позиция X<input id="referenceX" type="number" value="0" step="0.1"></label>',
 '<label>Позиция Y<input id="referenceY" type="number" value="0" step="0.1"></label>',
 '<label>Позиция Z<input id="referenceZ" type="number" value="-1.5" step="0.1"></label></div>',
 '<label class="mesh-check"><input id="referenceLock" type="checkbox" checked> Зафиксировать референс</label>',
 '<button class="mesh-btn full-width" id="removeReference">Убрать выбранный референс</button>',
 '<div class="mesh-divider"></div>',
 '<div class="mesh-title"><strong>Локальное восстановление</strong></div>',
 '<button id="restoreMesh" class="mesh-btn full-width">Открыть последний автосейв</button>',
 '<p class="mesh-note" id="meshAutosaveStatus">Сохранение в памяти браузера при изменениях — при доступности IndexedDB.</p>'
 ].join('\n');
 const $=id=>document.getElementById(id);
 const obj=$('meshObject'),modeEdit=$('modeEdit'),modeObject=$('modeObject'),meshControls=$('meshControls');
 const selectionControls=$('meshSelectionControls'),brushControls=$('meshBrushControls');
 const ctx={gltf:null,original:null,choices:[],mapping:new Map(),sessions:new Map(),current:null,currentIndex:-1,
  selected:new Set(),selectedFaceIndex:null,component:'vertex',mode:'object',tool:'camera',brush:'grab',
  stroke:null,wire:null,normals:null,references:new Map(),saveTimeout:null,keepReferences:false,dirty:false};
 const raycaster=new THREE.Raycaster(),pointer=new THREE.Vector2(),v1=new THREE.Vector3(),v2=new THREE.Vector3();
 let refLoaded=false;
 function setStatus(text){$('meshSafety').textContent=text;}
 function getMeshObject(descriptor){
  if(!ctx.gltf)return null;
  const found=[];
  ctx.gltf.scene.traverse(mesh=>{
   if(!mesh.isMesh)return;
   const assoc=ctx.gltf.parser.associations.get(mesh)||{};
   const node=ctx.gltf.parser.associations.get(mesh.parent)||{};
   if(assoc.meshes===descriptor.meshIndex&&
      (assoc.primitives===descriptor.primitiveIndex||assoc.primitives===undefined)&&
      (node.nodes===descriptor.nodeIndex||assoc.nodes===descriptor.nodeIndex))
    found.push(mesh);
  });
  if(found.length)return found[0];
  // Some GLTFLoader revisions attach associations to a wrapper, not the child.
  const all=[];ctx.gltf.scene.traverse(x=>{if(x.isMesh)all.push(x);});
  return all[ctx.currentIndex]||all[descriptor.primitiveIndex]||null;
 }
 function stopOverlay(){
  if(ctx.wire){ctx.wire.parent?.remove(ctx.wire);ctx.wire.geometry.dispose();ctx.wire.material.dispose();ctx.wire=null;}
  if(ctx.normals){ctx.normals.parent?.remove(ctx.normals);ctx.normals.geometry.dispose();ctx.normals.material.dispose();ctx.normals=null;}
 }
 function addWire(){
  if(!$('meshWire').checked||!ctx.current?.object)return;
  const geometry=new THREE.WireframeGeometry(ctx.current.object.geometry);
  const material=new THREE.LineBasicMaterial({color:0x8ce4ff,transparent:true,opacity:.25,depthTest:false});
  ctx.wire=new THREE.LineSegments(geometry,material);ctx.wire.renderOrder=10;
  ctx.current.object.add(ctx.wire);
 }
 function addNormals(){
  if(!$('meshNormals').checked||!ctx.current?.object||!ctx.current?.session)return;
  const s=ctx.current.session,step=Math.max(1,Math.floor(s.count/800)),points=[];
  for(let i=0;i<s.count;i+=step){
   const k=i*3,scale=.05;
   points.push(s.positions[k],s.positions[k+1],s.positions[k+2],
     s.positions[k]+s.normals[k]*scale,s.positions[k+1]+s.normals[k+1]*scale,s.positions[k+2]+s.normals[k+2]*scale);
  }
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(points,3));
  ctx.normals=new THREE.LineSegments(g,new THREE.LineBasicMaterial({color:0xe9e6ff,depthTest:false}));
  ctx.normals.renderOrder=11;ctx.current.object.add(ctx.normals);
 }
 function updateOverlays(){stopOverlay();addWire();addNormals();}
 function updateSelected(){
  const count=ctx.selected.size;
  $('selectedInfo').textContent=(ctx.component==='vertex'?'Вершины':ctx.component==='edge'?'Рёбра':'Полигоны')+
    ': выделено '+count+' вершин';
  if(!ctx.current?.object||!ctx.current?.session)return;
  let overlay=ctx.current.overlay;
  if(!overlay){
   overlay=new THREE.Points(new THREE.BufferGeometry(),new THREE.PointsMaterial({
    color:0xffd767,size:10,sizeAttenuation:false,depthTest:false,depthWrite:false}));
   overlay.renderOrder=15;ctx.current.object.add(overlay);ctx.current.overlay=overlay;
  }
  const out=[],s=ctx.current.session,ids=[...ctx.selected];
  for(const i of ids)out.push(s.positions[i*3],s.positions[i*3+1],s.positions[i*3+2]);
  overlay.geometry.dispose();overlay.geometry=new THREE.BufferGeometry();
  overlay.geometry.setAttribute('position',new THREE.Float32BufferAttribute(out,3));
  // Draw the actual picked edge or triangle outline, not only vertex dots.
  if(!ctx.current.lineOverlay){
   const mat=new THREE.LineBasicMaterial({color:0xffd767,depthTest:false,depthWrite:false});
   ctx.current.lineOverlay=new THREE.LineSegments(new THREE.BufferGeometry(),mat);
   ctx.current.lineOverlay.renderOrder=16;ctx.current.object.add(ctx.current.lineOverlay);
  }
  const line=[],v=i=>[s.positions[i*3],s.positions[i*3+1],s.positions[i*3+2]];
  if(ctx.component==='edge'&&ids.length===2)line.push(...v(ids[0]),...v(ids[1]));
  if(ctx.component==='face'&&ids.length===3)
   for(let i=0;i<3;i++)line.push(...v(ids[i]),...v(ids[(i+1)%3]));
  ctx.current.lineOverlay.geometry.dispose();
  ctx.current.lineOverlay.geometry=new THREE.BufferGeometry();
  ctx.current.lineOverlay.geometry.setAttribute('position',new THREE.Float32BufferAttribute(line,3));
 }
 function applyLive(withNormals=true){
  const current=ctx.current;if(!current?.object||!current.session)return;
  const g=current.object.geometry,p=g.getAttribute('position'),n=g.getAttribute('normal'),s=current.session;
  if(!p||p.count!==s.count||!n||n.count!==s.count){setStatus('Просмотр неподдерживаемой структуры геометрии');return;}
  for(let i=0;i<s.count;i++){
   const k=i*3;p.setXYZ(i,s.positions[k],s.positions[k+1],s.positions[k+2]);
   if(withNormals)n.setXYZ(i,s.normals[k],s.normals[k+1],s.normals[k+2]);
  }
  p.needsUpdate=true;if(withNormals)n.needsUpdate=true;
  g.computeBoundingSphere();g.computeBoundingBox();
  updateSelected();
  if(withNormals)updateOverlays();
 }
 function activeChoice(index){
  if(ctx.stroke)finishStroke();
  ctx.selected.clear();ctx.selectedFaceIndex=null;stopOverlay();if(ctx.current?.overlay){
   ctx.current.overlay.parent?.remove(ctx.current.overlay);ctx.current.overlay.geometry.dispose();
   ctx.current.overlay.material.dispose();ctx.current.overlay=null;}
  if(ctx.current?.lineOverlay){ctx.current.lineOverlay.parent?.remove(ctx.current.lineOverlay);
   ctx.current.lineOverlay.geometry.dispose();ctx.current.lineOverlay.material.dispose();ctx.current.lineOverlay=null;}
  ctx.current=null;ctx.currentIndex=index;
  const descriptor=ctx.choices[index];
  if(!descriptor){setStatus('Объект не выбран');updateButtons();return;}
  if(!descriptor.editable){setStatus('Редактирование заблокировано: '+descriptor.reason);updateButtons();return;}
  try {
   let session=ctx.sessions.get(index);if(!session){session=new MeshEditor(ctx.original,index);ctx.sessions.set(index,session);}
   const object=getMeshObject(descriptor);
   if(!object||object.geometry?.getAttribute('position')?.count!==session.count)
    throw Error('Структура сетки Three.js не совпадает с GLB accessor. Экспорт заблокирован.');
   ctx.current={descriptor,session,object,overlay:null,lineOverlay:null};
   setStatus('Реальная геометрия: '+session.count.toLocaleString('ru-RU')+
     ' вершин, '+session.triangleCount.toLocaleString('ru-RU')+' треугольников.');
   if($('meshWire').checked||$('meshNormals').checked)updateOverlays();
  }catch(e){ctx.current=null;setStatus('Mesh Edit недоступен: '+e.message);}
  updateButtons();
 }
 function updateButtons(){
  modeObject.classList.toggle('chosen',ctx.mode==='object');
  modeEdit.classList.toggle('chosen',ctx.mode==='edit');
  meshControls.hidden=ctx.mode!=='edit';
  const enabled=ctx.mode==='edit'&&Boolean(ctx.current);
  ctx.tool=enabled?ctx.tool:'camera';
  selectionControls.hidden=!enabled||ctx.tool!=='select';
  brushControls.hidden=!enabled||ctx.tool!=='sculpt';
  for(const [id,tool] of [['meshNavigate','camera'],['meshPick','select'],['meshSculpt','sculpt']]){
   $(id).classList.toggle('chosen',ctx.tool===tool);$(id).disabled=!enabled;
  }
  for(const c of root.querySelectorAll('[data-select]'))c.classList.toggle('chosen',c.dataset.select===ctx.component);
  for(const c of root.querySelectorAll('[data-brush]'))c.classList.toggle('chosen',c.dataset.brush===ctx.brush);
  api.controls.enabled=ctx.tool==='camera'||ctx.mode==='object';
  $('meshUndo').disabled=!ctx.current?.session?.history?.length;
  $('meshRedo').disabled=!ctx.current?.session?.redoStack?.length;
  $('applyTransform').disabled=!enabled||ctx.selected.size===0;
 }
 function saveLater(delay=2200){
  clearTimeout(ctx.saveTimeout);
  ctx.saveTimeout=setTimeout(async()=>{
   try{
    const bytes=exportGlb(api.getActive()?.draft);
    if(!bytes||!indexedDB)return;
    const db=await openDb();
    await new Promise((resolve,reject)=>{
     const tx=db.transaction('projects','readwrite');
     tx.objectStore('projects').put({bytes:bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),
       name:api.getActive()?.filename||'mark-geometry.glb',saved:Date.now()},'last');
     tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);
    });
    db.close();ctx.dirty=false;$('meshAutosaveStatus').textContent='Автосейв сохранён локально · '+new Date().toLocaleTimeString('ru-RU');
   }catch(e){$('meshAutosaveStatus').textContent='Автосейв недоступен: '+e.message;}
  },delay);
 }
 function openDb(){
  return new Promise((resolve,reject)=>{
   if(!('indexedDB' in window)){reject(Error('IndexedDB не поддерживается.'));return;}
   const req=indexedDB.open('MARK3DStudioMesh',1);
   req.onupgradeneeded=()=>req.result.createObjectStore('projects');
   req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);
  });
 }
 function exportGlb(materialDoc){
  if(!ctx.original)return null;
  if(ctx.stroke)finishStroke();
  let bytes=ctx.original;
  for(const [index,s] of ctx.sessions){
   if(!s.changed)continue;
   const staging=new MeshEditor(bytes,index);
   staging.positions.set(s.positions);staging.refresh();bytes=staging.exportGlb();
  }
  const glb=parseGlb(bytes),doc=structuredClone(glb.json);
  if(materialDoc?.materials)doc.materials=structuredClone(materialDoc.materials);
  return writeGlb(glb,doc);
 }
 function changed(){
  ctx.dirty=true;updateButtons();$('meshAutosaveStatus').textContent='Изменения ещё не сохранены…';saveLater();
 }
 function setMode(mode){
  ctx.mode=mode;if(mode==='edit'&&!ctx.current){ctx.mode='object';api.notify('Для Mesh Edit выберите доступный объект.',true);}
  updateButtons();
 }
 function setTool(tool){
  if(ctx.stroke)finishStroke();
  ctx.tool=tool;updateButtons();
 }
 function transform(override=null){
  if(!ctx.current?.session||!ctx.selected.size)return;
  const value=override===null?Number($('transformValue').value):override;
  if(!Number.isFinite(value)){api.notify('Укажите число для преобразования.',true);return;}
  const s=ctx.current.session;
  try{
   s.transform(ctx.selected,$('transformMode').value,$('transformAxis').value,value,$('meshSymmetry').checked);
   applyLive();changed();
  }catch(e){api.notify(e.message,true);}
 }
 function projectVertex(i){
  const s=ctx.current.session,o=ctx.current.object,m=api.getCamera(),k=i*3;
  return new THREE.Vector3(s.positions[k],s.positions[k+1],s.positions[k+2]).applyMatrix4(o.matrixWorld).project(m);
 }
 function hit(e){
  const canvas=api.renderer.domElement,rect=canvas.getBoundingClientRect();
  pointer.set(((e.clientX-rect.left)/rect.width)*2-1,-((e.clientY-rect.top)/rect.height)*2+1);
  raycaster.setFromCamera(pointer,api.getCamera());
  return ctx.current?.object?raycaster.intersectObject(ctx.current.object,false)[0]:null;
 }
 function chooseAt(e){
  if(!ctx.current?.session)return;
  const h=hit(e);if(!h||!h.face)return;
  const tri=[h.face.a,h.face.b,h.face.c],s=ctx.current.session;
  const [a,b,c]=tri.map(projectVertex);
  const d=(u,v)=>Math.hypot(u.x-v.x,u.y-v.y),p=new THREE.Vector3(pointer.x,pointer.y,0);
  const seg=(u,v)=>{const vx=v.x-u.x,vy=v.y-u.y,w=Math.max(0,Math.min(1,((p.x-u.x)*vx+(p.y-u.y)*vy)/(vx*vx+vy*vy||1)));
   return Math.hypot(p.x-(u.x+vx*w),p.y-(u.y+vy*w));};
  let ids=[];
  if(ctx.component==='face')ids=tri;
  else if(ctx.component==='vertex'){
   const t=tri.map((i,k)=>({i,d:d([a,b,c][k],p)})).sort((u,v)=>u.d-v.d);ids=[t[0].i];
  }else{
   const edges=[[0,1],[1,2],[2,0]].sort((u,v)=>seg([a,b,c][u[0]],[a,b,c][u[1]])-seg([a,b,c][v[0]],[a,b,c][v[1]]));
   ids=[tri[edges[0][0]],tri[edges[0][1]]];
  }
  if(!$('multiSelect').checked)ctx.selected.clear();
  ctx.selectedFaceIndex=Number.isInteger(h.faceIndex)?h.faceIndex:null;
  for(const i of ids)ctx.selected.add(i);
  updateSelected();updateButtons();
 }
 function brushApply(e,first=false){
  if(!ctx.current||!ctx.stroke)return;
  const stroke=ctx.stroke,s=ctx.current.session,center=stroke.local.clone();
  const radius=Number($('brushRadius').value),strength=Number($('brushStrength').value);
  let delta=[0,0,0];
  if(ctx.brush==='grab'){
   raycaster.setFromCamera(pointer,api.getCamera());
   const nextWorld=raycaster.ray.intersectPlane(stroke.plane,new THREE.Vector3());
   if(!nextWorld)return;
   const target=ctx.current.object.worldToLocal(nextWorld.clone());
   delta=[target.x-stroke.last.x,target.y-stroke.last.y,target.z-stroke.last.z];
   stroke.last.copy(target);stroke.local.copy(target);
   if(first)return;
  }else{
   const h=hit(e);if(!h)return;
   stroke.local.copy(ctx.current.object.worldToLocal(h.point.clone()));
  }
  const point=stroke.local.toArray();
  try{
   const touched=s.brush(point,radius,strength,ctx.brush,delta,$('meshSymmetry').checked,$('brushFalloff').value);
   if(touched)applyLive(false);
  }catch(err){api.notify('Скульптинг: '+err.message,true);finishStroke();}
 }
 function startStroke(e){
  if(!ctx.current?.session||e.pointerType==='touch'&&e.isPrimary===false)return;
  const h=hit(e);if(!h)return;
  const local=ctx.current.object.worldToLocal(h.point.clone());
  const direction=api.getCamera().getWorldDirection(new THREE.Vector3());
  const plane=new THREE.Plane().setFromNormalAndCoplanarPoint(direction,h.point);
  ctx.stroke={id:e.pointerId,local:local.clone(),last:local.clone(),plane};
  ctx.current.session.begin();
  api.controls.enabled=false;
  e.preventDefault();api.renderer.domElement.setPointerCapture?.(e.pointerId);
  brushApply(e,true);
 }
 function finishStroke(){
  if(!ctx.stroke)return;
  const s=ctx.current?.session;ctx.stroke=null;
  if(s){if(s.commit()){applyLive();changed();}else updateButtons();}
  api.controls.enabled=ctx.mode==='object'||ctx.tool==='camera';
 }
 function onPointerDown(e){
  if(!ctx.gltf)return;
  if(ctx.mode==='edit'&&ctx.tool==='select'){e.preventDefault();chooseAt(e);}
  else if(ctx.mode==='edit'&&ctx.tool==='sculpt')startStroke(e);
  else if(ctx.mode==='object'&&ctx.choices.length){
   // Object-mode raycasting can select from scene even with camera controls enabled.
   const canvas=api.renderer.domElement,rect=canvas.getBoundingClientRect();
   pointer.set((e.clientX-rect.left)/rect.width*2-1,-(e.clientY-rect.top)/rect.height*2+1);
   raycaster.setFromCamera(pointer,api.getCamera());
   const meshes=[];ctx.gltf.scene.traverse(n=>{if(n.isMesh)meshes.push(n);});
   const h=raycaster.intersectObjects(meshes,false)[0];
   if(h){
    const idx=ctx.choices.findIndex((entry,j)=>{
     const o=getMeshObject(entry);return o===h.object;
    });
    if(idx>=0){obj.value=String(idx);activeChoice(idx);}
   }
  }
 }
 function pointerMove(e){
  if(!ctx.stroke||ctx.stroke.id!==e.pointerId)return;
  const canvas=api.renderer.domElement,rect=canvas.getBoundingClientRect();
  pointer.set((e.clientX-rect.left)/rect.width*2-1,-(e.clientY-rect.top)/rect.height*2+1);
  brushApply(e);
 }
 const canvas=api.renderer.domElement;
 canvas.addEventListener('pointerdown',onPointerDown);
 canvas.addEventListener('pointermove',pointerMove);
 canvas.addEventListener('pointerup',e=>{if(ctx.stroke?.id===e.pointerId)finishStroke();});
 canvas.addEventListener('pointercancel',e=>{if(ctx.stroke?.id===e.pointerId)finishStroke();});
 modeEdit.addEventListener('click',()=>setMode('edit'));
 modeObject.addEventListener('click',()=>setMode('object'));
 obj.addEventListener('change',()=>activeChoice(Number(obj.value)));
 for(const [id,tool] of [['meshNavigate','camera'],['meshPick','select'],['meshSculpt','sculpt']])
  $(id).addEventListener('click',()=>setTool(tool));
 root.querySelectorAll('[data-select]').forEach(b=>b.addEventListener('click',()=>{ctx.component=b.dataset.select;updateButtons();}));
 root.querySelectorAll('[data-brush]').forEach(b=>b.addEventListener('click',()=>{ctx.brush=b.dataset.brush;updateButtons();}));
 $('applyTransform').addEventListener('click',()=>transform());
 $('transformMode').addEventListener('change',()=>{$('transformValue').value=
  $('transformMode').value==='scale'?'1.05':$('transformMode').value==='rotate'?'5':'0.05';});
 const transformStep=sign=>{const amount=Math.abs(Number($('transformValue').value));
  if($('transformMode').value==='scale')transform(Math.max(.01,1+sign*Math.abs(amount-1)));
  else transform(sign*amount);};
 $('transformMinus').addEventListener('click',()=>transformStep(-1));
 $('transformPlus').addEventListener('click',()=>transformStep(1));
 $('meshUndo').addEventListener('click',()=>{const s=ctx.current?.session;if(s?.undo()){applyLive();changed();}});
 $('meshRedo').addEventListener('click',()=>{const s=ctx.current?.session;if(s?.redo()){applyLive();changed();}});
 for(const id of ['brushRadius','brushStrength'])$(id).addEventListener('input',()=>$(id+'Label').textContent=Number($(id).value).toFixed(2));
 $('meshWire').addEventListener('change',updateOverlays);$('meshNormals').addEventListener('change',updateOverlays);
 function cameraView(view){
  const old=api.getCamera(),target=api.controls.target.clone();
  const dir=view==='front'?new THREE.Vector3(0,0,1):view==='side'?new THREE.Vector3(1,0,0):
    view==='top'?new THREE.Vector3(0,1,0):new THREE.Vector3(.8,.36,1);
  const distance=Math.max(2,old.position.distanceTo(target));
  if(view==='perspective'&&old.isOrthographicCamera){
   const w=api.renderer.domElement.clientWidth,h=api.renderer.domElement.clientHeight;
   const p=new THREE.PerspectiveCamera(43,w/Math.max(1,h),.01,10000);api.setCamera(p);
   $('orthographic').classList.remove('chosen');
  }
  const camera=api.getCamera();camera.position.copy(target).addScaledVector(dir.normalize(),distance);
  camera.up.set(0,view==='top'?0:1,view==='top'?-1:0);
  camera.lookAt(target);camera.updateProjectionMatrix();api.controls.update();
 }
 root.querySelectorAll('[data-view]').forEach(b=>b.addEventListener('click',()=>cameraView(b.dataset.view)));
 $('orthographic').addEventListener('click',()=>{
  const current=api.getCamera(),aspect=Math.max(.3,api.renderer.domElement.clientWidth/Math.max(1,api.renderer.domElement.clientHeight));
  let next;
  if(current.isOrthographicCamera){next=new THREE.PerspectiveCamera(43,aspect,.01,10000);}
  else{
   const d=current.position.distanceTo(api.controls.target),half=Math.max(.5,d*Math.tan(Math.PI*43/360));
   next=new THREE.OrthographicCamera(-half*aspect,half*aspect,half,-half,.01,10000);
  }
  next.position.copy(current.position);next.quaternion.copy(current.quaternion);next.up.copy(current.up);
  api.setCamera(next);$('orthographic').classList.toggle('chosen',next.isOrthographicCamera);
 });
 function refSettings(type){
  const defaults={front:[0,0,-1.5],side:[-1.5,0,0],threequarter:[-1,0,-1]};
  const r=ctx.references.get(type);$('referenceOpacity').value=r?.opacity??.45;
  $('referenceLock').checked=r?.locked??true;
  for(const id of ['referenceOpacity','referenceScale','referenceX','referenceY','referenceZ'])$(id).disabled=!!r?.locked;
  $('referenceScale').value=r?.scale??1;
  ['X','Y','Z'].forEach((a,i)=>{$('reference'+a).value=r?.mesh?.position[['x','y','z'][i]]??defaults[type][i];});
  $('referenceOpacityLabel').textContent=Number($('referenceOpacity').value).toFixed(2);
  $('referenceScaleLabel').textContent=Number($('referenceScale').value).toFixed(2);
 }
 function updateRef(){
  const r=ctx.references.get($('referenceType').value);
  if(!r||r.locked)return;
  r.opacity=Number($('referenceOpacity').value);r.scale=Number($('referenceScale').value);
  r.mesh.material.opacity=r.opacity;
  r.mesh.scale.set(r.scale*r.aspect,r.scale,1);
  ['X','Y','Z'].forEach((a,i)=>{const val=Number($('reference'+a).value);
   if(Number.isFinite(val))r.mesh.position[['x','y','z'][i]]=val;});
  refSettings($('referenceType').value);
 }
 $('referenceType').addEventListener('change',()=>refSettings($('referenceType').value));
 $('referenceLock').addEventListener('change',()=>{const r=ctx.references.get($('referenceType').value);if(r){r.locked=$('referenceLock').checked;refSettings($('referenceType').value);}});
 ['referenceOpacity','referenceScale','referenceX','referenceY','referenceZ'].forEach(id=>$(id).addEventListener('input',updateRef));
 function removeRef(type){const r=ctx.references.get(type);if(!r)return;
  api.scene.remove(r.mesh);r.mesh.geometry.dispose();r.mesh.material.dispose();r.texture.dispose();URL.revokeObjectURL(r.url);
  ctx.references.delete(type);
 }
 $('removeReference').addEventListener('click',()=>{removeRef($('referenceType').value);refSettings($('referenceType').value);});
 $('referenceImage').addEventListener('change',()=>{
  const file=$('referenceImage').files?.[0];$('referenceImage').value='';
  if(!file)return;
  if(!/^image\/(png|jpeg|webp)$/.test(file.type)||file.size>15*1024*1024){api.notify('Изображение должно быть PNG/JPEG/WebP до 15 МБ.',true);return;}
  const type=$('referenceType').value;removeRef(type);
  const url=URL.createObjectURL(file),texture=new THREE.TextureLoader().load(url,()=>{
   const r=ctx.references.get(type);if(!r)return;
   r.aspect=(texture.image?.naturalWidth||1)/(texture.image?.naturalHeight||1);updateRef();
  },undefined,()=>api.notify('Не удалось открыть изображение.',true));
  texture.colorSpace=THREE.SRGBColorSpace;
  const material=new THREE.MeshBasicMaterial({map:texture,side:THREE.DoubleSide,transparent:true,opacity:.45,
    depthTest:false,depthWrite:false,toneMapped:false});
  const plane=new THREE.Mesh(new THREE.PlaneGeometry(2,2),material);
  plane.renderOrder=-10;
  plane.rotation.y=type==='side'?Math.PI/2:type==='threequarter'?Math.PI/4:0;
  const defaults={front:[0,0,-1.5],side:[-1.5,0,0],threequarter:[-1,0,-1]};
  plane.position.set(...defaults[type]);api.scene.add(plane);
  ctx.references.set(type,{mesh:plane,texture,url,opacity:.45,scale:1,aspect:1,locked:true});
  refSettings(type);api.notify('Референс загружен: '+file.name);
 });
 $('restoreMesh').addEventListener('click',async()=>{
  try{
   const db=await openDb();const data=await new Promise((resolve,reject)=>{
    const tx=db.transaction('projects','readonly'),q=tx.objectStore('projects').get('last');
    q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error);
   });db.close();
   if(!data?.bytes){api.notify('Сохранённого проекта пока нет.',true);return;}
   await api.openModel(new Uint8Array(data.bytes),data.name||'autosave.glb');
   api.notify('Локальное сохранение восстановлено.');
  }catch(e){api.notify('Не удалось восстановить: '+e.message,true);}
 });
 function clear(){
  clearTimeout(ctx.saveTimeout);if(ctx.stroke)finishStroke();stopOverlay();
  if(!ctx.keepReferences)for(const type of Array.from(ctx.references.keys()))removeRef(type);
  for(const s of ctx.sessions.values())s.pending=null;
  ctx.gltf=null;ctx.original=null;ctx.sessions.clear();ctx.current=null;ctx.currentIndex=-1;
  ctx.choices=[];ctx.selected.clear();ctx.selectedFaceIndex=null;ctx.mode='object';ctx.tool='camera';
  obj.replaceChildren();obj.disabled=true;setStatus('Загрузите GLB.');updateButtons();
 }
 function onModel(bytes,gltf){
  clear();ctx.gltf=gltf;ctx.original=new Uint8Array(bytes);const parsed=parseGlb(bytes);
  ctx.choices=sceneMeshList(parsed.json);
  for(let i=0;i<ctx.choices.length;i++){
   const d=ctx.choices[i],opt=document.createElement('option');
   opt.value=String(i);opt.textContent=d.name+(d.editable?'':' · только просмотр');obj.append(opt);
  }
  obj.disabled=!ctx.choices.length;
  const first=ctx.choices.findIndex(c=>c.editable);
  if(first>=0){obj.value=String(first);activeChoice(first);}
  else setStatus('В этом GLB нет безопасных для Mesh Edit примитивов.');
  ctx.keepReferences=false;updateButtons();
 }
 document.addEventListener('visibilitychange',()=>{if(document.hidden&&ctx.sessions.size)saveLater(0);});
 window.addEventListener('pagehide',()=>{if(ctx.sessions.size)saveLater(0);});
 window.addEventListener('beforeunload',event=>{if(!ctx.dirty)return;event.preventDefault();event.returnValue='';});
 updateButtons();refSettings('front');
 return {onModel,clear,exportGlb,requestAutosave:saveLater,
  getEditor:()=>ctx.current?.session||null,
  getDescriptor:()=>ctx.current?.descriptor||null,
  getSelectedFaceIndex:()=>ctx.component==='face'?ctx.selectedFaceIndex:null,
  getSelectedVertices:()=>[...ctx.selected],
  selectNode:nodeIndex=>{const i=ctx.choices.findIndex(c=>c.nodeIndex===nodeIndex);if(i<0)return false;obj.value=String(i);activeChoice(i);return true;},
  syncLive:()=>{applyLive();changed();},
  preserveReferencesOnce:()=>{ctx.keepReferences=true;},
  hasUnsavedChanges:()=>ctx.dirty,
  markSaved:()=>{ctx.dirty=false;$('meshAutosaveStatus').textContent='GLB экспортирован вручную.';}
 };
}
