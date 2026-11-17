/**
 * MARK Visual Engine v2 — touchscreen editor + genuine Three.js visualization.
 * Real audio comes ONLY from a user-decoded file. DEMO is explicitly labeled.
 */
import {VisualRenderer} from './visual-renderer.js';
import {runVisualRecipe,deserializeVisualScene,serializeVisualScene,validateVisualScene} from './scene-model.js';
import {StereoPcmAnalyzer,zeroStereoFrame,validateStereoFrame,AUDIO_SCHEMA} from './audio-frame.js';
const $=id=>document.getElementById(id),bytesToBase64=bytes=>{
 let out='';for(let i=0;i<bytes.length;i+=32768)out+=String.fromCharCode(...bytes.subarray(i,i+32768));
 return btoa(out);
};
const b64ToBytes=s=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));
const download=(value,name,type='application/json')=>{
 const url=URL.createObjectURL(new Blob([value],{type})),a=document.createElement('a');
 a.href=url;a.download=name;document.body.append(a);a.click();a.remove();
 setTimeout(()=>URL.revokeObjectURL(url),30000);
};
let viewer,scene,analyzer=null,audioContext=null,source=null,buffer=null,
 playing=false,audioStart=0,pauseOffset=0,lastIndex=0,raf=0,mode='analog-studio',
 demo=false,activeChannel=0,lastFrame=zeroStereoFrame(),imported=[];
const modelInfo=()=>({id:scene.id,objects:scene.objects.length,materials:Object.keys(scene.materials).length,
 bindings:scene.bindings.length,mode,realMeshes:[...viewer.nodes.values()].filter(x=>x.isMesh).length});
