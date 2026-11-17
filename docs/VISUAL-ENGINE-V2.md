# MARK Studio — Visual Engine v2 (P0 preview, **partial implementation**)

**Work branch:** \`develop/visual-engine-v2\`  
**Draft PR:** https://github.com/VandR-Media/MARK-3D-Studio/pull/13  
**Base:** \`develop/anatomical-face-refinement-v0.6.1\` including the separate PR #11 Stereo Visual design contract.  
**Privacy:** no child photos, no uploads of real music, no external textures or GMS services.

## 1. Current truth

This branch contains actual Three.js geometry and a reproducible JSON scene generator for **only two** of the six approved mode contracts:

- **Analog Studio:** two physical recessed meters, two 3D pivoted needles, dials/ticks, beveled anodized case, glass covers, steel screws, six mini-band meters with 48 independent physical LED segments. The two needles respond to left/right PCM RMS.
- **Spectrum Matrix:** physical dark metallic case, recessed stereo display, protective glass, six separately addressed frequency columns containing **108 physical LED meshes** (18 segments × 6 bands).

Both use **19 PBR material definitions**, independently editable transforms, a camera, key/fill/rim lighting, and separate 2D markup for crisp text/labels. All 3D geometry is generated at runtime and exported as actual glTF 2.0 binary GLB. No static render of a 3D instrument is substituted into the WebGL canvas.

The approved contract for Neon Towers, Hi-Fi Deck, Pulse Rings and Oscilloscope is retained but their real 3D implementations are **explicitly blocked**. Artistic sign-off for Analog Studio and Spectrum Matrix is a stop gate.

## 2. Core source files

| File | Purpose |
|---|---|
| \`src/visual-engine/scene-model.js\` | Validated editable \`mark.visual-scene/2\` with hierarchy, PBR library, lights, 2D annotation, audio binding; deterministic JSON command interpreter |
| \`src/visual-engine/instrument-factory.js\` | Real parametric meshes for two physical instruments |
| \`src/visual-engine/visual-renderer.js\` | Three.js/WebGL2/PBR/GLTFLoader/GLTFExporter, orbit/perspective, IBL, shadows, exposure, bloom, three quality profiles |
| \`src/visual-engine/audio-frame.js\` | Real decoded stereo PCM contract, FFT, six independent frequency bands, RMS/peak, two real waveform arrays, beat and bass estimates |
| \`src/visual-engine/glb-guard.js\` | Static self-contained GLB import guard to avoid silent animation/skinning/extension loss |
| \`src/visual-engine/ui.js\` | Touch-first preview, 3D object inspector, PBR/exposure/HDRI, loaded audio playback, explicit DEMO, editable .markscene and GLB import/export |
| \`visual-engine/Visual-Engine-v2.html\` | Browser app (development importmap) |
| \`scripts/build-visual-v2.mjs\` | Single-file offline HTML including Three.js, no CDN |
| \`scripts/visual-v2-build.mjs\` | Recipe → full editable .markscene JSON + machine report |
| \`scripts/visual-v2-accept.mjs\` | Genuine Chromium 3D screenshots, geometry, parallax, exported GLB and stereo WAV test |

## 3. Reproducible JSON model interface

Recipes: \`recipes/visual-v2-analog-studio.json\` and \`recipes/visual-v2-spectrum-matrix.json\`. Schema: \`schemas/mark-visual-recipe-v2.schema.json\`.

\`\`\`json
{
  "schema": "mark.visual-recipe/2",
  "id": "custom-analog-v2",
  "commands": [
    {"operation":"instrument.create","args":{
      "kind":"analog-studio","params":{"width":9.15,"height":5.2}
    }},
    {"operation":"object.transform","args":{
      "id":"case.main","rotation":[0,0.05,0]
    }},
    {"operation":"camera.set","args":{
      "position":[0,0,13.4],"target":[0,0,0],"fov":37
    }},
    {"operation":"quality.set","args":{"profile":"normal"}}
  ]
}
\`\`\`

Supported commands: \`instrument.create\`, \`object.add\`, \`object.transform\`, \`object.material\`, \`object.group\`, \`object.rename\`, \`object.remove\`, \`object.clone\`, \`material.set\`, \`camera.set\`, \`environment.set\`, \`lighting.set\`, \`overlay.add\`, \`signal.bind\`, \`quality.set\`.

All operations are whitelisted; invalid IDs, cycles, geometry values, dangling materials and invalid audio signal paths throw errors. No arbitrary JavaScript can run inside JSON recipes. A ChatGPT can adjust parameters/objects/materials and regenerate the same editable scene without mouse modeling.

Run:

\`\`\`bash
npm install --no-audit --no-fund
npm run test:visual-v2
npm run visual:v2:recipe -- --recipe recipes/visual-v2-analog-studio.json
npm run visual:v2:recipe -- --recipe recipes/visual-v2-spectrum-matrix.json
npm run build:standalone
npm run visual:v2:build
npx playwright install --with-deps chromium
npm run visual:v2:accept
\`\`\`

The output includes \`dist/MARK-Visual-Engine-v2.html\` (offline), \`dist/visual-v2/*.markscene\`, reports, exported GLBs and actual Chromium screenshots after successful browser testing. The HTML does not need the development importmap.

**Important:** This document does **not** claim those assets and screenshots exist at a successful GitHub Actions run unless the manual workflow actually completes.

## 4. Stereo audio contract

Schema: \`mark.audio.stereo/1\` (separate from \`mark.visual-scene/2\`).

\`\`\`json
{
  "schema":"mark.audio.stereo/1",
  "timestampMs":1000,
  "source":"pcm",
  "playing":true,
  "left":{"rms":0.5,"peak":0.7,"low":0.6,"mid":0.2,"high":0.1,"waveform":[]},
  "right":{"rms":0.4,"peak":0.6,"low":0.1,"mid":0.5,"high":0.3,"waveform":[]},
  "beat":0.2,
  "bass":0.35
}
\`\`\`

**The shown empty waveform arrays are abbreviated for documentation:** real frames must contain 128 actual PCM samples each in the range −1..1.

Bands: LOW 20–200 Hz, MID 200–2000 Hz, HIGH 2000–16000 Hz clipped to Nyquist. Left and right have independent rolling 2048-sample Hann FFT, RMS and peak. Mono uses the same true decoded PCM in both channels. Frequency magnitudes are normalized *visualization amplitudes*, not calibrated dBFS. The local-file preview uses Web Audio to play a decoded file directly and reads from that decoded PCM for graphics. It does **not** tap the MARK Audio/ExoPlayer stream. PCM FFT is not yet moved to a dedicated Android or browser worker.

\`DEMO\` is always explicitly labeled; a synthetic wave never masquerades as real PCM. Pause and silence generate zero frames for both channels. The acceptance test creates a real PCM16 WAV file with 120 Hz in LEFT and 6000 Hz in RIGHT, decodes it via Web Audio and verifies band independence.

## 5. Materials, environment, performance

- **PBR:** standard/physical metal, polymer, transmittance glass, emissive LED materials, typed data-URI Base Color/Normal/Metallic-Roughness/Emissive/AO maps. GLTFExporter exports supported PBR attributes. The UI includes numeric materials, metalness, roughness, transmission and local HDRI upload.
- **Lighting:** key, fill, rim; directional shadows where supported. Studio fallback environment uses the free Three.js RoomEnvironment IBL; **this is not a supplied HDRI**. User can load a local \`.hdr\` for an actual HDR map.
- **Postprocessing:** ACES tone mapping, exposure, bloom on NORMAL/HIGH, MSAA, physically shaded geometry. ECO uses lower pixel ratio/no bloom/no shadows. These are functional profiles, not device-benchmarked FPS.
- **Import:** self-contained static glTF 2.0 multi-mesh GLB with supported PBR materials/textures. Unknown required extensions, skins, morph targets and animation clips are rejected with an explicit reason. The original GLB bytes are embedded into \`.markscene\` to preserve the original import; exported static GLB is a normalized scene and is **not guaranteed byte-for-byte** identical for arbitrary materials/extensions.

## 6. Quality verification and explicit gaps

Manual GitHub Actions workflow: \`.github/workflows/visual-engine-v2.yml\`.

The workflow is **MANUAL-ONLY** (`workflow_dispatch`) to respect the request to disable automatic builds. **Important GitHub limitation:** the repository `main` branch currently has **no** `.github/workflows` files. GitHub requires a manual workflow to be registered on the default branch to expose its Run workflow button. Therefore this dev-only new workflow is not yet directly launchable from the GitHub Actions UI. We do NOT re-enable push/PR automation and do NOT modify `main` without approval. Once a minimal manual-only entry is separately approved on `main`, or another permitted execution environment is available, run acceptance on `develop/visual-engine-v2`. This would generate actual GLB/PNG/audio and ECO/NORMAL/HIGH reports. No successful browser CI results are claimed yet.

Still **not implemented or not verified**:

1. Production-quality visual equality to the six approved design images. Real comparison requires actual browser screenshots and human approval.
2. Real versions of Neon Towers, Hi-Fi Deck, Pulse Rings and Oscilloscope.
3. Full lossless PBR/texture/animation roundtrip of *arbitrary* GLB; complex imports are currently restricted.
4. Production Android PCM tap with a non-blocking worker, full audio buffering/seek integration and matching renderer inside MARK Audio.
5. Installed APK and real Huawei Pura 80 Ultra measurements: FPS, GPU, memory, power, thermal behavior and pause/rotation behavior.
6. UV unwrapping/painting, advanced shader node editor, skeletal animation, arbitrary 2D animation timeline and professional material authoring.
7. Detailed performance and artistic acceptance of Bloom, glass transmission, HDR reflections and six-channel stereo responsiveness on actual hardware.

**Acceptance status:** a staged source-code implementation / technical preview only, not a completed P0 project. Do not merge to \`main\` or ship an Android release before all acceptance gates pass.
