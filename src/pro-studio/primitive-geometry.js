/**
 * MARK P8: deterministic original procedural primitive vertex/index generators.
 * Pure JS without Three.js, Blender, network, CSS or a 3D renderer dependency.
 * Vertex positions/normals/UVs are real glTF-compatible dense Float32 streams.
 */
const allowed=new Set(['plane','grid','box','uv-sphere','cylinder']);
const assert=(ok,message)=>{if(!ok)throw Error('MARK_PRIMITIVE: '+message);};
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const shapeName=x=>String(x).replace(/[^a-zA-Z0-9-]/g,'').slice(0,40);
export function primitiveGeometry({
 shape='box',size=1,segments=12
}={}){
 assert(allowed.has(shape),'unsupported shape');
 assert(finite(size)&&size>=.01&&size<=50,'size must be 0.01–50 metres');
 assert(Number.isInteger(segments)&&segments>=3&&segments<=48,
  'segments must be between 3 and 48');
 const position=[],normal=[],uv=[],index=[];
 const add=(p,n,t)=>{
  assert(p.length===3&&n.length===3&&t.length===2&&
   [...p,...n,...t].every(finite),'finite vector expected');
  position.push(p);normal.push(n);uv.push(t);
  return position.length-1;
 };
 const tri=(a,b,c)=>index.push(a,b,c);
 const quad=(a,b,c,d)=>{tri(a,b,d);tri(b,c,d);};
 const h=size/2;
 if(shape==='plane'||shape==='grid'){
  const steps=shape==='grid'?segments:1;
  for(let j=0;j<=steps;j++)
   for(let i=0;i<=steps;i++)
    add([(-.5+i/steps)*size,(-.5+j/steps)*size,0],[0,0,1],
     [i/steps,j/steps]);
  for(let j=0;j<steps;j++)for(let i=0;i<steps;i++){
   const a=j*(steps+1)+i,b=a+1,c=a+steps+2,d=a+steps+1;
   quad(a,b,c,d);
  }
 }
 if(shape==='box'){
  // 24 seam-separated corners permit correct face normals and independent UVs.
  const faces=[
   [[1,0,0],[[h,-h,-h],[h,h,-h],[h,h,h],[h,-h,h]]],
   [[-1,0,0],[[-h,-h,h],[-h,h,h],[-h,h,-h],[-h,-h,-h]]],
   [[0,1,0],[[-h,h,-h],[-h,h,h],[h,h,h],[h,h,-h]]],
   [[0,-1,0],[[-h,-h,h],[-h,-h,-h],[h,-h,-h],[h,-h,h]]],
   [[0,0,1],[[h,-h,h],[h,h,h],[-h,h,h],[-h,-h,h]]],
   [[0,0,-1],[[-h,-h,-h],[-h,h,-h],[h,h,-h],[h,-h,-h]]]
  ];
  for(const [n,vertices] of faces){
   const ids=vertices.map((p,i)=>add(p,n,[[0,0],[0,1],[1,1],[1,0]][i]));
   quad(...ids);
  }
 }
 if(shape==='uv-sphere'){
  const meridians=segments*2,parallels=segments;
  for(let lat=0;lat<=parallels;lat++){
   const theta=lat/parallels*Math.PI,y=Math.cos(theta);
   const r=Math.sin(theta);
   for(let lon=0;lon<=meridians;lon++){
    const phi=lon/meridians*Math.PI*2;
    const n=[Math.cos(phi)*r,y,Math.sin(phi)*r];
    add(n.map(x=>x*h),n,[lon/meridians,1-lat/parallels]);
   }
  }
  for(let lat=0;lat<parallels;lat++)
   for(let lon=0;lon<meridians;lon++){
    const a=lat*(meridians+1)+lon,b=a+1,
     c=(lat+1)*(meridians+1)+lon+1,d=c-1;
    // Reverse winding for polar grid to point outward.
    if(lat>0)tri(a,d,b);
    if(lat<parallels-1)tri(b,d,c);
   }
 }
 if(shape==='cylinder'){
  const radial=segments;
  for(let i=0;i<=radial;i++){
   const phi=i/radial*2*Math.PI,c=Math.cos(phi),s=Math.sin(phi);
   add([c*h,-h,s*h],[c,0,s],[i/radial,0]);
   add([c*h,h,s*h],[c,0,s],[i/radial,1]);
  }
  for(let i=0;i<radial;i++){
   const a=2*i,b=a+2;
   tri(a,a+1,b);
   tri(b,a+1,b+1);
  }
  for(const [y,n,top] of [[h,[0,1,0],true],[-h,[0,-1,0],false]]){
   const center=add([0,y,0],n,[.5,.5]);
   const ring=[];
   for(let i=0;i<radial;i++){
    const phi=i/radial*Math.PI*2,c=Math.cos(phi),s=Math.sin(phi);
    ring.push(add([c*h,y,s*h],n,[(1+c)/2,(1+s)/2]));
   }
   for(let i=0;i<radial;i++)
    if(top)tri(center,ring[(i+1)%radial],ring[i]);
    else tri(center,ring[i],ring[(i+1)%radial]);
  }
 }
 assert(position.length>0&&position.length<=10000&&
  index.length>=3&&index.length<60000,'primitive budget');
 assert(index.every(v=>Number.isSafeInteger(v)&&v<position.length),'invalid index');
 return {shape,name:'MARK '+shapeName(shape),position,normal,uv,index,
  topology:{vertices:position.length,triangles:index.length/3}};
}
