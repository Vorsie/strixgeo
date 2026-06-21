# Deep-to-deep substrate pass — design

**Status:** ready for owner review (2026-06-21)
**Author:** Claude (dogfeed session, CS1 of test.strix)
**Supersedes for the sub-TD region:** the bridge-injection + gap-fill + floor-carry
heuristics inside `emitGap` that currently fill below a shallow test's TD.

---

## 1. Problem

In `computeSectionFill` (`desktop/src/renderer/src/utils/partitionFill.ts`), the
region **below a shallow test's TD** is filled by ≥4 interacting mechanisms —
bridge injection, gap-fill injection, floor-carry / sideways, and mixed-tie
handling. On real CS1 they fight each other and produce **cross-formation
overlaps** (clay drawn over sand): instrumented on the dev-DB CS1 input, ~10 gaps
carry KLEI∩ZAND / KLEI∩SILT overlaps of hundreds–thousands of raster cells
(GAP-17 KLEI∩ZAND 1650, GAP-18 1418 after the mixed-tie fix). Patching each
interaction individually relocates the overlap rather than removing it (the
"whack-a-mole" that consumed two days; two reverts this session confirm it).

The user's mental model (owner directive, confirmed via the visual companion):
**below a shallow test's TD the deep stratigraphy continues as straight lines
from one deep test to the next, passing transparently behind the shallow
test(s); the sand owns its space; the matrix clay does not flood over it.**

## 2. Scope

**In scope:** replace the sub-TD fill (below each shallow column's TD, down to the
bottom-tie line) with ONE dedicated, tiling, deep-to-deep substrate pass.

**Unchanged (explicitly preserved):**
- The above-TD matched-band partition (where both columns of a gap have data).
- The mixed-tie handling (the bottom ties the user draws — already fixed this
  session: mixed-tied units survive extraction, commit `ab86e315`).
- Lens / onlap overlays in the observed region.
- The bottom-tie line (`computeBottomTieLine`) as the lower boundary.

**Out of scope:** the 3-D voxel builder (inherits the corrected 2-D partition),
auto-correlate, the geological-model bounding.

## 3. The rule (owner-confirmed)

1. **Deep-to-deep straight bands.** Below a shallow run, each deep band runs as a
   straight line between the nearest deep test on its left and the nearest deep
   test on its right that carry it. Shallow tests in the run are transparent
   below their TD; the straight band passes behind them.
2. **Matching = correlation → lithology → facies (Rule A).** Two deep anchors'
   bands connect straight if an approved correlation/tie links them, else if same
   lithology + elevation overlap; a genuine lithology change between the anchors
   becomes a **facies seam** meeting at the midpoint. (Companion screen, owner did
   not dissent; consistent with the above-TD matcher.)
3. **One-sided → sideways flat.** A band present at only one bracketing anchor
   continues flat at its own elevation (the shipped sideways default).
4. **Runs of ≥2 consecutive shallow tests** are handled by one bracket (the deep
   anchors on each side of the whole run).
5. **Bottom-tie line is the lower boundary.** Deep tests anchor it; shallow tests
   sit above it and never drag it up. It may be open-ended past the section ends.
6. **Sand owns its space.** No cross-formation overlap anywhere in the substrate
   (it is a true partition: one lithology per point).

## 4. Architecture — how it plugs in

