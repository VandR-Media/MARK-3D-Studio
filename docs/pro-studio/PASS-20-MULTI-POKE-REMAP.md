# MARK Professional Studio — проход №20: несколько последовательных Poke с source-scoped remap ID

**Feature ID:** `MESH-MULTI-POKE-020` · P0 · экспериментальный ограниченный профиль · решение `verify` до успешного exact-HEAD CI.

## Исходные требования и границы

Перед началом прохода повторно прочитаны файлы `MARK_3D_STUDIO_FULL_BLENDER_REPLACEMENT_TZ(1).md` (18.11.2026), §§0, 3.2–3.3, 4.1, 5.1–5.2, 7.1, 17.2–17.3, 19, 25, 28, 33, и `ИНСТРУКЦИИ-для-разработчика.txt`, §§2–4, 6–7, 10–11. Базовый PR #29 и его CI на финальном SHA `387a65b8dc5ae178e928f64a75b8371f8cf38897` — success. Работа изолирована в новой ветке `feature/pro-studio-pass20-multi-poke-remap`; `main` не меняется, PR должен остаться draft.

ТЗ требует полноценную MeshData с N-gons, holes и persistable UUID, однако данный проход доказывает только **узкий корректный поднабор** — несколько Poke различных первичных cap faces после подтверждённого seam-aware Extrude. Это не production half-edge ядро.

## Реализация

- `src/pro-studio/mesh-edit-core.js`: допускается один подтверждённый `face.regionExtrudeLinked`, далее **до 16** `vertex.moveLinkedCap`, затем **до 8** `face.pokeLinkedCap` различных исходных cap faces. Поддерживаемые Poke всегда **после** всех Move; нельзя смешивать их с другими topology edits. Вся последовательность проходит через один реальный бинарный GLB kernel. Повторное разделение той же исходной грани отклоняется и не попадает в native edit log. Каждая операция добавляет один Float32 centroid с индивидуальными `TEXCOORD_0/1`, нормализованными `JOINTS_0/WEIGHTS_0` (без потерь; >4 influences — reject) и `POSITION` morph deltas; сохраняются исходные vertex rows, скелет, клипы, материалы и textures.
- `src/pro-studio/markscene-v3-preview.js`: строгая канонизация **порядка** и уникальности source face IDs для списка Poke. При `.markscene` save/reopen тот же source GLB и журнал команд дают идентичный экспортируемый GLB; запрещены неизвестные поля и попытки исполнения неутверждённых действий.
- `src/pro-studio/meshdata-halfedge-preview.js`: `topologyRemaps` хранит remap **для каждого** последовательного Poke в порядке применения, включая `sourceFace`, `originalFaceId`, `centerAttributeVertex`, `centerLogicalVertexId`, новые child face IDs, уцелевшие и недействительные corner/halfedge IDs. Поле `topologyRemap` остаётся **совместимым** представлением последней операции Poke. ID привязаны к полному SHA-256 исходного GLB, mesh/primitive и исходному face, не зависят от **порядка** Poke разных faces. При этом индексы новых glTF attribute rows могут различаться при изменении порядка и **не считаются стабильными ID**.
- `src/pro-studio/ai-bridge-core.js`: `mesh.pokeLinkedCap` проверяет настоящий актуальный стабильный ID исходной cap face, а после каждого Poke разрешает следующую операцию только на **другой** исходной cap face. Отклоняются stale/forged ID и повтор того же sourceFace. `mesh.getMeshData` возвращает полную `topologyRemaps`.
- В GUI кнопка Poke использует sourceFace из текущего подтверждённого Extrude; теперь текст подтверждения сообщает о возможности до 8 Poke разных исходных faces. Старые операции и стандартный `mesh.edit` не открывают обход ограничений.

## Проверяемые сценарии

```sh
npm install --no-audit --no-fund
node --test tests/pro-studio-pass20-multi-poke-remap.test.mjs
node --test tests/pro-studio-pass19-cap-poke-remap.test.mjs tests/pro-studio-pass18-halfedge-cap-move.test.mjs
npm run test:visual-v2
npm run pro:rig:viewer
npx playwright install chromium
node scripts/pro-studio-pass19-poke-webgl-accept.mjs
node scripts/pro-studio-pass20-multi-poke-webgl-accept.mjs
```

`tests/pro-studio-pass20-multi-poke-remap.test.mjs` проверяет: rigged GLB с двумя UV sets и 70 bones, 2 POSITION morphs и 3 clips; физическое увеличение 28→29→30 glTF attribute rows и 10→12→14 indexed triangles; неизменность ранее созданных POSITION/NORMAL/UV/skin/morph rows; корректность centroid и сумм весов; stable IDs первой операции после второй; отсутствие non-manifold и winding conflicts, 4 граничных ребра; независимость логических IDs от порядка Poke; запрет duplicate, stale, invalid order и unknown fields; `.markscene` source hash, round-trip, undo/redo и повторное открытие через AI Bridge.

`scripts/pro-studio-pass20-multi-poke-webgl-accept.mjs` использует **настоящий** Chromium WebGL2: вход в Edit Mode, пользовательское подтверждение UV-швов, реальный Extrude, cap Move, первый и второй GUI Poke. Для **нового** face index 12 выполняется browser raycaster с настоящим кликом мышью, PNG с оверлеем сравнивается с настоящим canvas без выделения. Затем — экспортный GLB и .markscene, сохранность рига и Undo/Redo. `.github/workflows/pro-studio-pass20-multi-poke.yml` запускает Unit Pass20, регрессии Pass9–19/Visual Engine v2, оба WebGL2 сценария, прикладывает JSON/build SHA/source SHA и PNG/GLB/.markscene.

**CI и QA:** только success GitHub Actions для **точного финального commit SHA** удостоверяет этот ограниченный срез. Browser SwiftShader не является испытанием настоящего Huawei.

## Известные ограничения и следующий проход №21

- Это **несколько Poke разных исходных cap faces**, но **не** рекурсивный Poke вновь созданных child faces, не Edge Split, Loop Cut, general face triangulation или N-gons/holes.
- Свободный последующий Mesh Edit и Move **после** начала Poke запрещён. Максимум восемь Poke, максимум шестнадцать предыдущих cap Move; данные ограничения — fail-closed, а не производственные бюджеты целевого ТЗ.
- Полная persistent editable `MeshData` и cross-editable halfedge UUID пока отсутствуют; это детерминированная реконструкция из source GLB + verified native operations. Динамические integer/normalized UV, TANGENT, NORMAL morphs, sparse/required extensions по-прежнему unsupported для бинарной операции.
- Нет Android APK, Huawei Pura 80 Ultra / EMUI15 physical QA и независимой арт-директорской приёмки. Проект **не объявляется заменой Blender**.

**Проход №21:** безопасный Edge Split на конкретном logical-cap edge с правильным split of all incident triangles, source/corner UV interpolation, Morph/skin propagation, ID migration и отдельным real WebGL2/GLB тестом; затем шаги к полноценному MeshData и отдельному Android/Huawei target.

Формат инженерного отчёта: Feature ID `MESH-MULTI-POKE-020`; backend JS/glTF/Three.js WebGL2; status `in_progress` до CI; native/source lossless within declared support profile; PR draft only, без merge в `main`.
