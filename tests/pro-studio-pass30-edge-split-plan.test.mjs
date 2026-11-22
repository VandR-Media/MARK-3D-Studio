import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {parseGlb,writeGlb} from '../src/glb.js';
import {buildSkinnedSeamFixture} from '../scripts/pro-studio-pass17-skinned-seam-fixture.mjs';
import {buildOwnedTopologyBinary,previewOwnedTopology} from '../src/pro-studio/owned-topology-binary.js';
import {planOwnedEdgeSplit} from '../src/pro-studio/owned-edge-split-plan.js';

const sha=x=>createHash('sha256').update(Buffer.from(x)).digest('hex');
const source=buildSkinnedSeamFixture();
const original=parseGlb(source);
const primitive=original.json.meshes[0].primitives[0];
const accessor=original.json.accessors[primitive.indices];
const view=original.json.bufferViews[accessor.bufferView];
const chunk=original.chunks.find(c=>c.type===0x004e4942);
function shared(){
 const bytes=chunk.data.slice(),dv=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
 const unit={5121:1,5123:2,5125:4}[accessor.componentType];
 const setter={5121:'setUint8',5123:'setUint16',5125:'setUint32'}[accessor.componentType];
 const first=(view.byteOffset||0)+(accessor.byteOffset||0);
 for(const [i,n] of [1,3,2].entries())dv[setter](first+(i+3)*unit,n,true);
 return writeGlb({...original,chunks:original.chunks.map(c=>c.type===0x004e4942?{...c,data:bytes}:c)},original.json);
}
const topology=glb=>{
 const sourceSha256=sha(glb);
 const data=buildOwnedTopologyBinary({sourceGLB:glb,sourceSha256});
 const graph=previewOwnedTopology({sourceGLB:glb,sourceSha256,data});
 return{sourceGLB:glb,sourceSha256,data,graph};
};
test('boundary source edge generates exactly two child triangles and deterministic provenance',()=>{
 const t=topology(source),edge=t.graph.edges[0];
 const a=planOwnedEdgeSplit({...t,edgeId:edge.id});
 const b=planOwnedEdgeSplit({...t,edgeId:edge.id});
 assert.deepEqual(a,b);
 assert.equal(a.applied,false);
 assert.equal(a.boundary,true);
 assert.equal(a.children.length,1);
 assert.equal(a.resultingFaceCount,t.graph.faces.length+1);
 assert.deepEqual(a.children[0].cornerInterpolation.weights,[0.5,0.5]);
 assert.equal(new Set(a.children[0].childIndices.flat()).size,4);
 assert.deepEqual(t.graph,previewOwnedTopology(t));
});
test('shared interior edge splits both neighboring faces, respecting inverse winding',()=>{
 const t=topology(shared());
 const edge=t.graph.edges.find(e=>!e.boundary);
 assert.ok(edge);
 const p=planOwnedEdgeSplit({...t,edgeId:edge.id,t:0.25});
 assert.equal(p.children.length,2);
 assert.equal(p.resultingFaceCount,4);
 assert.equal(p.unaffectedSourceFaceIds.length,0);
 assert.equal(p.children[0].orientedEdge[0],p.children[1].orientedEdge[1]);
 assert.equal(p.children[0].orientedEdge[1],p.children[1].orientedEdge[0]);
 assert.deepEqual(p.children[0].cornerInterpolation.weights,[0.75,0.25]);
 assert.equal(new Set(p.children.flatMap(f=>f.childIds)).size,4);
});
test('reject stale edge and out-of-range split fraction without modifying binary',()=>{
 const t=topology(source),before=t.data.slice();
 for(const invalid of [0,1,-0.1,NaN,Infinity,'0.5']){
  assert.throws(()=>planOwnedEdgeSplit({...t,edgeId:t.graph.edges[0].id,t:invalid}),/MARK_SPLIT_FRACTION/);
 }
 assert.throws(()=>planOwnedEdgeSplit({...t,edgeId:'missing'}),/MARK_SPLIT_EDGE_STALE/);
 assert.deepEqual(t.data,before);
});
