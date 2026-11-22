/** Pass30 actual deterministic GLB test artifact (not a persisted .markscene). */
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {buildSkinnedSeamFixture} from './pro-studio-pass17-skinned-seam-fixture.mjs';
import {buildOwnedTopologyBinary,previewOwnedTopology}
 from '../src/pro-studio/owned-topology-binary.js';
import {materializeOwnedEdgeSplitGLB}
 from '../src/pro-studio/owned-edge-split-glb.js';
import {parseGlb} from '../src/glb.js';
const sha=x=>createHash('sha256').update(Buffer.from(x)).digest('hex');
const sourceGLB=buildSkinnedSeamFixture(),sourceSha256=sha(sourceGLB);
const data=buildOwnedTopologyBinary({sourceGLB,sourceSha256});
const graph=previewOwnedTopology({sourceGLB,sourceSha256,data});
const edge=graph.edges.find(e=>e.sourceRows.join(',')==='0,1');
if(!edge)throw Error('Expected source boundary edge 0,1');
const result=materializeOwnedEdgeSplitGLB({
 sourceGLB,sourceSha256,data,edgeId:edge.id,t:0.5
});
const opened=parseGlb(result.glb),primitive=opened.json.meshes[0].primitives[0];
if(result.faceCount!==3||result.vertexCount!==7||
 opened.json.skins?.[0]?.joints?.length!==70||
 primitive.targets?.length!==2||
 opened.json.animations?.length!==3)throw Error('Real GLB QA invariant failed');
const out=resolve(process.argv[2]||'dist/pro-studio/pass30');
mkdirSync(out,{recursive:true});
writeFileSync(resolve(out,'pass30-original-skinned.glb'),sourceGLB);
writeFileSync(resolve(out,'pass30-split-skinned.glb'),result.glb);
const report={pass:30,stage:'independent GLB export only',
 sourceSha256,resultSha256:sha(result.glb),edgeId:edge.id,
 sourceVertices:6,resultVertices:result.vertexCount,
 sourceFaces:2,resultFaces:result.faceCount,
 skinJoints:70,morphTargets:2,animationClips:3,
 nativeMarksceneIntegrated:false,undoRedoIntegrated:false,
 sourceBinPrefixBytes:result.sourceBinPrefixBytes};
writeFileSync(resolve(out,'report.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report));
