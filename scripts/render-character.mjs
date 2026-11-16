/**
 * MARK v0.4.1 strict acceptance: five consecutive complete GLB imports and
 * seven screenshots EACH. No readiness inferred from a filename label.
 * Actual WebGL2 Three.js render; PNG validates nonempty foreground.
 */
import {chromium} from 'playwright';
import {PNG} from 'pngjs';
import {resolve,join} from 'node:path';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
const args=process.argv.slice(2);
const opt=(n,def)=>{const i=args.indexOf(n);return i<0?def:args[i+1];};
const glb=resolve(opt('--glb','dist/character/stylized-face-demo/stylized-face-demo.glb'));
const html=resolve(opt('--html','dist/MARK-3D-Studio-standalone.html'));
const out=resolve(opt('--out','dist/character/stylized-face-demo/renders'));
const runs=Number(opt('--runs','5'));
if(!Number.isInteger(runs)||runs<1||runs>10)throw Error('Allowed --runs: 1–10; use 5 for candidate acceptance');
const views=opt('--views','front,left,right,threequarter-left,threequarter-right,face-close,wireframe').split(',').map(s=>s.trim());
if(views.some(s=>!s||!/^[a-z-]+$/.test(s))||new Set(views).size!==views.length)throw Error('Invalid or duplicated --views');
const build=JSON.parse(readFileSync(resolve('dist/build-info.json'),'utf8'));
const sourceSha=process.env.GITHUB_SHA||'local-unverified';
const glbHash=createHash('sha256').update(readFileSync(glb)).digest('hex');
if(build.sourceCommit!==sourceSha)throw Error('Build SHA mismatch expected '+sourceSha+' got '+build.sourceCommit);
mkdirSync(out,{recursive:true});
function checkPng(buffer,view,iteration){
 const png=PNG.sync.read(buffer);
 if(png.width<200||png.height<150)throw Error('Empty/too-small PNG for '+view);
 const data=png.data;
 const first=[data[0],data[1],data[2]];
 let colored=0,minX=png.width,minY=png.height,maxX=-1,maxY=-1;
 for(let y=3;y<png.height-3;y+=3)for(let x=3;x<png.width-3;x+=3){
  const i=(y*png.width+x)*4;
  const dif=Math.abs(data[i]-first[0])+Math.abs(data[i+1]-first[1])+Math.abs(data[i+2]-first[2]);
  if(dif<46)continue;
  colored++;minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);
 }
 if(colored<350||maxX-minX<36||maxY-minY<45)
  throw Error('Model not visible in '+view+' run '+iteration+': colored='+colored+' bounds='+[minX,minY,maxX,maxY]);
 return {foregroundSamples:colored,bounds:[minX,minY,maxX,maxY],width:png.width,height:png.height};
}
const browser=await chromium.launch({headless:true,args:[
 '--no-sandbox','--enable-webgl','--use-gl=angle','--use-angle=swiftshader',
 '--enable-unsafe-swiftshader','--disable-gpu-sandbox','--disable-dev-shm-usage'
]});
const outcomes=[];
try{
 const page=await browser.newPage({viewport:{width:960,height:720},deviceScaleFactor:1});
 const errors=[];
 page.on('pageerror',e=>errors.push('pageerror: '+e.message));
 page.on('console',m=>{if(m.type()==='error')errors.push('console: '+m.text());});
 for(let iter=1;iter<=runs;iter++){
  const beginError=errors.length;
  try{
   await page.goto(pathToFileURL(html).href,{waitUntil:'load'});
   await page.waitForFunction(()=>window.__MARK_STUDIO_READY__===true,null,{timeout:20000});
   const meta=await page.locator('meta[name="mark-source-commit"]').getAttribute('content');
   if(meta!==sourceSha)throw Error('HTML source SHA mismatch '+meta+' vs '+sourceSha);
   if((await page.locator('#renderMode').innerText()).includes('НЕТ WEBGL'))
    throw Error('WebGL2 not supported by Chromium in CI');
   await page.locator('#modelFile').setInputFiles(glb);
   await page.waitForFunction(()=>{
    const s=window.__MARK_SCENE_STATE__;
    return s?.phase==='ready'||s?.phase==='error';
   },null,{timeout:45000});
   const ready=await page.evaluate(()=>({...window.__MARK_SCENE_STATE__}));
   if(ready.phase!=='ready')throw Error('GLB scene did not reach ready: '+JSON.stringify(ready));
   for(const required of ['loading','parsed','geometry_created','scene_added','camera_configured','first_frame','ready']){
    if(!ready.events.some(e=>e.phase===required))throw Error('Missing state '+required);
   }
   if(ready.meshes<1||ready.triangles<1||ready.renderedTriangles<1)
    throw Error('Scene is ready but has no visible geometry');
   const frames={};
   for(let i=0;i<views.length;i++){
    const view=views[i];
    const camera=await page.evaluate(v=>window.__MARK_CAPTURE_VIEW__(v),view);
    if(camera.renderedTriangles<1)throw Error('Zero geometry drawn in '+view);
    await page.waitForTimeout(120);
    const image=await page.locator('#canvasHolder canvas').screenshot();
    const visual=checkPng(image,view,iter);
    const file=String(i+1).padStart(2,'0')+'-'+view+'.png';
    if(iter===runs)writeFileSync(join(out,file),image);
    frames[view]={file,camera,visual};
   }
   if(iter===runs){
    await page.setViewportSize({width:430,height:930});
    await page.waitForTimeout(160);
    await page.screenshot({path:join(out,'08-huawei-portrait-ui.png')});
   }
   if(errors.length!==beginError)throw Error('JavaScript errors: '+errors.slice(beginError).join(' | '));
   outcomes.push({iteration:iter,status:'pass',sha:sourceSha,glbSha256:glbHash,meshes:ready.meshes,
    triangles:ready.triangles,phases:ready.events.map(x=>x.phase),frames});
   console.log('PASS '+iter+'/'+runs+' GLB ready '+ready.meshes+' meshes; seven genuine PNG views, SHA '+sourceSha.slice(0,9));
  }catch(error){
   const state=await page.evaluate(()=>window.__MARK_SCENE_STATE__||null).catch(()=>null);
   outcomes.push({iteration:iter,status:'fail',error:error.message,sceneState:state,
    pageErrors:errors.slice(beginError)});
   throw Error('Render reliability iteration '+iter+' failed: '+error.message+
    '; state='+JSON.stringify(state)+'; pageErrors='+errors.slice(beginError).join(' | '));
  }
 }
 writeFileSync(join(out,'camera-report.json'),JSON.stringify({
  renderer:'Three.js WebGL2 / Chromium SwiftShader',
  sourceCommit:sourceSha,glbSha256:glbHash,requiredRuns:runs,successfulRuns:outcomes.length,
  viewsPerRun:views,sevenViewsPerRun:views,allPassed:outcomes.every(x=>x.status==='pass'),outcomes
 },null,2)+'\n');
}finally{
 if(outcomes.some(x=>x.status==='fail'))writeFileSync(join(out,'render-errors.json'),JSON.stringify(outcomes,null,2));
 await browser.close();
}
