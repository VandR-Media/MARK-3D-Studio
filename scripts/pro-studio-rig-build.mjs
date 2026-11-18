/**
 * Deterministic, fully offline, actual Three.js rig viewer. No CDN or image
 * of the character is placed in the WebGL canvas. Uses local npm/esbuild.
 */
import {build} from 'esbuild';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {buildRiggedFixture} from './pro-studio-glb-fixtures.mjs';

export async function buildRigViewer({outFile='dist/pro-studio/rig-viewer-offline.html'}={}){
 const fixture=buildRiggedFixture();
 const bundle=await build({
  entryPoints:['src/pro-studio/rig-viewer.js'],
  bundle:true,format:'iife',platform:'browser',target:'es2022',minify:true,
  write:false,legalComments:'none'
 });
 const js=bundle.outputFiles[0].text.replace(/<\/script/gi,'<\\/script');
 const html=`<!DOCTYPE html>
<html lang="ru"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>MARK Professional Studio — Animated Rig GLB Preview (experimental)</title>
<style>
:root{font-family:system-ui,-apple-system,sans-serif;color:#edf1fb;background:#0b101b}
*{box-sizing:border-box}body{margin:0}.wrap{max-width:1100px;margin:auto;padding:15px}
header{padding:12px 0 16px;display:flex;justify-content:space-between;flex-wrap:wrap;gap:12px}
header b{font-size:19px;letter-spacing:.04em}header span{font-size:12px;color:#93b8d5}
h2{font-size:15px;font-weight:600;margin:6px 0}
canvas{display:block;width:100%;height:min(62vh,600px);min-height:340px;border:1px solid #344055;border-radius:15px;touch-action:none;background:#121928}
section{display:flex;flex-wrap:wrap;align-items:center;gap:10px;margin:12px 0}
label{display:flex;gap:8px;align-items:center}
button,select,.file{background:#1e3145;color:#e8f6ff;border:1px solid #42647a;padding:10px 13px;border-radius:9px;font-size:14px;cursor:pointer}
button:hover,.file:hover{border-color:#80d4fa}
button:focus-visible,select:focus-visible,input:focus-visible{outline:2px solid #4ca5ef}
.file{display:inline-flex;gap:8px}
input[type=file]{max-width:220px}input[type=range]{flex:1;min-width:150px}
#message{padding:11px;border-radius:8px;background:#152336;color:#aee3fa;font-size:13px;line-height:1.5}
#message[data-error=yes]{background:#392026;color:#ffaeb7}
footer{font-size:12px;color:#97a8b9;line-height:1.65;padding:10px 0 20px}
.sub{font-size:12px;color:#93b8d5}.views button{padding:8px 10px}
@media(max-width:600px){canvas{height:48vh;min-height:270px}section{gap:8px}.file{width:100%}header b{font-size:17px}}
</style></head><body><main class="wrap">
<header><b>MARK <span>PROFESSIONAL STUDIO</span></b><span>Release 1 · REAL WebGL2 rig preview · experimental</span></header>
<canvas id="viewport" aria-label="Анимированный GLB с настоящими скинингом, морфами и Three.js рендерингом"></canvas>
<section><label class="file">Открыть другой GLB <input id="picker" type="file" accept=".glb,model/gltf-binary"></label>
<label>Клип <select id="clip" aria-label="Анимационный клип"></select></label>
<button id="play">▶ Play</button><button id="export">Экспорт анимированного GLB</button></section>
<section><label for="timeline">Таймлайн</label><input type="range" id="timeline" min="0" max="12000" step="10" value="0">
<output id="readout">0.00 s</output></section>
<section class="views" aria-label="Проверка ракурсов">
<button id="view-front">Спереди</button><button id="view-left">Слева</button>
<button id="view-right">Справа</button><button id="view-back">Сзади</button>
<button id="view-threequarter">¾</button><button id="view-top">Сверху</button></section>
<p id="message" role="status">Загрузка реального бинарного rigged GLB…</p>
<footer>Демонстрационный QUAD с 70 костями, 2 морфами и 3 анимациями — технический тест, не Neon Boy.
HTML полностью автономный, без внешних загрузок. Не редактирует вершины, веса или UV.
Проверки WebGL2/GLTFExporter и устройство Huawei должны подтверждаться отдельными отчётами.
Статический Visual Engine v2 и его запрет импорта анимированных GLB не изменены.</footer>
</main>
<script>window.MARK_EMBEDDED_RIG_BASE64=${JSON.stringify(Buffer.from(fixture.bytes).toString('base64'))};</script>
<script>${js}</script></body></html>`;
 const output=resolve(outFile);mkdirSync(resolve(outFile,'..'),{recursive:true});
 writeFileSync(output,html);
 return {output,bytes:Buffer.byteLength(html),fixtureSha256:fixture.sha256,bundleBytes:js.length};
}
if(process.argv[1]&&process.argv[1].endsWith('pro-studio-rig-build.mjs')){
 buildRigViewer().then(data=>console.log(JSON.stringify(data))).catch(e=>{
  console.error(e);process.exitCode=1;
 });
}
