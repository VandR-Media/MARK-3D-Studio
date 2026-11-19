# MARK Professional Studio — проход №5: PNG/PBR fidelity + внешний Neon Boy

**ТЗ:** `MARK_3D_STUDIO_FULL_BLENDER_REPLACEMENT_TZ.md` от 18.11.2026,
разделы 7 (UV/PBR), 8–9 (скин/анимация), 17 (glTF round-trip), 25 (QA), 28 (Release 1), 32 (первый практический цикл).

**Статус:** частичная реализация поддерживаемого glTF-профиля.
Это **не** завершённый Release 1 и не замена Blender. Visual Engine v2/ `main` не менялись.

## Что добавлено на этом проходе

1. `src/pro-studio/glb-texture-qa.js`: независимо от WebGL декодирует встроенные и data-URI PNG в RGBA, сравнивает содержимое пикселей, выбираемые UV-set, `KHR_texture_transform`, фильтрацию `magFilter/minFilter`, `wrapS/T`, слоты стандартного PBR и поддерживаемых расширений.
2. Сравнение основано на фактическом **использовании текстуры материалом**, а не на индексе изображения или точных байтах PNG: Three.js может рекомпрессировать PNG при экспорте, оставляя картинку семантически неизменной.
3. `tests/pro-studio-texture-qa.test.mjs`: корректность PNG, допустимая перекомпрессия, настоящий изменённый RGBA-пиксель, испорченная текстура, UV-set, `KHR_texture_transform`, sampler и сохранение через собственный `.markscene`.
4. `scripts/pro-studio-rig-accept.mjs`: настоящие WebGL2/Three.js экспорт и `.markscene` export теперь должны иметь **дополнительные отдельные texture QA PASS**, включая численную проверку всех 4 пикселей исходной 2×2 PNG.
5. `scripts/pro-studio-external-neon-qa.mjs`: импорт и реальный WebGL2-render **более сложного скелетного GLB из другого процесса**, сохранение native `.markscene` с проверенным SHA, экспорт изменённого материала и реальные снимки/видео из текущего viewport MARK.

## Внешний Neon Boy: происхождение и строгие ограничения

Исходный актив `NEON_BOY_DANCE.glb` создан в **отдельной экспериментальной ветке этого же репозитория** (Blender Cloud pipeline; это не встроенная зависимость или редактор MARK).

- Источник: [GitHub Actions run 44398211839](https://github.com/VandR-Media/MARK-3D-Studio/actions/runs/44398211839),
  артефакт `MARK-Neon-Boy-Review` (краткосрочный артефакт, может истечь);
- GLB SHA-256: `195775972bbfa60db770fe57ad435b58325ac694f29898f1da9c2af5f79d255a`;
- Фактическое содержимое: **278 meshes, 296 nodes, 24 PBR materials, 1 skin / 17 joints, 1 animation / 52 channels, 0 morph targets, 0 textures**;
- `KHR_materials_emissive_strength` присутствует как используемое расширение;
- **Не соответствует DoD Neon Boy:** нет 70 костей, 3 клипов, facial morphs/weight-paint правок. Художественная приёмка заказчика отсутствует; это **стилизованная интерпретация**.
- Внешний glTF используется только для испытания импортера и рендера. Создание новых персонажей без обязательного Blender остаётся отдельным **не выполненным** требованием.

### Как запускается внешний тест

CI временно использует `gh run download 44398211839` и сверяет точный SHA-256.
Если старый артефакт истёк/недоступен, отчёт получает статус `skip`, **не** `pass`.
Для постоянного проекта понадобится долговременно хранимый эталон с подтверждённой лицензией/правом распространения.

```bash
# Временный внешний benchmark; НЕ требуется для автономного MARK:
gh run download 44398211839 \
  --repo VandR-Media/MARK-3D-Studio \
  --name MARK-Neon-Boy-Review --dir dist/pro-studio/external

MARK_EXTERNAL_GLB=dist/pro-studio/external/output/NEON_BOY_DANCE.glb \
  node scripts/pro-studio-external-neon-qa.mjs

# Основные regression без внешнего dependency:
node --test tests/pro-studio-texture-qa.test.mjs
npm run test:pro-rig
npm run pro:rig:viewer
npm run pro:rig:accept
```

## Что именно проверено, а что ещё НЕ покрыто

| Сценарий | Статус/проверка | Граница |
|---|---|---|
| PNG-декодирование и точный цвет пикселей | Новый строгий unit/browser QA | PNG RGBA в заявленном профиле, до 4096 px/сторона |
| PBR texture slot, sampler filters/wrap | Строгая нормализация по использованию материала | Не сравниваются произвольные неизвестные расширения |
| UV set и KHR_texture_transform | Нормализованное численное сравнение | Не выполняется raster-render baseline по всем UV островам |
| JPEG/KTX2/BasisU, HDR/EXR | **unverified/unsupported** | Никаких фальшивых PASS при отсутствии декодера |
| Внешний Neon Boy 278 meshes, 17 bones | WebGL2 + native round-trip в отдельном QA | Не production humanoid и нет морфов |
| Импорт меняемых GLB после `.markscene` | Сохранность оригинального BIN и TRS/PBR subset | Не редактируется vertex/edge/face/skin/weights |
| Кадры/видео | Реальный MARK WebGL2/SwiftShader | Не физическая GPU-проверка Huawei |
| Производственный glTF fidelity profile | **partial** | Полный профиль текстур JPEG/KTX2, UV bake, geometry authoring, 70-bone dance human ещё впереди |

## DoD / решение о приемке прохода

Отдельно фиксируются: `pass`, `fail`, `skip`, SHA источника, SHA коммита,
настоящие PNG/WebM и `numericDiagnostics`.
Наличие экспортированного GLB, 17 костей и красивого предварительного PNG
**не равно** художественному одобрению и функциональной независимости от Blender.

**Следующий проход №6** по повторной сверке с ТЗ: постоянный эталон 70-bone +
3 clips + facial morphs, импорт/экспорт многомешевого персонажа, развитие
транзакционного Scene Core / SDK и глубоких материальных профилей JPEG/KTX2.
`main` и draft PR #13 не изменять.
