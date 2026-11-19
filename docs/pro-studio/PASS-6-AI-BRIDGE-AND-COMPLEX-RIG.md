# MARK Professional Studio — проход №6: AI Bridge и сложный rigged GLB

**Основание:** исходное техническое задание MARK 3D Studio от 18.11.2026 (SHA-256 b83d2c08515077960dd7846d69508fb99cfce6678bebc9569ee32f69feb9988d), особенно §§3, 4, 8, 9, 17, 19, 20, 25, 28 и 32.

**Статус:** PARTIAL / EXPERIMENTAL. Не релизный HTTP API и не замена Blender.

**Ветка:** develop/pro-studio-release0-audit, черновой PR #16.
**CI подтверждение:** https://github.com/VandR-Media/MARK-3D-Studio/actions/runs/44511280407
**Проверенный SHA:** aa3188f1613a7ba9a812f3aa4b4969abcff37249.

## 1. Что реально реализовано

- src/pro-studio/ai-bridge-core.js — проверяемый отдельно от WebGL2 command bus. Версия mark.ai-bridge/0.1-preview.
- scripts/pro-studio-ai-bridge-cli.mjs — настоящий Node.js 22+ headless CLI. Работает с физическим локальным GLB или экспериментальным .markscene, не требует Blender.
- src/pro-studio/rig-viewer.js — тот же command bus, подключённый к работающему WebGL2. Команда render.capture возвращает байты настоящего PNG из canvas, а не имитацию изображения.
- Явная галочка разрешения записи в UI; внутристраничный API не поднимает HTTP/WebSocket сервер и не отправляет ассеты по сети.
- Строгие ошибки и журнал вызовов, объектные UUID, двоичные asset ID, атомарные транзакции с begin/commit/rollback и history.undo/redo.
- Натуральное сохранение и повторное открытие .markscene v3-preview, экспорт изменённого GLB, численное сравнение атрибутов и PNG/PBR.
- Код тестов: tests/pro-studio-ai-bridge.test.mjs и scripts/pro-studio-rig-accept.mjs.

Поддерживаемые названия команд:

    studio.getCapabilities
    studio.getVersion
    asset.upload
    asset.list
    scene.open
    scene.getHierarchy
    scene.getMaterials
    scene.validate
    scene.save
    scene.export
    object.setTransform
    material.setPbr
    animation.preview
    transaction.begin
    transaction.commit
    transaction.rollback
    history.undo
    history.redo

Дополнительно **только с подключённым настоящим viewport**: camera.set и render.capture.

Входные бинарные данные передаются как Uint8Array через in-process transport; это **не JSON HTTP wire contract**. Команда asset.upload принимает лишь байты GLB или .markscene, не URL. Любой неизвестный метод возвращает ok:false и код UNSUPPORTED_OPERATION. CLI не притворяется renderer: render.capture без WebGL корректно отвечает unsupported.

Пример запроса (в открытом браузере с разрешением на изменения):

    const api = window.MARK_AI_BRIDGE;
    const caps = await api.request({
      requestId: "client.discover.1",
      method: "studio.getCapabilities",
      params: {}
    });
    const tx = await api.request({
      requestId: "client.begin.1",
      method: "transaction.begin",
      params: {}
    });
    const edit = await api.request({
      requestId: "client.edit.1",
      method: "object.setTransform",
      params: {
        uuid: "gltf-node-1",
        transform: {translation: [0.25, 0, 0]}
      }
    });
    const committed = await api.request({
      requestId: "client.commit.1",
      method: "transaction.commit",
      params: {transactionId: tx.result.transactionId}
    });
    const png = await api.request({
      requestId: "client.capture.1",
      method: "render.capture",
      params: {view: "front", timeSeconds: 6}
    });

Результат содержит requestId, ok, sceneId, revision, appVersion, buildHash, diagnostics и result. Заданные в примере данные условны, а ответ PNG должен подтверждаться реальным CI-артефактом.

## 2. CLI и воспроизведение

    npm install --no-audit --no-fund
    npm run pro:rig:bridge

    # Пользовательский физический локальный файл:
    node scripts/pro-studio-ai-bridge-cli.mjs \
      --input path/to/character.glb \
      --out dist/pro-studio/my-bridge-qa

CLI записывает AI-Bridge-Edited.markscene, AI-Bridge-Edited.glb, ai-bridge-report.json. Сообщает renderer.status=unsupported (не выдумывает WebGL-снимков).

## 3. Новый независимый многомешевый тестовый GLB

- scripts/pro-studio-complex-rig-fixture.mjs создаёт настоящий glTF 2.0 без вызовов Blender, генерируя 12 отдельных mesh datablocks с skinning.
- 12 skinned meshes, 70 bones/inverse-bind matrices, по 2 morph targets на каждом меше, 3 клипа по 12 секунд, 4 PBR материала, реальная PNG 2×2 + UV.
- Образец **плоскостной сегментированный, не органический**; он НЕ является художественно принятым персонажем Neon Boy.
- scripts/pro-studio-complex-rig-accept.mjs проверяет оригинальный GLB в настоящем WebGL2: три клипа в 0 и 6 секунд, ракурсы, 10 подлинных PNG, правку через тот же AI Bridge, сохранение и обратный экспорт.
- Экспорт поддерживаемого профиля: 431 проверка семантических числовых данных, 0 несоответствий, PNG/PBR pass_supported_png, 7/7 реальных browser checks.
- CI продолжает проверять внешнюю, отдельно созданную 278-мешевую модель Neon Boy: 17 костей, 1 танцевальный клип, 0 морфов. Её нельзя выдавать за требуемые 70 костей/3 танца/face morph персонажа.

## 4. Проверенный результат

GitHub Actions run 44511280407, источник aa3188f1613a7ba9a812f3aa4b4969abcff37249: 60/60 Node tests, 23/23 browser rig checks, 7/7 complex rig browser checks, 7/7 external Neon Boy browser checks, отдельный headless CLI 13 команд — успех.

Артефакт mark-pro-rig-r1-real-webgl (ID 14523436159), содержит реальные изображения, видео, исходные и изменённые GLB, native .markscene, HTML и машинные отчёты.

## 5. Ограничения и DoD

- Нет сетевого API, подключения из другой системы, HTTP authentication/token scopes, команд длительных задач или cancellations.
- Нет полного editable Scene Core для вершин/рёбер/граней, UV/skin/weights, скульпта, IK и NLA. Поддерживаются только существующие Node TRS, PBR факторы и выбор готового клипа.
- Native формат остаётся mark.professional-scene/3-preview, не production v3.
- Нет лицензированного постоянного эталона художественно готового Neon Boy с 70 костями, тремя танцами, мимикой, foot-contact и утверждёнными ракурсами.
- Нет GPU-теста на физическом Huawei; Chromium SwiftShader не подтверждает производительность телефона.
- Нет независимого офлайн render backend и полного glTF набора JPEG/KTX2/проприетарных расширений.
- MARK Visual Engine v2, legacy robot scene и стабильный main не переписываются.

**Следующий проход №7:** повторная сверка с ТЗ; начало реального editable mesh core (vertex/edge/face + undo), защита суммарной памяти ассетов и проектирование безопасного транспортного слоя AI Bridge. Отдельно — постоянный человеческий 70-bone/3-clips/facial morph fixture с проверенной лицензией и независимой художественной приёмкой.
