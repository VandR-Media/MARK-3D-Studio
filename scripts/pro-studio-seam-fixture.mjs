/**
 * MARK Pass 15 fixture: two indexed triangles whose geometric edge is
 * coincident but whose glTF attribute-vertex rows and TEXCOORD_0 differ.
 * No Blender, network or screenshot generation is involved.
 */
import {writeGlb} from '../src/glb.js';
export const seamPositions=[
 [-1,-1,0],[1,-1,0],[-1,1,0],[1,1,0],[1,-1,0],[-1,1,0]
];
export const seamIndices=[0,1,2,4,3,5];
export const seamUv=[
 [0,0],[1,0],[0,1],[1,1],[.61,.1],[.12,.77]
];
export const seamNormals=seamPositions.map(()=>[0,0,1]);
export function createSplitSeamFixture(){
 const chunks=[],bufferViews=[],accessors=[];
 let byteLength=0;
 const add=(rows,type,componentType,target)=>{
  const components=type==='SCALAR'?1:type==='VEC2'?2:3;
  const flat=rows.flat(),width=componentType===5123?2:4;
  const data=new Uint8Array(flat.length*width),view=new DataView(data.buffer);
  flat.forEach((v,i)=>componentType===5123?
   view.setUint16(i*width,v,true):view.setFloat32(i*width,v,true));
  const byteOffset=byteLength;
  bufferViews.push({buffer:0,byteOffset,byteLength:data.length,target});
  chunks.push(data);byteLength+=data.length;
  accessors.push({bufferView:bufferViews.length-1,
   componentType,type,count:rows.length});
  if(flat.length!==components*rows.length)throw Error('Fixture shape mismatch');
  return accessors.length-1;
 };
 const POSITION=add(seamPositions,'VEC3',5126,34962);
 const NORMAL=add(seamNormals,'VEC3',5126,34962);
 const TEXCOORD_0=add(seamUv,'VEC2',5126,34962);
 const indices=add(seamIndices.map(i=>[i]),'SCALAR',5123,34963);
 const bin=new Uint8Array(byteLength);
 let offset=0;
 for(const chunk of chunks){bin.set(chunk,offset);offset+=chunk.length;}
 const doc={
  asset:{version:'2.0',generator:'MARK Pass15 UV seam fixture'},
  scene:0,scenes:[{nodes:[0]}],nodes:[{name:'SplitCornerQuad',mesh:0}],
  meshes:[{primitives:[{mode:4,attributes:{
   POSITION,NORMAL,TEXCOORD_0
  },indices}]}],
  materials:[{name:'UV Seam Test PBR',doubleSided:true,
   pbrMetallicRoughness:{baseColorFactor:[.65,.76,.9,1],
    metallicFactor:0,roughnessFactor:.75}}],
  buffers:[{byteLength}],bufferViews,accessors
 };
 doc.meshes[0].primitives[0].material=0;
 return writeGlb({chunks:[{type:0x4e4f534a,data:new Uint8Array(0)},
  {type:0x004e4942,data:bin}]},doc);
}