function recipeFor(kind){
 return {schema:'mark.visual-recipe/2',
  id:kind==='analog-studio'?'analog-studio-v2':'spectrum-matrix-v2',
  name:kind,
  commands:[{operation:'instrument.create',args:{kind,params:kind==='spectrum-matrix'?{segments:18}:{}}},
   {operation:'quality.set',args:{profile:$('quality').value}},
   {operation:'camera.set',args:{position:[0,0,13.4],target:[0,0,0],fov:37}}]};
}
function status(msg,error=false){$('status').textContent=msg;$('status').dataset.error=error?'yes':'no';}
function overlays(){
 const layer=$('overlay');layer.replaceChildren();
 for(const item of scene.overlays){
  const el=document.createElement('span');el.className='mark-label';
  el.textContent=item.text;el.style.left=(item.x*100)+'%';el.style.top=(item.y*100)+'%';
  el.style.color=item.color;el.style.fontSize=(item.size||12)+'px';layer.append(el);
 }
}
function inspector(){
 const select=$('objectSelect'),old=select.value;select.replaceChildren();
 for(const obj of scene.objects){
  if(obj.geometry.type==='group'&&obj.id!=='instrument.root')continue;
  const opt=document.createElement('option');opt.value=obj.id;opt.textContent=obj.name+' ('+obj.id+')';
  select.append(opt);
 }
 if(scene.objects.some(o=>o.id===old))select.value=old;else select.value='case.main';
 fillObject();
}
function fillObject(){
 const obj=scene.objects.find(x=>x.id===$('objectSelect').value);
 if(!obj)return;
 $('materialSelect').replaceChildren();
 for(const id of Object.keys(scene.materials)){
  const option=document.createElement('option');option.value=id;option.textContent=id;
  $('materialSelect').append(option);
 }
 if(obj.material)$('materialSelect').value=obj.material;
 const props=[...obj.position,...obj.rotation,...obj.scale];
 ['px','py','pz','rx','ry','rz','sx','sy','sz'].forEach((key,i)=>$(key).value=String(props[i]));
}
async function setScene(next,{restoreImported=true}={}){
 scene=deserializeVisualScene(next);viewer.setProfile(scene.quality);
 await viewer.setScene(scene);
 if(restoreImported&&scene.attachments?.length){
  for(const asset of scene.attachments){
   const bytes=b64ToBytes(asset.data.split(',')[1]);
   await viewer.importGlb(bytes);
  }
 }
 overlays();inspector();viewer.render();
 status('Настоящая 3D-сцена: '+scene.objects.length+' объектов. Профиль '+scene.quality.toUpperCase()+'.');
}
async function changeMode(name){
 if(!['analog-studio','spectrum-matrix'].includes(name))throw Error('Другие режимы пока не готовы');
 mode=name;$('mode').value=name;
 const {scene:newScene}=runVisualRecipe(recipeFor(name));
 await setScene(newScene,{restoreImported:false});
 renderFrame(lastFrame);
}
function renderFrame(frame){
 lastFrame=validateStereoFrame(frame);
 viewer.applyFrame(lastFrame);
 $('signalState').textContent=lastFrame.source==='demo'?'DEMO':lastFrame.source==='pcm'?'REAL PCM':'SILENCE';
 $('signalState').dataset.demo=lastFrame.source==='demo'?'yes':'no';
 $('readout').textContent=['left','right'].map(ch=>{
  const x=frame[ch];return ch.toUpperCase()+'  '+(x.rms*100).toFixed(0)+'%  •  '+
   [x.low,x.mid,x.high].map(v=>(v*100).toFixed(0)).join('/')+'';
 }).join('       ');
}
function silence(){
 renderFrame(zeroStereoFrame({timestampMs:performance.now(),playing:false}));
}
async function openAudio(file){
 stopAudio();demo=false;$('demo').checked=false;
 if(!file)throw Error('Не выбран файл');
 audioContext=audioContext||new (window.AudioContext||window.webkitAudioContext)();
 if(audioContext.state==='suspended')await audioContext.resume();
 const bytes=await file.arrayBuffer();
 buffer=await audioContext.decodeAudioData(bytes.slice(0));
 analyzer=new StereoPcmAnalyzer({sampleRate:buffer.sampleRate,fftSize:2048});
 pauseOffset=0;lastIndex=0;
 status('Декодирован настоящий PCM: '+file.name+' ('+buffer.numberOfChannels+' каналов).');
 await startAudio();
}
function stopSource(){
 if(source){try{source.stop();}catch{}source.disconnect();source=null;}
}
function stopAudio(){
 if(playing&&audioContext)pauseOffset=Math.max(0,audioContext.currentTime-audioStart);
 stopSource();playing=false;cancelAnimationFrame(raf);raf=0;
 analyzer?.reset();silence();
}
async function startAudio(){
 if(!buffer)throw Error('Сначала выберите музыкальный файл');
 if(audioContext.state==='suspended')await audioContext.resume();
 stopSource();
 source=audioContext.createBufferSource();source.buffer=buffer;
 source.connect(audioContext.destination);
 audioStart=audioContext.currentTime-pauseOffset;source.start(0,pauseOffset);
 playing=true;
 source.onended=()=>{if(playing&&audioContext.currentTime-audioStart>=buffer.duration-.03){
  stopAudio();pauseOffset=0;status('Аудиофайл завершился.');}};
 requestFrame();
}
function requestFrame(){
 if(raf)cancelAnimationFrame(raf);
 raf=requestAnimationFrame(tick);
}
function tick(){
 raf=0;
 if(demo){
  const time=performance.now()/1000,copy=zeroStereoFrame({timestampMs:time*1000,source:'demo',playing:true});
  for(const [ch,phase] of [['left',0],['right',1.7]]){
   copy[ch].low=.50+.43*Math.sin(time*2.8+phase);
   copy[ch].mid=.43+.37*Math.sin(time*3.9+phase+1);
   copy[ch].high=.31+.32*Math.sin(time*5.1+phase+2);
   copy[ch].rms=.4+.30*Math.sin(time*2+phase);
   copy[ch].peak=Math.max(copy[ch].rms,.66);
  }
  copy.bass=(copy.left.low+copy.right.low)/2;renderFrame(copy);
  requestFrame();return;
 }
 if(playing&&buffer&&analyzer){
  const elapsed=Math.max(0,audioContext.currentTime-audioStart);
  const end=Math.min(buffer.length,Math.floor(elapsed*buffer.sampleRate));
  const begin=Math.max(lastIndex,end-4096);
  if(end>begin){
   const left=buffer.getChannelData(0).subarray(begin,end);
   const right=buffer.getChannelData(Math.min(1,buffer.numberOfChannels-1)).subarray(begin,end);
   analyzer.feed(left,right,{timestampMs:elapsed*1000});lastIndex=end;
  }
  renderFrame(analyzer.measure({timestampMs:elapsed*1000,playing:true}));
  requestFrame();
 }
}
async function loadFileAsScene(file){
 const text=await file.text();
 const parsed=JSON.parse(text);
 if(parsed.schema==='mark.visual-recipe/2'){
  const result=runVisualRecipe(parsed);await setScene(result.scene);
 }else await setScene(deserializeVisualScene(parsed));
}
function installEvents(){
 $('mode').addEventListener('change',async e=>{try{await changeMode(e.target.value);}catch(err){status(err.message,true);}});
 $('quality').addEventListener('change',async e=>{
  try{scene.quality=e.target.value;validateVisualScene(scene);
   viewer.setProfile(scene.quality);await viewer.setScene(scene);renderFrame(lastFrame);
  }catch(err){status(err.message,true);}
 });
 $('demo').addEventListener('change',e=>{
  demo=e.target.checked;if(demo){stopAudio();demo=true;status('DEMO — синтетическая реакция, НЕ анализ музыки');requestFrame();}
  else{cancelAnimationFrame(raf);raf=0;silence();status('Демонстрация отключена.');}
 });
 $('audioFile').addEventListener('change',async e=>{
  try{await openAudio(e.target.files?.[0]);}
  catch(err){status('Не удалось декодировать: '+err.message,true);}
 });
 $('pause').addEventListener('click',async()=>{
  if(demo){$('demo').checked=false;demo=false;cancelAnimationFrame(raf);silence();return;}
  if(playing){stopAudio();status('Пауза: уровень и сигналы обнулены.');}
  else{try{await startAudio();}catch(err){status(err.message,true);}}
 });
 $('stop').addEventListener('click',()=>{stopAudio();pauseOffset=0;status('Остановлено.');});
 $('front').addEventListener('click',()=>viewer.setView('front'));
 $('threequarter').addEventListener('click',()=>viewer.setView('threequarter'));
 $('side').addEventListener('click',()=>viewer.setView('side'));
 $('objectSelect').addEventListener('change',fillObject);
 $('applyTransform').addEventListener('click',async()=>{
  try{
   const obj=scene.objects.find(o=>o.id===$('objectSelect').value);
   if(!obj)throw Error('Не выбран объект');
   const keys=['px','py','pz','rx','ry','rz','sx','sy','sz'],vals=keys.map(k=>Number($(k).value));
   if(vals.some(v=>!Number.isFinite(v)))throw Error('Некорректные координаты');
   obj.position=vals.slice(0,3);obj.rotation=vals.slice(3,6);obj.scale=vals.slice(6,9);
   obj.material=$('materialSelect').value;
   await setScene(scene);status('Трансформация и материал сохранены в редактируемую 3D-сцену.');
  }catch(err){status(err.message,true);}
 });
 $('saveScene').addEventListener('click',()=>{
  download(serializeVisualScene(scene),scene.id+'.markscene','application/json');
 });
 $('loadScene').addEventListener('change',async e=>{
  try{if(e.target.files?.[0])await loadFileAsScene(e.target.files[0]);}
  catch(err){status('Импорт проекта: '+err.message,true);}
  e.target.value='';
 });
 $('importGlb').addEventListener('change',async e=>{
  try{
   const file=e.target.files?.[0];if(!file)return;
   const bytes=new Uint8Array(await file.arrayBuffer());
   if(bytes.length>15000000)throw Error('GLB >15 MB: для смартфона используйте облегчённый файл');
   const loaded=await viewer.importGlb(bytes);
   scene.attachments=scene.attachments||[];
   scene.attachments.push({name:file.name,data:'data:model/gltf-binary;base64,'+bytesToBase64(bytes)});
   status('Импортировано реальных мешей: '+loaded.meshes+'. GLB включён в .markscene.');
  }catch(err){status('GLB: '+err.message,true);}
  e.target.value='';
 });
 $('exportGlb').addEventListener('click',async()=>{
  try{
   status('Формируется настоящий многомешевый GLB...');
   const bytes=await viewer.exportGlb();
   download(bytes,scene.id+'.glb','model/gltf-binary');
   status('Экспортировано '+bytes.length+' байт GLB. Геометрия физическая, не картинка.');
  }catch(err){status('Экспорт GLB: '+err.message,true);}
 });
 $('exportRecipe').addEventListener('click',()=>{
  download(JSON.stringify(recipeFor(mode),null,2)+'\n',mode+'-recipe.json');
 });
 window.addEventListener('resize',()=>viewer.resize());
 document.addEventListener('visibilitychange',()=>{if(document.hidden&&!playing&&!demo)viewer.render();});
}
async function start(){
 try{
  viewer=new VisualRenderer($('visualCanvas'),{profile:'normal'});
  installEvents();await changeMode(mode);
  silence();window.__MARK_VISUAL_READY__=true;
  window.MARK_VISUAL_API={
   loadRecipe:async x=>{const r=runVisualRecipe(x);await setScene(r.scene);return modelInfo();},
   loadScene:async x=>{await setScene(x);return modelInfo();},
   scene:()=>structuredClone(scene),
   modelInfo,renderFrame,zero:()=>silence(),
   view:x=>viewer.setView(x),setQuality:async x=>{scene.quality=x;await setScene(scene);},
   image:()=>viewer.canvas.toDataURL('image/png'),
   exportGlb:async()=>bytesToBase64(await viewer.exportGlb()),
   renderStats:()=>({objectCount:scene.objects.length,meshCount:[...viewer.nodes.values()].filter(x=>x.isMesh).length,
    ledCount:[...viewer.nodes.values()].filter(x=>x.userData.meta?.role==='led').length})
  };
 }catch(e){
  window.__MARK_VISUAL_ERROR__=e.message;status('Ошибка запуска 3D: '+e.message,true);console.error(e);
 }
}
start();
