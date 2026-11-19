# MARK Professional Studio — проход №13: ограниченный Region Extrude

**Сверка перед работой:** основное ТЗ от 18.11.2026, §§3.3, 4, 5.1–5.2, 7, 8, 17, 19, 25, 28, 33; инструкция Kotlin/Huawei/GitHub §§2, 4, 6–7, 10–11. Основа — PR #22, ветка feature/pro-studio-pass12-webgl-extrude-qa. Всё изменение изолировано в feature/pro-studio-pass13-region-extrude, main не меняется.

## Готово

- Типизированная операция `face.regionExtrude` принимает `{kind:"face.regionExtrude",faces:[0,1],distance:0.4,meshIndex:0,primitiveIndex:0}`.
- В реальном glTF BIN ядре проверяются диапазон и неповторяемость face IDs, связность через общие **индексированные** рёбра, корректное направление общих рёбер, отсутствие non-manifold конфликтов, нулевой площади и несовместимых по ориентации фасеток.
- Поддерживается **один простой замкнутый контур** области (topological disk). Отверстия, несколько отдельных компонент, non-manifold и самопересечение границы не объявляются поддержанными.
- Треугольники выделенной области получают **общую** вершину cap на каждый уникальный source vertex; внутренние грани не получают боковых стенок. По периметру добавляются quad sidewalls, триангулированные для glTF. Для каждой стены создаются собственные wall UV/corner normal seam вершины.
- Переносится полный поддерживаемый Float32 vertex-stream профиль, `JOINTS_0 / WEIGHTS_0`, морфы `POSITION`; исходный GLB остаётся байтово неизменным, а текстуры, клипы, skeleton bind matrices и materials не перезаписываются.
- `.markscene` канонически сортирует `faces`, отказывает при дополнительных полях и валидирует операцию через то же BIN-ядро. AI Bridge выполняет `mesh.edit`, `scene.save`, `scene.export`, `history.undo/redo`.
- GUI: пункт «Выдавить группу граней (Region)», поле IDs `0,1`, Shift+клик добавляет соседние треугольники в список. Отображаемый overlay пока показывает **последнюю** выбранную грань, не всю группу.
- Unit-тесты: реальная группа из двух треугольников (24 output vertex, 10 triangles), отсутствие внутренних стенок, UV, rig 70 joints, 2 morph targets, 3 clips, native replay, undo/redo; отказы disconnected, hole, reversed winding, nonmanifold и unsafe JSON keys.
- Отдельный CI строит viewer и запускает Playwright Chromium WebGL2 с настоящими mouse Shift+click, сравнивает кадры до/после, проверяет source hash, GLB и native reopening, прикладывает PNG и JSON.

## Статус проверки

Тесты должны **фактически** завершиться на финальном commit SHA; до этого статус `partial / not accepted`. Ссылка на успешный PR #22 относится **только к предыдущему проходу**.

```sh
npm install --no-audit --no-fund
node --test tests/pro-studio-pass13-region-extrude.test.mjs
node --test tests/pro-studio-pass9-snap.test.mjs tests/pro-studio-pass10-edge-picking.test.mjs tests/pro-studio-pass11-extrude.test.mjs
npm run test:visual-v2
npm run pro:rig:viewer
npx playwright install chromium
node scripts/pro-studio-pass13-region-webgl-accept.mjs
```

## Известные ограничения

**Экспериментальный профиль:** только indexed glTF TRIANGLES с dense attributes. Нужен Float32 NORMAL, а у morph-target допускается только `POSITION`; `TANGENT` и морфы нормалей сознательно отвергаются. Не поддерживаются N-gons, точное сохранение физически непрерывной half-edge топологии поверх UV seams, несколько контуров, самопересекающиеся области, Boolean, Region Extrude со сложным offset/intersection resolution. Периметр визуально и геометрически совпадает по позициям, но glTF seam vertices **разделены по индексам** — поэтому output нельзя объявлять индексно-замкнутым manifold solid.

Выбор по Shift+клику пока не делает подсветку всей группы и не поддерживает box/lasso selection. Никакой аппаратный Huawei тест, нативный Android APK и арт-директорская приёмка не проводились. Не является полной заменой Blender.

## Следующий проход №14

После обязательного зелёного CI на точном SHA: исправить обнаруженные browser regressions, затем разработать selection overlay всех faces группы и отдельное corner-attribute/half-edge представление, чтобы UV seams не ломали логическую топологию; расширить QA на сложные соседние regions и проверку границ. Слияние PR только после разрешения владельца.

Feature ID: `MESH-REGION-013`. Приоритет P0. Статус `partial` до CI + реальной Huawei QA. Подтверждаемый backend: JS glTF mesh core и Chromium/SwiftShader WebGL2; GPU Huawei: not tested. Решение: fix / verify.
