/** Real mobile Chromium/WebGL2 UI acceptance for Native Core, no mock screenshots. */
import {chromium} from 'playwright';
import {PNG} from 'pngjs';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {decodeMark3d} from '../src/compact-project.js';
import {parseGlb} from '../src/glb.js';
const folder=resolve('dist/stage2-browser'),sha=b=>createHash('sha256').update(b).digest('hex');
mkdirSync(folder,{recursive:true});
const browser=await chromium.launch({headless:true,args:[
 '--no-sandbox','--enable-webgl','--use-gl=angle','--use-angle=swiftshader',
 '--enable-unsafe-swiftshader','--disable-gpu-sandbox','--disable-dev-shm-usage'
]});
const report={sourceCommit:process.env.GITHUB_SHA||'local-unverified',renderer:'Chromium real WebGL2',
 deviceViewport:{width:430,height:930},status:'running',errors:[],images:[]};
try{
 const page=await browser.newPage({viewport:report.deviceViewport,acceptDownloads:true});
 page.on('pageerror',e=>report.errors.push(e.message));
 page.on('console',m=>{if(m.type()==='error')report.errors.push(m.text());});
 await page.goto(pathToFileURL(resolve('dist/MARK-3D-Studio-standalone.html')).href,{waitUntil:'load'});
 await page.waitForFunction(()=>window.__MARK_STUDIO_READY__===true,null,{timeout:20000});
 await page.locator('#professionalUi summary').click();
 await page.locator('#proNew').click();
 await page.waitForFunction(()=>window.__MARK_SCENE_STATE__?.phase==='ready' &&
  document.querySelector('#proSave')?.disabled===false,null,{timeout:90000});
 async function capture(view,file){
  const cam=await page.evaluate(v=>window.__MARK_CAPTURE_VIEW__(v),view);
  if(cam.renderedTriangles<1000)throw Error('Real screenshot has no triangles');
  await page.waitForTimeout(120);
  const buf=await page.locator('#canvasHolder canvas').screenshot();
  const png=PNG.sync.read(buf);
  if(png.width<200||png.height<250||buf.length<8000)throw Error('Blank render '+file);
  writeFileSync(join(folder,file),buf);report.images.push({view,file,bytes:buf.length,
   sha256:sha(buf),renderedTriangles:cam.renderedTriangles});
  return buf;
 }
 const original=await capture('eyes-close','original-eyes.png');
 await page.locator('#proRegion').selectOption('eye_left_rim');
 await page.locator('#proDx').fill('0');
 await page.locator('#proDy').fill('0.01');
 await page.locator('#proDz').fill('0.035');
 await page.locator('#proRadius').evaluate(el=>{el.value='0.18';el.dispatchEvent(new Event('input',{bubbles:true}));});
 await page.locator('#proStrength').evaluate(el=>{el.value='0.6';el.dispatchEvent(new Event('input',{bubbles:true}));});
 await page.locator('#proSculpt').click();
 await page.waitForFunction(()=>window.__MARK_SCENE_STATE__?.phase==='ready',null,{timeout:90000});
 const modified=await capture('eyes-close','edited-eyes.png');
 if(sha(original)===sha(modified))throw Error('UI brush did not change actual WebGL screenshot');
 for(const view of ['front','left','right','back','threequarter-left','threequarter-right','nose-close','mouth-close','wireframe'])
  await capture(view,'after-'+view+'.png');
 const [saveD]=await Promise.all([page.waitForEvent('download'),page.locator('#proSave').click()]);
 await saveD.saveAs(join(folder,'project.mark3d'));
 const [glbD]=await Promise.all([page.waitForEvent('download'),page.locator('#proExport').click()]);
 await glbD.saveAs(join(folder,'edited.glb'));
 const binary=new Uint8Array(readFileSync(join(folder,'project.mark3d')));
 const reloaded=decodeMark3d(binary).mesh;
 const glb=new Uint8Array(readFileSync(join(folder,'edited.glb')));
 if(sha(glb)!==sha(reloaded.toGlb()))throw Error('UI GLB does not match saved native binary project');
 const info=parseGlb(glb).json;
 report.meshes=info.meshes.length;report.triangles=reloaded.inspect().triangles;
 report.nativeBytes=binary.length;report.glbSha256=sha(glb);
 await page.locator('#proOpen').setInputFiles(join(folder,'project.mark3d'));
 await page.waitForFunction(()=>window.__MARK_SCENE_STATE__?.phase==='ready',null,{timeout:90000});
 const [secondD]=await Promise.all([page.waitForEvent('download'),page.locator('#proExport').click()]);
 await secondD.saveAs(join(folder,'reopened.glb'));
 if(sha(readFileSync(join(folder,'reopened.glb')))!==sha(glb))
  throw Error('Browser import of saved MARK3D changed exported GLB');
 await page.screenshot({path:join(folder,'huawei-portrait-native-editor.png'),fullPage:true});
 if(report.errors.length)throw Error('Browser JS exceptions: '+report.errors.join(' | '));
 report.status='pass';
 console.log('REAL MOBILE WEBGL NATIVE EDIT PASS '+JSON.stringify({
  triangles:report.triangles,nativeMiB:(binary.length/1048576).toFixed(2),screenshots:report.images.length}));
}finally{
 writeFileSync(join(folder,'browser-report.json'),JSON.stringify(report,null,2)+'\n');
 await browser.close();
}
if(report.status!=='pass')throw Error('Stage2 browser acceptance failed');
