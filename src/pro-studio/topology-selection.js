/**
 * Pass 14: typed, renderer-independent indexed-triangle region selection.
 * A GLB vertex index is a CORNER-DATA index, not necessarily a unique
 * geometric/topological vertex: UV/normal seams remain distinct.
 *
 * This diagnoses the selected subset only; Mesh Edit core is the final
 * authority for operation admissibility against the full source mesh.
 */
const fail=(code,message)=>{const error=Error('MARK_REGION_'+code+': '+message);error.code='REGION_'+code;throw error;};
const check=(yes,code,message)=>{if(!yes)fail(code,message);};
const indexOk=n=>Number.isSafeInteger(n)&&n>=0;
const edgeKey=(a,b)=>Math.min(a,b)+':'+Math.max(a,b);

export function analyzeIndexedFaceRegion({
 indices,vertexCount,faces,maxFaces=128
}={}){
 check((Array.isArray(indices)||ArrayBuffer.isView(indices))&&
  indices.length>=3&&indices.length%3===0,
  'INDEX_PROFILE','Expected indexed TRIANGLES with 3 indices per face');
 check(indexOk(vertexCount)&&vertexCount>=3,
  'VERTEX_COUNT','Invalid mesh vertex count');
 check(Array.from(indices).every(i=>indexOk(i)&&i<vertexCount),
  'INDEX_RANGE','Mesh contains an invalid vertex index');
 check(Array.isArray(faces)&&faces.length>=1&&faces.length<=maxFaces&&
  faces.every(i=>indexOk(i)&&i<indices.length/3)&&
  new Set(faces).size===faces.length,'FACE_RANGE',
  'Expected distinct face IDs belonging to one indexed primitive');
 const ordered=[...faces].sort((a,b)=>a-b),edgeMap=new Map(),triangles=[];
 const adjacent=new Map(ordered.map(f=>[f,new Set()]));
 for(const face of ordered){
  const tri=[indices[face*3],indices[face*3+1],indices[face*3+2]];
  check(new Set(tri).size===3,'DEGENERATE',
   'Selected face contains repeated vertex IDs');
  triangles.push({face,vertices:tri});
  for(let k=0;k<3;k++){
   const from=tri[k],to=tri[(k+1)%3],key=edgeKey(from,to);
   if(!edgeMap.has(key))edgeMap.set(key,[]);
   edgeMap.get(key).push({face,from,to});
  }
 }
 const boundaryEdges=[],internalEdges=[],nonManifoldEdges=[],windingConflicts=[];
 for(const [key,list] of edgeMap){
  if(list.length===1)boundaryEdges.push({...list[0],key});
  else if(list.length===2){
   internalEdges.push({key,faces:list.map(x=>x.face)});
   adjacent.get(list[0].face).add(list[1].face);
   adjacent.get(list[1].face).add(list[0].face);
   if(list[0].from!==list[1].to||list[0].to!==list[1].from)
    windingConflicts.push(key);
  }else nonManifoldEdges.push({key,incidence:list.length});
 }
 const unvisited=new Set(ordered);let components=0;
 while(unvisited.size){
  components++;
  const stack=[unvisited.values().next().value];
  while(stack.length){
   const f=stack.pop();
   if(!unvisited.delete(f))continue;
   for(const other of adjacent.get(f))if(unvisited.has(other))stack.push(other);
  }
 }
 const inCount=new Map(),outCount=new Map(),next=new Map();
 for(const e of boundaryEdges){
  outCount.set(e.from,(outCount.get(e.from)||0)+1);
  inCount.set(e.to,(inCount.get(e.to)||0)+1);
  next.set(e.from,e.to);
 }
 const perimeterVertices=new Set([...inCount.keys(),...outCount.keys()]);
 const simpleVertices=[...perimeterVertices].every(v=>
  inCount.get(v)===1&&outCount.get(v)===1);
 let simpleLoop=false;
 if(simpleVertices&&boundaryEdges.length>=3){
  const start=boundaryEdges[0].from,seen=new Set();
  let current=start;
  for(let i=0;i<boundaryEdges.length;i++){
   if(seen.has(current))break;
   seen.add(current);current=next.get(current);
  }
  simpleLoop=current===start&&seen.size===boundaryEdges.length;
 }
 const validRegion=components===1&&nonManifoldEdges.length===0&&
  windingConflicts.length===0&&simpleLoop;
 return{
  meshProfile:'indexed triangles; vertex IDs include glTF corner seams',
  faces:ordered,triangles,boundaryEdges,internalEdges,
  diagnostics:{
   connectedComponents:components,
   selectedTriangles:ordered.length,
   boundaryEdges:boundaryEdges.length,
   internalEdges:internalEdges.length,
   nonManifoldEdges:nonManifoldEdges.length,
   windingConflicts:windingConflicts.length,
   singleBoundaryLoop:simpleLoop,
   validRegion
  }
 };
}
