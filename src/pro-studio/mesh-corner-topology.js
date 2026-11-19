/**
 * MARK Studio Pass 15: READ-ONLY bridge between glTF corner-vertices and
 * candidate geometric vertices. glTF indices identify vertex ATTRIBUTE rows;
 * equal POSITION does not prove that two rows are the same editable vertex.
 *
 * This is an exact-position topology DIAGNOSTIC, NOT a vertex weld, and is
 * never used to rewrite GLB, .markscene, skin weights or morph targets.
 */
import {parseGlb} from '../glb.js';

const failure=(code,message)=>{const e=Error('MARK_CORNER_'+code+': '+message);
 e.code='CORNER_'+code;throw e;};
const requireValid=(p,code,msg)=>{if(!p)failure(code,msg);};
const unsigned=n=>Number.isSafeInteger(n)&&n>=0;
const finite=n=>typeof n==='number'&&Number.isFinite(n);
const keyNumber=n=>Object.is(n,-0)?0:n;
const keyVec=row=>row.map(keyNumber).join(',');
const keyEdge=(a,b)=>Math.min(a,b)+':'+Math.max(a,b);
const equalsRow=(a,b)=>a.length===b.length&&a.every((n,i)=>n===b[i]);
const TYPES={SCALAR:1,VEC2:2,VEC3:3,VEC4:4};
const COMPONENTS={
 5121:[1,'getUint8',255],5123:[2,'getUint16',65535],
 5125:[4,'getUint32',4294967295],5126:[4,'getFloat32',null]
};
function validRows(rows,count,dims,name){
 requireValid(Array.isArray(rows)&&rows.length===count&&rows.every(r=>
  Array.isArray(r)&&r.length===dims&&r.every(finite)),
 'ATTRIBUTE_PROFILE','Invalid '+name+' rows');
}
export function buildCornerTopology({positions,indices,uvSets={},normals=null}={}){
 requireValid(Array.isArray(positions)&&positions.length>=3&&
  positions.length<=250000,'POSITIONS','Expected bounded POSITION rows');
 const vertexCount=positions.length;
 validRows(positions,vertexCount,3,'POSITION');
 requireValid((Array.isArray(indices)||ArrayBuffer.isView(indices))&&
  indices.length>=3&&indices.length%3===0&&indices.length<=3000000&&
  Array.from(indices).every(i=>unsigned(i)&&i<vertexCount),
 'INDICES','Expected valid indexed TRIANGLES');
 requireValid(uvSets&&Object.getPrototypeOf(uvSets)===Object.prototype,
  'UV_SETS','Expected keyed UV sets');
 const uvNames=Object.keys(uvSets).sort();
 for(const name of uvNames){
  requireValid(/^TEXCOORD_[0-9]+$/.test(name),'UV_NAME','Invalid UV semantic');
  validRows(uvSets[name],vertexCount,2,name);
 }
 if(normals!==null)validRows(normals,vertexCount,3,'NORMAL');
 // Stable per-input ID assignment: first glTF attribute row using each
 // exact Float32 position. Coincidence is only a *candidate* equivalence.
 const positionMap=new Map(),vertexToGeometric=[],groups=[];
 positions.forEach((position,attributeVertex)=>{
  const key=keyVec(position);
  if(!positionMap.has(key)){
   positionMap.set(key,groups.length);
   groups.push({geometricVertex:groups.length,attributeVertices:[]});
  }
  const geometric=positionMap.get(key);
  vertexToGeometric.push(geometric);
  groups[geometric].attributeVertices.push(attributeVertex);
 });
 const edges=new Map(),indexedEdges=new Set(),faceGeometry=new Set();
 const triangles=[],duplicateGeometricFaces=[];
 const cornerCount=indices.length,faceCount=cornerCount/3;
 for(let face=0;face<faceCount;face++){
  const vertices=[0,1,2].map(k=>indices[face*3+k]);
  const geometricVertices=vertices.map(v=>vertexToGeometric[v]);
  const corners=vertices.map((attributeVertex,k)=>({
   cornerId:face*3+k,face,localCorner:k,attributeVertex,
   geometricVertex:geometricVertices[k]
  }));
  const signature=[...geometricVertices].sort((a,b)=>a-b).join(':');
  if(faceGeometry.has(signature))duplicateGeometricFaces.push(face);
  else faceGeometry.add(signature);
  for(let k=0;k<3;k++){
   const k2=(k+1)%3,from=geometricVertices[k],to=geometricVertices[k2];
   const start=vertices[k],end=vertices[k2],edge=keyEdge(from,to);
   indexedEdges.add(keyEdge(start,end));
   if(!edges.has(edge))edges.set(edge,{geometricEdgeId:edge,
    geometricVertices:[Math.min(from,to),Math.max(from,to)],
    incidents:[]});
   edges.get(edge).incidents.push({face,
    corners:[face*3+k,face*3+k2],from,to,
    attributeVertices:[start,end]});
  }
  triangles.push({face,corners,geometricVertices});
 }
 const resultEdges=[],seamEdges=[],normalSplitEdges=[],nonManifoldEdges=[];
 const windingConflicts=[],boundaryEdges=[];
 for(const edge of edges.values()){
  const incidents=edge.incidents;
  const nonManifold=incidents.length>2;
  const windingConflict=incidents.length===2&&
   !(incidents[0].from===incidents[1].to&&
     incidents[0].to===incidents[1].from);
  // A shared "geometric edge" can have different attribute indices
  // at each endpoint. We compare by geometric endpoint, not edge order.
  const getRow=(incident,geometricVertex,rows)=>{
   const k=incident.from===geometricVertex?0:1;
   return rows[incident.attributeVertices[k]];
  };
  const splitUvSets=[];
  const vertexRowSplit=incidents.length===2&&edge.geometricVertices.some(v=>
   incidents[0].attributeVertices[
    incidents[0].from===v?0:1] !==
   incidents[1].attributeVertices[
    incidents[1].from===v?0:1]);
  if(incidents.length===2){
   for(const name of uvNames)if(edge.geometricVertices.some(v=>
    !equalsRow(getRow(incidents[0],v,uvSets[name]),
     getRow(incidents[1],v,uvSets[name]))))splitUvSets.push(name);
  }
  const normalSplit=normals!==null&&incidents.length===2&&
   edge.geometricVertices.some(v=>
    !equalsRow(getRow(incidents[0],v,normals),
     getRow(incidents[1],v,normals)));
  const item={
   geometricEdgeId:edge.geometricEdgeId,
   geometricVertices:edge.geometricVertices,
   incidents,
   boundary:incidents.length===1,nonManifold,windingConflict,
   splitAttributeVertices:vertexRowSplit,
   uvSeamSets:splitUvSets,normalSplit
  };
  resultEdges.push(item);
  if(item.boundary)boundaryEdges.push(item.geometricEdgeId);
  if(splitUvSets.length)seamEdges.push(item.geometricEdgeId);
  if(normalSplit)normalSplitEdges.push(item.geometricEdgeId);
  if(nonManifold)nonManifoldEdges.push(item.geometricEdgeId);
  if(windingConflict)windingConflicts.push(item.geometricEdgeId);
 }
 const splitGroups=groups.filter(g=>g.attributeVertices.length>1);
 const diagnostics={
  triangleCount:faceCount,attributeVertexCount:vertexCount,
  geometricVertexCandidates:groups.length,
  coincidentAttributeGroups:splitGroups.length,
  coincidentExtraAttributeRows:vertexCount-groups.length,
  indexedEdgeCount:indexedEdges.size,geometricEdgeCandidates:resultEdges.length,
  geometricBoundaryEdges:boundaryEdges.length,
  splitIndexEdges:resultEdges.filter(e=>e.splitAttributeVertices).length,
  uvSeamEdges:seamEdges.length,normalSplitEdges:normalSplitEdges.length,
  nonManifoldEdges:nonManifoldEdges.length,
  windingConflicts:windingConflicts.length,
  duplicateGeometricFaces:duplicateGeometricFaces.length,
  // Coincident positions can also represent deliberately distinct shells.
  // UI/import MUST NOT interpret candidates as safe automatic weld targets.
  positionJoinIsAuthoritative:false,
  editsAllowedFromThisMap:false,
  topologyProfile:'read-only exact-position candidates; indexed glTF TRIANGLES'
 };
 return{schema:'mark.corner-topology-analysis/1',diagnostics,
  geometricVertices:groups,attributeToGeometric:vertexToGeometric,
  corners:triangles.flatMap(t=>t.corners),triangles,edges:resultEdges,
  boundaryEdges,seamEdges,normalSplitEdges,nonManifoldEdges,
  windingConflicts,duplicateGeometricFaces,uvSets:uvNames};
}

