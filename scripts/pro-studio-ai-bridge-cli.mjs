#!/usr/bin/env node
/**
 * MARK AI Bridge — explicit local HEADLESS CLI, NO HTTP server.
 *
 * Runs same transactional command bus as browser viewport. It NEVER invents
 * WebGL screenshots: render.capture is reported "unsupported" in headless.
 * Reads only the explicitly supplied local GLB/.markscene or test fixture.
 */
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve,basename,join} from 'node:path';
import {createHash} from 'node:crypto';
import {createAiBridge} from '../src/pro-studio/ai-bridge-core.js';
import {buildRiggedFixture} from './pro-studio-glb-fixtures.mjs';
import {parseGlb} from '../src/glb.js';
import {openPreviewMarkscene} from '../src/pro-studio/markscene-v3-preview.js';
import {compareGlbSemantics} from '../src/pro-studio/glb-semantic-diff.js';
import {compareGlbTextures} from '../src/pro-studio/glb-texture-qa.js';

function parseFlags(args){
 const result={};
 for(let i=0;i<args.length;i++){
  const token=args[i];
  if(!['--input','--out'].includes(token)||!args[i+1]||args[i+1].startsWith('--'))
   throw Error('Allowed flags: --input <local.glb|local.markscene> --out <directory>');
  if(result[token]!==undefined)throw Error('Duplicated CLI option '+token);
  result[token]=args[++i];
 }
 return result;
}
export async function runBridgeCli({
 inputBytes=null,sourceName='generated-rig-70.glb',outDir='dist/pro-studio/ai-bridge-cli',
 sourceCommit=process.env.GITHUB_SHA||'local-unverified'
}={}){
 const bytes=inputBytes||buildRiggedFixture().bytes;
 const kind=bytes[0]===0x67&&bytes[1]===0x6c?'glb':'markscene';
 const exactSource=kind==='glb'?bytes:(await openPreviewMarkscene(bytes)).sourceGLB;
 const document=parseGlb(exactSource).json;
 const sha=data=>createHash('sha256').update(data).digest('hex');
 const id=document.nodes.findIndex(x=>x.mesh!==undefined&&x.matrix===undefined);
 if(id<0)throw Error('No TRS-editable imported mesh node in source');
 const materialIndex=document.materials?.length?0:null;
 const bridge=createAiBridge({
  appVersion:'0.7.0-alpha.0',buildHash:sourceCommit,allowWrites:true
 });
 const log=[];let seq=0;
 const run=async(method,params={})=>{
  const response=await bridge.request({requestId:'cli-'+(++seq),method,params});
  log.push({requestId:response.requestId,method,ok:response.ok,
   revision:response.revision,diagnostics:response.diagnostics,
   ...(response.ok&&method==='studio.getCapabilities'?
    {supported:response.result.supported}:{} )});
  if(!response.ok)
   throw Error('MARK_AI_BRIDGE_'+response.diagnostics[0].code+': '+
    response.diagnostics[0].message);
  return response.result;
 };
 const caps=await run('studio.getCapabilities');
 const upload=await run('asset.upload',{
  name:basename(sourceName).slice(0,120),type:kind,data:bytes
 });
 const open=await run('scene.open',{assetId:upload.assetId});
 const hierarchy=await run('scene.getHierarchy');
 const materials=await run('scene.getMaterials');
 const beginning=await run('transaction.begin');
 await run('object.setTransform',{
  uuid:'gltf-node-'+id,transform:{translation:[.17,0,0]}
 });
 if(materialIndex!==null){
  await run('material.setPbr',{
   materialId:'gltf-material-'+materialIndex,pbr:{roughnessFactor:.42}
  });
 }
 if(document.animations?.length)
  await run('animation.preview',{clipIndex:0,timeSeconds:0});
 const committed=await run('transaction.commit',{
  transactionId:beginning.transactionId
 });
 const validation=await run('scene.validate');
 const scene=await run('scene.save');
 const exportFile=await run('scene.export');
 // CLI cannot claim GPU renderer or image capture; this is the documented API.
 const absent=await bridge.request({requestId:'cli-render-status',
  method:'render.capture',params:{view:'front',timeSeconds:0}});
 if(absent.ok||absent.diagnostics[0].code!=='UNSUPPORTED_OPERATION')
  throw Error('Headless rendering capability must not fabricate WebGL captures');
 const native=await openPreviewMarkscene(scene.data);
 const docAfter=parseGlb(exportFile.data).json;
 const semantic=compareGlbSemantics(exactSource,exportFile.data,{
  allowEditedNodes:[document.nodes[id].name],
  allowEditedMaterials:materialIndex===null?[]:[materialIndex]
 });
 const texture=compareGlbTextures(exactSource,exportFile.data);
 if(semantic.status!=='pass_partial_profile'||texture.errors.length)
  throw Error('Native changed GLB semantic loss: '+JSON.stringify({
   numeric:semantic.errors.slice(0,8),texture:texture.errors.slice(0,8)}));
 const out=resolve(outDir);mkdirSync(out,{recursive:true});
 const savedFiles=[];
 for(const [name,data] of [
  ['AI-Bridge-Edited.markscene',scene.data],
  ['AI-Bridge-Edited.glb',exportFile.data]
 ]){
  const output=join(out,name);writeFileSync(output,data);
  savedFiles.push({file:name,byteLength:data.byteLength,sha256:sha(data)});
 }
 const report={
  schema:'mark.ai-bridge-cli-proof/1',status:'pass_supported_profile',
  sourceCommit,sourceName:basename(sourceName),sourceSha256:sha(exactSource),
  sceneId:open.sceneId,revision:committed.revision,
  transport:'explicit local Node CLI (no network)',
  capabilities:caps.supported,sceneHierarchy:{nodes:hierarchy.nodes.length},
  materials:materials.materials.length,
  objectEdited:'gltf-node-'+id,
  validation,files:savedFiles,commands:log,semantic:{
   status:semantic.status,numberOfNumericComparisons:semantic.numericComparisons,
   errors:semantic.errors,unverified:semantic.unverified},
  texture:{status:texture.status,stats:texture.stats,
   errors:texture.errors,unverified:texture.unverified},
  renderer:{status:'unsupported',reason:'No WebGL viewport in CLI; use real browser bridge'},
  sourceExactPreserved:native.sourceSha256===sha(exactSource),
  exportedPbrMaterial:materialIndex===null?null:
   docAfter.materials[materialIndex].pbrMetallicRoughness.roughnessFactor,
  next:['HTTP/WebSocket transport permissions','mesh/weight sculpt',
   'full transaction graph support']
 };
 if(!report.sourceExactPreserved)throw Error('Native scene lost exact input GLB');
 if(materialIndex!==null&&report.exportedPbrMaterial!==.42)
  throw Error('PBR edit disappeared from CLI GLB export');
 writeFileSync(join(out,'ai-bridge-report.json'),JSON.stringify(report,null,2)+'\n');
 return report;
}
if(process.argv[1]?.endsWith('pro-studio-ai-bridge-cli.mjs')){
 try{
  const flags=parseFlags(process.argv.slice(2));
  const data=flags['--input']?readFileSync(resolve(flags['--input'])):null;
  const report=await runBridgeCli({inputBytes:data,
   sourceName:flags['--input']||'generated-rig-70.glb',
   outDir:flags['--out']||'dist/pro-studio/ai-bridge-cli'});
  console.log('MARK AI BRIDGE CLI PASS',JSON.stringify({
   sourceCommit:report.sourceCommit,sourceSha256:report.sourceSha256,
   revision:report.revision,files:report.files,commands:report.commands.length,
   renderer:report.renderer.status
  }));
 }catch(error){console.error('MARK AI BRIDGE CLI FAIL',error);process.exitCode=1;}
}