This is **Architecture Option 2** from the opening brainstorm ("recompute
deep-to-deep via the validated matcher"), chosen for maximum reuse of the
already-validated tiling geometry.

```
computeSectionFill(columns, edges):
  for each gap (i, i+1):
    emitGap(...)            ← CAPPED at the shallow TD of that gap (NEW)
                              emits only the observed/above-TD partition +
                              mixed-tie risings; does NOT fill below the shallow TD
  substratePass(columns, edges, regions)   ← NEW: fills every below-shallow-TD wedge
  return aboveTDRegions ++ substrateRegions
```

**substratePass algorithm:**
1. Compute each column's TD elevation; the **substrate region** of a column is
   `[bottomLine .. TD]` (bottomLine from `computeBottomTieLine`, open-ended at the
   ends, else the deepest reachable base).
2. Partition the columns into **maximal runs of consecutive shallow columns**,
   each bracketed by a **deep anchor** L (nearest column on the left reaching below
   the run's shallow TDs) and R (nearest on the right). A column with no deeper
   neighbour on a side has an **open** bracket on that side.
3. For each bracket (L, R): run the **existing `emitGap(L, R)`** on the two deep
   anchors' stacks (this already produces straight, tiling, correlation→litho→
   facies geometry between two columns), restricted to the substrate elevation
   band. This is the deep-to-deep partition for the run.
4. **Slice** that L→R partition at each intervening shallow column's along-section
   fraction to produce that column's substrate regions (tagged with the column's
   `gapIndex` so the overlay maps them with the correct screen X).
5. **Open brackets** (run at the section start/end, or the deepest substrate that
   never pinches) → sideways flat to the section edge (rule 3 + the existing
   open-extent length).

**Why reuse `emitGap(L,R)`:** it is the validated tiling primitive — straight
bands, facies seams at mismatches, pinch-outs, correct matching. Slicing its
output per shallow column inherits all of that for free, instead of re-deriving
it in a fourth heuristic.

**Tiling guarantee:** within a bracket the L→R partition tiles (emitGap
invariant, `assertTiles`); slicing a tiling partition at any fraction yields a
tiling stack; the slice at the shallow column's TD meets the capped above-TD
partition at that TD (shared boundary), so the whole column tiles top-to-bottom.

## 5. What gets removed

Inside `emitGap`, the sub-TD portions of: bridge injection (`bridge:` units),
gap-fill injection (`gapfill:` units), and the floor-carry / sideways emission
**below the shallow TD**. The above-TD floor walk (matched bands + mixed-tie
risings down to the shallow TD) stays. (Exact removal boundary is a Task-1
discovery against the gate — some of this machinery also serves the above-TD
region and must be preserved there.)

## 6. Gates (the real-data gate is the arbiter)

The synthetic 2-column tests are **necessary but not sufficient** — proven this
session (a no-edge synthetic gate went green while real CS1 stayed broken; even
the with-edges gate passed while 9 other gaps overlapped). So:

1. **Primary — real-data CS1 gate** (`partitionFill.cs1*.test.ts`, `CS1_GATE=1`,
   dev-DB-derived input): **zero cross-formation overlap** in any gap's substrate,
   AND **zero interior void**, AND correct lithology below every shallow TD.
   Regenerate input via `scripts/throwaway_cs1_partition_extract.py`.
2. **Secondary — synthetic** behaviour tests (with edges): the GAP-18 mixed-tie
   case (already committed), a 2-consecutive-shallow run, a facies-seam case, a
   one-sided sideways case.
3. **No regression:** full `partitionFill.test.ts` green; `assertTiles` holds on
   every gap; tsc clean.
4. **Visual:** the real-CS1 render (companion) shows no red overlap regions.

## 7. Risks

- **Disentangling `emitGap`'s sub-TD emission from its above-TD emission** is the
  main risk (they share the floor walk). Mitigation: cap at the shallow TD as a
  first, measurable step; keep the above-TD output byte-identical (regression
  gate) before adding the substrate pass.
- **Coordinate plumbing:** slicing the L→R partition at a shallow column needs the
  along-section fraction of that column between L and R. The overlay already has
  along positions; the pass takes them as input (pure function, testable).
- **Open brackets / deepest substrate** must still reach the bottom-tie line
  without re-introducing the floor-carry tangle.

## 8. Out of scope / future

- Two-sided lens authoring below TD, body-level admixture — Phase 5.
- Porting the substrate geometry to a Python domain service for export — Tier-D
  (the raw inputs reconstruct it, so nothing is foreclosed).
