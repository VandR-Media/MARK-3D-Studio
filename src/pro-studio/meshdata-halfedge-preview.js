/**
 * Pass 18: bounded glTF face-corner / half-edge MeshData snapshot.
 * Canonical IDs are source-SHA and topology-revision scoped.
 * Geometry is read directly from true edited GLB; we NEVER silently weld
 * coincident geometry or use this read-only snapshot to edit the source.
 *
 * On a confirmed seam extrusion, explicitly validated source links are
 * promoted to cap/sidewall logical identities without changing glTF rows.
 * Unsupported N-gons, ambiguous positional matches and huge meshes fail
 * closed instead of manufacturing a misleading manifold graph.
 */
import {parseGlb} from '../glb.js';
import {inspectConsumedSeamExtrude} from './mesh-seam-identity.js';
const fail=(code,msg)=>{const error=Error('MARK_MESHDATA_'+code+': '+msg);
 error.code='MESHDATA_'+code;throw error;};
const yes=(p,code,msg)=>{if(!p)fail(code,msg);};
const nat=v=>Number.isSafeInteger(v)&&v>=0;
const components={SCALAR:1,VEC2:2,VEC3:3,VEC4:4};
const reads={5121:[1,'getUint8'],5123:[2,'getUint16'],5125:[4,'getUint32'],
 5126:[4,'getFloat32']};
