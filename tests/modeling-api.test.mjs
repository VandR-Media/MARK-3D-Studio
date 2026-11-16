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
const modelCache=new Map();
function built(recipe){
 const k=recipe.project.id;if(!modelCache.has(k))modelCache.set(k,runRecipe(recipe));
 return modelCache.get(k);
}
test('schema validates commands but rejects arbitrary or malformed recipe',()=>{
 assert.equal(validateRecipe(recipe),true);
 assert.throws(()=>validateRecipe({...recipe,schema:'unknown'}),/версия/);
 assert.throws(()=>validateRecipe({...recipe,project:{id:'..',base:'practice-head'}}),/project.id/);
});
test('identical JSON recipes create bitwise-identical binary GLB geometry',()=>{
 const a=built(recipe),b=runRecipe(recipe);
 assert.equal(sha(a.bytes),sha(b.bytes));
 assert.deepEqual(a.summary,b.summary);
 assert.ok(a.summary.meshes>=20,'Must have independently modeled anatomy parts');
 assert.ok(a.summary.triangles>40000,'Must be more complex than practice head');
 assert.ok(a.snapshots.has('original')&&a.snapshots.has('with-components'));
 assert.equal(a.report.some(x=>x.status==='error'),false);
});
test('changed nose only deforms head and leaves independently controlled components unchanged',()=>{
 const first=built(recipe),second=built(variant);
 assert.notEqual(sha(first.bytes),sha(second.bytes));
 const h1=new MeshEditor(first.bytes,0),h2=new MeshEditor(second.bytes,0);
 assert.ok(h1.positions.some((v,i)=>v!==h2.positions[i]));
 const parsed1=parseGlb(first.bytes),parsed2=parseGlb(second.bytes);
 const j1=parsed1.json,j2=parsed2.json;
 assert.equal(j1.nodes.length,j2.nodes.length);
 assert.deepEqual(j1.nodes.map(n=>n.name),j2.nodes.map(n=>n.name));
 const bin1=parsed1.chunks.find(c=>c.type===0x004e4942).data;
 const bin2=parsed2.chunks.find(c=>c.type===0x004e4942).data;
 const attrBytes=(doc,bin,id)=>{
  const a=doc.accessors[id],v=doc.bufferViews[a.bufferView];
  return bin.slice(v.byteOffset||0,(v.byteOffset||0)+v.byteLength);
 };
 for(let i=1;i<j1.nodes.length;i++){
  const a=j1.meshes[j1.nodes[i].mesh].primitives[0],b=j2.meshes[j2.nodes[i].mesh].primitives[0];
  for(const key of ['POSITION','NORMAL','TEXCOORD_0']){
   assert.deepEqual(attrBytes(j1,bin1,a.attributes[key]),attrBytes(j2,bin2,b.attributes[key]),
    'Unmodified component '+i+' accessor '+key+' changed');
  }
  assert.deepEqual(attrBytes(j1,bin1,a.indices),attrBytes(j2,bin2,b.indices),
   'Unmodified component '+i+' triangle indices changed');
 }
 assert.deepEqual(j1.materials,j2.materials);
});
test('all components preserve valid indices, normals, UV and independent accessors',()=>{
 const r=built(recipe),doc=parseGlb(r.bytes).json,meshAccessors=new Set();
 for(let i=0;i<doc.nodes.length;i++){
  const mesh=doc.meshes[doc.nodes[i].mesh],prim=mesh.primitives[0];
  assert.ok(!meshAccessors.has(prim.attributes.POSITION));
  meshAccessors.add(prim.attributes.POSITION);
  const diag=r.meshDiagnostics.find(x=>x.nodeIndex===i);
  assert.ok(diag,'Missing per-component diagnostic');
  assert.equal(diag.audit.invalidTriangles,0,'Invalid triangles '+doc.nodes[i].name);
  assert.equal(diag.audit.nonManifoldEdges,0,'Nonmanifold '+doc.nodes[i].name);
  assert.equal(doc.accessors[prim.attributes.TEXCOORD_0].count,doc.accessors[prim.attributes.POSITION].count);
  assert.equal(doc.accessors[prim.attributes.NORMAL].count,doc.accessors[prim.attributes.POSITION].count);
  assert.equal(doc.accessors[prim.indices].count,diag.audit.triangles*3);
 }
 for(const i of [0,1,doc.nodes.length-1]){
  const editor=new MeshEditor(r.bytes,i);
  assert.ok(editor.count>0&&editor.indices.length>0,'Binary read fails at node '+i);
 }
 assert.equal(r.audit.boundaryEdges,0);
 assert.equal(r.meshDiagnostics.length,r.summary.meshes);
 assert.ok(r.meshDiagnostics.every(m=>m.invalidNormals===0&&m.maxNormalLengthError<.015));
 assert.ok(r.meshDiagnostics.every(m=>m.audit.invalidTriangles===0&&m.audit.nonManifoldEdges===0));
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

test('eyes high-level ChatGPT command changes actual socket/lid vertices, not ignored keys',()=>{
 const p={schema:'mark-modeling/0.4',project:{id:'eyes-api-test',base:'practice-head'},commands:[
  {operation:'face.modify',target:'eyes',parameters:{
   spacing:.48,size:.66,upperEyelid:.72,lowerEyelid:.35
  }}
 ]};
 const x=runRecipe(p),original=runRecipe({schema:p.schema,project:p.project,
  commands:[{operation:'mesh.inspect'}]});
 assert.equal(x.report[0].details.changes.length,4);
 const changedPositions=new MeshEditor(x.bytes).positions;
 const baselinePositions=new MeshEditor(original.bytes).positions;
 assert.ok(changedPositions.some((v,i)=>v!==baselinePositions[i]));
 assert.throws(()=>runRecipe({...p,commands:[{operation:'face.modify',target:'eyes',parameters:{unsupported:.8}}]}),/неизвестный параметр/);
});

test('v0.4.1 candidate is a new continuous contour-based head and full JSON pipeline',()=>{
 const candidate=load('recipes/mark-cosmic-face-candidate-v1.json');
 const result=runRecipe(candidate);
 const original=new MeshEditor(result.snapshots.get('continuous-contour-head'),0);
 assert.notEqual(original.count,18882,'Candidate must not be a renamed v0.3 practice head');
 assert.ok(original.count>20000,'Contour base must be a dense continuous polygon mesh');
 assert.ok(result.summary.meshes>20,'Candidate must contain genuine independent facial components');
 assert.ok(result.summary.triangles>45000);
 assert.equal(result.audit.boundaryEdges,0);
 assert.ok(result.meshDiagnostics.every(m=>m.audit.invalidTriangles===0&&m.audit.nonManifoldEdges===0));
 assert.deepEqual(parseGlb(result.bytes).json.materials[0].pbrMetallicRoughness.baseColorFactor,[.76,.51,.40,1]);
 assert.ok(result.warnings.some(w=>w.includes('референс')),'Do not silently claim approved likeness');
});
test('one project eye-control change consistently moves eyeballs, lids and brows, not ears or lips',()=>{
 const candidate=load('recipes/mark-cosmic-face-candidate-v1.json');
 const base=runRecipe(candidate);
 candidate.project.controls.eyes.spacing=.67;
 const changed=runRecipe(candidate);
 const before=parseGlb(base.bytes).json,after=parseGlb(changed.bytes).json;
 const bin1=parseGlb(base.bytes).chunks.find(c=>c.type===0x004e4942).data;
 const bin2=parseGlb(changed.bytes).chunks.find(c=>c.type===0x004e4942).data;
 function vertexBlob(doc,bin,node){
  const p=doc.meshes[node.mesh].primitives[0];
  const view=doc.bufferViews[doc.accessors[p.attributes.POSITION].bufferView];
  return bin.slice(view.byteOffset||0,(view.byteOffset||0)+view.byteLength);
 }
 const modified=[],preserved=[];
 for(let i=0;i<before.nodes.length;i++){
  const a=before.nodes[i],b=after.nodes[i];
  assert.equal(a.name,b.name);
  const equal=Buffer.from(vertexBlob(before,bin1,a)).equals(Buffer.from(vertexBlob(after,bin2,b)));
  const facePart=/eye|eyelid|eyebrow|pupil|iris|upper lid|lower lid/i.test(a.name);
  if(facePart){assert.equal(equal,false,'Eye component must move: '+a.name);modified.push(a.name);}
  else if(/auricle|lip|scalp|strand/i.test(a.name)){assert.equal(equal,true,'Unrelated feature must remain: '+a.name);preserved.push(a.name);}
 }
 assert.ok(modified.length>=8&&preserved.length>=4);
});
