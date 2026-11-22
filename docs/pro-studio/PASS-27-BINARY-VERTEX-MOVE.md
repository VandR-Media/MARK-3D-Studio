# MARK 3D Studio — проход №27: редактирование POSITION в независимом бинарном MeshData

**Feature ID:** `MESH-POSITION-SEAM-LINK-027` · приоритет P0 · только ограниченный профиль skinned/UV GLB · статус `verify` до GitHub Actions success на точном HEAD.

## Основание

Перед реализацией повторно перечитаны **точные** файлы пользователя `MARK_3D_STUDIO_FULL_BLENDER_REPLACEMENT_TZ(1).md` (1103 строк), §§0, 3.2–3.3, 4.1, 5.1–5.2, 7.1, 17.2–17.3, 19, 25, 28, 31–33, и `ИНСТРУКЦИИ-для-разработчика.txt` (235 строк), §§2–4, 6–11. Готовая база: черновой PR #36 `feature/pro-studio-pass26-binary-editable-meshdata`, зелёный CI `44961581247` на `1f30f2432b9258fcce45a8216154d59eef4579e9`. Текущая ветка `feature/pro-studio-pass27-binary-vertex-move` создана поверх неё. `main` не менять и не сливать без разрешения владельца.

## Бинарная реализация

- `src/pro-studio/editable-meshdata-binary.js`: в существующем **независимом** бинарном ресурсе `mesh/editable-meshdata.bin` (`MARKMDB1`) действительно редактируется Float32 `POSITION` выбранной исходной атрибутной вершины. Формат ресурса не ломается; исходные Uint32 `indices` и UV0/UV1 **по углам** не меняются. Идентичность вершины — строгий `mark-attr-<полный SHA256>-m<mesh>-p<primitive>-v<original-row>`, а не физический номер glTF-копии после UV COW.
- Новая типизированная операция `meshdata.moveVertex` несёт точные поля `{kind,meshIndex,primitiveIndex,vertexId,scope,delta:[dx,dy,dz]}`. `scope=attribute` допускается только для исходного ряда, не составляющего split-UV seam. `scope=verified-seam` двигает **обе (или все подтверждённые)** исходные атрибутные строки, являющиеся концами обратно ориентированных геометрических рёбер на UV-шве. При этом требуется идентичность source POSITION, JOINTS/WEIGHTS и POSITION morph deltas. Нет silent weld по одной лишь позиции; непохожие skin/morph-профили, поддельные IDs, изменение более 2 единиц на ось, нулевой сдвиг, NaN, схлопывание или инверсия треугольника → fail-closed.
- `renderEditableMeshDataGlb` переносит изменённые позиции в **реальный бинарный accessor POSITION** конечного skinned glTF. Если UV0/UV1 уже правились copy-on-write, все новые видимые glTF атрибутные строки получают позиции соответствующих исходных вершин; ранее созданные UV-углы и другие vertex attributes остаются прежними. Сохраняются оба UV set, normales, JOINTS_0/WEIGHTS_0, морфы, 70-joint skeleton, три animation clips, PNG/PBR, source GLB и исходные skinning bindings. Accessor min/max пересчитывается; изменение общего POSITION accessor нескольких независимых primitives запрещено до реализации ownership.
- `MeshData.vertices[]` показывает реальные изменяемые исходные позиции и стабильные IDs. `MeshData.attributeRowProvenance[]` связывает **видимый glTF row** после копирования UV-угла с реальным source-scoped vertex ID: например, `visible row 6 → source row 0`. Это предотвращает недоступность вершин в WebGL2 после UV COW и ошибочное редактирование только визуальной копии.
- Редактирование не меняет логические face/corner/halfedge IDs и source triangle indices. Нет произвольного перемещения весов/морфов или нового N-gon/holes.

## Сохранение и UI/API

