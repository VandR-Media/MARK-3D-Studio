# ADR-0001 — MARK Scene & Asset Core separated from render backends

**Status:** proposed for engineering review; no native core has been implemented.  
**Date:** 2026-11-18  
**Driver:** owner's Professional Studio RFC §3, §§4–5, §§8–9, §§19–20 and §28 Release 0.  
**Source baseline:** \`develop/visual-engine-v2\` @ \`e4a93262ecb44970a4bdb77a9735c95b4d46749b\`.

## Context and problem

Visual Engine v2 couples JSON scene data to a Three.js/WebGL2 preview. It correctly handles real parametric meshes and static PBR glTF while its import guard intentionally rejects skins, morphs and animation. Blender-class mesh editing, high-resolution sculpting, rig evaluation, path-traced rendering and physics cannot be implemented safely as incidental patches inside a single viewer loop.

## Decision proposed

Keep the already-working Visual Engine v2 intact behind an explicit **legacy adapter**. Develop v3 as distinct modules with versioned immutable-ish data and deterministic, transactional edits:

\`\`\`text
Desktop UI / Web UI / Huawei viewer / CLI / MARK AI Artist
                      |
             Authorised Command Bus
       capabilities / transactions / undo / audit
                      |
                 Scene Core v3
    node IDs / attributes / asset registry / revisions
         |              |             |
   Mesh/Topology    Rig/Animation   Material/UV
         +--------------+-------------+
                        |
             Dependency/Evaluation Graph
                        |
        +---------------+----------------+
  Interactive GPU    Offline Render    Simulation
  WebGL2 fallback    CPU/GPU paths     jobs/caches
  future WebGPU
                        |
    Import/Export profiles / glTF / native .markscene
                        |
                  v2 legacy adapter
\`\`\`

### Rules (non-negotiable)

1. Scene/asset model and command executor must run without DOM, Three.js or WebGL context.
2. \`id\`/UUID, object name and mesh datablock identity are distinct fields. An object may instance a mesh asset.
3. All writes use begin/validate/commit/rollback; undo/redo is defined at the data level; rendering is a derived side effect.
4. A native \`.markscene\` saves mesh buffers, UV, rig, animation, materials, scene hierarchy, provenance and dependency hashes. Avoid giant inlined base64.
5. Import/export reports semantic preservation and explicit unsupported data. Unknown optional fields are retained; unknown required semantics fail safely.
6. Heavy mesh/rig/bake/render operations are jobs, cancellable with resource budgets, never blocking the UI thread or overwriting the only copy of the user project.
7. Multiple render backends consume the **same evaluated scene**, not their own duplicate authoring schemas.
8. The v2 recipe runner and v2 editor retain their schemas/behavior, with opt-in conversion to v3 and clear downgrade loss reports.
9. Every AI SDK operation has a user-visible equivalent and the same permissions, safety checks, diagnostics and undo journal.

## Technology strategy

- **Phase 0:** continue shipping Three.js/WebGL2 for browser and Huawei compatibility, but treat it as a viewport renderer only.
- **Phase 1:** prototype a portable native/WASM mesh+rig evaluator with measurable asset and test compatibility. A Rust/C++/WASM selection is **not made in this ADR**; decide via benchmark (mesh edit/skin/morph and serialization), platform support, memory safety, build/maintenance cost and licence checks.
- **Phase 2:** investigate WebGPU/modern desktop GPU and CPU/GPU offline path tracer as separate backend work. No claim of working WebGPU or offline renderer until proven.
- **Phase 3:** add parallel desktop-specific simulation/UV/sculpt tooling behind the same asset API.

## Considered alternatives

- **Extend Three.js viewer as the entire editor:** fastest short-term, but entangles rig, sculpt, undo and future render, loses headless execution and shares GPU constraints with mobile browser. Rejected as end-state.
- **Make Blender a hidden mandatory backend:** shortcut to features, but contradicts user's requirement for self-contained MARK. External optional Blender interoperability remains permitted.
- **Introduce independent editors per UI:** causes schema divergence and lossy roundtrip. Rejected.

## Consequences / measurable follow-ups

- Additional adapters, asset migrations and test fixture maintenance, but deterministic headless editing and CI become possible.
- First vertical slice MUST import a skinned+morphed animated GLB, display an actual changing pose, save v3 native, reopen, export, reimport and compare semantic data.
- Release 2 AI Bridge depends on the core command bus, not browser automation scripts.
- Keep \`main\` and legacy Visual Engine v2 unaffected until owner approves separate integration.

## ADR acceptance

Approval requires a versioned interface contract, reference static and animated GLB fixtures, benchmark of one core implementation option, and reproducible tests. This document is a design decision proposal only.
