# Geotech R1 — gap-free band/onlap/lens via per-region `computeSectionFill` — Plan

**Date:** 2026-06-26 (overnight prep — awaiting owner approval before implementation)
**Status:** scoping. Working tree is currently **gap-free on R0** (R1 disabled at
`SectionPanel.tsx` `geotechEdges={undefined}`, commit on develop). This plan
rebuilds R1 correctly.
**Supersedes:** the hand-rolled R1 in `geotechSubdivide.ts::subdivideRegionR1`
(kept dormant; will be replaced).

## Why the first R1 failed (root cause — confirmed by reading the code)

`subdivideRegionR1` emitted a pinching sub-band (onlap count 1 / lens count 0) as
a **triangle overlay only**, with nothing filling the rest of that depth slice of
the litho region. Litho's `computeSectionFill` never leaks because a lens is
carved out of a **matrix band that still fills** underneath — the geotech
hand-roll had no matrix. Result: every onlap/lens punched a hole → the
gaps the owner saw (dogfeed 2026-06-25). **R1-as-built is not a partition.**

The three dogfeed symptoms were all the same root cause (R1 then disabled):
1. lenses/onlaps don't recompute on each correlation,
2. the extrapolate-left / pinch-right **lens-in-lens** doesn't form,
3. ghost contacts appear on the borehole but the colour above doesn't change
   (the recompute that would repaint the borehole columns is the disabled R1).

## The insight that makes the correct version simple

The owner's workflow — "keep the least-dense over the more-dense, extrapolate the
left test, pinch out the right CPT → lens-in-lens" — is exactly what
`computeSectionFill` already does for litho. The only reason the plan originally
said "R1 not R2 (don't run `computeSectionFill` on geotech sub-bands)" was the
**187-singleton trap**, and that trap is a **whole-section** artifact: a loose
sand in region A never bands to a dense sand in region B, so model-wide every
class fragments.

**Bounded to ONE litho region it does not apply**, because within a single litho
region the packing classes *recur*: a loose-sand lens sits between dense sand
above and dense sand below — both the **same** NAD formation — so
`computeSectionFill`'s same-formation matrix-merge treats the loose sand as a
proper enclosed lens and the dense sand fills the pinch. Gap-free by
construction, identical to the litho lens model.

So R1 = **per litho region, run `computeSectionFill` on that region's two geotech
sub-band columns, with the geotech packing edges**, then map the result back into
the region's coordinate space. No hand-rolled geometry, no holes.

## Design

Rewrite `subdivideRegionsByGeotech`'s R1 branch (the `r1Active && isQuad` path) to:

1. **Build two `PartitionColumn`s from the region's clamped sub-band stacks.**
   `columnSubBands` already clamps + snaps the geotech NAD sub-layers to tile the
   region's depth on each column (first top = region top, last base = region
   base). Wrap each as:
   ```
   { investigationId: left.investigationId, surfaceElevM: left.surfaceElevM,
     units: leftBands.map(b => ({ topDepthM, baseDepthM, formationId, layerId, bodyId })) }
   ```
   (`PartitionUnit` needs `topDepthM/baseDepthM/formationId` + optional
   `layerId/bodyId` — all already on `ColumnSubBand`.)

2. **Call `computeSectionFill([leftGeoCol, rightGeoCol], geotechEdges, new Map(), [0, gapWidth])`.**
   Two columns = one gap (`gapIndex` 0). The geotech `CorrelationEdge[]` (keyed by
   geotech `layerId`) drives band/onlap/lens via the same `classifyTermination`
   the litho engine uses — a sub-band BANDS when both bounding contacts are tied,
   ONLAPS at 1, LENSES at 0, and the matrix fills the remainder. Use the litho
   engine's own onlap/lens geometry — do NOT re-derive it.
   - `apexOverrides`: empty `Map` for v1 (no freedraw on geotech sub-lenses yet).
   - `alongM`: `[0, 1]` (or the real along positions of the two columns) — only
     affects pinch fractions, not topology.

