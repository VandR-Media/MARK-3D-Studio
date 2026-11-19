/**
 * Pass 16 — explicit, reversible, source-bound glTF attribute-row links.
 *
 * A link is a USER-APPROVED logical seam equivalence. It never welds glTF
 * vertices or changes POSITION, UV, JOINTS, morphs, indices or BIN bytes.
 * Stable IDs are scoped to immutable source SHA256 + mesh/primitive/index.
 * Topology-changing mesh operations are deliberately blocked while links
 * exist in the affected primitive: remapping is not implemented yet.
 */
import {parseGlb} from '../glb.js';
import {analyzeIndexedFaceRegion} from './topology-selection.js';
const nope=(code,msg)=>{const error=Error('MARK_SEAM_'+code+': '+msg);
 error.code='SEAM_'+code;throw error;};
const ok=(x,code,msg)=>{if(!x)nope(code,msg);};
const nat=x=>Number.isSafeInteger(x)&&x>=0;
const same=(a,b)=>a.length===b.length&&a.every((x,i)=>x===b[i]);
const TYPES={SCALAR:1,VEC2:2,VEC3:3,VEC4:4};
const COMP={5121:[1,'getUint8'],5123:[2,'getUint16'],
 5125:[4,'getUint32'],5126:[4,'getFloat32']};
const disallowed=new Set(['vertex.move','vertex.snap','edge.split',
 'face.flip','face.delete','face.extrude','face.regionExtrude','primitive.add']);
function reader(bytes){
 const parsed=parseGlb(bytes),doc=parsed.json;
 ok(!doc.extensionsRequired?.length,'EXTENSIONS','Required glTF extensions unsupported');
 const bin=parsed.chunks.find(c=>c.type===0x004e4942)?.data;
 ok(bin&&doc.buffers?.length===1,'BIN','Single embedded GLB BIN required');
 const dv=new DataView(bin.buffer,bin.byteOffset,bin.byteLength);
 const accessor=index=>{
  const a=doc.accessors?.[index],v=doc.bufferViews?.[a?.bufferView];
  ok(a&&v&&!a.sparse&&v.buffer===0,'ACCESSOR','Unsupported sparse/external accessor');
  const n=TYPES[a.type],comp=COMP[a.componentType];
  ok(n&&comp&&nat(a.count)&&a.count<=3000000,'TYPE','Unsupported accessor type/count');
  const [width,get]=comp,offset=(v.byteOffset||0)+(a.byteOffset||0),
   stride=v.byteStride??n*width;
  ok(offset%width===0&&stride%width===0&&stride>=n*width&&
   offset+(a.count?(a.count-1)*stride+n*width:0)<=
   Math.min((v.byteOffset||0)+v.byteLength,bin.length),
   'ACCESSOR_RANGE','Accessor exceeds bufferView bounds');
  return {type:a.type,componentType:a.componentType,rows:
   Array.from({length:a.count},(_,i)=>Array.from({length:n},
    (_,k)=>dv[get](offset+i*stride+k*width,true)))};
 };
 return{doc,accessor};
}
const addr=link=>link.meshIndex+':'+link.primitiveIndex;
const cmp=(a,b)=>a.meshIndex-b.meshIndex||
 a.primitiveIndex-b.primitiveIndex||a.vertexA-b.vertexA||a.vertexB-b.vertexB;
function target(doc,meshIndex,primitiveIndex){
 const prim=doc.meshes?.[meshIndex]?.primitives?.[primitiveIndex];
 ok(prim&&(prim.mode??4)===4&&prim.indices!==undefined&&
  prim.attributes?.POSITION!==undefined,'TARGET','Expected indexed source TRIANGLES');
 return prim;
}
const opChangesTarget=(op,meshIndex,primitiveIndex)=>
 disallowed.has(op.kind)&&
 (op.kind==='primitive.add'||op.meshIndex===meshIndex&&
  op.primitiveIndex===primitiveIndex);
