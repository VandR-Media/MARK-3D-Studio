/**
 * Pass17 real skinned GLB with a split two-triangle UV seam.
 *
 * Starts with the proven 70-joint/2-position-morph/3-clip rig test fixture.
 * Adds two attribute rows that duplicate corners 1 and 2 (same XYZ/skin
 * weights/morph deltas) with different TEXCOORD_0 and TEXCOORD_1.
 * Embedded PNG, skins, bind matrices and animation buffers are preserved.
 */
import {parseGlb,writeGlb} from '../src/glb.js';
import {buildRiggedFixture} from './pro-studio-glb-fixtures.mjs';

const components={SCALAR:1,VEC2:2,VEC3:3,VEC4:4,MAT4:16};
const width={5121:1,5123:2,5125:4,5126:4};
const aligned=n=>(n+3)&~3;

export function buildSkinnedSeamFixture(){
 const source=buildRiggedFixture();
 const parsed=parseGlb(source.bytes),doc=structuredClone(parsed.json);
 const primitive=doc.meshes[0].primitives[0];
 let bin=parsed.chunks.find(c=>c.type===0x004e4942).data.slice();
 const rowOrder=[0,1,2,3,1,2];
 const appendRaw=(raw,originalAccessorIndex,semantic)=>{
  const sourceAcc=doc.accessors[originalAccessorIndex];
  const sourceView=doc.bufferViews[sourceAcc.bufferView];
  const offset=aligned(bin.length);
  const output=new Uint8Array(offset+raw.length);
  output.set(bin);output.set(raw,offset);bin=output;
  const bufferView=doc.bufferViews.length;
  doc.bufferViews.push({buffer:0,byteOffset:offset,byteLength:raw.length,
   ...(sourceView.target===undefined?{}:{target:sourceView.target})});
  const accessor=doc.accessors.length;
  doc.accessors.push({...sourceAcc,bufferView,byteOffset:0,
   count:semantic==='indices'?raw.length/2:rowOrder.length});
  return accessor;
 };
 const cloneRows=(index,semantic)=>{
  const acc=doc.accessors[index],view=doc.bufferViews[acc.bufferView];
  const size=components[acc.type]*width[acc.componentType];
  const stride=view.byteStride??size;
  const base=(view.byteOffset||0)+(acc.byteOffset||0);
  const data=new Uint8Array(rowOrder.length*size);
  for(let i=0;i<rowOrder.length;i++){
   const start=base+rowOrder[i]*stride;
   data.set(bin.slice(start,start+size),i*size);
  }
  if(semantic==='TEXCOORD_0'||semantic==='TEXCOORD_1'){
   const dv=new DataView(data.buffer);
   // Old duplicated glTF corners 4/5 must have visible UV differences,
   // but their source position/deformation must remain identical.
   for(const [row,u,v] of [[4,.61,.09],[5,.12,.76]]){
    dv.setFloat32(row*8,u,true);dv.setFloat32(row*8+4,v,true);
   }
  }
  return appendRaw(data,index,semantic);
 };
 const originalAttributes=structuredClone(primitive.attributes);
 for(const [semantic,index] of Object.entries(originalAttributes))
  primitive.attributes[semantic]=cloneRows(index,semantic);
 // Distinct second UV set for tests of independent corner attribute storage.
 primitive.attributes.TEXCOORD_1=cloneRows(originalAttributes.TEXCOORD_0,'TEXCOORD_1');
 for(const target of primitive.targets||[])
  for(const [semantic,index] of Object.entries(target))
   target[semantic]=cloneRows(index,'MORPH_'+semantic);
 const idx=new Uint8Array(12),dv=new DataView(idx.buffer);
 [0,1,2,4,3,5].forEach((n,i)=>dv.setUint16(i*2,n,true));
 primitive.indices=appendRaw(idx,primitive.indices,'indices');
 doc.buffers[0].byteLength=bin.length;
 const pad=new Uint8Array(aligned(bin.length));pad.set(bin);
 const chunks=parsed.chunks.map(c=>c.type===0x004e4942?
  {type:c.type,data:pad}:c);
 return writeGlb({...parsed,chunks},doc);
}
