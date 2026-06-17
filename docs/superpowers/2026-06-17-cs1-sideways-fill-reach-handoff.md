# Handoff — make voxel litho sections watertight across wide inter-investigation gaps (CS1 sideways-fill reach)

**Date:** 2026-06-17
**For:** a fresh session (this work was scoped + diagnosed but not implemented; the
diagnosis corrected itself several times, so read the "what we already learned"
section before touching code — do NOT re-derive from the original symptom).

---

## Goal (owner directive)

The 2D cross-section litho fill (sliced from the built **voxel** 3D model) must be
**watertight — no void space** across a section. Owner: *"the model is made to be
watertight, there shouldn't be any void space."* Specifically the **lateral
interior gaps between widely-spaced investigations** must fill (by extrapolation
within each geological band), so a section line that runs through a long span with
no borehole between two columns still shows continuous litho.

**Out of scope / deliberately KEEP as void** (do not "fill everything" — this is the
tension to respect): (a) ABOVE a borehole's own observed ground surface
(`obs_top`) — the owner's "don't fill what the borehole can't see" rule; (b)
genuine hull-edge no-data beyond the data footprint; (c) true geological band
PINCH-OUTS (a band that legitimately ends). The fill is about **lateral interior
continuity within geo bands**, not vertical/edge voids.

---

## What we ALREADY learned (do not repeat these detours)

The diagnosis flipped three times before landing. The settled facts:

1. **Two distinct symptoms were conflated.** (a) Vertical **striping / on-edge
   column drops** at a section that hugs the data-hull boundary — this was a
   **boundary-parity bug** and is **ALREADY FIXED** (see "Already shipped"
   below). (b) **Wide lateral interior gaps** between far-apart columns — this is
   the REMAINING work and the subject of this handoff.

2. **The footprint alpha factor is a DEAD lever — do not touch it.** With
   `test.strix`'s 58 widely-spaced investigations the median Delaunay edge is
   ~83 m, so `CONCAVE_HULL_ALPHA_FACTOR = 6.0` (`tin_surface_constants.py:73`)
   gives alpha ≈ 498 m → it already keeps every triangle → the footprint is
   effectively the **full convex hull**. Raising the alpha changes nothing. An
   early "widen the footprint" plan was abandoned for exactly this reason. (And a
   quick PostGIS check using the *all-investigations convex hull* was a RED
   HERRING — the real build footprint is the alpha-shape of the
   *litho-model-participating* columns; characterize THAT if you need the
   footprint, via `build_domain_from_sections` → `ModelDomain`.)

3. **The label grid is already watertight WHERE the labelling rule runs.** A
   census of 30,145 in-hull voxel columns found **zero** genuine mid-column holes
   (a `-1` run with fill above AND below). And the 2D slicer
   (`sectionFromSolids.ts` `sliceSolidsAtPlane`) is faithful on continuous input
   (no spurious gaps). So the remaining gaps are **genuine model void where the
   labelling rule produced no stack**, not a render or extraction bug.

4. **The remaining gaps are a sideways-fill REACH problem.** Concrete example on
   `test.strix` Cross-section 1 (900 m, start SW corner (88018.6,164330.1)):
   columns cluster near the section start — `GEO-22/115-S10` at along ~24 m, then
   `GEO-10/170-S6` / `171-B6` / `126-B4` clustered at ~97–102 m. The **~73 m span
   between S10 and that cluster has no investigation**, and the geo-band
   sideways-fill does not extrapolate litho across it → void → the gap the owner
   circled. (NB the boundary-parity fix only bridges ½ a voxel ≈ 1.4 m — it can't
   and shouldn't close a 73 m span; that's this work.)

---

## Already shipped (on `develop`, do NOT redo)

The **boundary-parity fix** — voxel grid-node footprint gate was parity-unstable
for nodes landing ON the hull boundary edge, dropping ~half the on-edge columns
to void even though the labeller had a full stack:
- `src/groundmodel/domain/services/model_domain.py` — `contains(x, y, tol=0.0)`
  gained a boundary tolerance (admits a point within `tol` of any ring edge).
