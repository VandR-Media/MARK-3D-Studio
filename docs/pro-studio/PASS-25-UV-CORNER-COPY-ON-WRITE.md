# MARK 3D Studio — проход №25: персистентные UV-углы с copy-on-write

**Feature ID:** UV-CORNER-COW-025 · P0 · ограниченный экспериментальный профиль. Проверку PASS подтверждать только после GitHub Actions success на точном final SHA.

## Требования и источник

Перед проходом перечитаны пользовательские MARK_3D_STUDIO_FULL_BLENDER_REPLACEMENT_TZ(1).md (§§3.2–3.3, 4.1, 5.1–5.2, 7, 17, 19, 25, 28, 31–33) и ИНСТРУКЦИИ-для-разработчика.txt (§§2–4, 6–11). Базовая ветка feature/pro-studio-pass24-depth2-daughter-lineage, draft PR #34, финальный зелёный SHA 10130771d664d1d9d0f72be3b35a3acb17f45bdc. Новая ветка feature/pro-studio-pass25-uv-corner-cow. main не изменять и не сливать без согласия владельца.

## Физическое редактирование GLB

- Новая типизированная операция **uv.offsetFaceCorners** `{kind,meshIndex,primitiveIndex,faceIndex,uvSet,delta}`. Допустимы UV0/UV1, не более 8 команд, без предшествующих изменений топологии. delta — два конечных числа [-1,1], ненулевой вектор. Существующий UV set обязателен.
- Для трёх углов выбранной indexed TRIANGLES грани создаются **три новые полноценные атрибутные строки**: POSITION, NORMAL, JOINTS_0/WEIGHTS_0, оба UV-набора, цвета, поддерживаемые морфы. Смещается только целевой UV-набор. На новые строки переключаются индексы только этой грани. При общей физической исходной вершине соседняя грань остаётся на прежней строке — её UV, риг, морфы, оригинальные атрибуты и индексы не повреждаются.
- Объём физической геометрии для fixture: 6→9→12→15 атрибутных вершин при неизменных 2 треугольниках. Скелет 70 костей, 2 морфа и 3 анимации и PBR-текстуры остаются в импортированном GLB; оригинальные байты source GLB immutable.
- Строгий fail-closed профиль: source-only topology, bounded triangle count and rows; никакого UV unwrap, seam auto-weld, sparse/unsupported атрибутного редактирования или скрытой потери данных. Изменения вне подтверждённого профиля отклоняются, а не эмулируются.

## Стабильные ID, native проект и интерфейс

- MeshData.uvCornerRemaps[] отражает каждую последовательную команду: sourceFace, стабильный faceId, неизменные cornerIds, сохранённые logical vertex IDs, beforeAttributeVertices, newAttributeVertices, uvSet и delta. Полный source SHA-256 и mesh/primitive составляют namespace. Поле uvCornerRemap — последний результат. Порядок операций меняет номера физических глифовых строк, но не face/corner IDs.
- Фактические угловые UV0 и UV1 отражаются в MeshData.corners[].attributes.uvSets. Для общего исходного индекса выделение UV не нарушает логический halfedge и соседнюю грань — новые строки приравниваются по source-scoped logical vertex ID. Исторические row offsets не считаются стабильными ID.
- MARK AI Bridge **mesh.offsetUvFace({meshId,primitiveIndex,faceId,uvSet,delta})** требует write authorization и проверяет существование актуального стабильного faceId в текущем MeshData, входную схему, UV set и разрешённую последовательность. Unknown/stale ID и любые лишние поля отклоняются.
- .markscene хранит source GLB и типизированный журнал UV-операций; save → close → open → export повторяет физический GLB побитово. Undo/Redo возвращает настоящие glTF индексы и атрибуты.
- GUI: новая панель UV Editing, настоящая Canvas2D-развёртка из актуальных MeshData-corners, переключатель UV0/UV1, ΔU/ΔV, mouse raycast выбора грани в настоящем WebGL2 viewport, контрольное подтверждение и экспорт. Даже поддельное числовое поле не заменяет проверенный faceId, полученный из реального 3D-выделения.

## Тестирование и критерии приёмки

- Node: `node --test tests/pro-studio-pass25-uv-corner-cow.test.mjs` — 8 тестов бинарного UV0/UV1, повторных правок, порядка, сохранения стабильных ID, модели с *реальными общими индексами*, морфов/скина/PBR, negative guards, native save/reopen и Bridge Undo/Redo.
- Chromium: `node scripts/pro-studio-pass25-uv-corner-webgl-accept.mjs` — настоящий WebGL2 face mouse-click; смещение UV0 и UV1 через GUI; Canvas2D polygon PNG до/после с пиксельным отличием; GLB/.markscene source SHA, сохранение 70 костей/2 морфов/3 анимаций; физические undo/redo.
- Workflow `.github/workflows/pro-studio-pass25-uv-cow.yml`: новые unit, регрессии Pass9–24, Visual Engine v2, оффлайн WebGL2 build, реальные Chromium Pass24 и Pass25, PNG/GLB/native .markscene/JSON+SHA artifact.
- Статус **passed** возможен только после **success на exact final commit SHA**; предыдущий зелёный run не подтверждает новую редакцию. Chromium SwiftShader — НЕ Huawei GPU.

## Что ещё не готово

**Важное различие:** в этом проходе UV-редактирование становится *персистентной типизированной операцией*, а MeshData всё ещё **реконструируется** из immutable source GLB и журнала .markscene. Отдельного полноценного сериализованного редактируемого MeshData datablock с N-gons/holes, general UV islands, unwrap/packing и modifier stack пока нет. Обозначать это как готовую Blender-замену нельзя.

Не выполнены Android APK/Gradle/Kotlin Studio target, реальные тесты Huawei Pura 80 Ultra и EMUI 15, самостоятельное художественное принятие Neon Boy.

**Следующий проход №26:** самостоятельный бинарный MeshData datablock с постоянно сохранёнными IDs вершин/граней/углов, migration source-to-editable mesh, простейший UV island transform, затем general modifier/rig workflows. Продолжать без бесконечных микропроходов только по одной топологической операции.
