import test from 'node:test';
import assert from 'node:assert/strict';
import {makeAnatomicalChildHead} from '../src/anatomical-base.js';
import {runGeometryRecipe} from '../src/professional-api.js';
import {encodeMark3d,decodeMark3d} from '../src/compact-project.js';
import {createHash} from 'node:crypto';
import {parseGlb} from '../src/glb.js';
import {projectPoint,configureLandmarks,compareReference,adjustReferencePoint} from '../src/reference-modeling.js';
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
 for(const name of [
  'eye_left_rim','eye_right_rim','mouth_rim','nostril_left_rim','nostril_right_rim',
  'eye_left','eye_right','upper_eyelid_left','upper_eyelid_right',
  'lower_eyelid_left','lower_eyelid_right','mouth_upper_lip','mouth_lower_lip',
  'nose_alar_left','nose_alar_right','cheeks','chin','jaw'
 ])assert.ok(m.regions[name]?.length>=4,'Expected actual topology region '+name);
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

test('private normalized reference control points move exact mesh-linked landmark and lower front-view RMSE',()=>{
 const mesh=makeAnatomicalChildHead({rings:90,columns:144});
 const vertex=mesh.vertices.get(mesh.landmarks.nose_tip.vertex);
 const baseline=projectPoint(vertex.position,{view:'front',scale:.3,offset:[.5,.5]});
 const target=[baseline[0]+.007,baseline[1]-.009];
 configureLandmarks(mesh,{view:'front',scale:.3,offset:[.5,.5],points:{nose_tip:target}});
 const initial=compareReference(mesh,'front').rmse;
 assert.ok(initial>.005);
 const affected=adjustReferencePoint(mesh,{view:'front',name:'nose_tip',radius:.15,strength:1});
 assert.ok(affected.touched>1);
 const final=compareReference(mesh,'front').rmse;
 assert.ok(final<initial*.2,'Fitting must improve real linked 3D geometry');
 const restored=decodeMark3d(encodeMark3d(mesh)).mesh;
 assert.deepEqual(restored.referenceViews,mesh.referenceViews);
 assert.equal(compareReference(restored,'front').rmse,final);
 assert.throws(()=>configureLandmarks(mesh,{view:'front',points:{wrong:[.5,.5]}}));
});

test('no radial triangle fan closes eye or nostril cavities: deep lids use only quad strips',()=>{
 const m=makeAnatomicalChildHead({rings:94,columns:144});
 const deepFaces=[...m.faces.values()].filter(f=>{
  const p=f.vertices.map(id=>m.vertices.get(id).position);
  const avg=p.reduce((a,v)=>[a[0]+v[0],a[1]+v[1],a[2]+v[2]],[0,0,0]).map(x=>x/p.length);
  const nearEye=Math.abs(avg[0])>.19&&Math.abs(avg[0])<.52&&avg[1]>.19&&avg[1]<.47&&avg[2]<.52;
  return nearEye;
 });
 assert.ok(deepFaces.length>20,'Eye recess must contain real interior surfaces');
 assert.ok(deepFaces.every(f=>f.vertices.length===4),'No inner eye triangle fans permitted');
 assert.equal(m.inspect().nonManifoldEdges,0);
 assert.equal(m.inspect().boundaryEdges,0);
});
