import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createViewportPicker} from '../src/pro-studio/viewport-picking.js';

function setup(){
 const scene=new THREE.Scene(),root=new THREE.Group();
 const geometry=new THREE.BufferGeometry();
 geometry.setAttribute('position',new THREE.Float32BufferAttribute([
  -1,-1,0, 1,-1,0, 0,1,0
 ],3));
 geometry.setIndex([0,1,2]);geometry.computeVertexNormals();
 const mesh=new THREE.Mesh(geometry,new THREE.MeshBasicMaterial({
  side:THREE.DoubleSide
 }));
 mesh.name='triangle';root.add(mesh);scene.add(root);
 const camera=new THREE.PerspectiveCamera(50,800/600,.1,50);
 camera.position.set(0,0,4);camera.lookAt(0,0,0);camera.updateMatrixWorld(true);
 const associations=new Map([[mesh,{meshes:0,primitives:0}]]);
 const picker=createViewportPicker({
  canvas:{clientWidth:800,clientHeight:600},scene,camera,
  getRoot:()=>root,getParsed:()=>({parser:{associations}}),
  getSourceDoc:()=>({nodes:[{name:'triangle',mesh:0}]}),render:()=>{}
 });
 picker.setEnabled(true);
 return {picker,mesh,scene};
}

test('WebGL raycast identifies actual indexed triangle edge and highlights its two vertices',()=>{
 const {picker}=setup();
 picker.setMode('edge');
 const edge=picker.projectEdge(0,0,1);
 assert.equal(edge.visible,true);
 assert.deepEqual(edge.edge,[0,1]);
 const selection=picker.pickAt(edge.x,edge.y-3);
 assert.ok(selection,'edge should be selectable from inside visible triangle');
 assert.equal(selection.mode,'edge');
 assert.equal(selection.meshId,'gltf-mesh-0');
 assert.equal(selection.primitiveIndex,0);
 assert.deepEqual(selection.edge,[0,1]);
 assert.deepEqual(selection.triangleVertices,[0,1,2]);
 assert.deepEqual(picker.getSelection().edge,[0,1]);
 picker.clear();assert.equal(picker.getSelection(),null);
});

test('edge projection refuses nonexistent topology and invalid indices',()=>{
 const {picker}=setup();
 assert.throws(()=>picker.projectEdge(0,0,0),/MARK_PICK_EDGE_RANGE/);
 assert.throws(()=>picker.projectEdge(0,0,3),/MARK_PICK_EDGE_RANGE/);
 assert.throws(()=>picker.projectEdge(999,0,2),/MARK_PICK_MESH_ASSOCIATION/);
});

test('existing vertex and face modes remain selectable on actual geometry',()=>{
 const {picker}=setup();
 const vertex=picker.projectVertex(0,2);
 const v=picker.pickAt(vertex.x,vertex.y+3,'vertex');
 assert.ok(v);assert.equal(v.mode,'vertex');
 assert.equal(v.vertex,2);
 const face=picker.projectFace(0,0);
 const f=picker.pickAt(face.x,face.y,'face');
 assert.ok(f);assert.equal(f.face,0);
 assert.equal(f.mode,'face');
 picker.setEnabled(false);
 assert.throws(()=>picker.pickAt(face.x,face.y,'edge'),/MARK_PICK_DISABLED/);
});
