import * as THREE from 'three';
import {topologyEdit,inspectMesh} from './topology.js';
import {editScene,getSceneObjects,MATERIAL_PRESETS} from './scene-objects.js';
import {deformFace,FACE_PARAMETERS} from './face-studio.js';
import {parseGlb} from './glb.js';

export function initCharacterUi(api,meshUi){
 const root=document.getElementById('characterStudio');
 if(!root)return {onModel(){}};
 root.innerHTML=[
 '<details open class="character-panel"><summary>Character Studio <small>v0.3 DEV</small></summary>',
 '<div class="character-inner"><p class="mesh-note">Реальное редактирование GLB. Тестовая голова — не MARK Cosmic.</p>',
 '<label class="field-label" for="charObject">Объект сцены</label><select id="charObject"></select>',
 '<p class="mesh-note" id="charStatus" role="status">Загрузите модель.</p>',
 '<div class="mesh-buttons"><button class="mesh-btn" id="charUndo">↶ Топология</button><button class="mesh-btn" id="charRedo">↷ Повтор</button></div>',
 '<details open class="character-sub"><summary>Топология</summary>',
 '<p class="mesh-note">Mesh Edit → Выделить → Полигон → коснуться поверхности, затем выбрать операцию.</p>',
 '<div class="mesh-grid3">',
 '<label>Extrude<input id="topoAmount" type="number" min="-2" max="2" step=".025" value=".13"></label>',
 '<label>Inset<input id="topoRatio" type="number" min=".03" max=".85" step=".05" value=".3"></label>',
 '<label>Weld<input id="topoThreshold" type="number" min=".001" max=".1" step=".001" value=".003"></label></div>',
 '<div class="mesh-buttons wrap">',
 '<button class="mesh-btn" data-topology="extrude">Extrude</button>',
 '<button class="mesh-btn" data-topology="inset">Inset</button>',
 '<button class="mesh-btn" data-topology="subdivide">Subdivide</button>',
 '<button class="mesh-btn" data-topology="normals">Нормали</button>',
 '<button class="mesh-btn" data-topology="weld">Weld</button>',
 '<button class="mesh-btn" data-topology="merge">Merge</button>',
 '<button class="mesh-btn" data-topology="loopcut">Loop Cut</button>',
 '<button class="mesh-btn" data-topology="delete">Удалить грань</button></div>',
 '<p class="mesh-note">Loop Cut и удаление открытых граней блокируются до безопасной реализации.</p></details>',
 '<details open class="character-sub"><summary>Face Studio</summary>',
 '<p class="mesh-note">Модель должна быть направлена лицом по +Z, вверх +Y. Параметры не воссоздают Марка автоматически.</p>',
 '<label class="field-label" for="faceParam">Область лица</label><select id="faceParam"></select>',
 '<label class="mesh-slider">Шаг деформации <output id="faceAmountValue">+0.25</output>',
 '<input id="faceAmount" type="range" min="-1" max="1" step=".05" value=".25"></label>',
 '<button class="mesh-btn primary full-width" id="faceApply">Применить к форме лица</button></details>',
 '<details class="character-sub"><summary>Объекты и материалы</summary>',
 '<div class="mesh-buttons"><button class="mesh-btn" id="charDuplicate">Дублировать сетку</button>',
 '<button class="mesh-btn" id="charHide">Скрыть / показать</button></div>',
 '<label class="field-label" for="charName">Имя</label><input class="character-input" id="charName" value="Деталь персонажа" maxlength="80">',
 '<div class="mesh-buttons"><button class="mesh-btn" id="charRename">Переименовать</button>',
 '<button class="mesh-btn" id="charDelete">Удалить объект</button></div>',
 '<label class="field-label" for="charTransform">Трансформация</label>',
 '<select id="charTransform"><option value="translation">Положение</option><option value="rotation">Поворот °</option><option value="scale">Масштаб</option></select>',
 '<div class="mesh-grid3">',
 '<label>X<input id="charX" type="number" value=".3" step=".05"></label>',
 '<label>Y<input id="charY" type="number" value="0" step=".05"></label>',
 '<label>Z<input id="charZ" type="number" value="0" step=".05"></label></div>',
 '<button class="mesh-btn full-width" id="charApplyTransform">Применить к объекту</button>',
 '<label class="field-label" for="charParent">Родитель</label><select id="charParent"></select>',
 '<button class="mesh-btn full-width" id="charReparent">Изменить иерархию</button>',
 '<label class="field-label" for="charPreset">Новый базовый PBR-материал</label>',
 '<select id="charPreset"></select><button class="mesh-btn full-width" id="charAssignMaterial">Назначить PBR</button></details>',
 '<details class="character-sub"><summary>Проверка поверхности</summary>',
 '<button class="mesh-btn full-width" id="charDiagnose">Проверить сетку</button>',
 '<label class="mesh-check"><input id="charNoTexture" type="checkbox"> Без текстур</label>',
 '<output id="charAudit" class="mesh-note">Диагностика не запускалась.</output></details>',
 '</div></details>'
 ].join('');
 const $=id=>document.getElementById(id);
 for(const [id,label] of FACE_PARAMETERS){const o=document.createElement('option');o.value=id;o.textContent=label;$('faceParam').append(o);}
 for(const [id,m] of Object.entries(MATERIAL_PRESETS)){const o=document.createElement('option');o.value=id;o.textContent=m.name;$('charPreset').append(o);}
 const ctx={history:[],future:[],internal:false,busy:false,objects:[],currentNode:0,materials:new Map()};
 function status(message,error=false){
  $('charStatus').textContent=message;$('charStatus').style.color=error?'#ffabab':'#b8dcf2';api.notify(message,error);
 }
 const selected=()=>{const n=Number($('charObject').value);return Number.isInteger(n)?n:null;};
 function source(){
  const active=api.getActive();if(!active)throw Error('Сначала откройте модель.');
  const bytes=meshUi.exportGlb(active.draft);
  if(!bytes)throw Error('Не удалось сохранить текущие правки');
  parseGlb(bytes);return bytes;
 }
 function drawObjects(bytes){
  const doc=parseGlb(bytes).json;ctx.objects=getSceneObjects(doc);
  const select=$('charObject'),parent=$('charParent'),prior=Number(select.value);
  select.replaceChildren();parent.replaceChildren();
  const nil=document.createElement('option');nil.value='';nil.textContent='Выбери родителя';parent.append(nil);
  for(const item of ctx.objects){
   const option=document.createElement('option');option.value=String(item.index);
   option.textContent='· '.repeat(item.depth)+item.name+(item.hidden?' (скрыт)':'');
   select.append(option);parent.append(option.cloneNode(true));
  }
  select.disabled=!ctx.objects.length;
  const target=ctx.objects.find(o=>o.index===ctx.currentNode)?.index??
    ctx.objects.find(o=>o.index===prior)?.index??ctx.objects[0]?.index;
  if(target!==undefined){select.value=String(target);meshUi.selectNode(target);}
  ctx.currentNode=target??0;
  $('charUndo').disabled=!ctx.history.length;$('charRedo').disabled=!ctx.future.length;
  // Restore hidden flag on scene, without baking visibility into geometry.
  for(const record of ctx.objects.filter(x=>x.hidden)){
   const gltf=api.getActive()?.gltf;
   gltf?.scene.traverse(obj=>{
    if(!obj.isMesh)return;
    const assoc=gltf.parser.associations.get(obj)||{};
    const holder=gltf.parser.associations.get(obj.parent)||{};
    if(assoc.nodes===record.index||holder.nodes===record.index)obj.visible=false;
   });
  }
 }
 async function load(bytes){
  meshUi.preserveReferencesOnce();
  await api.openModel(bytes,'mark-character-v03.glb');
  meshUi.requestAutosave(0);
 }
 async function transaction(transform,description,targetNode=null){
  if(ctx.busy)return;ctx.busy=true;
  try{
   const before=source(),result=transform(before),bytes=result?.bytes??result;
   if(!(bytes instanceof Uint8Array))throw Error('Операция не вернула бинарный GLB');
   const check=parseGlb(bytes).json;if(!check.nodes||!check.meshes)throw Error('Неполный экспорт GLB');
   ctx.history.push(before);if(ctx.history.length>8)ctx.history.shift();
   ctx.future.length=0;ctx.internal=true;
   ctx.currentNode=targetNode??result?.nodeIndex??selected()??0;
   await load(bytes);
   status(description+' — сохранено в GLB');
  }catch(e){status(e.message,true);}
  finally{ctx.internal=false;ctx.busy=false;}
 }
 async function restore(mode){
  const from=mode==='undo'?ctx.history:ctx.future,to=mode==='undo'?ctx.future:ctx.history;
  if(ctx.busy||!from.length)return;
  ctx.busy=true;
  try{
   const now=source(),bytes=from.pop();to.push(now);ctx.internal=true;
   await load(bytes);status('Версия геометрии восстановлена.');
  }catch(e){status(e.message,true);}
  finally{ctx.internal=false;ctx.busy=false;}
 }
 $('charUndo').addEventListener('click',()=>restore('undo'));
 $('charRedo').addEventListener('click',()=>restore('redo'));
 $('charObject').addEventListener('change',()=>{
  const id=selected();if(id!==null){ctx.currentNode=id;meshUi.selectNode(id);}
 });
 root.querySelectorAll('[data-topology]').forEach(button=>button.addEventListener('click',()=>{
  const operation=button.dataset.topology,desc=meshUi.getDescriptor();
  if(!desc){status('Выберите доступный объект в Mesh Edit',true);return;}
  const face=meshUi.getSelectedFaceIndex();
  if(!['normals','weld','merge'].includes(operation)&&face===null){
   status('Сначала выделите полигон: Mesh Edit → Выделить → Полигон.',true);return;}
  transaction(bytes=>topologyEdit(bytes,{nodeIndex:desc.nodeIndex,primitiveIndex:desc.primitiveIndex,
   operation,faceIndex:face??0,vertices:meshUi.getSelectedVertices(),
   amount:Number($('topoAmount').value),ratio:Number($('topoRatio').value),
   threshold:Number($('topoThreshold').value)}),operation+' выполнен');
 }));
 $('faceAmount').addEventListener('input',()=>{
  const n=Number($('faceAmount').value);$('faceAmountValue').textContent=(n>=0?'+':'')+n.toFixed(2);
 });
 $('faceApply').addEventListener('click',()=>{
  const e=meshUi.getEditor();if(!e){status('Сначала выбери сетку головы.',true);return;}
  try{
   if(deformFace(e,$('faceParam').value,Number($('faceAmount').value))){
    meshUi.syncLive();status('Вершины лица изменены. Можно отменить через Mesh Edit.');
   }else status('Нет изменений.');
  }catch(err){status(err.message,true);}
 });
 $('charDuplicate').addEventListener('click',()=>{
  const d=meshUi.getDescriptor();if(!d){status('Выберите объект для копирования.',true);return;}
  transaction(bytes=>editScene(bytes,{operation:'duplicate',nodeIndex:d.nodeIndex,
   primitiveIndex:d.primitiveIndex,name:$('charName').value||'Деталь персонажа',offset:[1.8,0,0]}),'Создан независимый объект');
 });
 $('charHide').addEventListener('click',()=>transaction(bytes=>editScene(bytes,{operation:'hide',nodeIndex:selected()}),'Видимость обновлена'));
 $('charRename').addEventListener('click',()=>transaction(bytes=>editScene(bytes,{operation:'rename',nodeIndex:selected(),name:$('charName').value}),'Название сохранено'));
 $('charDelete').addEventListener('click',()=>{
  if(!window.confirm('Удалить объект из сцены? Можно отменить через историю топологии.'))return;
  transaction(bytes=>editScene(bytes,{operation:'delete',nodeIndex:selected()}),'Объект удалён',0);
 });
 $('charApplyTransform').addEventListener('click',()=>{
  const vector=['charX','charY','charZ'].map(id=>Number($(id).value)),which=$('charTransform').value;
  const operation=which==='scale'?'scale':'transform';
  const opts=which==='rotation'?{rotation:vector}:{vector};
  transaction(bytes=>editScene(bytes,{operation,nodeIndex:selected(),...opts}),'Трансформация сохранена');
 });
 $('charTransform').addEventListener('change',()=>{
  ['charX','charY','charZ'].forEach((id,i)=>$(id).value=$('charTransform').value==='scale'?'1':i===0?'.3':'0');
 });
 $('charReparent').addEventListener('click',()=>{
  if($('charParent').value===''){status('Выберите родительский объект.',true);return;}
  transaction(bytes=>editScene(bytes,{operation:'reparent',nodeIndex:selected(),parentIndex:Number($('charParent').value)}),'Иерархия сохранена');
 });
 $('charAssignMaterial').addEventListener('click',()=>transaction(bytes=>editScene(bytes,{operation:'material',nodeIndex:selected(),preset:$('charPreset').value}),'PBR-материал добавлен'));
 $('charDiagnose').addEventListener('click',()=>{
  const e=meshUi.getEditor();if(!e){status('Выберите доступную сетку.',true);return;}
  const a=inspectMesh(e.positions,e.indices);
  $('charAudit').textContent='Вершин '+a.vertices+' · треугольников '+a.triangles+
  ' · вырожденных '+a.invalidTriangles+' · открытых рёбер '+a.boundaryEdges+
  ' · неманифолдных '+a.nonManifoldEdges+' · узких '+a.skinnyTriangles;
  status(a.invalidTriangles||a.nonManifoldEdges?'Есть проблемы сетки.':'Сетка проверена.',a.invalidTriangles>0||a.nonManifoldEdges>0);
 });
 $('charNoTexture').addEventListener('change',()=>{
  const gltf=api.getActive()?.gltf;if(!gltf)return;
  gltf.scene.traverse(o=>{
   if(!o.isMesh)return;
   if($('charNoTexture').checked){
    ctx.materials.set(o,o.material);
    o.material=new THREE.MeshStandardMaterial({color:0xb3b4bd,metalness:0,roughness:.82});
   }else if(ctx.materials.has(o)){
    o.material.dispose();o.material=ctx.materials.get(o);ctx.materials.delete(o);
   }
  });
 });
 function onModel(bytes){
  if(!ctx.internal){ctx.history=[];ctx.future=[];ctx.currentNode=0;}
  ctx.materials.clear();$('charNoTexture').checked=false;
  drawObjects(bytes);
 }
 return {onModel};
}
