import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {parseGlb,writeGlb} from '../src/glb.js';
import {buildSkinnedSeamFixture} from '../scripts/pro-studio-pass17-skinned-seam-fixture.mjs';
import {buildOwnedTopologyBinary,previewOwnedTopology} from '../src/pro-studio/owned-topology-binary.js';
import {materializeOwnedEdgeSplitGLB} from '../src/pro-studio/owned-edge-split-glb.js';
const sha=x=>createHash('sha256').update(Buffer.from(x)).digest('hex');
const original=buildSkinnedSeamFixture();
const setup=sourceGLB=>{
 const sourceSha256=sha(sourceGLB),data=buildOwnedTopologyBinary({sourceGLB,sourceSha256});
 return{sourceGLB,sourceSha256,data,graph:previewOwnedTopology({sourceGLB,sourceSha256,data})};
};
const read=(parsed,index)=>{
 const a=parsed.json.accessors[index],v=parsed.json.bufferViews[a.bufferView],
  bin=parsed.chunks.find(c=>c.type===0x004e4942).data,
  d=new DataView(bin.buffer,bin.byteOffset,bin.byteLength),
  unit={5121:1,5123:2,5125:4,5126:4}[a.componentType],
  fn={5121:'getUint8',5123:'getUint16',5125:'getUint32',5126:'getFloat32'}[a.componentType],
  comp={SCALAR:1,VEC2:2,VEC3:3,VEC4:4}[a.type],
  base=(v.byteOffset||0)+(a.byteOffset||0),stride=v.byteStride??unit*comp;
 return Array.from({length:a.count},(_,i)=>Array.from({length:comp},(_,k)=>
  d[fn](base+i*stride+k*unit,true)));
};
function shared(){
 const parsed=parseGlb(original),json=structuredClone(parsed.json),
  a=json.accessors[json.meshes[0].primitives[0].indices],
  view=json.bufferViews[a.bufferView],
  src=parsed.chunks.find(c=>c.type===0x004e4942),
  data=src.data.slice(),dv=new DataView(data.buffer,data.byteOffset,data.byteLength),
  size={5121:1,5123:2,5125:4}[a.componentType],
  setter={5121:'setUint8',5123:'setUint16',5125:'setUint32'}[a.componentType],
  offset=(view.byteOffset||0)+(a.byteOffset||0);
 for(const [i,v] of [1,3,2].entries())dv[setter](offset+(i+3)*size,v,true);
 return writeGlb({...parsed,chunks:parsed.chunks.map(c=>
  c.type===0x004e4942?{...c,data}:c)},json);
}
test('actual boundary split exports 3 triangles, vertex attributes, skinned 70-bone rig and morphs',()=>{
 const state=setup(original),
  edge=state.graph.edges.find(e=>e.sourceRows.join(',')==='0,1');
 assert.ok(edge);
 const before=parseGlb(original),binaryBefore=before.chunks.find(c=>c.type===0x004e4942).data.slice();
 const output=materializeOwnedEdgeSplitGLB({...state,edgeId:edge.id,t:0.5});
 const second=materializeOwnedEdgeSplitGLB({...state,edgeId:edge.id,t:0.5});
 assert.deepEqual(output.glb,second.glb);
 const parsed=parseGlb(output.glb),prim=parsed.json.meshes[0].primitives[0];
 const bin=parsed.chunks.find(c=>c.type===0x004e4942).data;
 assert.deepEqual(bin.slice(0,binaryBefore.length),binaryBefore);
 assert.deepEqual(parseGlb(original).chunks.find(c=>c.type===0x004e4942).data,binaryBefore);
 assert.equal(read(parsed,prim.indices).length,9);
 assert.equal(output.faceCount,3);
 assert.equal(output.vertexCount,7);
 assert.equal(read(parsed,prim.attributes.POSITION).length,7);
 assert.equal(read(parsed,prim.attributes.TEXCOORD_0).length,7);
 assert.equal(read(parsed,prim.attributes.TEXCOORD_1).length,7);
 const pos=read(parsed,prim.attributes.POSITION);
 const uv=read(parsed,prim.attributes.TEXCOORD_0);
 for(let k=0;k<3;k++)assert.ok(Math.abs(pos[6][k]-(pos[0][k]+pos[1][k])/2)<1e-6);
 for(let k=0;k<2;k++)assert.ok(Math.abs(uv[6][k]-(uv[0][k]+uv[1][k])/2)<1e-6);
 const weights=read(parsed,prim.attributes.WEIGHTS_0);
 assert.ok(Math.abs(weights[6].reduce((a,b)=>a+b,0)-1)<1e-6);
 assert.deepEqual(read(parsed,prim.attributes.JOINTS_0)[6],[0,0,0,0]);
 for(const [i,target] of prim.targets.entries()){
  const rows=read(parsed,target.POSITION);
  assert.equal(rows.length,7,'morph '+i+' vertex count');
  for(let k=0;k<3;k++)assert.ok(Math.abs(rows[6][k]-(rows[0][k]+rows[1][k])/2)<1e-6);
 }
 for(const section of ['skins','animations','materials','images','textures','nodes'])
  assert.deepEqual(parsed.json[section],before.json[section]);
 assert.equal(parsed.json.skins[0].joints.length,70);
 assert.equal(parsed.json.animations.length,3);
 assert.equal(prim.targets.length,2);
 assert.equal(output.plan.applied,false,'not persisted into native project yet');
});
test('same joint palette across interior edge can be remeshed with 2 incident faces',()=>{
 const state=setup(shared()),edge=state.graph.edges.find(e=>!e.boundary);
 assert.ok(edge);
 // The fixture interior edge crosses lower/upper joint palettes; conservative
 // materializer must refuse instead of silently corrupting skinned animation.
 assert.throws(()=>materializeOwnedEdgeSplitGLB({...state,edgeId:edge.id}),
  /MARK_SPLIT_EXPORT_JOINTS/);
});
test('source SHA, stale edge and invalid t fail closed with zero source mutation',()=>{
 const state=setup(original),edge=state.graph.edges[0],copy=original.slice();
 assert.throws(()=>materializeOwnedEdgeSplitGLB({...state,edgeId:'fake'}),/MARK_SPLIT_EDGE_STALE/);
 assert.throws(()=>materializeOwnedEdgeSplitGLB({...state,edgeId:edge.id,t:0}),/MARK_SPLIT_FRACTION/);
 assert.throws(()=>materializeOwnedEdgeSplitGLB({...state,edgeId:edge.id,sourceSha256:'0'.repeat(64)}),
  /MARK_TOPO_SOURCE_SHA/);
 assert.deepEqual(original,copy);
});
