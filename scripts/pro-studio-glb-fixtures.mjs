/**
 * Deterministic, self-contained glTF 2.0 GLB fixtures for the MARK Professional
 * Studio Release 1 gate. Each bufferView/accessor points at genuine binary
 * glTF data. No fake JSON-only joints, clips, morph attributes or screenshots.
 *
 * The fixture is a minimal skinned demonstration QUAD, not an artistic humanoid
 * or the user's Neon Boy. 70 bones/3 clips test the transport layer only.
 */
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';

const PNG_1PX='iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFUlEQVR4nGO8lPfsPwMDAwMTAxQAADB0AymHrVcoAAAAAElFTkSuQmCC';
const align4=n=>(n+3)&~3;
const jsonBytes=s=>new TextEncoder().encode(JSON.stringify(s));

function floatBytes(values){const output=new Uint8Array(values.length*4),view=new DataView(output.buffer);
 values.forEach((n,i)=>view.setFloat32(i*4,n,true));return output;}
function shortBytes(values){const output=new Uint8Array(values.length*2),view=new DataView(output.buffer);
 values.forEach((n,i)=>view.setUint16(i*2,n,true));return output;}
function makeGlb(doc,binary){
 const content=jsonBytes(doc),jsonPad=new Uint8Array(align4(content.length));jsonPad.fill(0x20);jsonPad.set(content);
 const binPad=new Uint8Array(align4(binary.length));binPad.set(binary);
 const out=new Uint8Array(12+8+jsonPad.length+8+binPad.length),v=new DataView(out.buffer);
 v.setUint32(0,0x46546c67,true);v.setUint32(4,2,true);v.setUint32(8,out.length,true);
 v.setUint32(12,jsonPad.length,true);v.setUint32(16,0x4e4f534a,true);
 out.set(jsonPad,20);
 const offset=20+jsonPad.length;v.setUint32(offset,binPad.length,true);
 v.setUint32(offset+4,0x004e4942,true);out.set(binPad,offset+8);
 return out;
}
export function buildRiggedFixture({bones=70,morphs=2,clips=3}={}){
 if(!Number.isInteger(bones)||bones<3||bones>256||!Number.isInteger(morphs)||morphs<1||morphs>8||
  !Number.isInteger(clips)||clips<1||clips>8)throw Error('Fixture parameter out of bounded range');
 const raw=[],bufferViews=[],accessors=[];let length=0;
 const addBytes=(bytes,{target}={})=>{
  const offset=align4(length);if(offset>length){raw.push(new Uint8Array(offset-length));length=offset;}
  const index=bufferViews.length,entry={buffer:0,byteOffset:offset,byteLength:bytes.length};
  if(target)entry.target=target;bufferViews.push(entry);raw.push(bytes);length+=bytes.length;return index;
 };
 const addAccessor=(bytes,type,componentType,count,extra={},opts={})=>{
  const view=addBytes(bytes,opts);const index=accessors.length;
  accessors.push({bufferView:view,byteOffset:0,componentType,count,type,...extra});return index;
 };
 const positions=[-.42,0,0, .42,0,0, -.42,1.45,0, .42,1.45,0];
 const normals=[0,0,1, 0,0,1, 0,0,1, 0,0,1];
 const tex=[0,0,1,0,0,1,1,1];
 const mid=Math.min(14,bones-1),upper=Math.min(27,bones-1);
 const joints=[0,0,0,0, 0,0,0,0, mid,upper,0,0, mid,upper,0,0];
 const weights=[1,0,0,0, 1,0,0,0, .6,.4,0,0, .6,.4,0,0];
 const POSITION=addAccessor(floatBytes(positions),'VEC3',5126,4,{min:[-.42,0,0],max:[.42,1.45,0]},{target:34962});
 const NORMAL=addAccessor(floatBytes(normals),'VEC3',5126,4,{}, {target:34962});
 const TEXCOORD_0=addAccessor(floatBytes(tex),'VEC2',5126,4,{}, {target:34962});
 const JOINTS_0=addAccessor(shortBytes(joints),'VEC4',5123,4,{}, {target:34962});
 const WEIGHTS_0=addAccessor(floatBytes(weights),'VEC4',5126,4,{}, {target:34962});
 const indices=addAccessor(shortBytes([0,1,2,1,3,2]),'SCALAR',5123,6,{}, {target:34963});
 const targets=[],targetNames=[];
 for(let m=0;m<morphs;m++){
  const delta=m%2===0?[0,0,0,0,0,0,-.11,0,0,.11,0,0]:[0,0,0,0,0,0,0,.12,0,0,.12,0];
  targets.push({POSITION:addAccessor(floatBytes(delta),'VEC3',5126,4,{}, {target:34962})});
  targetNames.push(m%2===0?'Smile_'+m:'BrowRaise_'+m);
 }
 const jointNodes=[];
 const baseNames=['root','hips','spine','chest','neck','head','shoulder_L','upperArm_L','lowerArm_L',
  'hand_L','shoulder_R','upperArm_R','lowerArm_R','hand_R','upperLeg_L','lowerLeg_L',
  'foot_L','upperLeg_R','lowerLeg_R','foot_R'];
 for(let b=0;b<bones;b++)jointNodes.push({name:baseNames[b]||'aux_joint_'+String(b).padStart(2,'0'),
  translation:[0,b===0?0:.025,0],...(b<bones-1?{children:[b+3]}:{})});
 const nodes=[{name:'MARK_Rig_Demonstrator',children:[1,2]},{name:'SkinnedQuad',mesh:0,skin:0},...jointNodes];
 const mats=[];
 for(let b=0;b<bones;b++){
  const row=[1,0,0,0,0,1,0,0,0,0,1,0,0,-b*.025,0,1];mats.push(...row);
 }
 const bind=addAccessor(floatBytes(mats),'MAT4',5126,bones);
 const PNG=Uint8Array.from(Buffer.from(PNG_1PX,'base64'));const imageView=addBytes(PNG);
 const animations=[];
 for(let a=0;a<clips;a++){
  const duration=12;
  const time=addAccessor(floatBytes([0,duration/2,duration]),'SCALAR',5126,3,{min:[0],max:[duration]});
  const angle=.22+(a*.13),bend= Math.sin(angle/2),cos=Math.cos(angle/2);
  const rotations=addAccessor(floatBytes([0,0,0,1, 0,0,bend,cos, 0,0,0,1]),'VEC4',5126,3);
  const morphWeights=Array.from({length:3*morphs},(_,i)=>i>=morphs&&i<2*morphs?(i-morphs===a%morphs?.7:.15):0);
  const morphOutput=addAccessor(floatBytes(morphWeights),'SCALAR',5126,3*morphs);
  animations.push({name:['IdleBreathing','ArmWave','DanceLoop'][a]||'Clip_'+a,
   samplers:[{input:time,output:rotations,interpolation:'LINEAR'},
             {input:time,output:morphOutput,interpolation:'LINEAR'}],
   channels:[{sampler:0,target:{node:2+Math.min([0,mid,upper][a%3],bones-1),path:'rotation'}},
             {sampler:1,target:{node:1,path:'weights'}}]});
 }
 const chunks=new Uint8Array(align4(length));let cursor=0;
 for(const b of raw){chunks.set(b,cursor);cursor+=b.length;}
 const doc={asset:{version:'2.0',generator:'MARK Professional Studio rig test fixture v1',extras:{purpose:'transport test only; not Neon Boy'}},
  scene:0,scenes:[{name:'Rigged test demonstrator',nodes:[0]}],nodes,
  meshes:[{name:'DoubleMorphSkinMesh',weights:Array(morphs).fill(0),extras:{targetNames},
   primitives:[{attributes:{POSITION,NORMAL,TEXCOORD_0,JOINTS_0,WEIGHTS_0},
    indices,material:0,targets,mode:4}]}],
  skins:[{name:'Rig70',joints:Array.from({length:bones},(_,i)=>i+2),inverseBindMatrices:bind,skeleton:2}],
  animations,
  materials:[{name:'Fixture PBR',pbrMetallicRoughness:{baseColorFactor:[1,1,1,1],
   baseColorTexture:{index:0,texCoord:0},metallicFactor:.12,roughnessFactor:.61},doubleSided:true}],
  images:[{bufferView:imageView,mimeType:'image/png',name:'Fixture PNG'}],
  samplers:[{magFilter:9729,minFilter:9987,wrapS:10497,wrapT:10497}],
  textures:[{sampler:0,source:0}],
  buffers:[{byteLength:length}],bufferViews,accessors};
 const bytes=makeGlb(doc,chunks);
 return {bytes,doc,sha256:createHash('sha256').update(bytes).digest('hex')};
}

