import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {analyzeIndexedFaceRegion} from '../src/pro-studio/topology-selection.js';
import {createViewportPicker} from '../src/pro-studio/viewport-picking.js';
import {primitiveGeometry} from '../src/pro-studio/primitive-geometry.js';

const quad=[0,1,2,1,3,2];

test('region analyzer finds actual OUTER four edges, not shared diagonal',()=>{
 const region=analyzeIndexedFaceRegion({
  indices:Uint16Array.from(quad),vertexCount:4,faces:[1,0]
 });
 assert.deepEqual(region.faces,[0,1]);
 assert.equal(region.triangles.length,2);
 assert.equal(region.boundaryEdges.length,4);
 assert.equal(region.internalEdges.length,1);
 assert.equal(region.diagnostics.connectedComponents,1);
 assert.equal(region.diagnostics.singleBoundaryLoop,true);
 assert.equal(region.diagnostics.validRegion,true);
 assert.ok(!region.boundaryEdges.some(e=>[e.from,e.to].sort((a,b)=>a-b).join(':')==='1:2'));
});

test('disconnected, repeated, holed, non-manifold and inconsistent winding are diagnosed',()=>{
 for(const input of [
  {indices:[0,1,2,3,4,5],vertexCount:6,faces:[0,1]},
  {indices:[0,1,2,0,1,3],vertexCount:4,faces:[0,1]},
  {indices:[0,1,2,1,0,3,0,1,4],vertexCount:5,faces:[0,1,2]},
 ]){
  const diagnostic=analyzeIndexedFaceRegion(input).diagnostics;
  assert.equal(diagnostic.validRegion,false);
 }
 const grid=primitiveGeometry({shape:'grid',size:1,segments:3});
 const withHole=analyzeIndexedFaceRegion({
  indices:grid.index,vertexCount:grid.position.length,
  faces:Array.from({length:grid.index.length/3},(_,i)=>i)
   .filter(i=>i!==8&&i!==9)
 });
 assert.equal(withHole.diagnostics.connectedComponents,1);
 assert.equal(withHole.diagnostics.singleBoundaryLoop,false);
 assert.equal(withHole.diagnostics.validRegion,false);
 assert.throws(()=>analyzeIndexedFaceRegion({
  indices:quad,vertexCount:4,faces:[1,1]}),/MARK_REGION_FACE_RANGE/);
 assert.throws(()=>analyzeIndexedFaceRegion({
  indices:quad,vertexCount:4,faces:[99]}),/MARK_REGION_FACE_RANGE/);
 assert.throws(()=>analyzeIndexedFaceRegion({
  indices:quad,vertexCount:4,faces:[0,1,2]}),/MARK_REGION_FACE_RANGE/);
});

function setupPicker(){
 const canvas={clientWidth:800,clientHeight:600};
 const scene=new THREE.Scene(),root=new THREE.Group();
 const geometry=new THREE.BufferGeometry();
 geometry.setAttribute('position',new THREE.Float32BufferAttribute([
  -1,-1,0,1,-1,0,-1,1,0,1,1,0
 ],3));
 geometry.setIndex(quad);geometry.computeVertexNormals();
 const mesh=new THREE.Mesh(geometry,new THREE.MeshBasicMaterial({
  side:THREE.DoubleSide
 }));
 mesh.name='quad';root.add(mesh);scene.add(root);
 const camera=new THREE.PerspectiveCamera(45,canvas.clientWidth/canvas.clientHeight,.1,20);
 camera.position.set(0,0,5);camera.lookAt(0,0,0);camera.updateMatrixWorld(true);
 const associations=new Map([[mesh,{meshes:0,primitives:0}]]);
 const picker=createViewportPicker({canvas,scene,camera,
  getRoot:()=>root,getParsed:()=>({parser:{associations}}),
  getSourceDoc:()=>({nodes:[{name:'quad',mesh:0}]}),
  render:()=>{}});
 picker.setEnabled(true);picker.setMode('face');
 return {mesh,scene,picker};
}

test('actual THREE geometry region renders two filled triangles and FOUR outline edges',()=>{
 const {mesh,scene,picker}=setupPicker();
 const click=picker.projectFace(0,1);
 picker.pickAt(click.x,click.y,'face');
 const region=picker.setFaceRegion(0,[1,0]);
 assert.deepEqual(region.faces,[0,1]);
 assert.equal(region.boundaryEdges.length,4);
 assert.equal(region.diagnostics.validRegion,true);
 const fill=scene.children.find(o=>o.isMesh&&o.material?.opacity===.28);
 const outline=scene.children.find(o=>o.isLineSegments&&o.material?.color?.getHex()===0xffd64a);
 assert.ok(fill?.visible);
 assert.ok(outline?.visible);
 const singleOutline=scene.children.find(o=>o.isLineLoop);
 assert.equal(singleOutline?.visible,false,
  'The previously picked face must NOT reveal a diagonal inside the multi-face outline');
 assert.equal(fill.geometry.getAttribute('position').count,6);
 assert.equal(outline.geometry.getAttribute('position').count,8);
 const oldZ=fill.geometry.getAttribute('position').getZ(0);
 mesh.position.z=.35;
 picker.update();
 const newZ=fill.geometry.getAttribute('position').getZ(0);
 assert.ok(Math.abs(newZ-oldZ-.35)<1e-6,
  'Overlay must move with current world-space geometry');
 assert.deepEqual(picker.getFaceRegion().faces,[0,1]);
 picker.clearFaceRegion();
 assert.equal(picker.getFaceRegion(),null);
 assert.equal(fill.visible,false);assert.equal(outline.visible,false);
 picker.setFaceRegion(0,[0]);
 assert.equal(picker.getFaceRegion().boundaryEdges.length,3);
 picker.setEnabled(false);
 assert.equal(picker.getFaceRegion(),null);
});

test('invalid overlay face IDs cannot corrupt previous valid selection',()=>{
 const {picker}=setupPicker();
 picker.setFaceRegion(0,[0]);
 assert.throws(()=>picker.setFaceRegion(0,[0,66]),/MARK_REGION_FACE_RANGE/);
 assert.deepEqual(picker.getFaceRegion().faces,[0]);
 assert.throws(()=>picker.setFaceRegion(3,[0]),/MARK_PICK_MESH_ASSOCIATION/);
 assert.deepEqual(picker.getFaceRegion().faces,[0]);
});
