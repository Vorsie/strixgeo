# Handoff — make the voxel litho cross-section fill watertight (CS1 gap)

**Date:** 2026-06-17 (revised — the lever changed; see "Diagnosis journey")
**Status:** ROOT CAUSE re-located to the **2D slicer** (`sectionFromSolids.ts`),
NOT the labeller. A fix is in progress; this doc is the record + the brief if it
needs a clean session.

---

## Goal (owner directive)

The 2D cross-section litho fill (sliced from the built **voxel** 3D model) must be
**watertight — no void space** across a section. The motivating case: `test.strix`
Cross-section 1 shows a gap across the ~73 m span between its first two columns
(`GEO-22/115-S10` and the `GEO-10/170-S6`/`171-B6`/`126-B4` cluster).

Deliberately KEEP as void (do NOT fill): above a borehole's observed surface
`obs_top`, genuine hull-edge no-data, true geological band pinch-outs.

---

## ⚠ Diagnosis journey — the lever moved THREE times; do not re-walk the dead ends

Real-data instrumentation overturned several confident inferences. The settled
state:

1. **Labeling bug / inside-hull void** — WRONG (sampled out-of-footprint points).
2. **"Widen the footprint" (raise alpha factor)** — DEAD LEVER. With ~58 widely-
   spaced investigations the footprint is already the full convex hull (median
   edge ~83 m → alpha ≈ 498 m keeps every triangle; `tin_surface_constants.py:73`).
   Do NOT touch the alpha factor.
3. **Boundary-parity gate** — REAL and **already FIXED** (see "Already shipped").
   This healed an edge-hugging section's on-edge column drops, but not the CS1
   wide-span gap.
4. **Sideways-fill REACH in `label_voxels`** — WRONG (this doc's original premise).
   Real-model instrumentation (model `019e934c…`, production 2 m/0.5 m spacing)
   shows the **label grid is watertight along CS1**: the ~73 m gap span is
   **59/61 voxels filled**, every geological band present at every fraction; the
   only voids are the deliberate out-of-hull edge. The **extracted body meshes
   also fully cover the span** (≥10 ray-crossings everywhere). CS1's columns are
   **collinear with the slice chord** (0.0 m deviation). So there is NO labeller
   void to fill, and it is not a chord-vs-fence mismatch.
5. **The 2D SLICER / fill rendering** — the ACTUAL cause. The void appears
   downstream of the (continuous) meshes, in how the section fill is sliced/drawn.

NB an earlier check "cleared" the slicer by testing it on TOY BOXES ("faithful on
continuous input"). The real voxel meshes are greedy-meshed multi-body solids —
the bug only manifests on those. Do not re-clear the slicer with toy inputs.

---

## Already shipped (on `develop`, do NOT redo)

**Boundary-parity fix** — the voxel grid-node footprint gate was parity-unstable
for nodes on the hull boundary edge, dropping ~half the on-edge columns to void
despite real labels. `ModelDomain.contains(x, y, tol=0.0)` gained a boundary
tolerance; `label_voxels.py:1332` passes `tol = 0.5·h·√2`. Validated: 263
false-dropped columns recovered, watertightness preserved. Commits `2fd8b9f0`,
`8813b8c0`, `23fd8951`, `848d7ea8`. The owner then rebuilt `test.strix` and
confirmed CS1 *improved but still has the wide-span gap* (this doc's remaining
work, now correctly located in the slicer).

---

## The actual work — fix the 2D slicer

**Lever:** `desktop/src/renderer/src/utils/sectionFromSolids.ts`, Mode B path:
- `sliceSolidsAtPlane` (~226-263) → `collectCutSegments` (~473-536) → `chainLoops`
  (~562-626): intersects each body mesh with the vertical section plane and chains
  cut segments into closed loops. A dropped/unclosed loop on a real multi-body
  greedy mesh → no `<path>` for that body in that region → the visible gap.
- Render: `components/sections/ModelFillOverlay.tsx` (Mode B ~171-206
  `buildPolyPath`); mode selected in `SectionPanel.tsx:2313`; Mode B is the
  default (`view_state.litho_segmenter.section_fill_at_section_line` defaults
  `true`, `utils/lithoSegmenterPrefs.ts:105`). Mode A = `sampleSolidColumns`
  (~103-141) ray-casts at test columns only.

**Method (mandatory — instrument before fixing):** load the REAL CS1 meshes from
the dev DB (`groundmodel` :5433, model `019e934c…`, table `litho_body_solid`:
`vertices`/`triangles` JSONB) and run the actual `sliceSolidsAtPlane` along CS1
(start (88018.6,164330.1) → end (88631.6,164989.7)). Identify WHICH body's loop is
dropped/broken across the ~73 m gap and the exact failing mechanism
(unclosed `chainLoops`, missed near-coplanar/degenerate plane-triangle
intersection, segment-merge tolerance, non-abutting per-body loops). Pin it with
evidence, then TDD the fix in `sectionFromSolids.ts` (a captured real problem-body
or a greedy-meshed synthetic that reproduces the same failure → red → green). Keep
the spacing-aware transform (`warpedXToScreen`) untouched — this is a slicer-
geometry fix. Re-run the real-mesh harness after the fix to confirm the CS1 gap
closes. Existing `sectionFromSolids`/`ModelFillOverlay` vitest stay green.

## Validation
- Real meshes via the dev DB (above). `npx tsc --noEmit -p tsconfig.web.json` +
  `npx vitest run` (from `desktop/`) green. Scratch harness deleted, not committed.
- The owner re-Builds / re-opens CS1 in-app to eyeball it continuous (and that
  sections 2/3, already good, are unaffected).

## Method discipline (the meta-lesson — this dogfeed flipped its diagnosis 4×)
Establish WHERE the void is (label grid vs extracted meshes vs slice/render) on the
REAL model/data before proposing HOW to fix — toy/synthetic inputs hid every prior
misdiagnosis, and a "decisive" check on the wrong artifact is worse than none.
See `[[feedback_no_guessing_instrument_first]]`, `[[feedback_trust_user_intuition]]`
(the owner's "isn't it just a rendering bug?" was right), `[[feedback_profile_before_optimizing]]`.
