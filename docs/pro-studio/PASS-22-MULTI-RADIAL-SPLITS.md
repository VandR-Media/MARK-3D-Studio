# MARK 3D Studio — проход №22: последовательные безопасные Edge Split и stable-ID remap

**Feature ID:** `MESH-MULTI-RADIAL-EDGE-022` · P0 · ограниченный experimental/preview profile · статус `partial` до exact-HEAD CI и отдельной художественной/Huawei приёмки.

## Основание, порядок и инварианты

Перед проходом повторно открыты пользовательские документы `MARK_3D_STUDIO_FULL_BLENDER_REPLACEMENT_TZ(1).md` (18.11.2026), §§0, 3.2–3.3, 4.1, 5.1–5.2, 7.1, 17, 19, 25, 28, 33, и `ИНСТРУКЦИИ-для-разработчика.txt`, §§2–4, 6–7, 10–11. Исходный PR #31 — draft `feature/pro-studio-pass21-radial-edge-split`, successful CI on `d293f16aa238ca2c1e43a3c351125b06d02e8937`. Рабочая ветка `feature/pro-studio-pass22-multi-radial-splits`; `main` и предыдущие PR не сливать.

## Реализация

- `src/pro-studio/mesh-edit-core.js`: после одного явно одобренного `face.regionExtrudeLinked`, до шестнадцати `vertex.moveLinkedCap` и до восьми `face.pokeLinkedCap` разных исходных cap faces разрешено **до восьми `edge.splitPokedCap` разных исходных Poke-граней**. Все split следуют ПОСЛЕ Poke; произвольные операции среди них запрещены. Каждая пара `sourceFace/sourceVertex` проверяется по immutable исходному GLB и фактическим двум противоположно направленным инцидентным треугольникам; вершина проходит `cap source row -> Poke center`. Повторение исходной Poke-грани запрещено. Ограничение на разные face IDs предотвращает нежелательные пересечения последовательно изменяемых рёбер.
- При каждом split создаются **одна фактическая glTF attribute-row и две новые indexed TRIANGLES**. Ключевой инвариант: новые строки предыдущих Poke и Split никогда не переупорядочиваются; индекс центра каждой Poke-грани определяется с учётом числа уже применённых Split. В тестовом skinned seam profile: **30 → 31 → 32 вершин, 14 → 16 → 18 треугольников**. Никаких автоматических weld через разные `TEXCOORD_n`, внутренних seam walls или T-junction на разделяемом ребре.
- Поддерживаемые потоки `POSITION`, `NORMAL`, `TEXCOORD_0/1`, float color и `POSITION morph` интерполируются для обоих углов ребра, а `JOINTS_0/WEIGHTS_0` объединяются строго по ID кости с нормализацией. Если понадобится более 4 ненулевых влияний или атрибут вне supported profile, операция отклоняется **без усечения или повреждения проекта**. Скелет/анимация/материалы/PNG/PBR и байты immutable source GLB не переписываются.
- `src/pro-studio/meshdata-halfedge-preview.js`: `edgeSplitRemaps[]` отражает **каждый** разрез в порядке журнала: sourceFace, sourceVertex, реальный `newAttributeVertex`, детерминированный `newLogicalVertexId`, `sourceEdgeId`, сохранённые IDs двух изменённых граней, IDs двух новых дочерних граней, недействительные corner/halfedge IDs, созданные реальные logical edge IDs. Совместимое поле `edgeSplitRemap` продолжает отображать последний split. Источник идентичности — **полный SHA-256 исходного GLB + mesh/primitive + исходная face и corner**, а не порядковый индекс новых row или click order. Список `topologyRemaps[]` предыдущих Poke сохраняется без изменений.
- `src/pro-studio/ai-bridge-core.js`: `mesh.splitPokedCapEdge({meshId,primitiveIndex?,sourceFace,sourceVertex,edgeId})` требует пользовательский grant и сравнивает переданное логическое ребро с **актуальной** реконструированной MeshData; обязателен двухгранный корректно ориентированный edge между source cap corner и Poke center. Нельзя подделать edgeId или повторно разделить уже обработанную исходную грань. `mesh.getMeshData` возвращает все `edgeSplitRemaps[]`, а не только последний.
- `src/pro-studio/rig-viewer.js` / `scripts/pro-studio-rig-build.mjs`: кнопка Edge Split вызывает именно эту Bridge-команду. Можно выбрать **реальное** radial ребро в 3D-окне (режим «ребро» + мышь) — соответствующие source face/corner вычисляются по текущей MeshData, а не из ненадёжного номера отображаемой грани. При отсутствии выделения остаётся числовой режим V1 (исходная грань Poke) / V2 (исходная вершина). Перед действием есть диалог подтверждения; после commit stale выбор сбрасывается.
- `src/pro-studio/markscene-v3-preview.js`: исходный GLB и типизированные команды сохраняются внутри native ZIP; порядок и уникальность source face IDs валидируются при save/open/replay. Undo/Redo возвращают соответствующие бинарные glTF attributes и индексы, а не только GUI-подсветку.

