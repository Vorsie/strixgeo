# Halfway pinch-outs + partition-fill dogfeed fixes — design

**Date:** 2026-06-07
**Status:** approved (brainstorming → writing-plans)
**Surface:** litho cross-section partition fill + correlation gestures
**Origin:** dogfeed on the cleaned `test.strix` (Sections 1 & 3)

---

## Context

The body-extent system was retired 2026-06-06; **partition fill**
(`utils/partitionFill.computePartitionFill` + `PartitionFillOverlay`) is now the
sole body-shape model. Bands, pinch-outs and lenses are all derived by aligning
adjacent column unit-stacks. Dogfeeding the cleaned `test.strix` surfaced four
issues, three minor and one a real geometry regression.

## Problems

1. **Drooping pinch-outs (headline).** On Section 1 a unit that pinches out
   between two columns has its tapering tip dragged up/down to follow the
   neighbour's contact depth, and it reaches all the way to the neighbour
   column. Section 3 looks fine because there the same units happen to be
   enclosed lenses (which already get a horizontal apex). Root cause: in
   `partitionFill.emitInterval`, a *lone* interval pinch uses `meetFraction = 1`
   (left) / `0` (right), so its triangle spans the entire gap and its tip
   elevation is interpolated along the dipping enclosing interfaces
   (`ifaceElev`) to the point where they converge — at the neighbour column.

2. **Duplicate React keys.** `PartitionFillOverlay` keys shared-boundary groups
   by `pf-bnd-${upperBodyId}-${lowerBodyId}` and lens groups by
   `pf-lens-${bodyId}`. The same body-pair (a body spanning ≥3 columns) and the
   same enclosed lens (extracted into both flanking gaps) recur across gaps →
   identical keys → React "two children with the same key" warning flood.

3. **Auto-correlate "57 edges" confusion + cross-section data loss.**
   `SectionsToolbar.handleAutoCorrelateWithCheck` counts `source='auto'` edges
   **model-wide** and `api.geology.deleteAutoCorrelations(project, model)`
   deletes them **model-wide**. Auto-correlate itself is section-scoped
   (section-along-order adjacency), so: (a) the dialog reports edges the user
   made on other sections ("57 … but I didn't correlate this section yet"), and
   (b) "Re-correlate — delete auto edges and rerun" silently wipes *other
   sections'* auto edges — a latent data-loss bug.

4. **422 cross-lithology flood.** `CorrelateLithoContacts` step 4b correctly
   rejects a SILT↔ZAND edge (a correlation joins same-lithology units; the
   resolver would drop a cross-litho edge anyway). The flood is repeated
   *attempts* from the gesture layer, each surfacing a 422 toast/log. Exact
   trigger to be confirmed by one instrumented reproduction.

## Approach

### #1 — Halfway, partition-correct pinch-out (approach A1)

Selected over A2 (overlay — breaks the partition past the tip) and A3 (bend the
matrix quads — fragile, non-trapezoidal quads). **A1 repartitions the interval.**

A **lone pinch in an interior interval** (matched matrix above *and* below)
terminates at a tip fraction `f` (default **0.5**) along the dipping interfaces,
and the part of the interval beyond the tip is filled by **two matrix-extension
regions**:

- the **above body** (the previous matched quad's `formationId`/`bodyId`) above
  the merged contact, and
- the **below body** (the next matched quad's) below it.

The merged contact runs from the pinch apex `(f, apexElev)` to the natural
interface convergence at the far column. `apexElev` is the midpoint of the two
interface elevations at fraction `f` (so the tip sits on the dip, matching the
confirmed mockup). The result stays a true partition: in `[0, f]` the column is
{above-matrix, pinch, below-matrix}; in `[f, 1]` it is {above-matrix,
below-matrix} meeting on the merged contact.

**Geometry (left-only lone pinch, interval bounded by `topIface`/`baseIface`):**

```
apexElev = (ifaceElev(topIface, f) + ifaceElev(baseIface, f)) / 2
pinch    : (0, topIface.leftElev) → (f, apexElev) → (0, baseIface.leftElev)
aboveExt : top = topIface over [0,1];   base = pinch-top-edge over [0,f]
           ((0,topLeft)→(f,apex)) then the merged contact (f,apex)→(1,conv)
belowExt : top = pinch-base-edge over [0,f] ((0,baseLeft)→(f,apex)) then the
           merged contact (f,apex)→(1,conv);   base = baseIface over [0,1]
```
(`conv` = the elevation where `topIface` and `baseIface` meet at fraction 1; for
a lone pinch they converge there because the unit is absent on the far column.
The two extensions share the merged-contact polyline `(f,apex)→(1,conv)`, so
their boundary is identical there — the partition stays hole-free.)

Mirror for a right-only lone pinch (tip at fraction `1 − f`, base edge on the
right column).

**Tip fraction is a default, reshaped by freedraw.** Ship `f = 0.5` as a module
constant (sibling of `LENS_PINCH_FRACTION`). No Settings knob (owner directive
2026-06-07): the engineer drags the apex afterward via the **existing**
`PartitionFillOverlay` freedraw handle machinery (boundary/lens nodes). Wiring
the lone-pinch apex into that store is in scope so the dragged apex persists as a
`body_boundary` node.

**Scope guard.** The halfway tip applies only to a *single* lone pinch in an
*interior* interval (matched matrix above and below). Out of scope for this pass
(keep current behaviour, note as follow-ups):
- stacked multiple same-side pinches in one interval,
- interfingering (left + right pinches sharing an interval — already meet at the
  weighted `meetFraction`),
- top/bottom-open intervals (surface or floor sentinel on one side — the
  substrate / open-top case).

### #2 — Duplicate keys

Key by **region index** (already carried, unique per gap):
`pf-bnd-${sb.upperIdx}-${sb.lowerIdx}` and `pf-lens-${sl.regionIdx}`. No
behaviour change; pure keying fix.

### #3 — Auto-correlate scoping

Section-scope **both** the count and the delete:
- **Count:** filter `listContactCorrelations` to edges whose *both* endpoints sit
  on the current section's columns before counting `source='auto'`.
- **Delete:** extend `deleteAutoCorrelations` to accept an optional `section_id`
  (or an explicit list of in-section contact ids) so re-correlate clears only
  *this* section's auto edges. Backend use case + endpoint + `client.ts` gain the
  optional scope; the model-wide path stays available for any caller that wants
  it.

Dialog copy already says "in this model"; with section scoping the count becomes
"N auto-correlation edges **on this section**". Fixes both the confusing count
and the cross-section data-loss.

### #4 — 422 cross-lithology flood

**Reproduce first** (one instrumented run on `test.strix`) to confirm the exact
flood path (single repeated manual gesture vs Ctrl-drag duplicate/retarget vs a
full-band correlate). Then **prevent at the gesture layer**: in correlate mode,
treat a cross-lithology target as a no-op (with a one-line hint) so a doomed edge
is never POSTed. Keep the backend guard as the backstop. Scope of the gesture
filter is finalised after the reproduction.

## Testing

- **#1:** unit tests in `partitionFill` for a left-only and a right-only lone
  interior pinch — assert (a) the pinch apex is at fraction 0.5 on the dip,
  (b) the two matrix-extension regions exist with the correct above/below
  `formationId`, (c) the regions still tile (extend `assertTiles` to the
  `[f,1]` span). A regression case where the matrix above ≠ matrix below. Then
  **verify against the real `test.strix` Section 1** with
  `strix-suggestion-eval` / `strix-section-geometry-check` (warpedXToScreen).
- **#2:** a `PartitionFillOverlay` vitest with a 3+ column fixture (one body
  spanning all columns) asserting no duplicate React keys.
- **#3:** integration test on `deleteAutoCorrelations(section_id=...)` —
  Section-1 re-correlate leaves Section-3 auto edges intact; the count reflects
  only section edges.
- **#4:** after reproduction — a gesture test that a cross-litho target no-ops
  (no POST fired).

## Non-goals

- No Settings knob for the tip fraction (freedraw is the adjustment path).
- No change to the same-lithology backend guard (it is correct).
- Stacked / interfingering / open-top-bottom pinch geometry (follow-ups).
- No export-path work (partition geometry is still client-side TS; Tier-D).

## Sequencing

One spec, one plan, internal order:
1. **#2 keys** — trivial, stops the live console flood.
2. **#1 halfway pinch** — the headline; the substantive design.
3. **#3 scoping** — backend + frontend, mechanical.
4. **#4 422** — reproduction, then gesture filter.

## Open questions

- #4 exact flood trigger — resolved by the reproduction step, before its task.