export function normalizeExplicitSeamLinks(sourceGLB,links=[],operations=[]){
 ok(Array.isArray(links)&&links.length<=64,
  'LINK_BUDGET','No more than 64 source seam links');
 ok(Array.isArray(operations),'OPERATION_PROFILE','Expected mesh edit log');
 const {doc,accessor}=reader(sourceGLB),canonical=[],seen=new Set();
 const cache=new Map();
 for(const raw of links){
  ok(raw&&Object.getPrototypeOf(raw)===Object.prototype&&
   Object.keys(raw).length===4&&
   ['meshIndex','primitiveIndex','vertexA','vertexB']
    .every(k=>Object.hasOwn(raw,k)&&nat(raw[k])),
   'LINK_SCHEMA','Unexpected seam link fields/indices');
  const {meshIndex,primitiveIndex}=raw;
  ok(raw.vertexA!==raw.vertexB,'IDENTICAL','Cannot link an index to itself');
  const vertexA=Math.min(raw.vertexA,raw.vertexB),
   vertexB=Math.max(raw.vertexA,raw.vertexB);
  const link={meshIndex,primitiveIndex,vertexA,vertexB};
  const key=addr(link)+':'+vertexA+':'+vertexB;
  ok(!seen.has(key),'DUPLICATE','Duplicate seam correspondence');
  seen.add(key);
  ok(!operations.some(op=>opChangesTarget(op,meshIndex,primitiveIndex)),
   'TOPOLOGY_REVISION',
   'Seam links require unchanged source vertex indices for this primitive');
  const location=addr(link);
  if(!cache.has(location)){
   const prim=target(doc,meshIndex,primitiveIndex);
   const pos=accessor(prim.attributes.POSITION);
   ok(pos.type==='VEC3'&&pos.componentType===5126,
    'POSITION_PROFILE','Float32 VEC3 POSITION required');
   const idx=accessor(prim.indices);
   ok(idx.type==='SCALAR'&&[5121,5123,5125].includes(idx.componentType),
    'INDEX_PROFILE','Unsigned indices required');
   const used=new Set(idx.rows.map(r=>r[0]));
   const deformation=[];
   for(const [semantic,index] of Object.entries(prim.attributes)){
    if(/^JOINTS_[0-9]+$|^WEIGHTS_[0-9]+$/.test(semantic))
     deformation.push([semantic,accessor(index)]);
   }
   for(let i=0;i<(prim.targets||[]).length;i++)
    for(const [semantic,index] of Object.entries(prim.targets[i])){
     // NORMAL/TANGENT morphs are corner-split attributes, not geometric
     // position deformations; only POSITION deltas must agree.
     if(semantic==='POSITION')deformation.push(['MORPH_POSITION_'+i,accessor(index)]);
   }
   cache.set(location,{prim,pos,used,deformation,indices:idx.rows.map(x=>x[0])});
  }
  const {pos,used,deformation}=cache.get(location);
  ok(vertexB<pos.rows.length&&used.has(vertexA)&&used.has(vertexB),
   'VERTEX_RANGE','Both linked source rows must be used by triangles');
  ok(same(pos.rows[vertexA],pos.rows[vertexB]),
   'POSITION_MISMATCH','Explicit link requires identical source XYZ');
  for(const [semantic,stream] of deformation){
   ok(stream.rows.length===pos.rows.length,
    'DEFORM_PROFILE','Inconsistent '+semantic+' attribute count');
   ok(same(stream.rows[vertexA],stream.rows[vertexB]),
    'DEFORM_MISMATCH','Linked rows have different '+semantic+
    '; future skin/morph deformation would split their positions');
  }
  canonical.push(link);
 }
 canonical.sort(cmp);
 // Prevent explicit links from manufacturing degenerate triangles or
 // non-manifold edges. An unlinked source may have such defects already;
 // for linked source primitives, refuse to certify new ambiguous joins.
 for(const [location,{pos,indices}] of cache){
  const scoped=canonical.filter(x=>addr(x)===location);
  const roots=rootsFor(pos.rows.length,scoped);
  const mapped=indices.map(i=>roots[i]);
  for(let f=0;f<mapped.length;f+=3)
   ok(new Set(mapped.slice(f,f+3)).size===3,'DEGENERATE',
    'Link collapses an original triangle');
  const edges=new Map();
  for(let f=0;f<mapped.length;f+=3)
   for(let k=0;k<3;k++){
    const a=mapped[f+k],b=mapped[f+(k+1)%3],
     key=Math.min(a,b)+':'+Math.max(a,b),
     list=edges.get(key)||[];
    list.push({a,b});edges.set(key,list);
   }
  for(const list of edges.values()){
   ok(list.length<=2,'NONMANIFOLD',
    'Approved links would create an edge with >2 triangles');
   if(list.length===2)ok(list[0].a===list[1].b&&
    list[0].b===list[1].a,'WINDING',
    'Approved seam edges require opposing directed triangle edges');
  }
 }
 return canonical;
}
function rootsFor(n,links){
 const parents=Array.from({length:n},(_,i)=>i);
 const find=x=>{while(parents[x]!==x)x=parents[x];return x;};
 for(const l of links){
  const a=find(l.vertexA),b=find(l.vertexB);
  if(a!==b)parents[Math.max(a,b)]=Math.min(a,b);
 }
 return parents.map((_,i)=>find(i));
}
export function inspectExplicitSeamTopology(sourceGLB,{
 meshIndex=0,primitiveIndex=0,sourceSha256,links=[],operations=[],
 faces=null
}={}){
 ok(nat(meshIndex)&&nat(primitiveIndex),'TARGET','Invalid mesh target');
 ok(typeof sourceSha256==='string'&&/^[a-f0-9]{64}$/.test(sourceSha256),
  'SOURCE_HASH','Stable IDs require verified original source SHA-256');
 const normalized=normalizeExplicitSeamLinks(sourceGLB,links,operations);
 const {doc,accessor}=reader(sourceGLB),prim=target(doc,meshIndex,primitiveIndex);
 const pos=accessor(prim.attributes.POSITION);
 const idx=accessor(prim.indices),ind=idx.rows.map(x=>x[0]);
 const scoped=normalized.filter(x=>x.meshIndex===meshIndex&&
  x.primitiveIndex===primitiveIndex);
 const roots=rootsFor(pos.rows.length,scoped);
 const stableId=i=>'mark-logical-vertex-'+sourceSha256+'-m'+meshIndex+
  '-p'+primitiveIndex+'-v'+i;
 const ids=roots.map(stableId);
 const mapped=ind.map(i=>roots[i]);
 const localEdges=new Set();
 for(let f=0;f<mapped.length;f+=3)
  for(let k=0;k<3;k++){
   const a=mapped[f+k],b=mapped[f+(k+1)%3];
   localEdges.add([Math.min(a,b),Math.max(a,b)].join(':'));
  }
 const stableEdgeId=(a,b)=>'mark-logical-edge-'+sourceSha256+
  '-m'+meshIndex+'-p'+primitiveIndex+'-e'+a+'-'+b;
 const selected=faces===null?null:analyzeIndexedFaceRegion({
  indices:mapped,vertexCount:pos.rows.length,faces
 });
 return{
  schema:'mark.explicit-seam-identity/1',
  scope:'source-hash + mesh/primitive + glTF source attribute row IDs',
  sourceSha256,meshIndex,primitiveIndex,linkCount:scoped.length,
  attributeVertexCount:pos.rows.length,
  logicalVertexCount:new Set(roots).size,
  logicalEdgeCount:localEdges.size,
  autoWeld:false,editsAllowedViaLinks:false,
  stableIdsValidForTopologyMutations:false,
  links:scoped.map(x=>({...x})),
  stableVertexIdSample:ids.slice(0,16),
  stableEdgeIdSample:[...localEdges].sort().slice(0,16)
   .map(key=>{const [a,b]=key.split(':').map(Number);return stableEdgeId(a,b);}),
  ...(selected?{selection:{
   ...selected.diagnostics,
   faces:selected.faces,
   boundaryEdgeCount:selected.diagnostics.boundaryEdges,
   boundaryEdges:selected.boundaryEdges.map(e=>[stableId(e.from),stableId(e.to)])
  }}:{})
 };
}
