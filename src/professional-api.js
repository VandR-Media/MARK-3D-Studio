/**
 * ChatGPT-facing MARK Geometry Core recipes. All operations are data-only,
 * deterministic and transactional. Undo and rollback work on editable topology.
 */
import {EditableMesh} from './professional-geometry.js';
import {encodeMark3d} from './compact-project.js';
import {makeAnatomicalChildHead} from './anatomical-base.js';
import {configureLandmarks,compareReference,adjustReferencePoint} from './reference-modeling.js';
export const CORE_RECIPE_VERSION='mark-geometry/0.1';
function requireObject(x,label){if(!x||typeof x!=='object'||Array.isArray(x))throw Error(label+' must be an object');}
function requireId(x,label){if(typeof x!=='string'||!/^[a-z0-9_-]{3,60}$/.test(x))throw Error('Invalid '+label);}
export function validateGeometryRecipe(recipe){
 requireObject(recipe,'recipe');
 if(recipe.schema!==CORE_RECIPE_VERSION)throw Error('Unsupported Geometry Core recipe schema');
 requireObject(recipe.project,'project');
 requireId(recipe.project.id,'project.id');
 if(!['contour-head-v1','anatomical-child-head-v1','source-glb','empty'].includes(recipe.project.base))
  throw Error('project.base must be contour-head-v1, anatomical-child-head-v1, source-glb or empty');
 if(!Array.isArray(recipe.commands)||recipe.commands.length<1||recipe.commands.length>150)
  throw Error('Recipe commands must contain 1–150 operations');
 for(const [i,cmd] of recipe.commands.entries()){
  requireObject(cmd,'command '+i);
  if(typeof cmd.operation!=='string')throw Error('Missing operation at '+i);
  if(cmd.parameters!==undefined)requireObject(cmd.parameters,'parameters of '+i);
 }
 return true;
}
function execute(mesh,cmd){
 const p=cmd.parameters||{};
 switch(cmd.operation){
  case 'mesh.select':{
   if(Array.isArray(p.ids))return {selected:mesh.select(p.ids)};
   if(p.box)return {selected:mesh.selectBox(p.box.min,p.box.max)};
   if(p.point)return {selected:mesh.selectRadius(p.point,p.radius)};
   throw Error('mesh.select needs ids, box or point/radius');
  }
  case 'mesh.edit':
  case 'mesh.move':return mesh.moveSelected(p.delta,{weight:p.weight??1});
  case 'mesh.selectLoop':
  case 'mesh.selectRegion':{
   const region=p.region;
   if(typeof region!=='string'||!mesh.regions?.[region])throw Error('Unknown topology region '+region);
   return {selected:mesh.select(mesh.regions[region]),region};
  }
  case 'sculpt.contour':{
   if(!mesh.regions?.[p.region])throw Error('Unknown editable contour '+p.region);
   mesh.select(mesh.regions[p.region]);
   return {...mesh.moveSelected(p.delta,{weight:p.weight??1}),region:p.region};
  }
  case 'reference.landmarks':return configureLandmarks(mesh,p);
  case 'reference.compare':return compareReference(mesh,p.view);
  case 'face.adjustToReference':return adjustReferencePoint(mesh,p);
  case 'face.adjustLandmarks':{
   if(!mesh.landmarks?.[p.name])throw Error('Unknown anatomy landmark '+p.name);
   const vertexId=mesh.landmarks[p.name].vertex,vertex=mesh.vertices.get(vertexId);
   if(!vertex)throw Error('Landmark vertex ID no longer exists; remap after topology change');
   return {...mesh.brush({center:vertex.position,radius:p.radius??.12,strength:p.strength??.5,
    mode:'grab',delta:p.delta,symmetry:p.symmetry??false,mask:p.mask??null}),landmark:p.name};
  }
  case 'mesh.subdivide':return mesh.faceSubdivide(p.faceId);
  case 'mesh.extrude':return mesh.faceExtrude(p.faceId,p.distance);
  case 'sculpt.brush':return mesh.brush(p);
  case 'sculpt.mask':return {masked:mesh.setMask(p.name,p.ids||[...mesh.selection],p.weight??1)};
  case 'mesh.inspect':return mesh.inspect();
  case 'project.undo':return {undone:mesh.undo()};
  case 'project.redo':return {redone:mesh.redo()};
  case 'project.checkpoint':return {checkpoint:String(cmd.target||'checkpoint')};
  case 'project.export':return {triangles:mesh.inspect().triangles};
  default:throw Error('Unsupported professional command: '+cmd.operation+' (never silently ignored)');
 }
}
export function runGeometryRecipe(recipe,{sourceBytes=null,compact=false}={}){
 validateGeometryRecipe(recipe);
 let mesh;
 if(recipe.project.base==='source-glb'){
  if(!sourceBytes)throw Error('source-glb requires explicit sourceBytes');
  mesh=EditableMesh.fromGlb(sourceBytes);
 }else if(recipe.project.base==='contour-head-v1')mesh=EditableMesh.candidate();
 else if(recipe.project.base==='anatomical-child-head-v1')mesh=makeAnatomicalChildHead();
 const events=[],checkpoints=new Map(),warnings=[];
 for(const [i,cmd] of recipe.commands.entries()){
  let before=null;
  try{
   if(cmd.operation==='character.createBaseMesh'){
    if(mesh)throw Error('character.createBaseMesh cannot replace a loaded mesh');
    const p=cmd.parameters||{};
    if(p.type!=='stylized-child-head')throw Error('Only stylized-child-head is implemented');
    mesh=makeAnatomicalChildHead({rings:p.rings??106,columns:p.columns??192});
    events.push({step:i,operation:cmd.operation,status:'ok',vertices:mesh.vertices.size,
     loops:Object.keys(mesh.regions)});
    continue;
   }
   if(cmd.operation==='mesh.create'){
    if(mesh)throw Error('mesh.create cannot silently replace an existing project');
    const p=cmd.parameters||{};
    mesh=EditableMesh.fromGeometry(p.geometry,{name:p.name||'New polygonal mesh',material:p.material});
    events.push({step:i,operation:cmd.operation,status:'ok',vertices:mesh.vertices.size});
    continue;
   }
   if(!mesh)throw Error('No editable geometry: begin with mesh.create');
   // Core operations validate & roll back atomically. Compact mode deliberately
   // avoids transient O(vertices) backups for EACH brush/selection action.
   if(!compact)before=mesh._state();
   const result=execute(mesh,cmd);
   if(!compact)mesh.validate({strict:true});
   if(cmd.operation==='project.checkpoint'){
    const name=String(cmd.target||'stage-'+i);
    requireId(name,'checkpoint name');
    checkpoints.set(name,{glb:mesh.toGlb(),project:compact?
     encodeMark3d(mesh,{includeUndo:true}):mesh.toProject({includeUndo:true})});
   }
   events.push({step:i,operation:cmd.operation,status:'ok',result});
  }catch(error){
   if(mesh&&before)mesh._restore(before);
   const message='Step '+i+' '+cmd.operation+': '+error.message;
   events.push({step:i,operation:cmd.operation,status:'error',message});
   if(cmd.onError==='skip'){warnings.push(message);continue;}
   const e=new Error(message);e.events=events;throw e;
  }
 }
 if(!mesh)throw Error('Recipe did not create a polygonal mesh');
 const inspection=mesh.inspect(),glb=mesh.toGlb();
 return {mesh,glb,project:compact?encodeMark3d(mesh,{includeUndo:true}):
  mesh.toProject({includeUndo:true}),inspection,events,warnings,checkpoints};
}
