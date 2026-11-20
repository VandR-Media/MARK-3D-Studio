# MARK 3D Studio — проход №21: безопасный радиальный Edge Split после Poke

**Проверка перед проходом:** `MARK_3D_STUDIO_FULL_BLENDER_REPLACEMENT_TZ(1).md` (18.11.2026) — §§0, 3.2–3.3, 4.1, 5.1–5.2, 7, 17, 25, 28, 33; `ИНСТРУКЦИИ-для-разработчика.txt` — §§2–4, 6–7, 10–11. Исходная ветка `feature/pro-studio-pass20-multi-poke-remap`, PR #30, успешный CI для коммита `256a8fbb96ddc48a984c19ceeafbfc785f77c8c0`. Текущая ветка `feature/pro-studio-pass21-radial-edge-split`. Не менять `main` и не сливать черновой PR без разрешения владельца.

**Feature ID:** `MESH-RADIAL-EDGE-SPLIT-021` · P0 · ограниченный experimental glTF editing profile · статус `partial`.

## Реализованное редактирование

- После одного явно подтверждённого `face.regionExtrudeLinked`, до шестнадцати `vertex.moveLinkedCap` и до восьми `face.pokeLinkedCap` различных исходных граней разрешена **ровно одна завершающая** операция `edge.splitPokedCap`.
- Операция выбирает **внутреннее радиальное ребро** созданной Poke-грани: одну конечную точку представляет старый source cap corner, другую — ранее созданный центр той же Poke-грани. Используются не совпавшие по XYZ случайные точки и не номер видимого пикселя, а исходная пара `sourceFace/sourceVertex` после проверки актуального source SHA, mesh/primitive и действительного логического `edgeId`.
- На настоящем бинарном GLB ядро находит **ровно два** инцидентных треугольника и убеждается в противоположном направлении общего ребра. В оба треугольника вставляется **одна общая новая вершина**; два новых треугольника дописываются после существующих, не сдвигая прежние индексные и атрибутные строки. Шов UV, в который входит другая часть капа, не сваривается. Следующие операции над топологией пока запрещены.
- Атрибуты `POSITION`, `NORMAL`, `TEXCOORD_n`, float32 color streams, `POSITION` morph deltas интерполируются для середины ребра без изменения предыдущих рядов. `JOINTS_0/WEIGHTS_0` смешиваются по joint ID, суммируются и нормализуются: если получится больше четырёх ненулевых костных влияний, операция **отказывается**, не отсекая малые веса. `TANGENT`, morph normals/tangents, несколько sets bone weights и нормализованные целочисленные UV вне supported profile.
- `mesh.getMeshData` теперь возвращает `edgeSplitRemap` с ID удалённого ребра, двух изменённых исходных граней, двух созданных child faces, центральной вершины разреза, недействительных corner/halfedge IDs и новых edge IDs. Все ID привязаны к полному SHA-256 immutable source GLB, mesh/primitive и `sourceFace/sourceVertex`. `topologyRemaps` предыдущих Poke сохраняется в исходном порядке.
- Новая AI Bridge команда `mesh.splitPokedCapEdge({meshId,primitiveIndex?,sourceFace,sourceVertex,edgeId})` проверяет текущий edge graph: именно запрошенное ребро должно быть двухгранным, иметь корректные источниковые концы и не нарушать skin/morph constraints. GUI: «Edge Split: ребро капа (V1,V2)»; V1 — исходный индекс грани с Poke, V2 — исходный индекс угла этой грани; выбор идёт по `MeshData`, есть предупреждение перед применением и очистка старого viewport pick.
- Типизированный `edge.splitPokedCap` сохраняется в `.markscene` v3-preview как конечный элемент edit log, проверяется при повторном открытии; исходный GLB остаётся исходным, итоговый экспорт детерминирован. Undo/Redo проходит через общую Bridge/native командную шину.

## Автоматическая проверка

```sh
npm install --no-audit --no-fund
node --test tests/pro-studio-pass21-radial-edge-split.test.mjs
node --test tests/pro-studio-pass20-multi-poke-remap.test.mjs
npm run test:visual-v2
npm run pro:rig:viewer
npx playwright install chromium
node scripts/pro-studio-pass20-multi-poke-webgl-accept.mjs
node scripts/pro-studio-pass21-radial-edge-webgl-accept.mjs
```

Для source-skinned seam fixture с 70 костями, 2 POSITION morphs, 3 animation clips и двумя UV sets: после двух Poke 30 атрибутных вершин и 14 indexed triangles; после Edge Split — **31 вершина, 16 треугольников**, одна общая серединная вершина внутри двух новых треугольников, остальные атрибуты неизменны. `MeshData` ожидает 48 face corners и halfedges, 4 логических boundary edges, отсутствие non-manifold/winding conflicts. Negative tests проверяют отсутствующий Poke, forged source/edge ID, повторное деление, неправильную последовательность, tampered schema, unsupported bone influences. Native ZIP save/reopen и Undo/Redo должны совпадать по binary SHA.

`.github/workflows/pro-studio-pass21-radial-edge.yml` выполняет новую Node-матрицу и Pass9–20 regression + Visual Engine v2, затем **настоящий Chromium WebGL2/SwiftShader**. В браузере пользователь делает два Poke, нажимает Edge Split, наводит мышь на вновь созданную **грань №14** (корректный индекс после роста 14→16 triangles), выбирает её реальным кликом, затем проверяются пиксели полученного PNG, `.markscene`, GLB, rig/morph и Undo/Redo. Загружаются реальные файлы PNG/GLB/markscene/JSON как `mark-pass21-radial-edge-webgl`.

**Приёмка по ТЗ §25.3:** только **CI success на точном последнем commit SHA** доказывает ограниченный срез. Оценка на реальном Huawei Pura 80 Ultra/EMUI15 не проводилась. Компьютерный WebGL2/SwiftShader нельзя выдавать за Huawei GPU.

## Ограничения и следующий проход №22

Это намеренно **один терминальный split внутреннего радиального ребра после Poke**, а не общий Seam-aware Edge Split любой линии капа. Разрез через UV seam, внешнюю границу или боковую стенку пока запрещён. Другие topology edits после него также блокируются, пока нет общего неизменяемого ID журнала для произвольных операций. `MeshData` пока reconstructable snapshot из source GLB + native operation log, не production persisted half-edge/N-gon/holes. Полноценные Sculpt/Boolean/Bevel, автоматический UV remap, Edge Loop/Ring и unlimited incremental edits отсутствуют. Нельзя заявлять, что MARK уже заменяет Blender.

**Следующий проход №22:** инкрементальная стабильная топология **для нескольких Edge Split** и безопасный remap дочерних рёбер; отдельная подсветка новых logical halfedges и выбор из GUI вместо source-индексов V1/V2; Unit/GLB/native/Chromium QA, затем отдельный Android/Huawei target и APK.
