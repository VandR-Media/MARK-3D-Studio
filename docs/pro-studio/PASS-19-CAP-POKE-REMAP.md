# MARK 3D Studio — проход №19: контролируемый Poke капа и переназначение идентификаторов

**Техническое основание:** исходное ТЗ `MARK_3D_STUDIO_FULL_BLENDER_REPLACEMENT_TZ(1).md`, перед проходом перечитаны §§3.2–3.3, 4.1, 5.1–5.2, 7.1, 17.2–17.3, 19, 25, 28, 33; персональная инструкция разработчика §§2, 4, 6–7, 10–11. База: черновой PR #28 / ветка `feature/pro-studio-pass18-halfedge-cap-move`, подтверждённый GitHub Actions SHA `0b466dce96c932597ba53918a783fa9fb34fcef3` (success). Новая ветка `feature/pro-studio-pass19-cap-poke-remap`, `main` не затрагивается.

**Feature ID:** `MESH-CAP-POKE-REMAP-019` · P0 · ограниченный preview profile.

## Реально реализовано

- **Бинарная операция `face.pokeLinkedCap`:** после одобренного seam-aware `face.regionExtrudeLinked` и до 16 `vertex.moveLinkedCap` можно разделить одну **верхнюю грань выбранного капа** на три треугольника при помощи внутреннего centroid. Настоящий glTF accessor POSITION получает одну новую вершину, индексный массив — два новых треугольника, исходные верхние UV-углы и боковые стенки остаются нетронутыми. Для типового rig-seam fixture — 28 → 29 attribute rows, 10 → 12 triangles. Никаких новых внутренних боковых стен на UV seam.
- Уникальные данные **TEXCOORD_0 / TEXCOORD_1**, а также все поддерживаемые dense float32 corner streams интерполируются в новом vertex. У skin centroid JOINTS_0/WEIGHTS_0 повторные bone influences суммируются и нормализуются без усечения: если число ненулевых костей превышает 4, операция **отказывается** вместо тихой порчи skin. POSITION morph targets интерполируются по тем же source triangle corners; glTF skins, animation clips, materials, textures и исходные BIN данные не меняются.
- Только **строго разрешённая последовательность:** один исходно-одобренный `face.regionExtrudeLinked` → максимум шестнадцать `vertex.moveLinkedCap` → **один завершающий** `face.pokeLinkedCap`. Никакого `face.pokeLinkedCap` без предыдущего одобренного Extrude, без face provenance, с дубликатами/неизвестными полями, повторного Poke или последующих обычных mesh operations.
- `MeshData` дополнен `topologyRemap`. Сохраняются face ID первичного дочернего треугольника и его действительно уцелевшие corner/halfedge IDs; идентификаторы удалённых corners/halfedges **явно объявляются недействительными**, а новая центральная вершина и две новые грани получают deterministic source-SHA/source-face-scoped IDs. Другие source face, wall and cap IDs не меняются. Снимок `MeshData` пересобирается из сохранённого GLB и immutable native command log.
- Новая авторизованная **MARK AI Bridge** команда `mesh.pokeLinkedCap({meshId,primitiveIndex?,capFaceId})`: ID проверяется по **реальному текущему** `mesh.getMeshData`; нельзя выбрать устаревший source face или forged stable ID. Тот же бинарный kernel используется для GUI, headless, сохранения, Undo/Redo и экспорта.
- В GUI кнопка «Poke: разделить грань капа (V1)» с явным подтверждением. Значение V1 — **номер исходной** selected face, проверенный против `sourceFaceIDs`, а не нестабильный текущий triangle array offset. После успешной операции selection/picker сбрасываются.
- `.markscene` v3-preview сохраняет typed operation `face.pokeLinkedCap` и верифицирует её при загрузке. Source GLB не меняется, exported edited GLB детерминирован и проходит round-trip.

## QA / матрица

`tests/pro-studio-pass19-cap-poke-remap.test.mjs`: двоичные индексы, centroid XYZ + UV0/UV1, normalized JOINTS_0/WEIGHTS_0, POSITION morph targets, 70-joint/3-clip rig, embedded PNG/PBR, MeshData 12 faces/36 corners/36 halfedges, 4 boundary edges, отсутствие non-manifold, реальные preserved/invalidated/new IDs, undo/redo, reimport source-native, forged IDs/unknown fields/invalid sequence. Все проверки могут выполняться в Node без браузера.

`scripts/pro-studio-pass19-poke-webgl-accept.mjs`: настоящий Chromium WebGL2/SwiftShader, реальный GUI link→extrude→move→poke; source-scoped MeshData и браузерный raycast на **новом face index 10**, настоящий canvas PNG с выделением новой грани; неизменность скелета/морфов, исходного source SHA, GLB/.markscene save/reopen/Undo/Redo. Обычный Poke на плоской поверхности может не менять внешний силуэт; визуальным доказательством новой топологии служит выбор и контур **нового физического** треугольника, подкреплённый сравнением BIN indices, а не нарисованный mockup.

`.github/workflows/pro-studio-pass19-poke.yml`: syntax, Pass19 Node unit, Pass9–18 regression, Visual Engine v2, build standalone, Chromium P18 regression и Pass19 browser acceptance, source-matched PNG/GLB/markscene/JSON artifact `mark-pass19-cap-poke-remap-webgl`.

**Gate:** `CI success` на **последнем SHA**; в документации не отмечать green, пока проверка фактически не завершилась.

## Ограничения

Это один controlled Poke после ограниченных каповых Move, а не общий редактируемый half-edge backend, не полноценные N-gons/holes/Boolean/Bevel/Knife. Новая центральная вершина пока не поддерживает последующее перемещение или повторный Poke. Стабильные ID поддержаны только для описанного профиля; ранее изменённые угол/полурёбра **не** должны выдавать старые ID за прежние. Несколько примитивов, сложные texture/normals/morph semantics, >4 centroid skin influences и внешние/sparse accessors требуют отдельного профиля.

Ограничения Huawei: компьютерный Chromium/SwiftShader не заменяет тест на реальном Pura 80 Ultra, аппаратное тестирование и Android APK отсутствуют. Художественная приёмка Neon Boy не проводилась. Даже успех CI не означает, что MARK стал полной заменой Blender.

## Следующий проход №20

Постоянный `MeshData` с изменяемой лицевой топологией, stable ID remap после **нескольких** controlled Poke/Edge Split, безопасная реиндексация face corners с несколькими UV sets, seam-aware GPU picking новых halfedges, box/lasso selection и локальные миграции native scene. После Node/native tests — real WebGL2 QA, затем отдельные Huawei hardware и Android release задачи. PR остаётся draft без merge до прямого разрешения владельца.
