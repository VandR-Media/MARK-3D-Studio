import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {buildSkinnedSeamFixture} from '../scripts/pro-studio-pass17-skinned-seam-fixture.mjs';
import {buildOwnedTopologyBinary,previewOwnedTopology}
 from '../src/pro-studio/owned-topology-binary.js';
import {buildSplitTopologyV2,verifySplitTopologyV2}
 from '../src/pro-studio/owned-split-topology-v2.js';
import {parseGlb} from '../src/glb.js';
const hash=x=>createHash('sha256').update(Buffer.from(x)).digest('hex');
const original=buildSkinnedSeamFixture(),sourceSha256=hash(original),
 sourceTopologyBinary=buildOwnedTopologyBinary({sourceGLB:original,sourceSha256});
const originalGraph=previewOwnedTopology({
 sourceGLB:original,sourceSha256,data:sourceTopologyBinary});
const edge=originalGraph.edges.find(e=>e.sourceRows.join(',')==='0,1');
const options={sourceGLB:original,sourceSha256,
 data:sourceTopologyBinary,edgeId:edge.id,t:0.5};
const verifyOptions={sourceGLB:original,sourceSha256,sourceTopologyBinary};

test('V2 binary owns changed vertices, edges, faces, halfedges and replays exact skinned GLB',async()=>{
 const a=await buildSplitTopologyV2(options),b=await buildSplitTopologyV2(options);
 assert.deepEqual(a.data,b.data);
 assert.equal(Buffer.from(a.data.slice(0,8)).toString(),'MARKTOP2');
 assert.equal(new DataView(a.data.buffer).getUint32(8,true),2);
 const verified=await verifySplitTopologyV2({...verifyOptions,data:a.data});
 assert.equal(verified.verifiedReplay,true);
 assert.equal(verified.vertexCount,7);
 assert.equal(verified.faceCount,3);
 assert.equal(verified.outputSha256,hash(a.glb));
 assert.deepEqual(verified.glb,a.glb);
 assert.deepEqual(verified.ownedTopologyBinary,a.data.slice(128));
 const resultGraph=previewOwnedTopology({
  sourceGLB:verified.glb,sourceSha256:verified.outputSha256,
  data:verified.ownedTopologyBinary});
 assert.equal(resultGraph.diagnostics.vertexCount,7);
 assert.equal(resultGraph.diagnostics.faceCount,3);
 assert.equal(resultGraph.diagnostics.halfedgeCount,9);
 assert.equal(resultGraph.diagnostics.topologyChanged,false,
  'nested MARKTOP1 describes the new materialized mesh exactly');
 const doc=parseGlb(verified.glb).json;
 assert.equal(doc.skins[0].joints.length,70);
 assert.equal(doc.animations.length,3);
 assert.equal(doc.meshes[0].primitives[0].targets.length,2);
});
test('reject truncated and forged output SHA and changed topology even if header is intact',async()=>{
 const actual=(await buildSplitTopologyV2(options)).data;
 await assert.rejects(verifySplitTopologyV2({...verifyOptions,data:actual.slice(0,-1)}),
  /MARK_TOPO2_SHAPE/);
 const forged=actual.slice();forged[68]^=1;
 await assert.rejects(verifySplitTopologyV2({...verifyOptions,data:forged}),
  /MARK_TOPO2_OUTPUT_SHA/);
 const corrupted=actual.slice();corrupted[corrupted.length-2]^=1;
 await assert.rejects(verifySplitTopologyV2({...verifyOptions,data:corrupted}),
  /MARK_TOPO_SOURCE_REPLAY|MARK_TOPO_EDGE_FLAGS/);
 const badSource=original.slice();badSource[badSource.length-1]^=1;
 await assert.rejects(verifySplitTopologyV2({...verifyOptions,sourceGLB:badSource,data:actual}),
  /MARK_TOPO2_SOURCE_SHA/);
});
test('reject split of altered source topology, forged fraction, and wrong endpoint IDs',async()=>{
 const actual=(await buildSplitTopologyV2(options)).data;
 const t=actual.slice();new DataView(t.buffer).setFloat64(28,1,true);
 await assert.rejects(verifySplitTopologyV2({...verifyOptions,data:t}),
  /MARK_TOPO2_SHAPE/);
 const pair=actual.slice();new DataView(pair.buffer).setUint32(20,999,true);
 await assert.rejects(verifySplitTopologyV2({...verifyOptions,data:pair}),
  /MARK_TOPO2_SHAPE|MARK_TOPO2_EDGE/);
 const changedTopology=sourceTopologyBinary.slice();
 changedTopology[changedTopology.length-1]^=1;
 await assert.rejects(verifySplitTopologyV2({...verifyOptions,sourceTopologyBinary:changedTopology,data:actual}),
  /MARK_TOPO_SOURCE_REPLAY|MARK_TOPO_EDGE_FLAGS/);
});