function openPrimitive(bytes,meshIndex,primitiveIndex){
 const parsed=parseGlb(bytes),doc=parsed.json;
 yes(!doc.extensionsRequired?.length,'EXTENSIONS',
  'Required compressed extension not supported');
 const primitive=doc.meshes?.[meshIndex]?.primitives?.[primitiveIndex];
 yes(primitive&&(primitive.mode??4)===4&&nat(primitive.indices)&&
  nat(primitive.attributes?.POSITION),'PRIMITIVE',
  'Indexed glTF TRIANGLES primitive required');
 const bin=parsed.chunks.find(c=>c.type===0x004e4942)?.data;
 yes(bin,'BINARY','Embedded BIN required');
 const dv=new DataView(bin.buffer,bin.byteOffset,bin.byteLength);
 function read(index){
  const a=doc.accessors?.[index],b=doc.bufferViews?.[a?.bufferView];
  yes(a&&b&&b.buffer===0&&!a.sparse&&
   components[a.type]&&reads[a.componentType]&&nat(a.count)&&
   a.count<=400000,'ACCESSOR','Unsupported, sparse or oversized accessor');
  const [unit,method]=reads[a.componentType],n=components[a.type],
   stride=b.byteStride??n*unit,start=(b.byteOffset||0)+(a.byteOffset||0);
  yes(stride>=n*unit&&stride%unit===0&&start%unit===0&&
   start+(a.count?(a.count-1)*stride+n*unit:0)<=
    Math.min(bin.byteLength,(b.byteOffset||0)+b.byteLength),
   'ACCESSOR_RANGE','Accessor exceeds glTF bufferView bounds');
  const rows=Array.from({length:a.count},(_,i)=>Array.from({length:n},
   (_,c)=>dv[method](start+i*stride+c*unit,true)));
  yes(rows.every(row=>row.every(Number.isFinite)),
   'ACCESSOR_DATA','Non-finite attribute values');
  return {rows,type:a.type,componentType:a.componentType};
 }
 const pos=read(primitive.attributes.POSITION),indices=read(primitive.indices);
 yes(pos.type==='VEC3'&&pos.componentType===5126&&
  indices.type==='SCALAR'&&[5121,5123,5125].includes(indices.componentType),
  'PROFILE','Float32 POSITION and unsigned triangle indices required');
 const ind=indices.rows.map(row=>row[0]);
 yes(ind.length>=3&&ind.length%3===0&&ind.length<=24576&&
  ind.every(i=>nat(i)&&i<pos.rows.length),'FACE_BUDGET',
  'Up to 8192 indexed TRIANGLES with valid source indices');
 const attr={};
 for(const [semantic,accessor] of Object.entries(primitive.attributes)){
  const stream=read(accessor);
  yes(stream.rows.length===pos.rows.length,
   'ATTRIBUTE_COUNT','Vertex attributes must match POSITION count');
  attr[semantic]=stream.rows;
 }
 const morphs=(primitive.targets||[]).map(target=>{
  const streams={};
  for(const [semantic,accessor] of Object.entries(target)){
   const stream=read(accessor);
   yes(stream.rows.length===pos.rows.length,
    'MORPH_PROFILE','Morph stream must match POSITION');
   streams[semantic]=stream.rows;
  }
  return streams;
 });
 return{doc,primitive,attr,positions:pos.rows,indices:ind,morphs};
}
const vecKey=v=>v.join(',');
const normKey=(a,b)=>a<b?a+'|'+b:b+'|'+a;
export function buildMeshDataSnapshot({
 sourceGLB,editedGLB,sourceSha256,
 meshIndex=0,primitiveIndex=0,operations=[]
}={}){
 yes(sourceGLB&&editedGLB&&typeof sourceSha256==='string'&&
  /^[a-f0-9]{64}$/.test(sourceSha256),'SOURCE',
  'Immutable source, verified SHA256 and edited GLB are required');
 yes(nat(meshIndex)&&nat(primitiveIndex)&&Array.isArray(operations),
  'TARGET','Invalid mesh target or operation log');
 const source=openPrimitive(sourceGLB,meshIndex,primitiveIndex);
 const edited=openPrimitive(editedGLB,meshIndex,primitiveIndex);
 const first=operations.find(op=>op.kind==='face.regionExtrudeLinked'&&
  op.meshIndex===meshIndex&&op.primitiveIndex===primitiveIndex);
 const namespace=sourceSha256+'-m'+meshIndex+'-p'+primitiveIndex;
 const logical=Array.from({length:edited.positions.length},
  (_,index)=>'mark-attr-'+namespace+'-v'+index);
 const capMap=[],mappedWalls=[];
 if(first){
  yes(operations[0]===first&&operations.every((op,i)=>i===0||
   op.kind==='vertex.moveLinkedCap'&&
   op.meshIndex===meshIndex&&op.primitiveIndex===primitiveIndex),
  'OP_SEQUENCE','Source extrusion and bounded stable cap moves required');
  const consumed=inspectConsumedSeamExtrude(sourceGLB,{
   sourceSha256,operation:first});
  const sourceCount=source.positions.length;
  const capCount=consumed.capRemap.length,topStart=sourceCount+capCount;
  yes(edited.positions.length>=topStart&&
   (edited.positions.length-topStart)%4===0,'CAP_LAYOUT',
   'Edited GLB does not match recorded source-to-cap topology');
  const parent=Array.from({length:sourceCount},(_,i)=>i);
  const root=i=>{while(parent[i]!==i)i=parent[i];return i;};
  for(const link of first.links){
   const a=root(link.vertexA),b=root(link.vertexB);
   if(a!==b)parent[Math.max(a,b)]=Math.min(a,b);
  }
  const rootToTop=new Map(),rootToBase=new Map(),
   topPositionToRoot=new Map(),bottomPositionToRoot=new Map();
  function declare(map,key,value){
   if(map.has(key))yes(map.get(key)===value,
    'AMBIGUOUS','Unlinked coincident shells need explicit topology');
   map.set(key,value);
  }
  for(const cap of consumed.capRemap){
   const group=root(cap.sourceVertex);
   const capId='mark-top-'+namespace+'-root'+group;
   const baseId='mark-base-'+namespace+'-root'+group;
   logical[cap.capAttributeVertex]=capId;
   rootToTop.set(group,capId);rootToBase.set(group,baseId);
   declare(topPositionToRoot,
    vecKey(edited.positions[cap.capAttributeVertex]),group);
   declare(bottomPositionToRoot,
    vecKey(source.positions[cap.sourceVertex]),group);
   capMap.push({sourceVertex:cap.sourceVertex,
    attributeVertex:cap.capAttributeVertex,logicalVertexId:capId,
    stableCapAttributeId:cap.capStableId});
  }
  for(let i=topStart;i<edited.positions.length;i+=4){
   const row=[i,i+1,i+2,i+3];
   for(const [slot,attributeVertex] of row.entries()){
    const upper=slot>=2;
    const group=(upper?topPositionToRoot:bottomPositionToRoot)
     .get(vecKey(edited.positions[attributeVertex]));
    yes(group!==undefined,'WALL_SOURCE',
     'A generated wall has no unambiguous source/cap corner');
    logical[attributeVertex]=upper?rootToTop.get(group):rootToBase.get(group);
   }
   mappedWalls.push({attributeVertices:row.slice(),
    logicalVertices:row.map(v=>logical[v])});
  }
 }
 const faces=[],corners=[],halfedges=[];
 const halfByUndirected=new Map();
 const uvSets=Object.keys(edited.attr).filter(x=>/^TEXCOORD_\d+$/.test(x)).sort();
 const colorSets=Object.keys(edited.attr).filter(x=>/^COLOR_\d+$/.test(x)).sort();
 const materialSlots=Array.from({length:(edited.doc.materials||[]).length},
  (_,i)=>({index:i,name:edited.doc.materials[i].name||''}));
 const originalFaces=source.indices.length/3;
 const capSources=new Set(first?.faces||[]);
 const nonSelected=Array.from({length:originalFaces},(_,i)=>i)
  .filter(i=>!capSources.has(i));
 const outputFaceOrigins=first?[
  ...nonSelected.map(i=>'source-face-'+i),
  ...[...first.faces].sort((a,b)=>a-b).map(i=>'cap-face-'+i),
  ...Array.from({length:(edited.indices.length/3-originalFaces+
   first.faces.length)/2},(_,i)=>'wall-'+i+'-tri0')
  // Correct wall triangle names are assigned below by output ordinal.
 ]:[];
 for(let f=0;f<edited.indices.length/3;f++){
  let name='source-face-'+f;
  if(first){
   if(f<nonSelected.length)name='source-face-'+nonSelected[f];
   else if(f<nonSelected.length+first.faces.length)
    name='cap-face-'+[...first.faces].sort((a,b)=>a-b)[f-nonSelected.length];
   else{
    const w=f-nonSelected.length-first.faces.length;
    name='wall-'+Math.floor(w/2)+'-tri'+w%2;
   }
  }
  const faceId='mark-face-'+namespace+'-'+name,
   verts=edited.indices.slice(f*3,f*3+3),
   cornerIds=[];
  for(let k=0;k<3;k++){
   const index=f*3+k,attrVertex=verts[k],
    nextAttr=verts[(k+1)%3],logicalVertex=logical[attrVertex],
    logicalNext=logical[nextAttr];
   const cornerId='mark-corner-'+faceId+'-k'+k,
    edgeId='mark-edge-'+namespace+'-'+normKey(logicalVertex,logicalNext),
    edgeHalfedgeId='mark-halfedge-'+faceId+'-k'+k;
   const attrs={
    position:edited.positions[attrVertex].slice(),
    normal:edited.attr.NORMAL?.[attrVertex]?.slice()||null,
    tangent:edited.attr.TANGENT?.[attrVertex]?.slice()||null,
    uvSets:Object.fromEntries(uvSets.map(u=>[u,edited.attr[u][attrVertex].slice()])),
    colors:Object.fromEntries(colorSets.map(u=>[u,edited.attr[u][attrVertex].slice()])),
    jointSets:Object.fromEntries(Object.keys(edited.attr)
     .filter(x=>/^JOINTS_\d+$/.test(x)).sort().map(u=>
      [u,edited.attr[u][attrVertex].slice()])),
    weightSets:Object.fromEntries(Object.keys(edited.attr)
     .filter(x=>/^WEIGHTS_\d+$/.test(x)).sort().map(u=>
      [u,edited.attr[u][attrVertex].slice()])),
    morphs:edited.morphs.map(m=>Object.fromEntries(
     Object.entries(m).map(([n,rows])=>[n,rows[attrVertex].slice()])))
   };
   corners.push({id:cornerId,faceId,slot:k,attributeVertex:attrVertex,
    logicalVertexId:logicalVertex,attributes:attrs});
   cornerIds.push(cornerId);
   const h={id:edgeHalfedgeId,faceId,cornerId,edgeId,
    origin:logicalVertex,destination:logicalNext,
    next:'mark-halfedge-'+faceId+'-k'+(k+1)%3,
    prev:'mark-halfedge-'+faceId+'-k'+(k+2)%3,
    twin:null};
   halfedges.push(h);
   if(!halfByUndirected.has(edgeId))halfByUndirected.set(edgeId,[]);
   halfByUndirected.get(edgeId).push(h);
  }
  faces.push({id:faceId,triangleIndex:f,cornerIds,
   materialSlot:edited.primitive.material??null,
   topology:'TRIANGLE',holes:[]});
 }
 const edges=[],badWinding=[],nonManifold=[],uvSeamEdges=[],
  boundaries=[];
 const byCorner=new Map(corners.map(c=>[c.id,c]));
 for(const [id,list] of halfByUndirected){
  if(list.length===2){
   if(list[0].origin===list[1].destination&&
    list[0].destination===list[1].origin){
    list[0].twin=list[1].id;list[1].twin=list[0].id;
   }else badWinding.push(id);
  }
  if(list.length>2)nonManifold.push(id);
  if(list.length===1)boundaries.push(id);
  const uvs=[];
  if(list.length===2){
   const a=list[0],b=list[1],ca=byCorner.get(a.cornerId),
    cb=byCorner.get(b.cornerId);
   for(const uvName of uvSets){
    const x=ca.attributes.uvSets[uvName],
     y=byCorner.get(halfedges.find(h=>h.id===b.next)?.cornerId)
      ?.attributes.uvSets[uvName];
    if(y&&x.some((v,k)=>v!==y[k]))uvs.push(uvName);
   }
  }
  if(uvs.length)uvSeamEdges.push(id);
  edges.push({id,halfedgeIds:list.map(h=>h.id),
   boundary:list.length===1,nonManifold:list.length>2,
   windingConflict:badWinding.includes(id),uvSeamSets:uvs});
 }
 return{
  schema:'mark.meshdata-halfedge-preview/1',
  sourceSha256,meshIndex,primitiveIndex,
  profile:'indexed TRIANGLES + explicit source-approved UV seam remap',
  losslessToOriginalGLB:false,
  persistedAs:'deterministic reconstruction from source GLB and native typed edit log',
  stableIdScope:'source hash + mesh/primitive + immutable topology + logical-cap moves',
  faces,edges,halfedges,corners,materialSlots,uvSets,colorSets,
  capMap,mappedWalls,
  diagnostics:{triangleCount:faces.length,cornerCount:corners.length,
   halfedgeCount:halfedges.length,edgeCount:edges.length,
   boundaryEdges:boundaries.length,nonManifoldEdges:nonManifold.length,
   windingConflicts:badWinding.length,uvDiscontinuityEdges:uvSeamEdges.length,
   capAttributeRows:capMap.length,
   linkedCapMoveCount:operations.filter(x=>x.kind==='vertex.moveLinkedCap').length,
   proceduralHalfedgeReconstruction:true,editableOnlyViaBoundedCapMove:true,
   fullyWeldedGLB:false},
  boundaryEdgeIds:boundaries,nonManifoldEdgeIds:nonManifold,
  windingConflictIds:badWinding,uvSeamEdgeIds:uvSeamEdges
 };
}
