import test from 'node:test';
import assert from 'node:assert/strict';
import {PNG} from 'pngjs';
import {parseGlb,writeGlb} from '../src/glb.js';
import {buildRiggedFixture} from '../scripts/pro-studio-glb-fixtures.mjs';
import {compareGlbTextures} from '../src/pro-studio/glb-texture-qa.js';
import {createPreviewMarkscene,openPreviewMarkscene,exportEditedSourceGlb}
 from '../src/pro-studio/markscene-v3-preview.js';

const sample=buildRiggedFixture().bytes;
const mutate=fn=>{
 const p=parseGlb(sample),d=structuredClone(p.json);
 fn(d,p);return writeGlb(p,d);
};
const keys=x=>x.errors.map(e=>e.key).join(' | ');

test('decoded PNG fixture uses RGBA pixels, PBR texture slot, UV set and sampler',()=>{
 const x=compareGlbTextures(sample,sample);
 assert.equal(x.status,'pass_supported_png',JSON.stringify(x));
 assert.equal(x.stats.textureSlots,1);
 assert.equal(x.stats.imagesDecoded,2);
 assert.equal(x.stats.pixelsCompared,4);
 assert.equal(x.stats.samplerChecks,1);
 assert.equal(x.stats.uvTransformChecks,1);
 assert.deepEqual(x.unverified,[]);
});
test('same pixel colors with PNG recompression and data URI count as equivalent',()=>{
 const doc=parseGlb(sample).json,parsed=parseGlb(sample);
 const img=doc.images[0],view=doc.bufferViews[img.bufferView];
 const binary=parsed.chunks.find(x=>x.type===0x004e4942).data;
 const old=PNG.sync.read(Buffer.from(binary.slice(view.byteOffset,view.byteOffset+view.byteLength)));
 const png=PNG.sync.write(old,{colorType:6});
 const changed=mutate(d=>{d.images[0]={uri:'data:image/png;base64,'+Buffer.from(png).toString('base64')};});
 const x=compareGlbTextures(sample,changed);
 assert.equal(x.status,'pass_supported_png',JSON.stringify(x));
});
test('GLTFExporter-style 1-3 zero alignment bytes after PNG IEND preserve exact pixels',()=>{
 const p=parseGlb(sample),doc=p.json,view=doc.bufferViews[doc.images[0].bufferView];
 const bin=p.chunks.find(x=>x.type===0x004e4942).data;
 const original=Buffer.from(bin.slice(view.byteOffset,view.byteOffset+view.byteLength));
 for(const pad of [1,2,3]){
  const altered=mutate(d=>{
   d.images[0]={uri:'data:image/png;base64,'+
    Buffer.concat([original,Buffer.alloc(pad)]).toString('base64')};
  });
  const result=compareGlbTextures(sample,altered);
  assert.equal(result.status,'pass_supported_png',JSON.stringify(result));
 }
 const illegal=mutate(d=>{
  d.images[0]={uri:'data:image/png;base64,'+
   Buffer.concat([original,Buffer.from([0,0,127])]).toString('base64')};
 });
 const result=compareGlbTextures(sample,illegal);
 assert.equal(result.status,'fail');
 assert.match(keys(result),/invalid/);
});
test('valid but altered RGBA pixels fail even if image dimensions match',()=>{
 const doc=parseGlb(sample).json,parsed=parseGlb(sample),view=doc.bufferViews[doc.images[0].bufferView];
 const binary=parsed.chunks.find(x=>x.type===0x004e4942).data;
 const old=PNG.sync.read(Buffer.from(binary.slice(view.byteOffset,view.byteOffset+view.byteLength)));
 old.data[0]=old.data[0]===255?0:255;
 const png=PNG.sync.write(old,{colorType:6});
 const changed=mutate(d=>{d.images[0]={uri:'data:image/png;base64,'+Buffer.from(png).toString('base64')};});
 const x=compareGlbTextures(sample,changed);
 assert.equal(x.status,'fail');
 assert.match(keys(x),/rgbaPixels/);
 assert.equal(x.errors.find(x=>x.key.includes('rgbaPixels')).width,2);
});
test('texture sampler, UV set, offsets and rotation mismatches are caught',()=>{
 for(const [change,key] of [
  [d=>{d.samplers[0].wrapS=33071;},'sampler'],
  [d=>{d.materials[0].pbrMetallicRoughness.baseColorTexture.texCoord=1;},'uvTransform'],
  [d=>{d.materials[0].pbrMetallicRoughness.baseColorTexture.extensions={
   KHR_texture_transform:{offset:[.2,.1],scale:[1,1],rotation:.1}};},'uvTransform'],
  [d=>{delete d.materials[0].pbrMetallicRoughness.baseColorTexture;},'presence']
 ]){
  const changed=mutate(change);
  const result=compareGlbTextures(sample,changed);
  assert.equal(result.status,'fail',JSON.stringify(result));
  assert.match(keys(result),new RegExp(key));
 }
});
test('PNG texture pixels survive experimental .markscene save/reopen and changed TRS/PBR GLB',async()=>{
 const native=await createPreviewMarkscene(sample,{
  edits:{nodeTransforms:{'1':{translation:[.25,0,0]}},
   materialPbr:{'0':{roughnessFactor:.25}}}
 });
 const reopened=await openPreviewMarkscene(native.archive);
 const exported=await exportEditedSourceGlb(reopened);
 const x=compareGlbTextures(sample,exported.glb);
 assert.equal(x.status,'pass_supported_png',JSON.stringify(x));
});
test('JPEG and unknown image decoders are honest partial instead of false pass',()=>{
 const changed=mutate(d=>{d.images[0]={uri:'data:image/jpeg;base64,'+
   Buffer.from('not-a-real-jpeg').toString('base64')};});
 const x=compareGlbTextures(sample,changed);
 assert.equal(x.status,'partial_unverified');
 assert.equal(x.stats.unsupportedTextures,1);
 assert.ok(x.unverified.some(v=>v.includes('JPEG')||v.includes('image/jpeg')));
});
test('malformed image source and corrupted buffer view fail safely',()=>{
 const broken=mutate(d=>{d.bufferViews[d.images[0].bufferView].byteLength=65535;});
 const x=compareGlbTextures(sample,broken);
 assert.equal(x.status,'fail');
 assert.match(keys(x),/invalid/);
 const untrusted=mutate(d=>{d.images[0]={uri:'https://evil.invalid/image.png'};});
 assert.equal(compareGlbTextures(sample,untrusted).status,'fail');
});
test('large PNG dimension triggers budget before decompression',()=>{
 const p=parseGlb(sample),d=structuredClone(p.json);
 const view=d.bufferViews[d.images[0].bufferView],bin=p.chunks.find(c=>c.type===0x004e4942).data.slice();
 new DataView(bin.buffer).setUint32(view.byteOffset+16,30000,false);
 const altered=writeGlb({json:d,chunks:p.chunks.map(c=>({type:c.type,data:c.type===0x004e4942?bin:c.data}))},d);
 assert.equal(compareGlbTextures(sample,altered).status,'fail');
});
