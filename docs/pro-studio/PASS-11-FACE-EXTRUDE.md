# MARK Professional Studio — проход №11: bounded triangle extrusion

Основание перед началом: `MARK_3D_STUDIO_FULL_BLENDER_REPLACEMENT_TZ.md` от 18.11.2026, §§3.3, 4, 5.1–5.2, 8, 17, 19, 25, 28, 32–33; `ИНСТРУКЦИИ-для-разработчика.txt`, §§4, 6–7, 11. Основа кода: PR #20 (`feature/pro-studio-pass10-edge-picking`). Изолированная ветка `feature/pro-studio-pass11-face-extrude`. `main` не изменён.

## Сделано

- `face.extrude` в реальном бинарном indexed TRIANGLES glTF: `{kind:"face.extrude",meshIndex:0,primitiveIndex:0,face:0,distance:0.25}`.
- Исходный треугольник заменяется поднятым cap; 3 quad sidewalls триангулируются с правильным winding. Добавляется 15 вершин и 6 треугольников относительно исходной сетки. Объём не обещает manifold на произвольной исходной топологии.
- Стенки получают независимые плоские нормали и прямоугольные UV. Все остальные исходные vertex attributes копируются в новые вершины. JOINTS_0 / WEIGHTS_0 и POSITION morph deltas копируются соответственно привязанным исходным вершинам.
- **Явное ограничение:** меши с TANGENT или морфами NORMAL/TANGENT отклоняются для предотвращения некорректного tangent space/facial shading; также отклоняются unsupported normalized/interleaved profiles, degenerate face, нулевое и слишком большое выдавливание. Не заявлять общую поддержку N-gons, Bevel, Region Extrusion, UV unwrap.
- `src/pro-studio/markscene-v3-preview.js` теперь разрешает и безопасно канонизирует `vertex.snap` (исправление ошибки прохода 9) и `face.extrude`; сохраняется operation log, исходный GLB не меняется.
- UI браузерного viewer добавляет операцию «Выдавить треугольную грань» и отдельное ограниченное числовое поле расстояния. Применение идёт тем же `mesh.edit` / Undo/Redo / native save/export.
- Тесты `tests/pro-studio-pass11-extrude.test.mjs`: BIN topology, cap/wall winding, UV seam, 70-joint skin, weights, 2 morph targets, 3 clips, PNG texture, native save/open/export, invalid inputs, bridge undo/redo. Тесты Pass9/Pass10 + старый visual v2 — обязательная регрессия.

## Проверки и доказательства

**Статус до успешного исполнения:** `not_tested`. Наличие тестов в репозитории не является их прохождением. Тестовый CI workflow должен выполниться на точном SHA финального коммита.

```sh
npm ci
node --test tests/pro-studio-pass9-snap.test.mjs tests/pro-studio-pass10-edge-picking.test.mjs tests/pro-studio-pass11-extrude.test.mjs
node --test tests/pro-studio-mesh-edit.test.mjs tests/pro-studio-primitives.test.mjs tests/pro-studio-ai-bridge.test.mjs
npm run test:visual-v2
npm run pro:rig:viewer
```

Отдельный браузерный WebGL2 screenshot/new face-extrude visual acceptance и test on Huawei Pura 80 Ultra ещё не пройдены. Ни Blender replacement, ни production `.markscene`, ни APK этим проходом не подтверждаются.

## Осталось и следующий проход

**Осталось:** подтверждённый зелёный CI на полном SHA; браузерные снимки изменённой геометрии до/после выдавливания и browser pointer selection с отчётом; modifier/UV seam topology, поддержка morph NORMAL/tangents через корректную реконструкцию, N-gons и полноценная UUID-система.

**Следующий проход №12:** провести browser Playwright/WebGL2 QA нового Extrude, исправить результаты CI, затем сделать region extrusion c topological boundary detection, deterministic native reopen и visual regression. Без согласования владельца PR в main не объединять.

## Отчёт по функции (§33)

Feature ID: `MESH-EXTRUDE-011`; приоритет P0; статус `partial` до подтверждённого CI; supported profile `indexed TRIANGLES, dense position/normal/UV/skin and POSITION morph`; backend: JS core и Three.js viewer; реальный Huawei: `not tested`; результат: отдельная feature-ветка, native-preview replay; решение: `fix / verify`, не `accept`.
