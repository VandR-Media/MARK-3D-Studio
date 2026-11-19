# MARK Professional Studio — проход №8: 3D Picking, normal repair, procedural primitives

**Основание:** исходное ТЗ `MARK_3D_STUDIO_FULL_BLENDER_REPLACEMENT_TZ.md` от 18.11.2026, §3.3 (native invariants), §4 (сцена), §5.1–5.2 (Mesh Edit Mode), §11.1 (viewport), §19 (AI Bridge), §25 (проверки), §28 и §32 (этапы). Инструкция разработчика `ИНСТРУКЦИИ-для-разработчика.txt` перепроверена.

**Статус:** partial / experimental, техническое ядро ограниченного Edit Mode и первый самостоятельный старт из пустой сцены. **НЕ** Blender replacement, **НЕ** production `.markscene` v3 и **НЕ** APK/Huawei hardware QA.

**Рабочая ветка:** `develop/pro-studio-release0-audit`, [DRAFT PR #16](https://github.com/VandR-Media/MARK-3D-Studio/pull/16), base `develop/visual-engine-v2`. `main`, DRAFT PR #13 и Visual Engine v2 не затронуты.

## 1. Контракт P8: настоящая viewport selection

`src/pro-studio/viewport-picking.js` использует Three.js `Raycaster` на **настоящем отображаемом меше** с `GLTFLoader` association, а не заранее заданную координату фиктивной картинки.

- Режимы `vertex` и `face`: пользователь включает выбор, касается WebGL-канваса, получает `gltf-mesh-N`, `primitiveIndex`, реальный `vertex` / `face`, индексы треугольника.
- Учитываются текущее состояние skinned mesh и morph target (через `getVertexPosition`), а также текущая камера/3D-проекция.
- Выделенная вершина отмечается цветной сферой, грань контуром из `LineLoop`; подсветка пересчитывается при анимации.
- Нажатие вне объекта снимает выделение. При неоднозначном соответствии имени и glTF-узла выбор блокируется, вместо ошибочного редактирования другой детали.
- В GUI: кнопка «Выделение в 3D», выбор «Вершина/Треугольник», статус с ID, поля ID редактирования обновляются из фактического лучевого попадания.

**Непокрытый GUI:** пока нет multiple selection / box select / connected loops, GPU ID-buffer picking, выбор отдельных рёбер, удобные гизмо и snapping. Выбор программно правильного индекса не приравнивается к полноценному Blender Edit Mode.

## 2. Действительный пересчёт нормалей и topology diagnostics

В `src/pro-studio/mesh-edit-core.js` добавлена typed operation `normal.recalculate`. Она:
- Собирает area-weighted normals по реальным **индексированным треугольникам** с учётом winding.
- Нормализует суммы для вершин, создаёт новый glTF `NORMAL` accessor и дописывает float32 bytes в BIN; старый источник и неиспользуемые ресурсы не мутируются.
- Удаляет устаревшие `TANGENT` ссылки, если tangent space после правки уже не был пересчитан (честнее, чем выдавать его за корректный).
- Сохраняется в `edits.meshOperations` собственного `.markscene` v3-preview вместе с face.flip/delete, vertex.move и edge.split.

`mesh.getStats` теперь сообщает `boundaryEdges`, `nonManifoldEdges`, `conflictingWindingEdges`, `duplicateFaces`, `degenerateTriangles` и `unusedVertexCount`. Эти значения — **сигналы текущего треугольного профиля**, не комплексный proof watertight/manifold для N-gons или раздельных UV seam вершин.

## 3. Создание с нуля без Blender

`src/pro-studio/primitive-geometry.js` самостоятельно создаёт вершины, нормали, UV и треугольные индексы для пяти форм:

| Форма | Реализованный профиль |
|---|---|
| Plane | 2 triangles / 4 vertices, UV, normals |
| Grid | параметрический квадратный grid, bounded segments |
| Box | 6 отдельных UV-граней, 24 вершины / 12 треугольников |
| UV Sphere | меридианы и параллели, triangle winding и UV проверяются |
| Cylinder | стенки и две крышки с независимыми нормалями и UV |

Ограничения: размер 0.01–50 м, segments 3–48, <10k вершин в одном procedural primitive. Форма без внешних файлов/скриптов/Blender; материал PBR (металличность и шероховатость). Это **оригинальные тестовые примитивы MARK**, не набор готовых профессиональных моделей и не художественный персонаж.

`src/pro-studio/primitive-factory.js` создаёт glTF с **нулём исходных nodes и meshes**, затем `primitive.add` через **тот же Mesh Edit kernel** выпускает настоящий бинарный GLB. Browser WebGL2 viewer теперь принимает и отображает статический GLB без кожи и анимаций, не ломая скелетный playback.

В AI Bridge:
- `scene.new({shape:"box",size:1.6,segments:12})` — новая самостоятельная native-сцена с исходным примитивом.
- `mesh.create({shape:"uv-sphere",size:.7,segments:10})` — новая glTF mesh datablock/node в текущей сцене, объект не накладывается по умолчанию точно на предыдущий.
- `mesh.edit({meshId:"gltf-mesh-1",operation:{kind:"normal.recalculate"}})` — после создания можно редактировать реальные normals.
- `scene.getHierarchy` — возвращает **текущее** дерево с добавленными через operation log объектами, а не только первоначальный source manifest.
- `scene.save` и `scene.export` работают в том же версионированном `.markscene` и GLB pipeline.

**Ограничение модели:** полноценное создание «пустой сцены» пока через команду `scene.new` сразу добавляет выбранный первый примитив. Нет GUI scene collection inspector и неограниченной ассоциативной scene graph v3. GLB исходного примитива сохраняется как ресурс; добавленные объекты сохраняются в `meshOperations` и воспроизводятся на экспорте. Undo history остаётся только в памяти, но replayed edit log сохраняется в native.

## 4. Реальные проверки, а не концептуальные изображения

```bash
npm install --no-audit --no-fund
node --test tests/pro-studio-mesh-edit.test.mjs
node --test tests/pro-studio-primitives.test.mjs
node --test tests/pro-studio-ai-bridge.test.mjs
npm run pro:rig:viewer
npx playwright install chromium
npm run pro:rig:accept
```

Обязательные CI-проверки:
1. Действительные Playwright pointer.click на SkinnedMesh, ближайшая вершина и triangle face; `RIG-MESH-PICK-VERTEX-024`/`FACE-025`.
2. `face.flip→normal.recalculate→scene.save→scene.export`: нормали переписаны в BIN, исходный GLB SHA сохраняется; `RIG-MESH-NORMAL-NATIVE-026`.
3. `scene.new` впервые рендерит PBR-куб с **0 bones, 0 clips**: `RIG-PRIMITIVE-EMPTY-SCENE-027`.
4. `mesh.create` добавляет UV-сферу в ту же scene graph; реальный WebGL2-кадр отличается от одиночного куба: `RIG-PRIMITIVE-ADD-028`.
5. `normal.recalculate` для нового примитива и `.markscene` reopen: исходный GLB содержит 1 mesh, экспорт 2 meshes, native source hash прежний: `RIG-PRIMITIVE-NATIVE-029`.
6. Unit `tests/pro-studio-primitives.test.mjs` проверяет 5 shape topology/UV/normal winding, actual GLB from empty, PBR, API transactions & undo/redo, повреждённые параметры.
7. Старый v2 robot/scene и три анимации рига остаются mandatory и должны быть зелёными.

Реальные файлы: `acceptance/pass8-real-raycast-face-selection.png`, `pass8-real-normal-recalculation.png`, `pass8-box-from-empty-real-webgl.png`, `pass8-box-plus-sphere-real-webgl.png`; `acceptance/pass8-picked-normals.markscene/glb`, `pass8-box-sphere-editable.markscene`, `pass8-box-sphere-edited.glb` и `acceptance/browser-report.json`.

**Не объявлять этот проход завершённым без зелёного CI на финальном SHA** с самими файлами доказательств. В Chromium software-backend SwiftShader это реальные WebGL2 кадры, но не hardware Huawei.

## 5. Недостающие требования и следующий проход

- Нет N-gons / holes / extrude / bevel / boolean / subdivision / curves / sculpt и weight-paint. Нет корректного corner-normal split/sharp edges для общей topology, только area-weighted smooth vertex normals.
- Нет достаточной структуры собственных vertex/edge/face UUID, box select, gizmo, snapping, multi-select, modifier stack.
- Нет нормального пользовательского текстурного рисования, UV unwrap, редактирования rig bone/weights и музыкального NLA.
- `.markscene` остаётся `3-preview`, не production v3; нет crash-safe atomic save, autosave/recovery, full v2 migration.
- Нет художественно готовой модели Neon Boy 70 bones/3 authored dance/facial morph; 70-bone QUAD и flat-panel engineering rig не подменяют художественный DoD.
- Нет физического Huawei Pura 80 Ultra QA и APK. Нет production HTTP/WebSocket AI Bridge с scoped access controls.

**Следующий проход №9:** полноценная интерактивная vertex/edge/face selection + gizmos (включая edge picking), primitive object transforms/collection inspector, нормализация corner normals/UV seams и первая безопасная операция extrude + undo/native save. Потом расширять mesh data, UV, bones and content.

**Без разрешения не сливать в main и не закрывать draft PR.**
