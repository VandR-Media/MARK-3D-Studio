# MARK Studio Professional — Stage 2 Technical Preview

**Status: PARTIAL. This is not a final MARK Cosmic, a finished anatomical head, or Blender parity.**

Source branch: \`develop/compact-anatomical-core-v0.6\`; draft PR #7 against the accepted stage-1 \`develop/professional-geometry-core\`. Never merge to \`main\` or PR #5 without user approval.

## Binary project format

Source \`src/compact-project.js\`; open/save from Node or browser:

\`\`\`js
import {encodeMark3d,decodeMark3d,migrateLegacyProject} from './src/compact-project.js';
const bytes=encodeMark3d(editableMesh,{includeUndo:true});
const restored=decodeMark3d(bytes).mesh;
// Read legacy JSON project v0.1 and write binary v2:
const converted=migrateLegacyProject(legacyJsonText);
\`\`\`

- Magic ASCII \`MARK3D02\`, 24-byte LE header: version, gzip flag, compressed/raw length, CRC32 of uncompressed bytes.
- Uncompressed payload contains UTF-8 metadata JSON with typed-array offsets followed by binary arrays: \`vertexIds\` U32, \`xyz\` F64, \`vertexUV\` F64, \`faceIds\` U32, \`faceMaterial\` U32, \`faceOffsets\` U32, \`corners\` U32, \`cornerUV\` F64, stable edge-ID mapping and selected vertex indices.
- Other metadata: material, named anatomical vertex-ID rim regions, linked landmarks, reference calibration points, sparse masks, versioned counters, Undo/Redo and warnings. Half-edges rebuilt from native polygon loops on load.
- Every \`sculpt.brush\` and \`mesh.move\` saves an exact FLOAT64 ID+before+after delta; topology-edit history currently stores a full snapshot and can still be expensive. One brush call is one undo step; GUI supports one tap = one brush call. True continuous brush-stroke aggregation remains unimplemented.
- \`structuredClone\` preserves negative zero and exact FLOAT64 values through binary reload. Binary project restored GLB should be byte-identical.
- Old \`mark3d/0.1\` JSON projects load via \`decodeMark3d\`, including available history and masks. The original old JSON cannot recover signed negative zeros that were already lost when legacy JSON was originally created.
- Single editable mesh, one PBR material; no image texture transfer, skinned mesh/morph-target import, robust boolean/collapse or project-level multi-object scene yet.

## Measured storage performance — GitHub Actions Linux/Node 22, NOT Huawei

10 localized strokes per mesh:

| Triangles | Binary on disk | Avg brush time | Save | Reload | Process RSS after second mesh load |
|---:|---:|---:|---:|---:|---:|
| 25,088 | 0.504 MiB | 13.6 ms | 414 ms | 732 ms | 249.4 MiB |
| 49,928 | 0.976 MiB | 20.54 ms | 632 ms | 1429 ms | 504.0 MiB |
| 100,352 | 2.006 MiB | 43.52 ms | 1277 ms | 3092 ms | 890.2 MiB |

The disk-size target (50k triangles <15 MiB) is achieved for synthetic grids, but **RAM use remains high** and may prevent sustained 100k-triangle editing on Huawei. The persistent Half-Edge graph, undo, temporary full-mesh export and duplicate parser state need optimization and memory instrumentation on the actual phone.

Run:
\`\`\`bash
npm install --no-audit --no-fund
npm run test:compact
node --test tests/anatomical-stage2.test.mjs
node --expose-gc scripts/benchmark-compact.mjs
npm run professional:build -- --recipe recipes/anatomical-head-stage2-demo.json
\`\`\`

## Anatomical test prototype, not approved likeness

\`src/anatomical-base.js\` independently builds a profile-driven QUAD child-head shell with deep geometrical orbital (2), oral (1), and nostril (2) cavities, ordered inside polygon loops, original UV and stable IDs, and named landmark vertices. It does not inherit from the old \`contour-head-v1\` fixture.

Current engineering caveats: mouth and nostril bottoms are closed surfaces, not real openable anatomical cavities; eye globes and eyelids are not yet animation-ready; ears only have a broad attachment bulge, without modeled helix/concha/lobule; polygon face flow and silhouette still require independent artistic review. **The head must not be accepted as professional until those are solved.** No photos or artwork are included in source or builds.

To generate and deform the head:
\`\`\`json
{
  "schema":"mark-geometry/0.1",
  "project":{"id":"anatomical-test","base":"empty"},
  "commands":[
    {"operation":"character.createBaseMesh","parameters":{"type":"stylized-child-head"}},
    {"operation":"project.checkpoint","target":"before"},
    {"operation":"mesh.selectLoop","parameters":{"region":"eye_left_rim"}},
    {"operation":"sculpt.contour","parameters":{"region":"eye_left_rim","delta":[0,0.008,-0.01],"weight":0.35}},
    {"operation":"face.adjustLandmarks","parameters":{"name":"nose_tip","delta":[0,0,0.012],"radius":0.15,"strength":0.4}},
    {"operation":"project.checkpoint","target":"after"}
  ]
}
\`\`\`

\`src/professional-api.js\` provides the same \`EditableMesh\` methods as the new browser touch UI. The legacy GLB/Mesh Edit tools are kept for compatibility, but their modifications are not yet unified in a complete non-destructive project scene stack.

## Reference control points — privacy

\`src/reference-modeling.js\` accepts manually calibrated normalized 2D landmark coordinates without image files, maps anatomical anchors to orthographic front/side/three-quarter views, reports RMSE and per-landmark residuals, then can move the affected true geometry with a localized brush. API: \`reference.landmarks\`, \`reference.compare\`, \`face.adjustToReference\`.

This is **not** automatic facial landmark detection or complete calibrated photo fitting. Approved images and the child's original photos stay out of public GitHub and CI. The available evaluation uses synthetic landmark targets, not claims of facial resemblance.

## Browser, CI, real GLBs and evidence

- The offline HTML bundles the native model and compress/decompress code without CDN. A new touch panel provides create head, load/save compact \`.mark3d\`, labeled contour selection, brush strength/radius, undo/redo, GLB and local IndexedDB backup/recovery. Its numerical parameters call the identical EditableMesh implementation as the JSON API.
- Test \`scripts/accept-stage2.mjs\` performs actual mobile-width Chromium/WebGL2 click-through, changes geometry, saves and reimports binary and GLB, checks bytewise re-export and captures real screen PNGs.
- \`.github/workflows/professional-stage2.yml\` includes binary migration integrity and size, legacy tests, anatomy, reference comparisons, 25k–100k benchmarks and true GLB front/side/back/three-quarter/eye/nose/mouth/wireframe renders.
- \`dist/professional/anatomical-head-stage2-demo/\` contains GLB before/after, compact \`.mark3d\`, JSON recipe and diagnostics. \`dist/stage2-evidence/\` holds real screenshots. All files must refer to the exact same green workflow source SHA.

## Remaining Stage 2 acceptance gaps

Full anatomically convincing eye/eyelid loops, naturally attached and detailed ears, lips/mouth with opening topology, real nostril passages, robust edge split/collapse/flip, multires sculpt, stroke grouping, robust camera/image calibration, automatic silhouette matching, browser UI support for all older scene operations, tight RAM budget on Huawei and real device FPS/battery measurements.

**Do not merge to stable main or integrate this test head into MARK Audio.**
