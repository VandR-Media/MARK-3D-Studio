# MARK Professional Studio — проход №7: первый настоящий Mesh Edit Mode

**Основание:** повторная сверка с `MARK_3D_STUDIO_FULL_BLENDER_REPLACEMENT_TZ.md`, разделы 3.3, 4.1, 5.1–5.3, 17, 19, 25, 28, 32 и 33. Инструкции разработчика перечитаны перед работой.

**Статус:** **partial / experimental indexed-triangle edit profile**. Нельзя заявлять Blender replacement, даже при успешных тестах. Продукт остаётся standalone WEBGL2 preview + headless scene core, НЕ Android APK.

**Ветка:** `develop/pro-studio-release0-audit`, DRAFT PR #16, base `develop/visual-engine-v2`; `main` и PR #13 не изменять.

## 1. Реализовано в core

Новый чистый JS-код `src/pro-studio/mesh-edit-core.js` действительно редактирует *двоичные* glTF 2.0 accessors, индексный буфер и morph targets, не имитируя Mesh Edit трансформом объекта.

| Операция | Техническое действие | Реализованное ограничение |
|---|---|---|
| `vertex.move` | меняет `POSITION` выбранной вершины; создает новый accessor + bufferView в BIN | float32 VEC3, вершина по индексу |
| `edge.split` | добавляет вершину, разбивает **все инцидентные** треугольники, обновляет индексы | linear interpolation, максимум 4 skin influences; только indexed TRIANGLES, bounded |
| `face.flip` | меняет порядок двух индексов грани (winding) | нормали не пересчитываются |
| `face.delete` | реально исключает треугольник из индексного буфера | оставшиеся неиспользуемые вершины не удаляются |
| `mesh.getStats` | считает вершины/грани/уникальные ребра, degenerate/unused и morph counts | локальный mesh/primitive, не полная диагностика manifold |

Для edge.split пересчитываются все потоки вершин, в том числе `POSITION`, `NORMAL`, `TEXCOORD_0`, `JOINTS_0`, `WEIGHTS_0` и имеющиеся morph delta accessors. Веса объединяются, выбираются 4 наиболее значимых влияния и нормализуются (число костей и привязки inverse-bind не меняются). Новая геометрия действительно отображается через Three.js skinned mesh + morph, а не отдельной фальшивой картинкой.

**Строгий профиль:** GLB 2.0, один встроенный BIN, dense Float32 vertex arrays (JOINTS_0 Uint8/Uint16), indexed TRIANGLES, до 500 000 вершин, до 3 млн индексов, 64 MiB на GLB. Sparse, Draco, geometry shader, многогранные N-gons, морф-скульпт, UV unwrap, материалы с расширенными атрибутами, weight paint и пересчёт normal/tangent сейчас неподдерживаемы и должны приводить к явной ошибке.

## 2. Реальное нативное сохранение

`markscene-v3-preview.js` сохраняет **исходный byte-identical GLB**, а `edits.meshOperations` — как упорядоченный, валидируемый список действий. При открытии список заново проверяется на исходном GLB. При экспорте все правки детерминированно воспроизводятся, затем применяются TRS/PBR overrides. Никакая операция не переписывает `assets/source.glb` внутри ZIP.

- `sourceSha256` относится к оригиналу; его сохранность проверяется и в браузере, и независимо в Node.
- Экспорт с geometry edits теперь помечается `geometryModified:true`, `preservesOriginalBinary:false` (старый флаг не может говорить ложное `true`).
- Глубина списка геометрических операций для native preview: 32; дальнейшая оптимизация и компактирование accessors — отдельная задача.
- Один изменённый mesh не меняет shared accessor другого mesh; base original buffers, animations, skin bind matrices и текстуры остаются нетронутыми.
- `scene.save` сохраняет версии геометрии как operation log, `history.undo/redo` восстанавливает предыдущие edits snapshots. История undo **пока не сериализуется** в проект и не восстанавливается после перезапуска.

## 3. AI Bridge и интерфейс

Через тот же ограниченный AI Bridge версии `mark.ai-bridge/0.1-preview` добавлены:

- `mesh.getStats({meshId:"gltf-mesh-0", primitiveIndex:0})`
- `mesh.edit({meshId:"gltf-mesh-0", primitiveIndex:0, operation:{kind:"vertex.move",vertex:2,delta:[0,0.2,0]}})`
- `mesh.edit({meshId:"gltf-mesh-0", operation:{kind:"edge.split",start:1,end:2,factor:0.5}})`
- `mesh.edit({meshId:"gltf-mesh-0", operation:{kind:"face.flip",face:0}})`
- `mesh.edit({meshId:"gltf-mesh-0", operation:{kind:"face.delete",face:0}})`

