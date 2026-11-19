# MARK Professional Studio — проход №9 (первый небольшой срез)

**Сверено перед проходом:** ТЗ 18.11.2026, §§3.3, 5.1–5.2, 17, 19, 25, 28, 32–33; инструкция Kotlin/Huawei/GitHub §§4, 6–7, 11.

**Статус:** partial / experimental. Основа — коммит 604d3dc2b8f76b06afa2ede52c53f213cc56dbfe ветки develop/pro-studio-release0-audit. Отдельная feature-ветка; main и существующие PR не изменялись.

## Реализовано

- Операция `vertex.snap` в существующем binary glTF Mesh Edit kernel: `{kind:"vertex.snap",meshIndex:0,primitiveIndex:0,vertex:0,targetVertex:2}`.
- Позиция выбранной вершины копируется из координат другой вершины того же mesh primitive; записывается новый POSITION accessor и BIN bytes, а не node transform или декоративный маркер.
- Отказ при отрицательных, дробных, отсутствующих, идентичных и выходящих за пределы mesh индексах.
- Исходный GLB не изменяется, счётчик вершин и треугольников сохраняется; skin, animations, morphs и прочие атрибуты не перезаписываются.
- Операция автоматически доступна через существующий типизированный `mesh.edit` и журнал native preview; отдельного UI инструмента пока нет.
- Регрессионные тесты `tests/pro-studio-pass9-snap.test.mjs` (реальные POSITION bytes, отсутствие weld, rig/clip/morph preservation, invalid indices).

## Обязательные проверки

```bash
node --test tests/pro-studio-pass9-snap.test.mjs
node --test tests/pro-studio-mesh-edit.test.mjs tests/pro-studio-primitives.test.mjs tests/pro-studio-ai-bridge.test.mjs
npm run test:visual-v2
```

**Результаты:** новые тесты добавлены в исходный код; до получения CI run на точном head SHA статус **not tested**, не passed. Нет доказательств реального рендера, APK или Huawei hardware.

## Ограничения

Snap — **не** weld/merge: вершины лишь получают одинаковую POSITION; их индексы, UV seams, skin weights, morph deltas и связи не объединяются. Нет screen-space snapping, edge picking, select modes, gizmos, extrude, N-gons, crash-safe production native save. Для skinned/morph mesh операция происходит в базовых object/local координатах, а не по текущей деформированной позе.

## Что осталось и следующий проход

Закрепить зелёный CI на полном SHA и артефакт test logs. Затем **проход №10**: безопасный edge picking из текущего viewport, явное различие позиционного snap vs topological weld и первичная face extrude операция с полноценным переносом UV, skin и morph атрибутов, native round-trip и undo. Не объявлять функции готовыми без воспроизводимого DoD. Не сливать в main без разрешения владельца.
