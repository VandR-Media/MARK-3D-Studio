/**
 * Topological quad disk: fill any even-N boundary with a structured a × b
 * Coons patch (N = 2*(a+b)). No long cross-disk zipper polygons or
 * high-valence center fan. Every new interior vertex has valence four.
 *
 * The ring is ordered in the outgoing half-edge boundary direction. Patch
 * quads are oriented so every cap edge opposes that boundary edge.
 */
export function fillQuadDisk(mesh,ring,{dish=.004}={}){
 const n=ring?.length;
 if(!Number.isInteger(n)||n<8||n%2!==0)throw Error('Quad disk requires even rim >=8');
 if(!Number.isFinite(dish)||Math.abs(dish)>.05)throw Error('Invalid disk depth');
 const a=Math.floor(n/4),b=n/2-a,grid=Array.from({length:b+1},()=>Array(a+1).fill(null));
 const path=[];
 for(let u=0;u<=a;u++)path.push([u,0]);
 for(let v=1;v<=b;v++)path.push([a,v]);
 for(let u=a-1;u>=0;u--)path.push([u,b]);
 for(let v=b-1;v>=1;v--)path.push([0,v]);
 if(path.length!==n)throw Error('Quad disk boundary count mismatch');
 for(let i=0;i<n;i++){const [u,v]=path[i];grid[v][u]=ring[i];}
 const position=(u,v)=>mesh.vertices.get(grid[v][u]).position;
 const corners=[position(0,0),position(a,0),position(0,b),position(a,b)];
 const mix=(p,q,t)=>p.map((x,k)=>x*(1-t)+q[k]*t);
 for(let v=1;v<b;v++)for(let u=1;u<a;u++){
  const s=u/a,t=v/b;
  const top=position(u,0),bottom=position(u,b),
   left=position(0,v),right=position(a,v);
  const blendTB=mix(top,bottom,t),blendLR=mix(left,right,s);
  const cornerTop=mix(corners[0],corners[1],s);
  const cornerBottom=mix(corners[2],corners[3],s);
  const bilinear=mix(cornerTop,cornerBottom,t);
  const p=blendTB.map((q,k)=>q+blendLR[k]-bilinear[k]);
  // Very slight concave concha/socket bottom, not a folded fan.
  p[2]-=dish*Math.sin(Math.PI*s)*Math.sin(Math.PI*t);
  const uv=mix(mesh.vertices.get(grid[0][u]).uv,mesh.vertices.get(grid[b][u]).uv,t);
  grid[v][u]=mesh._vertex(p,uv);
 }
 let quads=0;
 for(let v=0;v<b;v++)for(let u=0;u<a;u++){
  const ids=[grid[v][u],grid[v+1][u],grid[v+1][u+1],grid[v][u+1]];
  mesh._face(ids);quads++;
 }
 return {quads,interiorVertices:(a-1)*(b-1),gridSize:[a,b],maxInteriorVertexValence:4};
}
