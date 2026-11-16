import {chromium} from 'playwright';
import {readFileSync,mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createTestHeadGlb} from '../src/head-fixture.js';
import {MeshEditor} from '../src/mesh-core.js';
const folder=resolve('screenshots');mkdirSync(folder,{recursive:true});
const errors=[];
const browser=await chromium.launch({headless:true,args:[
 '--no-sandbox','--enable-webgl','--use-gl=angle','--use-angle=swiftshader',
 '--enable-unsafe-swiftshader','--disable-gpu-sandbox','--disable-dev-shm-usage'
]});
try{
 const page=await browser.newPage({viewport:{width:1380,height:900},deviceScaleFactor:1,acceptDownloads:true});
 page.on('pageerror',e=>errors.push(e.message));
 page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 await page.goto(pathToFileURL(resolve('dist/MARK-3D-Studio-standalone.html')).href,{waitUntil:'load'});
 await page.waitForFunction(()=>window.__MARK_STUDIO_READY__===true);
 if((await page.locator('#renderMode').textContent()).includes('НЕТ WEBGL'))throw Error('WebGL2 not available in CI Chromium');
 await page.locator('#loadSample').click();
 await page.waitForFunction(()=>document.getElementById('modelName')?.textContent?.includes('organic-head-before'));
 await page.waitForTimeout(700);
 await page.screenshot({path:resolve(folder,'mesh-editor-head-before.png'),fullPage:false});
 await page.locator('[data-view="front"]').click();
 await page.locator('#modeEdit').click();
 await page.locator('#meshSculpt').click();
 const canvas=await page.locator('#canvasHolder canvas').boundingBox();
 if(!canvas)throw Error('WebGL canvas missing.');
 const x=canvas.x+canvas.width*.5,y=canvas.y+canvas.height*.5;
 await page.mouse.move(x,y);await page.mouse.down();
 await page.mouse.move(x+45,y-8,{steps:10});await page.mouse.up();
 await page.waitForTimeout(500);
 await page.screenshot({path:resolve(folder,'mesh-editor-head-after.png'),fullPage:false});
 const downloadEvent=page.waitForEvent('download');
 await page.locator('#exportButton').click();
 const download=await downloadEvent;
 const dest=resolve(folder,'head-after-browser-edit.glb');
 await download.saveAs(dest);
 const before=new MeshEditor(createTestHeadGlb()),after=new MeshEditor(new Uint8Array(readFileSync(dest)));
 let changed=0;for(let i=0;i<before.positions.length;i++)if(before.positions[i]!==after.positions[i])changed++;
 if(changed===0)throw Error('Browser sculpt did not change exported BIN vertex coordinates.');
 console.log('Browser WebGL2 screenshot and exported GLB validated. Changed scalar coordinates:',changed);
 console.log('Editor status:',await page.locator('#meshSafety').textContent());
 if(errors.length)console.log('Browser console errors:',errors.slice(0,8));
}finally{await browser.close();}
