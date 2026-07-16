# REWRITE_STATE.md — partition-engine-v2 tiler rewrite hand-off contract

**Worktree:** `C:\Users\robin\Documents\Strix-tiler-rewrite` · branch `wip-v2-tiler-rewrite`
**Never touch:** the main checkout `C:\Users\robin\Documents\Strix`. Never git add/commit/push
(the orchestrator commits checkpoints). Node 22.x. No e2e/backend.

This file is the multi-session hand-off. Intermediate RED states are ALLOWED and PERSIST.
Session N does NOT revert session N-1 — it BUILDS. Keep this file current every step.

---

## 0. Mission (owner's sentence)

Rewrite the interval layer to: "all you need is the ties, absence of ties and the litho."
Per gap, per side, per unit — from `effectiveCorr.ts`:
- **0-corr** → 8b-capped lens (min(0.45×gap, 2·thicknessM/gapWidthM via real alongM), band-clipped)
- **1-corr** → onlap tip 0.5 riding its (direct/derived/top-band) tie
- **2-corr** → band (mismatched formations → 8d midpoint quads)
- Terminations emitted BEFORE flood/residue closure.
- ruling-8e same-formation-tied enclosure = one face, no internal seams.
- ruling-6 substrate bounded above by its own tie; Q3 voids empty; ruling-5 top band.

Replace: the old `tileInterval` seam cascade + `routeLoneSidePinch`/`routeLoneStack` guard zoo
(`emitIntervals.ts`/`emitLonePinch.ts`/`emitLoneStack.ts`). Deletion is success.
`intersect.ts` UNTOUCHABLE (613-hole trap). READ-ONLY even here: v1 `utils/partitionFill/` package,
`partitionFill.ts`, committed `partitionFill.*.test.ts`.

---

## 1. Acceptance oracles (all from `desktop/`, env-gated)

| Oracle | Command | Current | Target |
|---|---|---|---|
| Conformance gate | `SHAPE_AUDIT=1 npx vitest run src/renderer/src/utils/partitionFillV2.conformance.diag.test.ts` | **0corr-not-lens 5 / 1corr-not-onlap 14 / 2corr-not-band 0 = 19**; 8e-encl ~52; reach-cap adv 2 | CS1 → 0/0/0 |
| Cross-gap overlap | `SHAPE_AUDIT=1 npx vitest run src/renderer/src/utils/partitionFillV2.crossgap_overlap.diag.test.ts` | shared-column 17 (TBC) | 0 |
| Holes diag | `HOLES_DIAG=1 npx vitest run src/renderer/src/utils/partitionFillV2.holes_overlaps.diag.test.ts` | 0/0/0 (must stay) | 0/0/0 |
| CS1 gates | `CS1_GATE=1 npx vitest run src/renderer/src/utils/partitionFillV2.cs1gates.diag.test.ts` | 7/7 (must stay) | 7/7 |
| Shape gates | run each: strict210, loneSidePinch, simplerings, twoSidedTermination, bandAuthority, derivedTieOnlap | green (must stay) | green |
| v1 | v1 pure-geometry tests (partitionFill.*.test.ts) | 90/90 (must stay) | 90/90 |
| tsc | `npx tsc --noEmit -p tsconfig.web.json` | clean (must stay) | clean |

Determinism verified (design §6): `computeSectionFillV2` byte-identical across processes.

---

## 2. Architecture (as-found, verified session 1)

Pipeline (design §3): `computeSectionFillV2(columns, edges, lensApexOverrides?, alongM?)`
→ `buildSectionInput` (sectionGeom.ts) → `emitCurves` → `buildArrangement` (intersect/dcel/faces)
→ `labelFaces` → `slice`/`sliceAnnulus` → `SectionRegion[]`.

`emitCurves` order (emitCurves.ts):
1. `emitColumnVerticals` — per-unit column verticals (vertex at every contact)
2. `emitSurfaceCurves` — top-band polyline per gap (ruling 5-revised, `firstLithoTopElev`)
3. `resolveTies` + `pruneCrossingTies` → `activeTies` (ResolvedTie, per-gap/side/unitIndex) → tie curves
4. `emitSubstrateBridges` (jump ties) → `bridgeAnchored`
5. `emitIntervalCurves` (emitIntervals.ts) — **THE INTERVAL TILER being rewritten** — untied-unit
   vacancy closure via seams; routes into `emitLonePinch`/`emitLoneStack`/`emitSharedContactOnlap`/
   `emitSurfaceOnlap`
6. `emitEnclosedLensCurves` (emitLenses.ts) — enclosed lenses as holes-in-matrix
7. `emitBottomTieSubstrate` — flat-floor deep-to-deep sub-TD

**The corr arithmetic** (`effectiveCorr.ts`) is ONE source of truth, shared engine+gate:
`effectiveCorrForSide(gapIndex, side, col, facing, left, right, activeTies): EffectiveCorr[]`
returns per-unit {topTied, baseTied, corr}. THIS is the driver the rewrite must feed the tiler from.

**`edgedLayerIds`** (sectionGeom.ts:185) — section-wide `Set<string>` of every layerId in ANY edge.
Used in `extractEnclosedLenses` to skip extracting a tied unit as a lens. **THE SESSION-1 TARGET:**
this is TOO COARSE — a unit edged in gap N (adjacent) is wrongly blocked from lensing in gap M≠N.
The doc's fix path = per-gap `edgedLayerIds`, extract at the interval level not the column pre-pass.

**Enclosed-lens extraction** (`extractEnclosedLenses`, sectionGeom.ts:262) — per-COLUMN, before gaps:
a unit k with above.formation==below.formation!=k.formation, un-edged (section-wide), merges
above+below into one matrix unit, records the lens in `col.enclosedLenses`. Emitted into BOTH
adjacent gaps by `emitEnclosedLensCurves` (guarded by `facingCarriesMatrix`).

---

## 3. The 19 residual conformance violations (from diag_conformance.json / doc §4 FINAL SHAPES)

Grouped by the doc's FINAL SHAPES row (the fix-path taxonomy):

**(a) no-emit pair** — routeLoneStack skips (enclosing SILT-below is EDGED/base-tied):
- CS1 g20 ZAND el[8.88,9.23] (1corr, both-tied, absent)
- CS1 g21 ZAND el[8.88,9.23] (1corr, both-tied, absent)

**(b) lens-edged trio** — minority TIED IN ADJACENT gap, section-wide edgedLayerIds excludes it,
but per-side rule says it must lens 0.45 in THIS gap:  ← **SESSION-1 PRIMARY TARGET**
- CS1 g3 SILT [left] el[0.232,0.665] (1corr top=true base=false, absent)
- CS1 g22 ZAND [left] el[9.83,10.42] (0corr, absent)
- CS2 g21 SILT [left] el[-3.99,-3.67] (1corr top=true base=false, absent)

**(c) boundary/mixed trio** — enclosed by DIFFERENT formations above/below (not same-formation lens):
- Tie-10 g0 ZAND [right] el[5.73,6.44] (0corr, absent)  [also appears as CS1 g5 ZAND same elev]
- CS1 g5 ZAND [left] el[5.73,6.44] (1corr top=true base=true, absent)
- CS1 g7 SILT [right] el[9.29,9.85] (0corr, absent; faces 2-unit shallow col → §8-Q3 substrate entangle)

**(d) untied same-formation full-widths (ruling-8 residual — gate flags CORRECTLY, NOT engine defects):**
- Tie-10 g0 SILT/ZAND full-width (1corr, top-only / base-only) — opposing 8b lenses until owner ties
- Tie-12 g0 SILT [right] el[9.24,10.65] (1corr base-tied, full-width band)
- CS1 g18 VEEN [left] / ZAND [right] full-width (0corr / 1corr)
- CS1 g19 KLEI [left] full-width (1corr)
- CS1 g22 SILT [left] full-width band (0corr + 1corr)
- CS2 g13 SILT [left/right] el[-5.31..-4.42]/[3.77..5.27] (1corr base/both, full-width band)

**8b reach cap (advisory 2):** the 2 advisory `0corr-reach-exceeds-cap` render at 0.5 INTERIOR via a
NON-`isLens` lone-side path (engine/gate routing disagreement). Prior attempts to shrink the isLens
apex REGRESSED the counter (nearer-apex re-trace, doc §4). Needs the lone-side routing restructure.

---

## 4. Session-1 plan & progress

**Priority 1 (DONE):** wrote this file.
**Priority 2 (IN PROGRESS):** per-gap `edgedLayerIds` + per-gap/per-side termination emitter for the
lens-edged class (b). Prove on Tie-4 + CS1 g3.
**Priority 3 (NOT STARTED):** terminations-first for two-sided intervals, section by section (Ties first).

### Progress log
- 2026-07-15 session 1. Read design doc §2/§4/§8 fully, sectionGeom/effectiveCorr/emitCurves/
  emitLenses/emitIntervals/emitIntervalLenses, conformance gate + classify. Confirmed baseline
  5/14/0=19 matches doc §4 FINAL SHAPES row; holes 0/0/0; CS1 7/7; v1 90/90; tsc clean.
- **Priority 2 DELIVERED (foundation):** `partitionFillV2/edgedLayers.ts` — `buildEdgedLayers(columns, edges)`
  → `{ sectionWide: Set, inGap(layerId, gapIndex): boolean }`. The per-gap edged predicate the
  lens-edged fix needs. Unit test `partitionFillV2.edgedLayers.test.ts` (5 cases, GREEN) pins the
  rule: a layerId edged only in gap N returns false for gap M; jump edges belong to no gap.
- **RED gate landed (session-2 target):** `partitionFillV2.lensEdged.test.ts` (describe.skip — keeps
  the suite green; un-skip in session 2 to drive red→green). Encodes: CS1 g22 SILT + CS2 g21 SILT
  must render lens/onlap (not band/absent). VERIFIED genuinely RED against current engine:
  CS1 g22 SILT → `band`, CS2 g21 SILT → `absent`.
- Bash `git`/`rm` + PowerShell DENIED in this env; only non-git bash + file tools. Multi-env-var
  test runs also trip the matcher — run one env var at a time (CS1_GATE=1 / HOLES_DIAG=1 / SHAPE_AUDIT=1),
  no-env multi-file batches are fine. Orchestrator commits + does file deletes.
- Throwaway probe test neutralised to `describe.skip` no-op (couldn't delete): file
  `partitionFillV2.throwaway_probe.diag.test.ts` + `scripts/throwaway_probe_*.mjs` are stubs —
  orchestrator should `rm` them.

### Findings (mechanism, exact — from real-data probes)
**The lens-edged class root, confirmed on real data (CS1 g22, CS2 g21, CS1 g3):**
- `sectionGeom.extractEnclosedLenses` runs PER-COLUMN with the section-wide `edgedLayerIds` set.
  A minority edged in ANY gap (even the ADJACENT one) is skipped → stays in `col.units` → drops to
  the interval-level flood → absorbed by its same-formation enclosing flood → renders band/absent.
- CS1 g22 LEFT stack: u0 ZAND, u1 SILT, u2 ZAND, u3 SILT. u1 SILT (enclosed ZAND/ZAND) and
  u2 ZAND (enclosed SILT/SILT) are BOTH 0-corr in gap 22 but edged in gap 21 → extraction empty
  (`L.enclosedLenses=[]`) → u1 renders `band`, u2 renders `absent`. CORRECT: both are 0.45 lenses.
- CS2 g21 LEFT: u6 SILT el[-3.99,-3.67] is 1-corr in gap 21 (top-tied) but edged-g20 → absent.
  CORRECT: onlap tip 0.5 riding its top tie.
- CS1 g3 LEFT: u3 SILT el[0.232,0.665] is 1-corr in gap 3 (top-tied HERE) enclosed by ZAND/ZAND
  → extraction skips it (lensEdged section-wide) → absent. CORRECT: onlap riding its top tie.
  NOTE: doc grouped CS1 g3 as "tied in the adjacent gap" but the data shows it's tied in THIS gap
  (top) — it's still the same fix (per-gap extraction that lets a tied-here-as-onlap minority
  terminate instead of being absorbed by the ZAND flood). Trust the data over the doc grouping.
- The interval-level `emitIntervalLenses.extractEnclosedLenses` DOES run per-gap-per-side on
  `IntervalUnit[]`, BUT it BAILS ("residual multi-formation → return whole stack full-width")
  when the interbedded residual is >1 formation (CS1 g22 u1/u2 leave ZAND+SILT residual). That
  bail is why the flood swallows them. This is the doc's "flood-absorbs-the-lens wall" +
  "splitAnnulus fires only on holes>0" class — the notch face rides the column edge (holes=0).

### Engine wiring (as-found, for session 2)
- `emitCurves` order (emitCurves.ts): verticals → surface/top-band → ties → substrate bridges →
  `emitIntervalCurves` (the tiler) → `emitEnclosedLensCurves` (holes) → `emitBottomTieSubstrate`.
- `emitEnclosedLensCurves` (emitLenses.ts) emits from `col.enclosedLenses` (section-wide extraction)
  into BOTH adjacent gaps, guarded by `facingCarriesMatrix`. This is the natural home for the
  per-gap extraction: session 2 replaces the `col.enclosedLenses` source with a per-gap extraction
  driven by `buildEdgedLayers.inGap(layerId, gapIndex)` (0-corr → lens here; 1-corr → onlap here).
- `tileInterval` (emitIntervals.ts) calls `extractEnclosedLenses(leftUnits, ..., leftFacing)` per
  interval — the bail path. The two-sided restructuring (priority 3) drives this from
  `effectiveCorrForSide` instead of the seam/meetFraction model.

### Next steps (exact, for session 2)
1. **Wire per-gap extraction for the lens-edged class.** In `emitEnclosedLensCurves` (or a new
   sibling `emitPerGapMinorities.ts`), for each gap+side: find enclosed minorities on the column
   (same-formation above+below != own) that are NOT `inGap(layerId, gapIndex)` per `buildEdgedLayers`,
   AND whose `facingCarriesMatrix`. Emit: 0-corr → `emitOne` 0.45 lens (existing path); 1-corr →
   an onlap tip 0.5 riding its tie (reuse `emitSharedContactOnlap`/`emitSurfaceOnlap` machinery).
   CRITICAL: the matrix must be a continuous band around the minority for the hole to trace — but
   the section-wide extraction already merged the OTHER (un-edged) minorities. For an edged minority
   still IN `col.units`, the arrangement must see the enclosing matrix continuous ACROSS the minority
   in THIS gap. This is where holes>0 risk lives (`splitAnnulus` only fires on holes>0; a notch on
   the column edge is holes=0). Verify holes 0/0/0 after EVERY change; if the notch merges, route it
   through `slice.splitAnnulus` / the annulus path (doc §4 Milestone-2 fix pattern:
   `extractEnclosedLenses` body-guard was relaxed + `sliceAnnulus` strip-clip-first).
2. **Un-skip `partitionFillV2.lensEdged.test.ts`**, drive it green. Then re-add the 3rd case (CS1 g3
   SILT onlap) once the 0-corr lens cases pass.
3. **Regression-guard:** after each change re-run conformance (target: 5/14/0 → drops as cases land),
   holes 0/0/0, CS1 7/7, all 6 shape gates, sliceAnnulus, v1 90/90, tsc. The doc warns the
   `routeLoneStack`/extraction change touches 32 currently-OK cases — guard each.
4. **Then priority 3** (two-sided terminations-first): drive `tileInterval` from `effectiveCorrForSide`
   per gap per side — 2→band, 1→onlap tip 0.5, 0→8b-capped lens, BEFORE flooding; re-close residue.
   This is the (a) no-emit pair, (d) untied-pair, and (c) boundary/mixed classes. Section by section,
   Tie-sections first. This is the big restructuring `tileInterval`/`meetFraction` replacement.

