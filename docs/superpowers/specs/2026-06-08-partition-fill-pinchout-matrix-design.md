# Partition fill — pinch-outs + geometric matrix inference — design

**Date:** 2026-06-08
**Status:** approved direction (owner 2026-06-08, via visual brainstorm); spec for review → plan → implement
**Surface:** `desktop/src/renderer/src/utils/partitionFill.ts` (geometry) + `components/sections/PartitionFillOverlay.tsx` (render). Fill-only.
**Origin:** dogfeed — between two tests, layers that aren't correlated render as a "droopy" meeting-fraction seam and uncorrelated bands look "open-ended", even though geologically the matrix (e.g. sand) should connect across with the minority lithologies pinching out.

---

## Problem

`computePartitionFill` aligns two adjacent column unit-stacks into a true partition (no gaps/overlaps — load-bearing because the 2D section defines the 3D model). It matches units across columns by **`body_id`** (LCS), and its enclosed-lens pre-pass also keys on `body_id`. A `body_id` is assigned only by an explicit **correlation** (connected components of approved edges).

Consequence: a lithology that fills an interval on both columns but was never correlated (its `body_id`s differ per column) **cannot connect** — it falls through to the interval "meeting-fraction" tiling, which splits the interval at a vertical seam and tiles unmatched units on each side. Visually that's the droop, and the matrix (sand) never becomes one body even though there's a test on both sides.

Owner-confirmed against the live `test2`-style section (S2 ↔ S1): all 69 approved edges are same-lithology and the bodies are clean single-lithology; the droop is purely that the **lower sand package was never correlated**, so the fill can't infer it's one body.

## The validated model (owner, 2026-06-08)

A body's geometry across a gap is decided by **how many of its two bounding contacts are correlated** across to the neighbour:

- **2 correlated → BAND** — clean quad (the matrix). *(Already works via the body_id LCS.)*
- **1 correlated → ONLAP** — pinches against the **non-correlated** edge, anchored on the correlated one. Direction follows which contact is correlated: **top correlated → base laps up to the top**; **base correlated → top laps down to the base**. Uses the existing halfway-lap (`INTERIOR_PINCH_FRACTION`).
- **0 correlated → LENS** — full pinch-out to a point (the existing enclosed-lens horizontal apex). A lens may be wide (have neighbours) but always has ≥1 non-correlated edge.

**Geometric-connectivity inference (the core change):** within an interval bracketed above and below by correlated contacts, the **matrix** connects across as one band, **inheriting the bracketing correlated contacts as its two correlated boundaries**, even with no explicit correlation, and then **floods every region not occupied by a pinch-out** → exact partition, no open space (owner: "one sand body, lenses float in it").

*Operational definition of "the matrix":* after the lithology-based lens extraction (change 1) merges each column's stack, the matrix of an interval is the lithology that remains **touching both bracketing contacts** on a column (the background the brackets bound). If a single lithology qualifies and it is **the same on both columns** → that's the matrix band. If the qualifying lithology **differs** per column → mismatched matrix (midpoint facies seam). A lithology touching only one bracket → onlap; touching neither → lens.

**Mismatched matrix (decision #3 = A):** if the interval's background lithology **differs** across columns (e.g. sand-left vs clay-right, no shared matrix), split at a **vertical midpoint seam** (50/50 — the honest "transition position unknown" representation; weighting/sloping would imply data we don't have). Render that seam as a **wriggly/wavy line** to signal a lateral facies change rather than a sharp correlated contact. This path is rare (users seldom correlate clay↔sand) and may evolve later.

## Approach — targeted changes to `computePartitionFill`

Framed as modifications to the existing pipeline (enclosed-lens pre-pass → LCS-by-`body_id` → interval grouping → meeting-fraction), not a rewrite:

1. **Generalise the enclosed-lens pre-pass from `body_id` to lithology.** Today it extracts a unit `U` only when the units above+below `U` share the same **`body_id`** and that body is on the other column. Relax the enclosing-matrix test to **same lithology** present on the other column (geometric connectivity). This pulls the silt/clay out as lenses and lets the sand matrix merge.

2. **Connect the post-extraction matrix as a band by lithology.** After lens extraction, if the interval's remaining background is the **same lithology** on both columns, treat it as a connected band spanning the interval (inheriting the bracketing correlated contacts), regardless of differing `body_id`. The matrix floods all non-pinch-out space.

3. **Onlap = pinch-out abutting exactly one bracket.** A pinch-out unit that touches one bracketing correlated contact and pinches on the other → halfway-lap anchored to that bracket, direction set by which bracket it touches (top→laps up, base→laps down). Fully-enclosed (touches neither) → full lens. Both already buildable from the existing pinch/halfway machinery.

4. **Mismatched matrix → midpoint facies seam.** When no shared matrix lithology exists, emit a single **vertical seam at fraction 0.5** (not the thickness-weighted `f`), and flag the seam so the overlay can draw it wriggly. Replaces the multi-trapezoid droop for this case.

Explicit correlations always win: the `body_id` LCS match (step 1) still runs first and locks real correlated bands; the geometric inference only fills the **uncorrelated remainder** within each interval.

## Rendering — `PartitionFillOverlay`

- Onlap wedges: anchor the flat edge on the correlated bracket, taper the non-correlated edge to the halfway tip (up or down per the bracket).
- Lenses: unchanged horizontal-apex pinch-out.
- **Facies seam (mismatched matrix):** draw the seam contact as a wavy path (a small sine/zig wiggle along the seam) instead of a straight line, to read as a lateral facies change. The region data carries a flag (e.g. `seamKind: 'facies'`) so the overlay knows.

## Scope (decision #4)

Fill-only. **No** resolver / `body_id` / `ResolveLithoInstances` change, **no** DB migration, **no** new correlation edges created. The partition fill is the source of truth for body shape (3D exporter ports it), so inferring matrix continuity *in the fill* is consistent and self-contained. Stored bodies/correlations are untouched.

## Non-goals

- True **interfingering tongues** (sand fingers laced into clay) — Phase 5.
- **Sloped / dominance-weighted** facies seams (options B/C) — deferred; midpoint-only now.
- Auto-creating correlation edges or `body_id`s from geometry — explicitly out (the inference is render-side only; correlation stays an explicit user/auto verb).
- Changing what auto-correlate pairs.

## Testing

`partitionFill.test.ts` (pure unit, no DB) drives this:

- **The S2↔S1 fixture** (the dogfeed case): upper sand band + bottom clay band correlated; the middle interval has S2 silt + sand and S1 clay/sand/silt/sand, none of the middle correlated. Assert: one sand band spans the interval; S2 silt = onlap against the top; S1 clay + silt = lenses; **`assertTiles` passes (no gaps/overlaps)**; to the right (single-column / no lenses) it's one sand body.
- **Taxonomy cases:** band (2 corr), onlap-top, onlap-base, lens (0 corr) — each asserts the right region kind + that the matrix floods the remainder.
- **Non-overlapping same-litho:** a silt high on the left and a silt low on the right (different positions) → two separate lenses, not one band.
- **Mismatched matrix:** sand-left vs clay-right → vertical midpoint seam, `seamKind='facies'` flagged, partition still tiles.
- **Regression:** existing partition-fill tests (matched bands, existing enclosed lenses) still pass — explicit correlations behave as before.

`assertTiles` (no gaps/overlaps) is the invariant guarding every case — it's what keeps the 2D→3D extrusion sound.
