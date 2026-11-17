/**
 * True Chromium/SwiftShader WebGL2 Visual Engine v2 acceptance.
 * No fake screenshots, no prebaked instrument image. Screenshots are from
 * the actual canvas; WAV is generated as PCM16 and decoded by Web Audio.
 */
import {chromium} from 'playwright';
import {PNG} from 'pngjs';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {parseGlb} from '../src/glb.js';
const sha=x=>createHash('sha256').update(x).digest('hex');
const output=resolve('dist/visual-v2/acceptance');
mkdirSync(output,{recursive:true});
const renderUrl=pathToFileURL(resolve('dist/MARK-Visual-Engine-v2.html')).href;
function makeStereoWav({sr=48000,seconds=2.7}={}){
 const n=sr*seconds|0,b=new Uint8Array(44+n*4),v=new DataView(b.buffer);
 const ascii=(s,o)=>{for(let i=0;i<s.length;i++)v.setUint8(o+i,s.charCodeAt(i));};
 ascii('RIFF',0);v.setUint32(4,b.length-8,true);ascii('WAVE',8);ascii('fmt ',12);
 v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,2,true);
 v.setUint32(24,sr,true);v.setUint32(28,sr*4,true);
 v.setUint16(32,4,true);v.setUint16(34,16,true);
 ascii('data',36);v.setUint32(40,n*4,true);
 for(let i=0;i<n;i++){
  v.setInt16(44+i*4,Math.round(.75*Math.sin(2*Math.PI*120*i/sr)*32767),true);
  v.setInt16(46+i*4,Math.round(.75*Math.sin(2*Math.PI*6000*i/sr)*32767),true);
 }
 return Buffer.from(b);
}
const wav=makeStereoWav(),browser=await chromium.launch({headless:true,args:[
 '--no-sandbox','--enable-webgl','--use-gl=angle','--use-angle=swiftshader',
 '--enable-unsafe-swiftshader','--disable-dev-shm-usage','--autoplay-policy=no-user-gesture-required'
]});
const report={sourceCommit:process.env.GITHUB_SHA||'local-unverified',renderer:'Chromium WebGL2',
 syntheticInput:'Decoded 2.7 s WAV with L=120 Hz R=6000 Hz (independent known PCM; not a commercial track)',
 tests:[],screenshots:[],errors:[],status:'running',deviceMeasured:false};
