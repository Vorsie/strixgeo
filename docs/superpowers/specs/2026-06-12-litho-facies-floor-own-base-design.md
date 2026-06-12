# Litho-3D facies competitors floor at their own base (overshoot fix)

- **Date:** 2026-06-12
- **Status:** design approved (owner), ready for a plan
- **Scope:** Issue A of the 2026-06-12 litho-builder handoff
  (`docs/superpowers/2026-06-12-litho-builder-overshoot-and-section-fill-handoff.md`).
  Issue B (section auto-fill toggle) is a separate spec.
- **Branch:** `fix-litho-3d-overshoot` (worktree, off `develop@6b9bbf9e`).

## Problem

In the 3-D lithostratigraphic model on `test.strix`, SILT / SAND / PEAT body
solids render **below the basal CLAY** — geometry present in neither the litho
columns nor the correlations. The builder invents it.

### Root cause (confirmed against the dev DB, read-only replay)

The overshoot is **100 % attributable to the facies-competitor build path**;
every other path (`shared`, `legacy`, `matrix-void`, `lens`) has **exactly 0 m**
overshoot. Measured per build path on the real model
(`019e934c-70fd-7d11-a44a-b2073f4063a2`), worst mesh-below-own-deepest-pick:

| path        | SILT | ZAND | KLEI | VEEN |
|-------------|-----:|-----:|-----:|-----:|
| **facies**  | 9.32 | 6.79 | 8.90 | 3.57 |
| shared      | 0.00 | 0.00 | 0.00 | 0.00 |
| legacy      | 0.00 | 0.00 | 0.00 | 0.00 |
| matrix-void | —    | 0.00 | 0.00 | —    |
| lens        | 0.00 | —    | —    | —    |

Per-lithology aggregate (the owner-visible symptom): SILT solid-min `-11.60` vs
deepest pick `-7.53`; ZAND `-9.00` vs `-7.64`; VEEN `0.73` vs `4.30`; KLEI
faithful (`-16.40` vs `-16.47`).

The mechanism is in `assemble_facies_competitors`
(`src/groundmodel/domain/services/litho_body_assembly.py`). For the **"below"**
side it fits **one shared `base_tin` over the bases of *all* competitors** of a
shared body (different lithologies, different depths), then samples every
competitor prism's floor (`base_field`) from that single TIN at the partition
vertices. At a facies boundary between a shallow competitor (e.g. silt, base
≈ -1) and a deep sibling (e.g. clay, base ≈ -16), the shallow competitor's
boundary vertices interpolate **down toward the deep sibling's base**; the
`_sample` nearest-hole fallback (nearest of *any* hole) compounds it for
partition vertices outside the trimmed hull. Result: the silt prism dips well
below silt's own deepest pick.

The **"above"** side does not overshoot: its floor is the shared body's *top*,
which by column contiguity equals each competitor's own base — a single
continuous correct surface. (Its *top* surface is blended across competitors,
i.e. "tops meet", which the owner confirmed earlier as intentional.)

## Goal

A facies-competitor body's mesh must be bounded by **its own** member picks: no
vertex deeper than the competitor's own deepest base. Keep the facies path's
watertight tiling; produce the real vertical step at facies boundaries.

## Design (approved — "own-base floor")

Localised change in `assemble_facies_competitors`, **"below" side only**.

### Floor each competitor at its own base surface

Replace the single shared `base_tin` + shared `base_field` with a **per-competitor
base surface**:

1. Group the shared body's "below"-competitor holes by competitor body id.
2. For each competitor, fit a base TIN over **that competitor's own holes'**
   `base_h` values (its own bases).
3. When building competitor `comp`'s region prism, sample `base_field` for that
   region's vertices from **`comp`'s own** base TIN, with a **nearest-own-hole**
   fallback (the nearest hole *belonging to `comp`*, not any hole) for vertices
   outside `comp`'s hull.

The **ceiling** (`top_field` for "below" = the shared body's base) stays a single
shared/continuous surface — unchanged and correct.

### Why watertight is preserved

`build_prism` already caps every boundary edge of each region with walls, so each
competitor prism is independently closed regardless of whether neighbouring
floors coincide. Competitor footprints are disjoint (the partition), so there is
no overlap. At a facies boundary the deeper sibling's wall is simply exposed
below the shallower competitor's base — the correct facies step. (Coincident wall
triangles on the shared upper strip remain a pre-existing z-fighting *watch-item*,
addressed separately via Cesium `polygonOffset` if it shimmers — not this fix.)

### Under-constrained competitor (< 3 own holes)

A competitor region inside a facies body may have only 1–2 holes (no TIN). Its
region vertices floor at its **nearest own hole's base** — a flat/own-base floor
that, by construction, never dips below the competitor's own deepest pick.

### Invariant guard (defense-in-depth)

After assembling each facies competitor prism, **clamp** any floor vertex still
below the competitor's own deepest base back up to it. This makes the invariant
hold even under degenerate TIN extrapolation. Pairs with a builder-level
regression test asserting the invariant for every body.

### Out of scope

- The "above" side (tops-meet) — unchanged per owner decision.
- The z-fighting watch-item at coincident facies walls (separate, render-state).
- Issue B (section auto-fill toggle) — separate spec.

## Components touched

- `src/groundmodel/domain/services/litho_body_assembly.py` —
  `assemble_facies_competitors` (per-competitor base surface + nearest-own-hole
  fallback + invariant clamp). The `_sample` helper is generalised or replaced so
  the fallback is competitor-scoped.
- No schema / API / ORM / Cesium change — `LithoBodyMesh` contract is unchanged,
  so `recompute_litho_solids` and the frontend are untouched.

## Testing (TDD, red first)

1. **New failing unit test** (`test_litho_body_assembly.py`): a shared body with
   two "below" competitors — shallow silt + deep clay — on a non-collinear hole
   set. Assert the silt prism's `min(z) ≥ silt's own deepest base − ε`. Confirm
   it **fails** on current code (the blend) before any fix.
2. **Builder-level invariant test** (`test_litho_solid_builder.py`): for a
   facies fixture, assert **every** returned body mesh satisfies
   `mesh_min_elev ≥ that body's own deepest pick − ε`.
3. **Update existing facies cases** whose *vertex coordinates* shift, keeping the
   *behavioural* assertions: watertight 2-manifold (`mesh_test_helpers`), no
   overlap, consistent winding. Comments phrased in geometry terms (e.g. "silt
   floor stays at the silt base"), not implementation variable names.
4. Keep `desktop/tests/e2e/flow_litho_facies.spec.ts` green; re-run
   `tests/benchmarks/bench_litho_solid_builder.py`.
5. **Final proof (manual, owner-gated):** re-run the read-only dev-DB diagnostic
   (solid-min vs deepest-pick per lithology) → expect ~0 overshoot on all
   lithologies; owner dogfeeds the 3-D Build on `test.strix`.

## Verification commands

```
uv run pytest tests/unit/domain/test_litho_body_assembly.py \
  tests/unit/domain/test_litho_solid_builder.py \
  tests/unit/domain/test_litho_facies_partition.py -q
uv run pytest tests/unit -q
# dev-DB diagnostic re-run (read-only) after the fix
```
