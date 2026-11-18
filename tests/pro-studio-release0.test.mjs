import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import {runVisualRecipe,deserializeVisualScene,validateVisualScene} from '../src/visual-engine/scene-model.js';
import {inspectVisualImport} from '../src/visual-engine/glb-guard.js';
import {writeGlb} from '../src/glb.js';

const json=path=>JSON.parse(readFileSync(path,'utf8'));
const registry=json('docs/pro-studio/release0-capabilities.json');
const schema=json('schemas/mark-professional-capabilities-v1.schema.json');
const cap=id=>{
 const entry=registry.capabilities.find(x=>x.id===id);
 assert.ok(entry,'missing capability '+id);
 return entry;
};
const glb=jsonDoc=>writeGlb(
 {chunks:[{type:0x4e4f534a,data:new Uint8Array(0)}]},jsonDoc
);
const baseGltf=()=>({
 asset:{version:'2.0'},scene:0,scenes:[{nodes:[0]}],
 nodes:[{mesh:0}],meshes:[{primitives:[{attributes:{POSITION:0}}]}],
 buffers:[{byteLength:0}],bufferViews:[],
 accessors:[{componentType:5126,count:3,type:'VEC3'}]
});

test('Release 0 machine-readable capability audit follows schema and has unique IDs',()=>{
 const ajv=new Ajv2020({allErrors:true,strict:false});
 const validate=ajv.compile(schema);
 assert.ok(validate(registry),ajv.errorsText(validate.errors));
 const proposed=json('schemas/mark-professional-scene-v3-proposal.schema.json');
 assert.equal(proposed.properties.specStatus.const,'DRAFT_NOT_IMPLEMENTED');
 assert.equal(proposed.properties.schema.const,'mark.professional-scene/3-draft');
 const ids=registry.capabilities.map(x=>x.id);
 assert.equal(new Set(ids).size,ids.length);
 assert.match(registry.auditedSourceCommit,/^[0-9a-f]{40}$/);
 assert.notEqual(registry.auditedSourceCommit,registry.historicalEvidence.sourceCommit);
 assert.equal(registry.historicalEvidence.deviceMeasured,false);
 assert.ok(registry.capabilities.every(x=>x.status!=='passed'),
  'Source inspection may not be marketed as an end-to-end PASS');
});

test('Release 0 legacy v2 scene/recipe contract survives deterministic re-evaluation',()=>{
 for(const kind of ['analog-studio','spectrum-matrix']){
  const recipe=json('recipes/visual-v2-'+kind+'.json');
  const a=runVisualRecipe(recipe).scene;
  const b=runVisualRecipe(recipe).scene;
  assert.equal(a.schema,'mark.visual-scene/2');
  assert.deepEqual(a,b);
  assert.deepEqual(deserializeVisualScene(JSON.stringify(a)),a);
  assert.ok(validateVisualScene(a));
  assert.ok(a.objects.length>100);
 }
 assert.equal(cap('RECIPE-V2').status,'partial');
});

test('Release 0 preserves honest rejection of skin, morph, animation and unknown extension',()=>{
 const initial=baseGltf();
 assert.equal(inspectVisualImport(glb(initial)).meshes,1);
 const skins=structuredClone(initial);
 skins.skins=[{joints:[0],inverseBindMatrices:0}];
 assert.throws(()=>inspectVisualImport(glb(skins)),/Скелетный GLB/);
 const animated=structuredClone(initial);
 animated.animations=[{samplers:[],channels:[]}];
 assert.throws(()=>inspectVisualImport(glb(animated)),/Анимированный GLB/);
 const morph=structuredClone(initial);
 morph.meshes[0].primitives[0].targets=[{POSITION:0}];
 assert.throws(()=>inspectVisualImport(glb(morph)),/morph targets/);
 const required=structuredClone(initial);
 required.extensionsUsed=['KHR_draco_mesh_compression'];
 required.extensionsRequired=['KHR_draco_mesh_compression'];
 assert.throws(()=>inspectVisualImport(glb(required)),/неподдерживаемые расширения/);
 for(const id of ['GLB-SKINNING','GLB-MORPHS','GLB-ANIMATIONS'])
  assert.equal(cap(id).status,'unsupported');
});

test('Release 0 target v3 APIs are explicitly not claimed as implemented',()=>{
 for(const id of ['PRO-SCENE-V3','MARK-AI-BRIDGE','DESKTOP-CORE'])
  assert.equal(cap(id).status,'not_started');
 assert.equal(registry.v2Limits.sceneObjects,3500);
 assert.equal(registry.v2Limits.recipeCommands,1000);
 assert.equal(registry.v2Limits.glbAttachments,12);
 assert.equal(registry.staticGltfAcceptedExtensions.length,8);
});
