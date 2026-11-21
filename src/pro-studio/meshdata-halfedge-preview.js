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
 const pokes=operations.filter(op=>op.kind==='face.pokeLinkedCap'&&
  op.meshIndex===meshIndex&&op.primitiveIndex===primitiveIndex);
 const grandchild=operations.at(-1)?.kind==='edge.splitPokedCapGrandchild'?
  operations.at(-1):null;
 const daughterIndex=operations.findIndex(op=>op.kind==='edge.splitPokedCapChild'),
  daughter=daughterIndex<0?null:operations[daughterIndex];
 const daughterCount=Number(Boolean(daughter)),
  grandchildCount=Number(Boolean(grandchild));
 const firstPokeIndex=operations.findIndex(op=>op.kind==='face.pokeLinkedCap');
 const firstSplitIndex=operations.findIndex(op=>op.kind==='edge.splitPokedCap');
 const splits=operations.filter(op=>op.kind==='edge.splitPokedCap'&&
  op.meshIndex===meshIndex&&op.primitiveIndex===primitiveIndex);
 if(pokes.length)yes(Boolean(first)&&pokes.length<=8&&
  new Set(pokes.map(p=>p.sourceFace)).size===pokes.length&&
  operations.slice(firstPokeIndex,firstSplitIndex<0?
   operations.length:firstSplitIndex).every(op=>
   op.kind==='face.pokeLinkedCap')&&
  (firstSplitIndex<0||operations.slice(firstSplitIndex).every((op,i)=>
   op.kind==='edge.splitPokedCap'||
   op.kind==='edge.splitPokedCapChild'&&
    i===daughterIndex-firstSplitIndex||
   op.kind==='edge.splitPokedCapGrandchild'&&
    i===operations.length-firstSplitIndex-1)),
  'POKE_SEQUENCE','Source-distinct Pokes must precede all radial splits');
 yes(splits.length<=8&&
  new Set(splits.map(op=>op.sourceFace)).size===splits.length&&
  splits.every(op=>pokes.some(p=>p.sourceFace===op.sourceFace))&&
  (!daughter||splits.some(op=>
   op.sourceFace===daughter.sourceFace&&
   op.sourceVertex===daughter.sourceVertex))&&
  (!grandchild||daughter&&
   grandchild.sourceFace===daughter.sourceFace&&
   grandchild.sourceVertex===daughter.sourceVertex),
  'RADIAL_SEQUENCE','Each split needs a different approved Poke face');
 const wallEnd=edited.positions.length-pokes.length-splits.length-
  daughterCount-grandchildCount;
 const splitPoints=new Map(splits.map((split,i)=>{
  const vertex=wallEnd+pokes.length+i;
  const id='mark-radial-mid-'+namespace+'-f'+split.sourceFace+
   '-v'+split.sourceVertex;
  logical[vertex]=id;
  return[split.sourceFace,{attributeVertex:vertex,logicalVertexId:id,
   sourceFace:split.sourceFace,sourceVertex:split.sourceVertex}];
 }));
 const daughterAttributeVertex=daughter?
  wallEnd+pokes.length+splits.length:null;
 const daughterLogicalVertexId=daughter?
  'mark-radial-daughter-'+namespace+'-f'+daughter.sourceFace+
   '-v'+daughter.sourceVertex+'-depth1':null;
 if(daughter)logical[daughterAttributeVertex]=daughterLogicalVertexId;
 const grandchildAttributeVertex=grandchild?
  daughterAttributeVertex+1:null;
 const grandchildLogicalVertexId=grandchild?
  'mark-radial-grandchild-'+namespace+'-f'+grandchild.sourceFace+
  '-v'+grandchild.sourceVertex+'-depth2':null;
 if(grandchild)logical[grandchildAttributeVertex]=grandchildLogicalVertexId;
 const centers=new Map(pokes.map((poke,i)=>{
  const id='mark-poke-center-'+sourceSha256+'-m'+meshIndex+
   '-p'+primitiveIndex+'-f'+poke.sourceFace;
  logical[wallEnd+i]=id;
  return[poke.sourceFace,{id,attributeVertex:wallEnd+i,ordinal:i}];
 }));
 if(first){
  yes(operations[0]===first&&operations.every((op,i)=>i===0||
   (op.kind==='vertex.moveLinkedCap'&&
    (firstPokeIndex<0||i<firstPokeIndex)||
    op.kind==='face.pokeLinkedCap'&&i>=firstPokeIndex&&
     (firstSplitIndex<0||i<firstSplitIndex)||
    op.kind==='edge.splitPokedCap'&&i>=firstSplitIndex&&
     firstSplitIndex>=0||
    op.kind==='edge.splitPokedCapChild'&&i===daughterIndex||
    op.kind==='edge.splitPokedCapGrandchild'&&
     i===operations.length-1)&&
   op.meshIndex===meshIndex&&op.primitiveIndex===primitiveIndex),
  'OP_SEQUENCE','Source extrusion, stable moves and distinct terminal Pokes required');
  const consumed=inspectConsumedSeamExtrude(sourceGLB,{
   sourceSha256,operation:first});
  const sourceCount=source.positions.length;
  const capCount=consumed.capRemap.length,topStart=sourceCount+capCount;
  yes(wallEnd>=topStart&&
   (wallEnd-topStart)%4===0,'CAP_LAYOUT',
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
  for(let i=topStart;i<wallEnd;i+=4){
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
 const baseTriangleCount=first?originalFaces+
  2*(wallEnd-source.positions.length-capMap.length)/4:originalFaces;
 if(pokes.length)yes(edited.indices.length/3===
  baseTriangleCount+2*pokes.length+2*splits.length+
   2*daughterCount+2*grandchildCount,
  'POKE_LAYOUT','Each Poke and radial split must add exactly two triangles');
 const pokeFaceNames=new Set(pokes.map(p=>'cap-face-'+p.sourceFace));
 const faceNameFor=(f)=>{
  if(!first)return 'source-face-'+f;
  const selected=new Set(first.faces);
  const unselected=Array.from({length:originalFaces},(_,i)=>i)
   .filter(i=>!selected.has(i));
  if(f<unselected.length)return 'source-face-'+unselected[f];
  if(f<unselected.length+first.faces.length)
   return 'cap-face-'+[...first.faces].sort((a,b)=>a-b)[f-unselected.length];
  if(grandchild&&f>=baseTriangleCount+2*pokes.length+
    2*splits.length+2*daughterCount)
   return 'cap-radial-grandchild-face-'+grandchild.sourceFace+
    '-source-v'+grandchild.sourceVertex+'-depth2-child'+
    (f-(baseTriangleCount+2*pokes.length+
     2*splits.length+2*daughterCount)+1);
  if(daughter&&f>=baseTriangleCount+2*pokes.length+2*splits.length)
   return 'cap-radial-daughter-face-'+daughter.sourceFace+
    '-source-v'+daughter.sourceVertex+'-depth1-child'+
    (f-(baseTriangleCount+2*pokes.length+2*splits.length)+1);
  if(splits.length&&f>=baseTriangleCount+2*pokes.length){
   const index=f-(baseTriangleCount+2*pokes.length),
    split=splits[Math.floor(index/2)];
   yes(split,'RADIAL_CHILD','Split child exceeds approved operation log');
   return 'cap-radial-split-face-'+split.sourceFace+
    '-source-v'+split.sourceVertex+'-child'+(index%2+1);
  }
  if(f>=baseTriangleCount){
   const index=f-baseTriangleCount;
   const poke=pokes[Math.floor(index/2)];
   yes(poke,'POKE_INDEX','Unexpected new cap triangle outside command log');
   return 'cap-poke-face-'+poke.sourceFace+'-child'+(index%2+1);
  }
  const wall=f-unselected.length-first.faces.length;
  return 'wall-'+Math.floor(wall/2)+'-tri'+wall%2;
 };
 const radialAffected=new Map(),affectedBySource=new Map();
 for(const split of splits){
  const sourceFaceVertices=source.indices.slice(
   split.sourceFace*3,split.sourceFace*3+3);
  const capAttributeVertex=source.positions.length+
   capMap.findIndex(c=>c.sourceVertex===split.sourceVertex);
  const center=centers.get(split.sourceFace)?.attributeVertex,
   splitPoint=splitPoints.get(split.sourceFace);
  yes(sourceFaceVertices.includes(split.sourceVertex)&&
   capAttributeVertex>=source.positions.length&&
   center!==undefined&&splitPoint,
   'RADIAL_SOURCE','Split has no verified source face/cap radial endpoints');
  const affected=new Map(),descendantRows=daughter&&
   daughter.sourceFace===split.sourceFace&&
   daughter.sourceVertex===split.sourceVertex?
    [splitPoint.attributeVertex,daughterAttributeVertex,
     ...(grandchild?[grandchildAttributeVertex]:[])]:
    [splitPoint.attributeVertex];
  for(let f=0;f<baseTriangleCount+2*pokes.length;f++){
   const tri=edited.indices.slice(f*3,f*3+3),
    at=tri.findIndex(v=>descendantRows.includes(v));
   if(at>=0){
    const name=faceNameFor(f);
    yes(!radialAffected.has(name),'RADIAL_OVERLAP',
     'Independent source-face splits unexpectedly modified one triangle');
    const record={faceIndex:f,changedSlot:at,split};
    radialAffected.set(name,record);affected.set(name,record);
   }
  }
  yes(affected.size===2,'RADIAL_INCIDENCE',
   'Every radial split must modify exactly two original Poke triangles');
  const expected=new Set(['cap-face-'+split.sourceFace,
   'cap-poke-face-'+split.sourceFace+'-child1',
   'cap-poke-face-'+split.sourceFace+'-child2']);
  yes([...affected.keys()].every(name=>expected.has(name)),
   'RADIAL_FACE_PROFILE','Radial split cannot modify another cap or wall');
  affectedBySource.set(split.sourceFace,affected);
 }
 const daughterAffected=new Map();
 if(daughter){
  for(let f=0;f<baseTriangleCount+2*pokes.length+2*splits.length;f++){
   const tri=edited.indices.slice(f*3,f*3+3),
    slot=tri.findIndex(v=>v===daughterAttributeVertex||
     grandchild&&v===grandchildAttributeVertex);
   if(slot>=0){
    const name=faceNameFor(f);
    daughterAffected.set(name,{faceIndex:f,changedSlot:slot});
   }
  }
  yes(daughterAffected.size===2,'DAUGHTER_INCIDENCE',
   'Daughter edge must modify exactly two previous cap triangles');
  yes([...daughterAffected.keys()].every(name=>
   name==='cap-face-'+daughter.sourceFace||
   name.startsWith('cap-poke-face-'+daughter.sourceFace+'-')||
   name.startsWith('cap-radial-split-face-'+daughter.sourceFace+'-')),
   'DAUGHTER_SOURCE','Child may not modify an unrelated cap or wall');
 }
 const grandchildAffected=new Map();
 if(grandchild){
  const priorFaceCount=baseTriangleCount+2*pokes.length+
   2*splits.length+2*daughterCount;
  for(let f=0;f<priorFaceCount;f++){
   const tri=edited.indices.slice(f*3,f*3+3),
    slot=tri.indexOf(grandchildAttributeVertex);
   if(slot>=0){
    const name=faceNameFor(f);
    grandchildAffected.set(name,{faceIndex:f,changedSlot:slot});
   }
  }
  yes(grandchildAffected.size===2,'GRANDCHILD_INCIDENCE',
   'Depth-two split must affect exactly two parent triangles');
  yes([...grandchildAffected.keys()].every(name=>
   name==='cap-face-'+grandchild.sourceFace||
   name.startsWith('cap-poke-face-'+grandchild.sourceFace+'-')||
   name.startsWith('cap-radial-split-face-'+grandchild.sourceFace+'-')||
   name.startsWith('cap-radial-daughter-face-'+grandchild.sourceFace+'-')),
   'GRANDCHILD_SOURCE','Depth-two edit escaped approved cap');
 }
 const faceIdFor=name=>'mark-face-'+namespace+'-'+name;
 const halfedgeIdFor=(name,k)=>{
  const suffix=pokeFaceNames.has(name)&&k!==0?
   '-poke-k'+k:'-k'+k;
  const affected=radialAffected.get(name);
  const changed=affected&&(k===affected.changedSlot||
   k===(affected.changedSlot+2)%3);
  const downstream=daughterAffected.get(name),
   altered=downstream&&(k===downstream.changedSlot||
    k===(downstream.changedSlot+2)%3);
  return 'mark-halfedge-'+faceIdFor(name)+suffix+
   (changed?'-radial':'')+(altered?'-daughter':'')+
   (grandchildAffected.get(name)&&
    (k===grandchildAffected.get(name).changedSlot||
     k===(grandchildAffected.get(name).changedSlot+2)%3)?
     '-grandchild':'');
 };
 const cornerIdFor=(name,k)=>{
  const suffix=pokeFaceNames.has(name)&&k===2?
   '-poke-center':'-k'+k;
  const changed=radialAffected.get(name)?.changedSlot===k;
  const altered=daughterAffected.get(name)?.changedSlot===k;
  return 'mark-corner-'+faceIdFor(name)+suffix+
   (changed?'-radial':'')+(altered?'-daughter':'')+
   (grandchildAffected.get(name)?.changedSlot===k?'-grandchild':'');
 };
 const topologyRemaps=pokes.map(poke=>{
  const name='cap-face-'+poke.sourceFace,center=centers.get(poke.sourceFace);
  return{
   schema:'mark.cap-poke-remap/1',sourceFace:poke.sourceFace,
   originalFaceId:faceIdFor(name),
   createdFaceIds:[1,2].map(i=>faceIdFor(
    'cap-poke-face-'+poke.sourceFace+'-child'+i)),
   centerAttributeVertex:center.attributeVertex,
   centerLogicalVertexId:center.id,
   retainedCornerIds:[0,1].map(i=>cornerIdFor(name,i)),
   invalidatedCornerIds:['mark-corner-'+faceIdFor(name)+'-k2'],
   invalidatedHalfedgeIds:[1,2].map(i=>
    'mark-halfedge-'+faceIdFor(name)+'-k'+i),
   preservedSourceCapAndWallAttributeRows:true,
   futureUnvalidatedTopologyEditsBlocked:true
  };
 });
 // Backward compatible summary of most recent Poke; full provenance and
 // deterministic IDs for every executed operation live in topologyRemaps.
 const topologyRemap=topologyRemaps.at(-1)||null;
 const baseHalfedgeId=(name,k)=>'mark-halfedge-'+faceIdFor(name)+
  (pokeFaceNames.has(name)&&k!==0?'-poke-k'+k:'-k'+k);
 const baseCornerId=(name,k)=>'mark-corner-'+faceIdFor(name)+
  (pokeFaceNames.has(name)&&k===2?'-poke-center':'-k'+k);
 const edgeSplitRemaps=splits.map(split=>{
  const point=splitPoints.get(split.sourceFace),
   parent=affectedBySource.get(split.sourceFace),
   selectedCapRow=source.positions.length+capMap.findIndex(
    c=>c.sourceVertex===split.sourceVertex),
   radialCenter=centers.get(split.sourceFace).attributeVertex;
  return{
   schema:'mark.radial-cap-edge-split/1',
   sourceFace:split.sourceFace,sourceVertex:split.sourceVertex,
   newAttributeVertex:point.attributeVertex,
   newLogicalVertexId:point.logicalVertexId,
   sourceEdgeId:'mark-edge-'+namespace+'-'+normKey(
    logical[selectedCapRow],logical[radialCenter]),
   modifiedFaceIds:[...parent.keys()].map(faceIdFor),
   newFaceIds:[1,2].map(i=>faceIdFor('cap-radial-split-face-'+
    split.sourceFace+'-source-v'+split.sourceVertex+'-child'+i)),
   invalidatedCornerIds:[...parent].map(([name,v])=>
    baseCornerId(name,v.changedSlot)),
   invalidatedHalfedgeIds:[...parent].flatMap(([name,v])=>
    [baseHalfedgeId(name,v.changedSlot),
     baseHalfedgeId(name,(v.changedSlot+2)%3)]),
   createdEdgeIds:[],stableAcrossUnrelatedCapPokes:true,
   laterTopologyEditsBlocked:true
  };
 });
 const edgeSplitRemap=edgeSplitRemaps.at(-1)||null;
 const priorHalfedgeId=(name,k)=>{
  const suffix=pokeFaceNames.has(name)&&k!==0?'-poke-k'+k:'-k'+k;
  const r=radialAffected.get(name);
  const changed=r&&(k===r.changedSlot||k===(r.changedSlot+2)%3);
  return 'mark-halfedge-'+faceIdFor(name)+suffix+(changed?'-radial':'');
 };
 const priorCornerId=(name,k)=>{
  const suffix=pokeFaceNames.has(name)&&k===2?'-poke-center':'-k'+k;
  return 'mark-corner-'+faceIdFor(name)+suffix+
   (radialAffected.get(name)?.changedSlot===k?'-radial':'');
 };
 const parentSplit=daughter?splits.find(op=>
  op.sourceFace===daughter.sourceFace&&
  op.sourceVertex===daughter.sourceVertex):null;
 const parentMidpoint=parentSplit?
  splitPoints.get(parentSplit.sourceFace)?.logicalVertexId:null;
 const parentCapId=daughter?capMap.find(cap=>
  cap.sourceVertex===daughter.sourceVertex)?.logicalVertexId:null;
 const daughterRemap=daughter?{
  schema:'mark.radial-daughter-split-remap/1',
  sourceFace:daughter.sourceFace,sourceVertex:daughter.sourceVertex,
  generation:1,parentSplitNewLogicalVertexId:parentMidpoint,
  parentEdgeId:'mark-edge-'+namespace+'-'+normKey(parentCapId,parentMidpoint),
  newAttributeVertex:daughterAttributeVertex,
  newLogicalVertexId:daughterLogicalVertexId,
  modifiedFaceIds:[...daughterAffected.keys()].map(faceIdFor),
  newFaceIds:[1,2].map(i=>faceIdFor(
   'cap-radial-daughter-face-'+daughter.sourceFace+
   '-source-v'+daughter.sourceVertex+'-depth1-child'+i)),
  invalidatedCornerIds:[...daughterAffected].map(([name,v])=>
   priorCornerId(name,v.changedSlot)),
  invalidatedHalfedgeIds:[...daughterAffected].flatMap(([name,v])=>
   [priorHalfedgeId(name,v.changedSlot),
    priorHalfedgeId(name,(v.changedSlot+2)%3)]),
  createdEdgeIds:[],
  parentEdgeLineage:'source cap -> primary radial midpoint -> daughter midpoint',
  furtherDaughterEditsBlocked:true
 }:null;
 const beforeGrandchildHalfedge=(name,k)=>{
  const suffix=pokeFaceNames.has(name)&&k!==0?'-poke-k'+k:'-k'+k;
  const affected=radialAffected.get(name);
  const primary=affected&&(k===affected.changedSlot||
   k===(affected.changedSlot+2)%3);
  const down=daughterAffected.get(name);
  const secondary=down&&(k===down.changedSlot||
   k===(down.changedSlot+2)%3);
  return 'mark-halfedge-'+faceIdFor(name)+suffix+
   (primary?'-radial':'')+(secondary?'-daughter':'');
 };
 const beforeGrandchildCorner=(name,k)=>{
  const suffix=pokeFaceNames.has(name)&&k===2?'-poke-center':'-k'+k;
  return 'mark-corner-'+faceIdFor(name)+suffix+
   (radialAffected.get(name)?.changedSlot===k?'-radial':'')+
   (daughterAffected.get(name)?.changedSlot===k?'-daughter':'');
 };
 const grandchildRemap=grandchild?{
  schema:'mark.radial-grandchild-split-remap/1',
  generation:2,sourceFace:grandchild.sourceFace,
  sourceVertex:grandchild.sourceVertex,
  parentSplitNewLogicalVertexId:daughterLogicalVertexId,
  parentEdgeId:'mark-edge-'+namespace+'-'+normKey(
   parentCapId,daughterLogicalVertexId),
  newAttributeVertex:grandchildAttributeVertex,
  newLogicalVertexId:grandchildLogicalVertexId,
  modifiedFaceIds:[...grandchildAffected.keys()].map(faceIdFor),
  newFaceIds:[1,2].map(i=>faceIdFor(
   'cap-radial-grandchild-face-'+grandchild.sourceFace+
   '-source-v'+grandchild.sourceVertex+'-depth2-child'+i)),
  invalidatedCornerIds:[...grandchildAffected].map(([name,v])=>
   beforeGrandchildCorner(name,v.changedSlot)),
  invalidatedHalfedgeIds:[...grandchildAffected].flatMap(([name,v])=>
   [beforeGrandchildHalfedge(name,v.changedSlot),
    beforeGrandchildHalfedge(name,(v.changedSlot+2)%3)]),
  createdEdgeIds:[],
  ancestors:[daughterRemap.parentEdgeId,
   'mark-edge-'+namespace+'-'+normKey(parentCapId,daughterLogicalVertexId)],
  futureUnvalidatedEditsBlocked:true
 }:null;
 const capSources=new Set(first?.faces||[]);
 const nonSelected=Array.from({length:originalFaces},(_,i)=>i)
  .filter(i=>!capSources.has(i));
 for(let f=0;f<edited.indices.length/3;f++){
  const name=faceNameFor(f);
  const faceId=faceIdFor(name),
   verts=edited.indices.slice(f*3,f*3+3),
   cornerIds=[];
  for(let k=0;k<3;k++){
   const index=f*3+k,attrVertex=verts[k],
    nextAttr=verts[(k+1)%3],logicalVertex=logical[attrVertex],
    logicalNext=logical[nextAttr];
   const cornerId=cornerIdFor(name,k),
    edgeId='mark-edge-'+namespace+'-'+normKey(logicalVertex,logicalNext),
    edgeHalfedgeId=halfedgeIdFor(name,k);
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
    next:halfedgeIdFor(name,(k+1)%3),
    prev:halfedgeIdFor(name,(k+2)%3),
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
 const byHalfedge=new Map(halfedges.map(h=>[h.id,h]));
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
     y=byCorner.get(byHalfedge.get(b.next)?.cornerId)
      ?.attributes.uvSets[uvName];
    if(y&&x.some((v,k)=>v!==y[k]))uvs.push(uvName);
   }
  }
  if(uvs.length)uvSeamEdges.push(id);
  edges.push({id,halfedgeIds:list.map(h=>h.id),
   boundary:list.length===1,nonManifold:list.length>2,
   windingConflict:badWinding.includes(id),uvSeamSets:uvs});
 }
 for(const remap of edgeSplitRemaps){
  if(daughter&&remap.sourceFace===daughter.sourceFace&&
   remap.sourceVertex===daughter.sourceVertex){
   // Historical creation journal: the primary cap->midpoint edge is
   // removed by its daughter. Reconstruct the PRIMARY graph edge IDs
   // rather than incorrectly rewriting history with current edges.
   const src=source.indices.slice(remap.sourceFace*3,remap.sourceFace*3+3);
   const endpoints=[
    ...src.map(v=>capMap.find(c=>c.sourceVertex===v)?.logicalVertexId),
    centers.get(remap.sourceFace)?.id
   ];
   yes(endpoints.every(Boolean),'DAUGHTER_LINEAGE','Incomplete primary remap');
   remap.createdEdgeIds=[...new Set(endpoints.map(id=>
    'mark-edge-'+namespace+'-'+normKey(id,remap.newLogicalVertexId)))].sort();
  }else remap.createdEdgeIds=edges.filter(edge=>
   edge.id.includes(remap.newLogicalVertexId)).map(edge=>edge.id).sort();
  yes(remap.createdEdgeIds.length>=3&&
   !edges.some(e=>e.id===remap.sourceEdgeId),
   'RADIAL_GRAPH','Old radial edge must be replaced by verified child edges');
 }
 if(daughterRemap){
  daughterRemap.createdEdgeIds=edges.filter(edge=>
   edge.id.includes(daughterRemap.newLogicalVertexId)&&
   (!grandchild||!edge.id.includes(grandchildLogicalVertexId)))
    .map(edge=>edge.id);
  if(grandchild)daughterRemap.createdEdgeIds.push(
   grandchildRemap.parentEdgeId);
  daughterRemap.createdEdgeIds=[...new Set(daughterRemap.createdEdgeIds)].sort();
  yes(daughterRemap.createdEdgeIds.length>=3&&
   !edges.some(e=>e.id===daughterRemap.parentEdgeId),
   'DAUGHTER_GRAPH','Historical daughter edge IDs must survive the next split');
 }
 if(grandchildRemap){
  grandchildRemap.createdEdgeIds=edges.filter(edge=>
   edge.id.includes(grandchildLogicalVertexId)).map(edge=>edge.id).sort();
  yes(grandchildRemap.createdEdgeIds.length>=3&&
   !edges.some(e=>e.id===grandchildRemap.parentEdgeId),
   'GRANDCHILD_GRAPH','Depth-two midpoint must replace its parent edge');
 }
 return{
  schema:'mark.meshdata-halfedge-preview/1',
  sourceSha256,meshIndex,primitiveIndex,
  profile:'indexed TRIANGLES + explicit source-approved UV seam remap',
  losslessToOriginalGLB:false,
  persistedAs:'deterministic reconstruction from source GLB and native typed edit log',
  stableIdScope:'source hash + mesh/primitive + immutable topology + logical-cap moves',
  faces,edges,halfedges,corners,materialSlots,uvSets,colorSets,
  capMap,mappedWalls,topologyRemap,topologyRemaps,
  edgeSplitRemap,edgeSplitRemaps,daughterRemap,grandchildRemap,
  descendantRemaps:[daughterRemap,grandchildRemap].filter(Boolean),
  diagnostics:{triangleCount:faces.length,cornerCount:corners.length,
   halfedgeCount:halfedges.length,edgeCount:edges.length,
   boundaryEdges:boundaries.length,nonManifoldEdges:nonManifold.length,
   windingConflicts:badWinding.length,uvDiscontinuityEdges:uvSeamEdges.length,
   capAttributeRows:capMap.length,
   linkedCapMoveCount:operations.filter(x=>x.kind==='vertex.moveLinkedCap').length,
   capPokeCount:pokes.length,
   radialSplitCount:splits.length,
   daughterSplitCount:daughterCount+grandchildCount,
   deepestSplitGeneration:daughterCount+grandchildCount,
   createdLogicalVertices:pokes.length+splits.length+
    daughterCount+grandchildCount,
   topologyRemapAvailable:Boolean(topologyRemap),
   proceduralHalfedgeReconstruction:true,editableOnlyViaBoundedCapMove:true,
   fullyWeldedGLB:false},
  boundaryEdgeIds:boundaries,nonManifoldEdgeIds:nonManifold,
  windingConflictIds:badWinding,uvSeamEdgeIds:uvSeamEdges
 };
}
