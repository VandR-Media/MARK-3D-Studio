/**
 * MARK Modeling API v0.4. Node-compatible, deterministic and headless.
 * Executes data-only JSON recipe; no arbitrary JS eval, network, browser or GPU.
 * No claim of automatic resemblance to the approved MARK Cosmic references.
 */
import {createTestHeadGlb} from './head-fixture.js';
import {MeshEditor} from './mesh-core.js';
import {deformFace} from './face-studio.js';
import {topologyEdit,inspectMesh,readPrimitive} from './topology.js';
import {editScene} from './scene-objects.js';
import {parseGlb} from './glb.js';
import {appendMeshes,loft,sweep,earShell,eyeLens,irisDisk,pupilDisk,eyelid,eyebrow,lip,hairCap,hairStrand,shell,capCrown,capVisor,capEmblem,headphoneBand,headphoneCup,headphoneNeonRim} from './production-geometry.js';
const VERSION='mark-modeling/0.4';
const bounded=(v,name,min,max)=>{if(typeof v!=='number'||!Number.isFinite(v)||v<min||v>max)throw Error(name+' должен быть числом '+min+'…'+max);return v;};
const param=(p,key,def,min=0,max=1)=>bounded(p?.[key]??def,key,min,max);
const color=(r,g,b)=>[r,g,b,1];
const PALETTE={
 skin:{name:'Stylized warm skin',color:color(.68,.43,.31),roughness:.8},
 lid:{name:'Soft lid skin',color:color(.57,.33,.29),roughness:.82},
 eye:{name:'Eye sclera',color:color(.94,.92,.84),roughness:.32},
 iris:{name:'Iris blue-cyan',color:color(.035,.26,.40),roughness:.42},
 pupil:{name:'Pupil',color:color(.018,.018,.028),roughness:.2},
 brows:{name:'Soft dark brows',color:color(.11,.075,.063),roughness:.9},
 lips:{name:'Lips',color:color(.59,.24,.23),roughness:.55},
 ear:{name:'Ear skin',color:color(.68,.43,.32),roughness:.8},
 hair:{name:'Brown hair',color:color(.085,.052,.048),roughness:.75},
 nostril:{name:'Nostril dark relief',color:color(.15,.075,.065),roughness:.9},
 cap:{name:'Red cap fabric',color:color(.72,.035,.095),roughness:.78},
 visor:{name:'Red cap visor',color:color(.68,.026,.078),roughness:.64},
 emblem:{name:'White monogram',color:color(.96,.95,.98),roughness:.45},
 headphones:{name:'Headphone midnight polymer',color:color(.055,.066,.12),metallic:.08,roughness:.36},
 cyan:{name:'Electric cyan LED',color:color(.02,.77,.96),emissive:[.01,.62,.85],roughness:.24},
 magenta:{name:'Cosmic magenta LED',color:color(.91,.035,.68),emissive:[.71,.03,.56],roughness:.24}
};
function assertPlain(o,where){
 if(!o||typeof o!=='object'||Array.isArray(o)||Object.getPrototypeOf(o)!==Object.prototype)
  throw Error(where+' должен быть JSON-объектом');
}
export function validateRecipe(recipe){
 assertPlain(recipe,'Рецепт');
 if(recipe.schema!==VERSION)throw Error('Неизвестная версия схемы: '+recipe.schema);
 assertPlain(recipe.project,'project');
 if(!/^[a-z0-9-]{3,60}$/.test(recipe.project.id||''))throw Error('project.id: только a-z, 0-9, дефисы');
 if(!['practice-head','provided-glb'].includes(recipe.project.base))throw Error('project.base: practice-head или provided-glb');
 if(!Array.isArray(recipe.commands)||recipe.commands.length<1||recipe.commands.length>200)
  throw Error('Нужно 1–200 команд');
 recipe.commands.forEach((cmd,i)=>{
  assertPlain(cmd,'commands['+i+']');
  if(typeof cmd.operation!=='string'||cmd.operation.length>64)throw Error('Неверная операция commands['+i+']');
  if(cmd.parameters!==undefined)assertPlain(cmd.parameters,'parameters');
 });
 return true;
}
function faceModify(bytes,target,p){
 const e=new MeshEditor(bytes,0);
 const amount=v=>2*(v-.5);
 const changes=[];
 const permitted={"nose":["width","length","bridgeHeight","nostrilDepth"],"cheeks":["volume","boneHeight"],"chin":["projection","jawWidth"],"head":["width","height","forehead"],"eyes":["socketDepth","height","spacing","size","upperEyelid","lowerEyelid"],"mouth":["width","volume"],"ears":["size"]}[target];
 if(permitted)for(const k of Object.keys(p))if(!permitted.includes(k))
  throw Error('face.modify '+target+': неизвестный параметр '+k);
 const send=(key,value)=>{if(Math.abs(value)>.000001){deformFace(e,key,value);changes.push({key,amount:value});}};
 switch(target){
  case 'nose':
   send('noseWidth',amount(param(p,'width',.5)));
   send('noseLength',amount(param(p,'length',.5)));
   send('noseBridge',amount(param(p,'bridgeHeight',.5)));
   send('nostrils',amount(param(p,'nostrilDepth',.5)));
   break;
  case 'cheeks':
   send('cheeks',amount(param(p,'volume',.5)));
   send('cheekbones',amount(param(p,'boneHeight',.5)));
   break;
  case 'chin':
   send('chin',amount(param(p,'projection',.5)));
   send('jawWidth',amount(param(p,'jawWidth',.5)));
   break;
  case 'head':
   send('headWidth',amount(param(p,'width',.5)));
   send('headHeight',amount(param(p,'height',.5)));
   send('forehead',amount(param(p,'forehead',.5)));
   break;
  case 'eyes':
   send('eyeSockets',amount(param(p,'socketDepth',.5)));
   send('eyesHeight',amount(param(p,'height',.5)));
   send('eyesSpacing',amount(param(p,'spacing',.5)));
   send('eyeSize',amount(param(p,'size',.5)));
   send('upperEyelid',amount(param(p,'upperEyelid',.5)));
   send('lowerEyelid',amount(param(p,'lowerEyelid',.5)));
   break;
  case 'mouth':
   send('mouthWidth',amount(param(p,'width',.5)));
   send('lips',amount(param(p,'volume',.5)));
   break;
  case 'ears':
   send('ears',amount(param(p,'size',.5)));
   break;
  default:throw Error('face.modify: неизвестный target '+target);
 }
 if(!changes.length)throw Error('face.modify: параметры не изменили геометрию');
 return {bytes:e.exportGlb(),details:{target,changes}};
}
function featureMeshes(target,p){
 const specs=[],add=(name,geometry,material)=>specs.push({name,geometry,material:PALETTE[material]});
 const eyeSpacing=param(p,'spacing',.46)*.44+.23; // 0.23..0.67
 const eyeWidth=.151+param(p,'size',.55)*.064,eyeHeight=.090+param(p,'height',.55)*.044;
 if(target==='eyes'){
  const width=eyeWidth,height=eyeHeight;
  for(const side of [-1,1]){
   const label=side<0?'Left':'Right',options={spacing:eyeSpacing,width,height};
   add(label+' eyeball',eyeLens(side,options),'eye');
   add(label+' iris',irisDisk(side,{spacing:eyeSpacing,radius:height*.52,forward:.906}),'iris');
   add(label+' pupil',pupilDisk(side,{spacing:eyeSpacing,radius:height*.245,forward:.919}),'pupil');
  }
 }else if(target==='eyelids'){
  const thickness=.012+param(p,'thickness',.5)*.020;
  for(const side of [-1,1]){
   const label=side<0?'Left':'Right',options={spacing:eyeSpacing,width:eyeWidth,height:eyeHeight,thickness};
   add(label+' upper eyelid',eyelid(side,true,options),'lid');
   add(label+' lower eyelid',eyelid(side,false,options),'lid');
  }
 }else if(target==='eyebrows'){
  for(const side of [-1,1])add((side<0?'Left':'Right')+' eyebrow',
   eyebrow(side,{spacing:eyeSpacing,width:eyeWidth*1.14,height:.08+param(p,'arch',.5)*.08}),'brows');
 }else if(target==='lips'){
  const width=.24+param(p,'width',.5)*.15,fullness=.025+param(p,'fullness',.5)*.050;
  const params={width,fullness,smile:(param(p,'smile',.5)-.5)*.07};
  add('Upper lip volume',lip(true,params),'lips');
  add('Lower lip volume',lip(false,params),'lips');
 }else if(target==='ears'){
  const h=.29+param(p,'height',.5)*.16,w=.155+param(p,'width',.5)*.13;
  for(const side of [-1,1])add((side<0?'Left':'Right')+' auricle',earShell(side,{height:h,width:w}),'ear');
 }else if(target==='hair'){
  const count=Math.round(6+param(p,'strands',.55)*12);
  const length=.21+param(p,'length',.5)*.34,volume=.82+param(p,'volume',.5)*.45;
  add('Scalp fitted hair mass',hairCap({length,volume}),'hair');
  for(let i=0;i<count;i++)add('Swept hair strand '+String(i+1).padStart(2,'0'),
   hairStrand(i,{count,length,volume}),'hair');
 }else if(target==='cap'){
  add('Red baseball cap crown',capCrown(),'cap');
  add('Baseball visor curved shell',capVisor(),'visor');
  add('White front cap monogram',capEmblem(),'emblem');
 }else if(target==='headphones'){
  add('Arched headphone band',headphoneBand(),'headphones');
  for(const side of [-1,1]){
   add((side<0?'Left':'Right')+' earcup body',headphoneCup(side),'headphones');
   add((side<0?'Left':'Right')+' neon earcup ring',headphoneNeonRim(side),side<0?'cyan':'magenta');
  }
 }else if(target==='nostrils'){
  const spread=.11+param(p,'spread',.5)*.08,r=.020+param(p,'radius',.5)*.020;
  for(const side of [-1,1])add((side<0?'Left':'Right')+' nostril inset relief',
   shell([side*spread,-.18,.96],r,r*.64,.007,{rings:10,segments:24}),'nostril');
 }else throw Error('feature.build: неизвестная область '+target);
 return specs;
}
export function describeGlb(bytes){
 const doc=parseGlb(bytes).json,meshStats=[];
 let allTriangles=0;
 for(let n=0;n<(doc.nodes||[]).length;n++){
  const node=doc.nodes[n];if(!Number.isInteger(node.mesh)||node.extras?.markDeleted)continue;
  const mesh=doc.meshes[node.mesh],parts=[];
  for(const prim of mesh.primitives||[]){
   const pos=doc.accessors[prim.attributes.POSITION],ind=doc.accessors[prim.indices];
   const tris=Math.floor(ind.count/3);allTriangles+=tris;
   parts.push({vertices:pos.count,triangles:tris,uv:prim.attributes.TEXCOORD_0!==undefined,
    material:doc.materials?.[prim.material]?.name||null});
  }
  meshStats.push({nodeIndex:n,name:node.name||mesh.name,parts});
 }
 return {nodes:meshStats,meshes:meshStats.length,triangles:allTriangles,materials:(doc.materials||[]).length,
  trianglesHead:meshStats[0]?.parts[0]?.triangles||0};
}

