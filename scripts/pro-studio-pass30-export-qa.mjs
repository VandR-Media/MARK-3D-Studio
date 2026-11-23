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
import {createPreviewMarkscene,openPreviewMarkscene,exportEditedSourceGlb}
 from '../src/pro-studio/markscene-v3-preview.js';
import {buildSplitTopologyV2,verifySplitTopologyV2}
 from '../src/pro-studio/owned-split-topology-v2.js';
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
const persisted=await buildSplitTopologyV2({
 sourceGLB,sourceSha256,data,edgeId:edge.id,t:0.5
});
const verified=await verifySplitTopologyV2({
 sourceGLB,sourceSha256,sourceTopologyBinary:data,data:persisted.data
});
if(!verified.verifiedReplay||verified.outputSha256!==sha(result.glb))
 throw Error('Source-attested V2 resource replay differs from GLB export');
const native=await createPreviewMarkscene(sourceGLB,{
 projectId:'pass30-owned-split-evidence',
 edits:{meshDataOperations:[],meshTopologyOperations:[],
  meshSplitOperation:{kind:'mesh.topologySplitEdge',meshIndex:0,
   primitiveIndex:0,edgeId:edge.id,t:0.5}}
});
const reopened=await openPreviewMarkscene(native.archive);
const nativeExport=await exportEditedSourceGlb(reopened);
if(!nativeExport.persistedSplitTopologyV2||
 sha(nativeExport.glb)!==sha(result.glb)||
 reopened.manifest.assetManifest.length!==4)
 throw Error('Five-file native project did not replay identical split GLB');
const out=resolve(process.argv[2]||'dist/pro-studio/pass30');
mkdirSync(out,{recursive:true});
writeFileSync(resolve(out,'pass30-original-skinned.glb'),sourceGLB);
writeFileSync(resolve(out,'pass30-split-skinned.glb'),result.glb);
writeFileSync(resolve(out,'pass30-owned-topology-v2.bin'),persisted.data);
writeFileSync(resolve(out,'pass30-native-split.markscene'),native.archive);
const report={pass:30,stage:'GLB export plus independently verified V2 topology resource',
 sourceSha256,resultSha256:sha(result.glb),edgeId:edge.id,
 sourceVertices:6,resultVertices:result.vertexCount,
 sourceFaces:2,resultFaces:result.faceCount,
 skinJoints:70,morphTargets:2,animationClips:3,
 topologyV2Sha256:sha(persisted.data),topologyV2Bytes:persisted.data.length,
 topologyV2ReplayVerified:true,
 nativeMarksceneSha256:sha(native.archive),nativeMarksceneBytes:native.archive.length,
 nativeMarksceneIntegrated:true,undoRedoIntegrated:false,
 sourceBinPrefixBytes:result.sourceBinPrefixBytes};
writeFileSync(resolve(out,'report.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report));
