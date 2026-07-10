# Handoff — litho section fill: shallow-test flattening + gap-void fill (2026-07-10)

Branch: `wip-2-1-0-tie-gestures` (NOT pushed — commit-per-file, no push per owner rule).
All work below is committed on that branch. The gap-void fix is **NOT done** — that's
tomorrow's job.

## What SHIPPED today (owner-dogfed + confirmed on `test.strix`, Cross-section 1)

Everything renders on the `rewriteB` (correlate-or-gap) path — the app runs it by
default; vitest runs the old substrate path unless `REWRITE_B=1`.

1. **Warp-aware correlation edges** (`CorrelationEdgesOverlay.tsx`). A correlation edge
   that spans intervening columns is now drawn as a polyline that **bends flat across
   each intervening column** (helper `warpAwareEdgePoints`), instead of a straight
   screen segment. Root cause it fixed: columns are NOT placed proportionally to
   along-section distance, so a straight screen tie between two columns dips below the
   fill at the shallow test in between → the fill *looked* like it crossed the tie. The
   fill data was always correct; the tie was drawn wrong. Applied to BOTH the
   cross-litho `tie-hit`/`tie-line` AND the same-litho `ribbon-seam`. Commits
   `b2443f20`, `63397ac1` (flat across the column *width*, not centre), `5ac3e9ef`
   (ribbon seams), `067fb972`, `9acc6566`.
2. **Under-column void fill** (`PartitionFillOverlay.tsx` `underColumnFills`, re-enabled
   — commit `455d8f45`). The gap partition runs edge→edge, so directly under a shallow
   test's own footprint (below its TD) nothing was drawn. `computeUnderColumnSubstrate`
   samples the adjacent gap regions at the column edges and stacks the below-TD bands,
   flat, in the correct lithology. Fills ONLY where correlated bands exist.
3. **Under-column void drapes the OVERLYING band down** (`partitionFill.ts`
   `stackAtEdge`, commit `be15da5b` + test `ce134408`). A void between two bands (a
   narrowing clay over a thickening silt) was filled by stretching the *lower* band up
   (painted silt where neighbours log clay). Now it extends the *overlying* band down
   (drape), + merges adjacent same-formation bands. Verified vs neighbours: S8 void →
   KLEI (matches S11+S10), S7A void → ZAND (matches B2).

## The RED gate (the arbiter for tomorrow) — commit `34f7596d`

`partitionFill.cs1tiecross.test.ts` — "no fill region straddles a correlation surface
tie." Currently **GREEN** after the warp fixes. Keep it green.

Run: `REWRITE_B=1 CS1_TIECROSS=1 npx vitest run src/renderer/src/utils/partitionFill.cs1tiecross.test.ts`

## THE OPEN PROBLEM (tomorrow): gap voids inside the clay band

Owner dogfeed: "why are these two voids there? they're in the clay band?" — two voids
flanking a shallow test (S8), in the GAP fill (between columns), at ~elev 6.5–8.9 m.

### Root cause — PROVEN, do not re-derive

- The void at S10's side is **exactly S10's own mid-clay layer** (`KLEI 8.84→6.48`),
  and the fill isn't drawing it.
