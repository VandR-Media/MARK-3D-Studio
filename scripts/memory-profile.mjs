/** Profile memory per phase in a FRESH Node process for a comparable mesh.
 * The numbers are approximations of process RSS/heap, not per-Map memory.
 * Run: node --expose-gc scripts/memory-profile.mjs --grid 158
 */
import {performance} from 'node:perf_hooks';
import {mkdirSync,writeFileSync} from 'node:fs';
import {EditableMesh} from '../src/professional-geometry.js';
import {encodeMark3d,decodeMark3d} from '../src/compact-project.js';
const args=process.argv.slice(2),n=Number(args[args.indexOf('--grid')+1]||158);
if(![112,158,224].includes(n))throw Error('Only 112, 158, 224 supported for fair comparison');
const mb=x=>Number((x/1048576).toFixed(2));
const measure=(phase)=>{
 if(global.gc)global.gc();
 const m=process.memoryUsage();
 const o={phase,rssMiB:mb(m.rss),heapUsedMiB:mb(m.heapUsed),
  heapTotalMiB:mb(m.heapTotal),arrayBuffersMiB:mb(m.arrayBuffers),
  externalMiB:mb(m.external),atMs:Number(performance.now().toFixed(1))};
 stages.push(o);return o;
};
function grid(n){
 const positions=[],indices=[],uvs=[];
 for(let y=0;y<=n;y++)for(let x=0;x<=n;x++){
  const xx=x/n*2-1,yy=y/n*2-1;
  positions.push(xx,yy,.02*Math.sin(xx*3)*Math.sin(yy*3));uvs.push(x/n,y/n);
 }
 for(let y=0;y<n;y++)for(let x=0;x<n;x++){
  const a=y*(n+1)+x,b=a+1,c=a+n+1,d=c+1;
  indices.push(a,b,d,a,d,c);
 }
 return {positions,indices,uvs};
}
const stages=[];measure('initial');
let geometry=grid(n);measure('input coordinate/index/uv JS arrays');
let mesh=EditableMesh.fromGeometry(geometry);measure('first EditableMesh halfedge graph');
geometry=null;measure('input JS arrays released');
const began=performance.now();
for(let i=0;i<10;i++)mesh.brush({center:[0,0,0],radius:.07,strength:.25,mode:'grab',delta:[0,0,.00025]});
const brushMs=(performance.now()-began)/10;measure('10 sparse edits & delta history');
let binary=encodeMark3d(mesh);measure('MARK3D gzip export allocated');
let glb=mesh.toGlb();measure('GLB export buffers allocated');
glb=null;measure('GLB temporary buffers released');
let reopened=decodeMark3d(binary).mesh;measure('SECOND EditableMesh decoded, 10 deltas');
let undoStart=performance.now();for(let i=0;i<10;i++)if(!reopened.undo())throw Error('Lost history');
const undoMs=(performance.now()-undoStart)/10;measure('after ten Undos');
for(let i=0;i<10;i++)if(!reopened.redo())throw Error('Lost Redo');
const final=measure('redo and two active meshes');
const baseline={112:249.352,158:503.965,224:890.238}[n]; // exact Stage2 CI 43882367783
const reductionPct=Number(((baseline-final.rssMiB)/baseline*100).toFixed(1));
const report={sourceCommit:process.env.GITHUB_SHA||'local-unverified',
 node:process.version,platform:process.platform,grid:n,triangles:n*n*2,
 baselineRSSMiB:baseline,baselineRun:'https://github.com/VandR-Media/MARK-3D-Studio/actions/runs/43882367783',
 currentRSSMiB:final.rssMiB,reductionPct,meets40PercentTarget:reductionPct>=40,
 brushMsPerStroke:Number(brushMs.toFixed(3)),undoMsPerStroke:Number(undoMs.toFixed(4)),
 binaryProjectBytes:binary.byteLength,peakRSSMiB:Math.max(...stages.map(x=>x.rssMiB)),
 logicalObjects:{vertices:mesh.vertices.size,faces:mesh.faces.size,edges:mesh.edges.size,
  halfEdges:mesh.halfEdges.size,adjacencyLists:mesh.adj.size,
  sparseUndoItems:mesh.history.length,spatialIndexLazy:mesh._spatial!==null},
 stages,note:'CI Node.js RSS memory is not Huawei RAM. Per-component heap ownership cannot be inferred from RSS phase deltas. Base run used a different CI invocation/heap state; compare indicative, not exact.'};
mkdirSync('dist/stage21',{recursive:true});
writeFileSync('dist/stage21/memory-'+report.triangles+'.json',JSON.stringify(report,null,2)+'\n');
console.log('STAGE21 MEMORY '+JSON.stringify({triangles:report.triangles,RSS:final.rssMiB,baseline,reductionPct,peak:report.peakRSSMiB,brushMs}));
