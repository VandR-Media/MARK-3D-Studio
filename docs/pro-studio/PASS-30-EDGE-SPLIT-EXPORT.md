# MARK 3D Studio — проход №30: реальный Edge Split, MARKTOP2 и нативное сохранение

**Статус: частично выполнено.** Исходная проверенная база — draft PR #39 на SHA `4306105ca8c1e8f9ff925ca9c705a795ae8cff1e`. Работа сохраняется в отдельном draft PR #40. `main` не меняется. Оригинальный полный файл `MARK_3D_STUDIO_FULL_BLENDER_REPLACEMENT_TZ(1).md` из прежней переписки не удалось повторно открыть, поэтому полная приёмка ТЗ не заявляется.

## Реальные функции

1. `owned-edge-split-plan.js`: источник-специфичный, детерминированный разрез одного валидного ребра; граничный исходный треугольник превращается в два, общее ребро двух граней — в четыре. Индексные швы не свариваются автоматически.
2. `owned-edge-split-glb.js`: **физический** новый vertex и TRIANGLES index accessor, полное копирование/интерполяция используемых атрибутных рядов, UV0/UV1, morph target streams, нормалей, tangent и skin weights в ограниченном профиле. Исходный GLB не изменяется, старые BIN bytes сохраняются как точный префикс. Конфликтующие наборы JOINTS (а также опасные форматы) приводят к отказу, не к незаметному повреждению рига. Жёсткий лимит 512 граней.
3. `owned-split-topology-v2.js`: бинарный ресурс `MARKTOP2`, version 2. Содержит исходный SHA-256, исходные source vertex pair, параметр t, SHA-256 изменённого GLB, числа новых vertices/faces, встроенный настоящих `MARKTOP1` catalog с пересчитанными vertex/edge/face/halfedge records для изменённой сетки. Reader воспроизводит операцию из неизменяемого источника и исходного `MARKTOP1`, повторно вычисляет SHA-256 и проверяет побайтовую одинаковость новой топологии.
4. `markscene-v3-preview.js`: расширенный строгий ZIP/STORE-контейнер поддерживает **2/3/4/5** точно упорядоченных ресурсов. Новый пятый файл `mesh/owned-split-topology-v2.bin` разрешён только при наличии предыдущих MeshData + owned topology, канонической `meshSplitOperation` и пустых предшествующих MeshData/Topology журналов. Reader проверяет ZIP CRC, длину, независимый SHA, источник, версионированную структуру и полный детерминированный replay. `exportEditedSourceGlb` выводит физически разделённый skinned GLB из повторно открытого `.markscene`; `repackPreviewMarkscene` сохраняет операцию и может снять её с повторной упаковкой без нового ресурса.
5. `scripts/pro-studio-pass30-export-qa.mjs`: проверяемые source GLB, новый GLB, бинарный `MARKTOP2`, **настоящий сохранённый и повторно открытый `.markscene`**, JSON SHA-256 report. GitHub Actions предоставляет эти файлы как артефакт, если exact-head CI зелёный.

### Канонический профиль нового проекта

```js
edits: {
  meshDataOperations: [],
  meshTopologyOperations: [],
  meshSplitOperation: {
    kind: 'mesh.topologySplitEdge',
    meshIndex: 0,
    primitiveIndex: 0,
    edgeId: '<validated source-owned edge ID>',
    t: 0.5
  }
}
```

Это **первый ограниченный native one-shot split** исходной топологии, а не полноценный произвольный multi-step mesh modifier stack. В частности, он пока не комбинируется с уже применёнными сдвигами вершин/UV/Sharp/Seam в `MeshData` и `MARKTOP1`. Старые 2/3/4-ресурсные проекты продолжают открываться; принудительной миграции нет.

## Проверки и оставшиеся границы

- `tests/pro-studio-pass30-edge-split-plan.test.mjs`: исходная схема границ/общих полурёбер и отказы.
- `tests/pro-studio-pass30-edge-split-glb.test.mjs`: реальный skinned GLB, 70 joints, 2 morphs, 3 animations, 2 UV sets, точность BIN prefix и fail-closed.
- `tests/pro-studio-pass30-owned-topology-v2.test.mjs`: binary replay, source/output SHA, меняющиеся вершины/рёбра/грани/полурёбра, подделка и усечение ресурса.
- `tests/pro-studio-pass30-native-split.test.mjs`: нативный 5-resource create/open/export/repack, удаление операции и совместимость с сохранением без нового split resource. Плюс регрессии Pass29.

**Не сделано:** UI-кнопка, Bridge-команда и авторизация, история Undo/Redo для этого нового инструмента, поддержка нескольких последовательно разделённых рёбер, корректная композиция с ранее изменёнными UV/POSITION, N-gons, production full Blender parity, Chromium WebGL2 acceptance именно этого native split, Android/Kotlin APK и аппаратная проверка Huawei Pura 80 Ultra/EMUI 15. Старые инструменты редактора не следует считать доказательством поддержки новой операции. Следующий gate — явный Bridge command и native Undo/Redo с тестами, затем UI/Chromium.