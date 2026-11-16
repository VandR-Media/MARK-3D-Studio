import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createTestHeadGlb} from '../src/head-fixture.js';
import {MeshEditor,sceneMeshList,mirrorPairs,SpatialHash} from '../src/mesh-core.js';
import {parseGlb,writeGlb} from '../src/glb.js';
const fixture=createTestHeadGlb();
const copy=x=>Array.from(x);
const blockData=(parsed,index)=>{
 const view=parsed.json.bufferViews[index],bin=parsed.chunks.find(x=>x.type===0x004e4942).data;
 return bin.slice(view.byteOffset||0,(view.byteOffset||0)+view.byteLength);
};
const nearest=(e,p)=>{
 let bi=0,bd=Infinity;for(let i=0;i<e.count;i++){
  const o=i*3,d=(e.positions[o]-p[0])**2+(e.positions[o+1]-p[1])**2+(e.positions[o+2]-p[2])**2;
  if(d<bd){bi=i;bd=d;}
 }return bi;
};
test('fixture is a genuinely triangulated organic head with PBR and UV',()=>{
 const p=parseGlb(fixture),e=new MeshEditor(fixture);
 assert.equal(e.count,(118+1)*(160+1));
 assert.equal(e.triangleCount,118*160*2);
 assert.ok(e.triangleCount>25000);
 assert.equal(p.json.meshes[0].primitives[0].attributes.TEXCOORD_0,2);
 assert.equal(p.json.materials.length,1);
 assert.ok(e.indices.every(i=>i<e.count));
 assert.ok(e.normals.every(Number.isFinite));
});
test('move a physical vertex through GLB export then import',()=>{
 const e=new MeshEditor(fixture),i=nearest(e,[.3,.15,.8]);
 const before=e.positions[i*3+2],orig=e.positions.slice();
 assert.equal(e.transform([i],'move','z',.14),true);
 const reopened=new MeshEditor(e.exportGlb());
 assert.ok(Math.abs(reopened.positions[i*3+2]-(before+.14))<1e-6);
 assert.equal(reopened.indices.length,e.indices.length);
 assert.equal(orig[i*3+2],before);
});
test('sculpt sphere-of-influence modifies multiple real vertices, then persists',()=>{
 const e=new MeshEditor(fixture),base=e.positions.slice(),p=[0,.02,1.02];
 e.begin();const affected=e.brush(p,.4,.75,'inflate',[0,0,0]);assert.ok(affected>2);
 e.commit();const count=base.filter((v,i)=>v!==e.positions[i]).length;
 assert.ok(count>12);
 const rt=new MeshEditor(e.exportGlb());assert.deepEqual(rt.positions,e.positions);
});
test('grab smooth pinch deform real vertices with falloff',()=>{
 const e=new MeshEditor(fixture);
 const before=e.positions.slice(),p=[.25,0,.85];
 for(const mode of ['grab','smooth','pinch']){
  e.begin();const n=e.brush(p,.55,.9,mode,[.08,0,.02]);assert.ok(n>3,mode);
  e.commit();
 }
 assert.ok(e.positions.some((x,i)=>x!==before[i]));
 assert.deepEqual(new MeshEditor(e.exportGlb()).positions,e.positions);
});
test('mirror editing preserves X symmetry and avoids moving center off plane',()=>{
 const e=new MeshEditor(fixture),pairs=mirrorPairs(e.positions);
 const i=nearest(e,[.35,.05,.8]),m=pairs[i];
 assert.ok(m>=0&&m!==i);
 e.transform([i],'move','z',.1,true);
 assert.ok(Math.abs(e.positions[i*3]+e.positions[m*3])<1e-5);
 assert.ok(Math.abs(e.positions[i*3+1]-e.positions[m*3+1])<1e-5);
 assert.ok(Math.abs(e.positions[i*3+2]-e.positions[m*3+2])<1e-5);
 const center=nearest(e,[0,.3,.9]);
 if(Math.abs(e.positions[center*3])<.002){
  e.transform([center],'move','x',.3,true);
  assert.equal(e.positions[center*3],0);
 }
});
test('undo/redo exactly restores coordinate snapshots',()=>{
 const e=new MeshEditor(fixture),initial=e.positions.slice(),i=nearest(e,[.3,.1,.85]);
 e.transform([i],'move','z',.1);const edited=e.positions.slice();
 assert.equal(e.undo(),true);assert.deepEqual(e.positions,initial);
 assert.equal(e.redo(),true);assert.deepEqual(e.positions,edited);
 e.undo();e.transform([i],'move','y',.02);
 assert.equal(e.redo(),false);
});
test('multiple edits and export/reimport preserve exact topology and untouched UV/materials',()=>{
 const original=parseGlb(fixture),e=new MeshEditor(fixture);
 const i=nearest(e,[.2,.2,.8]);
 e.transform([i],'move','z',.08,true);
 e.transform([i],'rotate','y',12,true);
 e.begin();e.brush([0,-.5,.7],.45,.6,'smooth',[0,0,0],true);e.commit();
 const result=parseGlb(e.exportGlb()),rt=new MeshEditor(e.exportGlb());
 assert.deepEqual(rt.positions,e.positions);
 assert.deepEqual(result.json.meshes,original.json.meshes);
 assert.deepEqual(result.json.materials,original.json.materials);
 assert.deepEqual(result.json.nodes,original.json.nodes);
 assert.deepEqual(blockData(result,2),blockData(original,2)); // UV binary exactly
 assert.deepEqual(blockData(result,3),blockData(original,3)); // indices binary exactly
 assert.deepEqual(rt.indices,e.indices);
 const normal=rt.normals;assert.ok(normal.every(Number.isFinite));
 assert.ok(normal.every(x=>Math.abs(x)<=1.0001));
 for(let a=0;a<3;a++)assert.ok(result.json.accessors[0].min[a]<=result.json.accessors[0].max[a]);
});
test('unsupported skinned or morph targets are explicitly blocked',()=>{
 const parsed=parseGlb(fixture),sk=structuredClone(parsed.json);sk.nodes[0].skin=0;
 assert.ok(sceneMeshList(sk)[0].reason.includes('skinning'));
 assert.throws(()=>new MeshEditor(writeGlb(parsed,sk)),/skinning/);
 const morph=structuredClone(parsed.json);
 morph.meshes[0].primitives[0].targets=[{POSITION:0}];
 assert.throws(()=>new MeshEditor(writeGlb(parsed,morph)),/morph/);
});
test('shared mesh instances, shared POSITION accessors and unsupported normals are blocked',()=>{
 const p=parseGlb(fixture);
 const multi=structuredClone(p.json);multi.nodes.push({name:'Other instance',mesh:0});
 assert.throws(()=>new MeshEditor(writeGlb(p,multi)),/общий меш/);
 const shared=structuredClone(p.json);
 shared.meshes[0].primitives.push(structuredClone(shared.meshes[0].primitives[0]));
 assert.throws(()=>new MeshEditor(writeGlb(p,shared)),/общий POSITION/);
 const noNormals=structuredClone(p.json);delete noNormals.meshes[0].primitives[0].attributes.NORMAL;
 assert.throws(()=>new MeshEditor(writeGlb(p,noNormals)),/POSITION и NORMAL/);
});
test('spatial search picks only nearby vertices and supports 25k+ triangles',()=>{
 const e=new MeshEditor(fixture),h=new SpatialHash(e.positions,.25),hits=h.query([0,0,1],.25);
 assert.ok(e.triangleCount>25000);assert.ok(hits.length>0&&hits.length<e.count/4);
 const any=hits[0],x=e.positions[any*3],y=e.positions[any*3+1],z=e.positions[any*3+2];
 assert.ok((x*x+y*y+(z-1)**2)<=.25**2+1e-6);
});
test('repeat export/import of edited GLB does not drift coordinates or lose metadata',()=>{
 let e=new MeshEditor(fixture),i=nearest(e,[.23,.12,.88]);
 e.transform([i],'move','z',.0625);let first=e.exportGlb();
 for(let j=0;j<3;j++){e=new MeshEditor(first);first=e.exportGlb();}
 const rt=new MeshEditor(first),p=parseGlb(first),orig=parseGlb(fixture);
 assert.ok(Math.abs(rt.positions[i*3+2]-e.positions[i*3+2])<1e-7);
 assert.deepEqual(p.json.materials,orig.json.materials);
 assert.deepEqual(blockData(p,2),blockData(orig,2));
});