/** Per-mesh topology and normal diagnostics for the exported binary GLB. */
export function auditAllMeshes(bytes){
 const parsed=parseGlb(bytes),doc=parsed.json;
 const bin=parsed.chunks.find(c=>c.type===0x004e4942)?.data;
 if(!bin)throw Error('No BIN chunk in GLB audit');
 const view=new DataView(bin.buffer,bin.byteOffset,bin.byteLength),results=[];
 function read(index){
  const a=doc.accessors?.[index],v=doc.bufferViews?.[a?.bufferView];
  if(!a||!v||v.buffer!==0||a.sparse||a.normalized)throw Error('Audit: unsupported accessor '+index);
  const width=a.type==='VEC3'?3:a.type==='VEC2'?2:1;
  const size=a.componentType===5126||a.componentType===5125?4:a.componentType===5123?2:0;
  if(!size)throw Error('Audit: unsupported componentType');
  const stride=v.byteStride??size*width,offset=(v.byteOffset||0)+(a.byteOffset||0);
  if(offset<0||offset+(a.count-1)*stride+width*size>bin.length)throw Error('Audit: out-of-range accessor');
  const array=a.componentType===5126?new Float32Array(a.count*width):new Uint32Array(a.count*width);
  for(let i=0;i<a.count;i++)for(let j=0;j<width;j++){
   const at=offset+i*stride+j*size;
   array[i*width+j]=a.componentType===5126?view.getFloat32(at,true):
     a.componentType===5125?view.getUint32(at,true):view.getUint16(at,true);
  }
  return array;
 }
 for(let nodeIndex=0;nodeIndex<(doc.nodes||[]).length;nodeIndex++){
  const node=doc.nodes[nodeIndex];
  if(!Number.isInteger(node.mesh)||node.extras?.markDeleted)continue;
  const prim=doc.meshes[node.mesh]?.primitives||[];
  if(prim.length!==1)throw Error('Unsupported multi-primitive audit at node '+nodeIndex);
  const p=prim[0],pos=read(p.attributes.POSITION),indices=read(p.indices),normals=read(p.attributes.NORMAL);
  if(normals.length!==pos.length)throw Error('Normal/position count mismatch at '+nodeIndex);
  const audit=inspectMesh(pos,indices);
  let invalidNormals=0,maxUnitError=0;
  for(let i=0;i<normals.length;i+=3){
   const d=Math.hypot(normals[i],normals[i+1],normals[i+2]);
   if(!Number.isFinite(d)||d<.001)invalidNormals++;
   else maxUnitError=Math.max(maxUnitError,Math.abs(d-1));
  }
  results.push({nodeIndex,name:node.name,audit:{...audit,degenerateFaces:undefined},
   invalidNormals,maxNormalLengthError:maxUnitError});
 }
 return results;
}
function mainAudit(bytes){
 const data=readPrimitive(bytes,0,0),audit=inspectMesh(data.positions,data.indices);
 if(audit.invalidTriangles||audit.nonManifoldEdges||audit.boundaryEdges)
  throw Error('Head geometry invalid: '+JSON.stringify(audit));
 return audit;
}
function command(bytes,cmd){
 const p=cmd.parameters||{};
 switch(cmd.operation){
  case 'face.modify':return faceModify(bytes,cmd.target,p);
  case 'feature.build':{
   const specs=featureMeshes(cmd.target,p);
   const result=appendMeshes(bytes,specs);
   return {bytes:result.bytes,details:{target:cmd.target,added:result.added}};
  }
  case 'geometry.loft':{
   const g=loft(p.sections,{closeRing:p.closeRing!==false});
   const result=appendMeshes(bytes,[{name:String(cmd.target||'Custom loft'),geometry:g,material:p.material}]);
   return {bytes:result.bytes,details:{added:result.added}};
  }
  case 'geometry.sweep':{
   const g=sweep(p.path,{radius:param(p,'radius',.03,.001,2),depth:param(p,'depth',.03,.001,2)});
   const result=appendMeshes(bytes,[{name:String(cmd.target||'Custom sweep'),geometry:g,material:p.material}]);
   return {bytes:result.bytes,details:{added:result.added}};
  }
  case 'mesh.topology':{
   const result=topologyEdit(bytes,{nodeIndex:0,primitiveIndex:0,operation:p.type||'subdivide',
    faceIndex:p.faceIndex??0,amount:p.amount??.1,ratio:p.ratio??.25});
   return {bytes:result.bytes,details:{before:result.before,after:result.after}};
  }
  case 'mesh.sculpt':{
   const e=new MeshEditor(bytes,0);
   const point=p.point,radius=p.radius,strength=p.strength;
   if(!Array.isArray(point)||point.length!==3||point.some(x=>!Number.isFinite(x)))
    throw Error('mesh.sculpt: требуется point [x,y,z]');
   bounded(radius,'radius',.01,2);bounded(strength,'strength',.001,1);
   e.begin();try{
    const touched=e.brush(point,radius,strength,p.mode||'inflate',p.delta||[0,0,0],p.symmetry!==false,p.falloff||'smooth');
    if(!e.commit())throw Error('Кисть не изменила ни одну вершину');
    return {bytes:e.exportGlb(),details:{touched}};
   }catch(err){e.cancel();throw err;}
  }
  case 'object.transform':{
   const r=editScene(bytes,{operation:p.type||'transform',nodeIndex:p.nodeIndex??0,
    vector:p.vector,rotation:p.rotation,name:p.name,preset:p.preset});
   return {bytes:r.bytes,details:{nodeIndex:r.nodeIndex}};
  }
  case 'mesh.inspect':return {bytes,details:mainAudit(bytes)};
  case 'checkpoint.save':return {bytes,details:{snapshot:cmd.target||'checkpoint'}};
  default:throw Error('Unknown MARK Modeling operation '+cmd.operation);
 }
}
/**
 * Transactional execution. On error: strict (default) raises; onError: "skip"
 * records a warning and preserves previous GLB bytes byte-for-byte.
 */