Поддерживается помещение нескольких команд в `transaction.begin/commit/rollback`, а также undo/redo. В браузерном HTML — видимые кнопки «Открыть Edit Mode», выбрать mesh/операцию, «Применить», Undo, Redo, сохранить изменённый `.markscene` и экспортировать новый GLB. Для записи нужен явный флажок разрешения AI Bridge. Опасное удаление грани запрашивает подтверждение.

**Использование:** открыть автономный HTML; загрузить GLB или воспользоваться встроенным тестовым; включить разрешение AI Bridge; открыть Edit Mode; указать mesh index/vertex index и сдвиг XYZ; применить; проверить изменение в 3D; затем отдельно сохранить `.markscene` либо экспортировать GLB.

**Безопасность:** методы не принимают произвольный JS, сетевые URL или файловые пути; конфликтные и неподдерживаемые операции отклоняются с diagnostics и не меняют существующую сцену. Суммарная квота бинарных загруженных ассетов in-process теперь 96 MiB дополнительно к лимиту 64 MiB на отдельный ассет. HTTP/WebSocket и внешнее соединение **по-прежнему не реализованы**.

## 4. Как подтверждать и воспроизводить

```bash
npm install --no-audit --no-fund
node --test tests/pro-studio-mesh-edit.test.mjs
node --test tests/pro-studio-ai-bridge.test.mjs
npm run test:visual-v2
npm run pro:rig:viewer
npx playwright install chromium
npm run pro:rig:accept
```

Проверки:
1. В Vertex Move действительно изменяются float32 glTF POSITION bytes, а sourceGLB не меняется.
2. Edge Split реально добавляет вершину и два треугольника, интерполирует UV, JOINTS/WEIGHTS и два morph deltas.
3. Face Flip меняет winding, Delete убирает три индекса.
4. Invalid/sparse/unknown ops отклоняются; не удаляется последняя грань; bounded operations.
5. `.markscene` reopen сохраняет список команд; GLB export→reopen детерминирован и сохраняет три клипа, 70 костей, два морфа и PBR PNG в поддерживаемом профиле.
6. Реальная программа `render.capture` возвращает **различные PNG** до/после mesh edit; индексный mesh count изменён; undo возвращает старую геометрию, redo новую.
7. Старые Visual Engine v2 robot/scene regression tests остаются обязательными.

CI job сохраняет `acceptance/mesh-edit-p7-before-real-webgl.png`, `mesh-edit-p7-after-real-webgl.png`, `mesh-edit-p7-native.markscene`, `mesh-edit-p7-exported.glb`, подробный `browser-report.json` и HTML для ручной проверки. Нельзя считать пройденными артефакты без подтверждения текущего HEAD SHA и зелёного CI.

## 5. Что остаётся: не закрыто в ТЗ

- Настоящий селектор вершин/рёбер/полигонов во viewport; сейчас индексы указываются вручную. Нет долговечных UUID отдельных вершин/граней, выделений, box select, gizmo.
- Нет N-gons/holes, manifold healing, автоматического recalculation normals/tangents, edge bevel, extrude, inset, loop cut, modifiers, UV edit.
- Нет mesh.create из пустой сцены, многопоточного высокополигонального ядра, sculpt/retopo, weight painting/IK, полноценного versioned scene core v3; редактирование полного 70-bone художественного Neon Boy из пустого проекта невозможно.
- Нет физического Huawei Pura 80 Ultra benchmark/APK — этот проход веб-редактор, не Android app.
- Реальная независимая сеть AI Bridge (auth, scoped tokens, jobs, timeouts) не реализована.
- Нет recovery/atomic filesystem save в Native scene v3-preview, лишь ZIP с source SHA и CRC.
- Требуется полноценный licensed human fixture (70 bone/3 clips/facial morphs) и принятие художественного эталона заказчиком.

**Следующий проход №8:** повторная сверка с ТЗ; UI выбор вершин/граней прямо в WebGL, нормали/топологическая диагностика, primitive mesh creation + надежный undo/project save/reopen. Затем отдельные процедуры веса, риггинга, UV и художественный Neon Boy.
