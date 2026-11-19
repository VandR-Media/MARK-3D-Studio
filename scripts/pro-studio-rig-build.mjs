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
<section aria-label="Экспериментальный редактируемый проект">
<button id="project-save">Сохранить .markscene v3-preview</button>
<label class="file">Открыть .markscene
<input id="project-open" type="file" accept=".markscene,application/zip"></label>
<button id="project-export">Экспорт изменённого GLB</button></section>
<section aria-label="Минимальные редактируемые параметры">
<label>Положение X <input id="rig-x" type="range" min="-.7" max=".7" step=".02" value="0"></label>
<label>PBR шероховатость <input id="rig-rough" type="range" min=".05" max="1" step=".01" value=".6"></label></section>
<section aria-label="Экспериментальный локальный MARK AI Bridge">
<label><input type="checkbox" id="bridge-write-grant"> Разрешить локальные изменения через AI Bridge</label>
<button id="bridge-demo">Проверить AI Bridge: изменение → рендер → сохранение</button>
</section>
<p id="bridge-output" class="sub" role="status">AI Bridge работает только внутри этой страницы, без HTTP-сервера и доступа к сети.</p>
<section aria-label="Создание собственной модели с пустой сцены">
<label>Примитив <select id="primitive-shape">
<option value="box">Куб</option><option value="plane">Плоскость</option>
<option value="grid">Сетка</option><option value="uv-sphere">UV-сфера</option>
<option value="cylinder">Цилиндр</option>
</select></label>
<label>Размер <input type="number" id="primitive-size" min=".01" max="50" step=".1" value="1" style="max-width:75px"></label>
<label>Сегменты <input type="number" id="primitive-segments" min="3" max="48" step="1" value="12" style="max-width:65px"></label>
<button id="primitive-new">Новая сцена без Blender</button>
<button id="primitive-add">Добавить примитив в сцену</button>
</section>
<p id="primitive-output" class="sub" role="status">Примитивы создаются оригинальным ядром MARK: GLB POSITION/NORMAL/UV/indices, без внешних моделей. Для записи нужно разрешение AI Bridge.</p>
<section aria-label="Выделение элементов в настоящем 3D-окне">
<button id="mesh-pick-toggle" aria-pressed="false">Выделение в 3D: выключено</button>
<label>Тип выбора <select id="mesh-pick-mode">
<option value="vertex">Вершина</option><option value="edge">Ребро</option><option value="face">Треугольник</option>
</select></label>
<output id="mesh-selection" role="status">Нажмите «Открыть Edit Mode», затем включите выбор.</output>
</section>
<section aria-label="Mesh Edit Mode P8, экспериментальный">
<label>Меш <input id="mesh-id" type="number" min="0" max="500" value="0" style="max-width:65px"></label>
<label>Операция <select id="mesh-op" aria-label="Операция геометрии">
<option value="vertex.move">Переместить вершину</option>
<option value="vertex.snap">Привязать вершину к вершине</option>
<option value="edge.split">Разделить ребро</option>
<option value="face.flip">Перевернуть грань</option>
<option value="face.extrude">Выдавить треугольную грань</option>
<option value="face.delete">Удалить грань</option>
<option value="normal.recalculate">Пересчитать нормали</option>
</select></label>
<label>V1 / грань <input id="mesh-a" type="number" min="0" value="2" style="max-width:65px"></label>
<label>V2 <input id="mesh-b" type="number" min="0" value="1" style="max-width:65px"></label>
<label>ΔX <input id="mesh-dx" type="number" min="-1" max="1" step=".01" value="0" style="max-width:65px"></label>
<label>ΔY <input id="mesh-dy" type="number" min="-1" max="1" step=".01" value=".15" style="max-width:65px"></label>
<label>ΔZ <input id="mesh-dz" type="number" min="-1" max="1" step=".01" value="0" style="max-width:65px"></label>
<label>Extrude (м) <input id="mesh-extrude-distance" type="number" min=".001" max="50" step=".05" value=".25" style="max-width:75px"></label>
<button id="mesh-open">Открыть Edit Mode</button>
<button id="mesh-apply">Применить к геометрии</button>
<button id="mesh-undo">↶ Undo</button>
<button id="mesh-redo">↷ Redo</button>
<button id="mesh-save">Сохранить правки .markscene</button>
<button id="mesh-export">Экспорт геометрии GLB</button></section>
<p id="mesh-output" class="sub" role="status">Edit Mode: GLB POSITION/indices/morph/skin реально изменяются. Для записи включите флажок разрешения AI Bridge. Это экспериментальный профиль TRIANGLES.</p>
<section><label for="timeline">Таймлайн</label><input type="range" id="timeline" min="0" max="12000" step="10" value="0">
<output id="readout">0.00 s</output></section>
<section class="views" aria-label="Проверка ракурсов">
<button id="view-front">Спереди</button><button id="view-left">Слева</button>
<button id="view-right">Справа</button><button id="view-back">Сзади</button>
<button id="view-threequarter">¾</button><button id="view-top">Сверху</button></section>
<p id="message" role="status">Загрузка реального бинарного rigged GLB…</p>
<footer>Демонстрационный QUAD с 70 костями, 2 морфами и 3 анимациями — технический тест, не Neon Boy.
HTML полностью автономный, без внешних загрузок. Экспериментальный .markscene v3-preview
сохраняет исходный GLB отдельно от изменений TRS/PBR и выбранного клипа. Не редактирует вершины,
веса, кости, морф-геометрию или UV. Не является production .markscene v3. Mesh Edit Mode P7 поддерживает только
индексированные треугольники и четыре ограниченные операции; не поддерживает N-gons,
полный весовой скульпт. Реализованы начальный Raycaster выбор элемента в 3D и
пересчёт усреднённых area-weighted нормалей только для индексированных треугольников. AI Bridge здесь — in-process preview, без сетевого API. Новые плоскости, кубы,
сетки, UV-сферы и цилиндры создаются собственным процедурным ядром,
но полные N-gons, скульптинг и weight paint ещё не поддерживаются.
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