export function runRecipe(recipe,{sourceBytes=null}={}){
 validateRecipe(recipe);
 if(recipe.project.base==='provided-glb'&&!sourceBytes)throw Error('provided-glb requires sourceBytes');
 let bytes=recipe.project.base==='provided-glb'?new Uint8Array(sourceBytes):createTestHeadGlb();
 let report=[],snapshots=new Map(),warnings=[];
 if(!recipe.project.references)warnings.push('Утверждённые референсы MARK Cosmic недоступны движку: сравнение сходства НЕ выполнялось.');
 else warnings.push('Конфигурация референсов хранится отдельно от GLB. Автоматической оценки сходства пока нет.');
 for(let i=0;i<recipe.commands.length;i++){
  const cmd=recipe.commands[i],before=bytes;
  try{
   const result=command(before,cmd);
   if(!(result.bytes instanceof Uint8Array))throw Error('Команда не вернула GLB');
   parseGlb(result.bytes); // minimal binary format guarantee before commit
   bytes=result.bytes;
   if(cmd.operation==='checkpoint.save'){
    const name=String(cmd.target||'step-'+i);
    if(!/^[a-zA-Z0-9_-]{1,50}$/.test(name))throw Error('Некорректное имя контрольной точки');
    snapshots.set(name,bytes.slice());
   }
   report.push({step:i,operation:cmd.operation,target:cmd.target||null,status:'ok',
    changedBytes:bytes.length-before.length,details:result.details});
  }catch(err){
   bytes=before;
   const message='Step '+i+' '+cmd.operation+': '+err.message;
   report.push({step:i,operation:cmd.operation,status:'error',message});
   if(cmd.onError==='skip'){warnings.push(message);continue;}
   const e=new Error(message);e.report=report;throw e;
  }
 }
 const audit=mainAudit(bytes),summary=describeGlb(bytes),meshDiagnostics=auditAllMeshes(bytes);
 if(meshDiagnostics.some(m=>m.audit.invalidTriangles||m.audit.nonManifoldEdges||m.invalidNormals||m.maxNormalLengthError>.015))
  throw Error('Final GLB component validation failed');
 const openComponents=meshDiagnostics.filter(m=>m.audit.boundaryEdges>0);
 if(openComponents.length)warnings.push('У некоторых контурных поверхностей есть намеренно открытые границы: '+openComponents.map(m=>m.name).join(', '));
 return {bytes,report,snapshots,warnings,audit,meshDiagnostics,summary,recipeVersion:VERSION};
}
export const MODELING_API_VERSION=VERSION;
