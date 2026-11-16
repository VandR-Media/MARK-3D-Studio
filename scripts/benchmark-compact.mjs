/** Reproducible 25k/50k/100k triangle local-sculpt storage benchmarks. */
import {performance} from 'node:perf_hooks';
import {mkdirSync,writeFileSync} from 'node:fs';
import {EditableMesh} from '../src/professional-geometry.js';
import {encodeMark3d,decodeMark3d} from '../src/compact-project.js';
const mb=x=>Number((x/1048576).toFixed(3));
function makeGrid(n){
 const positions=[],uvs=[],indices=[];
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
const sizes=[112,158,224],rows=[];
const now=()=>performance.now();
for(const n of sizes){
 if(global.gc)global.gc();
 const beforeMem=process.memoryUsage().heapUsed,begin=now();
 const mesh=EditableMesh.fromGeometry(makeGrid(n),{name:'Stress grid '+n});
 const opened=now()-begin,initialMem=process.memoryUsage().heapUsed;
 const editsStart=now();
 for(let i=0;i<10;i++)mesh.brush({center:[0,0,0],radius:.07,strength:.25,mode:'grab',delta:[0,0,.00025]});
 const editElapsed=now()-editsStart;
 const saveStart=now(),bytes=encodeMark3d(mesh),saved=now()-saveStart;
 const readStart=now(),reloaded=decodeMark3d(bytes).mesh,read=now()-readStart;
 const undoneStart=now();
 for(let i=0;i<10;i++)if(!reloaded.undo())throw Error('Lost undo');
 const undid=(now()-undoneStart)/10,redoStart=now();
 for(let i=0;i<10;i++)if(!reloaded.redo())throw Error('Lost redo');
 const redid=(now()-redoStart)/10;
 const report={triangles:2*n*n,vertices:(n+1)**2,format:'mark3d/binary-v2',
  fileSizeBytes:bytes.length,fileSizeMiB:mb(bytes.length),
  openInitialMs:Math.round(opened),saveMs:Math.round(saved),reopenMs:Math.round(read),
  averageBrushMs:Number((editElapsed/10).toFixed(2)),averageUndoMs:Number(undid.toFixed(3)),
  averageRedoMs:Number(redid.toFixed(3)),
  heapBeforeMiB:mb(beforeMem),heapAfterMeshMiB:mb(initialMem),heapAfterReloadMiB:mb(process.memoryUsage().heapUsed),
  rssAfterReloadMiB:mb(process.memoryUsage().rss),historyEntries:reloaded.history.length};
 rows.push(report);console.log(JSON.stringify(report));
}
mkdirSync('dist/compact',{recursive:true});
writeFileSync('dist/compact/performance.json',JSON.stringify({
 sourceCommit:process.env.GITHUB_SHA||'local-unverified',node:process.version,platform:process.platform,
 tests:rows,deviceMeasured:false,
 warning:'Measurements are GitHub/Node process timings, NOT Huawei mobile performance.'
},null,2)+'\n');
if(rows[1].fileSizeBytes>15*1048576)throw Error('50k triangles / 10 brush strokes exceeds 15 MiB');
