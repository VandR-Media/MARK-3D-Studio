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
