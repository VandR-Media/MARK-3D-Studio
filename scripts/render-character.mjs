/**
 * Real screenshot evidence: load the exported GLB with GLTFLoader + WebGL2,
 * capture seven fixed orthographic camera views using Three.js (SwiftShader CI).
 */
import {chromium} from 'playwright';
import {resolve,join} from 'node:path';
import {mkdirSync,writeFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
const args=process.argv.slice(2),opt=(name,fallback)=>{const i=args.indexOf(name);return i<0?fallback:args[i+1];};
const glb=resolve(opt('--glb','dist/character/stylized-face-demo/stylized-face-demo.glb'));
const html=resolve(opt('--html','dist/MARK-3D-Studio-standalone.html'));
const out=resolve(opt('--out','dist/character/stylized-face-demo/renders'));
const views=['front','left','right','threequarter-left','threequarter-right','face-close','wireframe'];
mkdirSync(out,{recursive:true});
const errorLog=[];
const browser=await chromium.launch({headless:true,args:[
 '--no-sandbox','--enable-webgl','--use-gl=angle','--use-angle=swiftshader',
 '--enable-unsafe-swiftshader','--disable-gpu-sandbox','--disable-dev-shm-usage'
]});
try{
 const page=await browser.newPage({viewport:{width:1280,height:920},deviceScaleFactor:1});
 page.on('pageerror',e=>errorLog.push(e.message));
 page.on('console',msg=>{if(msg.type()==='error')errorLog.push(msg.text());});
 await page.goto(pathToFileURL(html).href,{waitUntil:'load'});
 await page.waitForFunction(()=>window.__MARK_STUDIO_READY__===true);
 if((await page.locator('#renderMode').innerText()).includes('НЕТ WEBGL'))throw Error('WebGL2 not available in Chromium');
 await page.locator('#modelFile').setInputFiles(glb);
 await page.waitForFunction(()=>document.getElementById('modelName').textContent.toLowerCase().includes('.glb'),{timeout:30000});
 await page.waitForFunction(()=>Boolean(window.__MARK_CAPTURE_VIEW__),{timeout:10000});
 const frames={};
 for(let i=0;i<views.length;i++){
  const view=views[i];
  const camera=await page.evaluate(view=>window.__MARK_CAPTURE_VIEW__(view),view);
  await page.waitForTimeout(160);
  const file=String(i+1).padStart(2,'0')+'-'+view+'.png';
  await page.locator('#canvasHolder canvas').screenshot({path:join(out,file)});
  frames[view]={file,camera};
 }
 await page.setViewportSize({width:430,height:930});
 await page.waitForTimeout(180);
 await page.screenshot({path:join(out,'08-huawei-portrait-ui.png'),fullPage:false});
 writeFileSync(join(out,'camera-report.json'),JSON.stringify({renderer:'Three.js WebGL2 / Chromium SwiftShader',
  frames,consoleErrors:errorLog},null,2));
 if(errorLog.length)throw Error('Chromium console/page errors: '+errorLog.join(' | '));
 console.log('REAL WebGL2 RENDERS PASS: '+views.join(', ')+'; '+Object.keys(frames).length+' cameras.');
}finally{await browser.close();}
