import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {EditableMesh} from '../src/professional-geometry.js';
import {runGeometryRecipe} from '../src/professional-api.js';
import {parseGlb} from '../src/glb.js';
import {readPrimitive} from '../src/topology.js';
const hash=x=>createHash('sha256').update(x).digest('hex');
const tetra={
 positions:[0,0,0,1,0,0,0,1,0,0,0,1],
 uvs:[0,0,1,0,0,1,1,1],
 indices:[0,2,1,0,1,3,0,3,2,1,2,3]
};
test('Half-Edge topology stores stable vertex, edge, face IDs and consistent twins',()=>{
 const m=EditableMesh.fromGeometry(tetra,{name:'Tetra polygon'});
 const ids=[...m.vertices.keys()],edges=[...m.edges.values()].map(e=>e.id),faces=[...m.faces.keys()];
 assert.equal(m.vertices.size,4);
 assert.equal(m.faces.size,4);
 assert.equal(m.edges.size,6);
 assert.equal(m.halfEdges.size,12);
 assert.equal(m.inspect().boundaryEdges,0);
 assert.ok([...m.halfEdges.values()].every(h=>m.halfEdges.get(h.next).prev===h.id));
 assert.ok([...m.halfEdges.values()].every(h=>m.halfEdges.get(h.twin).twin===h.id));
 m.select([ids[0]]);
 m.moveSelected([0,0,.06]);
 assert.deepEqual([...m.vertices.keys()],ids);
 assert.deepEqual([...m.edges.values()].map(e=>e.id),edges);
 assert.deepEqual([...m.faces.keys()],faces);
});
test('free select/edit changes only chosen polygon vertices; undo/redo and restored project work',()=>{
 const m=EditableMesh.fromGeometry(tetra);
 const original=m.toGlb(),ids=[...m.vertices.keys()];
 assert.equal(m.select([ids[0]]),1);
 m.moveSelected([0,0,.1]);
 assert.notEqual(hash(m.toGlb()),hash(original));
 assert.equal(m.vertices.get(ids[1]).position[2],0);
 assert.equal(m.undo(),true);
 assert.equal(hash(m.toGlb()),hash(original));
 assert.equal(m.redo(),true);
 const restored=EditableMesh.fromProject(JSON.stringify(m.toProject({includeUndo:true})));
 assert.equal(hash(restored.toGlb()),hash(m.toGlb()));
 assert.ok(restored.history.length);
 assert.equal(restored.undo(),true);
 assert.equal(hash(restored.toGlb()),hash(original));
});
test('triangular face subdivide and extrusion are real watertight changes with rollback',()=>{
 const m=EditableMesh.fromGeometry(tetra);
 const old=m.inspect();
 const fid=[...m.faces.keys()][0];
 const ex=m.faceExtrude(fid,.15);
 assert.equal(ex.sideFaces,3);
 assert.equal(m.inspect().faces,old.faces+3);
 assert.equal(m.inspect().boundaryEdges,0);
 assert.equal(m.inspect().nonManifoldEdges,0);
 const stable=m.toGlb(),snapshot=hash(stable);
 assert.throws(()=>m.faceExtrude(fid,0),/Extrude distance/);
 assert.equal(hash(m.toGlb()),snapshot);
 const sub=m.faceSubdivide(fid);
 assert.equal(sub.addedFaces,3);
 assert.equal(m.inspect().faces,old.faces+5);
 assert.equal(m.inspect().degenerateFaces,0);
 assert.equal(m.undo(),true);
 assert.equal(hash(m.toGlb()),snapshot);
 const again=EditableMesh.fromGlb(stable);
 assert.equal(again.inspect().boundaryEdges,0);
 assert.equal(again.inspect().faces,7);
});
test('arbitrary brush moves a finite local surface area and masks suppress unrelated edits',()=>{
 const m=EditableMesh.fromGeometry(tetra),id=[...m.vertices.keys()][0],unchanged=[...m.vertices.keys()][1];
 const old=m.vertices.get(id).position.slice();
 m.brush({center:old,radius:.4,strength:.6,mode:'grab',delta:[0,0,.2]});
 assert.ok(m.vertices.get(id).position[2]>old[2]);
 assert.deepEqual(m.vertices.get(unchanged).position,[1,0,0]);
 assert.ok(m.inspect().degenerateFaces===0);
 m.setMask('none',[],1);
 const current=hash(m.toGlb());
 m.brush({center:old,radius:.4,strength:.5,mode:'smooth',mask:'none'});
 assert.equal(hash(m.toGlb()),current,'zero mask must leave geometry unchanged');
});
test('GLB binary roundtrip preserves indexed triangles, UV and PBR material values',()=>{
 const m=EditableMesh.fromGeometry(tetra,{name:'Polygon object',
  material:{name:'Skin-test',color:[.61,.39,.30,1],metallic:.06,roughness:.84}});
 const bytes=m.toGlb(),p=parseGlb(bytes).json,mat=p.materials[0].pbrMetallicRoughness;
 assert.deepEqual(mat.baseColorFactor,[.61,.39,.30,1]);
 assert.equal(mat.roughnessFactor,.84);
 const mesh=EditableMesh.fromGlb(bytes),next=mesh.toGlb();
 assert.deepEqual(readPrimitive(bytes).indices,readPrimitive(next).indices);
 assert.deepEqual(readPrimitive(bytes).uvs,readPrimitive(next).uvs);
 assert.equal(mesh.inspect().degenerateFaces,0);
});
test('JSON API selects arbitrary coordinates, runs free sculpt and produces deterministic GLB',()=>{
 const r={schema:'mark-geometry/0.1',project:{id:'arbitrary-core-demo',base:'empty'},commands:[
  {operation:'mesh.create',parameters:{name:'Tetra face',geometry:tetra}},
  {operation:'project.checkpoint',target:'initial'},
  {operation:'mesh.select',parameters:{point:[0,0,0],radius:.25}},
  {operation:'mesh.edit',parameters:{delta:[0,0,.08]}},
  {operation:'sculpt.brush',parameters:{center:[0,0,.08],radius:.32,strength:.5,mode:'grab',delta:[0,.09,0]}},
  {operation:'mesh.inspect'},
  {operation:'project.checkpoint',target:'sculpted'},
  {operation:'project.undo'},
  {operation:'project.redo'}
 ]};
 const a=runGeometryRecipe(r),b=runGeometryRecipe(r);
 assert.equal(hash(a.glb),hash(b.glb));
 assert.equal(a.checkpoints.size,2);
 assert.ok(a.events.every(e=>e.status==='ok'));
 assert.notEqual(hash(a.checkpoints.get('initial').glb),hash(a.glb));
 const project=EditableMesh.fromProject(a.project);
 assert.equal(hash(project.toGlb()),hash(a.glb));
});
test('unknown command fails explicitly, optional command rolls back, no silent success',()=>{
 const r={schema:'mark-geometry/0.1',project:{id:'bad-core-test',base:'empty'},commands:[
  {operation:'mesh.create',parameters:{geometry:tetra}},
  {operation:'mesh.select',parameters:{ids:['invalid']},onError:'skip'},
  {operation:'sculpt.brush',parameters:{center:[0,0,0],radius:.3,strength:.5,mode:'grab',delta:[0,0,.07]}},
  {operation:'mesh.inspect'}
 ]};
 const a=runGeometryRecipe(r);
 assert.equal(a.events[1].status,'error');
 assert.equal(a.events[2].status,'ok');
 assert.throws(()=>runGeometryRecipe({...r,commands:[...r.commands,{operation:'mesh.boolean'}]}),/Unsupported professional command/);
});
test('edit head eye socket, nose bridge and mouth region on dense continuous human-like topology',()=>{
 const m=EditableMesh.candidate(),start=m.toGlb(),before=m.inspect();
 assert.ok(before.triangles>40000);
 const far=[...m.vertices.values()].find(v=>v.position[1]<-1)?.id;
 const posBefore=far?m.vertices.get(far).position.slice():null;
 const eye=m.brush({center:[.35,.36,.72],radius:.25,strength:.42,mode:'grab',delta:[0,.03,.025],symmetry:true});
 const nose=m.brush({center:[0,-.08,.95],radius:.20,strength:.50,mode:'pinch',symmetry:true});
 const mouth=m.brush({center:[0,-.48,.77],radius:.20,strength:.38,mode:'smooth'});
 assert.ok(eye.touched>0&&nose.touched>0&&mouth.touched>0);
 assert.equal(m.inspect().triangles,before.triangles);
 assert.equal(m.inspect().nonManifoldEdges,0);
 assert.notEqual(hash(m.toGlb()),hash(start));
 if(far)assert.deepEqual(m.vertices.get(far).position,posBefore);
 const reopened=EditableMesh.fromGlb(m.toGlb());
 assert.equal(reopened.inspect().triangles,before.triangles);
});
