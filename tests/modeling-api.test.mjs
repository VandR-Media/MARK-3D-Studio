import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {runRecipe,validateRecipe,describeGlb} from '../src/modeling-api.js';
import {parseGlb} from '../src/glb.js';
import {MeshEditor} from '../src/mesh-core.js';
import {inspectMesh} from '../src/topology.js';
const load=path=>JSON.parse(readFileSync(new URL('../'+path,import.meta.url),'utf8'));
const recipe=load('recipes/stylized-face-demo.json'),variant=load('recipes/stylized-face-nose-variant.json');
const sha=data=>createHash('sha256').update(data).digest('hex');
test('schema validates commands but rejects arbitrary or malformed recipe',()=>{
 assert.equal(validateRecipe(recipe),true);
 assert.throws(()=>validateRecipe({...recipe,schema:'unknown'}),/версия/);
 assert.throws(()=>validateRecipe({...recipe,project:{id:'..',base:'practice-head'}}),/project.id/);
});
test('identical JSON recipes create bitwise-identical binary GLB geometry',()=>{
 const a=runRecipe(recipe),b=runRecipe(recipe);
 assert.equal(sha(a.bytes),sha(b.bytes));
 assert.deepEqual(a.summary,b.summary);
 assert.ok(a.summary.meshes>=20,'Must have independently modeled anatomy parts');
 assert.ok(a.summary.triangles>40000,'Must be more complex than practice head');
 assert.ok(a.snapshots.has('original')&&a.snapshots.has('with-components'));
 assert.equal(a.report.some(x=>x.status==='error'),false);
});
test('changed nose only deforms head and leaves independently controlled components unchanged',()=>{
 const first=runRecipe(recipe),second=runRecipe(variant);
 assert.notEqual(sha(first.bytes),sha(second.bytes));
 const h1=new MeshEditor(first.bytes,0),h2=new MeshEditor(second.bytes,0);
 assert.ok(h1.positions.some((v,i)=>v!==h2.positions[i]));
 const j1=parseGlb(first.bytes).json,j2=parseGlb(second.bytes).json;
 assert.equal(j1.nodes.length,j2.nodes.length);
 assert.deepEqual(j1.nodes.map(n=>n.name),j2.nodes.map(n=>n.name));
 for(let i=1;i<j1.nodes.length;i++){
  const a=new MeshEditor(first.bytes,i),b=new MeshEditor(second.bytes,i);
  assert.deepEqual(a.positions,b.positions,'Unmodified component '+i+' changed');
 }
 assert.deepEqual(j1.materials,j2.materials);
});
test('all components preserve valid indices, normals, UV and independent accessors',()=>{
 const r=runRecipe(recipe),doc=parseGlb(r.bytes).json,meshAccessors=new Set();
 for(let i=0;i<doc.nodes.length;i++){
  const mesh=doc.meshes[doc.nodes[i].mesh],prim=mesh.primitives[0];
  assert.ok(!meshAccessors.has(prim.attributes.POSITION));
  meshAccessors.add(prim.attributes.POSITION);
  const editor=new MeshEditor(r.bytes,i);
  const audit=inspectMesh(editor.positions,editor.indices);
  assert.equal(audit.invalidTriangles,0,'Invalid triangles '+doc.nodes[i].name);
  assert.equal(audit.nonManifoldEdges,0,'Nonmanifold '+doc.nodes[i].name);
  assert.equal(doc.accessors[prim.attributes.TEXCOORD_0].count,editor.count);
  assert.equal(doc.accessors[prim.attributes.NORMAL].count,editor.count);
  assert.equal(doc.accessors[prim.indices].count,editor.indices.length);
 }
 assert.equal(r.audit.boundaryEdges,0);
});
test('safe geometry sweep and loft create standalone real glTF objects',()=>{
 const simple={schema:'mark-modeling/0.4',project:{id:'test-geometry',base:'practice-head'},
  commands:[
   {operation:'geometry.loft',target:'Contoured test geometry',parameters:{
    sections:[[[0,0,0],[.2,0,0],[.2,.2,0],[0,.2,0]],[[0,0,.1],[.2,0,.1],[.2,.2,.1],[0,.2,.1]]],
    material:{name:'Custom matte',color:[.4,.3,.2,1],roughness:.9}
   }},
   {operation:'geometry.sweep',target:'Swept test curve',parameters:{
    path:[[0,0,0],[.1,.2,0],[.2,.3,.1],[.3,.4,.2]],radius:.02,depth:.03
   }}
  ]};
 const r=runRecipe(simple);
 assert.equal(r.summary.meshes,3);
 assert.equal(r.report.length,2);
 assert.ok(new MeshEditor(r.bytes,2).count>30);
});
test('failed op with onError skip rolls back exactly and later valid steps proceed',()=>{
 const p={schema:'mark-modeling/0.4',project:{id:'rollback-check',base:'practice-head'},
  commands:[
   {operation:'feature.build',target:'wrong',onError:'skip'},
   {operation:'face.modify',target:'nose',parameters:{length:.8}},
   {operation:'mesh.inspect'}
  ]};
 const a=runRecipe(p);
 assert.equal(a.report[0].status,'error');
 assert.equal(a.report[1].status,'ok');
 assert.ok(a.warnings[0].includes('референсы'));
 assert.equal(a.summary.meshes,1);
 assert.equal(describeGlb(a.bytes).trianglesHead,37760);
});
test('invalid parameters fail without generating a bogus GLB',()=>{
 assert.throws(()=>runRecipe({schema:'mark-modeling/0.4',project:{id:'invalid-params',base:'practice-head'},
  commands:[{operation:'face.modify',target:'nose',parameters:{length:5}}]}),/length/);
 assert.throws(()=>runRecipe({schema:'mark-modeling/0.4',project:{id:'invalid-params',base:'provided-glb'},
  commands:[{operation:'mesh.inspect'}]}),/sourceBytes/);
});
