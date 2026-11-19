# MARK 3D Studio — проход №18: face-corner / half-edge MeshData и последовательное перемещение капа

**Предварительная сверка:** `MARK_3D_STUDIO_FULL_BLENDER_REPLACEMENT_TZ(1).md` §§3.2–3.3, 4.1, 5.1–5.2, 7.1, 17.2–17.3, 19, 25, 28, 33, и `ИНСТРУКЦИИ-для-разработчика.txt` §§2–4, 6–7, 10–11. Исходная ветка — `feature/pro-studio-pass17-seam-region-extrude`, черновой PR #27, CI previous SHA 820977a9e2df45038cb4ccfb4b939e0504cefcc6 success. Все изменения изолированы в `feature/pro-studio-pass18-halfedge-cap-move`. Основную ветку не переписывать и PR не сливать без владельца.

**Feature ID:** MESH-HALFEDGE-CAP-018; приоритет P0; статус `partial` до exact-SHA CI и независимых проверок Huawei/художника.

## Реализовано

1. `src/pro-studio/meshdata-halfedge-preview.js`: создаёт реальную **диагностическую** карту `faces / corners / halfedges / edges` из текущего экспортируемого GLB. Каждый corner хранит индивидуальные `POSITION`, `NORMAL`, `TEXCOORD_n`, `COLOR_n`, `JOINTS_n`, `WEIGHTS_n`, `morph` streams. Полурёбра имеют собственные `next / prev / twin` ID, грани — material slot и triangle corner IDs.
2. Стабильные ID имеют область действия `SHA-256 исходного GLB + mesh/primitive + логический element`. При первой подтверждённой `face.regionExtrudeLinked` только одобренные seam пары получают общие logical IDs; текстуры/skin/morph не «свариваются» по glTF индексам. Снимок реконструируется из **первичного исходника + типизированного native edit log**, не хранится отдельной неподконтрольной копией и не претендует на произвольную half-edge редактуру.
3. Команда AI Bridge `mesh.getMeshData({meshId,primitiveIndex,full})`: read-only, summary и bounded preview по умолчанию, полная карта только для ограниченных моделей (≤512 triangles). В диагностике сохраняются данные boundary edges, non-manifold, winding, UV discontinuities и число последовательных перемещений капа.
4. Новая **физическая** бинарная операция `vertex.moveLinkedCap`, доступна пользователю через `mesh.moveLinkedCap({meshId,capStableId,delta})`. Сначала проверяется подтверждённый source-bound stable ID, затем перемещаются все копии логической вершины верхнего капа **и соответствующие верхние боковые углы**. Базовая геометрия остаётся на месте; UV, skin, morph/animation и исходный GLB сохраняются.
5. Recomputed `POSITION` и `NORMAL` для изменённых капов и боковых стенок; коллапс/нулевые площади запрещены. Максимум **16 последовательных bounded cap-move** после одного seam-aware Region Extrude; другие topology-edit операции остаются заблокированы, поскольку у них ещё нет безопасного remap ID.
6. `.markscene` содержит типизированный источник `face.regionExtrudeLinked` и последующие `vertex.moveLinkedCap`; native save → reopen → GLB export и Undo/Redo детерминированы. В GUI кнопка «Сместить вершину нового капа (V1, ΔXYZ)».

## Стратегия QA и критерии

- `tests/pro-studio-pass18-halfedge-cap-move.test.mjs`: проверка 10 triangle / 30 corners / 30 halfedges, 4 ожидаемых открытых граничных ребра исходной геометрии; две независимые `TEXCOORD` группы; сходящиеся по положению логические вершины при разных UV; связанный cap/wall movement с реальными GLB vertex rows; сохранение 70 joints, 2 POSITION morph targets, 3 clips, PNG/PBR; stable ID после двух операций; negative inputs, native zip/replay, Bridge undo/redo.
- `scripts/pro-studio-pass18-cap-webgl-accept.mjs`: Chromium WebGL2 real user click → confirmation 2 seams → physical Region Extrude → второй реальный cap edit → before/after browser canvas PNG & pixel diff → `mesh.getMeshData(full:true)` → native replay → Undo/Redo. Source file SHA записан вместе с build SHA в JSON.
- `.github/workflows/pro-studio-pass18-halfedge.yml`: syntax validation, PASS18 unit, Pass9–17 mesh+rig regressions, Visual Engine v2, prev Pass17 browser and new Pass18 browser. Артефакт `mark-pass18-halfedge-cap-webgl`.

**Не объявлять PASSED**, пока job на последнем SHA не завершён success. Красные промежуточные запуски требуют анализа и исправления; только реальный успешный job подтверждает экспериментальный вертикальный срез.

## Известные ограничения

- Это **preview MeshData реконструкция**, а не полноценный persisted production half-edge backend, не N-gons, не holes, не generalized topology edit. Треугольники glTF, face-corner UV и logical seam IDs лишь связаны поверх исходного источника.
- `vertex.moveLinkedCap` меняет **позиции** и normals, не topology; до полноценной stable ID remap карты и manifold-проверок обычные `edge.split`, `face.extrude`, `delete` после linked extrusion запрещены.
- Обновление corner normals ограничено supported planar-ish profiles; на скрученных quads проверяется ненулевой нормальный вектор треугольников, но не допускается считать результат универсальным production manifold. Физические UV seams остаются разделёнными индексами для корректных texture corners.
- Нет автоматической склейки совпадающих оболочек; экстремальные и неоднозначные совпадающие вершины отклоняются. Performance budget: ≤8192 indexed triangles для диагностики / ≤512 для полной выдачи Bridge.
- Ни нативный Android APK, ни аппаратное тестирование на Huawei Pura 80 Ultra/EMUI 15, ни независимая художественная приёмка не выполнялись. Chromium/SwiftShader — **software GPU**, не Huawei.

## Следующий проход №19

После CI — поддержка дополнительных последовательных операций с гарантированной идентичностью после топологических изменений (контролируемые edge split / face extrude над созданным капом), явные persistent remap tables, производственные ограничения по corner normals/UV и тестирование сложных seam-островков. Отдельная ветка/PR и unit → native → real WebGL2 gate; без слияния в `main` до разрешения владельца.

**Решение:** в ходе разработки `fix / verify`; результат не является полной заменой Blender.
