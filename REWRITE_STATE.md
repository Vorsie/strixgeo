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
