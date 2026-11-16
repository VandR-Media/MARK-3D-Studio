# QA v0.1.0 — 2026-11-16

- Node test suite: parses an actual 12,480-triangle GLB, changes metallic-roughness PBR values, checks sRGB-to-linear conversion, verifies JSON metadata and binary geometry data are preserved, rejects corrupt headers and external sidecar files.
- Node smoke script produces original and edited GLB files.
- GitHub Actions workflow includes syntax check, tests and two generated GLB artifacts.
- To verify on Huawei: open deployed HTTPS site; tap demo; orbit and zoom; change material; export; reimport exported GLB; test switching away and back.
- Huawei WebGL2 performance, file downloads and GLTFLoader+CDN loading are **not yet certified**.
- Not a humanoid mesh or modeling/rigging/animation system.

- Portable HTML is generated from exactly the checked-in sources and uploaded as a separate GitHub Actions artifact. Phone-side opening is still unverified.

## v0.1.2 offline packaging

- Diagnosed: previous standalone depended on external jsDelivr modules, consistent with unresponsive demo button on Huawei.
- Switched to pinned Three.js + esbuild, generating all-in-one classic-script HTML with no external JS imports.
- Added startup-error banner and offline HTML structural test.
- Huawei touch/WebGL2 test remains pending. Browser may block locally opened HTML; no claim of verified device compatibility.

- A Chromium syntax smoke exposed malformed bundle text caused by JavaScript String.replace interpreting `$&` within minified code. Replaced generated string substitution with function replacement; new test compiles both inline JavaScript scripts via Node vm.Script.

## Mesh Editor v0.2 experimental QA

- Added `tests/mesh.test.mjs` covering actual BIN vertex move/roundtrip, sculpt brushes, symmetry, Undo/Redo, UV/material/index preservation, normal sanity, repeated export, skinning/morph/shared/compressed guards, spatial hash, closed 2-manifold fixture.
- Organic practice head: 118 rings x 160 segments + two poles; 37,760 indexed triangles; planar UV, closed mesh, not MARK Cosmic.
- Binary export of edited positions/normals verified using Node and independently validated with Python `trimesh` when GLBs are available.
- HTML bundled offline via esbuild; mobile runtime and WebGL screenshot acceptance in separate CI workflow.
- Huawei compatibility, gesture behavior, performance, long sessions and IndexedDB quota remain to be verified on physical device.
