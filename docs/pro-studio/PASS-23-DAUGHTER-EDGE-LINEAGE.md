# MARK 3D Studio — проход №23: первое дочернее Edge Split и родословная рёбер

**Feature ID:** `MESH-DAUGHTER-EDGE-LINEAGE-023` · P0 · ограниченный экспериментальный профиль · статус `verify`, пока точный финальный SHA не прошёл CI.

## Сверка с исходными документами

Перед проходом перечитаны реальные исходные файлы `MARK_3D_STUDIO_FULL_BLENDER_REPLACEMENT_TZ(1).md` (1103 строк), §§3.2–3.3, 4.1, 5.1–5.2, 7.1, 17.2–17.3, 19, 25, 28, 32–33, и `ИНСТРУКЦИИ-для-разработчика.txt` (235 строк), §§2–4, 6–11. Базовый PR #32 `feature/pro-studio-pass22-multi-radial-splits` прошёл GitHub Actions на SHA `cefff786c19edb3ea38d78e9832daf8dfc57ea0c`. Новый PR строится поверх Pass22; `main` не менять/не сливать без согласия владельца.

## Что реально сделано

1. `src/pro-studio/mesh-edit-core.js`: новый типизированный `edge.splitPokedCapChild` позволяет **один завершающий повторный разрез дочернего ребра** от исходной логической вершины капа до midpoint предыдущего `edge.splitPokedCap`. Операция требует уже подтверждённую цепочку `face.regionExtrudeLinked → (до 16 cap moves) → (до 8 Pokes разных source faces) → (до 8 primary radial splits разных Poke faces)`. Дочерний split выбирает уже созданную вершину midpoint; нельзя перепутать её с Poke center или предыдущими вершинами. Контролируемый источник `sourceFace/sourceVertex` подтверждает parent Poke и соответствующий primary split.
2. Ядро анализирует **два действительно инцидентных, противоположно ориентированных треугольника** дочернего ребра; запрещены boundary/seam/wall/несоответствующая topology и вырожденные child triangles. В корректном случае одна новая общая вершина добавляется в настоящее glTF BIN и создаются ещё два индексных треугольника; старые GLB атрибутные строки не изменяются. Для skinned seam fixture: **32 → 33 атрибутные вершины, 18 → 20 треугольников**; исходный source GLB immutable.
3. Для дочернего midpoint как и для primary Edge Split физически интерполируются `POSITION`, `NORMAL`, `TEXCOORD_0/1`, float vertex color streams и morph `POSITION` deltas; `JOINTS_0/WEIGHTS_0` объединяются строго по joint ID и нормализуются **без потери влияний**. При более 4 активных влияниях, неподдерживаемых tangent/morph-normal/skin profiles — отказ, без молчаливой порчи данных. Материалы, embedded PNG/PBR, 70 костей, 3 клипа анимации и 2 морфа остаются в источнике/GLB.
4. `src/pro-studio/meshdata-halfedge-preview.js`: `daughterRemap` фиксирует `parentEdgeId` (первичное cap→midpoint), `generation:1`, sourceFace/sourceVertex, новую ID `mark-radial-daughter-{SHA256}-...`, новую реальную attribute row, две созданные faces, новые child edges и `invalidatedCornerIds/invalidatedHalfedgeIds`. Первичный `edgeSplitRemaps[]` — **исторический журнал**, в нём сохраняется перечень созданных тогда рёбер, включая уже разделённое родительское ребро, а не ошибочная попытка выдать нынешние edges за прошлые. `topologyRemaps[]` предыдущих Poke сохраняются. Полные логические ID не зависят от порядка независимых primary splits, но glTF номера rows зависят от порядка операций и НЕ считаются стабильными ID.
5. AI Bridge `mesh.splitPokedCapChildEdge({meshId,primitiveIndex?,sourceFace,sourceVertex,parentEdgeId})`: реальная проверка актуального двухгранного `edgeId` по current MeshData, принадлежности подтверждённому первичному разрезу, точных исходных endpoints и запрет stale/forged ID. В нативном edit log хранятся канонические `sourceFace/sourceVertex`; строго одобренная parent lineage воспроизводится из immutable исходника и проверяемой последовательности. У поддельного `parentEdgeId` нет пути в бинарный kernel через Bridge.
6. GUI `Разделить дочернее ребро (V1,V2)` — открывает настоящий WebGL2 Edit Mode: пользователь может **выделить дочернее ребро мышью**, source face/vertex определяется по реальной геометрии и `edgeSplitRemaps` без доверия к отображаемым triangle index или неверно введённым V1/V2. При отсутствии выделения используется числовой fallback. Требуются write grant, user confirm, после edit удаляется устаревшее выделение. `.markscene` v3-preview сохраняет типизированную `edge.splitPokedCapChild` и гарантирует deterministic save/reopen/GLB replay, Undo/Redo.

