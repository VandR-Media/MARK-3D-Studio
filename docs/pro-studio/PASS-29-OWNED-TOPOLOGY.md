# MARK 3D Studio — проход №29: самостоятельное хранилище Vertex / Edge / Face / Halfedge

**Feature ID:** `MESH-OWNED-TOPOLOGY-029` · P0 · первый ограниченный native topology-data slice. `partial` в матрице полноценного Blender-style Edit Mode. Статус конкретных реализованных команд `passed` допускается только после успешного CI на точном SHA последнего коммита.

## Основание и базовая версия

Открыты и непосредственно перечитаны `MARK_3D_STUDIO_FULL_BLENDER_REPLACEMENT_TZ(1).md` (1103 строки), особенно §§3.2–3.3 (независимое ядро/стабильные ID/порядок зависимостей), 4.1–4.2 (каноническая структура и ресурсы .markscene), 5.1–5.3 (MeshData и topology), 7.1 (UV), 17.2–17.3 (сохранность glTF), 19 (Bridge), 25 (тесты), 28 и 31–33 (этапы/гейты/отчёты). Также прочитаны `ИНСТРУКЦИИ-для-разработчика.txt`, §§2–4, 6–11. Базовая реализация: draft PR #38, `feature/pro-studio-pass28-group-normals`, SHA `da7d7f9178751206510c34001ef6929f1efc5df8`, GitHub Actions success №45005487842. Новая ветка `feature/pro-studio-pass29-topology-ownership`, без изменения `main`.

## Реальная реализация: четвёртый независимый бинарный ресурс

`src/pro-studio/owned-topology-binary.js` добавляет отдельный типизированный `mesh/owned-topology.bin`: magic `MARKTOP1`, version 1, `meshIndex`, `primitiveIndex`, числа вершин/рёбер/граней/полурёбер, полный SHA-256 исходного GLB. После 96-байтового header — компактные little-endian записи:

- **VertexData:** source attribute row, first outgoing halfedge, outgoing count (12 байт/vertex).
- **EdgeData:** упорядоченная пара исходных строк, одно/два инцидентных полуребра и двухбитная маска `seam | sharp` (20 байт/edge).
- **FaceData:** source face number и first halfedge (8 байт/face).
- **HalfedgeData:** origin/destination source vertex row, source face, next corner halfedge и противоположный twin или `0xffffffff` для boundary (20 байт/halfedge).

ID в SDK стабильны, опираются на полный исходный SHA-256, mesh/primitive и source row/face/corner: `mark-attr-<sha>-m0-p0-vN`, `mark-face-<sha>-m0-p0-source-face-N`, `mark-corner-...`, `mark-halfedge-<sha>-m0-p0-fN-kN` и `mark-topo-edge-<sha>-m0-p0-a<min>-b<max>`. Они **не** зависят от индексов новых glTF attribute rows после UV copy-on-write и не меняются при перемещении POSITION или пересчёте normal V2.

В начальном профиле принимаются только исходные indexed TRIANGLES: ≤512 граней, ≤32768 исходных атрибутных строк, ≤1536 рёбер. Обработка не сваривает совпавшие по пространственному положению вершины. Ребро определяется **двумя конкретными исходными индексами**. Два инцидентных полуребра допускаются лишь с обратной ориентацией; >2 грани на ребре или конфликт winding → fail-closed. Материалы, weights, morphs, UV и анимации остаются в прежнем независимом MeshData/source GLB.

### Реально редактируемая часть топологии

Поддержаны точные, авторизуемые SDK-команды:

- `meshdata.ownedTopologyBegin({meshId,primitiveIndex})` создаёт бинарный каталог с подтверждённой структурой из immutable source GLB, только после инициализации independent MeshData. Legacy topology edits должны отсутствовать.
- `meshdata.getOwnedTopology({meshId,primitiveIndex,full})` возвращает постоянные vertex/edge/face/halfedge ID, connected twins, boundary/interior и текущие метки с диагностиками.
- `meshdata.setOwnedEdgeFlag({meshId,primitiveIndex,edgeId,flag,enabled})` атомарно устанавливает или снимает `seam` / `sharp` конкретного проверенного исходного ребра. До 32 операций в журнале. Поддельный/stale edge ID, другое поле и повреждённая топология — отказ.

Это **первые изменяемые edge attributes** собственного topology datablock. Они намеренно **не изменяют** UV-координаты, не создают новые вершины и не применяют сглаживание автоматически: для UV unwrap / marked-edge normal rules потребуются отдельные команды следующих проходов. То есть MARK уже владеет исходной структурой и метками рёбер, но не стал универсальным topology-authoritative N-gon mesh engine.

### Native .markscene и честный GLB export

Формат `.markscene` по-прежнему ZIP/STORE, без внешних URL или выполнения загружаемых скриптов. В Reader допускаются **только строго упорядоченные** контейнеры из 2, 3 или 4 файлов:

