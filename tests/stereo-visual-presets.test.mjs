import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';

const read = path => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const collection = read('../presets/mark-stereo-visual-collection-v1.json');
const schema = read('../schemas/mark-stereo-visual-collection-v1.schema.json');
const sixBands=['left.low','left.mid','left.high','right.low','right.mid','right.high'];
const sixIds=['analog-studio','spectrum-matrix','neon-towers','hi-fi-deck','pulse-rings','oscilloscope'];

test('all 6 real left/right 3-band hybrid preset contracts obey JSON schema',()=>{
 const ajv=new Ajv2020({strict:false,allErrors:true});
 const valid=ajv.compile(schema);
 assert.equal(valid(collection),true,JSON.stringify(valid.errors));
 assert.deepEqual(collection.presets.map(p=>p.id),sixIds);
 assert.equal(collection.signalSource,'decoded-pcm-not-microphone');
});

test('all 6 presets map independent stereo LOW/MID/HIGH to real 2D and 3D layers',()=>{
 for(const preset of collection.presets){
  assert.deepEqual(preset.layers.map(x=>x.kind).sort(),['2d','3d'],preset.id);
  assert.deepEqual(
   preset.bindings.filter(b=>b.response==='band-amplitude').map(b=>b.signal).sort(),
   [...sixBands].sort(),preset.id
  );
  assert.deepEqual(preset.qualityProfiles,['eco','normal','high']);
  assert.ok(preset.layers.every(x=>x.elements.length>=2));
 }
});

test('oscilloscope requires actual independent L and R PCM traces',()=>{
 const osc=collection.presets.find(x=>x.id==='oscilloscope');
 assert.deepEqual(
  osc.bindings.filter(b=>b.response==='pcm-trace').map(b=>b.signal),
  ['left.waveform','right.waveform']
 );
 for(const preset of collection.presets.filter(p=>p.id!=='oscilloscope')){
  assert.equal(preset.bindings.some(b=>b.response==='pcm-trace'),false);
 }
});

test('schema rejects missing channel, absent renderer layer, or a made-up audio signal',()=>{
 const ajv=new Ajv2020({strict:false,allErrors:true});
 const valid=ajv.compile(schema);
 const draft=structuredClone(collection);
 draft.presets[0].layers.pop();
 assert.equal(valid(draft),false);
 const invalid=structuredClone(collection);
 invalid.presets[1].bindings[0].signal='randomized.fakeBass';
 assert.equal(valid(invalid),false);
});
