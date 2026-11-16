import test from 'node:test';
import assert from 'node:assert/strict';
import {makeAnatomicalChildHead} from '../src/anatomical-base.js';
import {runGeometryRecipe} from '../src/professional-api.js';
import {encodeMark3d,decodeMark3d} from '../src/compact-project.js';
import {createHash} from 'node:crypto';
import {parseGlb} from '../src/glb.js';
import {readFileSync} from 'node:fs';
const sha=x=>createHash('sha256').update(x).digest('hex');
test('new anatomically distinct quad surface has real 5 closed socket/oral/nostril cavities',()=>{
 const m=makeAnatomicalChildHead({rings:94,columns:144});
 const a=m.inspect();
 assert.ok(a.vertices>12000&&a.triangles>20000);
 assert.equal(a.boundaryEdges,0,'all cavities must have actual depth and closed inside caps');
 assert.equal(a.nonManifoldEdges,0);
 assert.equal(a.degenerateFaces,0);
 assert.ok(a.faces<a.triangles,'native QUADS must exist instead of an entirely triangulated shell');
 assert.deepEqual(Object.keys(m.regions).sort(),[
 'eye_left_rim','eye_right_rim','mouth_rim','nostril_left_rim','nostril_right_rim'
 ].sort());
 for(const [name,ids] of Object.entries(m.regions)){
  assert.ok(ids.length>=5,'rim '+name+' must have a real contiguous polygon loop');
  assert.ok(ids.every(id=>m.vertices.has(id)));
 }
 for(const [name,item] of Object.entries(m.landmarks))assert.ok(m.vertices.has(item.vertex),name);
 const stable=sha(m.toGlb());
 const restored=decodeMark3d(encodeMark3d(m)).mesh;
 assert.equal(sha(restored.toGlb()),stable);
 assert.deepEqual(restored.landmarks,m.landmarks);
 assert.deepEqual(restored.regions,m.regions);
});
test('JSON creates anatomy and sculpts real eye, nose, lip and chin regions with independent GLB checkpoints',()=>{
 const recipe=JSON.parse(readFileSync('recipes/anatomical-head-stage2-demo.json','utf8'));
 const result=runGeometryRecipe(recipe,{compact:true});
 assert.ok(result.inspection.triangles>25000);
 assert.ok(result.events.every(e=>e.status==='ok'));
 const initial=result.checkpoints.get('anatomical-before');
 const changed=result.checkpoints.get('anatomical-after');
 assert.ok(initial&&changed);
 assert.notEqual(sha(initial.glb),sha(changed.glb));
 assert.equal(sha(changed.glb),sha(result.glb));
 const fromBinary=decodeMark3d(result.project).mesh;
 assert.equal(sha(fromBinary.toGlb()),sha(result.glb));
 assert.equal(fromBinary.inspect().boundaryEdges,0);
 assert.equal(fromBinary.inspect().nonManifoldEdges,0);
 assert.ok(fromBinary.history.some(h=>h.kind==='coordinates'));
 assert.ok(fromBinary.landmarks.nose_tip.vertex.startsWith('v'));
 const meta=parseGlb(result.glb).json;
 assert.ok(meta.meshes?.length>=1);
});
