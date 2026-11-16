/**
 * MARK Precision Sculpting: operate on actual named 3D vertex regions.
 * Builds a geodesic falloff from topology rather than editing 2D parameters.
 * Edits remain sparse coordinate deltas with one Undo item per operation.
 * Locked regions cannot be moved. No implicit topology modifications.
 */
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const vec=x=>Array.isArray(x)&&x.length===3&&x.every(finite);
const dist=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1],a[2]-b[2]);
const smooth=x=>x*x*(3-2*x);
function getRegion(mesh,name){
 const ids=mesh.regions?.[name];
 if(!Array.isArray(ids)||!ids.length)throw Error('Unknown / empty real topology region '+name);
 for(const id of ids)if(!mesh.vertices.has(id))throw Error('Region '+name+' contains outdated ID '+id);
 return ids;
}
export function adjustFaceContour(mesh,{region,delta,falloff=.16,strength=1,lockedRegions=[]}={}){
 const core=getRegion(mesh,region),seeds=new Set(core);
 if(!vec(delta)||delta.some(v=>Math.abs(v)>.12))throw Error('face.adjustContour needs XYZ delta with |axis| <=0.12');
 if(!finite(falloff)||falloff<.005||falloff>1)throw Error('face.adjustContour falloff must be .005..1');
 if(!finite(strength)||strength<0||strength>1)throw Error('face.adjustContour strength must be 0..1');
 if(!Array.isArray(lockedRegions))throw Error('lockedRegions must be an array');
 const locked=new Set();
 for(const name of lockedRegions)for(const id of getRegion(mesh,name))locked.add(id);
 if([...seeds].some(id=>locked.has(id)))throw Error('Locked region intersects edited region; operation cancelled');
 // Multi-source bounded Dijkstra, adjacency edges weighted by true distance.
 // Binary heap keeps large region edits interactive; no full-mesh snapshot.
 const heap=[],distance=new Map();
 const addHeap=(id,d)=>{
  let i=heap.length;heap.push([d,id]);
  while(i>0){const p=(i-1)>>1;if(heap[p][0]<=d)break;heap[i]=heap[p];i=p;}
  heap[i]=[d,id];
 };
 const popHeap=()=>{
  const head=heap[0],last=heap.pop();if(heap.length){
   let i=0;while(true){
    let j=i*2+1;if(j>=heap.length)break;
    if(j+1<heap.length&&heap[j+1][0]<heap[j][0])j++;
    if(heap[j][0]>=last[0])break;
    heap[i]=heap[j];i=j;
   }
   heap[i]=last;
  }
  return head;
 };
 for(const id of seeds){distance.set(id,0);addHeap(id,0);}
 while(heap.length){
  const [d,id]=popHeap();if(d!==distance.get(id)||d>falloff)continue;
  const p=mesh.vertices.get(id).position;
  for(const to of mesh.adj.get(id)||[]){
   if(locked.has(to))continue;
   const d2=d+dist(p,mesh.vertices.get(to).position);
   if(d2<falloff&&d2<(distance.get(to)??Infinity)){
    distance.set(to,d2);addHeap(to,d2);
   }
  }
 }
 const updates=new Map();
 for(const [id,d] of distance){
  const w=d===0?1:smooth(Math.max(0,1-d/falloff));
  const p=mesh.vertices.get(id).position;
  updates.set(id,p.map((v,i)=>v+delta[i]*w*strength));
 }
 const moved=mesh._coordinateEdit('face.adjustContour.'+region,updates);
 return {region,moved,sources:seeds.size,falloff,strength,locked:locked.size};
}
export function applySculptStroke(mesh,{points,radius=.12,strength=.35,mode='grab',delta=[0,0,.01],symmetry=false,mask=null}={}){
 if(!Array.isArray(points)||points.length<1||points.length>180||points.some(p=>!vec(p)))
  throw Error('sculpt.stroke requires 1..180 XYZ brush points');
 const initialHistory=mesh.history.slice(),initialFuture=mesh.future.slice(),
  initialRevision=mesh.revision,initialMaxHistory=mesh.maxHistory;
 let applied=0;
 try{
  // Do not evict earlier transactions while composing one continuous stroke.
  mesh.maxHistory=initialHistory.length+points.length+1;
  for(const center of points){
   mesh.brush({center,radius,strength,mode,delta,symmetry,mask});
   applied++;
  }
  const deltas=mesh.history.splice(initialHistory.length),merged=new Map();
  for(const entry of deltas){
   if(entry.kind!=='coordinates')throw Error('Non-coordinate operation inside sculpt stroke');
   for(const [id,before,after] of entry.changes){
    const prev=merged.get(id);
    if(prev)prev[2]=after;
    else merged.set(id,[id,before,after]);
   }
  }
  mesh.history.push({kind:'coordinates',label:'sculpt.stroke.'+mode,changes:[...merged.values()]});
  mesh.maxHistory=initialMaxHistory;
  while(mesh.history.length>mesh.maxHistory)mesh.history.shift();
  mesh.future=[];
  return {samples:points.length,verticesChanged:merged.size,historyEntriesAdded:1};
 }catch(error){
  for(let i=0;i<applied;i++)mesh.undo();
  mesh.history=initialHistory;mesh.future=initialFuture;mesh.revision=initialRevision;
  mesh._spatial=null;
  throw error;
 }finally{mesh.maxHistory=initialMaxHistory;}
}
