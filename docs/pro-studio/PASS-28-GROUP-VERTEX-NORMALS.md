# MARK 3D Studio — проход №28: атомарная группа вершин и бинарные нормали V2

**Feature ID:** `MESH-GROUP-NORMAL-028` · P0 · статус `partial` до точного commit-SHA CI success.

## Источник требований

Перед разработкой повторно открыты исходные документы пользователя `MARK_3D_STUDIO_FULL_BLENDER_REPLACEMENT_TZ(1).md` (1103 строки), §§0,3.2–3.3,4.1,5.1–5.2,7,17,19,25,28,31–33, и `ИНСТРУКЦИИ-для-разработчика.txt`, §§2–4,6–11. Оба файла были изучены **не по предыдущему резюме**. Последний проверенный проход №27: draft PR #37, exact SHA `4bd3d7714bdfe1e0532ce25c5db3560ea73ee8a9`, GitHub Actions run `44966316213` SUCCESS. Feature branch `feature/pro-studio-pass28-group-normals` основана на №27, `main` не изменяется.

## Что реально реализовано

### Атомарное перемещение группы

`meshdata.moveVertexGroup` — одна каноническая операция с полями `{kind,meshIndex,primitiveIndex,vertexIds,scope,delta}`. Допускаются 2–8 **различных, упорядоченных по исходным source-индексам** UUID вида `mark-attr-<полный source SHA256>-m0-p0-vN`, scope `attribute|verified-seam` и конечное ненулевое ΔXYZ на каждую ось ±2. Список **не** превращается в последовательность старых single-vertex операций: ядро сначала строит полную группу с доказанными разделёнными UV-швами и затем проверяет итоговую геометрию. Это предотвращает ложный отказ из-за промежуточной инверсии треугольника при общей трансляции и предотвращает нежелательное частичное применение изменений.

Правило безопасности: одиночная сторона явно выявленного UV-шва не перемещается. При `verified-seam` автоматически включаются связанные source attribute rows, но только если совпадают исходные позиции и текущие позиции, JOINTS/WEIGHTS и morph POSITION deltas. Синтетические «совпадающие по XYZ» вершины без проверенной структуры обратно ориентированных рёбер не склеиваются. При `attribute` группа должна сама охватывать все исходные ряды такого шва. Не допускаются foldover, degenerate faces, несуществующие source ID, NaN/Infinity, смешение со старыми topology commands или операция после завершающего пересчёта нормалей.

Все затронутые Float32 POS ряда обновляются прямо в `MARKMDB1`. Физический GLB `POSITION` обновляется как для исходных строк, так и для созданных ранее UV COW-копий через `attributeRowProvenance`. Не изменяются исходные indices, per-corner UV0/UV1, JOINTS_0/WEIGHTS_0, morph POSITION, анимации, PBR и исходный исходный GLB.

### Версионированный бинарный слой нормалей

Добавлена строго ограниченная команда `meshdata.recalculateNormals` с `{kind,meshIndex,primitiveIndex,mode:'area-weighted'}`. Это **явный** пересчёт нормалей по площади инцидентных ориентированных треугольников. Швы остаются раздельными по исходным индексам: автоматического сваривания или пересчёта через разные source attribute rows нет. Исходные `NORMAL` не меняются **до** выбора команды. Требуется плотный Float32 NORMAL VEC3; precomputed TANGENT и morph NORMAL/TANGENT — fail-closed, чтобы не выпускать повреждённый PBR/морф профиль.

`MARKMDB1` сохраняет прежнюю сигнатуру и поле исходного SHA256, а версия 2 добавляет в конце отдельный Float32 VEC3 normal layer для каждого исходного атрибутного ряда. Версия 1 из проходов №26–27 остаётся **полностью читаемой**, конвертация в версию 2 только по явной команде. В binary reader проверяются точный размер, отсутствие лишних байт, конечность и длина вектора нормали (unit length с малым допуском). Экспорт патчит настоящий accessor `NORMAL` в glTF BIN, включая все UV COW-копии source rows, с readback-проверкой каждого физического Float32 значения. Общий NORMAL accessor нескольких независимых primitives или неподдерживаемый normal profile не редактируется без дополнительного владения.

Нормали пересчитываются **терминально**: после сохранения normal layer V2 дальнейшие UV/вершинные операции запрещены до Undo. Это предотвращает несогласованность освещения с изменяемой геометрией. Повторная команда пересчёта также запрещена.

### AI Bridge, GUI и редактируемая сцена

