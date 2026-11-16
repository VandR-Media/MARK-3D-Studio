import {chromium} from 'playwright';
import {readFileSync,mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createTestHeadGlb} from '../src/head-fixture.js';
import {MeshEditor} from '../src/mesh-core.js';
import {parseGlb} from '../src/glb.js';
import {inspectMesh} from '../src/topology.js';
const folder=resolve('evidence/v0.3');mkdirSync(folder,{recursive:true});
const errors=[];
const browser=await chromium.launch({headless:true,args:[
 '--no-sandbox','--enable-webgl','--use-gl=angle','--use-angle=swiftshader',
 '--enable-unsafe-swiftshader','--disable-gpu-sandbox','--disable-dev-shm-usage'
]});
try {
 const page=await browser.newPage({viewport:{width:1420,height:960},deviceScaleFactor:1,acceptDownloads:true});
 page.on('pageerror',e=>errors.push(e.message));
 await page.goto(pathToFileURL(resolve('dist/MARK-3D-Studio-standalone.html')).href);
 await page.waitForFunction(()=>window.__MARK_STUDIO_READY__===true);
 if((await page.locator('#renderMode').textContent()).includes('НЕТ WEBGL'))throw Error('WebGL2 недоступен в CI Chromium');
 await page.locator('#loadSample').click();
 await page.waitForFunction(()=>document.getElementById('modelName').textContent.includes('organic-head-before'));
 await page.locator('[data-view="front"]').click();
 await page.waitForTimeout(250);
 await page.locator('#canvasHolder').screenshot({path:resolve(folder,'01-practice-head-front-before.png')});
 await page.locator('#modeEdit').click();
 await page.locator('#meshPick').click();
 await page.locator('[data-select="face"]').click();
 const canvas=await page.locator('#canvasHolder canvas').boundingBox();
 await page.mouse.click(canvas.x+canvas.width*.50,canvas.y+canvas.height*.51);
 await page.locator('[data-topology="extrude"]').click();
 await page.waitForFunction(()=>document.getElementById('charStatus').textContent.includes('сохранено в GLB'));
 await page.waitForTimeout(300);
 await page.locator('#canvasHolder').screenshot({path:resolve(folder,'02-after-real-extrude.png')});
 await page.locator('#faceParam').selectOption('noseLength');
 await page.locator('#faceAmount').evaluate(el=>{el.value='0.60';el.dispatchEvent(new Event('input',{bubbles:true}));});
 await page.locator('#faceApply').click();
 await page.waitForFunction(()=>document.getElementById('charStatus').textContent.includes('Вершины лица изменены'));
 await page.locator('#faceParam').selectOption('cheeks');
 await page.locator('#faceApply').click();
 await page.locator('#faceParam').selectOption('chin');
 await page.locator('#faceAmount').evaluate(el=>{el.value='-0.35';el.dispatchEvent(new Event('input',{bubbles:true}));});
 await page.locator('#faceApply').click();
 await page.locator('#canvasHolder').screenshot({path:resolve(folder,'03-face-studio-nose-cheeks-chin.png')});
 // Test IndexedDB autosave after idle, without relying on beforeunload.
 await page.waitForTimeout(2800);
 const saved=await page.evaluate(()=>new Promise((resolve,reject)=>{
  const request=indexedDB.open('MARK3DStudioMesh',1);
  request.onerror=()=>reject(request.error?.message);
  request.onsuccess=()=>{
   const db=request.result,tx=db.transaction('projects','readonly');
   const q=tx.objectStore('projects').get('last');
   q.onsuccess=()=>{resolve({bytes:q.result?.bytes?.byteLength||0,saved:q.result?.saved});db.close();};
   q.onerror=()=>reject(q.error?.message);
  };
 }));
 if(!(saved.bytes>100000))throw Error('IndexedDB autosave is missing edited GLB.');
 const details=page.locator('.character-sub').filter({has:page.locator('#charDuplicate')});
 await details.locator('summary').click();
 await page.locator('#charDuplicate').click();
 await page.waitForFunction(()=>document.querySelectorAll('#charObject option').length===2);
 await page.locator('#charPreset').selectOption('plastic');
 await page.locator('#charAssignMaterial').click();
 await page.waitForFunction(()=>document.getElementById('charStatus').textContent.includes('PBR-материал'));
 const auditPanel=page.locator('.character-sub').filter({has:page.locator('#charDiagnose')});
 await auditPanel.locator('summary').click();
 await page.locator('#charDiagnose').click();
 const downloadEvent=page.waitForEvent('download');
 await page.locator('#exportButton').click();
 const download=await downloadEvent;
 const dest=resolve(folder,'character-v03-edited-in-browser.glb');
 await download.saveAs(dest);
 const bytes=new Uint8Array(readFileSync(dest)),doc=parseGlb(bytes).json;
 const edited=new MeshEditor(bytes,0),original=new MeshEditor(createTestHeadGlb());
 if(edited.triangleCount<=original.triangleCount)throw Error('Browser extrude did not alter polygon indices');
 if(doc.meshes.length!==2||doc.materials.length<2||doc.scenes[0].nodes.length!==2)
  throw Error('Export lost independent object, node or PBR material');
 let moved=0;
 for(let i=0;i<original.positions.length;i++)if(original.positions[i]!==edited.positions[i])moved++;
 if(moved===0)throw Error('Face Studio did not alter exported Float32 vertex positions');
 const audit=inspectMesh(edited.positions,edited.indices);
 if(audit.invalidTriangles||audit.nonManifoldEdges||audit.boundaryEdges)throw Error('Exported head is invalid/non-manifold');
 await page.locator('#modelFile').setInputFiles(dest);
 await page.waitForFunction(()=>document.getElementById('modelName').textContent.includes('character-v03-edited-in-browser'));
 await page.waitForFunction(()=>document.querySelectorAll('#charObject option').length===2);
 await page.locator('[data-view="front"]').click();
 await page.locator('#canvasHolder').screenshot({path:resolve(folder,'04-reimport-front.png')});
 await page.locator('[data-view="side"]').click();
 await page.locator('#canvasHolder').screenshot({path:resolve(folder,'05-reimport-side.png')});
 await page.locator('[data-view="perspective"]').click();
 await page.locator('#canvasHolder').screenshot({path:resolve(folder,'06-reimport-threequarter.png')});
 await page.setViewportSize({width:430,height:930});
 await page.waitForTimeout(300);
 await page.screenshot({path:resolve(folder,'07-huawei-portrait-layout.png')});
 console.log('v0.3 WebGL PASS: edited=',moved,'coordinate scalars; triangle count=',edited.triangleCount,
  '; objects=',doc.meshes.length,'; materials=',doc.materials.length,'; IndexedDB bytes=',saved.bytes);
 if(errors.length)throw Error('Browser JavaScript errors: '+errors.join(' | '));
} finally { await browser.close(); }
