/**
 * Pass30 foundation: validated, deterministic *plan* for splitting a source edge.
 * This is NOT a mutation of MARKTOP1, MeshData, .markscene or glTF.
 * The interpolated vertex must later be materialized per attribute stream,
 * including UV, JOINTS/WEIGHTS, morph deltas, tangents and normals.
 */
import {previewOwnedTopology} from './owned-topology-binary.js';

const fail=(code,message)=>{const e=new Error('MARK_SPLIT_'+code+': '+message);e.code='SPLIT_'+code;throw e;};
const requireThat=(value,code,message)=>{if(!value)fail(code,message);};
const fraction=x=>typeof x==='number'&&Number.isFinite(x)&&x>0&&x<1;
const vertexRow=id=>{
 const m=/-v([0-9]+)$/.exec(id);
 requireThat(m,'VERTEX_ID','Malformed source vertex ID');
 return Number(m[1]);
};

/**
 * Creates a read-only triangle connectivity delta.
 * Existing source faces retain an explicit provenance link; their children
 * and the inserted vertex have deterministic IDs scoped to edgeId + t.
 * No attributes are guessed or fabricated. For split-UV boundaries each
 * incident face needs a distinct corner interpolation at materialization.
 */
export function planOwnedEdgeSplit({
 sourceGLB,sourceSha256,data,edgeId,t=0.5
}={}){
 requireThat(fraction(t),'FRACTION','Split fraction must be strictly between zero and one');
 requireThat(typeof edgeId==='string'&&edgeId.length<180,
  'EDGE_ID','Exact source edge ID required');
 const graph=previewOwnedTopology({sourceGLB,sourceSha256,data});
 const edge=graph.edges.find(x=>x.id===edgeId);
 requireThat(edge,'EDGE_STALE','Edge does not belong to verified source topology');
 requireThat(edge.halfedgeIds.length===1||edge.halfedgeIds.length===2,
  'MANIFOLD','Only one or two incident source triangles supported');
 const sourceFaces=new Map(graph.faces.map(f=>[f.id,f]));
 const sourceHalfedges=new Map(graph.halfedges.map(h=>[h.id,h]));
 const affected=new Map();
 for(const hid of edge.halfedgeIds){
  const he=sourceHalfedges.get(hid);
  requireThat(he&&sourceFaces.has(he.faceId),'HALFEDGE','Broken face reference');
  const face=sourceFaces.get(he.faceId);
  const corners=face.halfedgeIds.map(id=>sourceHalfedges.get(id));
  requireThat(corners.every(Boolean),'FACE','Missing source face corners');
  const rows=corners.map(h=>vertexRow(h.origin));
  const [a,b]=edge.sourceRows;
  const i=rows.findIndex((v,k)=>
   (v===a&&rows[(k+1)%3]===b)||(v===b&&rows[(k+1)%3]===a));
  requireThat(i>=0,'FACE_EDGE','Source face does not contain the target edge');
  requireThat(!affected.has(face.id),'FACE_DUP','Repeated incident face');
  // Oriented triangle (u, v, w) -> (u, inserted, w), (inserted, v, w).
  const u=rows[i],v=rows[(i+1)%3],w=rows[(i+2)%3];
  affected.set(face.id,{sourceFaceId:face.id,sourceFace:face.sourceFace,
   orientedEdge:[u,v],oppositeSourceRow:w,sourceRows:rows,
   childIndices:[[u,null,w],[null,v,w]],
   // Per-face corner attributes must be interpolated with orientation:
   // t is always measured from canonical edge.sourceRows[0] to [1].
   cornerInterpolation:{sourceRows:[a,b],weights:[1-t,t]},
   childIds:[face.id+'-split-0',face.id+'-split-1']});
 }
 requireThat(affected.size===edge.halfedgeIds.length,
  'COUNT','Incident faces were not unique');
 const token=t.toString().replace('.','_');
 const newVertexId=edge.id+'-split-t'+token;
 const children=[...affected.values()].sort((a,b)=>a.sourceFace-b.sourceFace)
  .map(f=>({...f,childIndices:f.childIndices.map(tri=>
   tri.map(v=>v===null?newVertexId:v))}));
 return Object.freeze({
  schema:'mark.owned-edge-split-plan/1',sourceSha256,
  meshIndex:graph.meshIndex,primitiveIndex:graph.primitiveIndex,
  edgeId,t,newVertexId,sourceRows:[...edge.sourceRows],
  boundary:edge.boundary,sourceFaceCount:graph.faces.length,
  resultingFaceCount:graph.faces.length+children.length,
  children,unaffectedSourceFaceIds:graph.faces
   .filter(f=>!affected.has(f.id)).map(f=>f.id),
  changesSourceTopology:true,applied:false,
  requiresMaterialization:[
   'POSITION','TEXCOORD_n','NORMAL','TANGENT','JOINTS_n',
   'WEIGHTS_n','morph targets','indices','owned topology','native replay'
  ]
 });
}