export function buildStaticFixture(){
 const src=buildRiggedFixture({bones:3,morphs:1,clips:1});
 // Import coverage must also include a truly no-skin/no-morph/no-animation GLB.
 const doc=structuredClone(src.doc);delete doc.skins;delete doc.animations;
 doc.nodes[1].skin=undefined;doc.nodes.splice(2);doc.nodes[0].children=[1];
 doc.meshes[0].primitives[0].attributes.JOINTS_0=undefined;
 doc.meshes[0].primitives[0].attributes.WEIGHTS_0=undefined;
 delete doc.meshes[0].primitives[0].targets;
 delete doc.meshes[0].weights;delete doc.meshes[0].extras;
 const bytes=makeGlb(doc,src.bytes.slice(src.bytes.length-align4(doc.buffers[0].byteLength)));
 return {bytes,doc,sha256:createHash('sha256').update(bytes).digest('hex')};
}
const invoked=process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url);
if(invoked){
 const outDir=resolve(process.argv[2]||'dist/pro-studio/fixtures');mkdirSync(outDir,{recursive:true});
 for(const [name,fixture] of [['rig70-morph2-clips3',buildRiggedFixture()],['static-pbr',buildStaticFixture()]]){
  const path=resolve(outDir,name+'.glb');writeFileSync(path,fixture.bytes);
  console.log(JSON.stringify({file:path,sha256:fixture.sha256,bytes:fixture.bytes.length,
   skins:fixture.doc.skins?.length||0,morphTargets:fixture.doc.meshes?.[0]?.primitives?.[0]?.targets?.length||0,
   clips:fixture.doc.animations?.length||0,joints:fixture.doc.skins?.[0]?.joints?.length||0}));
 }
}

