# MARK 3D Studio — MVP v0.1.0

Mobile-first **browser 3D GLB editor** for the future MARK Cosmic character in MARK Audio.

**Implemented:** import a self-contained glTF 2.0 `.glb`, display and orbit a real polygonal mesh with Three.js/WebGL2, edit existing metallic-roughness PBR materials, reset changes, export a modified GLB. The original binary geometry, UVs, textures, skins and animation data are retained byte-for-byte by rewriting **only the JSON chunk**. No server upload of personal model data.

The built-in demo is an original **organic polygonal test mesh (6,240 vertices, 12,480 triangles)**, not a recognizable MARK Cosmic character. Created locally from `src/sample.js`, not from circles/spheres.

## Start

Serve this directory over HTTP(S) (do not use file://):
```sh
python3 -m http.server 8080
```
Visit http://localhost:8080 on a WebGL2-capable browser; for a Huawei phone use a genuine HTTPS deployment.

The first load of `three@0.187.0` uses jsDelivr CDN and **needs network**. Rendering requires **WebGL2**. WebGPU is not assumed. No GMS or paid cloud services.

## Tests

```sh
npm test
npm run smoke:glb
```

The smoke command creates `samples/cosmic-test.glb` and an edited file in the same folder. GitHub Actions tests GLB parsing, PBR edits, binary-preserving export and uploads both GLB artifacts. Static GitHub Pages is **not enabled** here: private repository/Pages configuration must be verified.

## Scope / honesty

This prototype does **not** provide mesh sculpting, UV painting, a humanoid reference mesh, hair/clothes editing, rigging, skinning, animation editing, reference images or NPC choreography. It does not automatically generate MARK Cosmic from two-dimensional artwork. Browser rendering and touch control **still require verification on Huawei Pura 80 Ultra**.

Limitation: self-contained GLB only, max local import 80 MB. Draco, KTX2, Meshopt and advanced extensions may fail in Three.js preview; JSON factors can still be preserved in the binary export. Existing material factors are updated; no mesh topology changes. Edits to one shared material affect every mesh using it. Binary/geometry preservation is specific to JSON-only material edits and cannot be generalized to geometry editing.

## Branch policy

Work occurs in `develop/mvp-v0.1.0` and draft PRs. **Do not merge into main** until the user approves a ready MARK Cosmic model. The branch is not a release.

## Licenses

Code is MIT. Three.js is MIT (linked externally via jsDelivr, not redistributed). The generated polygonal GLB is original test geometry. No third-party humanoid models are bundled.

## Переносимый HTML-файл для Huawei

GitHub Actions также собирает `MARK-3D-Studio-standalone.html` и публикует его в артефакте `mark-3d-studio-standalone-preview`. HTML, CSS и собственный JavaScript редактора включены в один файл; **Three.js всё ещё требует подключения к jsDelivr**. Локальное открытие HTML из «Загрузок» зависит от браузера и пока не подтверждено на Pura 80 Ultra. Надёжный вариант — размещение на HTTPS-хостинге. Для локальной сборки выполните `npm run build:standalone`.