3. **Map the returned `PartitionRegion`s back into the parent region's space.**
   `computeSectionFill` returns `fraction ∈ [0,1]` (0 = left col, 1 = right col)
   and absolute `elevation`. Remap each polygon point:
   `fraction → leftFrac + fraction * (rightFrac - leftFrac)`; `elevation` is
   already absolute mTAW — keep it. Preserve `kind` (`quad`/`lens`),
   `overlayTier`, and set `formationId` to the NAD-class id the sub-band carries.
   Inherit the parent region's `gapIndex` + `bodyId` for identity.

4. **Clipping — contained by the existing `isQuad` gate.** R1 runs ONLY on a
   simple 4-vertex quad region (`region.kind === 'quad' && polygon.length === 4`).
   For a simple quad the parent is a rectangle `[leftFrac,rightFrac] × [top,base]`
   and the sub-band stacks tile its depth exactly (the `columnSubBands` snap), so
   the remapped sub-regions fit inside the parent with **no clipping needed**.
   Non-quad / clipped / pinch parent regions keep the R0 fallback (dominant-NAD
   recolour) — same as today. (Nested geotech-lens-inside-a-litho-pinch is a
   follow-up, not v1.)

5. **Re-enable the wiring**: revert `SectionPanel.tsx` to
   `geotechEdges={axisMode === 'geotechnical' ? geotechCorrelationEdges : undefined}`.

### What gets deleted / kept
- DELETE the hand-rolled `subdivideRegionR1` + its private helpers
  (`subBandCorrelationCount`, `buildGeotechCorrelated`, the framing logic) — the
  litho engine replaces all of it.
- KEEP `columnSubBands`, `dominantNad`, `bandEdges`, the R0 path, the soil-match
  filter, and the `GeotechSubLayer`/`ColumnSubBand` types.

## TDD + verification (mandatory — this is the second attempt)

1. **Unit (red first):** new `geotechSubdivide.test.ts` cases that assert the
   output is a **partition** of each region — the sub-regions' main (`kind:'quad'`,
   non-overlay) polygons must cover the parent region's area with **no gap and no
   overlap**. Encode the owner's case in the rule's words:
   - dense/loose/dense on the left, dense-only on the right, loose pinched →
     loose is an enclosed lens, dense fills the pinch, **area fully covered**.
   - a fully-tied 2-class stack → two clean bands, area covered.
   - an untied minority → lens, **but the matrix still tiles the region** (the
     regression test: assert total main-region area == parent area).
2. **`strix-section-geometry-check`** on the new overlay geometry (spacing-aware
   warp — the recurring trap that geometry must go through `warpedXToScreen`).
3. **Real-data dogfeed** on `test.strix`: the owner's two-CPTs-two-boreholes
   section — confirm lens-in-lens forms, the boreholes between recolour, and **no
   gaps** at any zoom.
4. Full `npx vitest run` + `npx tsc --noEmit -p tsconfig.web.json`.

## The ghost-contact-colour report — verify, don't assume

"Ghost contacts created on the borehole but the colour above doesn't change" is
**most likely** the same root cause (R1 off → no recompute repaints the borehole
columns). After R1 lands, re-check it on the same section. **If it persists**, it
is a separate, known bug: the geotech per-column bands (`ContactsLayer.tsx`) build
their own `colorById` from stored **lithology**, ignoring the NAD
`formationColorById` (CLAUDE.local.md known-open item B-cosmetic). Fix there, on
the geotech axis only, then — not folded blindly into R1.

## Risks / guardrails

- **Matrix-merge assumption:** relies on the recurring-packing-class property
  within a region (dense above+below a loose lens). If a region's packing is
  strictly monotonic (e.g. loose-over-dense, no recurrence) there is no enclosed
  lens — that's correct (it's a one-sided pinch/onlap, which `computeSectionFill`
  also handles via the matrix on the banding side). The unit tests must cover both.
- **Per-region cost:** one `computeSectionFill` call per quad region. Regions are
  small (2 columns, a handful of sub-bands) — cheap. The whole geotech axis is
  already memoised behind `sectionFillData`. Re-profile only if a real section lags.
- **Do NOT run `computeSectionFill` on the whole geotech section** (the 187-
  singleton trap). It must be strictly per-region, litho-framed.

## Out of scope (v1)
- Geotech sub-lens freedraw / apex override (pass empty `apexOverrides`).
- Nested geotech lens inside a non-quad litho pinch region (keep R0 there).
- The per-column borehole band NAD-colour fix (separate item, above).
