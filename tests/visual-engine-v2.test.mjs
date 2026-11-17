import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import {runVisualRecipe,validateVisualScene,deserializeVisualScene,SIGNALS} from '../src/visual-engine/scene-model.js';
import {StereoPcmAnalyzer,zeroStereoFrame,validateStereoFrame} from '../src/visual-engine/audio-frame.js';
import {inspectVisualImport} from '../src/visual-engine/glb-guard.js';
import {writeGlb} from '../src/glb.js';
const readJson=path=>JSON.parse(readFileSync(path,'utf8'));
const schema=readJson('schemas/mark-visual-recipe-v2.schema.json');
const ajv=new Ajv2020({allErrors:true,strict:false});
const validates=ajv.compile(schema);
const modes=['analog-studio','spectrum-matrix'];
const recipes=modes.map(x=>readJson('recipes/visual-v2-'+x+'.json'));
const signature=s=>JSON.stringify(s);
test('both approved-first musical 3D instrument recipes are schema-valid and deterministic',()=>{
 for(const [i,recipe] of recipes.entries()){
  assert.ok(validates(recipe),ajv.errorsText(validates.errors));
  const a=runVisualRecipe(recipe).scene,b=runVisualRecipe(recipe).scene;
  assert.equal(signature(a),signature(b),modes[i]+' not reproducible');
  assert.equal(a.schema,'mark.visual-scene/2');
  assert.ok(a.objects.filter(o=>o.geometry.type!=='group').length>60,'not a genuine multi-mesh device');
  assert.ok(a.materials.glass?.transmission>.5);
  assert.equal(a.lights.length,3);
  assert.ok(a.overlays.length>=6);
  assert.equal(signature(deserializeVisualScene(JSON.stringify(a))),signature(a));
 }
});
test('Analog Studio contains two pivoted actual needle objects and six frequency-band LED columns',()=>{
 const {scene}=runVisualRecipe(recipes[0]);
 for(const ch of ['left','right']){
  const needle=scene.objects.find(o=>o.id==='needle.'+ch);
  assert.equal(needle.geometry.type,'needle');assert.ok(needle.geometry.length>1);
  assert.ok(scene.bindings.some(b=>b.target===needle.id&&b.signal===ch+'.rms'));
  for(const band of ['low','mid','high']){
   const group=scene.objects.find(o=>o.id==='meter.'+ch+'.'+band);
   assert.equal(group.geometry.type,'group');
   assert.ok(scene.objects.filter(o=>o.parent===group.id&&o.meta.role==='led').length===8);
  }
 }
});
test('Spectrum Matrix contains exactly six separately addressed chains of 18 real LED meshes',()=>{
 const {scene}=runVisualRecipe(recipes[1]);
 assert.equal(scene.bindings.filter(b=>b.response==='led-column').length,6);
 assert.equal(scene.objects.filter(o=>o.meta.role==='led').length,108);
 for(const ch of ['left','right'])for(const band of ['low','mid','high']){
  const path=ch+'.'+band,group='meter.'+path;
  assert.equal(scene.bindings.find(b=>b.target===group)?.signal,path);
  const ids=scene.objects.filter(o=>o.parent===group);
  assert.equal(ids.length,18);
  assert.deepEqual(ids.map(o=>o.meta.threshold).slice(0,1),[1/18]);
 }
});
test('actual scene object edit/clone/delete and safe cycle rollback',()=>{
 const recipe=readJson('recipes/visual-v2-analog-studio.json');
 const edited=structuredClone(recipe);
 edited.commands.push({operation:'object.clone',args:{id:'case.main',newId:'test.clone',position:[.2,.1,.2]}});
 edited.commands.push({operation:'object.transform',args:{id:'test.clone',rotation:[0,.15,0],scale:[.9,.9,.9]}});
 edited.commands.push({operation:'object.material',args:{id:'test.clone',material:'bezel'}});
 const {scene}=runVisualRecipe(edited);
 const obj=scene.objects.find(o=>o.id==='test.clone');
 assert.deepEqual(obj.rotation,[0,.15,0]);assert.equal(obj.material,'bezel');
 const cycle=structuredClone(edited);
 cycle.commands.push({operation:'object.group',args:{id:'instrument.root',parent:'test.clone'}});
 assert.throws(()=>runVisualRecipe(cycle),/cyclic hierarchy/);
 const injected=structuredClone(recipe);
 injected.commands.push({operation:'script.eval',args:{code:'process.exit(1)'}});
 assert.throws(()=>runVisualRecipe(injected),/Unsupported visual command/);
 const noInvalid=structuredClone(edited);
 noInvalid.commands.push({operation:'object.remove',args:{id:'test.clone'}});
 assert.ok(!runVisualRecipe(noInvalid).scene.objects.some(o=>o.id==='test.clone'));
});
test('rejects dangling texture URLs, scene cycles, invalid PCM data and unsupported instruments',()=>{
 const bad=runVisualRecipe(recipes[1]).scene;
 bad.materials.enclosure.maps={normal:'https://attacker.example/texture.png'};
 assert.throws(()=>validateVisualScene(bad),/external\/invalid texture/);
 assert.throws(()=>runVisualRecipe({schema:'mark.visual-recipe/2',id:'nope',commands:[
  {operation:'instrument.create',args:{kind:'neon-towers'}}]}),/Unimplemented 3D instrument/);
 const f=zeroStereoFrame();f.left.waveform[0]=NaN;
 assert.throws(()=>validateStereoFrame(f));
});
test('actual decoded PCM FFT isolates LEFT low, RIGHT high and mono duplicated channels',()=>{
 const sr=48000,n=2048,an=new StereoPcmAnalyzer({sampleRate:sr,fftSize:n});
 const sine=f=>Float32Array.from({length:n},(_,i)=>.8*Math.sin(2*Math.PI*f*i/sr));
 const left=sine(120),right=sine(6000);
 an.feed(left.subarray(0,512),right.subarray(0,512),{timestampMs:512/sr*1000});
 an.feed(left.subarray(512),right.subarray(512),{timestampMs:n/sr*1000});
 const f=an.measure();
 assert.ok(f.left.low>.3&&f.left.low>20*f.left.high,'left low band incorrect');
 assert.ok(f.right.high>.3&&f.right.high>20*f.right.low,'right high incorrect');
 assert.ok(f.left.peak>.79&&f.right.peak>.79);
 assert.notDeepEqual(f.left.waveform,f.right.waveform,'waves must be real separate PCM');
 const mono=new StereoPcmAnalyzer({sampleRate:sr});mono.feed(left,left);
 const fm=mono.measure();assert.deepEqual(fm.left,fm.right);
 const paused=mono.measure({playing:false});
 assert.equal(paused.left.low,0);assert.equal(paused.right.high,0);
 mono.reset();assert.equal(mono.measure({playing:false}).left.rms,0);
});
test('all six channels remain independent for one 6-band synthetic PCM test',()=>{
 const sr=48000,n=2048,an=new StereoPcmAnalyzer({sampleRate:sr});
 const tones=[90,650,5700];
 const signal=(tones,amps)=>Float32Array.from({length:n},(_,i)=>tones.reduce((sum,f,j)=>
  sum+amps[j]*Math.sin(2*Math.PI*f*i/sr),0));
 const l=signal(tones,[.20,.31,.05]),r=signal(tones,[.01,.02,.76]);
 an.feed(l,r);
 const frame=an.measure();
 assert.ok(frame.left.mid>frame.left.high);
 assert.ok(frame.right.high>frame.right.mid*5);
 assert.notEqual(frame.left.low,frame.right.low);
 assert.equal(frame.source,'pcm');
});

