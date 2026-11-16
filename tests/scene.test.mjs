import test from 'node:test';
import assert from 'node:assert/strict';
import {createTestHeadGlb} from '../src/head-fixture.js';
import {parseGlb} from '../src/glb.js';
import {MeshEditor} from '../src/mesh-core.js';
import {editScene,getSceneObjects,MATERIAL_PRESETS} from '../src/scene-objects.js';
const sample=createTestHeadGlb();
test('duplicate creates independent mesh, unique accessor and a second true scene node',()=>{
 const x=editScene(sample,{operation:'duplicate',name:'Левый глаз — заготовка',offset:[.45,.35,.13]});
 const doc=parseGlb(x.bytes).json,objects=getSceneObjects(doc);
 assert.equal(objects.length,2);assert.equal(doc.meshes.length,2);
 assert.equal(objects[1].name,'Левый глаз — заготовка');
 assert.notEqual(doc.meshes[0].primitives[0].attributes.POSITION,doc.meshes[1].primitives[0].attributes.POSITION);
 assert.notEqual(doc.meshes[0].primitives[0].attributes.NORMAL,doc.meshes[1].primitives[0].attributes.NORMAL);
 assert.notEqual(doc.meshes[0].primitives[0].indices,doc.meshes[1].primitives[0].indices);
 const first=new MeshEditor(x.bytes,0),second=new MeshEditor(x.bytes,1);
 assert.deepEqual(first.positions,second.positions);
});
test('editing duplicate geometry does not modify original GLB object',()=>{
 const x=editScene(sample,{operation:'duplicate'}),e=new MeshEditor(x.bytes,1);
 const before=new MeshEditor(x.bytes,0).positions.slice();
 e.transform([100],'move','z',.2);
 const reimport=e.exportGlb();
 assert.deepEqual(new MeshEditor(reimport,0).positions,before);
 assert.notDeepEqual(new MeshEditor(reimport,1).positions,new MeshEditor(x.bytes,1).positions);
});
test('add independent PBR preset and preserve scene hierarchy, original materials',()=>{
 let x=editScene(sample,{operation:'duplicate',name:'Деталь'});
 x=editScene(x.bytes,{operation:'material',nodeIndex:1,preset:'metal'});
 const doc=parseGlb(x.bytes).json;
 assert.equal(doc.materials.length,2);assert.equal(doc.meshes[1].primitives[0].material,1);
 assert.deepEqual(doc.materials[0],parseGlb(sample).json.materials[0]);
 assert.equal(doc.materials[1].pbrMetallicRoughness.metallicFactor,MATERIAL_PRESETS.metal.metallic);
 assert.equal(doc.scenes[0].nodes.length,2);
});
test('rename, transform, rotate, scale, reparent and hide all persist as GLB JSON',()=>{
 let bytes=editScene(sample,{operation:'duplicate',name:'Веко'}).bytes;
 const run=(operation,params={})=>{bytes=editScene(bytes,{operation,nodeIndex:1,...params}).bytes;};
 run('rename',{name:'Верхнее веко'});
 run('transform',{vector:[.4,.2,.8],rotation:[0,35,0]});
 run('scale',{vector:[.55,.65,.8]});
 run('hide');
 run('reparent',{parentIndex:0});
 const doc=parseGlb(bytes).json,objects=getSceneObjects(doc);
 assert.equal(doc.nodes[1].name,'Верхнее веко');
 assert.deepEqual(doc.nodes[1].translation,[.4,.2,.8]);
 assert.deepEqual(doc.nodes[1].scale,[.55,.65,.8]);
 assert.equal(doc.nodes[1].rotation.length,4);
 assert.equal(doc.nodes[1].extras.markHidden,true);
 assert.deepEqual(doc.nodes[0].children,[1]);
 assert.equal(doc.scenes[0].nodes.includes(1),false);
 assert.deepEqual(objects.map(o=>o.depth),[0,1]);
});
test('prevent cyclic hierarchy and animated node removal',()=>{
 let bytes=editScene(sample,{operation:'duplicate'}).bytes;
 bytes=editScene(bytes,{operation:'reparent',nodeIndex:1,parentIndex:0}).bytes;
 assert.throws(()=>editScene(bytes,{operation:'reparent',nodeIndex:0,parentIndex:1}),/циклическую/);
 const parsed=parseGlb(bytes);
 parsed.json.animations=[{channels:[{target:{node:1,path:'translation'}}],samplers:[]}];
 const file=(await import('../src/glb.js')).writeGlb(parsed,parsed.json);
 assert.throws(()=>editScene(file,{operation:'delete',nodeIndex:1}),/анимац/);
});
test('delete removes node from renderable scene but preserves original mesh and IDs',()=>{
 let x=editScene(sample,{operation:'duplicate'});x=editScene(x.bytes,{operation:'delete',nodeIndex:1});
 const doc=parseGlb(x.bytes).json;
 assert.equal(getSceneObjects(doc).length,1);
 assert.equal(doc.scenes[0].nodes.includes(1),false);
 assert.equal(doc.nodes[1].extras.markDeleted,true);
 assert.ok(new MeshEditor(x.bytes,0).count>18000);
});
test('invalid object operations refuse safely',()=>{
 assert.throws(()=>editScene(sample,{operation:'duplicate',offset:[NaN,0,0]}),/смещения/);
 assert.throws(()=>editScene(sample,{operation:'material',preset:'none'}),/материала/);
 assert.throws(()=>editScene(sample,{operation:'reparent',parentIndex:0}),/самого себя/);
 assert.throws(()=>editScene(sample,{operation:'scale',vector:[0,2,3]}),/масштаб/);
 assert.throws(()=>editScene(sample,{operation:'rename',name:' '}),/название/);
});
