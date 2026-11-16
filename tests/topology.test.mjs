import test from 'node:test';
import assert from 'node:assert/strict';
import {parseGlb,writeGlb} from '../src/glb.js';
import {createTestHeadGlb} from '../src/head-fixture.js';
import {MeshEditor} from '../src/mesh-core.js';
import {topologyEdit,inspectMesh,readPrimitive} from '../src/topology.js';

const fixture=createTestHeadGlb();
const glb=parseGlb(fixture);
const bin=p=>p.chunks.find(c=>c.type===0x004e4942).data;
function originalMaterialAndUv(before,after){
 assert.deepEqual(after.json.materials,before.json.materials);
 assert.deepEqual(after.json.nodes,before.json.nodes);
 assert.deepEqual(after.json.meshes[0].name,before.json.meshes[0].name);
 const beforeUv=before.json.meshes[0].primitives[0].attributes.TEXCOORD_0;
 const afterUv=after.json.meshes[0].primitives[0].attributes.TEXCOORD_0;
 assert.ok(Number.isInteger(beforeUv)&&Number.isInteger(afterUv));
 const doc=after.json;
 assert.equal(doc.accessors[afterUv].count,doc.accessors[doc.meshes[0].primitives[0].attributes.POSITION].count);
 // Previously existing BIN prefix is not modified.
 assert.deepEqual(bin(after).slice(0,bin(before).length),bin(before));
}
test('Topology Subdivide alters actual triangle indices and adds an interpolated vertex to GLB',()=>{
 const edited=topologyEdit(fixture,{operation:'subdivide',faceIndex:800});
 assert.equal(edited.after.vertices,edited.before.vertices+1);
 assert.equal(edited.after.triangles,edited.before.triangles+2);
 assert.equal(edited.after.boundaryEdges,0);
 const parsed=parseGlb(edited.bytes),rt=new MeshEditor(edited.bytes);
 assert.equal(rt.count,edited.after.vertices);
 assert.equal(rt.triangleCount,edited.after.triangles);
 originalMaterialAndUv(glb,parsed);
});
test('Inset creates new true polygon contour and keeps original closed manifold and UVs',()=>{
 const edit=topologyEdit(fixture,{operation:'inset',faceIndex:16000,ratio:.27});
 assert.equal(edit.after.vertices,edit.before.vertices+3);
 assert.equal(edit.after.triangles,edit.before.triangles+6);
 assert.equal(edit.after.boundaryEdges,0);
 assert.equal(edit.after.nonManifoldEdges,0);
 const rt=readPrimitive(edit.bytes);
 assert.equal(rt.positions.length/3,edit.after.vertices);
 originalMaterialAndUv(glb,parseGlb(edit.bytes));
});
test('Extrude moves top vertices into 3D, rebuilds side walls and exports triangles',()=>{
 const original=readPrimitive(fixture),edit=topologyEdit(fixture,{operation:'extrude',faceIndex:12000,amount:.12});
 assert.equal(edit.after.vertices,original.positions.length/3+3);
 assert.equal(edit.after.triangles,original.indices.length/3+6);
 assert.equal(edit.after.boundaryEdges,0);
 const reopened=readPrimitive(edit.bytes);
 const oldFace=original.indices.slice(12000*3,12000*3+3);
 const originalTop=oldFace.map(i=>original.positions.slice(i*3,i*3+3));
 const newTop=reopened.positions.slice(original.positions.length);
 assert.ok(newTop.some((v,i)=>Math.abs(v-originalTop[Math.floor(i/3)][i%3])>.0001));
 originalMaterialAndUv(glb,parseGlb(edit.bytes));
});
test('Recalculate normals only modifies a new NORMAL accessor and keeps geometry',()=>{
 const e=topologyEdit(fixture,{operation:'normals'});
 const before=readPrimitive(fixture),after=readPrimitive(e.bytes);
 assert.deepEqual(after.positions,before.positions);
 assert.deepEqual(after.indices,before.indices);
 assert.ok(after.original.invalidTriangles===0);
 originalMaterialAndUv(glb,parseGlb(e.bytes));
});
test('Unsupported topology ops and unsafe selections are blocked without changing original GLB',()=>{
 assert.throws(()=>topologyEdit(fixture,{operation:'loopcut'}),/Loop Cut/);
 assert.throws(()=>topologyEdit(fixture,{operation:'delete'}),/отверстия/);
 assert.throws(()=>topologyEdit(fixture,{operation:'weld',vertices:[-1,5]}),/индекс/);
 assert.throws(()=>topologyEdit(fixture,{operation:'merge',vertices:[0,123],threshold:.01}),/далеко/);
 const skinned=structuredClone(glb.json);skinned.nodes[0].skin=0;
 assert.throws(()=>topologyEdit(writeGlb(glb,skinned),{operation:'subdivide'}),/skinning/);
});
test('Topological edit sequence serializes and reimports without degrading GLB data',()=>{
 let bytes=fixture;
 for(const op of [{operation:'subdivide',faceIndex:2500},{operation:'inset',faceIndex:4000,ratio:.34},{operation:'extrude',faceIndex:6000,amount:.07}]){
  bytes=topologyEdit(bytes,op).bytes;const testMesh=new MeshEditor(bytes);
  assert.ok(testMesh.positions.every(Number.isFinite));
 }
 const final=readPrimitive(bytes),audit=inspectMesh(final.positions,final.indices);
 assert.equal(audit.invalidTriangles,0);assert.equal(audit.nonManifoldEdges,0);assert.equal(audit.boundaryEdges,0);
 originalMaterialAndUv(glb,parseGlb(bytes));
 assert.deepEqual(new MeshEditor(bytes).positions,new MeshEditor(new MeshEditor(bytes).exportGlb()).positions);
});
test('Mesh audit identifies malformed indices, degenerate and non-manifold edges',()=>{
 const vertices=[0,0,0,1,0,0,0,1,0,2,0,0];
 const a=inspectMesh(vertices,[0,1,2,0,0,1,0,5,2]);
 assert.ok(a.invalidTriangles>=2);
 const b=inspectMesh(vertices,[0,1,2,0,1,3,0,1,2]);
 assert.ok(b.nonManifoldEdges>=1);
});
