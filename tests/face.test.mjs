import test from 'node:test';
import assert from 'node:assert/strict';
import {MeshEditor} from '../src/mesh-core.js';
import {createTestHeadGlb} from '../src/head-fixture.js';
import {deformFace,FACE_PARAMETERS} from '../src/face-studio.js';
import {parseGlb} from '../src/glb.js';

const source=createTestHeadGlb();
test('all 16 face controls actually modify contiguous real POSITION',()=>{
 for(const [name] of FACE_PARAMETERS){
  const e=new MeshEditor(source),base=e.positions.slice();
  assert.equal(deformFace(e,name,.65),true,'Expected deformation for '+name);
  assert.ok(e.positions.some((x,i)=>x!==base[i]),name);
  const rt=new MeshEditor(e.exportGlb());
  assert.deepEqual(rt.positions,e.positions,'Persisted coordinates for '+name);
  assert.equal(parseGlb(e.exportGlb()).json.materials.length,1);
 }
});
test('Face Studio undo/redo restores exact edited coordinates',()=>{
 const e=new MeshEditor(source),start=e.positions.slice();
 deformFace(e,'noseLength',.55);const changed=e.positions.slice();
 assert.ok(e.undo());assert.deepEqual(e.positions,start);
 assert.ok(e.redo());assert.deepEqual(e.positions,changed);
});
test('Face Studio preserves local X symmetry when modifying nose or cheeks',()=>{
 const e=new MeshEditor(source),before=e.positions.slice();
 deformFace(e,'cheeks',.5);deformFace(e,'noseWidth',.4);
 // Pairwise fixture generated with angles mirrored around X=0.
 const ring=160;
 for(let i=1;i<118;i+=11)for(const j of [5,12,25,39,52]){
  const a=i*ring+j,b=i*ring+ring-j;
  assert.ok(Math.abs(e.positions[a*3]+e.positions[b*3])<1e-4);
  assert.ok(Math.abs(e.positions[a*3+1]-e.positions[b*3+1])<1e-4);
  assert.ok(Math.abs(e.positions[a*3+2]-e.positions[b*3+2])<1e-4);
 }
});
test('Flatten, Crease, Clay, Relax sculpt actual geometry with selectable falloff and undo',()=>{
 for(const brush of ['flatten','crease','clay','relax']){
  const e=new MeshEditor(source),before=e.positions.slice();
  e.begin();const n=e.brush([0,-.08,1.0],.42,.9,brush,[0,0,0],false,'sharp');
  assert.ok(n>0,brush);assert.ok(e.commit(),brush);
  assert.ok(e.positions.some((x,i)=>x!==before[i]),brush);
  assert.deepEqual(new MeshEditor(e.exportGlb()).positions,e.positions);
  assert.ok(e.undo());assert.deepEqual(e.positions,before);
 }
});
test('Reject invalid brush profiles and impossible face controls',()=>{
 const e=new MeshEditor(source);
 assert.throws(()=>deformFace(e,'unknown',.2),/неизвестный/);
 assert.throws(()=>deformFace(e,'noseLength',3),/значение/);
 e.begin();assert.throws(()=>e.brush([0,0,1],.3,.6,'clay',[0,0,0],false,'magic'),/профиль/);e.cancel();
});
