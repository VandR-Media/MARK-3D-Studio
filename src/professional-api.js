/**
 * ChatGPT-facing MARK Geometry Core recipes. All operations are data-only,
 * deterministic and transactional. Undo and rollback work on editable topology.
 */
import {EditableMesh} from './professional-geometry.js';
export const CORE_RECIPE_VERSION='mark-geometry/0.1';
function requireObject(x,label){if(!x||typeof x!=='object'||Array.isArray(x))throw Error(label+' must be an object');}
function requireId(x,label){if(typeof x!=='string'||!/^[a-z0-9_-]{3,60}$/.test(x))throw Error('Invalid '+label);}
export function validateGeometryRecipe(recipe){
 requireObject(recipe,'recipe');
 if(recipe.schema!==CORE_RECIPE_VERSION)throw Error('Unsupported Geometry Core recipe schema');
 requireObject(recipe.project,'project');
 requireId(recipe.project.id,'project.id');
 if(!['contour-head-v1','source-glb','empty'].includes(recipe.project.base))
  throw Error('project.base must be contour-head-v1, source-glb or empty');
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
  case 'mesh.edit':return mesh.moveSelected(p.delta,{weight:p.weight??1});
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
export function runGeometryRecipe(recipe,{sourceBytes=null}={}){
 validateGeometryRecipe(recipe);
 let mesh;
 if(recipe.project.base==='source-glb'){
  if(!sourceBytes)throw Error('source-glb requires explicit sourceBytes');
  mesh=EditableMesh.fromGlb(sourceBytes);
 }else if(recipe.project.base==='contour-head-v1')mesh=EditableMesh.candidate();
 const events=[],checkpoints=new Map(),warnings=[];
 for(const [i,cmd] of recipe.commands.entries()){
  let before=null;
  try{
   if(cmd.operation==='mesh.create'){
    if(mesh)throw Error('mesh.create cannot silently replace an existing project');
    const p=cmd.parameters||{};
    mesh=EditableMesh.fromGeometry(p.geometry,{name:p.name||'New polygonal mesh',material:p.material});
    events.push({step:i,operation:cmd.operation,status:'ok',vertices:mesh.vertices.size});
    continue;
   }
   if(!mesh)throw Error('No editable geometry: begin with mesh.create');
   // Full transaction rollback even for selection/masks/undo and non-mutating commands.
   before=mesh._state();
   const result=execute(mesh,cmd);
   mesh.validate({strict:true});
   if(cmd.operation==='project.checkpoint'){
    const name=String(cmd.target||'stage-'+i);
    requireId(name,'checkpoint name');
    checkpoints.set(name,{glb:mesh.toGlb(),project:mesh.toProject({includeUndo:true})});
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
 return {mesh,glb,project:mesh.toProject({includeUndo:true}),inspection,events,warnings,checkpoints};
}