- `emitGap` **does emit it correctly** — its raw return for gap 8 includes
  `KLEI quad elev[6.48..9.29]` (via the MIXED tie `S8-silt-base ↔ S10-clay-top`, which
  rises the clay top to S8's TD 9.29). Confirmed with `FLOOR_PROBE=8`:
  `KLEI right [8.84..6.48] band=false sideways=true mixed=9.29`.
- BUT gap 8 is a **spanning gap**, so `computeSectionFill` clips every emitGap region at
  the shallow TD (`clipPolyAboveElev(r.polygon, shallowTd)`) and relies on
  `computeSpanningBands` to fill below. The mid-clay is entirely below the cap → the
  clip **discards it into a void**, and **no spanning band covers it** (its only band
  correlation is to borehole **B9, which is off this section**, so
  `computeSpanningBands` drops it — `layerLoc.get(B9-clay)===undefined`).
- So: emitGap fills it, the cap-clip throws it away, the spanning pass never replaces
  it. The clip is too aggressive — it discards emitGap fill that spanning doesn't cover.

The clip site: `partitionFill.ts`, in `computeSectionFill`'s per-gap loop, the branch
after `if (rewriteB && !spanningGapIndices.has(i))` — the `clipPolyAboveElev(r.polygon,
shallowTd)` call for spanning gaps.

### The trap (why it's a project, not a patch)

- **The void problem is SECTION-WIDE and PRE-EXISTING.** On the UNTOUCHED baseline,
  `cs1void` is already red on **9 gaps**: GAP-7, 8, 14, 15, 16, 17, 18, 20, 21 (GAP-8 =
  4523 cells = the clicked void). The two the owner clicked are 2 of 9.
- **Every fix trades voids for overlaps.** I tried three: (a) subtract spanning bands
  from the emitGap region — left holes/slivers in the deep stack (`subtractPolygon`
  isn't robust for hole-cutting); (b) centroid-coverage whole-region keep/drop —
  reduced most voids but introduced a new GAP-22 void; (c) surgical: tag only
  mixed-tie-emitted regions (`keepWholeBelowCap`) and keep those whole — cut GAP-8
  4523→176 but **broke `cs1frozen` (overlap gate): 3 failed** (the kept mid-clay
  overlaps a neighbouring band). Filling the void reintroduces the "clay spilling over"
  overlap the whole day started with.
- So the real fix reworks the **emitGap-above-cap / spanning-below-cap split** so that
  emitGap fill uncovered by spanning survives WITHOUT overlapping the spanning bands or
  the deep stack. It must be validated against **`cs1void` AND `cs1frozen` together**
  (fewer voids, zero new overlaps).

### Diagnostic harness (kept, uncommitted throwaways — use them)

- `partitionFill.voidscan.throwaway.test.ts` — scans each gap for uncovered
  (fraction, elevation) voids. `REWRITE_B=1 VOIDSCAN=1 npx vitest run <file> --disableConsoleIntercept`.
- `FLOOR_PROBE=<gapIndex>` (env, in `emitGap` + after the emitGap call in
  `computeSectionFill`) — dumps each floor-walk item's band/sideways/mixed decision AND
  emitGap's raw return regions. **NOTE: these `FLOOR_PROBE` probes were reverted with
  the failed fix** (`git checkout partitionFill.ts`) — re-add them (2 blocks) if needed;
  they're described above.
- `GAP_PROBE=<gapIndex>` (already permanent in `partitionFill.ts`) — post-reduce match
  structure per gap.
- `partitionFill.uccheck.throwaway.test.ts` — dumps `computeUnderColumnSubstrate` per
  shallow test. `REWRITE_B=1 UC_CHECK=1 ... --disableConsoleIntercept`.
- Input file `scripts/throwaway_cs1_input.json` (dev-DB extract; regenerate via
  `scripts/throwaway_cs1_partition_extract.py` against the dev DB per CLAUDE.md if the
  correlations changed).

### The gates (the target)

- Void: `REWRITE_B=1 CS1_GATE=1 npx vitest run src/renderer/src/utils/partitionFill.cs1void.test.ts` — currently RED (9 gaps); drive toward 0.
- Overlap/frozen: `REWRITE_B=1 CS1_GATE=1 npx vitest run src/renderer/src/utils/partitionFill.cs1frozen.test.ts` — must stay GREEN (no new overlaps).
- Tie-cross: `REWRITE_B=1 CS1_TIECROSS=1 npx vitest run src/renderer/src/utils/partitionFill.cs1tiecross.test.ts` — must stay GREEN.

### Process rules (owner)

Verify against the render / real data BEFORE claiming done — trace the coordinates you
already have (don't dogfeed blind). Commit per-file, Conventional Commits, co-author
`Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`. Do NOT push. Do
NOT `--no-verify`. Node 22. The render is the arbiter; green tests are necessary-not-
sufficient — but here `cs1void` + `cs1frozen` together ARE the concrete target.
