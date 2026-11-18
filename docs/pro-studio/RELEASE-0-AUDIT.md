# MARK 3D Studio — Release 0 / verified source audit

**Source audited:** `develop/visual-engine-v2` @ `e4a93262ecb44970a4bdb77a9735c95b4d46749b`  
**Specification:** `MARK_3D_STUDIO_FULL_BLENDER_REPLACEMENT_TZ.md` (owner, version 1.0, 2026-11-18), sections 0, 2–4, 17–20, 24–28, 32.  
**Status:** AS-IS source inspection, **not** proof of current-HEAD end-to-end QA, renderer, device performance or v3 implementation.  
**Scope:** Release 0 audit only. No changes to Visual Engine v2 sources, no merge into `main`.

## 1. What is present in source

| Area | Confirmed implementation | Exact source | Limitation |
|---|---|---|---|
| Editable v2 scene graph | `mark.visual-scene/2`, object tree, numeric transforms, materials, lights, overlays, audio bindings, keyframe clips | `src/visual-engine/scene-model.js`, v2 JSON schema | No arbitrary mesh vertex/UV/weight edit |
| Recipe runner | `mark.visual-recipe/2` with whitelisted scene commands; validation after each command | `src/visual-engine/scene-model.js`, recipe JSON schema | No general-purpose transaction/undo, v3 SDK |
| Geometry | group, box, bevel-box, cylinder, sphere, torus, needle, plane, tube, disk, imported static mesh | `src/visual-engine/visual-renderer.js` | No sculpt, editable polygon topology, curves, booleans |
| Static GLB | guarded static glTF2 multi-mesh import; no silent loss of unsupported rig/clip/morph | `src/visual-engine/glb-guard.js` | **Skins, animations and morph targets are rejected** |
| PBR / display | standard/physical/basic, embedded textures, transmission, key/fill/rim, WebGL2, orbit, bloom, IBL | renderer + UI | No offline path tracer or production color-management coverage |
| 3D text annotations | text rendered to depth-tested surfaces attached to anchors | `src/visual-engine/surface-labels.js`, renderer | Not arbitrary editable text curves or fonts |
| Music | decoded stereo PCM, rms/peak, L/R LOW/MID/HIGH, beat/bass, explicit demo | `src/visual-engine/audio-frame.js` + UI | No general v3 musical animation graph; native Huawei pipeline separately verified |
| Scene animation | transform keyframes and preview | `scene-model.js`, `visual-renderer.js` | No bone/key skinning, NLA, IK, blendshapes |
| QA | Node tests, GLB fidelity comparator and Chromium screenshot suite | tests + `scripts/visual-v2-accept.mjs` | No general headless `render.capture` command, not a Huawei GPU measurement |

**Dependencies read from `package.json`:** Three.js 0.187.0, Ajv 8.17.1, fflate 0.8.2; esbuild 0.28.2, Playwright 1.56.0, pngjs 7.0.0.

**Resource limits found in source:** scene objects ≤3500; PBR materials ≤128; scene keyframe clips ≤50; recipe steps ≤1000; GLB attachments ≤12; scene lights ≤12. The v3 goal is resource-aware budgets/streaming rather than blindly raising these limits.

**Explicit import gate:** `KHR_materials_transmission`, `KHR_materials_ior`, `KHR_materials_clearcoat`, `KHR_materials_volume`, `KHR_materials_emissive_strength`, `KHR_texture_transform`, `KHR_lights_punctual`, `KHR_materials_unlit`. This is only the extension allowlist, **not** a claim of full lossless support for every semantic detail of each extension.

## 2. Critical P0 blockers, in order

1. **GLB-RIG-001 — release 1:** supported glTF skinning/animations/morph targets must import, preview, save, export and re-import without semantic loss. Until then do not claim animated character support.
2. **SCENE-V3-001 — release 1:** versioned, binary-capable, atomically saved editable `.markscene`, preserving rig, clips, UV, materials and unknown optional properties; keep v2 reader intact.
3. **AI-BRIDGE-001 — release 2:** real command/transaction API and capabilities discovery; no fictional `mesh.*` endpoint in docs before it exists.
4. **MESH-EDIT-001 — release 3:** true vertex/edge/face edit, normals/UV and undo, not just object transforms.
5. **HUAWEI-QA-001:** actual device and browser/WebView test with measured source, build SHA and sample duration; SwiftShader is not Huawei FPS.
6. **ART-NEON-001:** compare real rendered frames of Neon Boy to owner references including rear and side; no claim of 100% reconstruction from limited images.

