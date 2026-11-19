# MARK Professional Studio — проход №14: фактическая подсветка группы граней

**Перед началом повторно сверено:** пользовательское ТЗ от 18.11.2026, §§3.3, 4.1, 5.1–5.2, 11.1, 17, 25, 28, 33, и инструкция «МОЙ ПЕРСОНАЛЬНЫЙ ANDROID-РАЗРАБОТЧИК — KOTLIN + HUAWEI + GITHUB», §§2, 4, 6–7, 10–11. Основа — черновой PR #23 (проход №13), ветка `feature/pro-studio-pass13-region-extrude`. Код изолирован в `feature/pro-studio-pass14-region-overlay`, `main` без изменений.

## Результат разработки

- **MESH-REGION-OVERLAY-014:** в действительном Three.js/WebGL2-окне новая полупрозрачная заливка отмечает все выбранные индексированные треугольники, а золотой контур содержит только **граничные рёбра**, без общего внутреннего диагонального ребра. Старый контур последнего отдельного face автоматически скрывается при выборе группы более чем из одной грани.
- Геометрия заливки/контура строится по реальным `geometry.index` и текущим мировым координатам `getVertexPosition` (включая поддерживаемый skinned/morphed pose); overlay пересчитывается при обновлении viewport. Не используются guessed mesh IDs, статические картинки или UI-макеты.
- `src/pro-studio/topology-selection.js`: чистый безбраузерный анализатор связности через indexed edges, ориентации общих рёбер, boundary/internal edges, компоненты, non-manifold и наличие **одного** простого замкнутого контурного обхода. Это диагностика **выделения**, а не полноценная half-edge редактируемая MeshData v3.
- GUI синхронизирует подсветку с настоящими мышиными Shift+кликами и ручным CSV-полем индексов. Числа проверяются; повторяющиеся или отсутствующие face IDs отвергаются. После изменения топологии (`face.extrude`, `face.regionExtrude`, `edge.split`, `face.delete`) накопленная область сбрасывается, чтобы устаревшие индексы не указывали на неправильные грани.
- Unit-покрытие: обычная пара треугольников, внутренний диагональный edge, отвергнутые ID, disconnected selection, hole, reversed winding, non-manifold; реально обновляемая THREE-геометрия overlay, его скрытие и очистка.
- Browser QA: настоящий Chromium WebGL2 pointer click + Shift+click, отдельные изображения single-face/multi-face из canvas, измерение реальных изменённых пикселей, ручная правка списка граней, отказ дубликатам, очистка после Extrude, `.markscene` и GLB round-trip. Ветка публикует архив `mark-pass14-region-overlay-webgl`.

## Проверки

Запускать/проверять на **точном финальном SHA**:

```sh
npm install --no-audit --no-fund
node --test tests/pro-studio-pass14-region-overlay.test.mjs
node --test tests/pro-studio-pass13-region-extrude.test.mjs tests/pro-studio-pass11-extrude.test.mjs tests/pro-studio-pass10-edge-picking.test.mjs tests/pro-studio-pass9-snap.test.mjs
npm run test:visual-v2
npm run pro:rig:viewer
npx playwright install chromium
node scripts/pro-studio-pass14-overlay-webgl-accept.mjs
```

**Не считать результат принятым до завершившегося зелёного CI на последнем commit SHA.** Скриншоты относятся к Chromium/SwiftShader (software GPU), не к реальному Huawei Pura 80 Ultra. Native Android APK и независимая арт-директорская приёмка не выполнялись. Следуя §25.3, пропущенные hardware-тесты не объявлять пройденными.

## Важные ограничения

Топология для отображения определяется **исключительно glTF vertex indices**: координатно совпадающие вершины, разведённые по UV/corner-normal швам, не «сшиваются» автоматически. Движок пока не создаёт профессиональную half-edge / face-corner MeshData с постоянными vertex/edge/face UUID. Проекция и выделение рёбер не включает скрытые рёбра и lasso/box. Заливка не является заменой полноценного face-select paint/selection buffer для очень больших мешей. Профиль Region Extrude, наследованный из №13, допускает только простой связный контур без отверстий. Не является полной заменой Blender.

## Короткий отчёт и следующий проход

**Готово:** полная групповая подсветка, чистый анализатор индексов и диагностика, согласованный GUI, физические WebGL2 тесты.

**Проверено:** зависит от результата GitHub Actions по финальному SHA; результаты предыдущих SHA не переносятся автоматически.

**Осталось:** отдельная half-edge/face-corner архитектура и корректное использование UV seams как одного геометрического ребра с несколькими corner-атрибутами, стабильные ID, performance QA, Huawei hardware.

**Следующий проход №15:** определить и протестировать базовый `MeshTopology` с разделением geometric vertex ↔ glTF corner-vertex, детектором UV seams и безопасной конвертацией из индексированных glTF meshes, затем интегрировать в диагностику Region Extrude без разрушения старого export/native profile. Только в отдельной ветке и без слияния без согласования владельца.

Feature ID: `MESH-REGION-OVERLAY-014`, P0, temporary preview profile. Huawei deviceTested: false.
