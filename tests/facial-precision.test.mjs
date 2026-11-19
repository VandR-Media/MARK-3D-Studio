import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {makeAnatomicalChildHead} from '../src/anatomical-base.js';
import {adjustFaceContour,applySculptStroke} from '../src/face-precision.js';
import {previewFacialPose} from '../src/face-pose-preview.js';
import {encodeMark3d,decodeMark3d} from '../src/compact-project.js';
import {runGeometryRecipe} from '../src/professional-api.js';
const sha=x=>createHash('sha256').update(x).digest('hex');
test('geodesic eyelid region sculpt preserves locked lip, stable IDs and true binary mesh state',()=>{
 const mesh=makeAnatomicalChildHead({rings:94,columns:144});
 const ids=[...mesh.vertices.keys()],name='upper_eyelid_left';
 const lip=new Map(mesh.regions.mouth_lower_lip.map(id=>[id,[...mesh.vertices.get(id).position]]));
 const original=sha(mesh.toGlb());
 const edited=adjustFaceContour(mesh,{region:name,delta:[0,.012,-.006],
   falloff:.08,strength:.7,lockedRegions:['mouth_lower_lip']});
 assert.ok(edited.moved>0&&edited.sources>0);
 assert.notEqual(sha(mesh.toGlb()),original);
 for(const [id,p] of lip)assert.deepEqual(mesh.vertices.get(id).position,p,'locked lip must not be displaced');
 assert.deepEqual([...mesh.vertices.keys()],ids);
 assert.equal(mesh.undo(),true);assert.equal(sha(mesh.toGlb()),original);
 assert.equal(mesh.redo(),true);
 const restored=decodeMark3d(encodeMark3d(mesh)).mesh;
 assert.equal(sha(restored.toGlb()),sha(mesh.toGlb()));
 assert.throws(()=>adjustFaceContour(mesh,{region:name,delta:[0,.02,0],lockedRegions:[name]}));
});
test('continuous face stroke groups 6 samples in one undo with atomic failure rollback',()=>{
 const mesh=makeAnatomicalChildHead({rings:90,columns:144});
 const nose=mesh.vertices.get(mesh.landmarks.nose_tip.vertex).position;
 const baseline=sha(mesh.toGlb()),historyBefore=mesh.history.length;
 const points=Array.from({length:6},(_,i)=>[nose[0]+i*.001,nose[1],nose[2]]);
 const result=applySculptStroke(mesh,{points,radius:.12,strength:.2,mode:'grab',delta:[0,0,.003]});
 assert.equal(result.samples,6);
 assert.equal(result.historyEntriesAdded,1);
 assert.equal(mesh.history.length,historyBefore+1);
 assert.ok(result.verticesChanged>2);
 const after=sha(mesh.toGlb());assert.notEqual(after,baseline);
 assert.equal(mesh.undo(),true);assert.equal(sha(mesh.toGlb()),baseline);
 assert.equal(mesh.redo(),true);assert.equal(sha(mesh.toGlb()),after);
 const failedBefore=sha(mesh.toGlb()),count=mesh.history.length;
 assert.throws(()=>applySculptStroke(mesh,{points:[nose,[99,99,99]],radius:.12,strength:.2,delta:[0,0,.003]}));
 assert.equal(mesh.history.length,count);
 assert.equal(sha(mesh.toGlb()),failedBefore,'failed compound stroke must restore exact GLB');
});
test('JSON API exercises actual facial contour and grouped sculpt strokes',()=>{
 const m=makeAnatomicalChildHead({rings:90,columns:144});
 const nose=m.vertices.get(m.landmarks.nose_tip.vertex).position;
 const recipe={schema:'mark-geometry/0.1',project:{id:'precision-face-test',base:'anatomical-child-head-v1'},
  commands:[
   {operation:'face.adjustContour',parameters:{region:'upper_eyelid_right',delta:[0,.004,0],falloff:.08}},
   {operation:'sculpt.stroke',parameters:{points:[nose,nose],radius:.16,strength:.2,delta:[0,0,.001]}}
  ]};
 // With deterministic head seed based on default high-resolution anatomy.
 const result=runGeometryRecipe(recipe,{compact:true});
 assert.ok(result.events.every(x=>x.status==='ok'));
 assert.ok(result.mesh.history.some(h=>h.label.startsWith('sculpt.stroke.')));
 assert.equal(sha(decodeMark3d(result.project).mesh.toGlb()),sha(result.glb));
});

test('bounded facial blink, smile and mouth-open previews each alter true geometry and undo losslessly',()=>{
 const mesh=makeAnatomicalChildHead({rings:94,columns:144});
 const base=sha(mesh.toGlb());
 for(const pose of ['blink','smile','mouth-open']){
  const before=sha(mesh.toGlb());
  const result=previewFacialPose(mesh,{pose,amount:.5});
  assert.ok(result.verticesChanged>2,pose);
  const after=sha(mesh.toGlb());
  assert.notEqual(after,before,pose+' must modify XYZ');
  assert.equal(mesh.inspect().degenerateFaces,0);
  assert.equal(mesh.undo(),true);
  assert.equal(sha(mesh.toGlb()),before,'Undo '+pose+' must restore GLB exactly');
  assert.equal(mesh.redo(),true);
  assert.equal(sha(mesh.toGlb()),after);
  assert.equal(mesh.undo(),true);
 }
 assert.equal(sha(mesh.toGlb()),base);
});