`meshdata.moveVertexGroup({meshId,primitiveIndex,vertexIds,scope,delta})` и `meshdata.recalculateNormals({meshId,primitiveIndex,mode})` — две официальные команды того же user-granted in-process Bridge, что используется кнопками в GUI. Каждая команда валидируется в ядре и **реально экспортируется в GLB до commit**. Не принимаются неизвестные поля, ID, неупорядоченные группы и неподдерживаемые типы; ошибки структурированы. Русская панель позволяет вводить группу source IDs, добавить реально выделенную мышью WebGL2 вершину (через `attributeRowProvenance`), сдвинуть всю группу и отдельно пересчитать нормали. Undo/Redo работают по тому же журналу `meshDataOperations`.

Нативный `.markscene` продолжает быть строгим ZIP/STORE из manifest, immutable source GLB и отдельного `mesh/editable-meshdata.bin`. Manifest хранит SHA-256 бинарного слоя и исходника, нормализованный log и checksum. При открытии файл не доверяется: **должен побайтово совпасть с пересозданным MeshData V1/V2 после последовательного применения канонических команд**. Изменение данных без изменения журнала ведёт к отказу. Проекты Pass26/27 со старым V1 и двухфайловые проекты без MeshData остаются читаемыми.

## QA

```sh
npm install --no-audit --no-fund
node --test tests/pro-studio-pass28-group-normals.test.mjs
node --test tests/pro-studio-pass27-binary-vertex-move.test.mjs
npm run test:visual-v2
npm run pro:rig:viewer
npx playwright install chromium
node scripts/pro-studio-pass27-vertex-webgl-accept.mjs
node scripts/pro-studio-pass28-group-normals-webgl-accept.mjs
```

Новый Node suite проверяет атомарный сдвиг трёх физически затронутых source rows от двух выбранных, восстановление по стабильным IDs после UV COW, отсутствие изменений независимых UV/PBR/skin/morph, версию NORMAL V2, физический readback NORMAL glTF, fail-closed на поддельные/неупорядоченные/дублированные IDs и NaN, запрет неканонической последовательности после NORMAL, native ZIP SHA/CRC/replay и Bridge save/reopen/Undo/Redo.

Chromium WebGL2/SwiftShader: старый сценарий №27 полностью воспроизводит реальное выделение вершины мышью, потом №28 в том же настоящем браузере перемещает группу через GUI, сравнивает PNG-пиксели до/после, сверяет unchanged NORMAL до пользовательского действия, вызывает пересчёт, проверяет реально изменённые Float32 NORMAL в исходном скиннинговом GLB, сохраняет `.markscene` и проверяет SHA / 70 bones / 2 morphs / 3 clips / Undo/Redo. GitHub Actions `.github/workflows/pro-studio-pass28-group-normal-v2.yml` дополнительно выполняет все Pass9–27 regressions и Visual Engine v2 на **точном последнем коммите**, загружает архив фактических GLB/.markscene/PNG/JSON вместе с исходным и build SHA. Если любой тест падает — статус `blocked`, а не `passed`.

## Ограничения и следующий этап

Это всё ещё **ограниченный edit profile исходных indexed TRIANGLES (≤512 faces), до 16 команд**, не универсальное производственное ядро для N-gons/holes, произвольных edges, modifiers, UV unwrap, нормалей морфов, weight paint или sculpt. Пересчёт area-weighted нормалей сглаживает только в рамках одного исходного attribute row; полный контроль sharp edges / smoothing groups и MikkTSpace tangent generation пока не реализован. Установочный Kotlin Android APK не создан; тесты на настоящем Huawei Pura 80 Ultra/EMUI15 не проводились, Chromium SwiftShader не является Huawei GPU. Художественная приёмка Neon Boy и full Blender feature parity не выполнены.

**Далее №29:** перейти от ряда source-GLB к независимому persistent `VertexData/EdgeData/FaceData` владению топологией, с controlled migration, нормализованными модификаторами, поддержкой выделения по группам и split-UV безопасным tangent rebuild. Отдельный трек — Android/Kotlin shell, Gradle CI APK и действительная Huawei device matrix. Все PR остаются draft, main untouched без разрешения владельца.

## Definition of Done — feature-only

Feature ID: `MESH-GROUP-NORMAL-028` · Priority: P0 · Status: partial → passed (bounded profile, only after exact-head CI) · Backend: independent binary MeshData + WebGL2/Chromium SwiftShader · Source: deterministic 70-joint skinned seam fixture with SHA256 · Tests: unit/native/Bridge, real WebGL2/Canvas pixels, GLB readback, both new and old scene resource formats · Device Huawei: not tested · APK: unavailable · UI/SDK parity: yes inside supported profile · Blender parity: no.
