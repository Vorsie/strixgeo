# Auto-partition geometry correctness — design (Thread A)

**Date:** 2026-06-07
**Status:** approved (brainstorming → writing-plans)
**Surface:** `desktop/src/renderer/src/utils/partitionFill.ts` (+ its overlay)
**Origin:** dogfeed — "the half-way pinch-outs are drooping" + "what about when a
test is not deep enough and has fewer units than adjacent tests?" + owner
directive "make it generic for all sites"

---

## Context

`computePartitionFill(left, right)` tiles the gap between two adjacent litho
columns by aligning their unit stacks (LCS on `body_id`) and emitting quads
(matched), pinches (one-sided), and enclosed lenses. Two geometry behaviours are
wrong for the generic case, confirmed against the real `test.strix` Section 2
(boreholes end ~17–21 m; CPT neighbours reach ~23–25 m; unit counts swing 5↔15):

1. **Drooping pinch-outs.** A lone pinch uses `meetFraction = 1` (left) / `0`
   (right), so its triangle runs the *whole* gap to the neighbour and its tip
   elevation is interpolated along the dipping enclosing interfaces to where they
   converge — at the neighbour column. When the neighbour's contact is
   deeper/shallower the tip rides up/down ("drooping").

2. **Too-shallow neighbour mis-rendered as a pinch.** A unit deeper than a
   neighbour's total explored depth has no match (the neighbour has no data
   there), so it falls into the floor interval and *pinches toward the shallow
   neighbour*. That asserts the unit terminates — but it doesn't; the test just
   stopped. A data gap is not a pinch-out.

Owner-approved target geometry (confirmed via the brainstorming visual
companion):

- **Halfway pinch (A1):** a lone interior pinch tapers to an apex at **50% on the
  interface dip**; beyond the apex the enclosing matrix closes up. Stays a true
  partition. Default 0.5; reshaped afterward via the existing freedraw apex
  handle. (Full A1 detail also in
  `docs/superpowers/specs/2026-06-07-halfway-pinch-out-and-partition-fixes-design.md`.)
- **Too-shallow carry-through:** a unit below the neighbour's total depth passes
  **through** the neighbour at **full thickness** — never pinches to it.

These are independent code paths (interior interval vs floor interval), so they
ship as two slices.

---

## Slice 1 — Halfway pinch (approach A1, repartition)

A **single lone pinch in an interior interval** (matched matrix above *and*
below) terminates at tip fraction `f` (default **0.5**) along the dipping
interfaces. The interval *beyond* the apex is filled by **two matrix-extension
regions** — the above body (previous matched quad's `formationId`/`bodyId`) above
the merged contact, the below body (next matched quad's) below it.

```
apexElev = (ifaceElev(topIface, f) + ifaceElev(baseIface, f)) / 2
pinch    : (0, topIface.leftElev) → (f, apexElev) → (0, baseIface.leftElev)   [left-only]
aboveExt : top = topIface over [0,1];  base = pinch-top-edge over [0,f]
           ((0,topLeft)→(f,apex)) then the merged contact (f,apex)→(1, conv)
belowExt : top = pinch-base-edge over [0,f] ((0,baseLeft)→(f,apex)) then the
           merged contact (f,apex)→(1,conv);  base = baseIface over [0,1]
```

`conv` = where `topIface` and `baseIface` meet at fraction 1 (they converge there
for a lone pinch — the unit is absent on the far column). The two extensions
share the merged-contact polyline `(f,apex)→(1,conv)` so their boundary is
identical there → hole-free. Mirror for a right-only lone pinch (tip at `1−f`,
base edge on the right column).

**Implementation seam.** `emitInterval` currently only sees the pinches +
interfaces. To emit the matrix extensions it must also receive the **above body**
(prev quad's `formationId`/`bodyId`) and the **below body** (next quad's), and a
flag that this is an interior interval (matched matrix both sides). The
`computePartitionFill` main loop already holds both — thread them in.

**Scope guard.** Slice 1 applies the halfway tip only to a *single* lone pinch in
an *interior* interval. Stacked/multiple same-side pinches, interfingering (left
+ right pinches sharing an interval — already meet at the weighted
`meetFraction`), and the top/bottom-open intervals keep today's behaviour
(top/bottom-open is Slice 2's concern). Default `f = 0.5` as a module constant
(sibling of `LENS_PINCH_FRACTION`); freedraw apex override already exists.

## Slice 2 — Too-shallow carry-through

In the **floor interval** (below the last matched pair) the two columns can have
different floors (`leftFloor` ≠ `rightFloor`, already computed). A unit on the
**deeper** column whose `topDepthM ≥ shallowFloor` lies **entirely below the
shallow column's deepest data** — the shallow column says nothing about it. Such
a unit is a **carry-through**, not a pinch:

- Render it as a **full-gap-width band** bounded by its own `topDepthM` /
  `baseDepthM` (flat interfaces — the shallow column has no contacts there),
  coloured by its lithology. It spans `[0,1]` of the gap.
- In the neighbouring gap (shallow ↔ a deeper second neighbour), the same unit
  carries through from that side too, so the two full-width bands **meet at the
  shallow column** and the unit reads as continuous past it.

Units in the floor interval that are **not** below the shallow floor (the columns
reach similar depth, one just has an extra bed) stay genuine pinches — tiled as
today.

**Threshold:** "shallow floor" = the shallower of `leftFloor` / `rightFloor`
(the deepest accepted-unit base on each column — what the partition already has).
A unit qualifies as carry-through iff its `topDepthM ≥ shallowFloor − EPS`.

**Edge cases (keep current behaviour, note as follow-ups):**
- A unit that *straddles* the shallow floor (top above, base below) → treat as a
  pinch (current). Rare; full carry-through of a straddler is a later refinement.
- Too-shallow at the **top** (a column missing surface units / starting deeper) →
  the surface interval. Out of scope for this slice (tests almost always start at
  surface); note it.
- Both columns identical floor → no carry-through (the floor interval is all
  genuine pinches/quads).

## Testing

Pure-function unit tests in `partitionFill` (no React) — assert region kinds,
`formationId`s, polygon corners, and that the result still tiles (extend the
existing `assertTiles` helper):

- **Slice 1:** a left-only and a right-only lone interior pinch → (a) pinch apex
  at fraction 0.5 on the dip, (b) two matrix-extension regions with the correct
  above/below `formationId`, (c) tiling holds across `[f,1]`. A case where the
  matrix above ≠ matrix below (different formations). A near-miss: an
  interfingering interval (left + right pinch) is unchanged.
- **Slice 2:** deep column + shallow neighbour → the units below `shallowFloor`
  render as full-width bands (fraction 0→1), not pinch triangles; a same-depth
  extra-bed case still pinches. A two-gap fixture (deep, shallow, deep) → the
  carry-through bands meet at the shallow column.
- **Validate against the real `test.strix` Section 2** with
  `strix-suggestion-eval` / `strix-section-geometry-check` (all geometry uses
  `warpedXToScreen`): the boreholes' CPT-neighbour deep units should carry
  through, and interior lone pinches should sit at ~50% on the dip.

## Non-goals

- No facies-band fill, no body merging (Thread B handles cross-lithology surface
  ties separately).
- No change to enclosed-lens geometry (already horizontal apex).
- Stacked/interfingering/straddle/surface-open cases (follow-ups above).
- No Settings knob for `f` (freedraw is the adjustment path).

## Open questions

- Should the carry-through band's lithology be the deep unit's own colour only
  (yes — that's all the data supports), or hinted as "inferred below test depth"?
  Default: plain fill; revisit if it reads as over-confident.
