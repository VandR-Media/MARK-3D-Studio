/**
 * MARK Experimental P8: actual WebGL2 mesh element picking through THREE.Raycaster.
 *
 * Uses the REAL GLTFLoader parser association, real current indexed geometry,
 * skinned/morphed vertex world positions, and pointer pixels. Does NOT guess
 * mesh IDs by display name, never renders a fake screenshot.
 */
import * as THREE from 'three';
import {analyzeIndexedFaceRegion} from './topology-selection.js';
const bad=(code,msg)=>{const e=Error('MARK_PICK_'+code+': '+msg);e.code=code;throw e;};
const safe=(ok,code,msg)=>{if(!ok)bad(code,msg);};
const inRange=(n,max)=>Number.isInteger(n)&&n>=0&&n<max;
export function createViewportPicker({canvas,scene,camera,getRoot,getParsed,getSourceDoc,render}){
 const ray=new THREE.Raycaster(),ndc=new THREE.Vector2();
 const marker=new THREE.Mesh(
  new THREE.SphereGeometry(.037,12,10),
  new THREE.MeshBasicMaterial({color:0xffd64a,depthTest:false,depthWrite:false})
 );
 marker.visible=false;marker.renderOrder=500;scene.add(marker);
 const faceLine=new THREE.LineLoop(
  new THREE.BufferGeometry().setFromPoints([
   new THREE.Vector3(),new THREE.Vector3(),new THREE.Vector3()
  ]),
  new THREE.LineBasicMaterial({color:0x5cf2ff,depthTest:false,depthWrite:false,
   transparent:true,opacity:.98})
 );
 faceLine.visible=false;faceLine.renderOrder=501;scene.add(faceLine);
 const edgeLine=new THREE.Line(
  new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(),new THREE.Vector3()]),
  new THREE.LineBasicMaterial({color:0xff9e40,depthTest:false,
   depthWrite:false,transparent:true,opacity:1})
 );
 edgeLine.visible=false;edgeLine.renderOrder=502;scene.add(edgeLine);
 // Group overlay: translucent true triangles + only exterior indexed edges.
 // No fake 2D rectangles and no duplicate inner diagonal outline.
 const regionFill=new THREE.Mesh(new THREE.BufferGeometry(),
  new THREE.MeshBasicMaterial({color:0x14aace,transparent:true,opacity:.28,
   side:THREE.DoubleSide,depthTest:true,depthWrite:false,
   polygonOffset:true,polygonOffsetFactor:-2,polygonOffsetUnits:-2}));
 regionFill.visible=false;regionFill.renderOrder=503;regionFill.frustumCulled=false;
 scene.add(regionFill);
 const regionBorder=new THREE.LineSegments(new THREE.BufferGeometry(),
  new THREE.LineBasicMaterial({color:0xffd64a,depthTest:false,
   depthWrite:false,transparent:true,opacity:1}));
 regionBorder.visible=false;regionBorder.renderOrder=504;
 regionBorder.frustumCulled=false;scene.add(regionBorder);
 let mode='vertex',selection=null,faceRegion=null,enabled=false;
 function locate(meshIndex,primitiveIndex=0){
  const root=getRoot(),parsed=getParsed(),doc=getSourceDoc();
  safe(Boolean(root&&parsed&&doc),'NO_SCENE','Load a glTF scene first');
  let found=null;
  root.traverse(obj=>{
   if(found||!obj.isMesh||!obj.geometry?.attributes?.position)return;
   const assoc=parsed.parser?.associations?.get(obj);
   if(assoc?.meshes===meshIndex&&(assoc.primitives??0)===primitiveIndex)
    found=obj;
  });
  if(!found){
   // GLTFLoader may attach association to geometry instead of mesh object.
   root.traverse(obj=>{
    if(found||!obj.isMesh)return;
    const assoc=parsed.parser?.associations?.get(obj.geometry);
    if(assoc?.meshes===meshIndex&&(assoc.primitives??0)===primitiveIndex)found=obj;
   });
  }
  if(!found){
   // Fallback only for a UNIQUE node name in the glTF document. Names
   // that are ambiguous must fail rather than silently editing another mesh.
   const names=new Map();
   for(const node of doc.nodes||[])if(node.mesh===meshIndex){
    const name=node.name||'';names.set(name,(names.get(name)||0)+1);
   }
   root.traverse(obj=>{
    if(found||!obj.isMesh||!obj.name||names.get(obj.name)!==1)return;
    const sourceNode=doc.nodes.find(n=>n.name===obj.name);
    if(sourceNode?.mesh===meshIndex)found=obj;
   });
  }
  safe(Boolean(found),'MESH_ASSOCIATION',
   'Cannot reliably map rendered skinned mesh to glTF mesh datablock');
  return found;
 }
 const vertexWorld=(mesh,index)=>{
  const attribute=mesh.geometry.attributes.position;
  safe(inRange(index,attribute.count),'VERTEX_RANGE','Vertex index out of range');
  const out=new THREE.Vector3();
  if(typeof mesh.getVertexPosition==='function')mesh.getVertexPosition(index,out);
  else out.fromBufferAttribute(attribute,index);
  mesh.updateWorldMatrix(true,false);
  return mesh.localToWorld(out);
 };
 function faceIndices(mesh,index){
  const geom=mesh.geometry;
  safe(geom.index&&inRange(index,geom.index.count/3),'FACE_RANGE',
   'Expected triangle index within indexed WebGL2 mesh');
  return [0,1,2].map(i=>geom.index.getX(index*3+i));
 }
 function resolveMeshIndex(object){
  const parsed=getParsed(),doc=getSourceDoc();
  const association=parsed?.parser?.associations?.get(object)||
   parsed?.parser?.associations?.get(object.geometry);
  if(Number.isInteger(association?.meshes)){
   return{meshIndex:association.meshes,primitiveIndex:association.primitives??0};
  }
  const options=(doc?.nodes||[]).filter(n=>n.name===object.name&&
   Number.isInteger(n.mesh));
  safe(options.length===1,'MESH_ASSOCIATION',
   'Ambiguous glTF node name, refusing unsafe mesh selection');
  return{meshIndex:options[0].mesh,primitiveIndex:0};
 }
 function pixelToNdc(x,y){
  const w=canvas.clientWidth,h=canvas.clientHeight;
  safe(Number.isFinite(x)&&Number.isFinite(y)&&x>=0&&y>=0&&
   x<=w&&y<=h&&w>0&&h>0,'POINTER_RANGE',
   'Tap must be inside displayed WebGL canvas');
  return ndc.set(x/w*2-1,1-y/h*2);
 }
 function project(v){
  const w=canvas.clientWidth,h=canvas.clientHeight;
  const nd=v.clone().project(camera);
  return{x:(nd.x+1)*.5*w,y:(1-nd.y)*.5*h,
   world:v.toArray(),depth:nd.z,visible:nd.z>=-1&&nd.z<=1};
 }
 function writeOverlayGeometry(geometry,vertices){
  const count=vertices.length;
  let attribute=geometry.getAttribute('position');
  if(!attribute||attribute.count!==count){
   attribute=new THREE.Float32BufferAttribute(new Float32Array(count*3),3);
   attribute.setUsage(THREE.DynamicDrawUsage);
   geometry.setAttribute('position',attribute);
  }
  for(let i=0;i<count;i++)
   attribute.setXYZ(i,vertices[i].x,vertices[i].y,vertices[i].z);
  attribute.needsUpdate=true;
  if(count)geometry.computeBoundingSphere();
 }
 function overlay(){
  marker.visible=false;faceLine.visible=false;edgeLine.visible=false;
  regionFill.visible=false;regionBorder.visible=false;
  if(enabled&&faceRegion){
   let selectedMesh=null;
   try{selectedMesh=locate(faceRegion.meshIndex,faceRegion.primitiveIndex);}
   catch{/* Scene may be reloading; never bind a stale glTF mesh. */}
   if(selectedMesh){
    const cache=new Map();
    const worldVertex=i=>{
     if(!cache.has(i))cache.set(i,vertexWorld(selectedMesh,i));
     return cache.get(i);
    };
    const triangles=faceRegion.topology.triangles.flatMap(f=>
     f.vertices.map(i=>worldVertex(i)));
    const border=faceRegion.topology.boundaryEdges.flatMap(e=>
     [worldVertex(e.from),worldVertex(e.to)]);
    writeOverlayGeometry(regionFill.geometry,triangles);
    writeOverlayGeometry(regionBorder.geometry,border);
    regionFill.visible=triangles.length>0;
    regionBorder.visible=border.length>0;
   }
  }
  if(!selection||!enabled)return;
  let mesh;
  try{mesh=locate(selection.meshIndex,selection.primitiveIndex);}
  catch{return;}
  if(selection.mode==='vertex'){
   const v=vertexWorld(mesh,selection.vertex);
   marker.position.copy(v);marker.visible=true;
  }else if(selection.mode==='edge'){
   const positions=edgeLine.geometry.getAttribute('position');
   selection.edge.forEach((i,k)=>{
    const v=vertexWorld(mesh,i);positions.setXYZ(k,v.x,v.y,v.z);
   });
   positions.needsUpdate=true;edgeLine.geometry.computeBoundingSphere();
   edgeLine.visible=true;
  }else{
   const faces=faceIndices(mesh,selection.face);
   const positions=faceLine.geometry.getAttribute('position');
   faces.forEach((i,k)=>{
    const v=vertexWorld(mesh,i);
    positions.setXYZ(k,v.x,v.y,v.z);
   });
   positions.needsUpdate=true;
   faceLine.geometry.computeBoundingSphere();faceLine.visible=true;
  }
 }
 function selectAt(x,y,pickMode=mode){
  safe(['vertex','edge','face'].includes(pickMode),'MODE','Select vertex, edge or face');
  safe(enabled,'DISABLED','Open Mesh Edit Mode before viewport selection');
  camera.updateMatrixWorld(true);getRoot()?.updateMatrixWorld(true);
  ray.setFromCamera(pixelToNdc(x,y),camera);
  const hits=ray.intersectObject(getRoot(),true)
   .filter(h=>h.object.isMesh&&Number.isInteger(h.faceIndex)&&h.object.geometry.index);
  if(!hits.length){
   selection=null;overlay();render();return null;
  }
  let hit=null,assoc=null;
  for(const entry of hits){
   try{
    const mapped=resolveMeshIndex(entry.object);
    if(mapped){hit=entry;assoc=mapped;break;}
   }catch{/* Only reliably associated meshes may be edited. */}
  }
  if(!hit){selection=null;overlay();render();return null;}
  const indices=faceIndices(hit.object,hit.faceIndex);
  let vertex=null,edge=null;
  if(pickMode==='edge'){
   let closest=Infinity;
   const pointToSegment=(a,b)=>{
    const dx=b.x-a.x,dy=b.y-a.y,denom=dx*dx+dy*dy;
    const t=denom>1e-10?Math.max(0,Math.min(1,
     ((x-a.x)*dx+(y-a.y)*dy)/denom)):0;
    return Math.hypot(x-a.x-dx*t,y-a.y-dy*t);
   };
   for(const pair of [[indices[0],indices[1]],[indices[1],indices[2]],
    [indices[2],indices[0]]]){
    const a=project(vertexWorld(hit.object,pair[0]));
    const b=project(vertexWorld(hit.object,pair[1]));
    if(!a.visible||!b.visible)continue;
    const distance=pointToSegment(a,b);
    if(distance<closest){
     closest=distance;
     edge=[Math.min(...pair),Math.max(...pair)];
    }
   }
   if(!edge||closest>Math.max(20,Math.min(canvas.clientWidth,
    canvas.clientHeight)*.035)){
    selection=null;overlay();render();return null;
   }
  }
  if(pickMode==='vertex'){
   let closest=Infinity;
   for(const index of indices){
    const p=project(vertexWorld(hit.object,index));
    const distance=Math.hypot(p.x-x,p.y-y);
    if(distance<closest){closest=distance;vertex=index;}
   }
   if(closest>Math.max(32,Math.min(canvas.clientWidth,canvas.clientHeight)*.07)){
    selection=null;overlay();render();return null;
   }
  }
  selection={
   mode:pickMode,meshIndex:assoc.meshIndex,
   meshId:'gltf-mesh-'+assoc.meshIndex,
   primitiveIndex:assoc.primitiveIndex,
   ...(pickMode==='vertex'?{vertex}:pickMode==='edge'?{edge}:
    {face:hit.faceIndex}),
   triangleVertices:indices,
   click:{x,y}
  };
  overlay();render();return structuredClone(selection);
 }
 function setFaceRegion(meshIndex,faces,primitiveIndex=0){
  safe(enabled,'DISABLED','Open Mesh Edit Mode to select a region');
  const mesh=locate(meshIndex,primitiveIndex);
  const geometry=mesh.geometry;
  safe(Boolean(geometry.index&&geometry.attributes?.position),
   'REGION_PROFILE','Indexed mesh required for region overlay');
  // Read currently loaded indexed WebGL geometry, not source GLB metadata:
  // it contains the actual rendered triangle IDs used by the raycaster.
  const index=Array.from({length:geometry.index.count},
   (_,i)=>geometry.index.getX(i));
  const topology=analyzeIndexedFaceRegion({
   indices:index,vertexCount:geometry.attributes.position.count,faces
  });
  faceRegion={meshIndex,primitiveIndex,topology};
  overlay();render();
  return {meshIndex,primitiveIndex,faces:topology.faces.slice(),
   diagnostics:structuredClone(topology.diagnostics),
   boundaryEdges:topology.boundaryEdges.map(e=>[e.from,e.to])};
 }
 function getFaceRegion(){
  if(!faceRegion)return null;
  const {meshIndex,primitiveIndex,topology}=faceRegion;
  return {meshIndex,primitiveIndex,faces:topology.faces.slice(),
   diagnostics:structuredClone(topology.diagnostics),
   boundaryEdges:topology.boundaryEdges.map(e=>[e.from,e.to])};
 }
 function clearFaceRegion(){
  faceRegion=null;overlay();render();
 }
 function projectVertex(meshIndex,vertexIndex,primitiveIndex=0){
  const mesh=locate(meshIndex,primitiveIndex);camera.updateMatrixWorld(true);
  return {...project(vertexWorld(mesh,vertexIndex)),meshIndex,vertexIndex};
 }
 function projectEdge(meshIndex,start,end,primitiveIndex=0){
  const mesh=locate(meshIndex,primitiveIndex);
  safe(inRange(start,mesh.geometry.attributes.position.count)&&
   inRange(end,mesh.geometry.attributes.position.count)&&start!==end,
   'EDGE_RANGE','Invalid edge vertices');
  const geom=mesh.geometry,indices=geom.index;
  safe(Boolean(indices),'EDGE_PROFILE','Indexed triangle mesh required');
  let found=false;
  for(let i=0;i<indices.count;i+=3){
   const tri=[indices.getX(i),indices.getX(i+1),indices.getX(i+2)];
   if(tri.includes(start)&&tri.includes(end)){found=true;break;}
  }
  safe(found,'EDGE_NOT_FOUND','Selected vertices do not share a triangle edge');
  camera.updateMatrixWorld(true);
  const a=project(vertexWorld(mesh,start)),b=project(vertexWorld(mesh,end));
  return {x:(a.x+b.x)/2,y:(a.y+b.y)/2,
   visible:a.visible&&b.visible,meshIndex,primitiveIndex,
   edge:[Math.min(start,end),Math.max(start,end)],endpoints:[a,b]};
 }
 function projectFace(meshIndex,faceIndex,primitiveIndex=0){
  const mesh=locate(meshIndex,primitiveIndex);
  const mid=new THREE.Vector3();
  const indices=faceIndices(mesh,faceIndex);
  for(const i of indices)mid.add(vertexWorld(mesh,i));
  mid.multiplyScalar(1/3);
  camera.updateMatrixWorld(true);
  return {...project(mid),meshIndex,faceIndex,indices};
 }
 return{
  setEnabled:v=>{enabled=Boolean(v);if(!enabled){selection=null;faceRegion=null;}overlay();render();},
  setMode:v=>{safe(['vertex','edge','face'].includes(v),'MODE','Unknown selection mode');mode=v;},
  pickAt:selectAt,
  projectVertex,projectEdge,projectFace,
  setFaceRegion,getFaceRegion,clearFaceRegion,
  getSelection:()=>selection?structuredClone(selection):null,
  getEnabled:()=>enabled,
  update:overlay,
  clear:()=>{selection=null;faceRegion=null;overlay();render();}
 };
}