async function capture(page,file){
 const buffer=await page.locator('#visualCanvas').screenshot();
 const image=PNG.sync.read(buffer);
 if(image.width<200||image.height<200||buffer.length<7000)
  throw Error('Blank or tiny WebGL canvas: '+file);
 const path=join(output,file);writeFileSync(path,buffer);
 report.screenshots.push({file,bytes:buffer.length,sha256:sha(buffer),width:image.width,height:image.height});
 return sha(buffer);
}
async function testPreset(preset,viewport){
 const kind=preset==='analog-studio'?'analog':'matrix',device=viewport.width<600?'mobile':'desktop';
 const page=await browser.newPage({viewport,acceptDownloads:true,deviceScaleFactor:1});
 const jsErrors=[];page.on('pageerror',e=>jsErrors.push(e.message));
 await page.goto(renderUrl,{waitUntil:'load'});
 await page.waitForFunction(()=>window.__MARK_VISUAL_READY__===true||Boolean(window.__MARK_VISUAL_ERROR__),null,{timeout:40000});
 const error=await page.evaluate(()=>window.__MARK_VISUAL_ERROR__);
 if(error)throw Error('Visual renderer initialization: '+error);
 await page.locator('#mode').selectOption(preset);
 await page.waitForFunction(target=>window.MARK_VISUAL_API?.scene()?.id===target,
  preset==='analog-studio'?'analog-studio-v2':'spectrum-matrix-v2',{timeout:40000,polling:200});
 const info=await page.evaluate(()=>window.MARK_VISUAL_API.renderStats());
 if(info.meshCount<(kind==='analog'?100:110)||info.ledCount!==(kind==='analog'?48:108))
  throw Error('Wrong real physical object count '+JSON.stringify(info));
 await page.evaluate(()=>window.MARK_VISUAL_API.view('front'));
 const front=await capture(page,kind+'-'+device+'-front.png');
 await page.evaluate(()=>window.MARK_VISUAL_API.view('threequarter'));
 const threequarter=await capture(page,kind+'-'+device+'-threequarter.png');
 if(front===threequarter)throw Error('3D parallax test failed: camera rotation produced identical pixels');
 const b64=await page.evaluate(()=>window.MARK_VISUAL_API.exportGlb());
 const glb=Buffer.from(b64,'base64'),parsed=parseGlb(glb).json;
 if(parsed.meshes.length<70||parsed.materials.length<10||parsed.nodes.length<75)
  throw Error('3D export is not multi-mesh or lost materials');
 writeFileSync(join(output,kind+'-'+device+'.glb'),glb);
 const saved=await page.evaluate(()=>window.MARK_VISUAL_API.scene());
 const reloaded=await page.evaluate(async s=>window.MARK_VISUAL_API.loadScene(s),saved);
 if(reloaded.objects!==saved.objects.length)throw Error('Editable .markscene reload lost objects');
 if(device==='desktop'){
  await page.locator('#audioFile').setInputFiles({name:'independent-stereo-120Hz-6000Hz.wav',
   mimeType:'audio/wav',buffer:wav});
  await page.waitForFunction(()=>window.MARK_VISUAL_API?.audioState()?.source==='pcm',null,{timeout:12000});
  const audio=await page.evaluate(()=>({
   channels:window.MARK_VISUAL_API.activeSegments(),state:window.MARK_VISUAL_API.audioState()
  }));
  if(!(audio.channels['left.low']>audio.channels['left.high']&&
       audio.channels['right.high']>audio.channels['right.low']))
   throw Error('Six real stereo channels do not show test PCM selectivity '+JSON.stringify(audio));
  await capture(page,kind+'-real-stereo-pcm.png');
  await page.locator('#pause').click();
  await page.waitForFunction(()=>window.MARK_VISUAL_API.audioState().source==='silence',null,{timeout:3000});
  const silence=await page.evaluate(()=>window.MARK_VISUAL_API.activeSegments());
  if(Object.values(silence).some(n=>n!==0))throw Error('Silence/pause did not clear active segments');
 }
 const profileStats=[];
 for(const profile of ['eco','normal','high']){
  const t0=Date.now();
  await page.evaluate(async x=>window.MARK_VISUAL_API.setQuality(x),profile);
  const durationMs=Date.now()-t0;
  profileStats.push({profile,firstRenderWithRebuildMs:durationMs});
  if(device==='desktop')await capture(page,kind+'-'+profile+'.png');
 }
 if(jsErrors.length)throw Error('Browser JavaScript exceptions: '+jsErrors.join(' | '));
 const summary={preset,device,viewport,meshCount:info.meshCount,ledCount:info.ledCount,
  glbBytes:glb.length,glbSha256:sha(glb),sceneNodes:parsed.nodes.length,
  materialCount:parsed.materials.length,parallaxVerified:true,profiles:profileStats,status:'pass'};
 report.tests.push(summary);console.log('VISUAL V2 WEBGL PASS '+JSON.stringify(summary));
 await page.close();
}
try{
 for(const p of ['analog-studio','spectrum-matrix']){
  await testPreset(p,{width:1280,height:780});
  await testPreset(p,{width:430,height:932});
 }
 report.status='pass';
}finally{
 writeFileSync(join(output,'browser-report.json'),JSON.stringify(report,null,2)+'\n');
 await browser.close();
}
if(report.status!=='pass')throw Error('Visual Engine browser acceptance did not pass');
