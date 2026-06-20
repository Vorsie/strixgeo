# Bottom-tie substrate band — design

**Date:** 2026-06-20
**Status:** APPROVED (owner confirmed model 2026-06-20: "it just follows the bottom
tie"); plan written; subagent-driven build underway
**Owner directives (2026-06-20):** "fill driven by my bottom-ties"; "bounded by the
bottom-tie line or another correlation band."

## Problem

The 2D `computeSectionFill` "Fill bands" leaves large empty wedges below shallow
tests, down to the bottom-tie line — confirmed in the dogfeed (S11/S8/S10 etc.) and
by the corrected real-data gate: **all 22 CS1 gaps are void from their local fill
bottom down to the section-wide bottom-tie line at −13.37**. The 3D voxel model
inherits this (it's built from the same partition).

Earlier per-gap fixes (flat-tail to the *adjacent* deep test's base, commit
`51ea227c`) only close the wedge when a shallow column is directly next to a deep
one. They do NOT fill runs of shallow columns that sit *between* two non-adjacent
deep tests — which is most of the section.

## Root model (verified against the live CS1 data)

The bottom-tie correlations the user draws are **base↔base** edges (plus mixed
top↔base). In CS1 there are 18 base-ties; crucially several are **non-adjacent**:

```
col23(base −13.37) ↔ col19(base −9.96)   span 4 cols  (over shallow col20/21/22)
col19(base −9.96)  ↔ col14(base −10.20)  span 5 cols  (over col15/16/17/18)
col9 (base −10.25) ↔ col7 (base −9.85)   span 2 cols
```

Each base-tie edge is a **segment** from `(colA, baseElevA)` to `(colB, baseElevB)`.
Together the segments define the **substrate tie line** = the LOWER ENVELOPE of all
base-tie segments: at any column `k`, `tieElev[k] = min over segments covering k of
the linearly-interpolated elevation`, and `substrateFormation[k]` = the formation of
the segment that produced that min. Columns covered by no segment have no substrate.

Below each column's deepest real data, down to `tieElev[k]`, the section is the
**substrate** — the deepest tied lithology — which BANDS across the section (filling
the wedges beneath shallow columns). The lower boundary is the tie line itself (or,
where a shallower correlation band intervenes, that band — "another correlation
band").

## Behaviour (owner's model, 2026-06-20 — verbatim intent)

> "You have a band on top and a band on bottom spanning over multiple tests. You
> just extend the geology of the left test and the right test. If there is a lens or
> on-lap you do it halfway in between the two correlated tests as usual — UNLESS it
> is a bottom tie, then you follow it to the next test with deeper data. Make sure to
> onlap on bottom ties where necessary."

So this is the EXISTING band/onlap/lens machinery, generalised from adjacent pairs to
**spans of multiple tests**, plus a bottom-tie rule:

1. **A band spans multiple tests.** A region bounded by a TOP correlation line and a
   BOTTOM correlation line that connect non-adjacent tests fills every column in
   between — extend the left test's geology rightward and the right test's geology
   leftward to meet.
2. **Classification is unchanged: 2 correlated bounding contacts → BAND, 1 → ONLAP,
   0 → LENS.** Onlaps/lenses meet HALFWAY between the two correlated tests, as today.
3. **Bottom-tie exception.** When the bounding correlation is a BOTTOM TIE, a unit
   that would otherwise pinch/meet-halfway instead **follows the tie to the next test
   with deeper data** — i.e. its lower edge tracks the bottom-tie line to the deeper
   tied test rather than terminating mid-gap. Onlap on a bottom tie where only one
   side correlates (onlap, not band).
4. **The substrate** is the deepest such band: its lower edge is the bottom-tie line
   (the lower envelope of base-tie segments; open-ended ties extend flat to the
   section edge). It fills from each column's deepest real data down to that line,
   following the bottom-ties across the shallow columns in between.
5. Result: every gap is gapless from surface to the bottom-tie line — the corrected
   CS1 gate (section-wide bottom) reports **0 voids, 0 overlaps** in all 22 gaps,
   with onlaps/lenses where the contacts only partially correlate.

## Implementation approach (to be detailed in the plan)

Two candidate mechanisms — pick in the plan, validate with the gate:

- **(A) Inject substrate units** before the gap loop in `computeSectionFill`: append
  a virtual substrate unit `[realBase … tieElev]` to each column under a tie span,
  flagged (like the existing `virtual:` units) so `reduceColumn` won't pull it as a
  lens and no edge matches it spuriously; the band machinery then tiles it. Risk:
  interaction with the existing flat-tail / floor-walk sub-TD handling (which should
  become no-ops once every column reaches the tie line).
- **(B) Post-pass** after the gap loop: per gap, add a substrate quad from the gap's
  existing fill-bottom down to the interpolated tie line. Risk: matching the existing
  (varying) fill-bottom boundary exactly to avoid a seam gap/overlap.

The flat-tail fix (`51ea227c`) is subsumed by this (it's the adjacent-deep special
case); decide in the plan whether to keep it as a fast path or remove it.

## Validation gate (already built + truthful)

`desktop/src/renderer/src/utils/partitionFill.cs1void.test.ts` (dormant; run with
`CS1_GATE=1` after `uv run python scripts/throwaway_cs1_partition_extract.py`).
Bottom boundary = the section-wide deepest base (the tie line). Currently RED: 22
gaps void. Target: **0 voids, 0 overlaps**. Plus the partition unit suite +
`partitionFill.goldens.test.ts` (the Python `section_partition.py` port is DEAD —
zero live imports — so goldens may be regenerated freely).

## Out of scope (this iteration)

GAP-19 single-formation over-match (`+0.9..+7.8`) — a distinct artifact; tracked in
the bottom-tie plan.