## План QA, воспроизведение

```sh
npm install --no-audit --no-fund
node --test tests/pro-studio-pass23-child-edge-lineage.test.mjs
node --test tests/pro-studio-pass22-multi-radial-splits.test.mjs
npm run test:visual-v2
npm run pro:rig:viewer
npx playwright install chromium
node scripts/pro-studio-pass22-multi-radial-webgl-accept.mjs
node scripts/pro-studio-pass23-child-edge-webgl-accept.mjs
```

`tests/pro-studio-pass23-child-edge-lineage.test.mjs`: настоящие GLB triangles и shared midpoint, никакого T-junction, unchanged previously indexed/attribute rows, UV0+UV1, joints/weights, morph deltas, 70 bones/2 morphs/3 clips/PNG/PBR, MeshData 20 faces/60 corners/60 halfedges, нет unexpected non-manifold/conflicting winding, stable parent/daughter ID, old remaps preserved, forbidden duplicate/wrong source and unknown fields, native import/export и Undo/Redo.

`scripts/pro-studio-pass23-child-edge-webgl-accept.mjs`: настоящий Chromium WebGL2/SwiftShader (не изображение-заглушка): UI seam approval → Extrude → Move → два Poke → два primary Edge Split → user mouse click по действительному cap-to-midpoint ребру → **дочерний split** → выбор созданной физической face #18 → PNG pixel difference → GLB и `.markscene` exports → проверка 70/2/3 rig, binary replay и Undo/Redo. `.github/workflows/pro-studio-pass23-daughter-edge.yml` требует успешных Pass9–22 regression, Visual Engine v2 и обоих реальных WebGL2 сценариев; прикладывает source+build SHA, PNG, GLB, native project, JSON QA.

**Гейт:** только `success` GitHub Actions для **последнего commit SHA**, включая документацию, считается приёмкой узкого профиля. Эксперимент SwiftShader не доказывает работоспособность на аппаратном Huawei GPU.

## Явные ограничения

Это **первый ограниченный дочерний Edge Split** (один потомок primary radial edge, поколение 1), не произвольная рекурсия без лимита и не general-purpose Edge Split. Второй дочерний разрез, редактирование UV seam/boundary/walls, N-gons/holes, полная persistent native MeshData, Sculpt, Boolean/Bevel, Canvas-like всех Blender-функций остаются неподдерживаемыми. Этот процесс восстанавливает MeshData *из исходного GLB и одобренного edit log*, не объявляется production full Blender replacement.

Не выполнялись нативная Android APK сборка, тест реального Huawei Pura 80 Ultra/EMUI15, independent art-director acceptance. Важно не путать Chromium SwiftShader/WebGL2 с аппаратным устройством.

## Следующий проход №24

Поддержка **нескольких вложенных дочерних разрезов** в одной линии `parentEdgeId → childEdgeId` с явными уровнями глубины, полностью воспроизводимыми source-scoped IDs/halfedge remap, контроль UV-корректности и обратных атрибутов, аппаратный тестовый gate и дальнейшая миграция к постоянному редактируемому half-edge MeshData. Только после unit/native/real-WebGL2 CI и отдельной независимой оценки.
