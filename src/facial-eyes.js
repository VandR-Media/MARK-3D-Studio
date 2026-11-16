/**
 * Editable polygonal eyeballs: each is a separate closed QUAD component
 * sharing the host EditableMesh vertex/face ID space and Undo/Redo.
 * Cubed-sphere tessellation eliminates latitude pole triangle fans.
 * Neutral clay material is intentional: this stage evaluates geometry only.
 */
const frames=[
 {n:[1,0,0],u:[0,0,-1],v:[0,1,0]},
 {n:[-1,0,0],u:[0,0,1],v:[0,1,0]},
 {n:[0,1,0],u:[1,0,0],v:[0,0,-1]},
 {n:[0,-1,0],u:[1,0,0],v:[0,0,1]},
 {n:[0,0,1],u:[1,0,0],v:[0,1,0]},
 {n:[0,0,-1],u:[-1,0,0],v:[0,1,0]}
];
export function addEditableEyeGlobe(mesh,{name,center,radius=.13,segments=10}={}){
 if(typeof name!=='string'||!/^(left|right)$/.test(name)||
    !Array.isArray(center)||center.length!==3||!center.every(Number.isFinite)||
    !Number.isFinite(radius)||radius<=.03||radius>.3||
    !Number.isInteger(segments)||segments<4||segments>24)
  throw Error('Invalid editable eye globe parameters');
 const vertices=new Map(),faceIds=[],n=segments;
 for(const frame of frames){
  const grid=[];
  for(let j=0;j<=n;j++)for(let i=0;i<=n;i++){
   const u=2*i/n-1,v=2*j/n-1,
    cube=frame.n.map((x,k)=>x+frame.u[k]*u+frame.v[k]*v);
   const length=Math.hypot(...cube),direction=cube.map(x=>x/length);
   const key=cube.map(c=>c.toFixed(8)).join(',');
   if(!vertices.has(key)){
    const point=center.map((c,k)=>c+radius*direction[k]);
    vertices.set(key,mesh._vertex(point,[i/n,j/n]));
   }
   grid.push(vertices.get(key));
  }
  const at=(i,j)=>grid[j*(n+1)+i];
  for(let j=0;j<n;j++)for(let i=0;i<n;i++){
   faceIds.push(mesh._face([at(i,j),at(i+1,j),at(i+1,j+1),at(i,j+1)],
    [[i/n,j/n],[(i+1)/n,j/n],[(i+1)/n,(j+1)/n],[i/n,(j+1)/n]]));
  }
 }
 const ids=[...vertices.values()],region='eyeball_'+name;
 mesh.regions[region]=ids;
 const front=ids.reduce((best,id)=>{
  const p=mesh.vertices.get(id).position;
  return !best||p[2]>mesh.vertices.get(best).position[2]?id:best;
 },null);
 mesh.landmarks[region]={vertex:front,center:[...center]};
 return {name,center:[...center],radius,vertices:ids.length,quads:faceIds.length};
}