- `src/groundmodel/domain/services/voxel_litho/label_voxels.py:1332` — the gate
  now passes `tol = 0.5 · h · √2` (cell half-diagonal).
- Validated: 263 false-dropped columns recovered (all had real labels),
  watertightness preserved. Commits: `2fd8b9f0`, `8813b8c0`, `23fd8951`,
  `848d7ea8`.

The owner then **manually rebuilt `test.strix`** and confirmed CS1 is *improved
but still has the wide lateral gaps* (this handoff's work).

---

## The actual work

**Lever:** extend the geo-band sideways-fill in
`src/groundmodel/domain/services/voxel_litho/label_voxels.py` to extrapolate a
band's litho across wide lateral inter-investigation gaps:
- `_stack_at_band` (~line 708) — assembles each band's stack by blending the
  nearest *reaching* sections.
- `_fill_band_voids` (~line 640) — fills band voids.
- `_section_stack_at` / `_project_to_section_fence` / the BEYOND-rule
  (`_stack_at` ~line 477, 809-814) — where a mid-gap (x,y) lands in a column-pair
  gap with no reaching stack and currently returns `[]`.

Find the exact branch where a band that *some* column carries is left whole-void
across a wide gap, and extend it to extrapolate from the nearest reaching section
(anywhere, not only the perpendicular-nearest two, which both pinch in a wide
gap). The watertightness invariant (per-body closed mesh, 0 flagged, 0 inter-body
overlap) MUST hold after the change.

**Open design decision (owner's geological call — confirm before/with implementation):**
the **maximum lateral extrapolation distance**. Filling a band across an
arbitrarily wide gap (e.g. 73 m, or the 172 m on another corridor) is a
truthfulness tradeoff — drawing litho with no borehole between. Options: (a)
uncapped (fill the whole convex footprint), (b) a configurable max-gap distance
(a Settings → Litho segmenter knob, default tuned on `test.strix`). The owner
leaned toward a **distance-capped** widen earlier (so a lone 500 m-distant
investigation doesn't drag fill across the basin) — confirm the cap value /
whether it's a setting.

---

## Validation (real data — this is non-negotiable; synthetic fixtures hid every
prior misdiagnosis)

- Dev DB `groundmodel` on **:5433** (dockerised `strix-db-1`). Project "test" =
  `019e932e-30bb-7967-8dee-e6a4f1b25378`. Litho model
  `019e934c-70fd-7d11-a44a-b2073f4063a2`, parent geo `019e932e…`.
- Reconstruct the build inputs like `BuildVoxelLithoModel` does, run `label_voxels`
  at COARSE spacing (5 m H / 2 m V) for fast iteration, and check the CS1 corridor
  `115-S10 (along ~24 m) → S6/B6/B4 cluster (~100 m)` FILLS after the change.
- Confirm watertightness: extract solids, assert 0 non-manifold / 0 inter-body
  overlap. Confirm the DELIBERATE voids (above-surface, hull-edge) are STILL void.
- Fidelity must not regress: `scripts/eval_strat_fidelity.py` /
  `scripts/diag_voxel_fidelity_categorize.py`.
- Final: a full production rebuild of `test.strix` (~350 s @ 2 m/0.5 m) so the
  owner can dogfeed CS1 visually. Persisting to the dev DB is fine when the dev
  app is closed.
- TDD: a unit test in `tests/unit/domain/services/voxel_litho/` with a wide-gap
  fixture that is void before / filled after, plus the watertightness assertions.
  Re-baseline `test_label_voxels_byte_identical_geo.py` only with an explicit
  documented reason if the change alters the snapshot.

## Method discipline (the meta-lesson from this thread)

- Trust the owner's intuition + verify directly against the REAL model — the
  decisive checks (label-grid census, slicer-on-continuous-input, run the real
  `label_voxels`) overturned two confident-but-wrong inferences from extracted
  solids / the wrong hull.
- Establish WHERE the void is (label grid vs extraction vs render) before
  proposing HOW to fix — see `[[feedback_no_guessing_instrument_first]]`,
  `[[feedback_trust_user_intuition]]`, `[[feedback_profile_before_optimizing]]`.
