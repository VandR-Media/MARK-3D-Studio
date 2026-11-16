import test from 'node:test';
import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {EditableMesh} from '../src/professional-geometry.js';
import {encodeMark3d,decodeMark3d,migrateLegacyProject} from '../src/compact-project.js';
import {createHash} from 'node:crypto';
const sha=data=>createHash('sha256').update(data).digest('hex');
const tetra={positions:[0,0,0,1,0,0,0,1,0,0,0,1],uvs:[0,0,1,0,0,1,1,1],indices:[0,2,1,0,1,3,0,3,2,1,2,3]};
function meshGrid(n=160){
 const p=[],uv=[],indices=[];
 for(let y=0;y<=n;y++)for(let x=0;x<=n;x++){
  const X=(x/n-.5)*2,Y=(y/n-.5)*2;
  p.push(X,Y,.025*Math.sin(X*3)*Math.cos(Y*3));uv.push(x/n,y/n);
 }
 for(let y=0;y<n;y++)for(let x=0;x<n;x++){
  const a=y*(n+1)+x,b=a+1,c=a+n+1,d=c+1;
  indices.push(a,b,d,a,d,c);
 }
 return EditableMesh.fromGeometry({positions:p,uvs:uv,indices},{name:'50k stress mesh'});
}
test('binary MARK3D v2 roundtrips exact stable IDs, UV, faces, material and editable GLB',()=>{
 const m=EditableMesh.fromGeometry(tetra,{name:'Original',
 material:{name:'Skin',color:[.67,.38,.28,1],roughness:.87,metallic:.01}});
 const id=[...m.vertices.keys()][0],f=[...m.faces.keys()][0];
 m.select([id]);m.setMask('safe',[id],.8);
 m.moveSelected([0,0,.06]);m.faceSubdivide(f);
 const bytes=encodeMark3d(m,{includeUndo:true});
 assert.equal(String.fromCharCode(...bytes.subarray(0,8)),'MARK3D02');
 const copy=decodeMark3d(bytes).mesh;
 assert.deepEqual([...m.vertices.keys()],[...copy.vertices.keys()]);
 assert.deepEqual([...m.faces.keys()],[...copy.faces.keys()]);
 assert.deepEqual([...m._edgeIds],[...copy._edgeIds]);
 assert.deepEqual(copy.masks.get('safe').get(id),.8);
 assert.deepEqual(copy.material,m.material);
 assert.equal(sha(copy.toGlb()),sha(m.toGlb()));
 assert.equal(copy.undo(),true,'structural undo survived binary save');
 assert.equal(copy.undo(),true,'coordinate delta undo survived binary save');
 assert.equal(copy.redo(),true);
 assert.equal(copy.redo(),true);
 assert.equal(sha(copy.toGlb()),sha(m.toGlb()));
});
test('20 local strokes store exactly sparse position changes and remain reversible after load',()=>{
 const m=EditableMesh.fromGeometry(tetra);
 const first=sha(m.toGlb());
 for(let i=0;i<20;i++)m.brush({center:[0,0,0],radius:.2,strength:.2,mode:'grab',delta:[0,0,.0002]});
 assert.equal(m.history.length,20);
 assert.ok(m.history.every(h=>h.kind==='coordinates'&&h.changes.length===1));
 const changed=sha(m.toGlb()),bytes=encodeMark3d(m),copy=decodeMark3d(bytes).mesh;
 assert.equal(changed,sha(copy.toGlb()));
 for(let i=0;i<20;i++)assert.equal(copy.undo(),true);
 assert.equal(sha(copy.toGlb()),first);
 for(let i=0;i<20;i++)assert.equal(copy.redo(),true);
 assert.equal(sha(copy.toGlb()),changed);
});
test('migration of mark3d/0.1 JSON with history, masks and IDs is lossless for supported input',()=>{
 const m=EditableMesh.fromGeometry(tetra),ids=[...m.vertices.keys()];
 m.setMask('lip',ids.slice(0,2),.5);m.select(ids.slice(0,2));
 m.moveSelected([0,0,.04]);
 const legacy=JSON.stringify(m.toProject({includeUndo:true}));
 const converted=migrateLegacyProject(legacy);
 assert.equal(converted.migrated,true);
 const newer=decodeMark3d(converted.bytes).mesh;
 assert.deepEqual([...newer.vertices.keys()],ids);
 assert.equal(newer.masks.get('lip').size,2);
 assert.equal(sha(newer.toGlb()),sha(m.toGlb()));
 assert.equal(newer.undo(),true);
});
test('checksum and section validation reject tampered files',()=>{
 const m=EditableMesh.fromGeometry(tetra);
 const bytes=encodeMark3d(m),broken=bytes.slice();
 broken[broken.length-4]^=0x78;
 assert.throws(()=>decodeMark3d(broken));
 assert.throws(()=>decodeMark3d(new Uint8Array([1,2,3])));
});
test('approx 50k triangles + ten local edits fit <= 15MB binary without losing undo',()=>{
 const t0=performance.now(),m=meshGrid(158),loadMs=performance.now()-t0;
 const original=sha(m.toGlb());
 const editStart=performance.now();
 for(let i=0;i<10;i++)m.brush({center:[.15,.2,0],radius:.09,strength:.35,mode:'grab',delta:[0,0,.0005]});
 const editMs=performance.now()-editStart;
 const begin=performance.now(),bytes=encodeMark3d(m),saveMs=performance.now()-begin;
 const readStart=performance.now(),copy=decodeMark3d(bytes).mesh,readMs=performance.now()-readStart;
 assert.equal(m.inspect().triangles,158*158*2);
 assert.ok(bytes.byteLength<=15*1024*1024,'Binary project above 15 MiB: '+bytes.length);
 assert.equal(copy.history.length,10);
 const changed=sha(copy.toGlb());assert.notEqual(original,changed);
 for(let i=0;i<10;i++)copy.undo();
 assert.equal(sha(copy.toGlb()),original);
 console.log('BENCH 50k '+JSON.stringify({triangles:158*158*2,bytes:bytes.length,
  loadMs,editMsPerStroke:editMs/10,saveMs,readMs}));
});
