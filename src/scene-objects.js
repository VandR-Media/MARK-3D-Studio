/** v0.3 scene graph editing. No generated sphere/cylinder parts. */
import {parseGlb,writeGlb,assertSelfContainedGlb} from './glb.js';
import {readPrimitive,appendViews} from './topology.js';
import {hexToLinearRgb} from './materials.js';

const isVec3=a=>Array.isArray(a)&&a.length===3&&a.every(x=>Number.isFinite(x)&&Math.abs(x)<=1000);
function invalid(msg){throw Error('Объекты: '+msg);}
function children(doc){return doc.nodes||[];}
function validateIndex(doc,index){if(!Number.isInteger(index)||!doc.nodes?.[index]||doc.nodes[index].extras?.markDeleted)invalid('объект не найден');}
function referenced(doc,id){
 const anim=(doc.animations||[]).some(a=>(a.channels||[]).some(c=>c.target?.node===id));
 const bone=(doc.skins||[]).some(s=>(s.joints||[]).includes(id)||s.skeleton===id);
 return anim||bone;
}
function hierarchy(doc){
 const parent=new Map(),roots=new Set();
 for(const scene of doc.scenes||[])for(const r of scene.nodes||[])roots.add(r);
 (doc.nodes||[]).forEach((n,i)=>(n.children||[]).forEach(c=>parent.set(c,i)));
 return {parent,roots};
}
export function getSceneObjects(doc){
 const seen=new Set(),list=[];
 const visit=(i,depth,parent)=>{
  if(seen.has(i)||!doc.nodes?.[i])return;seen.add(i);
  const n=doc.nodes[i];
  if(!n.extras?.markDeleted&&Number.isInteger(n.mesh))
   list.push({index:i,name:n.name||'Объект '+i,mesh:n.mesh,depth,parent,hidden:!!n.extras?.markHidden});
  for(const c of n.children||[])visit(c,depth+1,i);
 };
 for(const scene of doc.scenes||[])for(const i of scene.nodes||[])visit(i,0,null);
 return list;
}
function detach(doc,id){
 for(const scene of doc.scenes||[])if(scene.nodes)scene.nodes=scene.nodes.filter(x=>x!==id);
 for(const n of doc.nodes||[])if(n.children)n.children=n.children.filter(x=>x!==id);
}
function output(parsed,doc){return writeGlb(parsed,doc);}
function quaternion(x,y,z){
 const [a,b,c]=[x,y,z].map(v=>v*Math.PI/360);
 const cx=Math.cos(a),cy=Math.cos(b),cz=Math.cos(c),sx=Math.sin(a),sy=Math.sin(b),sz=Math.sin(c);
 return [sx*cy*cz+cx*sy*sz,cx*sy*cz-sx*cy*sz,cx*cy*sz+sx*sy*cz,cx*cy*cz-sx*sy*sz];
}
export const MATERIAL_PRESETS={
 skin:{name:'Кожа — базовая',hex:'#c7977c',metallic:0,roughness:.8},
 hair:{name:'Волосы — базовый',hex:'#29252b',metallic:0,roughness:.65},
 fabric:{name:'Ткань — базовая',hex:'#222b4e',metallic:0,roughness:.91},
 plastic:{name:'Пластик — базовый',hex:'#353c51',metallic:.08,roughness:.36},
 metal:{name:'Металл — базовый',hex:'#9aa5b8',metallic:.85,roughness:.27}
};
export function editScene(bytes,{operation,nodeIndex=0,primitiveIndex=0,name,offset=[.2,0,0],
 vector,rotation,visible,parentIndex=null,preset='skin'}={}){
 const parsed=parseGlb(bytes);assertSelfContainedGlb(parsed.json);
 const doc=structuredClone(parsed.json);validateIndex(doc,nodeIndex);
 const node=doc.nodes[nodeIndex];let createdNode=null,createdMaterial=null;
 if(operation==='duplicate'){
  if(!isVec3(offset))invalid('вектор смещения должен иметь три координаты');
  const source=readPrimitive(bytes,nodeIndex,primitiveIndex);
  const origin=doc.nodes[nodeIndex];
  if(origin.skin!==undefined||origin.children?.length||origin.matrix)invalid('нельзя дублировать скинированные, составные или матричные объекты');
  const original=doc.meshes[origin.mesh];
  const p=structuredClone(original.primitives[primitiveIndex]);
  const meshIndex=doc.meshes.push({name:(original.name||'Mesh')+' — копия',primitives:[p]})-1;
  const n={name:String(name||((origin.name||'Объект')+' — копия')).slice(0,80),
    mesh:meshIndex,translation:(origin.translation||[0,0,0]).map((v,i)=>v+offset[i])};
  if(origin.rotation)n.rotation=[...origin.rotation];
  if(origin.scale)n.scale=[...origin.scale];
  createdNode=doc.nodes.push(n)-1;
  const sceneId=Number.isInteger(doc.scene)?doc.scene:0;
  if(!doc.scenes?.[sceneId])invalid('нет активной glTF-сцены');
  (doc.scenes[sceneId].nodes??=[]).push(createdNode);
  // It is essential to give the clone independent accessors. Otherwise
  // modifying one node could silently deform the original mesh as well.
  return {bytes:appendViews({...source,doc,primitive:p},source.positions,source.indices,source.uvs),nodeIndex:createdNode};
 }
 if(operation==='rename'){
  const value=String(name||'').trim();if(!value||value.length>80)invalid('укажите название до 80 символов');
  node.name=value;
 }else if(operation==='hide'){
  node.extras={...node.extras,markHidden:visible===undefined?!node.extras?.markHidden:!visible};
 }else if(operation==='transform'){
  if(node.matrix)invalid('объект с матрицей требует предварительной конвертации transform');
  if(vector!==undefined){if(!isVec3(vector))invalid('неверное смещение');node.translation=[...vector];}
  if(rotation!==undefined){if(!isVec3(rotation))invalid('неверный угол');node.rotation=quaternion(...rotation);}
  if(offset!==undefined&&arguments){} // offset reserved for duplication
 }else if(operation==='scale'){
  if(node.matrix)invalid('матрица объекта не поддерживается');
  if(!isVec3(vector)||vector.some(v=>v<=.001||v>50))invalid('масштаб: три положительных числа от 0.001 до 50');
  node.scale=[...vector];
 }else if(operation==='material'){
  const pr=doc.meshes?.[node.mesh]?.primitives?.[primitiveIndex];
  if(!pr)invalid('у объекта отсутствует примитив');
  if(node.skin!==undefined)invalid('материал скинированного объекта меняется только в стандартном PBR-режиме');
  const template=MATERIAL_PRESETS[preset];if(!template)invalid('неизвестный тип материала');
  const m={name:String(name||template.name).slice(0,80),pbrMetallicRoughness:{
   baseColorFactor:[...hexToLinearRgb(template.hex),1],metallicFactor:template.metallic,roughnessFactor:template.roughness}};
  createdMaterial=(doc.materials??=[]).push(m)-1;
  pr.material=createdMaterial;
 }else if(operation==='reparent'){
  if(!Number.isInteger(parentIndex))invalid('выберите новый родительский объект');
  validateIndex(doc,parentIndex);
  if(parentIndex===nodeIndex)invalid('нельзя переместить объект внутрь самого себя');
  if(referenced(doc,nodeIndex)||referenced(doc,parentIndex)||node.skin!==undefined)invalid('иерархия skinned/animated объектов заблокирована');
  let cur=parentIndex,visited=new Set();
  const tree=hierarchy(doc);
  while(cur!==undefined){if(cur===nodeIndex)invalid('операция создаёт циклическую иерархию');
   if(visited.has(cur))invalid('некорректная исходная иерархия');visited.add(cur);cur=tree.parent.get(cur);}
  detach(doc,nodeIndex);
  (doc.nodes[parentIndex].children??=[]).push(nodeIndex);
 }else if(operation==='delete'){
  if(node.skin!==undefined||referenced(doc,nodeIndex)||node.children?.length)invalid('нельзя удалить объект с костями, анимацией или дочерними узлами');
  detach(doc,nodeIndex);
  node.extras={...node.extras,markDeleted:true};
 }else invalid('неизвестная операция');
 return {bytes:output(parsed,doc),nodeIndex,materialIndex:createdMaterial};
}
