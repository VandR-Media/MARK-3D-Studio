# MARK Professional Studio — Release 1 animated GLB transport preview

**Status: PARTIAL / EXPERIMENTAL. Not artistic acceptance.**  
**Owner specification:** `MARK_3D_STUDIO_FULL_BLENDER_REPLACEMENT_TZ.md`, sections 8, 9, 17, 25, 28 and 32.  
**Working branch:** `develop/pro-studio-release0-audit` (separate draft PR #16).  
**Compatibility:** existing Visual Engine v2 import guard unchanged.

## 1. What has actually been implemented

- `scripts/pro-studio-glb-fixtures.mjs` generates **real binary glTF 2.0** fixtures, with tightly packed bufferViews/accessors and a valid embedded PNG texture. The main asset contains 70 joint nodes with 70 inverse bind matrices, correct JOINTS_0 and WEIGHTS_0, 2 morph POSITION targets, UV/PBR material and 3 independently selectable animation clips (12 seconds each; rotation plus morph weight channels).
- `src/pro-studio/rigged-glb-audit.js` runs a strict headless semantic audit: buffer bounds, vertex/skin/morph attributes, weight sum, joint palette range, node cycles, invalid animations, embedded image sources and unsupported glTF extensions. Diagnostic errors have stable `code` values.
- `src/pro-studio/rigpack-preview.js` makes and reopens a minimal two-file **ZIP STORE** archive with `manifest.json` plus unmodified `assets/source.glb`, SHA-256 and CRC32 checks, bounded sizes and exact path checks. Archive extension: **`.markrigpack`**. It is explicitly **not** the production `.markscene` v3 format.
- `scripts/pro-studio-rig-roundtrip.mjs` runs headless source→pack→unpack→source-export and writes `qa-report.json` with separate `pass`, `skip` and `fail` statuses and hashes.
- `tests/pro-studio-release1.test.mjs` exercises rigged/static fixtures, malformed rig data, unsupported extensions, archive tampering, actual binary corruption of weights/joints/timestamps and the unchanged legacy v2 rejection policy.

## 2. How to reproduce locally

From the repository root (Node >=20):

```sh
node --test tests/pro-studio-release1.test.mjs
node scripts/pro-studio-glb-fixtures.mjs dist/pro-studio/fixtures
node scripts/pro-studio-rig-roundtrip.mjs dist/pro-studio/fixtures/rig70-morph2-clips3.glb dist/pro-studio/release1-preview
```

Output:

```text
dist/pro-studio/fixtures/rig70-morph2-clips3.glb
dist/pro-studio/fixtures/static-pbr.glb
dist/pro-studio/release1-preview/source-original.glb
dist/pro-studio/release1-preview/sample.markrigpack
dist/pro-studio/release1-preview/source-roundtrip.glb
dist/pro-studio/release1-preview/qa-report.json
```

**Local isolated execution (18 November 2026):** 10/10 Node tests passed; a separate trimesh parser could open both generated GLBs; the rigged file's SHA-256 is `6dc4767967de98079ba0b102e5ef13f8eb93e5902a508de87cc4de78b402608a`. This is not a GitHub Actions pass for a committed branch until a CI run is executed at its current HEAD.

## 3. Verified and not verified

| Feature | Current proof | Status |
|---|---|---|
| Binary glTF2 70 joints / 2 morphs / 3 clips | Actual accessor buffers, semantic inspection, independent glTF parsing | partial — fixture transport |
| 70 inverse bind matrices and vertex weights | All referenced accessors read, normals and weights checked | pass for fixture validation |
| `.markrigpack` pack/save/reopen/GLB extraction | Exact source SHA-256 preserved; CRC32 + size/path checks | pass (unmodified source bytes only) |
| Backward compatible v2 GLB guard | Static accepted, animated/rigged rejected without scene mutation | pass in test |
| Actual WebGL2 deformation and clip playback | No tested GLTFLoader/AnimationMixer viewport frames yet | **skip** |
| Modified rig → GLTFExporter → clean re-import | Not implemented | **skip** |
| Native editable `.markscene` v3 with rig state/weights/animation | Only experimental `.markrigpack` with original GLB | **skip** |
| Neon Boy actual owner reference matching | The rigged test fixture is a QUAD, not Neon Boy | **skip** |
| Real Huawei hardware test | No physical device test | **skip** |

The statuses are deliberate: **preserving the original animated GLB byte-for-byte is not equivalent to re-exporting a modified skinned model**. The visual/artist gate from the owner's specification remains open.

## 4. Design choices and security notes

- No automatic relaxation of `src/visual-engine/glb-guard.js`: existing Visual Engine v2 cannot safely re-export rig/morph/animation, so it must continue rejecting those assets.
- Unknown required or used extensions fail explicitly; no silent loss of Draco/meshopt or unsupported procedural glTF semantics.
- The portable pack uses ZIP STORE (no compression or decompression bombs), two exact filenames, CRC32, SHA-256, byte budgets and manifest validation. This **preview** format supports only one immutable GLB asset, not arbitrary project documents or asset library links.
- The fixture is deliberately a low-poly technical object. Artistic fidelity, realistic skinning deformation, FK/IK, sculpt, weight-painting, native `.markscene`, real motion video and hardware tests are independent higher-level gates.
- The tooling runs with Node built-in APIs; this first version is a **headless test subsystem**, not a browser production importer or shipping application.

## 5. Next pass

Implement a separate experimental GLTFLoader + Three.js animation viewer with a real WebGL2 clip selector and timeline; capture multiple real frames and verify that morph weights and bone transforms change on screen. Then test edited GLB re-export and a full v3 asset container. Do not ship/merge until successful clean import/export and approved Neon Boy art evidence.

