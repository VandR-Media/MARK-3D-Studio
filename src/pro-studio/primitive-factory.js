/**
 * MARK P8 native standalone primitive GLB builder. No Blender, Three.js or CDN.
 * Creates an originally EMPTY glTF document, then uses THE SAME mesh editing
 * kernel to add a real textured-coordinate/indexed primitive mesh/node.
 * No pre-existing character/quad is bundled into the newly created scene.
 */
import {writeGlb} from '../glb.js';
import {applyMeshOperations,getMeshEditStats} from './mesh-edit-core.js';
export function createEmptyGlb(){
 const json={
  asset:{version:'2.0',generator:'MARK P8 standalone procedural scene core',
   extras:{source:'native from empty scene',referenceArtApproved:false}},
  scene:0,scenes:[{name:'MARK Scene',nodes:[]}],
  nodes:[],meshes:[],
  buffers:[{byteLength:4}],bufferViews:[],accessors:[],materials:[]
 };
 return writeGlb({chunks:[
  {type:0x4e4f534a,data:new Uint8Array(0)},
  {type:0x004e4942,data:new Uint8Array(4)}
 ]},json);
}
export function createPrimitiveGlb({shape='box',size=1,segments=12}={}){
 const glb=applyMeshOperations(createEmptyGlb(),[{
  kind:'primitive.add',meshIndex:0,primitiveIndex:0,shape,size,segments
 }]);
 return{glb,shape,size,segments,stats:getMeshEditStats(glb,0,0)};
}
