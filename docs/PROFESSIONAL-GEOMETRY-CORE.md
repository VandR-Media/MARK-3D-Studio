# MARK Studio Professional — Geometry Core 0.1
**Development stage 1 only. Not a Blender replacement yet.**

Source branch: \`develop/professional-geometry-core\`. Related artwork PR #5 remains separate. Stable \`main\` is unchanged. Do not merge without consent.

## 1. Geometric architecture: internal topology, not GLB BIN edits

\`src/professional-geometry.js\` implements \`EditableMesh\`, a native in-memory edit graph:

- \`vertices: Map<stableId, {id,position,uv}>\`, \`faces: Map<stableId,{id,vertices,uv,material}>\`.
- \`edges\` have stable IDs, and \`halfEdges\` track \`from,to,face,next,prev,twin\`. Every structural edit rebuilds adjacency while retaining IDs for surviving edges.
- Indexed glTF triangles are imported into native polygons. Native quads and n-gons can exist as faces; deterministic ear clipping triangulates them only on GLB export. Invalid orientations, nonmanifold edges, degenerate triangles and unknown vertices are rejected.
- UV is stored **per polygon corner** in the internal project; textured GLB and skinned/morphed/shared mesh input are rejected rather than silently losing attributes.
- \`transact(label,fn)\` checks every structural change. Failure restores all vertices/faces/IDs/selections. Undo and Redo persist in native \`.mark3d\` when requested. A maximum of 12 snapshots currently prevents unbounded RAM growth.
- \`toProject()\` / \`fromProject()\` use experimental \`mark3d/0.1\` (JSON) retaining IDs, polygon topology, masks, selections and history. \`toGlb()\` creates real glTF 2.0 meshes with positions, normals, indices, UV and simple PBR. This source format is **not** a final standard; heavy assets may need binary storage/compression later.
- The canonical mesh is the editable native graph. The GLB is a flattened deliverable; IDs and undo are recovered from \`.mark3d\`, **not** from GLB.

The current renderer remains Three.js (MIT); command validation uses Ajv (MIT); CLI and tests run in Node.js; browser capture uses Playwright (Apache-2.0) with software WebGL2 in CI. No Blender, NVIDIA RTX or paid generation API is required.

## 2. Implemented arbitrary geometry and operations

Supported programmatic operations (implementation in \`src/professional-api.js\`):

| Operation | Expected parameters | Effect |
|---|---|---|
| \`mesh.create\` | \`{geometry:{positions,indices,uvs},name,material}\` | Creates arbitrary indexed polygonal source (current JSON import starts from triangles) |
| \`mesh.select\` | \`{ids:[...]} \` or \`{box:{min,max}}\` or \`{point:[x,y,z],radius}\` | Selects real editable vertices by ID or XYZ |
| \`mesh.edit\` | \`{delta:[dx,dy,dz],weight:1}\` | Translates selected vertices, actual geometry edit |
| \`mesh.subdivide\` | \`{faceId:"f200"}\` | Splits the chosen face into a fan of native faces |
| \`mesh.extrude\` | \`{faceId:"f200",distance:0.12}\` | Extrudes a single face with a cap and native quad sides |
| \`sculpt.brush\` | \`{center,radius,strength,mode,delta,symmetry,mask}\` | Localized spatial-hash weighted deformation |
| \`sculpt.mask\` | \`{name,ids,weight}\` | Named editable vertex mask |
| \`mesh.inspect\` | \`{}\` | Reports vertex/edge/face counts, degenerate polygons, nonmanifold and boundary edges |
| \`project.checkpoint\` | \`target:"label"\` | Captures intermediate GLB and editable \`.mark3d\` |
| \`project.undo\`, \`project.redo\` | \`{}\` | Undo or redo a real topology/sculpt transaction |
| \`project.export\` | \`{}\` | Validates for final GLB export |

Available brush modes in this prototype: Grab, Inflate, Clay, Smooth, Relax, Pinch, Flatten, Crease. Smooth uses 1-ring neighbor averages and normals are an approximate curvature direction. Falloff is smoothstep; spatial hash limits candidate vertices to the brush neighborhood. Symmetry mirrors brush centers and movement over X=0. Arbitrary vertex-selection and brush center/area are not tied to hard-coded nose/cheek sliders.

**Important unsupported cases:** bevel/loop cut/boolean/remesh/advanced retopology, arbitrary multi-material face assignment, image texture transfer, non-manifold modeling, full UV unwrapping, masks with feathered contours, sculpt pressure, advanced brush normals, multiresolution, robust collision / auto facial fitting. They are future operations and must fail explicitly today rather than reporting success.

## 3. Reproduce the head edit and verify real GLB

\`\`\`bash
npm install --no-audit --no-fund
npm run test:professional
npm run professional:build -- --recipe recipes/professional-face-sculpt.json
\`\`\`

\`recipes/professional-face-sculpt.json\` uses the existing continuous contour-head candidate **as a neutral test surface, not approved MARK Cosmic**. It selects an arbitrary eye region by coordinates, modifies its socket/upper eyelid, sculpts around the nose, cheeks and mouth, performs one local face subdivision, and generates saved checkpoint assets. No face slider API is used here.

Artifacts under \`dist/professional/professional-face-sculpt/\`:

- \`checkpoint-initial.glb\`: untouched starting continuous face.
- \`checkpoint-edited-face.glb\`: sculpted intermediate.
- \`professional-face-sculpt.glb\`: final binary model.
- \`professional-face-sculpt.mark3d\`: editable native project with undo/redo and stable vertex/face IDs.
- \`checkpoint-*.mark3d\`: editable checkpoints.
- \`recipe.json\`, \`report.json\`: exact commands, status/error, source SHA, binary GLB SHA-256, topology statistics, roundtrip results.
- \`renders/before/\` and \`renders/after/\`: actual WebGL2 Chromium screenshots at seven fixed views, plus per-run camera reports.

GitHub Actions \`professional-core.yml\` executes the real head fixture, legacy test suites, native tests, checks exact SHA between compiled HTML/GLB, loads actual GLB through Three.js and generates screenshots. Any failure marks CI red and no stable release is published.

## 4. What the other ChatGPT should do

1. Edit or copy the JSON recipe in \`recipes/\`, always within a development branch.
2. Commit changes (do not modify \`main\`) to trigger CI.
3. Inspect \`report.json\` and actual GLB/WebGL views before altering the next JSON.
4. Use \`mesh.select\` by XYZ or vertex IDs, followed by \`mesh.edit\` / \`sculpt.brush\` to correct any region, including unsupported predefined facial sliders.
5. Compare before/after GLB and screenshots and keep the better version with \`project.checkpoint\`.

Example:

\`\`\`json
{
  "schema": "mark-geometry/0.1",
  "project": {"id": "eye-adjust-test", "base": "contour-head-v1"},
  "commands": [
    {"operation":"project.checkpoint","target":"initial"},
    {"operation":"mesh.select","parameters":{"box":{
      "min":[0.18,0.39,0.58],"max":[0.55,0.60,1.03]}}},
    {"operation":"mesh.edit","parameters":{"delta":[0,0.02,0.01]}},
    {"operation":"sculpt.brush","parameters":{"mode":"grab",
      "center":[0.37,0.49,0.72],"radius":0.17,"strength":0.55,
      "symmetry":true,"delta":[0,0.02,0.03]}},
    {"operation":"project.checkpoint","target":"eye-corrected"}
  ]
}
\`\`\`

All distances in native glTF scene units; +Y is up, +Z points toward the face. There is no semantic guarantee that the selected region is a real human eyelid; the user/model agent must inspect the real render.

## 5. Roadmap to the requested feature coverage (questions 1–12)

1. **Kernel:** stable-ID Half-Edge + corner UV + transactions is implemented at stage-1 scope; versioned storage and performant incremental topology caches are next.
2. **Free modeling:** select arbitrary vertices by ID/box/radius; convert arbitrary meshes into editable native graph, then add multi-face operations, edge slide, knife and constrained loop-cut.
3. **Sculpt:** spatial selection and 8 fundamental local brushes exist; improve surface normals, stroke interpolation, masking, falloff pressure, adaptive mesh density and GPU worker offloading.
4. **ChatGPT vertex/surface edits:** data-only JSON commands are already in CI. Extend with curves, edge loops, individual face corner editing and persistent region names.
5. **Quality human base:** first build manifold facial topology with actual eye and mouth loops, orbital cavities, nostril holes, philtrum, ear attachments; this **is not ready** in current contour head.
6. **Retopology/QA:** incremental edge caches, intersection tests, edge flow analysis, constrained remesh/quad remesh, UV seam and normals tests; manifold check and simple per-face triangulation exist.
7. **Reference matching:** facial landmarks and multi-view calibrated camera alignment (front/profile/3⁄4), secure storage separate from public GitHub, projection and silhouette compare. Not implemented.
8. **Visual iteration:** use exact source/GLB hashes + original vs modified GLB + seven real screenshot pairs + editable checkpoints; future automatic landmark/silhouette metrics must never be substituted for approval.
9. **Open libraries:** Three.js/WebGL2 for preview, Ajv schema, Playwright Chromium for evidence, existing mesh helpers for import. Future options subject to license/performance verification include geometry BVH acceleration and a maintained UV/mesh optimization library. Do not build a new rasterizer.
10. **Huawei:** efficient read-only/low-poly editing is plausible; 25–50k triangles heavy topology/sculpt should run through free GitHub Actions. No device-measured FPS or thermals; touchscreen panels and offline storage need additional work.
11. **Working minimum:** compile programmatic eye/nose/mouth area changes on an authentic polygonal mesh, save editable \`.mark3d\`, generate real GLB, reload, and render actual before/after in Chromium CI.
12. **Blender-level direction:** geometry → sculpt/retopo → human topology → private reference matching → full body/materials → rigging/skinning/morphs → animation editor → final Android import, with tests and user approval at each stage. Many years of general-purpose Blender work cannot be equated with this first implementation.

**Acceptance disclaimer:** no professional face likeness, rigging, full feature parity or finished character is claimed. No personal photos are included in code/CI.
