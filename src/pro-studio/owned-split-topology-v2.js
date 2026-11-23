/**
 * Pass30 native topology V2 candidate: deterministic, source-bound binary
 * split lineage + genuine MARKTOP1 records for the *result* GLB.
 *
 * This resource does NOT yet belong to the .markscene ZIP manifest.
 * No false migration of existing .markscene V3 projects is performed.
 */
import {materializeOwnedEdgeSplitGLB} from './owned-edge-split-glb.js';
import {buildOwnedTopologyBinary,verifyOwnedTopologyBinary,edgeID}
 from './owned-topology-binary.js';

const MAGIC='MARKTOP2',VERSION=2,HEADER=128;
const validHex=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const fault=(code,msg)=>{const e=Error('MARK_TOPO2_'+code+': '+msg);e.code='TOPO2_'+code;throw e;};
const check=(x,c,m)=>{if(!x)fault(c,m);};
const asBytes=x=>x instanceof Uint8Array?x:
 ArrayBuffer.isView(x)?new Uint8Array(x.buffer,x.byteOffset,x.byteLength):
 x instanceof ArrayBuffer?new Uint8Array(x):fault('BYTES','Expected Uint8Array');
const fromHex=x=>Uint8Array.from({length:32},(_,i)=>parseInt(x.slice(i*2,i*2+2),16));
const toHex=x=>Array.from(x,b=>b.toString(16).padStart(2,'0')).join('');
const eq=(a,b)=>a.length===b.length&&a.every((v,i)=>v===b[i]);
async function digest(data){
 check(Boolean(globalThis.crypto?.subtle),'CRYPTO','WebCrypto SHA-256 is required');
 return toHex(new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256',asBytes(data).slice())));
}
const checkSourceSha=async(sourceGLB,sha)=>{
 check(validHex(sha)&&await digest(sourceGLB)===sha,
  'SOURCE_SHA','Provided source SHA-256 does not match bytes');
};
const graphFromSource=({sourceGLB,sourceSha256,data,edgeId,t})=>
 materializeOwnedEdgeSplitGLB({sourceGLB,sourceSha256,data,edgeId,t});

/**
 * Binary layout:
 * 0..7 magic, 8 version, 12 mesh index, 16 primitive index,
 * 20..27 canonical source edge row pair, 28..35 f64 fraction,
 * 36..67 SHA256 source GLB, 68..99 SHA256 materialized GLB,
 * 100 resulting vertex count, 104 resulting triangle count,
 * 108..111 nested MARKTOP1 byte count, 112..127 reserved zero,
 * 128.. end: exact independent MARKTOP1 binary for resulting GLB.
 */
export async function buildSplitTopologyV2({
 sourceGLB,sourceSha256,data,edgeId,t=0.5
}={}){
 await checkSourceSha(sourceGLB,sourceSha256);
 const materialized=graphFromSource({sourceGLB,sourceSha256,data,edgeId,t});
 const outSha=await digest(materialized.glb);
 const own=buildOwnedTopologyBinary({sourceGLB:materialized.glb,
  sourceSha256:outSha,meshIndex:materialized.plan.meshIndex,
  primitiveIndex:materialized.plan.primitiveIndex});
 const result=new Uint8Array(HEADER+own.length),dv=new DataView(result.buffer);
 for(let i=0;i<8;i++)result[i]=MAGIC.charCodeAt(i);
 dv.setUint32(8,VERSION,true);
 dv.setUint32(12,materialized.plan.meshIndex,true);
 dv.setUint32(16,materialized.plan.primitiveIndex,true);
 dv.setUint32(20,materialized.plan.sourceRows[0],true);
 dv.setUint32(24,materialized.plan.sourceRows[1],true);
 dv.setFloat64(28,t,true);
 result.set(fromHex(sourceSha256),36);result.set(fromHex(outSha),68);
 dv.setUint32(100,materialized.vertexCount,true);
 dv.setUint32(104,materialized.faceCount,true);
 dv.setUint32(108,own.length,true);
 result.set(own,HEADER);
 return {data:result,glb:materialized.glb,outputSha256:outSha,
  plan:materialized.plan};
}
/**
 * Fail-closed replay, including full source hash, exact edge identity,
 * split interpolation, result SHA and byte-for-byte owned halfedge catalog.
 * No reliance on a caller-provided "expected output" that could be forged.
 */
export async function verifySplitTopologyV2({
 sourceGLB,sourceSha256,sourceTopologyBinary,data
}={}){
 const bytes=asBytes(data);
 check(bytes.length>=HEADER,'SIZE','Truncated split topology resource');
 const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
 check(Array.from(bytes.subarray(0,8),x=>String.fromCharCode(x)).join('')===MAGIC&&
  v.getUint32(8,true)===VERSION,'MAGIC','Unknown split topology version');
 const meshIndex=v.getUint32(12,true),primitiveIndex=v.getUint32(16,true),
  a=v.getUint32(20,true),b=v.getUint32(24,true),t=v.getFloat64(28,true),
  vertexCount=v.getUint32(100,true),faceCount=v.getUint32(104,true),
  topologyLength=v.getUint32(108,true);
 check(meshIndex===0&&primitiveIndex===0&&a<b&&
  Number.isFinite(t)&&t>0&&t<1&&
  topologyLength>96&&topologyLength<=1024*1024&&
  bytes.length===HEADER+topologyLength&&
  bytes.subarray(112,128).every(x=>x===0),
  'SHAPE','Invalid split topology header or length');
 await checkSourceSha(sourceGLB,sourceSha256);
 check(toHex(bytes.subarray(36,68))===sourceSha256,
  'SOURCE_SHA','Stored source GLB SHA differs');
 // Validate original native topology as well, never trust an arbitrary
 // index pair or forged initial resource.
 const source=verifyOwnedTopologyBinary({
  sourceGLB,sourceSha256,data:sourceTopologyBinary});
 check(source.meshIndex===meshIndex&&source.primitiveIndex===primitiveIndex&&
  source.edges.some(e=>e.a===a&&e.b===b),
  'EDGE','Canonical source edge not found');
 const result=graphFromSource({sourceGLB,sourceSha256,
  data:sourceTopologyBinary,edgeId:edgeID(sourceSha256,meshIndex,primitiveIndex,a,b),t});
 check(result.faceCount===faceCount&&result.vertexCount===vertexCount,
  'COUNTS','Recorded geometry counts differ from replay');
 const sha=await digest(result.glb);
 check(toHex(bytes.subarray(68,100))===sha,'OUTPUT_SHA',
  'Materialized GLB SHA differs from native lineage');
 const nested=bytes.slice(HEADER);
 verifyOwnedTopologyBinary({sourceGLB:result.glb,sourceSha256:sha,data:nested});
 const canonical=buildOwnedTopologyBinary({sourceGLB:result.glb,
  sourceSha256:sha,meshIndex,primitiveIndex});
 check(eq(nested,canonical),'REPLAY','Result halfedge catalog differs from canonical reconstruction');
 return{schema:'mark.owned-topology-split/2',
  sourceSha256,outputSha256:sha,edgeId:edgeID(sourceSha256,meshIndex,primitiveIndex,a,b),
  t,vertexCount,faceCount,ownedTopologyBinary:nested,glb:result.glb,
  persistedResourceBytes:bytes.length,verifiedReplay:true};
}
