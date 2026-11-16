# MARK Cosmic — independent practical feasibility test

**Purpose:** independently execute MARK Professional Geometry Core on a child-face candidate, export a real GLB, reload binary MARK3D, and compare actual WebGL images to the user-approved **private** concept in an external review.

## Scope of this experiment
- Uses the new face-oriented editable mesh (`character.createBaseMesh`), **not** the old v0.4 product character mesh.
- Edits upper eyelids, orbital contours, nose tip, cheeks, lips and chin through the actual JSON API, then tests a mild smile pose.
- Checkpoints before edits, after neutral edits, and after smile; each checkpoint has its own GLB and editable `.mark3d`.
- A dedicated GitHub Actions workflow generates two sets of real WebGL2 renders from exported GLBs (matching cameras) and uploads the results.
- Real photos and selected 2D artwork remain in the user's private conversation, **not** in the repo or in Action artifacts.

## Important limitations to verify
- The current `EditableMesh` is **one single editable mesh with one PBR material**. Its `fromGlb` imports one node/primitive at a time; it does **not** preserve the full multi-object source scene.
- The full earlier experimental Cosmic candidate already had 35 mesh parts (eyes, lids, eyebrows, cap, headphones...), whereas this workflow only builds one mesh with polygon subparts (skull, eyeballs).
- Hair, cap, headphones, torso, arms, fingers, hoodie, cargo pants, sneakers, skeleton, skin weights, facial blendshapes and animation are not produced by this recipe.
- No automatic/private-photo landmark fitting is executed. Success does **not** establish similarity to Mark.
- Neural or 2D image generation is not used as evidence for the GLB; all evidence must come from actual rendered GLB pixels.
- The mesh does not currently implement reliable facial animation, textured skin/hair or production retopology.

## Pass criteria (technical, not artistic)
1. Actions builds actual editable MARK3D and GLB without skipped commands or invalid geometry.
2. Neutral and smile GLBs differ meaningfully from the untouched basis.
3. Head GLBs load in Chromium WebGL2 and show actual nonempty geometry.
4. Checkpoints and source SHA can be traced to the run and repo.
5. Independent reviewer must inspect real renders and issue an explicit no-go/go for character-production readiness.

**Do not merge this feasibility branch into `main` or distribute this model as the approved MARK Cosmic.**