### New files this session (all in worktree, NOT committed — orchestrator commits)
- `desktop/src/renderer/src/utils/partitionFillV2/edgedLayers.ts` (foundation helper) — GREEN test
- `desktop/src/renderer/src/utils/partitionFillV2.edgedLayers.test.ts` — 5 cases GREEN
- `desktop/src/renderer/src/utils/partitionFillV2.lensEdged.test.ts` — RED target (describe.skip)
- `REWRITE_STATE.md` (this file)
- STUBS to delete (couldn't rm): `partitionFillV2.throwaway_probe.diag.test.ts`,
  `scripts/throwaway_probe_edged.mjs`, `scripts/throwaway_probe_extract.mjs`

### Verification snapshot (end of session 1)
- tsc clean · conformance 5/14/0=19 (UNCHANGED — engine untouched) · holes 0/0/0 · CS1 7/7 ·
  shape gates (strict210/loneSidePinch/simplerings/twoSidedTermination/bandAuthority/derivedTieOnlap)
  24/24 · sliceAnnulus + arrangement + computeSectionFillV2 + vacancyClosure 32/32 ·
  edgedLayers 5/5 · v1 90/90 · crossgap overlap = 21 rows (pre-existing, reporter). NO engine
  code changed this session — only a new pure helper + tests + a skipped RED gate.

---

## 5. Session-2 plan & progress

**Priority 1 (per-gap extraction for the lens-edged class):** ATTEMPTED, REVERTED — a bolt-on
regresses the must-stay holes/overlaps gate (0/0/0). Root wall confirmed architecturally (below).
**Priority 2 (un-skip lensEdged → green):** NOT ACHIEVED — restored to `describe.skip` (still RED
against the engine; the fix needs the interval restructuring). VERIFIED it goes RED when un-skipped.
**Priority 3 (regression-guard):** GREEN SUB-STATE — full baseline restored, nothing regressed.
**Priority 4 (two-sided `tileInterval` restructuring):** NOT STARTED — deliberately not begun; a
partial `tileInterval` change violates ruling 7 (no gaps) and the per-milestone holes-0/0/0 bar
(design §4 "Terminate-by-default" row says it "cannot land as one increment" with that bar). It is
the real fix for ALL of residual (a)/(b)/(c)/(d) + the 8b cap; it is a multi-day dedicated increment.

### Session-2 progress log
- 2026-07-15 session 2. Re-established the exact baseline (conformance 5/14/0=19, 8e=50, holes
  0/0/0, CS1 7/7, all shape gates 36/36, v1 90/90, crossgap shared-column 17, tsc clean). Read the
  full design doc + sectionGeom/emitLenses/emitIntervals/emitIntervalLenses/emitLonePinch/
  emitLoneStack/labelFaces/slice/sliceAnnulus/facingMatrix.
- **VERIFIED the RED gate.** Un-skipped `partitionFillV2.lensEdged.test.ts`: both cases RED
  (CS1 g22 SILT → band, CS2 g21 SILT → absent). Restored to `describe.skip` at session end.
- **Real-data structure probe (throwaway, now neutralised).** Dumped the exact enclosing stacks +
  per-gap edged state + rendered regions for the two targets. Findings crystallised the wall (below).
- **BUILT + WIRED + MEASURED + REVERTED** a per-gap enclosed-minority emitter
  (`emitPerGapMinorities.ts`, now an inert documented stub): per gap+side it found the lens-edged
  minorities via `buildEdgedLayers.inGap`, synthesized an enclosing-matrix FLOOD band across the
  minority + a 0.45 lens notch, keeping the column un-merged. RESULT: **regressed holes/overlaps**
  (Tie-6 holesAboveTD 0→29; CS1 g22 SILT-lens×ZAND-quad 6.6 cm overlap; Tie-7 0.7 cm). Reverted
  clean — baseline byte-restored (holes 0/0/0, conformance 5/14/0, CS1 7/7, all gates green).

### THE WALL (mechanism, confirmed on real data — the load-bearing session-2 finding)
The lens-edged class (CS1 g22 SILT u1; CS2 g21 SILT u6) is a minority enclosed by ONE same
formation M above+below on its own column, edged ONLY in the ADJACENT gap. TWO facts make it
un-fixable by a bolt-on:

1. **Column merge is UNSAFE.** `sectionGeom.extractEnclosedLenses` makes the enclosing band an
   ANNULUS (so the minority is an interior HOLE → `slice.splitAnnulus` handles it) by SPLICING the
   minority + its enclosing BELOW unit out of the column. But the column is SHARED across both
   adjacent gaps. In BOTH targets the enclosing BELOW matrix unit is edged in the adjacent gap
   (CS1 g22 u2 ZAND edged g21; CS2 g21 u7 ZAND edged g20), so splicing it out to merge the band
   DESTROYS that gap's tie. No column-global merge can serve this class. (The section-wide
   `edgedLayerIds` guard is coarse, but making it per-gap does NOT unblock the merge — the merge
   itself is the unsafe operation, not the guard.)
2. **Without the merge, the notch RIDES the column edge (holes=0).** The un-merged matrix-above
   and matrix-below verticals are collinear on the same column x, so the minority's lens notch is a
   NOTCH biting the column edge, not an INTERIOR hole. `slice.splitAnnulus` fires only on
   `face.holes.length>0`, so it never separates the notch; the enclosing SAME-FORMATION band face
   (already emitted by the interval tiler as a matched-pair band) geometrically absorbs it. A
   bolt-on flood band to force separation just DUPLICATES that band face → measured overlap. And
   the notch apex curves do not cross a flood curve, so `intersect.ts` won't register a separated
   sub-loop (the 613-hole trap forbids relaxing that).