- `.markscene` продолжает содержать исходный GLB, типизированный edit log **и отдельный бинарный MeshData** с SHA-256, ZIP CRC, длиной и exact-byte replay проверкой. Канонический native формат допускает `meshdata.moveVertex` в смеси с `meshdata.translateUv` (до 16 команд). Старые двухфайловые и Pass26 трёхфайловые проекты открываются без принудительной миграции.
- `meshdata.moveVertex({meshId,primitiveIndex,vertexId,scope,delta})` подключён к тому же разрешаемому пользователем AI Bridge, что и GUI; перед commit производятся истинное бинарное изменение и glTF экспорт. Undo/Redo меняют/восстанавливают *бинарные POSITION*, а не только подсветку.
- В UI появилась секция **«MeshData · перемещение исходных вершин»** с ΔX/ΔY/ΔZ, выбором `verified-seam` / `attribute` и подтверждением. Можно указать исходную строку V1 или **выделить реальную видимую glTF вершину мышью**, включая её UV copy-on-write потомка. Source ID восстанавливается по явной карте `attributeRowProvenance[]`.

## QA gate

```sh
npm install --no-audit --no-fund
node --test tests/pro-studio-pass27-binary-vertex-move.test.mjs
node --test tests/pro-studio-pass26-binary-meshdata.test.mjs
npm run test:visual-v2
npm run pro:rig:viewer
npx playwright install chromium
node scripts/pro-studio-pass26-meshdata-webgl-accept.mjs
node scripts/pro-studio-pass27-vertex-webgl-accept.mjs
```

`tests/pro-studio-pass27-binary-vertex-move.test.mjs` проверяет настоящий glTF BIN, исходные и скопированные POSITION строки после UV COW, сохранение остальных атрибутов, стабильность semantic face/corner/vertex IDs, перемещение пары source seam-вершин с сохранением двух разных UV, отклонение опасного single-row move, схлопывающего triangle move, поддельных полей/ID, байтовый .markscene round-trip, CLI/Bridge и Undo/Redo.

`scripts/pro-studio-pass27-vertex-webgl-accept.mjs` в настоящем Chromium WebGL2/SwiftShader выбирает mouse raycast **физически видимую копию UV-вершины**, восстанавливает original source row, выполняет физический POSITION move, проверяет разные пиксели до/после, затем безопасно перемещает пару seam-вершин, сохраняет skinned GLB, 3-resource .markscene, rig/morph/clips, проверяет GLB hash и Undo/Redo. `.github/workflows/pro-studio-pass27-vertex-move.yml` добавляет регрессии Pass9–26, Visual Engine v2 и Chrome Pass26+Pass27, архив PNG/GLB/.markscene/JSON/source/build SHA. CI принимается **только на exact HEAD** с успехом всех jobs и загружаемым артефактом.

## Известные ограничения

Профиль по-прежнему **source TRIANGLES, максимум 512 faces, 32768 source rows, ≤16 mixed UV/POSITION commands**. Сохранённый MeshData пока не является полноценным editable topology-authoritative N-gon/holes/loop-cut backend, не содержит независимые skin/morph authoring streams, не делает UV unwrap, weight paint, rig editing, sculpt, Boolean или модификаторы. Verified-seam scope не означает полную поддержку любых seam/adjacency/rig случаев; эквивалентность skin/morph и структура исходного ребра проверяются, неподдерживаемые сочетания отклоняются. COW glTF row offsets **не являются** source vertex IDs.

**Отдельно не выполнено:** Kotlin Android APK, реальные тесты на Huawei Pura 80 Ultra / EMUI15, утверждение Neon Boy художником и full Blender replacement. Chromium SwiftShader не равен аппаратному GPU Huawei. PR должен остаться **draft**, main не изменять.

**Далее — Pass28:** отделить идентичность независимого VertexData от glTF rows для полноценного владения атрибутами, добавить редактирование групп вершин и нормалей (safe normal recompute) и начать контролируемую миграцию corner/edge/face топологии в авторитетный binary MeshData. Затем сделать отдельный мобильный CI pipeline для APK и Huawei verification, не подменяя устройство браузером.
