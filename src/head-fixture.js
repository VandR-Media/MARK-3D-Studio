import {writeGlb} from './glb.js';

// Original procedural organic testing surface. It is NOT the approved MARK Cosmic
// and does not attempt to recreate his concept art. Its topology is made of
// actual triangles with a nose, cheeks, jaw, lips, forehead and eye hollows.
export function createTestHeadGlb({rings=118,segments=160}={}){
 if(!Number.isInteger(rings)||!Number.isInteger(segments)||rings<16||segments<24||rings>200||segments>320)
  throw Error('Неверное разрешение тестовой головы.');
 const count=rings*segments+2,p=new Float32Array(count*3),uv=new Float32Array(count*2);
 const tri=new Uint32Array(rings*segments*6),norm=new Float32Array(count*3);
 const gauss=(x,y,cx,cy,sx,sy)=>Math.exp(-.5*((x-cx)**2/(sx*sx)+(y-cy)**2/(sy*sy)));
 const at=(i,j)=>i*segments+((j+segments)%segments);
 for(let i=0;i<rings;i++)for(let j=0;j<segments;j++){
  const latitude=-Math.PI/2+Math.PI*(i+1)/(rings+1),t=2*Math.PI*j/segments;
  const h=Math.sin(latitude),c=Math.cos(latitude);
  let x=.79*c*Math.sin(t),y=1.13*h,z=.77*c*Math.cos(t);
  const jaw=1-.13*gauss(0,y,0,-.81,10,.32);
  x*=jaw;
  if(z>0){
   const cheek=gauss(Math.abs(x),y,.43,-.12,.22,.22);
   const sockets=gauss(Math.abs(x),y,.32,.39,.19,.14);
   const brow=gauss(Math.abs(x),y,.32,.57,.2,.1);
   const bridge=gauss(x,y,0,.21,.115,.32);
   const tip=gauss(x,y,0,-.03,.13,.135);
   const alae=gauss(Math.abs(x),y,.14,-.11,.065,.085);
   const mouth=gauss(x,y,0,-.47,.29,.052);
   const chin=gauss(x,y,0,-.79,.23,.14);
   z+=.088*cheek-.07*sockets+.044*brow+.22*bridge+.23*tip+.07*alae+.055*mouth+.09*chin;
   z-=.045*gauss(Math.abs(x),y,.10,-.20,.052,.042);
  }
  x+=Math.sign(x)*.11*gauss(Math.abs(x),y,.69,-.03,.15,.25);
  y+=.027*Math.cos(4*t)*c*c;
  const k=at(i,j);p.set([x,y,z],k*3);
  uv.set([.5+x/2.2,.5+y/2.5],k*2); // continuous planar UV avoids a split topology seam
 }
 const south=rings*segments,north=south+1;
 p.set([0,-1.13,0],south*3);p.set([0,1.13,0],north*3);
 uv.set([.5,.05],south*2);uv.set([.5,.95],north*2);
 let n=0;
 for(let i=0;i<rings-1;i++)for(let j=0;j<segments;j++){
  const a=at(i,j),b=at(i+1,j),c=at(i,j+1),d=at(i+1,j+1);
  tri.set([a,c,b,c,d,b],n);n+=6;
 }
 for(let j=0;j<segments;j++){
  tri.set([south,at(0,j+1),at(0,j)],n);n+=3;
  tri.set([north,at(rings-1,j),at(rings-1,j+1)],n);n+=3;
 }
 if(n!==tri.length)throw Error('Head topology index count mismatch.');
 for(let i=0;i<tri.length;i+=3){
  const a=tri[i]*3,b=tri[i+1]*3,c=tri[i+2]*3;
  const ux=p[b]-p[a],uy=p[b+1]-p[a+1],uz=p[b+2]-p[a+2];
  const vx=p[c]-p[a],vy=p[c+1]-p[a+1],vz=p[c+2]-p[a+2];
  const nx=uy*vz-uz*vy,ny=uz*vx-ux*vz,nz=ux*vy-uy*vx;
  for(const k of [a,b,c]){norm[k]+=nx;norm[k+1]+=ny;norm[k+2]+=nz;}
 }
 for(let i=0;i<norm.length;i+=3){const d=Math.hypot(norm[i],norm[i+1],norm[i+2])||1;
  norm[i]/=d;norm[i+1]/=d;norm[i+2]/=d;}
 const arrays=[p,norm,uv,tri],offsets=[0],lengths=arrays.map(a=>a.byteLength);
 for(let i=0;i<arrays.length-1;i++)offsets.push(offsets[i]+lengths[i]);
 const bin=new Uint8Array(lengths.reduce((a,b)=>a+b,0));
 arrays.forEach((a,i)=>bin.set(new Uint8Array(a.buffer),offsets[i]));
 const bounds=(a)=>[0,1,2].map(axis=>{let v=a?Infinity:-Infinity;for(let i=axis;i<p.length;i+=3)v=a?Math.min(v,p[i]):Math.max(v,p[i]);return v;});
 const json={asset:{version:'2.0',generator:'MARK 3D Studio 0.2 — original mesh test fixture'},
  scene:0,scenes:[{nodes:[0]}],nodes:[{name:'Тестовая полигональная голова — НЕ MARK Cosmic',mesh:0}],
  meshes:[{name:'Organic practice head',primitives:[{attributes:{POSITION:0,NORMAL:1,TEXCOORD_0:2},indices:3,material:0}]}],
  materials:[{name:'Практика — нейтральная кожа',doubleSided:true,pbrMetallicRoughness:{
   baseColorFactor:[.68,.48,.37,1],metallicFactor:0,roughnessFactor:.84}}],
  buffers:[{byteLength:bin.byteLength}],bufferViews:arrays.map((a,i)=>({
   buffer:0,byteOffset:offsets[i],byteLength:lengths[i],...(i===3?{target:34963}:{target:34962})})),
  accessors:[
   {bufferView:0,componentType:5126,count,type:'VEC3',min:bounds(true),max:bounds(false)},
   {bufferView:1,componentType:5126,count,type:'VEC3'},
   {bufferView:2,componentType:5126,count,type:'VEC2'},
   {bufferView:3,componentType:5125,count:tri.length,type:'SCALAR'}]};
 return writeGlb({chunks:[{type:0x4e4f534a,data:new Uint8Array(0)},{type:0x004e4942,data:bin}]},json);
}
