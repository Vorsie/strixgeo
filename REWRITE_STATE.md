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
