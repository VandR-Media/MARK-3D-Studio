# MARK Professional Studio — проход №15: glTF face-corners vs геометрические вершины

**Исходные документы сверены перед проходом:** исходное ТЗ от 18 ноября 2026 года, §§0, 3.2–3.3, 4.1, 5.1–5.2, 17.2–17.3, 25.1–25.3, 28, 32–33; «ИНСТРУКЦИИ-для-разработчика.txt», §§2, 4, 6–7, 9–11. Основа — черновой PR #24, ветка `feature/pro-studio-pass14-region-overlay`. Изменения изолированы в `feature/pro-studio-pass15-corner-topology`; `main` не изменена.

## Новая модель (строго ограниченный аналитический профиль)

**Feature ID:** `MESH-CORNERS-015` · приоритет P0 · временный профиль `read-only exact-position candidates`.

- `src/pro-studio/mesh-corner-topology.js`: отдельный, тестируемый без браузера анализатор индексированной сетки glTF `TRIANGLES`.
- `attributeVertex` — индекс строки набора glTF attributes (POSITION / NORMAL / TEXCOORD_n / JOINTS / WEIGHTS), а не гарантированная уникальная геометрическая вершина. `cornerId` — позиция corner в индексированном triangle list; две грани имеют независимые углы.
- `geometricVertex` — **кандидат**, определяемый по **точному** совпадению XYZ Float32 POSITION, с детерминированным ID на время анализа. UV и normals остаются у отдельных glTF attribute rows.
- Geometric edge candidates строятся по паре кандидатов XYZ, с учётом инцидентных исходных corners. Анализируются разные index rows вдоль одного геометрического ребра, различающиеся `TEXCOORD_n` (UV seam), различающиеся NORMAL, несогласованная winding, non-manifold, duplicate geometric face и входные range errors.
- Это **не Weld**. Наличие одинаковых XYZ у разных поверхностей может обозначать наложенные оболочки или дубликаты: анализатор явно выставляет `positionJoinIsAuthoritative:false`, `editsAllowedFromThisMap:false`. Текущий Region Extrude продолжает работать по настоящим индексам, так что UV seam не склеивается и исходные данные не переписываются молча.
- GLB adapter `inspectGlbCornerTopology` строго читает `POSITION` Float32 VEC3, unsigned индексы и поддерживаемые `TEXCOORD_n`; integer normalized UV конвертируются только для чтения. Проверки границ GLB bufferViews/accessors; external/sparse/required extensions отвергаются.
- MARK AI Bridge поддерживает **новую read-only операцию** `mesh.getTopology({meshId, primitiveIndex})` для текущего GLB после записанных изменений. Возвращаются ограниченные образцы UV seams и повторяющихся POSITION rows (не полная огромная геометрия), счётчики и `topologyRevision`.
- В GUI Mesh Edit Mode видны исходное число glTF attribute rows, количество геометрических *кандидатов*, число UV-швов и предупреждение «автоматическая склейка отключена». Ошибка диагностики не прерывает редактирование других поддерживаемых мешей.

## Критерии проверки (pass/fail)

1. Специальный **настоящий GLB** содержит 6 attribute vertices, 4 exact-position candidates, 2 seam-duplicated corners и 1 геометрическое ребро с UV discontinuity. Два треугольника не имеют общей glTF indexed edge.
2. `mesh.getTopology` выдаёт 6 / 4 / 1, но не увеличивает revision и не меняет BIN.
3. `face.regionExtrude` на двух seam-split triangles предсказуемо отклоняется (`REGION_DISCONNECTED`) вместо опасной автоматической склейки.
4. На больших поддерживаемых и rigged fixtures применяются старые операции; undo/redo возвращает корректные результаты диагностики; source GLB, `.markscene` и экспорт сохраняют исходный byte hash без правок.
5. В реальном Chromium WebGL2 предпринята попытка Region Extrude через GUI, зафиксирована ошибка и отсутствующая операция в журнале; кадры canvas и экспортный GLB приложены к QA.
6. Visual Engine v2, P9–P14 unit/regression, предыдущий P14 browser test продолжают проходить без изменений.

**До получения CI результата:** статус `partial`. Только успешный CI на **точном последнем SHA** подтверждает проверки. CI proof — workflow `.github/workflows/pro-studio-pass15-corner.yml`, артефакт `mark-pass15-corner-seam-webgl`, JSON report with source and build SHA.

## Что НЕ реализовано

- Полноценная редактируемая half-edge MeshData/N-gons/holes с персистентными UUID, seam-aware weld и corner data transfer.
- Объединение UV-seam-separated triangles в одну редактируемую область с корректным распределением corner attributes.
- Автоматическое определение **истинной** идентичности геометрических вершин при совпадающих XYZ (без исходных топологических связей невозможно).
- Кросс-приписывание geometric IDs между mesh primitives, advanced materials, sparse/Draco compressed geometry, color/joints interpolation при seam merging.
- APK и проверка на настоящем Huawei; Chromium/SwiftShader — программный GPU, не железо пользователя.

## Следующий проход №16

Спроектировать **persisted stable logical vertex/edge IDs** и явный seam-safe связующий граф для редактируемых meshes, добавить конфликтно-безопасный выбор кандидатов при совпадающих оболочках, а затем сделать ограниченный Region Extrude через UV seams с правильным сохранением face-corner UV и данных костей/морфов. Операция сначала должна пройти topology/native/unit gate, затем WebGL2 QA. Слияние в `main` только с согласия владельца.

**Отчёт:** feature MESH-CORNERS-015, backend pure JS/Three.js preview, no Huawei device test; status in_progress до CI, решение fix/verify.