1. `manifest.json`
2. `assets/source.glb` — неизменяемый источник, включая PBR PNG, skin, morph, clips
3. `mesh/editable-meshdata.bin` — уже существующий POSITION/UV/NORMAL V1/V2
4. `mesh/owned-topology.bin` — новый типизированный каталог.

Четвёртый файл не разрешён без третьего. Manifest/assetManifest/checksums содержит SHA-256 и точную длину каждого файла; Reader проверяет ZIP CRC, совпадение имени, полное содержимое ресурса, полный source SHA, canonical native operation log и **побайтовое равенство восстановленного файла** с оригинальным source + последовательностью edge edits. Никакой скрытой автореконструкции повреждённой топологии. Старые 2/3-ресурсные проекты открываются без принудительной миграции. Undo/Redo откатывают/повторяют реальный бинарный edgeFlags.

Метки экспортируются в `glTF.meshes[0].primitives[0].extras.MARK_topologyAnnotations` с исходным SHA, стабильными edge IDs и `seam/sharp`. Это **специальные MARK-метаданные**, а НЕ стандартное glTF-описание sharp/seam. Сторонний импортёр может их игнорировать: гарантированное редактируемое сохранение происходит в `.markscene`. **Исходные GLB BIN-байты и весь скелетный mesh/UV/morph остаются неизменными при установке флага**, что подтверждается отдельной проверкой SHA-256 BIN до и после. При столкновении с уже существующим `MARK_topologyAnnotations` экспорт отклоняется вместо перезаписи. Отдельная команда native может изменить метки, не меняя geometry; это задокументировано как supported metadata-only slice.

### GUI и воспроизводимая QA

В автономном редакторе есть русская панель «постоянная топология», просмотр текущих edge IDs/соседства, создание Topology-ресурса, выбор видимого ребра мышью (через явное `physical glTF row → source vertex ID` соответствие MeshData), ввод пары исходных вершин, установка/снятие Seam или Sharp и подтверждение изменения. Вся запись — через тот же проверенный AI Bridge, не через отдельный обманчивый UI-state.

`tests/pro-studio-pass29-owned-topology.test.mjs`: 6 unit/integration тестов настоящего source SHA бинарного каталога, face/edge/corner/halfedge ID, twin-ориентации на физически общем индексном ребре (5 unique edges, 1 interior, 4 boundary), 6 граничных рёбер split-UV шва, независимых флагов seam/sharp, native 4-resource SHA/CRC/replay, миграции старых 2/3 ресурсов, malformed flags, nonmanifold/winding rejection, настоящего GLB extras, 70 bone/2 morph/3 clips/PNG/PBR, Bridge Undo/Redo/native reopen.

`scripts/pro-studio-pass29-owned-topology-webgl-accept.mjs`: настоящий Chromium WebGL2 по skinned fixture, весь previous P28 3D/UV/POSITION/NORMAL сценарий, создание 4-го бинарного файла из UI, проверка vertex/face/edge/halfedge count и статусов, отдельные Seam+Sharp, изменение настоящих пикселей UI-инспектора, неизменность SHA glTF BIN, реальные native/export файлы, reopened SHA equality и Undo/Redo. GitHub Actions `.github/workflows/pro-studio-pass29-owned-topology.yml` запускает 6 новых тестов, 105 регрессий Pass9–28, 25 core/Bridge, Visual Engine v2 и оба браузерных сценария. Артефакты: реальный GLB, 4-resource .markscene, PNG до/после, JSON со source/build SHA, status и device label. **Принятие возможно только на последнем exact PR HEAD SHA с CI=success и проверенным загружаемым артефактом.**

## Ограничения, которые не скрывать

Нет физического topology edit (добавление/удаление vertices/edges/faces), N-gons/holes, loop-cut, production modifier stack, UV unwrap/packing, sharp-edge lighting или MikkTSpace tangent rebuild по отмеченным рёбрам; new EdgeData пока поддерживает метки, а не изменение связности. Границы — исходные index-pairs, пространственно разрезанный UV-шов без общих индексов **не сваривается**; это намеренно. Нет Android/Kotlin APK, hardware-test Huawei Pura 80 Ultra/EMUI15, художественной приёмки Neon Boy или полного покрытия Blender. Chromium SwiftShader = проверка браузерной реализации, НЕ устройство Huawei.

**Следующий №30:** первая отдельная topology-changing операция над исходным валидированным треугольным ребром, с сохранением source-backed face/edge/corner IDs, skin/morph/UV, детерминированной миграцией `MARKTOP1` и действительно обновляемыми glTF indices; после этого — loop-cuts, N-gons, выделения loops/rings и edge-aware normal/UV operations. Параллельно можно начать Kotlin Android shell/CI, но не заявлять APK без реальной сборки.

**DoD (профиль №29):** `MESH-OWNED-TOPOLOGY-029` · Priority P0 · Status partial→passed only if exact HEAD CI green · Input: skinned source GLB with full hash · Native: 4 resources, strict replay · QA: 6/6 new Node, all regressions, Chromium with screenshots and native/GLB binary hashes · Hardware Huawei not tested · Flutter/Android APK unavailable · Blender parity not achieved.
