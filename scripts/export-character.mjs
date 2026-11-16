/**
 * Independent GLB fixture: proves nose/cheeks/chin geometry + topology +
 * independent object + new PBR survive reimport. Not MARK Cosmic.
 */
import {writeFileSync,mkdirSync} from 'node:fs';
import {createTestHeadGlb} from '../src/head-fixture.js';
import {MeshEditor} from '../src/mesh-core.js';
import {deformFace} from '../src/face-studio.js';
import {topologyEdit,inspectMesh,readPrimitive} from '../src/topology.js';
import {editScene} from '../src/scene-objects.js';
import {parseGlb} from '../src/glb.js';
const folder=new URL('../samples/',import.meta.url);mkdirSync(folder,{recursive:true});
const original=createTestHeadGlb();
writeFileSync(new URL('character-v03-head-original.glb',folder),original);
const editor=new MeshEditor(original);
deformFace(editor,'noseLength',.8);
deformFace(editor,'cheeks',.65);
deformFace(editor,'chin',-.4);
let bytes=editor.exportGlb();
bytes=topologyEdit(bytes,{operation:'inset',faceIndex:12000,ratio:.25}).bytes;
bytes=topologyEdit(bytes,{operation:'extrude',faceIndex:16000,amount:.07}).bytes;
const duplicate=editScene(bytes,{operation:'duplicate',name:'Отдельная копия сетки — техническая проверка',offset:[1.9,0,0]});
bytes=duplicate.bytes;
bytes=editScene(bytes,{operation:'material',nodeIndex:duplicate.nodeIndex,preset:'plastic'}).bytes;
const check=parseGlb(bytes),primitive=readPrimitive(bytes);
const audit=inspectMesh(primitive.positions,primitive.indices);
if(check.json.meshes.length!==2||check.json.materials.length!==2||
  audit.invalidTriangles||audit.nonManifoldEdges||audit.boundaryEdges)
 throw Error('Invalid v0.3 example GLB topology or missing independent PBR object.');
writeFileSync(new URL('character-v03-head-edited.glb',folder),bytes);
console.log('v0.3 fixture verified. Nodes:',check.json.nodes.length,
 'Meshes:',check.json.meshes.length,'Materials:',check.json.materials.length,
 'Vertices:',audit.vertices,'Triangles:',audit.triangles);
