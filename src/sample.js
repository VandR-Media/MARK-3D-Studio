/** Genuine organic polygonal test mesh (6240 vertices, 12480 triangles), not MARK Cosmic. */
import {writeGlb} from './glb.js';
export function createSampleGlb(){
 const rings=260,sides=24,N=rings*sides,tau=Math.PI*2;
 const positions=new Float32Array(N*3),normals=new Float32Array(N*3);
 const uvs=new Float32Array(N*2),indices=new Uint16Array(N*6);
 const center=t=>{const r=1+.32*Math.cos(3*t);return[r*Math.cos(2*t),.66*Math.sin(3*t),r*Math.sin(2*t)];};
 const norm=v=>{const k=Math.hypot(...v)||1;return v.map(x=>x/k);};
 const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
 for(let i=0;i<rings;i++){
  const t=tau*i/rings,c=center(t),q=center(t+.0001),p=center(t-.0001);
  const tangent=norm(q.map((v,k)=>v-p[k]));
  const a1=norm(cross(tangent,[0,1,0])),a2=norm(cross(tangent,a1));
  for(let j=0;j<sides;j++){
   const a=tau*j/sides,k=i*sides+j;
   const n=norm(a1.map((v,h)=>v*Math.cos(a)+a2[h]*Math.sin(a)));
   const rad=.16+.017*Math.sin(13*t+5*a)+.016*Math.cos(7*t-3*a);
   for(let h=0;h<3;h++){positions[k*3+h]=c[h]+rad*n[h];normals[k*3+h]=n[h];}
   uvs[k*2]=i/rings;uvs[k*2+1]=j/sides;
   const b=((i+1)%rings)*sides+j,d=i*sides+(j+1)%sides,cc=((i+1)%rings)*sides+(j+1)%sides;
   indices.set([k,b,d,b,cc,d],k*6);
  }
 }
 const mins=[Infinity,Infinity,Infinity],maxs=[-Infinity,-Infinity,-Infinity];
 for(let k=0;k<positions.length;k++){const h=k%3;mins[h]=Math.min(mins[h],positions[k]);maxs[h]=Math.max(maxs[h],positions[k]);}
 const arrays=[positions,normals,uvs,indices],lengths=arrays.map(x=>x.byteLength),offsets=[0];
 for(let k=0;k<lengths.length-1;k++)offsets.push(offsets[k]+lengths[k]);
 const bin=new Uint8Array(lengths.reduce((a,b)=>a+b,0));
 arrays.forEach((a,i)=>bin.set(new Uint8Array(a.buffer),offsets[i]));
 const json={asset:{version:'2.0',generator:'MARK 3D Studio fixture'},scene:0,scenes:[{nodes:[0]}],
  nodes:[{name:'Organic polygonal test shell',mesh:0}],
  meshes:[{primitives:[{attributes:{POSITION:0,NORMAL:1,TEXCOORD_0:2},indices:3,material:0}]}],
  materials:[{name:'Cosmic Alloy — sample',doubleSided:true,pbrMetallicRoughness:{
   baseColorFactor:[.24,.46,.95,1],metallicFactor:.58,roughnessFactor:.38}}],
  buffers:[{byteLength:bin.length}],
  bufferViews:arrays.map((a,i)=>({buffer:0,byteOffset:offsets[i],byteLength:lengths[i],...(i===3?{}:{target:34962})})),
  accessors:[
   {bufferView:0,componentType:5126,count:N,type:'VEC3',min:mins,max:maxs},
   {bufferView:1,componentType:5126,count:N,type:'VEC3'},
   {bufferView:2,componentType:5126,count:N,type:'VEC2'},
   {bufferView:3,componentType:5123,count:indices.length,type:'SCALAR'}]};
 return writeGlb({chunks:[{type:0x4e4f534a,data:new Uint8Array(0)},{type:0x004e4942,data:bin}]},json);
}