# MARK 3D Studio — проход №17: физический Region Extrude через подтверждённый UV-шов

**Предварительная сверка:** ТЗ от 18.11.2026 §§3.2–3.3, 4.1, 5.1–5.2, 7.1, 17.2–17.3, 19, 25.1–25.3, 28, 33 и «ИНСТРУКЦИИ-для-разработчика.txt» §§2–4, 6–11. Основа: PR #26 / `feature/pro-studio-pass16-explicit-seam-links`, на точном SHA `737403b049cceae0828fecc459aef08c0d234c10` CI успешно пройден. Этот проход ведётся отдельно в `feature/pro-studio-pass17-seam-region-extrude`; `main` не меняется.

## Задача и решение

**Feature ID:** `MESH-REGION-SEAM-017`, P0, ограниченный экспериментальный профиль.

- Команда `mesh.extrudeLinkedRegion({meshId, faces, distance})` на MARK AI Bridge доступна после двух или более **подтверждённых пользователем** исходных соответствий `mesh.linkSeam`. Интерфейс содержит отдельный пункт «Выдавить через подтверждённый UV-шов (один раз)» и явное подтверждение действия.
- Команда атомарно проверяет mesh, primitive, список ID граней, расстояние, исходные связанные пары, несовместимость POSITION/morph/skin, связность и orientability, реальный loop внешнего контура; изменяет glTF BIN через ядро `src/pro-studio/mesh-edit-core.js`.
- Новая типизированная операция `face.regionExtrudeLinked` использует подтверждённые seam-пары **только для определения логических общих рёбер**. Внешний обход строится по такой логической топологии, тогда как исходные шесть раздельных glTF attribute rows сохраняют **свои собственные UV/corner normals, skin joint IDs, weights и POSITION morph deltas**.
- На двух треугольниках с split-UV seam создаются шесть поднятых cap attribute rows и **четыре**, а не шесть, наружных боковых quads (триангулированных в восемь faces). Внутренние стены на UV seam не создаются. Все четыре боковые стены получают отдельные corner normals и UV; glTF исходные индексы и UV не «свариваются».
- Два UV-набора сохраняются независимо. Тестовый настоящий GLB содержит 70 костей, 2 POSITION morph targets, 3 анимационных клипа и встроенную PNG/PBR. Поддерживаемый результат сохраняет все эти данные и связи.
- После успешной операции исходные `meshSeamLinks` **потреблены**. Подтверждение остаётся как каноническое `links` в журнальной операции `edits.meshOperations`, а `mesh.getLinkedRegion` возвращает `sourceLinksConsumed:true`, source-to-cap attribute remap и deterministic stable cap IDs с полным SHA-256 исходного GLB. Непосредственно физически редактируемый GLB экспортируется через `scene.export`.
- До реализации переназначения всех corner/edge IDs **другие mesh-операции в том же журнале заблокированы** до/после однократного Region Extrude: `MESH_LINKED_SEQUENCE`. Undo возвращает исходные утверждённые связи и геометрию, Redo восстанавливает точно те же binary bytes. Команды `mesh.edit` не могут подделать согласие, `face.regionExtrudeLinked` доступна только через отдельную команду.
- `.markscene` v3-preview хранит исходный GLB без изменений, типизированную операцию с каноническими связями и replay. При открытии защищённо проверяются все ключи, связные пары, one-shot sequence, защита по исходному sha и конструктивная корректность бинарного экспорта.

## QA и проверяемые ограничения

Новый набор `tests/pro-studio-pass17-seam-region-extrude.test.mjs` проверяет BIN-координаты капа, реальную триангуляцию четырёх стен, оба UV-набора, JOINTS_0/WEIGHTS_0, все POSITION морфы, 70 костей, 3 clips, PNG/PBR, non-mutating source, точность native replay и Undo/Redo, поддельные/неупорядоченные/несовместимые links и unsafe follow-up. Регенерируемый скелетный seam fixture: `scripts/pro-studio-pass17-skinned-seam-fixture.mjs`.

Chromium WebGL2/SwiftShader: `scripts/pro-studio-pass17-seam-webgl-accept.mjs` — настоящие клики по двум граням, явное подтверждение двух seam-пар, GUI physical extrusion, real canvas PNG до/после, pixel diff, native replay и cap-identity trace. Workflow `.github/workflows/pro-studio-pass17-linked-region.yml` автоматически выполняет Pass9–16 regressions, Visual Engine v2, предыдущие Pass16 browser QA и новые Pass17 browser tests, прикладывает PNG/GLB/.markscene/JSON с build/source SHA в `mark-pass17-seam-region-extrude-webgl`.

```sh
npm install --no-audit --no-fund
node --test tests/pro-studio-pass17-seam-region-extrude.test.mjs
node --test tests/pro-studio-pass16-explicit-seam-links.test.mjs
npm run test:visual-v2
npm run pro:rig:viewer
npx playwright install chromium
node scripts/pro-studio-pass17-seam-webgl-accept.mjs
```

**QA строго относится к конкретному SHA**. Этот документ описывает сделанное и критерии, но не присваивает статус `passed` до успешного CI на последнем коммите. Статус Feature ID остаётся `partial` до выполнения Huawei hardware и полного независимого reviewer acceptance согласно ТЗ §25.3.

## Ограничения

- Только одноразовый `face.regionExtrudeLinked` как **единственная** mesh operation исходного source GLB. Это не общая half-edge / N-gon / multi-hole архитектура.
- По GLB indices cap остаётся split в местах UV seams; это позиционно непрерывная поверхность с корректно ограниченными sidewalls, **не индексно-манифолдный welded solid**. Логические отношения подтверждены, физическая сварка индексов **не выполняется**.
- Не поддерживаются precomputed TANGENT, normalized integer UV, morph NORMAL/TANGENT и сложные нескольких несвязных/внутренних boundary loops. Никаких молчаливых преобразований unsupported streams.
- После применения не поддерживается дальнейшее редактирование созданного cap до безопасного remap ID. Новые `capStableId` устойчивы для данного source SHA + one-shot operation, не обещают устойчивость при изменении будущей topology.
- Нет полного UV unwrap/painting, наборов пользовательских material per face, N-gon edit, живых геометрических операций через несколько seams для произвольной позы, production скульптинга или профессионального автономного рендера. Подсветка Pass14 использует glTF attribute IDs и ещё не рисует логический seam boundary отдельно.
- Настоящий Android APK, Huawei Pura 80 Ultra / EMUI 15 hardware QA и независимая арт-директорская приёмка **не выполнялись**; SwiftShader — программный WebGL2 и не подтверждает работу GPU Huawei.

## Следующий проход №18

Перейти к постоянной редактируемой half-edge / face-corner `MeshData` с явными UV seam-edge ID, сохраняемыми face loops, corner attributes, remap tables и проверкой manifold после операции. После тестов разрешить последовательные операции над созданным капом, без блокировки всего журналa. Добавить наглядную подсветку логических boundary edges через UV seams, Lasso/Box-selection, и затем отдельный Android/Huawei target.

**Решение:** принять только после green exact-SHA Node + WebGL2 CI, далее `partial`/профессиональный продукт не завершён. В `main` не сливать без согласия заказчика.
