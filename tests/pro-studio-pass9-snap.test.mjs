import test from 'node:test';
import assert from 'node:assert/strict';
import {buildRiggedFixture} from '../scripts/pro-studio-glb-fixtures.mjs';
import {parseGlb} from '../src/glb.js';
import {applyMeshOperations,getMeshEditStats} from '../src/pro-studio/mesh-edit-core.js';
import {inspectRiggedGlb} from '../src/pro-studio/rigged-glb-audit.js';

const fixture=buildRiggedFixture();
function position(bytes){
 const parsed=parseGlb(bytes),doc=parsed.json;
 const accessor=doc.accessors[doc.meshes[0].primitives[0].attributes.POSITION];
 const view=doc.bufferViews[accessor.bufferView];
 const bin=parsed.chunks.find(c=>c.type===0x004e4942).data;
 const data=new DataView(bin.buffer,bin.byteOffset,bin.byteLength);
 const start=(view.byteOffset??0)+(accessor.byteOffset??0);
 const stride=view.byteStride??12;
 return Array.from({length:accessor.count},(_,i)=>[0,4,8].map(off=>
  data.getFloat32(start+i*stride+off,true)));
}
const snap=(vertex,targetVertex)=>({
 kind:'vertex.snap',meshIndex:0,primitiveIndex:0,vertex,targetVertex
});
test('vertex.snap writes real POSITION bytes without welding topology or altering source GLB',()=>{
 const original=fixture.bytes.slice(),before=position(original);
 const updated=applyMeshOperations(original,[snap(0,2)]);
 const after=position(updated);
 assert.deepEqual(after[0],before[2]);
 assert.deepEqual(after.slice(1),before.slice(1));
 assert.deepEqual(original,fixture.bytes);
 assert.equal(getMeshEditStats(updated).vertexCount,getMeshEditStats(original).vertexCount);
 assert.equal(getMeshEditStats(updated).triangleCount,getMeshEditStats(original).triangleCount);
 const audit=inspectRiggedGlb(updated);
 assert.equal(audit.skins[0].joints,70);
 assert.equal(audit.animations.length,3);
 assert.equal(audit.morphs[0].targets,2);
});
test('vertex.snap rejects out-of-range, identical and noninteger indices without mutating input',()=>{
 const initial=fixture.bytes.slice();
 for(const params of [[-1,2],[1,999],[1,1],[1.5,2],[null,2]]){
  assert.throws(()=>applyMeshOperations(initial,[snap(...params)]),/MARK_MESH_(VERTEX|SNAP_TARGET)/);
 }
 assert.deepEqual(initial,fixture.bytes);
});