## Автоматическая проверка и доказательства

`tests/pro-studio-pass22-multi-radial-splits.test.mjs`: два настоящих Split на независимых sourceFaces 0 и 1, оба UV set, 70-joint skin, 2 morph targets и 3 animation clips, embedded PNG/PBR; точные интервалы row/triangle и неразрушенные старые attributes; два инцидентных faces в каждом разрезе, `nonManifoldEdges=0`, `degenerateTriangles=0`, `conflictingWindingEdges=0`; `MeshData` 18 faces/54 corners/54 halfedges, 4 ожидаемых открытых boundary edges; независимые от порядка операций source-scoped логические IDs, сохранённые и недействительные IDs; отрицательные тесты поддельного edge/source IDs, повторного разреза, неверного порядка; .markscene save/reopen, AI Bridge и Undo/Redo.

`scripts/pro-studio-pass22-multi-radial-webgl-accept.mjs`: реальный Chromium WebGL2 (не искусственный рендер): UI link UV seam → Region Extrude → cap Move → два Poke → первый radial split → **второй radial split** → реальное выделение вновь созданного физического треугольника **face #16** в canvas. PNG до/после выделения сравниваются по пикселям; проверяются `edgeSplitRemaps[]`, GLB и native ZIP, rig/morph/animation, Undo/Redo. `.github/workflows/pro-studio-pass22-multi-radial.yml` дополнительно запускает все Pass9–21 regressions и Visual Engine v2, сохраняет PNG/GLB/.markscene/JSON evidence с exact Git SHA.

Команды воспроизведения:

```sh
npm install --no-audit --no-fund
node --test tests/pro-studio-pass22-multi-radial-splits.test.mjs
node --test tests/pro-studio-pass21-radial-edge-split.test.mjs
npm run test:visual-v2
npm run pro:rig:viewer
npx playwright install chromium
node scripts/pro-studio-pass21-radial-edge-webgl-accept.mjs
node scripts/pro-studio-pass22-multi-radial-webgl-accept.mjs
```

**CI gate:** статус `passed` только для фактического успешного GitHub Actions на **последнем commit SHA**, с attached screenshot/GLB/native evidence. Старые успешные CI не подтверждают новый SHA. SwiftShader/Chromium нельзя приравнивать к реальному GPU Huawei.

## Ограничения

- Пока делятся **разные радиальные рёбра разных исходных Poke-граней**, а не дочернее ребро, созданное предыдущим Split на той же грани. Самопересекающиеся или нечетырёхкомпонентные skin-профили отклоняются. Общее безопасное seam-crossing Edge Split, N-gons/holes, Boolean, Bevel и повторная топологическая операция над дочерними рёбрами не реализованы.
- `MeshData` — восстанавливаемая read-only структура над бинарным GLB + native typed operation log, а не постоянный производственный half-edge backend. Смещение центра Poke после Split пока не разрешено.
- **APK Android ещё не собран**, аппаратное тестирование Huawei Pura 80 Ultra / EMUI15 и независимая арт-директорская приёмка не проводились. Проект нельзя объявлять полноценной заменой Blender.

## Следующий проход №23

Сделать безопасный **последовательный дочерний Edge Split** в рамках одной Poke-грани с явным `parentEdgeId` и `remap lineage`, визуальным выбором реальных дочерних рёбер, строгой проверкой manifold/UV/skin/morph, native migration и отдельной аппаратной веткой Android/Huawei после стабилизации базового MeshData.

**Решение:** `fix/verify` до final CI; PR draft; основную ветку не сливать без разрешения владельца.
