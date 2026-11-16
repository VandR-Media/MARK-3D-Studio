/**
 * Compile professional editing JSON → independent .mark3d + actual polygonal GLB.
 * Run: npm run professional:build -- --recipe recipes/professional-face-sculpt.json
 */
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import Ajv2020 from 'ajv/dist/2020.js';
import {runGeometryRecipe} from '../src/professional-api.js';
import {EditableMesh} from '../src/professional-geometry.js';
import {decodeMark3d} from '../src/compact-project.js';
const args=process.argv.slice(2),option=(k,def)=>{const i=args.indexOf(k);return i<0?def:args[i+1];};
const recipePath=resolve(option('--recipe','recipes/professional-face-sculpt.json'));
const recipeData=readFileSync(recipePath),recipe=JSON.parse(recipeData.toString());
const schema=JSON.parse(readFileSync(new URL('../schemas/professional-geometry.schema.json',import.meta.url),'utf8'));
const ajv=new Ajv2020({strict:false,allErrors:true}),valid=ajv.compile(schema);
if(!valid(recipe))throw Error('MARK Geometry recipe JSON Schema failed: '+ajv.errorsText(valid.errors));
const input=option('--input',null);
const sourceBytes=input?new Uint8Array(readFileSync(resolve(input))):null;
const r=runGeometryRecipe(recipe,{sourceBytes,compact:true});
const outputDir=resolve(option('--out','dist/professional/'+recipe.project.id));
mkdirSync(outputDir,{recursive:true});
const filename=recipe.project.id+'.glb';
const digest=data=>createHash('sha256').update(data).digest('hex');
writeFileSync(join(outputDir,filename),r.glb);
writeFileSync(join(outputDir,recipe.project.id+'.mark3d'),r.project);
writeFileSync(join(outputDir,'recipe.json'),JSON.stringify(recipe,null,2)+'\n');
const checkpointFiles=[];
for(const [name,checkpoint] of r.checkpoints){
 const glbName='checkpoint-'+name+'.glb',projectName='checkpoint-'+name+'.mark3d';
 writeFileSync(join(outputDir,glbName),checkpoint.glb);
 writeFileSync(join(outputDir,projectName),checkpoint.project);
 checkpointFiles.push({name,glb:glbName,mark3d:projectName,sha256:digest(checkpoint.glb)});
}
const reopened=EditableMesh.fromGlb(r.glb),reimport=reopened.inspect();
const restored=decodeMark3d(r.project).mesh;
const stableIdMatch=JSON.stringify([...restored.vertices.keys()])===JSON.stringify([...r.mesh.vertices.keys()]);
if(!stableIdMatch||digest(restored.toGlb())!==digest(r.glb))
 throw Error('Binary MARK3D load changed stable IDs or GLB geometry');
if(reimport.triangles!==r.inspection.triangles||reimport.degenerateFaces||reimport.nonManifoldEdges)
 throw Error('Re-imported GLB integrity check failed: '+JSON.stringify(reimport));
const report={engine:'MARK Geometry Core 0.2 binary',sourceCommit:process.env.GITHUB_SHA||'local-unverified',
 projectId:recipe.project.id,recipeSha256:digest(recipeData),glbSha256:digest(r.glb),
 resultGlb:filename,editableProject:recipe.project.id+'.mark3d',
 coordinateSystem:'glTF: +Y up, +Z forward, right-handed',
 topology:r.inspection,reimport,binaryProjectBytes:r.project.byteLength,
 binaryReloadGlbIdentical:true,stableIdMatch,
 commands:r.events,warnings:r.warnings,checkpoints:checkpointFiles,
 limitations:['single PBR material per object','no skinned or morph import','no texture/paint transfer',
  'no automatic retopology','no professional eyelid and mouth loops','no rigging']};
writeFileSync(join(outputDir,'report.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({outputDir,sha256:report.glbSha256,topology:r.inspection,
 checkpoints:checkpointFiles.map(c=>c.name),commands:r.events.length},null,2));
