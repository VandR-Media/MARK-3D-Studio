/**
 * MARK Professional touch UI shares native EditableMesh with the JSON API.
 * Covers binary .mark3d import/export, anatomical geometry, named contours,
 * brush editing, GLB preview/export, undo/redo and IndexedDB recovery.
 */
import {makeAnatomicalChildHead} from './anatomical-base.js';
import {encodeMark3d,decodeMark3d} from './compact-project.js';
const byId=id=>document.getElementById(id);
export function initProfessionalUi({openModel,notify}){
 const root=byId('professionalUi');if(!root)return null;
 root.innerHTML=[
 '<details class="pro-details"><summary>Professional Core · редактируемая сетка</summary>',
 '<p class="fine-print">Тот же Half-Edge Core, что в программном JSON API. Все данные локальны.</p>',
 '<div class="pro-buttons"><button id="proNew" class="button primary">Создать анатомическую голову</button>',
 '<label for="proOpen" class="button secondary">Открыть .mark3d</label><input id="proOpen" type="file" accept=".mark3d" hidden>',
 '<button id="proRecover" class="button secondary">Восстановить</button></div>',
 '<div class="pro-buttons"><button id="proSave" class="button secondary">Сохранить .mark3d</button>',
 '<button id="proExport" class="button secondary">Экспорт GLB</button></div>',
 '<label class="field-label" for="proRegion">Контур / область</label><select id="proRegion"></select>',
 '<div class="pro-buttons"><button id="proSelect" class="button secondary">Выделить контур</button>',
 '<button id="proUndo" class="button ghost">↶ Undo</button><button id="proRedo" class="button ghost">↷ Redo</button></div>',
 '<label class="field-label" for="proBrushMode">Кисть</label>',
 '<select id="proBrushMode"><option value="grab">Grab</option><option value="smooth">Smooth</option>',
 '<option value="relax">Relax</option><option value="inflate">Inflate</option><option value="clay">Clay</option>',
 '<option value="pinch">Pinch</option><option value="flatten">Flatten</option><option value="crease">Crease</option></select>',
 '<label class="field-label" for="proRadius">Радиус кисти</label>',
 '<input id="proRadius" type="range" min=".03" max=".45" step=".01" value=".13">',
 '<label class="field-label" for="proStrength">Сила</label>',
 '<input id="proStrength" type="range" min="0" max="1" step=".01" value=".4">',
 '<div class="pro-xyz">',
 '<label>∆X<input id="proDx" type="number" step=".005" value="0"></label>',
 '<label>∆Y<input id="proDy" type="number" step=".005" value="0"></label>',
 '<label>∆Z<input id="proDz" type="number" step=".005" value=".015"></label></div>',
 '<label class="pro-toggle"><input id="proSym" type="checkbox" checked> Симметрия по X</label>',
 '<div class="pro-buttons"><button id="proSculpt" class="button primary">Применить кисть</button>',
 '<button id="proMove" class="button secondary">Сдвинуть контур</button></div>',
 '<p id="proInfo" class="fine-print" role="status">Проект не открыт.</p></details>'
 ].join('');
 let mesh=null,dirty=false,saveTimer=0;
 const actionable=['proSave','proExport','proSelect','proUndo','proRedo','proSculpt','proMove'];
 const labels={eye_left_rim:'Левая глазница',eye_right_rim:'Правая глазница',
  mouth_rim:'Рот и губы',nostril_left_rim:'Левая ноздря',nostril_right_rim:'Правая ноздря'};
 const message=t=>byId('proInfo').textContent=t;
 function refresh(){
  const regions=Object.keys(mesh?.regions||{});
  for(const id of actionable)byId(id).disabled=!mesh;
  if(mesh){
   byId('proUndo').disabled=!mesh.history.length;
   byId('proRedo').disabled=!mesh.future.length;
  }
  byId('proSelect').disabled=byId('proMove').disabled=!regions.length;
  const select=byId('proRegion'),current=select.value;select.replaceChildren();
  for(const key of regions){
   const o=document.createElement('option');o.value=key;o.textContent=labels[key]||key;select.append(o);
  }
  if(regions.includes(current))select.value=current;
  select.disabled=!regions.length;
  message(mesh?(dirty?'Изменения ещё не сохранены. ':'Проект сохранён. ')+
   mesh.inspect().triangles.toLocaleString('ru-RU')+' треугольников':'Проект не открыт.');
 }
 function download(data,name,type='application/octet-stream'){
  const url=URL.createObjectURL(new Blob([data],{type})),a=document.createElement('a');
  a.href=url;a.download=name;document.body.append(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),60000);
 }
 async function show(){await openModel(mesh.toGlb(),'native-anatomical-model.glb');}
 const openDatabase=()=>new Promise((ok,fail)=>{
  if(!('indexedDB' in window))return fail(Error('IndexedDB не поддерживается'));
  const req=indexedDB.open('MARK-Professional-Core',1);
  req.onupgradeneeded=()=>req.result.createObjectStore('projects');
  req.onsuccess=()=>ok(req.result);req.onerror=()=>fail(req.error);
 });
 async function persist(){
  if(!mesh)return;
  try{
   const bytes=encodeMark3d(mesh),db=await openDatabase();
   await new Promise((ok,fail)=>{
    const tx=db.transaction('projects','readwrite');
    tx.objectStore('projects').put(bytes,'recent');
    tx.oncomplete=()=>ok();tx.onerror=()=>fail(tx.error);
   });db.close();
   message('Резервная копия IndexedDB · '+(bytes.length/1048576).toFixed(2)+' МиБ');
  }catch(e){message('Автосохранение недоступно: '+e.message+'. Сохраните проект вручную.');}
 }
 function changed(){
  dirty=true;refresh();clearTimeout(saveTimer);
  saveTimer=setTimeout(()=>{void persist();},1200);
 }
 const run=async fn=>{
  if(!mesh)return;
  try{fn();await show();changed();}
  catch(e){notify('Professional Core: '+e.message,true);refresh();}
 };
 const offset=()=>{
  const out=['proDx','proDy','proDz'].map(id=>Number(byId(id).value));
  if(out.some(v=>!Number.isFinite(v)||Math.abs(v)>.12))throw Error('∆XYZ допускает −0.12…+0.12');
  return out;
 };
 const selectedRegion=()=>mesh?.regions?.[byId('proRegion').value]||[];
 const center=()=>{
  const ids=selectedRegion().length?selectedRegion():[...mesh.selection];
  if(!ids.length)throw Error('Нет выделенного контура');
  return [0,1,2].map(i=>ids.reduce((sum,id)=>sum+mesh.vertices.get(id).position[i],0)/ids.length);
 };
 byId('proNew').addEventListener('click',async()=>{
  byId('proNew').disabled=true;message('Создаётся редактируемая анатомическая сетка...');
  await new Promise(r=>setTimeout(r,16));
  try{mesh=makeAnatomicalChildHead();await show();changed();}
  catch(e){notify('Создание головы: '+e.message,true);}
  finally{byId('proNew').disabled=false;refresh();}
 });
 byId('proOpen').addEventListener('change',async e=>{
  const file=e.target.files?.[0];e.target.value='';if(!file)return;
  try{
   const data=new Uint8Array(await file.arrayBuffer()),loaded=decodeMark3d(data);
   mesh=loaded.mesh;await show();dirty=loaded.migrated;refresh();
   if(loaded.migrated)message('JSON 0.1 импортирован, сохраните бинарный .mark3d.');
  }catch(err){notify('Ошибка .mark3d: '+err.message,true);}
 });
 byId('proRecover').addEventListener('click',async()=>{
  try{
   const db=await openDatabase();
   const value=await new Promise((ok,fail)=>{
    const req=db.transaction('projects').objectStore('projects').get('recent');
    req.onsuccess=()=>ok(req.result);req.onerror=()=>fail(req.error);
   });db.close();
   if(!value)throw Error('Резервная копия отсутствует');
   mesh=decodeMark3d(value).mesh;await show();dirty=true;refresh();
   message('Последняя локальная работа восстановлена.');
  }catch(e){notify('Восстановление: '+e.message,true);}
 });
 byId('proSave').addEventListener('click',()=>{
  try{download(encodeMark3d(mesh),'MARK-Studio-Professional.mark3d');dirty=false;refresh();}
  catch(e){notify('Сохранение: '+e.message,true);}
 });
 byId('proExport').addEventListener('click',()=>{
  try{download(mesh.toGlb(),'MARK-Professional-Edited.glb','model/gltf-binary');}
  catch(e){notify('Экспорт: '+e.message,true);}
 });
 byId('proSelect').addEventListener('click',()=>{
  try{mesh.select(selectedRegion());refresh();message('Контур выбран: '+mesh.selection.size+' вершин.');}
  catch(e){notify(e.message,true);}
 });
 byId('proUndo').addEventListener('click',()=>void run(()=>mesh.undo()));
 byId('proRedo').addEventListener('click',()=>void run(()=>mesh.redo()));
 byId('proSculpt').addEventListener('click',()=>void run(()=>mesh.brush({
  center:center(),mode:byId('proBrushMode').value,delta:offset(),
  radius:Number(byId('proRadius').value),strength:Number(byId('proStrength').value),
  symmetry:byId('proSym').checked
 })));
 byId('proMove').addEventListener('click',()=>void run(()=>{
  mesh.select(selectedRegion());mesh.moveSelected(offset(),{weight:Number(byId('proStrength').value)});
 }));
 window.addEventListener('beforeunload',e=>{if(dirty){e.preventDefault();e.returnValue='';}});
 refresh();
 return {hasProject:()=>Boolean(mesh),exportGlb:()=>mesh?.toGlb(),
  clear:()=>{mesh=null;dirty=false;refresh();},
  getMesh:()=>mesh};
}