function readAccessor(doc,bin,index){
 const acc=doc.accessors?.[index],view=doc.bufferViews?.[acc?.bufferView];
 requireValid(acc&&view&&view.buffer===0&&!acc.sparse,
  'ACCESSOR','Missing or sparse/external accessor');
 const components=TYPES[acc.type],type=COMPONENTS[acc.componentType];
 requireValid(components&&type&&unsigned(acc.count)&&acc.count<=3000000,
  'ACCESSOR_TYPE','Unsupported accessor shape or count');
 const [width,get,max]=type;
 const stride=view.byteStride??components*width;
 const offset=(view.byteOffset??0)+(acc.byteOffset??0);
 const viewEnd=(view.byteOffset??0)+view.byteLength;
 requireValid(unsigned(offset)&&offset%width===0&&stride>=width*components&&
  stride%width===0&&(!acc.count||
   offset+(acc.count-1)*stride+components*width<=Math.min(viewEnd,bin.length)),
 'ACCESSOR_RANGE','Accessor buffer range invalid');
 const dv=new DataView(bin.buffer,bin.byteOffset,bin.byteLength);
 const rows=Array.from({length:acc.count},(_,i)=>Array.from({length:components},(_,c)=>{
  const value=dv[get](offset+i*stride+c*width,true);
  return acc.normalized&&max!==null?value/max:value;
 }));
 return{rows,type:acc.type,componentType:acc.componentType,
  normalized:Boolean(acc.normalized)};
}
export function inspectGlbCornerTopology(bytes,{meshIndex=0,primitiveIndex=0}={}){
 requireValid(unsigned(meshIndex)&&unsigned(primitiveIndex),
  'TARGET','Expected valid mesh/primitive IDs');
 const parsed=parseGlb(bytes),doc=parsed.json;
 requireValid(!doc.extensionsRequired?.length,
  'EXTENSIONS','Required GLB extensions not supported in corner diagnostics');
 const bin=parsed.chunks.find(c=>c.type===0x004e4942)?.data;
 requireValid(bin,'BIN','Binary GLB chunk missing');
 const prim=doc.meshes?.[meshIndex]?.primitives?.[primitiveIndex];
 requireValid(prim&&(prim.mode??4)===4&&prim.indices!==undefined,
  'TRIANGLES','Indexed triangle primitive required');
 const position=readAccessor(doc,bin,prim.attributes?.POSITION);
 requireValid(position.type==='VEC3'&&position.componentType===5126,
  'POSITION_PROFILE','Float32 VEC3 POSITION required');
 const indices=readAccessor(doc,bin,prim.indices);
 requireValid(indices.type==='SCALAR'&&
  [5121,5123,5125].includes(indices.componentType)&&
  !indices.normalized,'INDEX_PROFILE','Unsigned SCALAR indices required');
 const uvSets={};
 for(const [semantic,accessor] of Object.entries(prim.attributes||{})){
  if(!/^TEXCOORD_[0-9]+$/.test(semantic))continue;
  const uv=readAccessor(doc,bin,accessor);
  requireValid(uv.type==='VEC2'&&
   (uv.componentType===5126||
    uv.normalized&&[5121,5123].includes(uv.componentType)),
   'UV_PROFILE','Unsupported UV accessor format');
  uvSets[semantic]=uv.rows;
 }
 let normals=null;
 if(prim.attributes.NORMAL!==undefined){
  const stream=readAccessor(doc,bin,prim.attributes.NORMAL);
  // Signed compressed glTF normals are a future import profile.
  if(stream.type==='VEC3'&&stream.componentType===5126)
   normals=stream.rows;
 }
 const topology=buildCornerTopology({positions:position.rows,
  indices:indices.rows.map(x=>x[0]),uvSets,normals});
 return{...topology,meshIndex,primitiveIndex,
  sourcePreserved:true,textureAndMorphBuffersUntouched:true};
}
