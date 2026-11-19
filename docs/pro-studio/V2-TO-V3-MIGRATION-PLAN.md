# Visual Engine v2 → Professional Studio v3 — compatibility and migration contract

**Status:** proposed, not implemented. No new v3 schema/API claimed as available.  
**Specification:** owner RFC v1.0 §§4, 17, 19, 20, 25 and §28.  
**Legacy anchor:** `mark.visual-scene/2`, `mark.visual-recipe/2`.

## Non-lossy compatibility invariant

- Preserve the v2 parser, validator, existing recipe operations, entity IDs, hierarchy, named materials, quality setting, surface label anchor/offset, real stereo audio binding and static GLB embedded assets.
- New professional features must appear only under an explicit `schemaVersion=3` or `mark.visual-scene/3` contract after a published schema and migration suite exist.
- `v2 → v3` is **opt in**, deterministic and emits an ID correspondence table and asset manifest.
- `v3 → v2` is a **degrade/export** operation with a previewed, structured loss report; not a silent, reversible migration.
- Older tools that cannot understand a new mandatory feature must refuse writing and preserve original data.

## Mapping plan

| v2 concept | v3 concept (proposed) | Safety requirement |
|---|---|---|
| `id`, `name`, `parent` | stable `nodeUUID` and `displayName`, scene/collection hierarchy | preserve `legacyId` and parent mapping, detect cycles |
| `geometry:{type,...}` | parametric asset or decoded `MeshData` datablock | preserve parameters; do not flatten unless requested |
| `geometry:{type:"imported",asset,node}` | tracked external GLB asset reference + source graph pointer | immutable original bytes/hash; explicit detach/edit |
| `material` and `materials` | PBR material asset + slots/node graph | exact color space and texture sampler/UV/transform |
| `position/rotation/scale` | transforms with explicit units and up-axis | same local/world matrix within epsilon |
| `overlays[].anchor/offset` | surface label node linked to scene node | same actual 3D perspective behavior |
| `bindings[].signal/response` | typed stereo PCM graph node/legacy adapter | no invented live PCM or demo fallback |
| `animation.clips` | clips and keyframe channels (future bones, morphs) | existing transform tracks must remain playable |
| `environment`, `lights`, `camera`, `quality` | viewport/render settings and light/camera nodes | preserve v2 scene presentation on v2 backend |
| `attachments[]` base64 GLB | packed or linked binary asset with SHA-256 | no implicit network fetch; safe resource ownership |

## Proposed asset container

```text
project.markscene (ZIP-compatible or equivalent versioned container)
    manifest.json          # schemaVersion, appVersion, units, revision, UUID map
    scene/graph.json       # typed scene nodes, collections, relationships
    mesh/*.bin             # vertex indices, attributes, UV, weights
    rig/*.bin              # joints, inverse bind transforms
    animation/*.bin        # curve sampler tracks, morph and skeleton channels
    materials/*.json
    textures/*             # hashed embedded resources
    source/*.glb           # optional original source preserved
    metadata/licenses.json
```

This is an architectural layout **only**; not the existing on-disk v2 format. All checksums verified before committing project replacement.

## Migration algorithm / failure containment

1. Read input in read-only mode; identify exact v2 schema and verify all object/material/binding references and buffer limits.
2. Allocate stable v3 UUIDs deterministically from legacy IDs + input project hash, store a complete reverse mapping.
3. Copy hierarchy, primitive parameters, static GLB source bytes, PBR data, overlays, audio graph bindings, lights, camera, keyframes.
4. Serialize v3 assets to a temporary container, verify CRC/hash, re-open from scratch, compare all supported semantic fields.
5. Commit atomically only after re-open and validation succeed; retain original file and recovery snapshot.
6. For loss or unknown required extensions, return a structured report and leave the source unchanged.

## Baseline tests and data gaps

- Test legacy Analog Studio, Spectrum Matrix and owner v2 robot recipe at original IDs.
- Test v2 scene saved→opened→exported to static GLB; compare geometry, material connections, cameras and image pixels.
- Test real stereo LEFT LOW 120 Hz/RIGHT HIGH 6000 Hz and silence/pause semantics separately from demo.
- Test skinned 70-bone humanoid, face morphs and 3 clips as **v3 target**; current v2 import is intentionally rejected.
- Test malicious/malformed file, path traversal, zip bomb, unsupported `extensionsRequired`; no rollback should delete the current project.
- Create before/after reference renders for front/side/back/¾ at fixed camera/lighting/size, with source SHA.
- Preserve unknown optional manifest fields for roundtrip; explicitly reject unknown required semantics.

## Release gates

- Release 0: frozen v2 registry, verified fixture inventory and documentation; current-HEAD CI still required.
- Release 1: animated glTF supported-profile import/playback/native-save/export/import fidelity and real renderer evidence.
- Release 2: capability discovery, scene transaction commands and render captures from the same core.
- Release 3: edit mesh, rig/weights/UV/sculpt basics and direct artist workflow without Blender.

No step is considered complete because a JSON parser accepts the file. Each DoD requires actual render + save/reopen + semantic round-trip report and a build SHA.