## 3. Baseline evidence and provenance

### Source-level coverage (audited revision)

`tests/visual-engine-v2.test.mjs` contains 18 source-level test declarations, including checks for deterministic scenes, isolated stereo PCM and static GLB rejection of incompatible animation. **Presence of tests ≠ results for the audited revision.**

### Historical M2 artifact inspection (NOT the current HEAD)

A separately supplied artifact set `MARK-M2-FINAL-96d0efd0` was inspected in an isolated container. Its `browser-report.json` indicates `sourceCommit=96d0efd0dde597a01c6f04fe64d53861818188b4`, 27 test records, Chromium WebGL2 status `pass`, and `deviceMeasured=false`. These are historical files, not a Release 0 GitHub Actions result and not proof of current revision.

| Historical file | SHA-256 | glTF inventory |
|---|---|---|
| Analog-Studio.glb | `47385ffb06fe72866a89baff69702076439ea1efd5d2252a2d764d0a3ba0d77a` | 152 meshes, 166 nodes, 62 materials, 0 skins / animations / morphs |
| Spectrum-Matrix.glb | `90a758da2420cbb57a3f342604b6d88013cb87c7a81845dc0804e4cc0d6d5d22` | 159 meshes, 171 nodes, 118 materials, 0 skins / animations / morphs |

Do **not** use those as proof that skeletal animation roundtrip works.

### Reproduction commands (when checkout + dependencies available)

```bash
npm install --no-audit --no-fund
npm run test:visual-v2
node --test tests/pro-studio-release0.test.mjs
npm run visual:v2:recipe -- --recipe recipes/visual-v2-analog-studio.json
npm run visual:v2:recipe -- --recipe recipes/visual-v2-spectrum-matrix.json
npm run visual:v2:build
npx playwright install --with-deps chromium
npm run visual:v2:accept
```

**No results are claimed until these commands run against one exact SHA** and their logs/artifacts are retained. Do not turn on push-triggered graphics workflows just to obtain a green badge.

## 4. Required fixture matrix for Release 1

| Fixture ID | glTF content | Expected behavior for Release 1 |
|---|---|---|
| `static-pbr` | Multi-mesh, two UV sets, normal/AO/textures/samplers | Material and semantic geometry fidelity |
| `animated-rig-70` | ~70-joint humanoid, 4 influences, 3 clips | Full import, playback, save, export, re-import |
| `morph-face` | At least five face blendshapes, animated morph weights | Shape and animation weights preserved |
| `rig-morph-combined` | Skin + morph + clip + metal/roughness + transparent submeshes | Full supported-profile fidelity |
| `unsupported-ext` | Unrecognized `extensionsRequired` | Explicit structured rejection with no scene mutation |
| `malformed-accessor` | Out-of-range bufferView/accessor, truncated BIN | Safe failure, no crash or partial commit |
| `v2-robot` | Owner's `03_ПРИМЕР_РОБОТ_С_НУЛЯ.markrecipe.json` | Deterministic load + GLB export unchanged |
| `stereo-120-6000` | L=120 Hz, R=6000 Hz decoded PCM | Independent six-band visual reaction; pause resets |

The owner’s approved Neon Boy images and reference GLB must be stored with provenance, rights and reproducible hashes before artistic signoff.

## 5. Release-0 deliverables and gates

- Machine-readable audit: [`release0-capabilities.json`](./release0-capabilities.json) validated by [its schema](../../schemas/mark-professional-capabilities-v1.schema.json).
- [Architecture decision](./ADR-0001-scene-core-and-backends.md) separating scene core from GPU backend.
- [v2 → v3 migration/compatibility contract](./V2-TO-V3-MIGRATION-PLAN.md).
- Regression test [`tests/pro-studio-release0.test.mjs`](../../tests/pro-studio-release0.test.mjs).
- No unsupported feature is marked `passed`.
- **Release 0 status: partial** until a current-SHA CI baseline and approved fixture hashes are collected.

Next: Release 1 independently test and implement animated GLB semantic fidelity. Do not start v3 end-user feature promises before that gate.
