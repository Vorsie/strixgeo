# Geology-bounded lens-in-lens litho builder — SHIPPED (owner dogfeed handoff)

**Date:** 2026-06-15
**Branch:** `feat-litho-3d-strat-field` (UNPUSHED, off `develop`, **NOT merged** — awaiting owner dogfeed + merge)
**Spec / plan:** `docs/superpowers/specs/2026-06-14-geology-bounded-lens-builder-design.md` · `docs/superpowers/plans/2026-06-14-geology-bounded-lens-builder.md`

## What this solves

The implicit stratigraphic 3D builder could not build the real `test.strix` model:
its 102-instance order had 2 localized SILT↔ZAND cycles (8/102 instances) → Stage 1
flagged everything, built 0 solids. The cycles are an **over-merge** (a recurring
KLEI/ZAND body wraps a SILT minority, `KLEI/SILT/KLEI` in one borehole), not true
interfingering. This work makes the model **build, watertight**, by lensing the
enclosed minorities out of the ordered backbone and bounding the result by geology.

## Result (real `test.strix`, dev DB :5433, model `019e934c…`, 2 m grid)

```
bodies_built = 1082   bodies_flagged = 0
columns_with_overlap = 0   max_overlap_m = 0.0
build wall-time @ 2 m ≈ 64 s   (geology-bounded; 4 geo bands)
```

Body count 664 (single field) → 1082 (per-band splits at the 4 geological
boundaries — expected and correct: a body no longer crosses a geo band).

## How it works (the 5 pieces + the geological frame)

1. **Enclosure classifier** (`lens_classification.classify_lenses`) — a body
   bracketed above-AND-below by the SAME body in a column is a LENS; recursive →
   lens-in-lens. Shared pure helper.
2. **Matrix-backbone order** (`build_stratigraphic_order(matrix_body_ids=…)`) —
   Stage 1 orders only the matrix bodies; lenses excluded → the 96-body backbone is
   a DAG.
3. **Lens carving** (`lens_carving.carve_lenses`) — the two-prism cavity:
   host-upper-plus-outer + host-lower (same body_id) straddle the lens prism →
   HOST/LENS/HOST, watertight, no CSG. Host picked bracket-first (correct for A/B/A).
4. **Monotone clamp** — `np.minimum.accumulate` on contact heights → watertight
   non-overlap is a construction theorem; also fixed the VEEN overshoot.
5. **Geological frame** (Tasks 6–8) — per-band field fit, `Block` caps bodies at the
   parent geo model's band surfaces (`SurfaceBound`), `build_strat_model_per_band`
   builds each band over the SAME shared grid and stitches watertight (adjacent
   bands share the SAME surface + grid → exact weld; a polygon-equality guard
   prevents the silent-seam-gap class that killed the loft). No parent geo model →
   single flat block (byte-identical to the pre-geo path).

## Performance (data-backed — see CLAUDE.local.md for the full table)

573 s (loft / ray-cast carve) → 180 s (carve reuses assembly height fields) → 84 s
(persist tuple→list drop + `_present_cells` numpy + `scipy.ndimage.label`) → **54 s**
(`_build_component_mesh` XOR-mask boundary) → ~64 s geology-bounded. A first
guess-based optimisation round moved the build ~0; cProfile
(`scripts/profile_strat_build.py`) then found the real hotspots — the
profile-before-optimizing rule, re-learned.

## Your dogfeed checklist

- Orbit the built model in the 3D viewer (it's in the dev DB now: 1082 solids,
  0 flagged). Confirm it looks like a coherent layered model.
- Slice a cross-section: confirm the 6 lenses sit INSIDE their KLEI/ZAND hosts
  (HOST/LENS/HOST), and no body crosses a geological band boundary.
- Rebuild any time: `uv run python scripts/eval_strat_builder.py` (safe; dev DB).

## Residual concerns (eyeball, not blockers)

- **coverage_gaps 10/58** — investigations at the hull edge get no body (pre-existing
  Stage-3 alpha-hull-edge limit, not introduced here).
- **snap-or-divide "snap" keeps the observed litho depth** (doesn't move it TO the
  geo surface) — a sub-tolerance fidelity tradeoff; the cross-band WELD is unaffected
  (it's the shared SurfaceBound cap, not the pick depth). Tell me if you want snap to
  align litho contacts exactly to the geo surface.
- **a per-band `NonConformableError` flags the WHOLE model**, not just the failing
  band (conservative; one catch site to change if you want partial builds).
- **persist ~37–46 s is JSONB DB I/O** — the remaining lever is a binary geometry
  column (a backwards-compat storage decision, deferred).

## Test coverage

Unit: 1363 passing (incl. lens classification, matrix order, the two-prism cavity +
A/B/A host resolution, the monotone clamp, surface caps + the watertight band stitch,
per-band lens carve, the polygon guard, and equivalence tests for every perf
optimisation). Integration `test_recompute_strat_solids.py`: the single-block path +
a geology-bounded 2-band case asserting no body crosses the band boundary + the
geo-surface checksum bust. Real-data eval above.
