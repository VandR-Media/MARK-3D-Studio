# MARK 3D Studio — проход №30, инкремент: реальный экспорт Edge Split

Статус: **частично выполнено**. Основание — исходная структура Pass29, PR #39 SHA `4306105ca8c1e8f9ff925ca9c705a795ae8cff1e`, и план PR #40. Полный оригинальный файл `MARK_3D_STUDIO_FULL_BLENDER_REPLACEMENT_TZ(1).md` из прежней переписки не был доступен для повторного полного чтения в этом проходе; проверены Pass29-документация и реальные исходники в GitHub. Нельзя считать данный инкремент полной приёмкой требований ТЗ.

## Реализовано

- `owned-edge-split-plan.js`: детерминированный расчёт 1 → 2 треугольников для граничного ребра или 2 → 4 для общего ребра с двумя противоположными halfedge; сохраняются source-face provenance и corner interpolation.
- `owned-edge-split-glb.js`: реальная **одноразовая материализация в новом GLB**, добавляющая vertex rows и index accessor, с обновлением POSITION min/max, копированием всех vertex attribute streams и morph targets выбранного primitive. Source BIN содержится как точный байтовый префикс; чужие primitive, skins, animations, materials, PNG и scene nodes не переписываются.
- Float атрибуты линейно интерполируются, NORMAL/TANGENT нормализуются; skin weights интерполируются и нормализуются только для одинаковой последовательности joint IDs на обоих концах ребра. Неизвестные опасные форматы и разные palettes JOINTS приводят к явному отказу. Это **ограниченный профиль, а не поддержка любых glTF**.
- `tests/pro-studio-pass30-edge-split-glb.test.mjs`: настоящая GLB-топология, скелет (70 joints), 2 morphs, 3 clips, 2 UV sets, неизменность исходного файла и исходного BIN-префикса, fail-closed на несовместимой коже.
- Скрипт `scripts/pro-studio-pass30-export-qa.mjs` собирает проверяемые GLB source/result + SHA-256 отчёт для артефакта GitHub Actions.

## Пока не реализовано

**Нельзя считать это готовой операцией редактирования .markscene.** `MARKTOP1` и `MARKMDB1` по-прежнему привязаны к неизменяемой исходной сетке. Результат экспорта пока не проходит через canonical operation log, native ZIP persistence, AI Bridge, Undo/Redo, browser UI или WebGL2 acceptance. Не проведены аппаратные испытания на Huawei, Android/Kotlin APK не создан.

Следующий инкремент: ввести V2 topology resource с неизменяемым source SHA и replay physical split, корректно сохранить старые source face IDs и присвоить потомкам новые, обеспечить совместимость с UV corner COW и skin/morph, ввести авторизуемую команду Bridge и регрессии native open/reopen/history/Chromium. Не подменять рабочее ядро очередным JSON-only переключателем.
