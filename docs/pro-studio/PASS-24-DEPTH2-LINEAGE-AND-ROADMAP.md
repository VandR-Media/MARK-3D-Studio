# MARK 3D Studio — проход №24: второй уровень дочернего Edge Split

**Feature ID:** `MESH-DEPTH2-EDGE-LINEAGE-024` · P0 · ограниченный preview profile. Основание: `MARK_3D_STUDIO_FULL_BLENDER_REPLACEMENT_TZ(1).md`, §§0, 3–5, 7, 17, 19, 25, 27–28, 31–33; `ИНСТРУКЦИИ-для-разработчика.txt`, §§2–4, 6–11. База — черновой PR #33 `feature/pro-studio-pass23-child-edge-lineage`, GitHub Actions exact HEAD `e7bbf69d4546cc6b5b9bcff0b65829137439d1ee`: success. Ветка `feature/pro-studio-pass24-depth2-daughter-lineage`; `main` не менять и не сливать без согласия владельца.

## Реально реализованное ядро

После одобренной источником цепочки `face.regionExtrudeLinked → ≤16 vertex.moveLinkedCap → ≤8 face.pokeLinkedCap → ≤8 edge.splitPokedCap → edge.splitPokedCapChild` разрешён **один** завершающий `edge.splitPokedCapGrandchild` той же пары `sourceFace/sourceVertex` (глубина 2). Каждое поколение делит настоящее внутреннее ребро `canonical source cap corner → midpoint предыдущего поколения`. В бинарном kernel должны существовать ровно два противоположно ориентированных инцидентных cap triangles; разделение затрагивает их обоих, добавляет одну плотную глифовую attribute row и два новых индексных треугольника. Другие topology edits после глубины 2 запрещены.

Для реального тестового скелетного GLB после последовательных Poke/primary/daughter: **33→34 glTF attribute rows**, **20→22 triangles**. Старые атрибутные строки и immutable source GLB не модифицируются; два TEXCOORD set, NORMAL, POSITION morph deltas и JOINTS_0/WEIGHTS_0 интерполируются по фактическим концам ребра. Костные влияния агрегируются по joint ID и нормализуются **без обрезки**; при >4 активных костях, неподдерживаемых TANGENT, morph normals/tangents и других несовместимых профилях операция fail-closed. Сохраняются 70 bones, 2 morph targets, 3 animation clips, PBR PNG/materials.

## Идентичность и безопасные API

- `MeshData.grandchildRemap`: `generation:2`, `parentEdgeId`, `parentSplitNewLogicalVertexId`, `newLogicalVertexId` с полным SHA256 immutable source, source face/corner и depth; реальный `newAttributeVertex`, изменённые исходные face ID, две созданные child face ID, недействительные прежние corner/halfedge IDs, созданные edge ID и `ancestors`.
- `MeshData.descendantRemaps[]` — история поколений 1 и 2; `daughterRemap`, `edgeSplitRemaps[]`, `topologyRemaps[]` остаются обратносоответствующими прежним этапам. Старые физические glTF row indices **не** должны выдаваться за стабильные семантические ID.
- `mesh.splitPokedCapGrandchildEdge({meshId,primitiveIndex?,sourceFace,sourceVertex,parentEdgeId})`: MARK AI Bridge проверяет существующий в текущем snapshot именно тот parentEdgeId, который был создан предыдущим daughter split и лежит между исходным углом капа и дочерней серединой, с двумя корректными halfedges. Нельзя подделать ID, указать другое sourceFace/sourceVertex, выдать wall/seam/boundary за дочернее ребро или повторить команду.
- `.markscene` v3-preview: типизированная команда и строгий порядок/сопоставление с источником; save→close→reopen→GLB binary replay и Undo/Redo должны быть побитово воспроизводимы.
- UI: кнопка **«Разделить следующее дочернее ребро»** с user confirmation, write grant и реальной WebGL2 mouse-edge selection. Неверные числовые V1/V2 перекрываются проверенными индексами выбранного источникового ребра.

## Обязательный QA

```sh
npm install --no-audit --no-fund
node --test tests/pro-studio-pass24-depth2-daughter-lineage.test.mjs
node --test tests/pro-studio-pass23-child-edge-lineage.test.mjs
npm run test:visual-v2
npm run pro:rig:viewer
npx playwright install chromium
node scripts/pro-studio-pass23-child-edge-webgl-accept.mjs
node scripts/pro-studio-pass24-depth2-webgl-accept.mjs
```

Новые unit/integration tests сравнивают старые physical indices/attribute rows и половинки обеих прилегающих граней, неизменность UV0/UV1, JOINTS/WEIGHTS и morph, стабильные source-scoped IDs при обратном порядке независимых primary splits, 22 faces/66 corners/66 halfedges и ожидаемые 4 открытых boundary edges, а также native replay и отрицательные варианты. Chromium/SwiftShader подтверждает настоящее выделение мышью **ребра (7,32)**, GUI split и реальное выделение новой **грани №20** с различающимися пикселями PNG, после чего выполняется GLB/.markscene round-trip, rig/morph/animation и Undo/Redo. Тесты Pass9–23 и Visual Engine v2 должны остаться зелёными на **точном последнем SHA**. GitHub Actions прикладывает воспроизводимые PNG/GLB/.markscene/JSON/build SHA артефакты.

## Ограничения

Это контролируемое поколение **depth=2**, не произвольная рекурсивная topology editing, не общий halfedge kernel с N-gons/holes/Boolean/Bevel и не UV unwrap/texture paint. Не поддерживаются произвольное seam-crossing Edge Split, repeated depth3, изменение рига и weight paint. Нет реальной сборки Android APK, аппаратных испытаний на Huawei Pura 80 Ultra/EMUI 15 и независимой художественной приёмки Neon Boy. Не объявлять продукт полноценной заменой Blender. PR остаётся **draft** до разрешения владельца.

## Стратегический масштаб следующих этапов

Согласно разделам 27–28 и DoD §31 ТЗ необходимы отдельно: полноценный editable MeshData и scene core; UV unwrap/paint; modifiers/curves; rig creation/weight paint/IK; graph editor/NLA; sculpt/retopo/baking; shading/nodes, production render; physics/VFX; Desktop/Web/Mobile Huawei device matrix; эталонные сцены и художественные ревью.

**Примерная оценка разработчика, не число из ТЗ и не срок:** 80–150 проходов всего для умеренного полезного редактора с мобильной версией, 180–350 проходов для самостоятельной студии по выбранному классу анимированных персонажей, 500–1000+ проходов для широкого покрытия профессиональных Blender-процессов. Интервалы могут значительно измениться при более крупных вертикальных этапах, переиспользовании проверенных библиотек, смене архитектуры и ресурсах команды. Прогресс 24 небольших проходов на узких GLB/mesh сценариях **не означает 24% пути к Blender**. 

**Следующий проход №25:** после стабильного родословного профиля прекратить бесконечные микрошаги только на Edge Split; перейти к persistent editable MeshData core и практическому UV/модификаторному workflow, при этом сохранить регрессии №9–24. Отдельно проработать Android/Huawei Viewer & Editor и CI APK в соответствии с исходной персональной инструкцией.