CONCLUSION: this is the SAME `splitAnnulus`-bypass / flood-absorbs-the-lens wall the design doc §4
documents for the 8-absent class. The ONLY hole-free fixes are (i) the two-sided terminations-first
`tileInterval` restructuring (emit each unit's termination BEFORE the band/flood so the band never
claims the minority's slot), or (ii) a notch-splitter that separates an edge-riding notch at
holes=0 (a new arrangement/slice mechanism, `intersect.ts`-adjacent → high risk). Both are the
dedicated §4 increment, not a session-2 bolt-on. Recorded as RED-by-design; NOT reverted-away —
the green baseline is preserved and the RED gate + foundation stay for the restructuring session.

### Session-2 verification snapshot (green sub-state)
- tsc clean · conformance **5/14/0=19** (UNCHANGED) · 8e-enclosure 50 · reach-cap adv 2 ·
  holes **0/0/0** · CS1 gates **7/7** · shape gates (strict210/loneSidePinch/simplerings/
  twoSidedTermination/bandAuthority/derivedTieOnlap) + edgedLayers + sliceAnnulus **36/36** ·
  v1 **90/90** · crossgap shared-column **17** (≤21 baseline). Engine output byte-identical to
  session-1 end (all engine edits reverted).

### Files this session (worktree, NOT committed)
- `emitPerGapMinorities.ts` — INERT STUB (documents the failed bolt-on + the wall). Orchestrator
  should `rm` it (bash rm denied here). It is unwired; `emitCurves.ts` is byte-restored.
- `partitionFillV2.throwaway_lensedged.diag.test.ts` — INERT no-op stub. Orchestrator should `rm`.
- `partitionFillV2.lensEdged.test.ts` — UNCHANGED from session 1 (describe.skip, still the RED
  target). Verified genuinely RED when un-skipped.
- `REWRITE_STATE.md` — this update.

### Next steps (for session 3 — the interval restructuring is now unavoidable)
1. **Do NOT retry a bolt-on emitter** (proven to regress holes — see THE WALL). The class needs the
   two-sided terminations-first `tileInterval` replacement (design §4 "Terminate-by-default" +
   §8c). Drive `tileInterval`/the lone-side router from `effectiveCorrForSide` PER GAP PER SIDE:
   for each unit emit its own termination curve FIRST (0→8b-capped lens; 1→onlap tip 0.5 riding its
   tie; 2→band) so the enclosing same-formation band NEVER claims the minority's slot, THEN tile the
   residue. The `effectiveCorr.ts` shared helper + `edgedLayers.ts` (session 1) are the ready
   foundation.
2. Section-by-section, Tie-sections first (fewest cols). Re-run holes 0/0/0 + CS1 7/7 + all shape
   gates + conformance after EVERY section — the `routeLoneStack` change touches 32 currently-OK
   cases (guard each). Do NOT touch `intersect.ts` / `seamAnchor.ts` (613-hole trap).
3. Un-skip `partitionFillV2.lensEdged.test.ts` only when the two targets terminate hole-free.
4. This is genuinely a multi-day dedicated increment matching the design's Wk-2 closing-curve
   work — budget it as such; do not expect a one-session close.

---

## 6. Session-3 plan & progress — THE REWRITE IS BEGUN (scaffold + single-single + wiring)

Session 3 STARTED the `tileInterval` restructuring per the protocol clarification (a
half-rewritten, flag-gated, partially-red `tileGap` path is the EXPECTED end state). No
re-diagnosing, no reverting — built forward. The flag-OFF default is BYTE-IDENTICAL to the
session-2 baseline (full battery green); the new path is behind a runtime flag and validated
per-section by a throwaway oracle.

### Architecture built (all in the worktree, NOT committed — orchestrator commits)

1. **`partitionFillV2/tileFlags.ts`** (NEW) — the cut-over flag. `twoSidedTerminationsEnabled()`
   / `setTwoSidedTerminations(value): prevValue`. Runtime-mutable (mirrors `ENABLE_ENCLOSED_LENS`
   but toggleable so a test/oracle flips it without a rebuild). Default **OFF**. Because the v2
   engine has NO section identity threaded through `computeSectionFillV2` (columns/edges/alongM
   only), the cut-over is a MODULE-LEVEL flag, not a per-section switch — the per-section
   validation happens in the oracle (flip flag, read THAT section's rows). Flipping default→ON +
   deleting the old seam path is the cut-over.

2. **`partitionFillV2/tileGap.ts`** (NEW) — the terminations-first two-sided tiler
   `tileGapTwoSided(ctx, nextId, nextFloodId, lensLabels, out): boolean`. Driven by
   `effectiveCorrForSide` (session-1 foundation). Structure:
   - `withCorr(matrix, col, corr)` maps each interval matrix unit back to its column unit index
     → carries its per-gap 2/1/0.
   - **SINGLE-SINGLE different-formation** (`tileSingleSingle`): IMPLEMENTED + correct. Each side
     one unit of different formations → each terminates by its own corr (1 → `emitSharedContactOnlap`
     onlap tip 0.5; 0 → `emitLensClosing` 0.45 lens + a facing-column flood band). The facing
     formation floods the vacated wedge (differs from the terminating unit by construction, so
     `chooseOnlapEnclosing` always picks a real neighbour band — never a same-formation re-merge).
     ALL-OR-NOTHING: buffers into a local `buf`/`labelPatch`, merges into `out`/`lensLabels` only
     on full success (a partial emit + the caller's seam-fallback would double-cover — ruling 7).
   - **MULTI-UNIT two-sided**: bails (returns false → seam tiler) with a diag reason. This is the
     core residual, NOT yet implemented (see §6 next-steps).
   - THROWAWAY diag counters `TILEGAP_DIAG` / `tileGapDiagReset()` (marked THROWAWAY; only bumped
     when the flag is on = never in default output) record the per-interval bail taxonomy. The
     orchestrator should strip this block at cut-over. `intersect.ts`/`seamAnchor.ts` UNTOUCHED.

3. **`emitIntervals.ts`** (WIRED) — `emitIntervalCurves` now computes `leftCorr`/`rightCorr` per
   gap via `effectiveCorrForSide` (shared with the conformance gate's arithmetic) and threads them
   through `emitGapIntervals` → `tileInterval`. Inside `tileInterval`, AFTER the enclosed-lens
   extraction + lone-side + same-formation-band early returns and BEFORE the seam model, when
   `twoSidedTerminationsEnabled()` it calls `tileGapTwoSided`; on `true` it returns (skips the
   seam), on `false` it falls through to the unchanged seam model. `LonePinchBracket` and the
   local `Bracket` are structurally identical (leftElev/rightElev/anchor) — passed directly.
   (File is now 537 lines — over the 500 warn; the real logic is in `tileGap.ts`, the growth here
   is only the import + the ~15-line routing block. Acceptable per the extraction rule.)

### Per-section cut-over status (the oracle: `scripts/diag_tilegap_probe.json`)

Flag-ON grand conformance == flag-OFF grand == **5/14/0** (single-single fires on ZERO real
intervals — every real offender is multi-unit/lone/termbail, exactly as the design predicted).
NOTHING regressed; the new path is inert-on-real-data BY SCOPE, not by accident.

**Bail taxonomy for the 14 sections (why `tileGapTwoSided` did/didn't fire):**
- `fired` = 0 across ALL sections (single-single matches no real offender).
- `multiunit-L*-R*` — the CORE case: Tie-8 (L4/R2), Tie-10 g0 (L2/R3), CS3 (L1/R2), CS1 (L1/R2 +
  L4/R1). A stack facing a stack; per-unit terminations need the vacated-space re-closure.
- `lone` — Tie-12, CS1×7, CS2×4: reached the two-sided tiler with one matrix side EMPTY (the
  lone-side router `routeLoneSidePinch` already returned false for these = data-void/bail); they
  are the boundary/mixed absent class.
- `termbail` — Tie-11, CS3×2, CS2: single-single reached but the unit does NOT fill its interval
  side (the ±0.02 fill-check fails — a strip would be uncovered); needs the sub-strip split.

**Tie-10 g0 (the smallest violation section) traced concretely** (`scripts/diag_tie10.json`):
the offending render is a full-width ZAND `quad` el[-2.69..4.05] — L u5 ZAND [-2.69..3.57] and
R u3 ZAND [-2.29..3.55] (both 1-corr, tied to OTHER contacts, NO matched-pair ZAND band in the
gap so NOT 8e-exempt) are the SAME formation at overlapping elevation, so the seam tiler /
geometric-band merges them into ONE full-width ZAND face. Flag-ON == flag-OFF here (bails
multiunit-L2-R3). The correct render = each onlaps its own tie; the ZAND slot between is NOT one
band. This is the retired geometric same-formation auto-match (ruling 8) surfacing in the
MULTI-UNIT two-sided path.

### Verification snapshot (end of session 3)

- **flag OFF (default engine output): BYTE-IDENTICAL to session-2 baseline** — conformance
  **5/14/0=19**, 8e 50, reach-cap 2, q3 5 · holes **0/0/0** · CS1 **7/7** · shape gates
  (strict210/loneSidePinch/simplerings/twoSidedTermination/bandAuthority/derivedTieOnlap/
  edgedLayers/sliceAnnulus) + computeSectionFillV2 + arrangement + vacancyClosure **61/61** ·
  v1 **90/90** · tsc clean.
- **flag ON: grand conformance UNCHANGED (5/14/0)** — the single-single path fires on zero real
  intervals; no section regressed. Multi-unit/lone/termbail all bail to the seam tiler (the
  intentional intermediate RED — the seam tiler keeps its full-width leak on those intervals).

### Session-3 files (worktree, NOT committed)

- `partitionFillV2/tileFlags.ts` (NEW, committed-quality) — the cut-over flag.
- `partitionFillV2/tileGap.ts` (NEW) — terminations-first tiler; single-single done, multi-unit
  bails. Carries a THROWAWAY `TILEGAP_DIAG` block (strip at cut-over).
- `partitionFillV2/emitIntervals.ts` (EDITED) — corr arrays threaded + `tileGapTwoSided` routing
  behind the flag. Flag-off byte-identical.
- STUBS to delete (bash rm denied here): `partitionFillV2.throwaway_tilegap_probe.diag.test.ts`,
  `partitionFillV2.throwaway_tie10probe.diag.test.ts`, `scripts/diag_tilegap_probe.json`,
  `scripts/diag_tie10.json`. The probe is the per-section oracle — session 4 can regenerate it
  (SHAPE_AUDIT=1 gates it; it flips the flag + classifies + writes the JSON).
- Session-1/2 stubs still pending orchestrator rm (emitPerGapMinorities.ts, the two throwaway
  lensedged/probe tests).

### Next steps (session 4 — the MULTI-UNIT two-sided terminator is the load-bearing work)

1. **Implement the MULTI-UNIT two-sided case in `tileGap.ts`.** The mechanism (design §4
   "Terminate-by-default", ruling 8c): for a stack-facing-stack interval, emit EACH unit's own
   termination (2 → already a band member, excluded upstream; 1 → onlap tip 0.5 riding its tie;
   0 → 8b-capped 0.45 lens) FIRST, then re-close the vacated space between the two sides'
   terminations. The re-closure is exactly what increments 8-18 solved for the LONE side only —
   generalise it to two-sided. Two candidate constructions (evaluate both against holes 0/0/0):
   (a) **sub-strip decomposition** — split `[top,base]` at the union of both sides' internal
   contact elevations; each sub-strip presents ONE left + ONE right formation → a single-single
   cell; guard against a unit double-emitting its termination across its multiple strips (emit
   the pinch once, tile the unit's other strips with a plain flood).
   (b) **per-unit pinch + midpoint-seam residue** — each unit onlaps/lenses toward the gap; the
   residue between the two sides' notch chains closes at a seam (the seam tiler's meet fraction,
   but AFTER the terminations carve their notches so no same-formation merge). Higher hole risk
   at the notch/seam junctions.
   Start with Tie-10 g0 (L2/R3, the smallest) — its offender (same-formation ZAND at overlapping
   elevation, each 1-corr) is the canonical multi-unit same-formation-auto-match leak. Validate
   with the probe (flip the flag, read Tie-10's rows), then holes 0/0/0 on Tie-10, then widen.
2. **Then the `lone` class** (Tie-12, CS1, CS2): these reach the two-sided tiler with one side
   empty because `routeLoneSidePinch` bailed (data-void). Decide whether they belong in `tileGap`
   (a two-sided-with-empty-side termination) or need the lone-side router relaxed. The state-file
   class (b)/(c) (lens-edged, boundary/mixed) live here.
3. **`termbail`** (Tie-11, CS3, CS2): single-single reached but the unit doesn't fill its interval
   side — the sub-strip split (1a) subsumes this.
4. **Regression-guard EVERY change** with the frozen battery (holes 0/0/0, CS1 7/7, all shape
   gates, v1 90/90, tsc) AND the per-section probe — the design warns the routeLoneStack/two-sided
   change touches 32 currently-OK cases. Do NOT touch `intersect.ts`/`seamAnchor.ts` (613-hole trap).
5. **Un-skip `partitionFillV2.lensEdged.test.ts`** only when the two lens-edged targets terminate
   hole-free.
6. **At cut-over-ready:** flip `tileFlags` default→ON, strip the `TILEGAP_DIAG` throwaway block,
   delete the old seam model in `tileInterval` (`meetFraction`/`emitSideSubSeams` seam path),
   re-run the full battery, then the v2 frozen snapshot + owner dogfeed.

---

## 7. Session-4 plan & progress — MULTI-UNIT terminator: sub-strip NEGATIVE result + same-formation infra

Session 4 built forward on the two-sided terminator. NO net conformance drop landed (flag-ON stays
**19**, flag-OFF byte-identical) — but the multi-unit approach was PROVEN OUT (sub-strip = measured
negative), the same-formation single-single termination shipped as correct-but-inert infrastructure,
and **Tie-section 10 g0 is now diagnosed to the exact defect + owning interval**, which overturns the
"L2/R3 same-formation ZAND merging" framing the session-3 hand-off carried.

### Per-section flag-ON scoreboard (the oracle: `scripts/diag_tilegap_probe.json`, SHAPE_AUDIT=1)

Flag-ON grand == flag-OFF grand == **5 `0corr-not-lens` / 14 `1corr-not-onlap` / 0 = 19**; holes
**0/0/0**; overlaps **0**; 8e-enclosure 50; reach-cap 2. Per-section 1corr/0corr violation counts:
Tie-4..9,11,13,14 = 0/0; **Tie-10 = 3/1**; Tie-12 = 1/0; CS3 = 0/0; **CS1 = 7/4**; CS2 = 3/0.
Bail taxonomy (flag ON): `sameFormation-8e`=4 (correctly kept as one body), `sameFormation-bail`=2
(CS1 g19 ZAND, corr=2 BOTH sides = legit first-unit-topband bands, correctly kept), `lone`=24,
`termbail`=8, multiunit fans (L4-R2 ×2, L2-R3 ×2, L1-R2 ×4, L4-R1 ×2). `multiunit-fired`/
`sameFormation-fired` = **0** (fire on zero real intervals — see below).

### Tie-section 10 g0 — DIAGNOSED to the interval (the session-4 load-bearing finding)

The section's 4 violations are NOT one mechanism. Captured via the tileGap-entry probe
(`tie10capture` / `t10regions` in the dump):
- **Interval A** `[topBand 12.94/11.84 .. anchor 4.05/3.549]`: L{ZAND[12.59,12.94], KLEI[4.05,12.59]},
  R{SILT[6.44,11.84], **ZAND[R1][5.73,6.44]**, KLEI[3.549,5.73]} → reaches `tileGapTwoSided` as
  multi-unit L2/R3. The ONLY violation here is **ZAND[R1] 0-corr ABSENT** — a thin minority enclosed
  by SILT above / KLEI below (DIFFERENT formations, so `extractEnclosedLenses` never pulls it), tiled
  by the seam and swallowed. Needs a mixed-bracket lens carved for it.
- **Interval B** `[anchor 4.05/3.549 .. anchor -2.69/-2.29]`: L{SILT[3.57,4.05], ZAND[-2.69,3.57]},
  **R matrix EMPTY** (the right ZAND[R3] is BOTH-tied → excluded as "fully banded"; KLEI[R2]/KLEI[R4]
  banded) → `lone` bail. `routeLoneStack` returns null because the enclosing matrix (KLEI, from the
  own-column bracket) is NOT in the stack {SILT,ZAND}, AND the facing right column carries KLEI/ZAND/
  KLEI (not one continuous KLEI) → no clean full-width flood. This is a STACK-OF-MINORITIES lone
  interval facing REAL tied material (the excluded facing units make it a FALSE lone).
- **Rendered `ZAND quad [0..1] el[-2.69..4.05]` (region 6)** = ZAND[L3] (interval B, rendered
  full-width because the lone bail) merged with ZAND[R3]'s both-tied band at the ARRANGEMENT level
  (`labelFaces` promotes a 2-column-spanning same-formation face to BAND). So the ZAND full-width leak
  is ROOTED IN INTERVAL B (the lone class) + the arrangement's same-formation promotion — **NOT** a
  same-formation single-single merge and **NOT** a multi-unit `tileGapTwoSided` merge (the session-3
  "retired auto-match in the multi-unit path" framing was imprecise; trust this data).

### What LANDED (correct, non-regressing, mostly inert on real data)

1. **`tileInterval` reorder (`emitIntervals.ts`, flag-ON only):** the `tileGapTwoSided` call now runs
   BEFORE the geometric same-formation early-return (so a same-formation single-single can be
   terminated instead of always merged). Flag-OFF path unchanged (the two-sided block is skipped, the
   geometric early-return runs exactly as before) → **byte-identical baseline**. `bandFormations`
   (the gap's `collectGapBands` formation set) threaded through `tileInterval` → `TileGapContext`.
2. **Same-formation single-single termination (`tileGap.ts` `tileSameFormationTwoSided` +
   `emitSameFormSide`):** ruling-8 opposing terminations for two facing same-formation units with NO
   matched-pair band of that formation; the enclosing floods from the OWN-column bracket neighbour
   (never the same-formation facing — that re-merges, the wall) via `chooseOnlapEnclosing`. Ruling-8e
   gated (`ctx.bandFormations.has(lf)` → keep the geometric merge). **Fires on ZERO real intervals**:
   every real same-formation single-single is either 8e-banded (4) or a 2-corr first-unit-topband band
   (2, CS1 g19). Correct infrastructure, no counter movement — the same-formation full-widths in the
   real data are all legitimately one body.
3. **Multi-unit sub-strip decomposition (`tileMultiUnit.ts`, NEW, GATED OFF):** split the interval in
   fraction space at the union of both sides' internal contacts; route each single-left/single-right
   sub-strip through `emitSideTermination`. **MEASURED NEGATIVE (the session-4 record):** flag-ON
   holes 0→**164 above-TD**, overlaps 0→**8**, conformance 19→**21** (Tie-8 + CS3, both previously
   clean, regressed). ROOT of the regression: a sub-strip where BOTH sides are "main" units must MEET
   AT A SEAM (each fills to ~0.5), NOT double-lens — two adjacent single-single cells each flood the
   facing column full-height of THEIR strip with no coherent shared seam → a hole/overlap at every
   internal contact. Extracted to its own module (tileGap.ts back to 454 lines) and gated
   `MULTIUNIT_SUBSTRIP_ENABLED=false`; the skeleton is reused by session 5, not deleted.

### Verification snapshot (end of session 4)

- **flag OFF (default): BYTE-IDENTICAL to session-2/3 baseline** — conformance **5/14/0=19**, 8e 50,
  reach-cap 2 · CS1 **7/7** · shape+arrangement gates (strict210/loneSidePinch/simplerings/
  twoSidedTermination/bandAuthority/derivedTieOnlap/edgedLayers/arrangement/vacancyClosure/
  computeSectionFillV2/sliceAnnulus) **61/61** · v1 **102 pass/7 skip** · tsc clean.
- **flag ON: grand conformance UNCHANGED (5/14/0=19), holes 0/0/0, overlaps 0** — the
  same-formation + multi-unit paths fire on zero real intervals (sub-strip gated off after the
  negative measurement); nothing regressed.

### Session-4 files (worktree, NOT committed)

- `partitionFillV2/tileMultiUnit.ts` (NEW) — sub-strip decomposition, GATED OFF, documents the
  measured negative + the correct session-5 construction. Circular type/value import with tileGap.ts
  (`CorrUnit`/`emitSideTermination`/`FRAC_EPS`/`TileGapContext` now exported from tileGap.ts; the value
  imports are function-body only, so the ESM cycle resolves).
- `partitionFillV2/tileGap.ts` (EDITED) — same-formation two-sided termination + 8e gate;
  `bandFormations` on `TileGapContext`; exports for the extracted module; a THROWAWAY `TILEGAP_CAPTURE`
  interval-structure probe (only bumped when the flag is on = never in default output; strip at
  cut-over with `TILEGAP_DIAG`).
- `partitionFillV2/emitIntervals.ts` (EDITED) — `tileGapTwoSided` moved before the geometric
  same-formation early-return (flag-ON only); `bandFormations` computed + threaded. 546 lines (9 over
  the 500 warn — the threading; the real logic is in tileGap.ts).
- STUBS to delete (orchestrator; bash rm denied here):
  `partitionFillV2.throwaway_tilegap_probe.diag.test.ts` (the per-section oracle — SHAPE_AUDIT=1 gates
  it; session 5 regenerates), `scripts/diag_tilegap_probe.json`. Session-1/2/3 stubs still pending rm
  (`emitPerGapMinorities.ts` [if still present], the throwaway lensedged/probe/tie10 tests + jsons).

### Next steps (session 5 — the interval restructuring is the real work; two concrete sub-targets)

1. **Multi-unit MINORITY carve (Tie-10 g0 interval A — the tractable win).** The multi-unit fan does
   NOT need blanket sub-strip termination (proven to regress). It needs ONLY the enclosed 0-corr /
   1-corr MINORITY (a thin unit whose same-side neighbours differ from it) carved as a lens/onlap; the
   REST of the interval must stay on the SEAM tiler (which is already gap-free). The double-cover wall:
   the seam re-derives the matrix and tiles the minority's slot. Since that slot currently renders
   ABSENT (Tie-10 ZAND[R1], swallowed), FILLING it may be overlap-free — but this must be MEASURED per
   interval (buffer the minority lens, verify no different-litho overlap with the seam output before
   committing; if the seam does render the slot, bail). The mixed-bracket lens is `emitLonePinch`'s
   `forceLens` (SILT top-flood + KLEI base-flood, both differ from ZAND → no absorption). This is the
   notch-splitter-at-holes=0 wall the design §4 flags — the safe form is the buffered-then-overlap-
   checked emit, NOT a blanket carve.
2. **The `lone` class (Tie-10 g0 interval B + Tie-12 + CS1×N + CS2×N — 24 bails, the ZAND-full-width
   ROOT).** These reach the two-sided tiler with one matrix side EMPTY because the facing units are
   all TIED/BANDED (excluded from the matrix) — a FALSE lone facing real material. Interval B is the
   canonical case: a stack-of-MINORITIES {SILT,ZAND} enclosed by KLEI (NOT in the stack), facing a
   KLEI/ZAND/KLEI right column. `routeLoneStack` (emitLoneStack.ts) bails because (a) the enclosing
   matrix is not in the stack and (b) the facing carries no CONTINUOUS matrix run. The fix is NOT a
   full-width flood (the facing is mixed) — it is the two-sided handling that treats the excluded TIED
   facing units as BRACKET CONTEXT (the interval is really two-sided: SILT/ZAND left vs KLEI/ZAND/KLEI
   right, with the right units tied). This is the interval restructuring the design doc flags as the
   multi-day increment. Region 6 (the ZAND full-width) resolves only when interval B's ZAND[L3]
   pinches (a differing flood then separates it from ZAND[R3]'s tied band at the arrangement level).
3. **The same-formation infrastructure is READY** (`tileSameFormationTwoSided`) for any real
   ruling-8 opposing-lens single-single that appears after (1)/(2) reshape intervals — keep it.
4. **Regression-guard EVERY change** with the frozen battery (flag-OFF byte-identical = the safety
   line; holes 0/0/0, CS1 7/7, 61/61 gates, v1, tsc) AND the per-section probe. Do NOT touch
   `intersect.ts`/`seamAnchor.ts` (613-hole trap). `MULTIUNIT_SUBSTRIP_ENABLED` stays OFF until the
   single-coherent-seam-with-notches construction replaces the blanket sub-strip flood.

---

## 8. Session-5 plan & progress — BOTH ranked sub-targets ATTEMPTED, BOTH measured NEGATIVE (precise roots)

Session 5 built forward on both §7 sub-targets. NO net conformance change landed (flag-ON stays
**19**, flag-OFF byte-identical) — but each target was implemented, WIRED, MEASURED with a
one-run flag-ON harness, and gated OFF after a measured regression, with the exact defect root and
the session-6 construction recorded. Tie-10 g0's TRUE defect set was also refined (one of its four
gate flags is a false positive). `intersect.ts`/`seamAnchor.ts` UNTOUCHED; `emitLoneStack.ts`
byte-restored (a `preferMatrix` experiment reverted clean).

### Scoreboard (end of session 5)

- **flag OFF (default): BYTE-IDENTICAL to session-2/3/4 baseline** — conformance **5/14/0=19**, 8e 50,
  reach-cap 2 · holes **0/0/0** · CS1 **7/7** · shape+arrangement gates (strict210/loneSidePinch/
  simplerings/twoSidedTermination/bandAuthority/derivedTieOnlap/edgedLayers/arrangement/vacancyClosure/
  computeSectionFillV2/sliceAnnulus) **61/61** · v1 **163 pass / 18 skip** · tsc clean.
- **flag ON: grand conformance UNCHANGED (5/14/0=19), holes 0/0/0, overlaps 0** — the two new paths
  are gated OFF after their negative measurement; the `tileGapTwoSided`-before-`routeLoneSidePinch`
  reorder (flag-ON only) is behavior-neutral (verified: no changed sections).

### Tie-10 g0 refined — 3 of its 4 gate flags are REAL, one is a GATE FALSE POSITIVE

Rendered regions (flag OFF == flag ON, both engines identical on this section): SILT lens[f0-0.45,
el3.57-4.05], SILT onlap[f0.5-1, el3.549-12.39], VEEN lens, KLEI pinch[f0-1], KLEI quads, and the
leak **ZAND quad[f0-1, el-2.69..4.05]** (one full-width face spanning both columns).
- **SILT[L,3.57,4.05] `1corr-not-onlap` = GATE FALSE POSITIVE.** The engine renders it correctly as
  a lens (the SILT lens region above). The gate reads `band` only because a DIFFERENT SILT region —
  the facing SILT onlap[f0.5-1] — overlaps the same elevation band, so `renderedShape` unions both
  SILT pieces to fLo0..fHi1. Same-formation-onlap-at-same-elevation gate scoping, like ruling 8e.
  (Not fixed this session — flagged for a possible gate rescope; NOT engine work.)
- **ZAND[L,-2.69,3.57] + ZAND[R,-2.29,3.549] `1corr-not-onlap` (2 flags, ONE region)** = the REAL
  ZAND full-width leak. `routeLoneStack` fires on interval B (lone-left {SILT top-tied, ZAND
  base-tied}), picks ZAND as the flood matrix (`facingMatrixLabel(conv)` = the facing ZAND band),
  floods it full-width + SILT as a lens; the flood ZAND then merges with the facing ZAND both-tied
  band at the arrangement level. (Note: session-4 said routeLoneStack *bails* interval B — WRONG;
  it FIRES and floods. Trust this session.)
- **ZAND[R,5.73,6.44] `0corr-not-lens` absent** = interval A's mixed-bracket minority (SILT above /
  KLEI below), swallowed by the seam.

### Target 2 (§7 step-1) — MULTI-UNIT MINORITY CARVE: measured NEGATIVE (+43 overlaps)

`carveMultiUnitMinority` (`tileMultiUnit.ts`, flag `MULTIUNIT_MINORITY_CARVE_ENABLED`) emits each
enclosed mixed-bracket 0-corr minority (same-side neighbours both present + both differing) as a
0.45 `emitLonePinch` `forceLens`, additively to `out`, then returns false so the seam tiles the
rest. Measured flag-ON: Tie-10 0corr **1→0** (ZAND[R1] fixed) BUT **+43 different-litho overlaps**
+ a new Tie-8 1corr regression → conformance 4/15/0 (=19 still). ROOT: the seam's enclosing cells
(SILT above / KLEI below) already fill the minority's el-slot — that is WHY it renders absent — so
the added ZAND notch OVERLAPS them; the mixed-bracket notch rides the column edge (holes=0) so the
arrangement never separates it (the `splitAnnulus`-bypass wall). An additive carve cannot work; the
minority must be REMOVED from the seam's matrix so the seam leaves a real hole. GATED OFF.

### Target 1 (§7 step-2) — LONE-SIDE TERMINATION: measured NEGATIVE (+457 holes / +666 overlaps)

`tileGapLone` (NEW `tileLone.ts`, flag `LONE_TERMINATION_ENABLED`, wired into `tileGapTwoSided`'s
lone branch, which now runs BEFORE `routeLoneSidePinch` under the flag) terminates each lone-side
unit against the excluded tied-band context by its own corr (1 → `emitSharedContactOnlap` with the
DIFFERING own-column neighbour flooding via `chooseOnlapEnclosing`; 0 → `emitLonePinch` forceLens),
scoped to fully-bracketed lone stacks whose formation matches a facing band. Measured flag-ON:
conformance **19→17** (right DIRECTION: Tie-6/CS1/CS2 dropped a 1corr each) BUT **holes 0→457,
overlaps 0→666**. ROOT: N independent per-unit `emitLonePinch` wedges do NOT compose into a
partition — they overlap/gap at their shared conv/apex edges. A lone STACK needs a SINGLE coherent
flood boundary (the enclosing matrix descending as ONE face bounded by every unit's pinch), which is
exactly what `routeLoneStack`'s slab-seam decomposition already does hole-free — its ONLY bug is
picking a same-formation flood matrix. GATED OFF. (Tie-10 g0 interval B did NOT even fire the scope
guard — but the 457 holes on other sections are disqualifying regardless.)

### The KEY session-6 lead (from the `preferMatrix` probe, reverted): interval B is TWO STACKED
### PINCHES MEETING, NOT one-matrix-floods

Tried making `routeLoneStack` flood the NON-facing-band stack formation (SILT) instead of ZAND
(added + reverted a `preferMatrix` param — `emitLoneStack.ts` byte-restored). It CAN'T flood SILT
full-width because `facingMatrixRunSpan(facing, SILT)` bails — the facing is ZAND, not SILT, so SILT
has no facing run to band to. That is the tell: **interval B is not a "one matrix floods full-width"
shape at all.** The correct render (owner §7: "ZAND[L] pinches, a differing flood separates it from
ZAND[R]'s band") is TWO STACKED PINCHES — SILT onlaps DOWN from the top tie, ZAND onlaps UP from the
base tie, meeting at a mid seam, with the facing ZAND band kept separate. This is a genuine
sub-elevation two-sided partition (the seam tiler's meet, but with per-unit pinches, NOT a flood).
The session-4 sub-strip + these two negatives all point to the SAME missing primitive: a
**single-coherent-flood / seam-with-notches** builder that closes a lone (or multi-unit) stack of
mixed terminations into one hole-free face set. That primitive is the session-6 deliverable; the two
gated-OFF skeletons (`tileLone.ts`, `tileMultiUnit.ts` carve) are its starting points.

### Session-5 files (worktree, NOT committed)

- `partitionFillV2/tileLone.ts` (NEW) — lone-side terminations-first tiler, GATED OFF
  (`LONE_TERMINATION_ENABLED=false`); documents the measured negative + the session-6
  single-coherent-flood construction. Imports type-only from `tileGap.ts` (ESM cycle resolves —
  value import is `tileGapLone` into `tileGap.ts`, function-body only).
- `partitionFillV2/tileMultiUnit.ts` (EDITED) — added `carveMultiUnitMinority` + flag
  `MULTIUNIT_MINORITY_CARVE_ENABLED=false` (measured negative documented in the flag's doc-block);
  `emitLonePinch` import added.
- `partitionFillV2/tileGap.ts` (EDITED) — lone branch calls `tileGapLone` behind
  `LONE_TERMINATION_ENABLED` (`lone-fired` diag); multi-unit branch calls `carveMultiUnitMinority`
  behind `MULTIUNIT_MINORITY_CARVE_ENABLED`. Both flags OFF → flag-ON output unchanged.
- `partitionFillV2/emitIntervals.ts` (EDITED) — flag-ON only: `tileGapTwoSided` now runs BEFORE
  `routeLoneSidePinch` (so the lone path can own the interval). Flag-OFF path byte-identical (the
  whole block is skipped). 548 lines (over the 500 warn — the reorder; real logic in tileGap/tileLone).
- `partitionFillV2/emitLoneStack.ts` — BYTE-RESTORED (the `preferMatrix` experiment reverted clean).
- STUBS to delete (orchestrator; bash rm denied): `partitionFillV2.throwaway_lonecapture.diag.test.ts`
  (the session-5 flag-ON measurement harness — now a `describe.skip` no-op) + `scripts/diag_lone_capture.json`.
  Session-4 stub `partitionFillV2.throwaway_tilegap_probe.diag.test.ts` + `scripts/diag_tilegap_probe.json`
  were already removed by the orchestrator; the `TILEGAP_DIAG`/`TILEGAP_CAPTURE` blocks in tileGap.ts
  are STILL THROWAWAY (strip at cut-over).

### Next steps (session 6 — build the single-coherent-flood primitive; it unlocks BOTH classes)

1. **Build the single-coherent-flood / seam-with-notches primitive.** For a lone (or multi-unit)
   stack of mixed terminations, the enclosing matrix must descend as ONE continuous flood face
   bounded by EVERY unit's pinch — NOT N independent `emitLonePinch` wedges (proven +666 overlaps).
   The template is `routeLoneStack.emitLoneStackBand` (slab-seam decomposition — it IS hole-free):
   generalise it to (a) a mixed enclosing that CHANGES lithology down the stack (SILT above, KLEI
   below), and (b) a non-flooding pinch that MEETS a facing tied band at a seam rather than banding
   to the facing column. Prove on Tie-10 g0 interval B (SILT onlaps down / ZAND onlaps up / meet at
   mid seam / facing ZAND stays a separate band), holes 0/0/0, then the other 23 lone bails.
2. **Then the multi-unit minority (interval A):** the same primitive removes ZAND[R1] from the seam
   matrix (leaves a real hole) instead of the additive carve — so no overlap. Fold it in after (1).
3. **Fix the SILT[L] gate false positive at the GATE** (same-formation-onlap-at-same-elevation
   scoping, ruling-8e class) — a `sameFormationEnclosedByTiedBand`-style guard for onlap overlap.
   This drops the honest Tie-10 count from 4 to 3 without engine work.
4. **Regression-guard EVERY change** with the frozen battery (flag-OFF byte-identical safety line;
   holes 0/0/0, CS1 7/7, 61/61 gates, v1, tsc) AND the one-run flag-ON harness (regenerate the
   throwaway if the orchestrator removed it — measure OFF vs ON holes/overlaps/conformance in one
   pass). Do NOT touch `intersect.ts`/`seamAnchor.ts` (613-hole trap). Both session-5 flags
   (`LONE_TERMINATION_ENABLED`, `MULTIUNIT_MINORITY_CARVE_ENABLED`) + `MULTIUNIT_SUBSTRIP_ENABLED`
   stay OFF until the coherent-flood primitive replaces the independent-wedge / additive-carve forms.

### ⚠ BASELINE MOVED on develop (2026-07-16 overnight, post-session-5 — MERGE develop before session 6)

Four review-driven changes landed on develop AFTER the session-5 checkpoint; the worktree is behind:

1. **Ruling 8b SHIPPED** (`4d09864ed`): `partitionFillV2/lensReach.ts` caps every 0-corr lens at
   min(0.45 × gap, 2 × thickness); all five emission paths route through it; overrides un-capped.
   Conformance moved 19 → 17 (1corr 14 → 12, 8e-enclosure 50 → 48).
2. **Q4 covers bridges** (`c89d347d3`): `partitionFillV2/crossingConflicts.ts` — ONE canonicalised
   pass over adjacent ties AND jump bridges before any emission; suspended edges drop from all
   paths; `emitCurves.pruneCrossingTies` is GONE. Session-6 code touching emitCurves must respect
   the `survivingSection` filter.
3. **Conflict warning wired** (`6fc6fd769`-1 / the feat chip commit): selector has a
   `computeSectionFillActiveWithDiagnostics` variant; PartitionFillOverlay renders
   `CrossingTieWarningChip` on conflicts.
4. **Gate is connected-component aware** (`6fc6fd769`): step 3 above ("fix SILT[L] at the GATE") is
   ALREADY DONE — the classifier now reports the component incident to the audited unit's own
   column edge. Tie-10 honest count is 3. **NEW BASELINE: 16 violations = 5 / 11 / 0** (was
   5/14/0=19 at session-5 end). The one-run flag-ON harness must be re-baselined against this.

---

## 9. Session-6 plan & progress — the COHERENT-FLOOD MEET-AT-SEAM primitive SHIPPED (measured net win); interval B is a CONFIRMED geometric obstruction

Session 6 built the single-coherent-flood / seam-with-notches primitive
(`partitionFillV2/tileCoherent.ts`), proved it hole-free on a synthetic fixture (TDD red→green),
wired it into the lone branch of `tileGapTwoSided`, and MEASURED it on all 14 real sections in one
run. It REPLACES the session-5 `tileLone.ts` N-wedge negative (that skeleton is now orphaned →
orchestrator `rm`). NET WIN: flag-ON conformance 16→15 (one `0corr-not-lens` dropped on CS1),
holes 0/0/0, overlaps 0, flag-OFF byte-identical. The named proof target — Tie-10 g0 interval B —
was diagnosed to a REAL geometric obstruction the primitive correctly cannot (and must not) fire on.

### Scoreboard (end of session 6)

- **flag OFF (default engine output): BYTE-IDENTICAL to the merged baseline** — conformance
  **5/11/0=16**, 8e-enclosure 48, reach-cap 2, q3 5 · holes **0/0/0** · overlaps **0** · CS1
  gates **7/7** · shape+arrangement gates (strict210/loneSidePinch/simplerings/twoSidedTermination/
  bandAuthority/derivedTieOnlap/edgedLayers + partitionFillV2/ package [arrangement/vacancyClosure/
  computeSectionFillV2/sliceAnnulus/lensReach]) + the NEW `coherentLoneStack` gate = **73 pass** ·
  v1 pure-geometry untouched · tsc clean.
- **flag ON (the future engine): conformance 16→15 (0corr 5→4), holes 0/0/0, overlaps 0** — the
  coherent primitive fires on exactly **1 real interval (Cross-section 1)**, drops its 0corr-not-lens
  violation, regresses nothing. (Flag ON is gated behind `twoSidedTerminationsEnabled()` = OFF by
  default; NOT yet the committed engine — the WIP intermediate.)

### The primitive (`tileCoherent.ts` `tileCoherentLoneStack`) — how it generalises `emitLoneStackBand`

`emitLoneStackBand` is hole-free ONLY when the enclosing matrix is a unit INSIDE the stack (it
floods full-width from the lone column and minorities notch into it). A lone stack whose units SPAN
the whole interval (matrix only ABOVE/BELOW, or only on the FACING) has no internal matrix band — the
session-6 first attempts (per-unit `emitLonePinch` wedges [session 5: +666 ovl], then own-mid-elevation
notches + apexX slab seams) both left a HOLE: a mid-elevation notch DIPS away from its own contact,
and the sliver between the contact and the dipping notch edge is NOT covered (no matrix floods from
the lone side to fill it). Proven three times (synthetic + CS1 gap18 49 holes + CS2 gap11 24 holes).

THE SHIPPED CONSTRUCTION — **meet-at-seam trapezoids, not dipping notches:**
- The lone units meet the facing enclosing matrix M at ONE shared vertical SEAM at
  `SEAM_FRACTION` (=`INTERIOR_PINCH_FRACTION` 0.5). Each unit fills its OWN [uTop..uBase] slab from
  the lone column to the seam as a right-TRAPEZOID (following the sloping brackets), with a per-unit
  horizontal boundary `close` curve (loneX→seamX) separating adjacent lone-unit slabs. M fills the
  seam→facing band (the facing column vertical as an M-labelled `flood` closing).
- A rectangle/trapezoid partition (one seam + horizontal boundary seams) is hole-free BY
  CONSTRUCTION — there is no dipping mid-apex sliver. Conformance: each lone unit reaches only the
  lone edge + the seam ⇒ `onlap` (never full-width); M reaching the facing edge is a SEPARATE
  connected component ⇒ the gate's raster union-find reads a same-formation lone unit as onlap, NOT
  merged with a facing band — the §7 ZAND-full-width ROOT dissolved (WHERE M genuinely differs).
- The MID-SEAM MEET (design KEY lead: "SILT onlaps down, ZAND onlaps up, meet at a mid seam") is the
  shared seam line: adjacent units abut it at their shared contact, M sits past it.

SCOPE / BAIL (ruling 7, all-or-nothing) — fires ONLY when: ≥2 lone units that SPAN the interval
contiguously; the FACING carries ONE continuous enclosing matrix M across the span
(`facingEnclosingMatrix` = same formation at top/mid/base + `facingCoversSpan`) that DIFFERS from
EVERY lone unit (no re-merge); and the facing bracket has REAL thickness (a CONVERGING facing =
§8-Q3 void → bail, was the CS2 gap11 hole). Every miss returns false → the caller's seam.

### Tie-10 g0 interval B — CONFIRMED geometric obstruction (the honest finding)

Interval B `[anchor 4.05/3.549 .. anchor -2.69/-2.29]`: lone-L {SILT[3.57,4.05] top-tied, ZAND
[-2.69,3.57] base-tied}, R matrix empty (the facing ZAND both-tied band excluded). The design's target
render ("ZAND[L] pinches, a differing flood separates it from ZAND[R]'s band") REQUIRES a differing
formation physically between lone-ZAND and facing-ZAND for the connected-component gate to split them.
**The data does not contain one** — the facing right column carries ZAND (same as lone ZAND) across
the interval's whole elevation span (el -2.29..3.55); the enclosing KLEI is only ABOVE (>4.05) and
BELOW (<-2.29), never between. `facingEnclosingMatrix` therefore correctly returns null (the facing
matrix IS a lone unit's formation → any flood would re-merge, the wall). The coherent primitive
CANNOT and MUST NOT fire here. This is the same wall session 5 hit via the `preferMatrix` probe
("SILT has no facing run to band to"). The synthetic `coherentLoneStack` gate proves the primitive
on the SAME SHAPE with a genuine differing facing matrix (KLEI the facing carries) — it is hole-free
and separates. So the mechanism is correct; interval B lacks the geometric precondition. Options for
interval B are OWNER calls, not engine fixes: (a) accept ZAND[L]+ZAND[R] as one band (a `collectGapBands`
matched-pair / 8e gate exemption — they ARE base-tied same-formation); or (b) invent a KLEI sliver
(a made-up region, rejected by ruling 5/8). RECOMMEND (a): the base-to-base ZAND tie makes them
arguably one body; the gate flags them only because no matched-pair band is registered.

### Interval A (multi-unit minority) — NOT attempted this session (recorded, not forced)

Tie-10 g0 interval A: ZAND[R][5.73,6.44] 0-corr, enclosed by SILT above / KLEI below (both DIFFER —
a mixed-bracket minority `extractEnclosedLenses` never pulls), renders ABSENT (swallowed by the seam).
The mission's step 2 ("remove the minority's slot from the seam matrix, a real hole the notch fills")
requires pulling a unit from the MIDDLE of a contiguous stack, which breaks the stack contiguity the
seam tiler assumes and re-opens the exact hole/overlap the session-4 sub-strip (+164 holes) and
session-5 additive carve (+43 overlaps) both measured. This is the interval-restructuring §4/§8 flag
as its OWN red→green increment (touches the 32 OK `routeLoneStack`/seam cases). NOT begun — a bounded
attempt in the remaining session-6 budget would risk a large regression against the coherent win. The
repro is exact (above); it is the next session's first target once the coherent flag is default-ON.

### Files this session (worktree, NOT committed — orchestrator commits)

- `partitionFillV2/tileCoherent.ts` (NEW, ~243 lines) — the meet-at-seam coherent-flood primitive
  `tileCoherentLoneStack` + `facingEnclosingMatrix`; a THROWAWAY `COHERENT_DIAG` bail-counter block
  (strip at cut-over with `TILEGAP_DIAG`). Routes lens closings through `emitLensClosing` (lensReach
  8b-capped); the meet-seam is an onlap tip at 0.5 (out of 8b lens-cap scope, ruling 8a/8b).
- `partitionFillV2/tileGap.ts` (EDITED, 498 lines — back under the 500 warn) — the lone branch now
  calls `tileCoherentLoneStack` behind `COHERENT_LONE_STACK_ENABLED=true` (active only inside the
  flag-gated two-sided path); the dead `tileGapLone`/`LONE_TERMINATION_ENABLED` wiring + import
  DELETED (superseded).
- `partitionFillV2.coherentLoneStack.test.ts` (NEW) — the TDD gate: a synthetic lone {SILT onlap,
  ZAND onlap} enclosed by a facing KLEI, asserts hole-free + each unit terminates + KLEI floods
  between. GREEN (was RED against the pre-primitive engine).
- STUBS to delete (orchestrator; bash rm denied here): `partitionFillV2/tileLone.ts` (session-5
  negative, now orphaned — no importers), the throwaway diags
  `partitionFillV2.throwaway_s6harness.diag.test.ts` (the one-run OFF/ON harness — regenerate if
  needed; `SHAPE_AUDIT=1`), `partitionFillV2.throwaway_t10regions.diag.test.ts`,
  `partitionFillV2.throwaway_cs2probe.diag.test.ts`, `partitionFillV2.throwaway_findfired.diag.test.ts`
  + their `scripts/diag_s6_harness.json` / `diag_t10regions.json` / `diag_cs2probe.json` /
  `diag_findfired.json` / `diag_coherent_*.json` dumps + the `scripts/read_s6*.cjs` / `read_conf.cjs`
  / `read_col.cjs` / `read_t10r.cjs` readers. The `COHERENT_DIAG` + `TILEGAP_DIAG`/`TILEGAP_CAPTURE`
  blocks in tileCoherent.ts/tileGap.ts are STILL THROWAWAY (strip at cut-over).
- `tileMultiUnit.ts` unchanged (its `MULTIUNIT_*` flags stay OFF — the interval-A minority carve).

### The one-run flag OFF/ON harness (regenerated) — the measurement of record

`partitionFillV2.throwaway_s6harness.diag.test.ts` (`SHAPE_AUDIT=1`) measures holes / overlaps /
FULL 2/1/0 conformance for BOTH flag states in ONE run (conformance mirrors the gate's classifier
exactly). Result:

| metric | flag OFF (default/committed) | flag ON (future engine) |
|---|---|---|
| holes above-TD / sub-TD | 0 / 0 | 0 / 0 |
| different-litho overlap pairs | 0 | 0 |
| conformance 0corr / 1corr / 2corr | **5 / 11 / 0 = 16** | **4 / 11 / 0 = 15** |
| coherent-lone fired | (path inactive) | **1 interval (Cross-section 1)** |

### Next steps (session 7)

1. **OWNER CALL on Tie-10 interval B** (recorded above): accept ZAND[L]+ZAND[R] as one base-tied
   band (a `collectGapBands`/8e gate exemption — the honest resolution, no invented KLEI), OR leave
   flagged. The coherent primitive is complete; interval B is not an engine defect it can reach.
2. **The multi-unit minority carve (interval A + the other absent mixed-bracket minorities)** — the
   remaining engine work. Requires the interval-restructuring: pull a mixed-bracket minority from
   the middle of a contiguous stack, emit its 8b lens, and RE-CLOSE the seam residual so the slot is
   a real hole (NOT the additive carve — session-5 +43 ovl). Its own red→green increment; guard the
   32 OK `routeLoneStack`/seam cases + holes 0/0/0 every step.
3. **Widen the coherent primitive's reach** — it fires on only 1 real interval (most lone stacks are
   single-unit [`bail-lt2` 25 on CS1] or face a same-formation / converging facing). Single-unit
   lone stacks with a differing facing matrix are handled by `routeLoneSidePinch`; audit whether any
   of the 24 lone bails are coherent-eligible after the multi-unit carve reshapes intervals.
4. **Cutover readiness** stays: flip `twoSidedTerminationsEnabled` default→ON only when ALL
   conformance counters reach 0 (advisories triaged) — still gated on the multi-unit restructuring +
   the interval-B owner call. Keep `COHERENT_LONE_STACK_ENABLED` ON inside the two-sided path.
   Do NOT touch `intersect.ts` / `seamAnchor.ts` (613-hole trap).

---

## 10. Session-7 plan & progress — THE FLIP (build-first; ruling 8g the spec)

⚡ OWNER DIRECTIVE this session: BUILD-FIRST. Design + write the ENTIRE flip end-to-end (engine +
gate + synthetic gates) WITHOUT running anything; then run the verification battery ONCE and iterate
on failures. Ruling 8g (design §8, 2026-07-16, verbatim) is the SPEC.

### The generalised construction (ruling 8g → the coherent STACK tiler)

Session 6 proved the meet-at-seam trapezoid primitive (`tileCoherentLoneStack`) is hole-free BY
CONSTRUCTION. Sessions 4/5 proved the failure modes to AVOID: N independent `emitLonePinch` wedges
(+666 overlaps), additive carve over claimed space (+43 overlaps), per-sub-strip independent floods
(+164 holes). The FLIP generalises the ONE primitive to arbitrary two-sided intervals.

Ruling 8g translated to curve emission, for one interval (top/base bracket across the gap, left units
L0..Lm + right units R0..Rn, each carrying its per-gap 2/1/0 from `effectiveCorrForSide`):

* **ONE shared vertical SEAM at fraction 0.5** (`INTERIOR_PINCH_FRACTION`). Every terminating unit
  fills its own [uTop..uBase] slab from ITS column to the seam as a right-trapezoid (following the
  sloping brackets); the two sides MEET at the seam. This is exactly `tileCoherentLoneStack`'s
  construction, but BOTH sides now carry units (the lone case = one side empty, the enclosing floods
  its whole half — a special case of the same code).
* **Emission order is normative (8g(c)): 0-corr lenses FIRST, onlaps SECOND, fill LAST.** In the
  slab decomposition this is automatic: a 0-corr unit's slab boundary is its own lens apex (8b-capped,
  own mid-elevation); a 1-corr unit's is its onlap tip (0.5 on its tie); a same-formation base-tied
  pair spanning the seam is ONE band (8g(b), no seam between them).
* **Per-unit horizontal boundary seams** (loneX→seamX, at each internal contact) separate adjacent
  slabs so each unit reads its own lithology. **The enclosing formation is a DETOUR, not a wall**
  (8g(a)): where a lens/onlap slab pinches short of the seam, the ADJACENT unit's slab (same side)
  OR the facing enclosing floods the residue — the boundary composition closes the face.
* **8g(b) — base-tied same-formation pairs are ONE BAND.** A left unit and right unit of the SAME
  formation whose (derived) tie is base-to-base (or the pair is a `collectGapBands` matched pair)
  band FULL-WIDTH across the seam — no seam curve between them, one face. This is the SAME rule
  `emitBands`/`bandFormations` already encodes; the coherent tiler must NOT split such a pair.

DECOMPOSITION (arbitrary stack → slabs/seams/notches/detours):
1. Collect the union of both sides' internal contact elevations (interpolated across the gap as
   straight lines) → SLAB boundaries. Each slab presents ONE left formation + ONE right formation.
2. For each slab: if leftF===rightF AND that formation is base-tied/band across the gap → ONE band
   (facing verticals + brackets, no seam). Else → the left unit fills its slab to the seam by its
   corr (0→lens apex ≤0.5, 1→onlap tip 0.5, 2→to the seam as a band-half), the right unit likewise;
   they meet at the 0.5 seam. A 0-corr lens's apex sits SHORT of 0.5 (8b cap) → the residue between
   the lens apex and the seam is flooded by the SLAB'S OTHER side if same-formation-continuous, else
   by the facing enclosing (the detour). This is where holes threaten — the flood must be a single
   coherent face per side (the `emitLoneStackBand` slab-seam trick: horizontal seams labelled the
   enclosing, so a residual pentagon carrying no own-column vertical stamps enclosing).

WHAT IS DELETED (the flip): inside the two-sided path, `tileGapTwoSided` no longer returns false to
fall to `routeLoneSidePinch`/the seam tiler. The bail taxonomy (`lone`/`sameFormation-8e`/
`multiunit-L*-R*`/`termbail` + `tileSingleSingle`/`tileSameFormationTwoSided`/`tileMultiUnit`/
`carveMultiUnitMinority`/`tileLone`) collapses into ONE `tileCoherentStack` call. `tileCoherentLoneStack`
generalises into it (the lone case = a stack where one side is empty). The old seam `tileInterval`
body (meetFraction / emitSideSubSeams / seamAnchor path) stays ONLY as the flag-OFF default until
the owner dogfeds ON, then is deleted at cut-over.

### Gate update (8g(b))

`effectiveCorr.effectiveCorrForUnit` already maps a base-tied same-formation matched pair to corr=2
(via `isBandMember`/`collectGapBands`). Ruling 8g(b) EXTENDS this: a 1-corr unit whose SINGLE (derived)
tie faces a SAME-FORMATION unit across the gap now expects BAND, not onlap. Change lands in
`partitionFillV2.conformance.classify.ts` (a `sameFormationBaseTiedPair` predicate) + the diag's
corr==1 branch (a same-formation-across-the-gap render of band is ACCEPTED, not `1corr-not-onlap`).

### STATUS — THE FLIP LANDED (net win, no regression). Build-first, then ONE battery + iterate.

**Scoreboard (end of session 7):**

| metric | flag OFF (committed engine) | flag ON (the flip) |
|---|---|---|
| holes above-TD / sub-TD | **0 / 0** | **0 / 0** |
| different-litho overlaps | **0** | **0** |
| conformance 0corr / 1corr / 2corr | **5 / 9 / 0 = 14** | **3 / 8 / 0 = 11** |
| 8e-enclosure (advisory) | 50 | 47 |
| q3-legit (advisory) | 5 | 3 |

* **Flag OFF is engine-BYTE-IDENTICAL to the committed baseline** — the ONLY change to the OFF
  number (16 → 14) is the GATE reclassification (ruling 8g(b), documented below); the seam engine
  output is untouched. v1 90/90, CS1 7/7, holes 0/0/0, all shape+package gates green, tsc clean.
* **Flag ON = the flip: conformance 14 → 11 (0corr 5→3, 1corr 9→8), holes 0/0/0, overlaps 0.** The
  terminations-first coherent tiler fixes 3 MORE offenders than the seam baseline with ZERO
  hole/overlap regression. NET WIN.

**The build (all in the worktree, NOT committed):**
1. **`partitionFillV2/tileCoherentStack.ts` (NEW)** — the generalised meet-at-seam coherent tiler
   (ruling 8g). Every own-side unit fills its [uTop..uBase] slab from its column to ONE shared 0.5
   seam as a right-trapezoid; per-unit horizontal boundary seams separate adjacent slabs; the two
   sides MEET at the seam. A LONE (empty) side floods its half from its OWN column's continuous
   matrix. Onlap edges (1-corr, base-tied) carry an `onlap` id so the slab reads ONLAP. Bails
   (`return false`) on a CONVERGING facing (one side ~0 thickness — the pinch-to-conv shape, kept on
   `routeLoneSidePinch`/`emitSharedContactOnlap`) and a non-contiguous stack. Hole-free BY
   CONSTRUCTION (a rectangle/trapezoid partition — no dipping mid-apex sliver).
2. **`partitionFillV2/tileGap.ts` (REWRITTEN)** — `tileGapTwoSided` is now a thin adapter: map each
   side's matrix units to their per-gap corr (`withCorr`), hand the whole interval to
   `tileCoherentStack`. The ENTIRE bail taxonomy is DELETED (`tileSingleSingle`,
   `tileSameFormationTwoSided`, `emitSameFormSide`, `emitSideTermination`, `singleFormation`,
   `TILEGAP_CAPTURE`). `emitIntervals.tileInterval` unchanged (flag-OFF byte-identical): when the
   flag is ON it calls `tileGapTwoSided`, and on `false` falls through to `routeLoneSidePinch`/the
   seam during bring-up.
3. **`partitionFillV2/tileMultiUnit.ts` (NEUTRALISED to an inert stub)** — the session-4/5 sub-strip
   + minority-carve negatives are superseded by `tileCoherentStack`. Orchestrator `rm`.
4. **Gate update (ruling 8g(b))** — `partitionFillV2.conformance.classify.ts` gains
   `sameFormationBaseTiedPair(baseTied, topTied, formationId, bandLo, bandHi, facing)`: a purely
   base-tied 1-corr unit whose facing carries the SAME formation overlapping its band is ONE band
   (the Tie-10 g0 ZANDs). Wired into `partitionFillV2.conformance.diag.test.ts`'s corr==1 branch
   (tagged `8e-enclosure`, not flagged). This moved the baseline 16 → 14.
5. **Synthetic gates: `partitionFillV2.coherentStack.test.ts` (NEW)** — 4 cases, all GREEN under
   flag ON: (a) sand/silt-lens/sand (the sand bands 8g(b), the silt is a detour, hole-free); (b)
   lone [SILT,ZAND,VEEN] mid-stack minority meets a continuous KLEI enclosing (the mid ZAND
   terminates, KLEI floods, hole-free); (c) base-tied same-formation pair → one band (8g(b)); (d)
   both-sides-terminating stacks meet at the shared seam.

**GATE-RECLASSIFICATION TRIAGE (8g(b), flag-OFF baseline 16 → 14):** the `sameFormationBaseTiedPair`
predicate tags 15 purely-base-tied 1-corr same-formation-facing rows as `8e-enclosure` (one band by
the base-tie closure walk — Tie-7/8/10/14 KLEI, CS1 g0/1/3/19/22 SILT/ZAND, CS2 g14/15/17/21 ZAND).
13 of those were ALREADY exempted by the existing `enclosedByOwnTiedBand` (same "one body" reading);
8g(b) NEWLY exempts 2, hence 16 → 14. All 15 are legitimate one-band renders (a same-formation run
base-tied across the gap), never opposing lenses — the owner's Tie-10 ruling ("the sands connect")
generalised.

**FLAG-ON residual (11) — triage:** every remaining violation is an interval `tileCoherentStack`
BAILED on (converging facing or same-formation enclosure the seam keeps), so it renders on the seam
fallback:
* Tie-10 g0 ZAND / Tie-12 g0 SILT / CS1 g18 VEEN+ZAND / g19 SILT / CS2 g13 ×2 — ruling-8 untied
  same-formation full-widths (opposing lenses until the owner ties them; the gate flags them
  CORRECTLY, not engine defects) + a converging-facing bail.
* CS1 g20/g21 ZAND `absent` (both-tied) — the no-emit pair (`routeLoneStack` skips a lens whose
  enclosing SILT-below is edged); the enclosed-lens class the flip does not yet reach.
* CS1 g22 ZAND `absent`/`band` — the lens-edged class (edged in the adjacent gap).
These are the SAME residual classes the design §4/§8 flags as the enclosed-minority / converging /
lens-edged work — NOT new. The flip closed 3 of the seam's leaks (14→11) with zero regression; the
remaining 11 need either the owner tie (ruling-8 untied) or the enclosed-lens per-gap extraction
(a separate increment), plus widening `tileCoherentStack` past the converging-facing bail.

**REMAINING to cutover-ready (unchanged from §6 list):** OWNER DOGFEED (flip the Settings toggle,
litho + geotech axes) → widen `tileCoherentStack` past the converging-facing bail (the mixed-bracket
minority / lens-edged residual) → flip `twoSidedTerminationsEnabled` default→ON → delete the seam
`tileInterval` body + the `TILEGAP_DIAG`/`COHERENT_STACK_DIAG` throwaway blocks → v2 frozen snapshot.
Do NOT touch `intersect.ts` / `seamAnchor.ts` (613-hole trap).

**Files this session (worktree, NOT committed — orchestrator commits + does rm):**
* `partitionFillV2/tileCoherentStack.ts` (NEW, committed-quality).
* `partitionFillV2/tileGap.ts` (REWRITTEN — bail taxonomy deleted).
* `partitionFillV2/tileMultiUnit.ts` (NEUTRALISED to an inert stub — orchestrator `rm`).
* `partitionFillV2.conformance.classify.ts` + `.conformance.diag.test.ts` (EDITED — 8g(b) gate).
* `partitionFillV2.coherentStack.test.ts` (NEW — 4 synthetic gates).
* STUBS to delete (orchestrator `rm`): `partitionFillV2/tileCoherent.ts` (session-6
  `tileCoherentLoneStack`, now superseded by `tileCoherentStack` — orphaned, no importer),
  `partitionFillV2/tileMultiUnit.ts` (inert stub), the session-6 `partitionFillV2.coherentLoneStack.test.ts`
  (still GREEN — it exercises `tileCoherentStack`'s lone path, so it can STAY as a regression gate OR
  be folded into `coherentStack.test.ts`; keep for now), the throwaways
  `partitionFillV2.throwaway_s7probe.diag.test.ts` + `partitionFillV2.throwaway_s7harness.diag.test.ts`
  (the OFF/ON measurement of record — regenerate if needed) + `scripts/s7probe.json` /
  `scripts/diag_s7_harness.json`. Any session-1..6 stubs still pending rm.

### (running build log)

---

## 11. Session-8 plan & progress — RULING-8h SIX-PHASE BIDIRECTIONAL SWEEP (build-first; parity 11, holes 0/0)

⚡ OWNER DIRECTIVE this session: BUILD-FIRST. Ruling 8h (design §8, 2026-07-16 — the owner's
six-phase bidirectional sweep) is the SPEC; it SUPERSEDES the session-7 interval-level
meet-at-seam where they conflict. Wrote the ENTIRE restructure (engine + synthetic gates) with
zero executions, then ran the verification battery ONCE and iterated on the one failure.

### The sweep design (how phases 1-4 map to code)

`tileCoherentStack` was REWRITTEN from the session-7 "meet-at-seam-or-bail" interval construction
into the ruling-8h PER-SIDE PHASE SWEEP. The interval-level shape-classification bail is RETIRED
(ruling 8h(a)): emission is per side and unconditional. The sweep DISPATCHES by facing geometry to
the already-proven hole-free primitives, with the SAME phase order in every branch (0-corr lenses
first, 1-corr onlaps second, fill last — automatic in the DCEL trace):

* **Phases 1-4 (per side, 0-corr lens then 1-corr onlap):**
  - **BOTH sides real thickness** → the MEET-AT-SEAM slab construction (session-6/7 `emitSideSlabs`,
    unchanged): each unit fills its [uTop..uBase] slab from its column to the shared 0.5 seam; a
    0-corr slab's boundary is a plain `close` (reads lens by geometry), a 1-corr slab carries an
    `onlap`-id edge on its tied contact. The two sides MEET at the seam BY CONSTRUCTION (the
    session-6/7 lesson: shared seam, not independent wedges).
  - **ONE side empty (lone)** → the facing enclosing floods that half (the `emitSideSlabs` lone
    branch, `facingMatrixLabel`).
  - **CONVERGING facing (one side ~0 thickness — the 29-bail target set)** → NO BAIL (ruling 8h(a)).
    The present (real-thickness) side's unit terminates toward the facing CONVERGENCE POINT `conv`
    via the PROVEN per-unit primitives — `emitSharedContactOnlap` (1-corr, interior, both brackets
    anchored) / `emitLonePinch` `forceLens` (0-corr MIXED-bracket), the enclosing flooding the wedge.
    This is the EXACT hole-free geometry `routeLoneSidePinch` already emits for the converging case —
    the sweep now OWNS it instead of returning false to the caller's seam.

### How the meet-by-construction works (owner's "you don't seem to be closing bidirectionally?")

Emission is PER SIDE and UNCONDITIONAL — every 0-corr side always gets its lens, every 1-corr side
always its onlap. Where two sides' emissions meet they meet by construction: in the two-sided-thick
branch the shared 0.5 seam is the meet line (both slabs abut it); in the converging branch the two
sides' terminations both close on `conv`. NO routing branch decides the meet — it is a consequence
of the two per-side trapezoids sharing the seam vertical (kept from session 7's proven hole-free
slab; sessions 4/5/7 proved N independent freeform wedges = +457 holes, additive carves = +43
overlaps, so the slab/flood construction is retained, only the interval-level bail is retired).

### What happened to the bail sites (the 29 converging-facing bails)

The session-7 `bail-converging-facing`/`bail-nospan` interval-level shape bails are GONE. Replaced by:
* **`fired-converging` (27 real intervals):** the present side's SINGLE unit against a converging
  facing terminates via the proven primitives — CLOSED hole-free. This fixed the BOUNDARY/MIXED
  TRIO the design §4 flagged (Tie-10 g0 ZAND[R] 0corr el[5.73,6.44], CS1 g5 ZAND[L] 1corr,
  CS1 g7 SILT[R] 0corr) — all three moved `absent` → terminated.
* **`bail-converging` (96 kept):** a MULTI-UNIT present side against a converging facing (N
  independent wedges = the measured +666-overlap risk — NOT a single coherent construction yet) OR
  a SAME-FORMATION-enclosed 0-corr unit (above===below: its slot is already filled by the enclosing
  quad; an additive lens double-covers it — the `splitAnnulus`-bypass wall, measured +1.6 cm CS1
  g20/g21 in the FIRST battery pass, then correctly bailed). These keep the seam (the pre-existing
  `absent`/full-width residual, NOT a new defect).
* **Construction-safety `bail-nospan` (two-sided-thick only):** a non-contiguous two-sided interval
  keeps the seam (a geometry guarantee, distinct from the retired shape classification).

### Phases 5-6 (section-edge closure) — VERIFIED, no new curves

The outermost columns' verticals close every body's loop at the section frame BY CONSTRUCTION
(`emitColumnVerticals` emits per-unit verticals surface→TD on EVERY column incl. the outermost).
The sweep emits no new curves for phases 5-6; the invariant is VERIFIED by synthetic gate (d)
(a KLEI/ZAND/KLEI banded section: every band reaches BOTH frame columns at frac ~0 and ~1, no open
strip). GREEN — the invariant holds, no body fails to close at the frame.

### Containment (8h(c)) — VERIFIED, inherent in the DCEL + labelFaces

`labelFaces` labels each ARRANGEMENT FACE by its immediately-bounding curves. Faces are MINIMAL by
construction (DCEL half-edge trace), so "a face belongs to the SMALLEST enclosing loop" is inherent:
an enclosed lens's OWN face wins the lens label by boundary composition (all-synthesized boundary +
does not span the gap), and the enclosing band is a SEPARATE face that geometrically cannot overwrite
it. Verified by synthetic gate (c) (a SILT lens inside a ZAND band inside the section: the little
SILT face survives at its column; the ZAND detours around it; no double-cover). GREEN — little never
overwritten by big; all small closures exist before any large fill (all curves are in the arrangement
before the trace).

### THE ONE BATTERY PASS + iteration (build-first)

FIRST pass (all built, zero prior runs): tsc clean; bidirSweep gates (a)/(b) GREEN, (c)/(d) RED =
TEST-COORDINATE bugs (my elevation=surface−depth inversions), FIXED; holes OFF 0/0/ovl 0, holes ON
0/0/**ovl 2** (CS1 g20/g21 lens×quad ≤1.6 cm) — the DISQUALIFYING regression. ROOT: the converging
0-corr branch emitted an additive lens for a SAME-FORMATION-enclosed unit whose slot the enclosing
quad already fills (the notch rides the column edge, holes=0 → arrangement never separates it). FIX
(one edit): gate the 0-corr converging lens on `aboveMatrix ≠ belowMatrix` (mixed bracket only);
same-formation enclosure bails to the seam (that class is the column-level extraction's / per-gap-
edged residual's job, NOT the converging sweep's). SECOND pass: holes ON **0/0/ovl 0**. DONE.

### The OFF/ON table (per-class movement; harness `partitionFillV2.throwaway_s8harness.diag.test.ts`)

| metric | flag OFF (committed) | flag ON (the 8h sweep) |
|---|---|---|
| holes above / sub TD | 0 / 0 | 0 / 0 |
| different-litho overlaps | 0 | 0 |
| conformance 0corr / 1corr / 2corr | **5 / 9 / 0 = 14** | **3 / 8 / 0 = 11** |
| 8e-enclosure (advisory) | 50 | 44 |
| q3-legit (advisory) | 5 | 3 |
| reach-cap (advisory) | 2 | 6 |

* **Flag OFF is BYTE-IDENTICAL to the committed baseline** (5/9/0=14; the whole two-sided block is
  flag-gated). v1 90/90, CS1 7/7, holes 0/0/0, all package+shape gates green, tsc clean.
* **Flag ON: 14 → 11 (0corr 5→3, 1corr 9→8), holes 0/0, overlaps 0.** Per-class: the sweep FIXED the
  boundary/mixed trio (Tie-10 g0 ZAND[R], CS1 g5 ZAND[L], CS1 g7 SILT[R] — all 3 `absent`→terminated
  via the converging primitives). Net conformance == session-7's flip (11) BUT reached via the
  ruling-8h per-side sweep with the converging bail RETIRED for the mixed-bracket class.

### Remaining reds (the 11 flag-ON residual — diagnosed, all pre-existing classes)

1. **Untied same-formation full-widths (ruling-8, gate flags CORRECTLY, NOT engine defects):**
   Tie-10 g0 ZAND[R] 1corr band, Tie-12 g0 SILT[R], CS1 g18 VEEN[L]+ZAND[R], CS1 g19 SILT[L], CS2
   g13 ×2. Opposing 8b-capped lenses until the OWNER TIES them (ruling 8 embraced side effect).
2. **CS1 g20/g21 ZAND `absent` (both-tied no-emit pair):** `routeLoneStack` skips a lens whose
   enclosing SILT-below is EDGED; same-formation enclosure → the sweep correctly bails (no additive
   overlap). Needs per-gap-edged extraction (a separate increment).
3. **CS1 g22 ZAND `band`/`absent` (lens-edged class):** minority tied in the ADJACENT gap → the
   section-wide `edgedLayerIds` excludes it from the column-level extraction. Needs per-gap edged.
None are new; all are the design §4/§8 enclosed-minority / lens-edged / owner-tie residual classes.

### Files this session (worktree, NOT committed — orchestrator commits + does rm)

* `partitionFillV2/tileCoherentStack.ts` (REWRITTEN — the ruling-8h six-phase sweep; converging bail
  retired for the single-unit mixed-bracket case via `emitConvergingSide`; `emitSideSlabs`/`spans`
  kept for the two-sided-thick meet-at-seam; carries the THROWAWAY `COHERENT_STACK_DIAG` block —
  strip at cut-over).
* `partitionFillV2.bidirSweep.test.ts` (NEW — 4 synthetic gates: (a) bidirectional closure, (b)
  converging tiled hole-free, (c) nesting/containment, (d) section-edge closure. All GREEN flag ON).
* `partitionFillV2/tileGap.ts`, `emitIntervals.ts` — UNCHANGED (thin adapter + flag routing intact).
* STUBS to delete (orchestrator `rm`): `partitionFillV2.throwaway_s8harness.diag.test.ts` +
  `scripts/diag_s8_harness.json` (the OFF/ON measurement of record — regenerate if needed,
  SHAPE_AUDIT=1). Any session-1..7 stubs still pending rm.

### Next steps (session 9)

1. **The 11 residual needs the enclosed-minority per-gap work, NOT the sweep** — CS1 g20/g21 (edged
   enclosing) + CS1 g22 (lens-edged, adjacent-gap tied). Per-gap `edgedLayerIds` extraction at the
   INTERVAL level (`edgedLayers.ts` foundation from session 1) so a minority tied in the adjacent gap
   still terminates in THIS gap. Its own red→green increment; guard holes 0/0 + the 32 OK
   `routeLoneStack` cases.
2. **The multi-unit converging class (`bail-converging` 96)** — a multi-unit present side against a
   converging facing needs a SINGLE coherent construction (not N independent `emitLonePinch` wedges,
   +666 overlaps). The `emitLoneStackBand` slab-seam trick generalised to a converging facing is the
   candidate; measure holes 0/0 before widening.
3. **Owner ties** dissolve the 6 untied same-formation full-widths (ruling 8 embraced).
4. **Cutover-ready** stays gated on OWNER DOGFEED (flip Settings toggle, litho + geotech) → the
   residual work above → flip `twoSidedTerminationsEnabled` default→ON → delete the seam `tileInterval`
   body + strip `TILEGAP_DIAG`/`COHERENT_STACK_DIAG` → v2 frozen snapshot. `intersect.ts`/
   `seamAnchor.ts` UNTOUCHED (613-hole trap); v1 90/90 byte-identical safety line held all session.

---

## 12. Session-9 plan & progress — TARGET A SHIPPED (enclosed-lens detour); TARGET B already correct; TARGET C measured-negative (recorded)

⚡ OWNER DIRECTIVE: BUILD-FIRST. Owner ruling (2026-07-16 afternoon, on the CS1 walkthrough): "a
0-corr unit-side ALWAYS gets its generated lens, no matter how tied its surroundings are"
(ruling 8h phases 1-2 UNCONDITIONAL). Three internal shortcuts to remove: (A) the section-wide
edged-matrix exclusion, (B) the band-bracketed interval skip, (C) the g20/g22 base-edged residuals.

### The DIAGNOSIS overturned the prompt's framing (per the "trust the data over the doc" rule)

The `effectiveCorr.derivedBandTies` side-condition fix (2026-07-16 14:28, after session 8) shifted
the baseline: **flag-OFF 6/7/0=13, flag-ON 4/6/0=10** at session start (not 5/9/0=14 / 3/8/0=11).
Real-data probes on CS1 col3 (x=101.56, filtered idx 3) found:

* **TARGET A (col3 u3 SILT interbed [4.06..4.70], enclosed by ZAND above+below).** The prompt's
  "section-wide edged-matrix exclusion blocks extraction" is NO LONGER the mechanism —
  `extractEnclosedLenses` DID pull it (`col3.enclosedLenses=[SILT el[4.06..4.70] matrix=ZAND]`, the
  ZAND host merged to one band). The REAL blocker: `emitEnclosedLensCurves`'s `facingCarriesMatrix`
  gate DROPPED the lens because the facing columns carry KLEI (not ZAND) at the interbed's elevation
  → the merged ZAND band swept the slot → interbed ABSENT (both gaps, both flag states). It was NOT
  gate-flagged (extracted out of `col.units`, invisible to the conformance gate) — a real defect the
  counter can't see.
* **TARGET B (col3 u5 SILT [0.23..0.66]).** ALREADY CORRECT: renders `band` in gap2 (banded left of
  col3) + `lens` in gap3 (pinching right of col3), exactly the owner's acceptance. No fix needed.
* **TARGET C (CS1 g20/g21 col21 u3 ZAND, g22 col22 u2 ZAND — enclosed by SILT above+below, BOTH
  tied).** `extractEnclosedLenses` correctly refuses to merge (the merge splices the enclosing BELOW
  unit out of the column, dropping its tie's layerId → its SILT band vanishes). Per-gap `edgedLayers`
  does NOT unblock it (the below SILT is genuinely edged in the TARGET gap). At el 9.05 the ZAND slot
  is already FLOODED full-width by the enclosing SILT (measured) — the minority is absorbed, not a
  hole. So the lens needs CARVING out of a claimed flood, the `splitAnnulus`-bypass wall sessions 5/8
  measured.

### TARGET A — SHIPPED (`emitLenses.shouldEmitLens`, ruling 8h phases 1-2)

Replaced the `facingCarriesMatrix` gate with `shouldEmitLens` → UNCONDITIONAL emission. Every entry
in `col.enclosedLenses` is enclosed by ONE continuous own-column matrix (extraction guarantees it),
so the 8b-capped lens hugs its own column and the arrangement carves it out of that own-column matrix
band (which the merge made full-width in the gap) — the enclosing band DETOURS around it (ruling 8g).
The 8b cap keeps the lens hugging its own column so it never crosses into the facing's different
lithology. `facingCarriesMatrix` DELETED (superseded).

**ACCEPTANCE MET:** CS1 col3 SILT interbed now renders `SILT lens frac[0.550..1.000]` (gap2, hugs
col3's right edge) + `SILT lens frac[0.000..0.014]` (gap3, hugs col3's left edge), the surrounding
ZAND band fills around it, **holes/overlaps 0/0/0**. The absent-minority enumeration dropped the col3
interbed (both gaps). Side effect (flag-OFF): the CS1 g5 ZAND absent knock-on also resolved →
1corr-not-onlap 7 → 6. tsc clean, v1 90/90, CS1 7/7, all shape+package gates green.

### TARGET C — ATTEMPTED, MEASURED NEGATIVE (+53 holesAbove), GATED OFF, RECORDED

Built `sectionGeom.extractEdgedEnclosedLenses` (flag `ENABLE_ENCLOSED_LENS_EDGED`, DEFAULT OFF): a
non-destructive pass that records a same-formation-enclosed minority whose enclosing below is edged,
WITHOUT merging (keeping both enclosing units + their ties). Measured with the flag ON:
**holesAbove 0 → 53** — DISQUALIFYING. ROOT (confirmed): without the merge the enclosing SILT is not
a continuous annulus, so the emitted ZAND notch rides the column edge (holes=0) and breaks the SILT
flood face into an uncovered sliver at every emitted lens (`slice.splitAnnulus` fires only on
holes>0, cannot separate a notch — the documented wall). CANNOT land hole-free without the blocked
merge or a notch-splitter at holes=0 (`intersect.ts`-adjacent, forbidden — 613-hole trap). Gated
OFF; the CS1 g20/g21/g22 ZAND minorities stay ABSENT (the pre-existing residual, NOT a new defect).
`partitionFillV2.lensEdged.test.ts` remains the `describe.skip` RED spec for this class.

### The OFF/ON table (session 9 end; harness `partitionFillV2.throwaway_s9harness.diag.test.ts`)

| metric | flag OFF (committed) | flag ON (the 8h sweep) |
|---|---|---|
| holes above / sub TD | 0 / 0 | 0 / 0 |
| different-litho overlaps | 0 | 0 |
| conformance 0corr / 1corr / 2corr | **6 / 6 / 0 = 12** | **4 / 6 / 0 = 10** |
| 8e-enclosure (advisory) | 50 | 44 |
| q3-legit (advisory) | 6 | 4 |
| reach-cap (advisory) | 2 | 7 |

* **Baselines beaten:** flag-OFF 13 → **12** (1corr 7→6, the CS1 g5 knock-on); flag-ON was already
  10 (the 8a derivedBandTies fix shifted it pre-session). TARGET A's win is INVISIBLE to the counter
  (the col3 interbed was extraction-hidden) but the RENDER is fixed — verified region-by-region.
* **Flag-OFF is NO LONGER byte-identical** for the extraction/lens path (owner-ruled OK): the only
  OFF diff vs session 8 is the 3 enclosed-lens interbeds (CS1 col3 SILT + 2 knock-ons) now rendering,
  an intended ruling-8h fix. Everything else OFF byte-identical (v1 90/90 held).

### Per-instance triage of every flag-ON residual (10)

1-5, 9-10 (Tie-10 g0 ZAND, Tie-12 g0 SILT, CS1 g18 VEEN+ZAND, CS1 g19 KLEI, CS2 g13 ×2, CS1 g22 SILT
full-width): **class (d) ruling-8 untied same-formation full-widths** — opposing lenses until the
OWNER TIES them (embraced side effect, gate flags them CORRECTLY, NOT engine defects). 6/8 (CS1 g20
ZAND absent) + 8 (CS1 g22 ZAND absent): **TARGET C** (edged-enclosing / lens-edged) — measured
negative, gated off, recorded. Nothing NEW, nothing regressed.

### Files this session (worktree, NOT committed — orchestrator commits + does rm)

* `partitionFillV2/emitLenses.ts` (EDITED — `facingCarriesMatrix` → `shouldEmitLens` unconditional;
  TARGET A ships).
* `partitionFillV2/sectionGeom.ts` (EDITED — `ENABLE_ENCLOSED_LENS_EDGED=false` + the
  `extractEdgedEnclosedLenses` measured-negative stub; TARGET C recorded, gated off).
* `partitionFillV2.enclosedLensDetour.test.ts` (NEW — 7 synthetic gates, GREEN: TARGET-A interbed
  lenses both sides + host detours + hole-free; TARGET-B banded-left/lens-right + hole-free).
* STUBS to delete (orchestrator `rm`): `partitionFillV2.throwaway_{s9harness,cs1col3,extract,c,g20,
  absent,synth}.diag.test.ts` (SHAPE_AUDIT-gated / skipped probes + harness — regenerate if needed)
  + `scripts/diag_{s9_harness,cs1col3,extract,c,g20,absent}.json`. Consider removing
  `ENABLE_ENCLOSED_LENS_EDGED` + `extractEdgedEnclosedLenses` (inert measured-negative) if the doc
  record here suffices. Any session-1..8 stubs still pending rm.

### Next steps (session 10)

1. **TARGET C is the last enclosed-minority class** and genuinely needs different treatment (the
   merge is blocked by an edged enclosing tie; additive/non-merge both re-open holes). Two hole-free
   paths, both are their own increment: (i) split the enclosing tied band so the minority can be a
   proper annulus WITHOUT losing the below tie (a band-split that keeps the layerId), or (ii) a
   notch-splitter that separates an edge-riding notch at holes=0 (`intersect.ts`-adjacent — high risk,
   the 613-hole trap forbids the naive relax). Owner call may prefer accepting these as absent.
2. **Owner ties** dissolve the class-(d) untied same-formation full-widths (ruling 8 embraced).
3. **Cutover-ready** unchanged: OWNER DOGFEED (litho + geotech axes — the col3 interbed now renders,
   worth a look) → flip `twoSidedTerminationsEnabled` default→ON → delete the seam `tileInterval`
   body + strip the throwaway diag blocks → v2 frozen snapshot. `intersect.ts`/`seamAnchor.ts`
   UNTOUCHED all session; v1 90/90 held.

---

## 13. Session-10 plan & progress — TARGET 2 (degenerate-flank guard) SHIPPED; TARGET 1 (multi-unit converging lens) MEASURED-NEGATIVE, gated OFF (precise root)

⚡ OWNER DIRECTIVE: BUILD-FIRST (write the whole change with zero executions, then ONE battery pass,
iterate). Two targets, "lens fixes first"; ruling 8d-rev fenced OFF. `intersect.ts`/`seamAnchor.ts`
UNTOUCHED; v1 READ-ONLY. No git ops.

### Scoreboard (end of session 10)

| metric | flag OFF (committed) | flag ON (the flip) |
|---|---|---|
| holes above / sub TD | 0 / 0 | 0 / 0 |
| different-litho overlaps | 0 | 0 |
| conformance 0corr / 1corr / 2corr | **6 / 6 / 0 = 12** | **4 / 6 / 0 = 10** |

* **Flag OFF and flag ON are BOTH byte-equivalent to the session-9 baseline** (12 / 10, holes 0/0,
  overlaps 0). TARGET 2's degenerate guard is a defensive no-op on the 14 real sections (it only
  SKIPS a would-be malformed curve; flag-OFF conformance/holes unchanged). TARGET 1 is gated OFF, so
  flag-ON is byte-identical to session 9. tsc clean; v1 102 pass / 7 skip; the full committed
  partitionFill(V2) suite **202 pass / 20 skip / 0 fail**; CS1 gates 7/7; all package + shape gates
  green.

### TARGET 2 — SHIPPED (`snap.segmentDegenerate` + guards in `emitIntervalLenses` + `emitLenses`)

The CS1 col21/col22 gap21 (0.17 m wide) `close72`-class defect: the 1 mm snap collapsed a lens flank
to ZERO extent in BOTH axes (a curve from elev 8.92 to 8.92). Added `segmentDegenerate(a, b)` to
`snap.ts` (both endpoints snap to the same grid cell) and guarded every lens-closing emission path
(`emitIntervalLenses.emitLensClosing`, `emitLenses.emitOne`): a lens whose EITHER flank is degenerate
after snap is skipped WITH its partner (both flanks) so the loop is never left half-open and no
output curve carries zero extent in both axes. In a sub-snap gap the lens degenerates to nothing (an
acceptable, documented no-op — the enclosing fill covers the slot, holes/overlaps stay 0). Synthetic
gate `partitionFillV2.convergingStack.test.ts` (c) proves it: a thin enclosed lens in a 0.17 m
along-metres gap emits no zero-extent edge and leaves a hole-free partition. The construction in
`tileConvergingStack` also routes every closing through the guard (`pushClose`/`pushFlood`).

### TARGET 1 — BUILT, MEASURED NEGATIVE (+22 holes / +81 overlaps on 4 real fires), GATED OFF

Built `partitionFillV2/tileConvergingStack.ts` (`emitConvergingStack`, extracted from
`tileCoherentStack` to hold the 500-line budget; `tileCoherentStackTypes.ts` carries the shared
`ConvergingSide` type, breaking the value-import cycle) — the session-6 SLAB-SEAM construction
(`emitLoneStackBand` trick) generalised to a CONVERGING facing: per-minority 8b-capped lens notches
biting the present column, horizontal boundary seams (own column → apex line) separating adjacent
minorities, the enclosing flooding the residue to the convergence point `conv` (above/below split at
the interval mid). Wired into `emitConvergingSide`'s `sorted.length > 1` bail (which session 8
retired-then-kept for the multi-unit case). Minorities are separated from the MATRIX (the
`routeLoneStack` reduction) using the PRESENT column's own bracket adjacency for the enclosing (a
converging facing has ~0 interval thickness — a facing sample mis-labels the present matrix as a
minority), with guards: bail on all-matrix, on a facing that carries a would-be minority (a matched
matrix, not an interbed), on a facing same-formation enclosure (the CS1 g20/g21 `splitAnnulus`-bypass
wall class), and on an interleaved matrix unit.

**The ONE battery pass then iteration:** first pass regressed the EXISTING synthetic gates
(coherentStack (a), bidirSweep (a)/(c)) with a `silt×zand` overlap — the construction lensed the
MATRIX ZAND (enclosing mis-sampled from the facing). Iterated: switched enclosing to the own-column
bracket + added the four bail guards → synthetic gates GREEN again (19/19), tsc clean. But the
**one-run OFF/ON harness on the 14 REAL sections measured flag-ON holesAbove 0 → 22, overlaps 0 →
81**, with NO net conformance gain (10 → 10; the CS1 col14/col18 SILT/VEEN resolved but a gap18 VEEN
`band` regression appeared). ROOT (from the harness's `CONV_STACK_DIAG`): the 4 real fires are ALL
`min=1` — a SINGLE minority inside a MATRIX stack with STEEPLY SLOPING brackets (slope 7.1 m /
−3.6 m), NOT the pure multi-minority interbed stack the synthetic gates exercise. A matrix unit
sharing the stack breaks the single flood-to-conv (the own-column enclosing no longer matches the
matrix unit's own formation → its slot floods the wrong litho → overlap), and the FLAT horizontal
seams + flat flood corners do not follow the sloping brackets → slivers. This is the SAME
multi-unit-converging wall sessions 4/5/6 measured (+457 holes / +666 overlaps for N wedges) — the
coherent slab form hits it too on real matrix+minority+sloping geometry.

**Decision (stop-and-report over forcing a guess):** `MULTI_UNIT_CONVERGING_ENABLED = false` in
`tileConvergingStack.ts`. `emitConvergingStack` bails immediately (byte-restores the session-9 flag-ON
baseline: holes 0/0, overlaps 0, conformance 10). The construction + its guards + the measured-
negative record + the synthetic gates SURVIVE as the next session's starting point (matching the
session-4/5 gated-OFF-skeleton pattern). The correct construction must (a) restrict to the MINORITY
elevation span (leave matrix units to the seam — but that breaks all-or-nothing interval ownership,
so it needs the interval-restructuring) and (b) follow the sloping brackets, NOT flat seams.

### Per-instance triage (flag-ON residual 10, unchanged from session 9)

All ruling-8 untied same-formation full-widths (Tie-10 ZAND, Tie-12 SILT, CS1 g18 VEEN+ZAND, g19
KLEI, CS2 g13 ×2 — owner-tie residual) + the edged-enclosing / lens-edged class (CS1 g20 ZAND absent,
g22 SILT band / ZAND absent — TARGET C, session-9 measured-negative). Nothing NEW, nothing regressed
(flag ON byte-restored to session-9's 10).

### Files this session (worktree, NOT committed — orchestrator commits + does rm)

* `partitionFillV2/snap.ts` (EDITED — `segmentDegenerate` helper; TARGET 2 SHIPPED).
* `partitionFillV2/emitIntervalLenses.ts` (EDITED — `emitLensClosing` degenerate guard; TARGET 2).
* `partitionFillV2/emitLenses.ts` (EDITED — `emitOne` degenerate guard; TARGET 2).
* `partitionFillV2/tileConvergingStack.ts` (NEW — the gated-OFF measured-negative multi-unit
  converging construction; TARGET 1 starting point). Carries a THROWAWAY `CONV_STACK_DIAG` block
  (strip at cut-over with `COHERENT_STACK_DIAG`).
* `partitionFillV2/tileCoherentStackTypes.ts` (NEW — the shared `ConvergingSide` type).
* `partitionFillV2/tileCoherentStack.ts` (EDITED — `SideGeom extends ConvergingSide`; the
  `sorted.length > 1` bail now calls the gated `emitConvergingStack`).
* `partitionFillV2.convergingStack.test.ts` (NEW — 3 TDD gates: (a) 3-unit converging stack, (b)
  banded-left/lens-right mid-stack, (c) sub-snap-gap no-degenerate. All GREEN — (a)/(b) pass via the
  existing fallback paths on the simple synthetic shapes; (c) proves TARGET 2).
* STUBS to delete (orchestrator `rm`): `partitionFillV2.throwaway_s10harness.diag.test.ts` (the OFF/ON
  measurement of record + `CONV_STACK_DIAG` dump — regenerate with SHAPE_AUDIT=1),
  `partitionFillV2.throwaway_s10probe.diag.test.ts` (single-interval converging probe, SHAPE_AUDIT
  gated). Any session-1..9 stubs still pending rm. The `MULTI_UNIT_CONVERGING_ENABLED` flag +
  `CONV_STACK_DIAG` block stay until the next session picks TARGET 1 up.

### Next steps (session 11)

1. **TARGET 1 needs the sloping-bracket + minority-span construction** (the measured-negative root):
   the coherent slab must (a) cover only the MINORITY elevation span and leave matrix units to the
   seam — which requires the interval-restructuring (partial interval ownership), NOT the current
   all-or-nothing `tileGapTwoSided` contract — and (b) follow the sloping top/base brackets (flat
   seams/flood corners slivered on the steep real fires). Prove hole-free on the 4 real fires
   (`CONV_STACK_DIAG fire-encl` logging) BEFORE widening; the harness re-measures OFF/ON in one run.
2. **TARGET C** (edged-enclosing / lens-edged) remains the other enclosed-minority residual
   (session-9 measured-negative; owner may accept absent).
3. **Owner ties** dissolve the class-(d) untied same-formation full-widths.
4. Cutover-ready unchanged (owner dogfeed → default-ON flip → seam deletion → frozen snapshot).

---

## 14. Session-11 plan & progress — the REACH-HALVING loop (owner ruling 8b conflict-resolution)

⚡ OWNER DIRECTIVE: BUILD-FIRST (write the whole change with zero executions, then ONE battery
pass, iterate). Ruling 8d-rev fenced OFF. `intersect.ts`/`seamAnchor.ts` UNTOUCHED; v1 READ-ONLY.
No git ops.

### The owner's rule (verbatim, ruling 8b conflict-resolution, design §8 lines 495-502)

"you can just shorten the lenses by half if there is conflict with a tie — this had been said
many times." The session-10 negative CHASED sloping brackets with flat seams (which slivered);
the ruled mechanism is the OPPOSITE — the SEAMS never move, the LENS SHRINKS. When a per-unit
lens closing would cross a tie / bracket / band-authority curve, HALVE its reach and retry until
the whole lens polygon (topCorner → apex → baseCorner) fits inside the wedge between its sloping
brackets. Floor: the 1 mm snap grid; a lens that cannot fit even at minimal reach degenerates
cleanly (the session-10 `segmentDegenerate` guard — documented no-op, enclosing fill covers slot).

### The design (the halving loop replaces the seam-follows-bracket attempt)

Session-10's `emitConvergingStack` FLAT construction failed because: (1) flat horizontal seams
`(ownX,e)→(apexX,e)` slivered against the SLOPING top/base brackets (the region between apexX and
the bracket at that x was mis-covered), and (2) all-matrix / interleaved fires had no single
flood. The 4 real fires were ALL `min=1` (single minority in a matrix stack, steep brackets).

THE HALVING PRIMITIVE (`fitLensReach`, new pure helper in `lensReach.ts`): given the minority's
own [uTop..uBase] on its column, the interval's SLOPING top bracket line `(ownX,iTop)→(facingX,
facingTop)` and base bracket line `(ownX,iBase)→(facingX,facingBase)`, and the 8b start reach
`lensReachFraction`, HALVE the reach (f → f/2) until the lens polygon fits: apex point
`(ownX+f·Δx, midElev)` sits strictly BETWEEN the two bracket lines at that x AND both flanks
(topCorner→apex, apex→baseCorner) stay inside the wedge. Floor at the snap-grid fraction
(`MIN_REACH_FRACTION`); if even the floor conflicts the caller drops the lens via the
`segmentDegenerate` guard (clean no-op).

WHY halving (not the 0.02-step decrement of `clampedLensFraction`): the owner ruled halving
verbatim ("shorten by half"); it converges in O(log) and lands the lens well inside the wedge (a
conservative fit that never rides the sloping bracket → no sliver at the bracket).

### Scoreboard (end of session 11)

| metric | flag OFF (committed) | flag ON (the flip) |
|---|---|---|
| holes above / sub TD | 0 / 0 | 0 / 0 |
| different-litho overlaps | 0 | 0 |
| conformance 0corr / 1corr / 2corr | **6 / 6 / 0 = 12** | **4 / 6 / 0 = 10** |

* **flag OFF byte-identical to the session-9/10 baseline** (12; holes 0/0/0; CS1 7/7; v1 102/5skip;
  all package + shape + synthetic gates green; tsc clean). My changes only touch the flag-ON
  `emitConvergingStack` path + the pure `fitLensReach` helper.
* **flag ON: holes 0/0, overlaps 0, conformance 10** — the reach-halving construction is HOLE-FREE
  on all 14 real sections (fires on 2 CS1 intervals, both `min=1`). This CONVERTS session-10's
  **+22 holes / +81 overlaps** regression into **0 / 0** — the owner's ruled mechanism works. Net
  conformance unchanged (10 == session-9/10 flag-ON baseline).

### TARGET verification — the named instances did NOT move (data-vs-doc divergence, verified region-by-region)

Per the "trust the data over the doc" rule, dumped the actual CS1 geometry + rendered regions in
BOTH flag states. The three named targets are IDENTICAL flag-OFF == flag-ON — my `emitConvergingStack`
changes never own these intervals:

* **569.60 col=GEO-23/125-S8 gap14 u4 SILT [-6.32..-4.45] → ABSENT (both states, region kind
  UNCHANGED).** DIAGNOSIS: the SILT sits ENTIRELY BELOW the facing col15's TD (col15 deepest =
  −3.24; the SILT is at −6.32..−4.45). It is a SUB-TD / facing-too-shallow enclosed minority, NOT a
  converging-facing minority. `emitConvergingStack` bails `bail-no-bracket`; the enclosing ZAND bands
  full-width (`ZAND quad frac[0..1] el[-7.64..-1.17]`) and swallows the slot. The mission framing
  ("banded LEFT, 0-corr RIGHT → lens right") does not match the sub-TD geometry — this is the
  sub-TD-enclosed-minority class (a DIFFERENT residual), not the reach-halving target.
* **646.74 col=GEO-23/125-S7 gap18 u4 SILT [5.46..6.03] + u5 VEEN [5.05..5.46] → LENS but FULL-WIDTH
  (frac[0..1]), both states UNCHANGED.** DIAGNOSIS: the facing col19 carries CONTINUOUS ZAND (real
  thickness, TD −9.96) across the minority span → NOT a converging facing. These are COLUMN-LEVEL
  enclosed lenses (`emitEnclosedLensCurves`, session-9 TARGET A) already emitted as `kind=lens` but
  reaching full-width — an enclosed-lens TRACE/reach issue in `emitLenses`/the arrangement, NOT the
  `emitConvergingStack` path the owner's rule targets. The `lensReachFraction` 8b cap is already
  applied there; the full-width render is a labelFaces/trace merge, not a reach overshoot, so
  halving cannot fix it.

CONV_STACK_DIAG (CS1, flag ON): `entered:5, fired:2` (both `min=1`, hole-free), `bail-no-bracket:2`,
`bail-facing-same-formation-enclosure:1`. The 2 fires are at iTop5.5/iBase1.8 and iTop12.0/iBase4.0
— OTHER intervals, hole-free, no conformance change.

### Per-instance triage of the flag-ON residual (10, unchanged from session 9/10)

All ruling-8 untied same-formation full-widths (Tie-10 g0, Tie-12 g0, CS1 g18/g19, CS2 g13 ×2 —
owner-tie residual) + the sub-TD / edged-enclosing / lens-edged enclosed-minority class (TARGET C,
session-9 measured-negative; the 569.6 sub-TD SILT + the 646.74 full-width enclosed lenses are this
family). Nothing NEW, nothing regressed.

### Flag disposition — `MULTI_UNIT_CONVERGING_ENABLED` stays ON (green)

The battery is green (holes 0/0, overlaps 0, conformance 10 unchanged, CS1 7/7, v1 102/5, all shape
+ package + synthetic gates, tsc clean). Per the mission ("END default-ON if green"), the flag stays
ON: the reach-halving construction is proven SAFE (hole-free) where it fires and ready for intervals
that need it. The outer `twoSidedTerminationsEnabled` cut-over flag stays OFF (gated on owner
dogfeed — unchanged). The session-10 flat-construction negative is superseded.

### Files this session (worktree, NOT committed — orchestrator commits + does rm)

- `lensReach.ts` (EDITED — `fitLensReach` halving helper; the single source of the conflict-fit).
- `tileConvergingStack.ts` (EDITED — `MULTI_UNIT_CONVERGING_ENABLED` back ON; the flat seams/flat
  flood corners replaced by the halved-lens + SLOPING-wedge-riding construction; `lensReachFraction`
  import replaced by `fitLensReach`).
- `partitionFillV2.convergingStack.test.ts` (EDITED — added session-11 (d) halved-reach-in-a-steep-
  wedge + (e) multi-halve gates; header updated; all 16 gates GREEN).
- STUBS to delete (orchestrator `rm`): `partitionFillV2.throwaway_s11harness.diag.test.ts` (the
  one-run OFF/ON measurement of record + named-instance dump + CONV_STACK_DIAG probe — regenerate
  with SHAPE_AUDIT=1). Any session-1..10 stubs still pending rm. The `MULTI_UNIT_CONVERGING_ENABLED`
  flag + `CONV_STACK_DIAG` block stay (the flag is now ON; strip the diag at cut-over).

### Next steps (session 12)

1. **The named targets need DIFFERENT mechanisms than reach-halving** (verified this session): the
   569.6 gap14 SILT is a SUB-TD enclosed minority (below the facing TD → the substrate/deep-to-deep
   path, or a sub-TD extraction), and the 646.74 gap18 SILT/VEEN are COLUMN-LEVEL enclosed lenses
   rendering FULL-WIDTH (a `emitLenses`/labelFaces trace merge — the lens is emitted at the 8b cap
   but the arrangement traces it full-width). Neither routes through `emitConvergingStack`. Report to
   the owner: the reach-halving primitive is SHIPPED + hole-free, but "exactly these" cases live in
   the enclosed-lens / sub-TD paths, not the converging-facing path his rule addressed.
2. **`fitLensReach` is the ready halving primitive** for any converging-facing minority that DOES
   need conflict-fitting — apply it wherever a per-unit lens would cross a tie/bracket.
3. **Owner ties** dissolve the class-(d) untied same-formation full-widths.
4. Cutover-ready unchanged (owner dogfeed → default-ON flip of `twoSidedTerminations` → seam
   deletion → frozen snapshot). `intersect.ts`/`seamAnchor.ts` UNTOUCHED all session; v1 held.

### (running build log)
- Read REWRITE_STATE.md fully (§13 predecessor), design §8 (8b conflict-resolution + 8g/8h),
  tileConvergingStack/tileCoherentStack/lensReach/emitIntervalLenses/snap/emitLonePinch/
  emitLoneStack/facingMatrix. Built `fitLensReach` + the halved-lens sloping-wedge construction.
  ONE battery pass: tsc clean; synthetic gates 16/16 (incl. new (d)/(e)); holes 0/0/0 flag OFF;
  OFF/ON harness holes 0/0 both, conformance 12/10; CS1 7/7; v1 102/5; all package + shape gates.
  No iteration needed — hole-free on the FIRST real-data measurement (vs session-10's +22/+81).

---

## 15. Session-12 plan & progress — TARGET A SHIPPED (converging all-minorities stack → hugging lenses); TARGET B is a CONFIRMED sub-TD wall (recorded)

⚡ OWNER DIRECTIVE: BUILD-FIRST (write the whole change, then ONE battery pass, iterate). Ruling
8d-rev fenced OFF. `intersect.ts`/`seamAnchor.ts` UNTOUCHED; v1 READ-ONLY. No git ops.

### THE DIAGNOSIS overturned the prompt's + session-11's framing (trust the data over the doc)

Real-data probes (throwaway `s12probe`/`s12regions`/`s12curves`/`s12diag`, SHAPE_AUDIT=1) found the two
named targets are NOT what the prompt/§14 framed:

* **TARGET A (CS1 col18 x=646.74) is NOT a "column-level enclosed lens rendering full-width"**
  (§14's claim). The real geometry: u3 KLEI[6.03..6.65] / u4 SILT[5.46..6.03] / u5 VEEN[5.05..5.46] /
  u6 KLEI[4.23..5.05]. SILT+VEEN are a run of TWO MIXED-BRACKET minorities enclosed by KLEI above
  (u3) + KLEI below (u6). `sectionGeom.extractEnclosedLenses` never pulls them (adjacent minorities,
  not a single same-formation sandwich). On gap18 they route through `routeLoneSidePinch` →
  `routeLoneStack`, which BAILED: the facing col19 CONVERGES (the KLEI u6 base tie + the KLEI band
  base both land at el 7.03 on col19 → zero interval thickness) and carries no KLEI run
  (`facingMatrixRunSpan` null), so the enclosing matrix (KLEI, from the OWN column brackets) had no
  facing to band to. The seam then tiled SILT/VEEN FULL-WIDTH (curves `close50`/`close51` reaching
  col19 at el 7.03). This is a CONVERGING-FACING all-minorities lone stack — EXACTLY the shape
  `emitConvergingStack` (session 10/11) closes hole-free, but it was wired ONLY into the flag-ON
  `tileCoherentStack` path, never reached by `routeLoneStack`'s flag-OFF bail.
* **TARGET B (CS1 col14 x=569.60) u4 SILT[-6.32..-4.45] is EDGED (tied to col13's SILT)** — so on
  gap13 it correctly BANDS (matched-pair). On gap14 it sits ENTIRELY BELOW the facing col15's TD
  (-3.24) — a SUB-TD minority the deep-to-deep substrate ZAND sweeps (absent). This is the ruling-6
  sub-TD-follows-tie / edged-enclosing class (session-9 TARGET C measured negative +53 holes) —
  a DIFFERENT, substrate-path mechanism, NOT the converging-facing path. `routeLoneStack` never
  reaches it (`loneSidePinches` false — facing too shallow). Also Target A's LEFT side (gap17,
  facing the shallow col17 TD 10.42) is the SAME sub-TD class — absent, untouched.

### TARGET A — SHIPPED (`emitLoneStack.routeLoneStack` → `emitConvergingStack` fallback)

Wired `emitConvergingStack` (the session-10/11 converging-facing multi-unit-minority tiler with the
ruling-8b `fitLensReach` halving) as a FALLBACK inside `routeLoneStack`: when the facing bracket is
zero-thickness (converging) AND the ordinary reduce+band path BAILS (`bracketMatrix` null / reduced
null / `facingMatrixRunSpan` null), delegate to `emitConvergingStack`. Two supporting refinements:
1. **Stack trimming for the delegation.** `emitConvergingStack` reads its enclosing from
   `ownColumnBracket(iTop/iBase)` where iTop/iBase = the passed stack's first/last unit contacts. A
   stack whose BASE unit IS the enclosing matrix (CS1 col18: [SILT, VEEN, KLEI(u6)]) sets iBase to
   the KLEI base at the TD → `ownColumnBracket` null → `bail-no-bracket`. The fallback now TRIMS
   leading/trailing units that are an own-column enclosing formation, passing the pure minority run
   [SILT, VEEN] (iBase → VEEN base 5.05, whose below-unit KLEI u6 top=5.05 resolves the bracket).
2. **`tileConvergingStack.bail-facing-same-formation-enclosure` narrowed** (session 10 guard): it
   bailed whenever the FACING carried ONE formation across the minority. Now it bails ONLY when that
   facing formation ALSO matches an OWN-column enclosing formation (the true SILT-in-SILT annulus
   wall, CS1 g20/g21). Target A's facing is ZAND but the own enclosing is KLEI (differ) — the
   minority is a genuine hole in the OWN KLEI, not the facing ZAND → safe to lens. The g20/g21 wall
   (own==facing==SILT) still bails.

**ACCEPTANCE (gap18, RIGHT side) MET, region-by-region (flag OFF == flag ON, the DEFAULT engine):**
SILT `band` frac[0..1] el[5.46..7.03] → **SILT `lens` frac[0..0.015] el[5.46..6.03]** (hugs col18,
8b-capped); VEEN `band` frac[0..1] el[5.05..7.03] → **VEEN `lens` frac[0..0.011] el[5.05..5.46]**.
The enclosing KLEI now DETOURS around them (KLEI quads frac[0..0.015] at the notch elevations); ZAND
fills the rest. **holes/overlaps 0/0/0** (authoritative `partitionFill.holes_overlaps.diag`).
The LEFT side (gap17) stays ABSENT — sub-TD (TARGET B class), NOT this fix's scope.

### TARGET B — CONFIRMED WALL (recorded, NOT attempted — stop-and-report)

Target B (gap14 sub-TD SILT) + Target A's gap17 left side are the SUB-TD enclosed-minority class:
the facing is too shallow (no tie to converge on), so `routeLoneStack`/`emitConvergingStack` never
fire. The substrate (deep-to-deep ZAND) sweeps the slot. Carving a sub-TD lens here is the ruling-6
sub-TD-follows-tie mechanism — a substrate-path change that session-9 TARGET C measured NEGATIVE
(+53 holes: without a continuous same-formation annulus the notch rides the column edge, holes=0, the
`splitAnnulus`-bypass wall). Target B's SILT is additionally EDGED (a tied unit on gap13), so any
merge would drop its band tie (the session-9 blocker). NOT attempted this session — it needs the
sub-TD substrate-detour increment (its own red→green, touches the CS1 gap0/21/22 substrate the
cs1void/sandbody frozen gates pin). Recorded per the mission's stop-and-report allowance.

### The OFF/ON table (harness `partitionFillV2.throwaway_s12harness.diag.test.ts`, SHAPE_AUDIT=1)

| metric | flag OFF (committed) | flag ON (the flip) |
|---|---|---|
| holes above / sub TD | 0 / 0 | 0 / 0 |
| different-litho overlaps (precise gate) | 0 | 0 |
| conformance 0corr / 1corr / 2corr | **5 / 5 / 0 = 10** (was 6/6/0=12) | **3 / 5 / 0 = 8** (was 4/6/0=10) |

* **Flag OFF is NO LONGER byte-identical** (owner-ruled OK — a ruling-8h fix): the ONLY diff vs
  §11 is CS1 col18 SILT+VEEN now rendering per-unit hugging lenses (gap18) instead of full-width
  bands — both counts dropped by 2 (one 0corr, one 1corr). Everything else byte-identical: holes
  0/0/0, CS1 7/7, v1 211 pass, all shape + package + synthetic gates green, tsc clean.
* Flag ON improved the SAME 2 (the fix is in `routeLoneStack`, live in both states).
* Per-instance triage of the flag-OFF residual 10: Tie-10 g0 (1/1) + Tie-12 g0 (0/1) + CS1 g18/g19
  + CS2 residual = ruling-8 untied same-formation full-widths (owner-tie residual) + the SUB-TD /
  edged-enclosing / lens-edged class (TARGET B + Target A's gap17 left + CS1 g20/g22 — all the
  sub-TD/edged residual, session-9 measured-negative). Nothing NEW regressed.
* Cross-gap shared-column reporter: 15 rows (was ~17); +2 NEW at col18 (KLEI g17 × VEEN/SILT g18) —
  the EXPECTED Target-A asymmetry (gap17 sub-TD → KLEI fills; gap18 → the new lenses). A reporter,
  not a within-gap partition violation (precise gate 0/0/0 confirms).

### Files this session (worktree, NOT committed — orchestrator commits + does rm)

- `partitionFillV2/emitLoneStack.ts` (EDITED — the converging-facing all-minorities-stack fallback:
  `tryConvergingStack` delegates to `emitConvergingStack` on the reduce/band bail paths, with the
  minority-run trim; imports `emitConvergingStack` + `ConvergingSide`/`CorrUnit`/`EffectiveCorr` types.
  No value-import cycle — `tileConvergingStack` does not import `emitLoneStack`/`emitLonePinch`).
- `partitionFillV2/tileConvergingStack.ts` (EDITED — `bail-facing-same-formation-enclosure` narrowed
  to the own==facing enclosure only, so a mixed own/facing enclosure [TARGET A] lenses).
- `partitionFillV2.convergingStack.test.ts` (EDITED — added session-12 gate (g): an all-minorities
  KLEI/[SILT,VEEN]/KLEI lone stack facing a converging tie lenses per unit in the DEFAULT engine
  [flag OFF]. GREEN. 7 gates total).
- STUBS to delete (orchestrator `rm`): `partitionFillV2.throwaway_s12probe.diag.test.ts`,
  `partitionFillV2.throwaway_s12regions.diag.test.ts`, `partitionFillV2.throwaway_s12curves.diag.test.ts`,
  `partitionFillV2.throwaway_s12diag.diag.test.ts` (neutralised no-op stub),
  `partitionFillV2.throwaway_s12harness.diag.test.ts` (the OFF/ON measurement of record — regenerate
  with SHAPE_AUDIT=1) + `scripts/diag_s12{probe,regions,curves,_harness}.json` + `scripts/s12_edges_probe.mjs`.
  Any session-1..11 stubs still pending rm. The `CONV_STACK_DIAG` block in tileConvergingStack.ts stays
  THROWAWAY (strip at cut-over). `MULTI_UNIT_CONVERGING_ENABLED` stays ON (unchanged from §11).

### Next steps (session 13)

1. **TARGET B (sub-TD enclosed minority) is the remaining named residual** — needs the ruling-6
   sub-TD-follows-tie / substrate-detour mechanism (carve a lens out of the deep-to-deep substrate at
   the minority's own elevation), NOT the converging-facing path. Its own red→green increment; guard
   holes 0/0 + the CS1 gap0/21/22 cs1void/sandbody frozen gates. Target B's SILT is EDGED (tied gap13)
   — the sub-TD lens must not drop that band tie. Owner may accept absent (session-9 recorded negative).
2. **Target A's gap17 LEFT side** is the SAME sub-TD class (facing col17 TD 10.42 ≫ the SILT/VEEN el
   ~5.5) — folds into (1).
3. **Owner ties** dissolve the class-(d) untied same-formation full-widths.
4. Cutover-ready unchanged (owner dogfeed — the col18 SILT/VEEN lenses now render, worth a look →
   default-ON flip → seam deletion → frozen snapshot). `intersect.ts`/`seamAnchor.ts` UNTOUCHED all
   session; v1 211 held.

---

## 16. Session-13 plan & progress — TARGET B (sub-TD per-side lens) SHIPPED; TARGET A already correct

⚡ OWNER RULING driving this session (verbatim): "this is a very simple rule — 0 correlations,
left or right = lens to the same side. Per-side, unconditional, INCLUDING sub-TD." Ruling 8d-rev
(top band = one correlation) stays FENCED OFF. Build-first: wrote everything with zero executions,
then ONE battery pass. `intersect.ts`/`seamAnchor.ts` UNTOUCHED; v1 READ-ONLY.

### THE DIAGNOSIS overturned the prompt's framing for TARGET A (trust the data over the doc)

Real-data probes (throwaway `s13probe`/`s13extract`/`s13sub`/`s13curves`, SHAPE_AUDIT=1) on CS1:

* **TARGET A (col12 x=502.88 u1 KLEI [11.98..8.48], gap12) ALREADY RENDERS ITS LENS.** The prompt's
  claim "gets NO lens" is STALE (the session-9 `shouldEmitLens`-unconditional fix + the interval
  tiler already cover it): gap12 renders `KLEI lens frac[0..0.201] el[8.48..11.98]` (hugs col12's
  right edge, 8b-capped) + `ZAND lens frac[0..0.115]` (u3). col12 has NO column-level enclosedLenses
  (the KLEI is EDGED to col11 in gap11, so `sectionGeom.extractEnclosedLenses` skips it) — the lens
  is emitted by the interval tiler. The counter never flagged gap12 (conformance CS1 flags gap7/18/
  19/20/22, NOT gap12). **The SILT member disposition (per 8g(b), answered from the rules):** the
  facing col13 carries CONTINUOUS SILT [11.73..4.84] overlapping u2 SILT's band → the two SILTs are
  a same-formation run that legitimately MERGES into ONE body (ruling 8g(b) "base-tied same-formation
  pairs are one band"; ruling 8e "one body by construction"). So the SILT renders `pinch frac[0..1]
  el[3.98..11.98]` full-width AS DESIGNED — it is held back from lensing by that legitimate merge,
  not by a defect. The gate reads it as `8e-enclosure` (one of CS1's 15), never a violation. **No
  engine change for TARGET A** (adding one would risk a regression on a correct render).

* **TARGET B is the genuine unshipped work.** Two named instances, both counter-INVISIBLE (the
  conformance gate excludes sub-TD units per §8 Q3; the zerocorr audit doesn't flag them) — the owner
  wants a RENDER fix, not a counter move:
  - **CS1 col14 (x=569.60) gap14 u4 SILT [-6.32..-4.45]:** banded LEFT (gap13, edged), 0-corr RIGHT
    (gap14), entirely below facing col15's TD (-3.24) → the deep-to-deep ZAND substrate swept its
    slot (ABSENT). Now renders `SILT frac[0..0.45] el[-6.32..-4.45]` hugging col14's right edge.
  - **CS1 col18 (x=646.74) gap17 u2 SILT [5.46..6.03] + u3 VEEN [5.05..5.46]:** below facing col17's
    TD (10.42) → swept by the KLEI substrate (ABSENT). Now render `SILT/VEEN frac[0.55..1]` hugging
    col18's left edge (toward col17).

### TARGET B — SHIPPED (`partitionFillV2/emitSubTdLenses.ts`, wired into `emitCurves`)

New pass emitted AFTER `emitBottomTieSubstrate` (curves-first — the col3 interbed-lens proof,
session 9): for each gap+side, a 0-corr unit entirely below the FACING TD gets ONLY its
8b/`emitLensClosing`-capped closing pair into the CURVE SET; the arrangement carves the HOLE out of
the continuous substrate band BY CONSTRUCTION. The substrate's own curves (floor/curtain/bridge) are
UNTOUCHED — owner §8 Q3 / ruling 6 preserved.

**THE HOLE-FREE GUARD (the session-9/12 sub-TD wall, +53-hole class).** A lens fires ONLY for a
MINORITY RUN cleanly enclosed by ONE formation M:
- M = the formation immediately ABOVE the topmost sub-TD 0-corr minority;
- the run extends down while units are sub-TD 0-corr AND ≠ M;
- the unit immediately BELOW the run must be M too (a uniform-M annulus — the substrate that floods
  the slot is uniformly M);
- NO run member may be BRIDGE-ANCHORED. This is the load-bearing guard: the FIRST battery pass
  measured a GAP-8 interior void (cs1void RED — 12628 cells) because col9 u3 SILT / u4 ZAND (facing
  the shallow col8 TD 9.29) were lensed, but col9 u4 ZAND is a jump-tied deep-to-deep SUBSTRATE band
  (`fi9:u4 == fi7:u3`) — carving into a substrate band voids the face. Excluding any bridge-anchored
  run member fixes it: SECOND pass cs1void 7/7 green.

A unit whose own formation IS the flooding M (col14 u5 ZAND, u6 KLEI) is never in the ≠M run — it
merges (ruling 8e one body), hole-free. Both named instances verified region-by-region.

### The OFF/ON table (harness `partitionFillV2.throwaway_s13harness.diag.test.ts`, SHAPE_AUDIT=1)

| metric | flag OFF (committed) | flag ON (the flip) |
|---|---|---|
| authoritative holes above / sub TD (HOLES_DIAG) | 0 / 0 | 0 / 0 |
| different-litho overlaps | 0 | 0 |
| conformance 0corr / 1corr / 2corr | **5 / 5 / 0 = 10** (unchanged) | **3 / 5 / 0 = 8** (unchanged) |
| zerocorr full-width audit (a/c/b) | 1/6/2=9 (unchanged) | — |
| CS1 regions | 244 → **247** (the 3 new sub-TD lenses) | 769 total (both engines) |

* Conformance UNCHANGED (the sub-TD lenses are conformance-excluded units — the counter never saw
  them). CS1 regions 244→247 = col14 SILT + col18 SILT + col18 VEEN. holes 0/0/0 (authoritative
  HOLES_DIAG gate); diffOverlaps 0 both flag states.
* Per-instance triage of the flag-OFF residual 10 (unchanged): Tie-10 g0 (1/1) + Tie-12 g0 (0/1) +
  CS1 g18/g19 + CS2 g13 = ruling-8 untied same-formation full-widths (owner-tie residual) + the
  edged-enclosing/lens-edged class (CS1 g20/g22 — session-9 measured-negative). Nothing NEW regressed.
* Substrate-above-tie reporter UNCHANGED (CS1 v2 = 11); v1-short-v2-full = 0 (owner-complaint class
  clean); sameFormOvl v2 = 0.

### Verification snapshot (end of session 13)

- tsc clean · conformance **5/5/0=10** flag OFF (unchanged) · holes **0/0/0** (authoritative, flag
  OFF) · diffOverlaps 0 BOTH flag states · CS1 gates **7/7** (cs1void green after the bridge-anchor
  fix) · v1 pure-geometry **215 pass** · full utils suite **772 pass / 24 skip / 0 fail** · all 7
  shape gates + the 6 synthetic package gates (bidirSweep/coherentStack/convergingStack/
  coherentLoneStack/enclosedLensDetour + new subTdLens) green.

### Files this session (worktree, NOT committed — orchestrator commits + does rm)

- `partitionFillV2/emitSubTdLenses.ts` (NEW, committed-quality — the sub-TD minority-run lens pass
  with the M-in-M annulus enclosure test + the bridge-anchor guard).
- `partitionFillV2/emitCurves.ts` (EDITED — imports + calls `emitSubTdLenses(survivingSection, ties,
  bridgeAnchored, lensLabels, curves)` after `emitBottomTieSubstrate`).
- `partitionFillV2.subTdLens.test.ts` (NEW — 3 TDD gates, DEFAULT engine: (a) mixed sub-TD run
  [SILT,VEEN] each member lenses; (b) sub-facing-TD SILT bands-left/lenses-right, hole-free; (c) a
  ZAND minority in a ZAND substrate gets no lens [same-formation-annulus wall]. All GREEN).
- STUBS to delete (orchestrator `rm`): `partitionFillV2.throwaway_s13probe.diag.test.ts`,
  `partitionFillV2.throwaway_s13extract.diag.test.ts`, `partitionFillV2.throwaway_s13sub.diag.test.ts`,
  `partitionFillV2.throwaway_s13curves.diag.test.ts`, `partitionFillV2.throwaway_s13synth.diag.test.ts`,
  `partitionFillV2.throwaway_s13harness.diag.test.ts` (the OFF/ON measurement of record — regenerate
  with SHAPE_AUDIT=1), `scripts/s13_probe.cjs`. Any session-1..12 stubs still pending rm.
  `MULTI_UNIT_CONVERGING_ENABLED` stays ON (unchanged).

### Next steps (session 14)

1. **TARGET A needs NO engine work** — the KLEI already lenses, the SILT member is a legitimate
   8g(b)/8e one-body merge. Report to owner; if he wants the SILT to ALSO lens (splitting the
   same-formation merge), that is a different ruling (8d-rev-adjacent), currently FENCED OFF.
2. **The edged-enclosing / lens-edged residual** (CS1 g20/g22) is the LAST enclosed-minority class —
   session-9 measured-negative (+53 holes), owner may accept absent. NOT the sub-TD path (the
   sub-TD pass here only fires below the facing TD; g20/g22 are above-TD edged minorities).
3. **Owner ties** dissolve the class-(d) untied same-formation full-widths.
4. Cutover-ready unchanged (owner dogfeed — the col14 SILT + col18 SILT/VEEN sub-TD lenses now
   render → default-ON flip → seam deletion → frozen snapshot). `intersect.ts`/`seamAnchor.ts`
   UNTOUCHED all session; v1 215 held.
