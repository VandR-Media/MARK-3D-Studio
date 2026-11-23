import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {parseGlb} from '../src/glb.js';
import {buildSkinnedSeamFixture} from '../scripts/pro-studio-pass17-skinned-seam-fixture.mjs';
import {buildOwnedTopologyBinary,previewOwnedTopology} from '../src/pro-studio/owned-topology-binary.js';
import {createPreviewMarkscene,openPreviewMarkscene,repackPreviewMarkscene,exportEditedSourceGlb}
 from '../src/pro-studio/markscene-v3-preview.js';
const sha=x=>createHash('sha256').update(Buffer.from(x)).digest('hex');
const sourceGLB=buildSkinnedSeamFixture(),sourceSha256=sha(sourceGLB);
const topology=buildOwnedTopologyBinary({sourceGLB,sourceSha256}),
 graph=previewOwnedTopology({sourceGLB,sourceSha256,data:topology});
const edge=graph.edges.find(e=>e.sourceRows.join(',')==='0,1');
const edits={meshDataOperations:[],meshTopologyOperations:[],
 meshSplitOperation:{kind:'mesh.topologySplitEdge',meshIndex:0,primitiveIndex:0,
 edgeId:edge.id,t:0.5}};
const build=e=>createPreviewMarkscene(sourceGLB,{projectId:'pass30-native-split',edits:e});

test('true five-resource .markscene persists and replays split GLB with rig and morphs',async()=>{
 const created=await build(edits),opened=await openPreviewMarkscene(created.archive);
 assert.equal(opened.manifest.assetManifest.length,4);
 assert.equal(opened.manifest.splitTopologyResource.schema,'mark.owned-topology-split/2');
 assert.deepEqual(opened.splitTopologyBinary,created.splitTopologyBinary);
 assert.deepEqual(opened.sourceGLB,sourceGLB);
 const exported=await exportEditedSourceGlb(opened);
 assert.equal(exported.persistedSplitTopologyV2,true);
 assert.equal(exported.geometryModified,true);
 const prim=parseGlb(exported.glb).json.meshes[0].primitives[0],
  doc=parseGlb(exported.glb).json;
 assert.equal(doc.accessors[prim.attributes.POSITION].count,7);
 assert.equal(doc.accessors[prim.indices].count,9);
 assert.equal(doc.skins[0].joints.length,70);
 assert.equal(prim.targets.length,2);
 assert.equal(doc.animations.length,3);
 const reloaded=await openPreviewMarkscene(
  (await repackPreviewMarkscene(opened,opened.edits)).archive);
 assert.deepEqual((await exportEditedSourceGlb(reloaded)).glb,exported.glb);
 assert.equal(reloaded.manifest.assetManifest.length,4);
 assert.equal(reloaded.manifest.assetManifest[3].kind,'split-topology-v2');
});
test('removing native split via repack returns to original four-resource project',async()=>{
 const opened=await openPreviewMarkscene((await build(edits)).archive);
 const cleaned={...opened.edits};delete cleaned.meshSplitOperation;
 const reloaded=await openPreviewMarkscene((await repackPreviewMarkscene(opened,cleaned)).archive);
 assert.equal(reloaded.manifest.assetManifest.length,3);
 assert.equal(reloaded.manifest.splitTopologyResource,undefined);
 assert.equal(reloaded.splitTopologyBinary,undefined);
 const out=await exportEditedSourceGlb(reloaded);
 assert.equal(out.persistedSplitTopologyV2,false);
 assert.equal(out.geometryModified,true,'original MeshData remains in project');
 const pristine=await openPreviewMarkscene((await build({})).archive);
 assert.equal(pristine.manifest.assetManifest.length,1);
});
test('unsafe commands and stale edge are rejected before ZIP creation',async()=>{
 await assert.rejects(build({...edits,meshSplitOperation:{...edits.meshSplitOperation,edgeId:'fake'}}),
  /MARK_TOPO_EDGE_STALE|MARK_SPLIT_EDGE_STALE/);
 await assert.rejects(build({...edits,meshSplitOperation:{...edits.meshSplitOperation,t:1}}),
  /MARK_SCENE3_SPLIT_OPERATION/);
 await assert.rejects(build({...edits,meshDataOperations:[
  {kind:'meshdata.recalculateNormals',meshIndex:0,primitiveIndex:0,mode:'area-weighted'}
 ]}),/MARK_SCENE3_SPLIT_OPERATION/);
});