test('GLB import accepts static self-contained textured multi-mesh scene, rejects data-loss paths',()=>{
 const doc={asset:{version:'2.0'},scene:0,scenes:[{nodes:[0,1]}],
  nodes:[{mesh:0},{mesh:1}],meshes:[
   {primitives:[{attributes:{POSITION:0},material:0}]},
   {primitives:[{attributes:{POSITION:1},material:1}]}
  ],
  materials:[{pbrMetallicRoughness:{baseColorTexture:{index:0}}},
   {pbrMetallicRoughness:{metallicRoughnessTexture:{index:0}},normalTexture:{index:0}}],
  images:[{uri:'data:image/png;base64,iVBORw0KGgo='}],
  textures:[{source:0}],buffers:[{byteLength:0}],bufferViews:[],
  accessors:[{componentType:5126,count:3,type:'VEC3'}, {componentType:5126,count:3,type:'VEC3'}]};
 const parsed={chunks:[{type:0x4e4f534a,data:new Uint8Array(0)}]};
 const bytes=writeGlb(parsed,doc);
 assert.deepEqual(inspectVisualImport(bytes).textures,1);
 assert.equal(inspectVisualImport(bytes).meshes,2);
 const altered=structuredClone(doc);altered.animations=[{samplers:[],channels:[]}];
 assert.throws(()=>inspectVisualImport(writeGlb(parsed,altered)),/Анимированный GLB/);
 altered.animations=[];altered.skins=[{}];
 assert.throws(()=>inspectVisualImport(writeGlb(parsed,altered)),/Скелетный GLB/);
 altered.skins=[];altered.extensionsUsed=['KHR_draco_mesh_compression'];
 assert.throws(()=>inspectVisualImport(writeGlb(parsed,altered)),/неподдерживаемые расширения/);
 altered.extensionsUsed=[];altered.meshes[0].primitives[0].targets=[{POSITION:0}];
 assert.throws(()=>inspectVisualImport(writeGlb(parsed,altered)),/morph targets/);
});

