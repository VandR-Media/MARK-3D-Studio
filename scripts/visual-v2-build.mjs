/**
 * Compile audited non-executable recipe → fully editable MARK Visual Scene JSON.
 * Real GLB and PNG are produced by the separate Chromium acceptance script,
 * never by copying a 2D design mock.
 */
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve,basename,join} from 'node:path';
import {createHash} from 'node:crypto';
import Ajv2020 from 'ajv/dist/2020.js';
import {runVisualRecipe,serializeVisualScene} from '../src/visual-engine/scene-model.js';
const argv=process.argv.slice(2);
const arg=(name,defaultValue)=>{const i=argv.indexOf(name);return i===-1?defaultValue:argv[i+1];};
const recipePath=resolve(arg('--recipe','recipes/visual-v2-analog-studio.json'));
const out=resolve(arg('--out','dist/visual-v2'));
const input=readFileSync(recipePath,'utf8'),recipe=JSON.parse(input);
const schema=JSON.parse(readFileSync(new URL('../schemas/mark-visual-recipe-v2.schema.json',import.meta.url),'utf8'));
const ajv=new Ajv2020({strict:false,allErrors:true}),validate=ajv.compile(schema);
if(!validate(recipe))throw Error('Invalid Visual Recipe: '+ajv.errorsText(validate.errors));
const {scene,report}=runVisualRecipe(recipe);
mkdirSync(out,{recursive:true});
const hash=data=>createHash('sha256').update(data).digest('hex');
const serialized=serializeVisualScene(scene);
const sceneName=scene.id+'.markscene',scenePath=join(out,sceneName);
writeFileSync(scenePath,serialized);writeFileSync(join(out,scene.id+'-recipe.json'),input);
const result={
 sourceCommit:process.env.MARK_SOURCE_SHA||process.env.GITHUB_SHA||'local-unverified',engine:'MARK Visual Engine v2',
 recipe:basename(recipePath),recipeSha256:hash(input),sceneSha256:hash(serialized),
 editProject:sceneName,actualGlb:'generated in Chromium acceptance, not in CLI',
 objectCount:scene.objects.length,physicalMeshes:scene.objects.filter(o=>o.geometry.type!=='group').length,
 materialCount:Object.keys(scene.materials).length,bindings:scene.bindings,
 overlays:scene.overlays.length,commandResults:report,
 limitations:['GLB output requires Three.js renderer','Android playback is not integrated',
  'only Analog Studio and Spectrum Matrix generated','HDRI requires user-provided embedded panorama']
};
writeFileSync(join(out,scene.id+'-report.json'),JSON.stringify(result,null,2)+'\n');
console.log('MARK Visual Engine v2 RECIPE PASS',JSON.stringify({
 scene:scene.id,physicalMeshes:result.physicalMeshes,bindings:result.bindings.length,hash:result.sceneSha256
}));
