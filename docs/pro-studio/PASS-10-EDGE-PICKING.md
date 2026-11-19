# MARK Professional Studio — проход №10: выбор рёбер настоящей геометрии

**Сверка перед началом:** ТЗ от 18.11.2026, §§3.3, 5.1–5.2, 11.1, 17, 19, 25, 28, 32–33; инструкция разработчика §§4, 6–7, 11. Исходная ветка: feature/pro-studio-pass9-vertex-snap (PR #19).

**Статус:** partial / experimental; изменения изолированы в feature/pro-studio-pass10-edge-picking, ни main, ни Visual Engine v2 не изменены.

## Сделано
- `src/pro-studio/viewport-picking.js`: дополнительный режим `edge` использует Raycaster по настоящему indexed triangle mesh и ближайшее из трёх рёбер пересечённого треугольника в экранных координатах.
- Порог выбора ограничен экранными пикселями; выбор отклоняется, если ни одно допустимое ребро не расположено достаточно близко.
- Ребро возвращается как стабильная внутри текущей топологии пара отсортированных vertex indices, вместе с glTF mesh/primitive ID, исходным triangle index и координатами клика.
- Текущая поза skinned/morphed mesh учитывается через существующий `getVertexPosition`; оранжевая линия визуально отмечает выбранный отрезок, обновляется вместе с анимацией.
- API `projectEdge(meshIndex,start,end,primitiveIndex)` проверяет принадлежность ребра индексированному треугольнику и возвращает экранные координаты.
- Browser GUI получил режим «Ребро» и автоматически устанавливает `edge.split`, `V1` и `V2` по фактически выбранным вершинам; `vertex.snap` из прохода №9 также вынесен в выбор операций.
- Добавлены Node-тесты реальной THREE.Raycaster геометрии с отрицательными сценариями.

## Проверить на неизменённом SHA
```sh
npm ci
node --test tests/pro-studio-pass9-snap.test.mjs tests/pro-studio-pass10-edge-picking.test.mjs
node --test tests/pro-studio-mesh-edit.test.mjs tests/pro-studio-primitives.test.mjs tests/pro-studio-ai-bridge.test.mjs
npm run test:visual-v2
npm run pro:rig:viewer
npx playwright install chromium
npm run pro:rig:accept
```
Пока нет фактически завершённого CI для этого SHA, `not tested`, даже если исходники и тесты закоммичены. Browser pointer integration и реальные кадры для нового режима пока не подтверждены. Предыдущие PASS-8 кадры не являются доказательством PASS-10.

## Ограничения
Не реализованы edge box/multi-select, occluded edge pick, topological weld, face extrude, persistent vertex/edge UUID, screen-space snap, full UV seam/corner normal pipeline или production native v3. Ребро идентифицируется индексами: после изменения топологии выбор нужно повторять. Raycast берёт ближайшую видимую поверхность, а не скрытые рёбра.

## Краткий итог и следующий проход
**Готово:** реальный edge pick + overlay + UI edge.split + тестовые сценарии. **Осталось:** CI, browser click evidence, полноценный Extrude с переносом skin/morph/UV и сохранением native. **Следующий проход №11:** закрыть тестовый гейт PASS-10, сделать безопасную `face.extrude` для ограниченного профиля GLB с бинарной геометрией и атрибутным round-trip, покрыть undo/save/reopen и WebGL2 скриншотами. Без согласования не объединять PR и не объявлять Blender replacement.
