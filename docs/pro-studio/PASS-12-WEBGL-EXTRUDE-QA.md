# MARK Professional Studio — проход №12: подтверждение Extrude настоящими WebGL2 кадрами

**Сверка перед проходом:** ТЗ 18.11.2026, разделы 3.3, 5, 17, 25, 28, 32–33; инструкция разработчика Kotlin/Huawei/GitHub §§4, 7, 11. Ветка: `feature/pro-studio-pass12-webgl-extrude-qa`, основание `feature/pro-studio-pass11-face-extrude` (PR #21). `main` не изменён.

## Готово

- `scripts/pro-studio-pass12-webgl-accept.mjs` запускает **настоящий Chromium WebGL2**, открывает skinned test GLB (70 костей / 2 POSITION morph / 3 clips), кликает треугольник на реальном canvas через Playwright, применяет из GUI `face.extrude`.
- Снимки before/after делаются через `canvas.toDataURL` при фиксированном ракурсе ¾; дополнительный кадр — front. `pngjs` сравнивает реальные пиксели и требует ненулевого содержательного изменения (более 100 пикселей при RGB diff >24).
- Через тот же MARK AI Bridge сохраняются редактируемый `.markscene`, экспортный GLB и проверяется его двоичная идентичность повторному экспорту после `openPreviewMarkscene`.
- Проверяются 19 вершин / 8 треугольников после отдельного extrusion, 70 joints, 3 animations, 2 morph targets и SHA оригинального source GLB.
- Создан отдельный GitHub Actions workflow с запуском Chromium, unit-регрессией v2 и автоматическим сохранением исходных PNG/GLB/markscene/JSON diagnostics как `mark-pass12-webgl-qa` артефакта.

## Статус и доказательства

Первый контрольный запуск `44608069074` (SHA `2fc9f998b63235fb4bb83ac21fb8687d72d5dd1a`) завершился **success**, включая экранную QA-проверку. Финальную оценку нужно вести по последнему SHA после корректировки ракурса — наличие предыдущего success не заменяет финальный запуск.

Снимки относятся к Chromium WebGL2/SwiftShader (software GPU) — **не** аппаратный Huawei и **не** Blender/production renderer. Кадры действительно извлечены из canvas, а не сгенерированы ИИ. `sourceSha` и SHA256 данных представлены в `pass12-report.json`. По ТЗ §25.3 пропущенные Huawei hardware и art-director QA не считаются пройденными.

## Ограничения и продолжение

Реализовано **individual triangle extrusion**, не общий Extrude Region. Нет полноценного N-gon data model, общей граничной топологии и corner-normal/tangent корректности для сложного рига. Нельзя считать MARK заменой Blender. Нет Android APK.

**Следующий проход №13:** ограниченный `face.regionExtrude` с анализом границы связанных треугольников, сохранением топологических/UV/skin/morph данных, детерминированным replay через `.markscene`, регрессионными тестами на замкнутые/открытые и non-manifold случаи и обязательным новым WebGL2 QA.