test('safe JSON keyframe track targets a real GLB mesh, persists and rejects invalid ordering',()=>{
 const recipe=readJson('recipes/visual-v2-keyframe-example.json');
 assert.ok(validates(recipe),ajv.errorsText(validates.errors));
 const {scene}=runVisualRecipe(recipe);
 assert.equal(scene.animation.clips.length,1);
 const clip=scene.animation.clips[0];
 assert.equal(clip.id,'camera-tilt-study');
 assert.equal(clip.tracks[0].target,'case.main');
 assert.deepEqual(clip.tracks[0].keys.map(k=>k.time),[0,1,2]);
 assert.deepEqual(deserializeVisualScene(JSON.stringify(scene)).animation,scene.animation);
 const broken=structuredClone(recipe);
 broken.commands[1].args.clip.tracks[0].keys[1].time=0;
 assert.throws(()=>runVisualRecipe(broken),/invalid keyframe/);
});

test('recipe security rejects unsafe material keys, SVG maps and waveform-to-numeric bindings',()=>{
 const base=structuredClone(recipes[0]);
 for(const id of ['__proto__','constructor']){
  const recipe=structuredClone(base);
  recipe.commands.push({operation:'material.set',args:{id,material:{
   type:'standard',color:'#ffffff',metalness:0,roughness:.5}}});
  assert.throws(()=>runVisualRecipe(recipe),/invalid material id/);
 }
 const dangerous=runVisualRecipe(base).scene;
 dangerous.materials.enclosure.maps={baseColor:'data:image/svg+xml;base64,PHN2Zz48c2NyaXB0Pg=='};
 assert.throws(()=>validateVisualScene(dangerous),/external\/invalid texture/);
 const frame=structuredClone(base);
 frame.commands.push({operation:'signal.bind',args:{
  target:'needle.left',signal:'left.waveform',response:'needle'}});
 assert.throws(()=>runVisualRecipe(frame),/invalid numeric binding/);
});

test('machine-readable Visual Scene and Audio PCM contract schemas validate produced real data',()=>{
 const ajv=new Ajv2020({strict:false,allErrors:true});
 const validateScene=ajv.compile(readJson('schemas/mark-visual-scene-v2.schema.json'));
 for(const recipe of recipes){
  const scene=runVisualRecipe(recipe).scene;
  assert.ok(validateScene(scene),ajv.errorsText(validateScene.errors));
 }
 const validateAudio=ajv.compile(readJson('schemas/mark-audio-stereo-frame-v1.schema.json'));
 const a=new StereoPcmAnalyzer({sampleRate:48000,fftSize:2048});
 const pcm=Float32Array.from({length:2048},(_,i)=>.25*Math.sin(2*Math.PI*600*i/48000));
 a.feed(pcm,pcm);
 assert.ok(validateAudio(a.measure()),ajv.errorsText(validateAudio.errors));
 assert.ok(validateAudio(zeroStereoFrame()),ajv.errorsText(validateAudio.errors));
});
