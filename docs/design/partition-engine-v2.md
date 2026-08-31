# Partition Engine v2 — closed-loop (face-tracing) model

**Status: APPROVED (2026-07-13 — owner reviewed the §8 open questions one by
one; decisions recorded in §8).** Decision record: CLAUDE.local.md →
"DECISION 2026-07-13 — partition engine v2". Target: closed beta ~mid-August;
v2 built in parallel, cut over behind a dev flag, old engine stays as
fallback.

## 1. Why (one paragraph)

The shipped engine builds a GLOBAL invariant (a true partition of the section)
from LOCAL per-gap decisions (the 2/1/0 rule), then repairs the seams with a
stack of reconciliation passes: carve tiers, the #228 disjointness pass,
deep-to-deep substrate, spanning bands, drape, under-column fill. Every
dogfeed campaign has added a pass; passes interact; new leak classes keep
appearing (2026-07-13: notch-collision dropout + the disjoint pass skipping
`kind='lens'` regions — fixed as `carveLensOverlaysDisjoint`, but the class
is structural). In v2 the partition invariant holds **by construction**:
regions are the faces of a planar arrangement — no holes, no overlaps, no
cross-gap identity drift, no notch bookkeeping, no repair passes.

## 2. The model (owner-refined, 2026-07-13)

Walking correlations alone is NOT sufficient — an uncorrelated lens has no
edges to walk, and an onlap has only one correlated side. The walk graph
therefore has FOUR curve types:

1. **Column verticals** — each investigation's left/right footprint edges,
   from surface elevation down to TD.
2. **Contact segments** — each unit's top/base along its own column face
   (the per-column litho column, gap-free by the FC↔LL triggers).
3. **Tie curves** — approved correlation edges spanning a gap, connecting
   contact endpoints on facing column edges (side-aware: top/base).
4. **Closing curves** — SYNTHESIZED where a boundary cannot continue on a
   tie: pinch/apex geometry into the gap (today's placement rules, §4), the
   deep-to-deep substrate bridges below a shallow TD, and freedraw
   boundary-node overrides.

**Face classification is boundary composition, not tie counting:**

* Boundary exits the section at both ends (or runs tie→tie across every
  gap it spans) → **BAND**.
* Boundary uses exactly one tied side and closes back via its own contact
  segments + one synthesized closing curve, riding a bracket tie-line for
  part of its run → **ONLAP**.
* Boundary uses no ties at all — fully closed via own contacts + closing
  curves → **LENS** (this covers the uncorrelated same-lithology unit
  enclosed in its own lithology: still a closed loop, still a face).

The 2/1/0 rule REMAINS the *gesture/UX semantics* (what a user creates by
tying 2/1/0 boundaries). The loop model is the *engine semantics* — 2/1/0
outcomes emerge from which curve types the traced boundary uses.

## 3. Pipeline

```
inputs                     arrangement                 output
──────                     ───────────                 ──────
columns (units, surface,   1. emit curves (4 types)    faces → sliced at
  TD), alongM (REAL m),    2. snap/intersect into a    column verticals →
  approved edges (side-       planar arrangement       per-gap SectionRegion[]
  aware), lensApex/        3. trace faces (half-edge   {formationId, bodyId,
  freedraw overrides          walk)                     kind, polygon,
                           4. label faces (formation,   gapIndex}
                              body, band/onlap/lens)
```

* **Geometry space:** per-gap fraction × elevation for the OUTPUT (contract
  compat, §5); the arrangement itself works in along-metres × elevation
  (alongM is load-bearing — uniform spacing diverges; see memory
  `feedback_partitionfill_needs_alongm`).
* **Face labelling:** formation comes from the column units whose contact
  segments bound the face; `bodyId` is stamped from the layer rows (body
  resolution stays the backend's job — the engine never invents bodies).
* **Numerical robustness:** snap-round intersection points to a fixed grid
  (1 mm elevation × 1e-6 fraction) before tracing; degenerate/zero-area
  faces are dropped at trace time (not repaired afterwards). No epsilon
  cascades: ONE snapping pass, then exact walking on the snapped graph.

## 4. Domain-rule inventory (from the v1 engine — every rule becomes a
curve-placement rule, is retired consciously, or stays a consumer concern)

| v1 rule / pass | v2 disposition |
|---|---|
| 2/1/0 per-gap classification (`classifyTermination`) | RETIRED as engine logic; emerges from boundary composition (§2) |
| `LENS_PINCH_FRACTION` 0.45 / `INTERIOR_PINCH_FRACTION` 0.5 | KEPT — closing-curve apex placement defaults |
| `lensApexOverrideKey` per-body apex shaping | KEPT — parameterises the closing curve |
| Freedraw `body_boundary_shape/node` overrides | KEPT — user nodes REPLACE the synthesized closing curve for that boundary; clip-to-matrix ("ride the seam", Solution 2) becomes: the freedraw curve is inserted into the arrangement and intersected like any curve — it CANNOT cross into a neighbour face silently |
| Carve tiers + `carveLensOverlaysDisjoint` + `makeGapRegionsDisjoint` (#228) | RETIRED — faces are disjoint by construction |
| `insertNotches` / notch bookkeeping | RETIRED |
| Deep-to-deep substrate (`computeBracketSubstrate`; cap emit at shallow TD, fill below from bracketing deep anchors) | KEPT — synthesized bridge curves below a shallow TD between deep anchors; the sub-TD region becomes ordinary faces |
| Under-column substrate (`computeUnderColumnSubstrate`) | LIKELY RETIRED — in v2 the arrangement spans column footprints below TD too (the void under a shallow test is just a face bounded by bridge curves); confirm during parity |
| Spanning bands / `drapeConnectedBodiesIntoVoids` | RETIRED — a band face follows its tie curves through EVERY intermediate column (the S7A linearisation class cannot occur: the boundary passes through each tied contact, not a straight line between endpoints) |
| `computeBottomTieLine` | KEPT as tie-curve construction for base-side ties |
| `collapseAdjacentSameFormation` / `closeColumnGaps` | KEPT — input normalisation before curve emission |
| Interval extraction (`extractIntervalMinorities`) | RETIRED as a pre-pass; enclosed minorities become lens faces naturally. VERIFY on parity: the minority-extraction heuristics may encode placement choices that need porting to closing curves |
| Band authority (cs1bandauthority semantics) | CHANGED (owner ruling, §8 Q4) — crossing approved ties are a HARD CONFLICT: neither tie bands, both units fall back to pinch/lens, and the section surfaces a visual validation warning (crossings endpoint already detects the pair) until the user deletes one. No silent winner. |
| Band dips below a shallow neighbour's TD when a tie reaches it (`facingBandTd` / `reanchorBandToFacing`) | KEPT (owner re-affirmed, §8 Q3) — a tie anchored at/into the shallow test's TD region counts as an anchor: the band follows that tie line and colours below the TD |
| Same-formation lens-on-own-matrix overlay retained for nested-body render | CHANGED — in v2 the enclosed unit is its own face (not an overlay on the matrix). The overlay render must draw it as a face; nested-body visuals come from face adjacency, not painting order |
| `computePartitionFill(left, right)` 2-column wrapper | KEPT — thin wrapper over the v2 section call (public API compat; the pure-geometry unit tests ride it) |
| Open bug: horizontal-only band-emit (band dips below shallow TD) | Must be FIXED-BY-DESIGN in v2 (bridge curves are the mechanism); add a gate from the dogfeed repro before cutover |

Discovered during the increment-2 build (2026-07-13) and added per the rule
below:

| v1 rule / pass | v2 disposition |
|---|---|
| Derived base-tie: a top-tie on unit *k* also ties the BASE of unit *k−1* (`classifyTermination` case (a)) | KEPT — without it a unit sandwiched between two top-ties never reads fully-banded; implemented in `emitClosings` tie registration |
| Implicit top closure via full-width matrix bands | CHANGED — the face-tracing model needs an EXPLICIT surface curve per gap (`emitSurfaceCurves`) or near-surface pinch vacancies stay untraced |
| Enclosed-lens matrix merge (v1 step-0 interval extraction → matrix continuous, lens overlaid) | UNBLOCKED + FLAG ON (increment 12, 2026-07-14). The increment-3 blocker was a `labelFaces` MISLABEL, not geometry — the arrangement already traced v1-correct notch+triangle simple faces, but the old `face.holes.length === 0` discriminator let the matrix notch steal the lens label (a notch leaves BOTH faces hole-free). `labelFaces` now discriminates the lens's own face by boundary composition (all-synthesized boundary + does not span the gap). `slice.splitAnnulus` splits a true interior-hole annulus into v1-carve simple pieces (left cap / right cap / above-strip / below-strip; Sutherland–Hodgman, simple by construction), replacing the increment-6-removed keyhole. Real sections currently produce only notches (0 hole-faces) — the annulus slicer is the load-bearing prerequisite for increment 13's own-elevation-lens-in-facing-band. `ENABLE_ENCLOSED_LENS = true` default, kept as emergency kill-switch |

Discovered during the increment-3 build (2026-07-14):

| v1 rule / pass | v2 disposition |
|---|---|
| Deep-to-deep substrate (concrete v2 mechanism) | IMPLEMENTED as jump-tie BRIDGE curves (`emitSubstrate.ts`): a non-adjacent tie emits a bridge polyline from the lo anchor's contact through every intervening column x (real alongM) to the hi anchor; a deep anchor unit whose contact a bridge carries skips its own lens/onlap closing; bridge-bounded faces read BAND. Bridge-less strips stay empty (owner §8 Q3) |
| Vacancy closure at terminations (v1 `emitInterval` two-pieces-plus-filler + the owner-validated "no auto-facies" straight midpoint seam) | IMPLEMENTED (increment 4a, `emitIntervals.ts`) — untied units of each interval between tie-anchored bands tile it fully via vertical seams (thickness-weighted; straight midpoint 0.5 for a mismatched matrix; full width for a lone side) + horizontal sub-seams + a shallow-TD floor curve. Holes/overlaps 0/0 on all 14 sections, confirmed by BOTH the scan diag and an independent PIP sweep. PARITY GAP remaining: seam SHARE differs from v1 in places (equal-and-opposite formation-pair deltas in the A/B diff) — seam placement must become v1-exact (increment 5) |
| Enclosed-lens disjointness (v1 `carveOverlays`) | REPLACED (increment 4a, `emitIntervalLenses.ts`) — a 0.45-apex lens stays a disjoint hole via a mandatory seam margin (`LENS_MARGIN`: the seam sits strictly outside the apex) + a single-matrix guard (enclosed-minority extraction only fires when the residual matrix is ONE formation; interbedded stacks tile as ordinary seam-meeting units). Widen-the-cell instead of subtract-the-overlap |

Discovered during increment 5 (2026-07-14, parity + gates against v2):

| v1 rule / pass | v2 disposition |
|---|---|
| Substrate WITHOUT explicit ties — v1 `computeBracketSubstrate` brackets the nearest deep anchor each side of a shallow run and fills deep-to-deep with NO correlation edge required | IMPLEMENTED (increment 6, `emitBottomTieSubstrate.ts`) — per gap a flat bottom-tie floor curve (ported `computeBottomTieLine` semantics) + curtain curves from each column's deepest anchor down to the floor; sub-TD wedge stamped from an explicit bottom-tie label. cs1void gate PASS (16 void gaps → 0). Bridge-less strips still stay empty (owner §8 Q3). (Increment 5 had mislabelled this gap "owner Q3 by design" — Q3's stay-empty applies only to bridge-LESS strips) |
| Band authority over adjacent tiling (cs1bandauthority interior invariant) | FIXED (increment 7, `emitBands.ts`) — band-first tiling. Each matched-pair band (top-top/base-base same-formation adjacent tie) contributes its top/base contour as an interval BRACKET and as an above-TD arrangement closing curve (`bandc*`), and its member units are excluded from the untied tiler — a facing untied unit tiles only the residue outside the band and stops at the band boundary. Contours are gated ABOVE the shallow TD so the substrate keeps the deep zone (that gating is what avoided the sandbody/lensdisjoint regressions the reverted increment-6 point patches caused). cs1bandauthority PASS; all 7 gates green |
| Onlap-on-shared-matrix placement — v1 bands the shared-formation matrix full-width and onlaps the odd unit; v2 tiled both as opposing seam-meeting pinches | RESOLVED with band-first tiling — v2 now bands the shared matrix full-width; the equal-and-opposite seam-share pairs (Tie-4 gap0 KLEI/SILT ±3920/±3400 cm²) are gone, parity kindChanges 142→94, grand Δ steady at +0.6% |
| Output-polygon simplicity — v1 emits simple (concave, carved) polygons | FIXED (increment 6) — the real cause was NOT keyholes (0 faces carry holes on the real sections) but weakly-simple figure-8 rings from the tracer at pinch/apex vertices + float-noise near-duplicate slice vertices. `faces.splitAtRepeats` splits self-touching loops into strictly-simple sub-loops; `slice` snaps output elevations to the 1 mm grid and splits repeated points. A committed test asserts 0 self-intersections / 0 repeats across all 14 sections. Also fixed shared gate plumbing: the overlap-check ear clip accepted invalid ears on concave combs (exclusive triangle containment missed on-edge vertices) — inclusive containment now; v1 gates unaffected (verified) |

Strict-2/1/0 build status (ruling 8; increment of 2026-07-15,
`9c9450733`..`68ae66c6d`):

| v1 rule / pass | v2 disposition |
|---|---|
| Geometric same-formation auto-match | RETIRED across four sites (ruling 8): `emitLonePinch` continuous-band full-flood (now gated to the enclosing-matrix-of-lens-stack case only), `routeLoneSidePinch`'s mixed-bracket bail (now routes to a 0.45 own-elevation lens via `forceLens`, gated `!facingConverges` so a genuine void stays sideways per Q3), and `labelFaces` `spansGap→band` (narrowed to require a real gap-crossing anchor). Acceptance = the `shapeaudit.zerocorr` counter: **22 → 16, target 0**. REMAINING (one class, the §-increment-14 boundary-minority wall again): an untied minority whose enclosing matrix ABOVE is a tied band, against an INTERBEDDED facing — not extractable as an enclosed lens, the seam-tiler cannot separate it; needs the annulus routing extended to this shape. Relabeling would mask, not fix (the polygon genuinely spans) |
| Seam grid-snap robustness (`seamAnchor.ts`, `b5b31a5d2`) | A seam endpoint on a SLOPING bracket dangled after the 1 mm snap (exact-integer collinearity failed ~0.3 mm off) → the interval traced full-width (the real root of the VEEN class, NOT auto-matching). Seam endpoints are now the collinear lattice point on the snapped bracket (grid-exact T-junction). WARNING: do NOT relax the arrangement core (`intersect.ts`) to register snapped proper-crossings unconditionally — measured 613 holes |
| Shape (i) surface-topped onlaps | PARTIAL (2026-07-15, `493e28214`): zerocorr 14→12. CS1 g16 B2 KLEI fixed (the base-reach guard wrongly voided a base-tied onlap whose facing TD sits above the unit base — an onlap laps the TIE, not the unit base; single-unit surface-extended base-tied candidates defer the guard). CS2 g10 SILT fixed (facing converging NEAR the top-band drove the rising apex onto the top-band line → full-width collapse; apex clamped 2 cm below the top-band). OPEN, owner design call: the NON-converging deep-facing onlap (CS1 g8×2, g19 KLEI) — tip-on-the-tie inherently opens a ~6 cm enclosing-matrix sliver above the onlap's dipping top (ruling-5-revised violation, measured), vs tip-on-the-top-band / base-only taper (no sliver, deviates from "tip at 0.5 ON the tie"). CS1 g19 ZAND = geometric same-formation band, shape-(iii) scope. g7 KLEI stays Q3 (retag when g8/g19 close) |
| Shared-contact onlap (ruling 8a — interior converging case) | SHIPPED (2026-07-15, `87e6ccb9c`, `emitSharedContactOnlap.ts`): a minority between two REAL tied brackets whose top OR base rides a TIED shared contact — including a CONVERGING facing bracket — onlaps that tie (tip 0.5); the untied-side enclosing matrix floods both wedges past the tip, the tied band never enters the interval. Owner's S5A\|S5 KLEI verified per his closed-loop trace (clay pinch tip (0.5,·), silt quad closing around the notch, sand band below; hole-free). zerocorr 15→14. The `top.anchor && base.anchor` guard is LOAD-BEARING (without it the flood invents a full-width band to the surface — measured CS1 g8). REMAINING 13, three shapes: (i) ~7 surface-topped onlaps facing a NON-converging deep column — need `emitSurfaceOnlap`'s rising apex extended without inventing a top matrix; (ii) interior tied-onlap with an UNTIED opposite bracket — relaxing the guard runs the flood full-width; (iii) ~4 same-formation enclosed LENSES (0-corr, v1 pinches 0.45) — the documented interbedded-facing annulus wall. CS1 g7 KLEI = genuine §8-Q3 surface-void, correct, NOT retagged while real defects remain |
| Strict-2/1/0 residual (16 zerocorr violations) | DIAGNOSED (2026-07-15 session): THREE sub-shapes, not one — (a) ~7 same-formation enclosure incl. interbedded facing; (b) ~6 mixed-bracket (minority between two DIFFERENT tied bands — needs an owner ruling on what floods the vacated width); (c) ~3 surface-boundary + facing-void (judge against §8 Q3). Root of (a): `routeLoneStack`'s `facingMatrixLabel(convElev)` samples the WRONG facing unit at a zero-thickness facing bracket on a contact → bail → full-width. The routing fix exists (`enclosingMatrixOfInterval`, lone-column bracket adjacency `belowLith ?? aboveLith`) and reshapes the lens correctly, but the FLOOD face then absorbs the base-boundary lens (measured Tie-6 SILT×KLEI 15.9 cm): flood-labelled faces (`units.length===0`) BYPASS `splitAnnulus` (fires only on holes>0). FIX PATH: bound the `emitLoneStackBand` flood below a base-boundary minority (base-bracket split at apex-x, or route flood faces through the annulus/notch splitter even at holes=0), verified against the 32 currently-OK routeLoneStack cases |
| Completeness increment Case 0 — ruling-8d instrument correction | SHIPPED (2026-07-15). The conformance gate (`partitionFillV2.conformance.classify.ts` / `.conformance.diag.test.ts`) did NOT count the top band as a tie. Added `topBandTies(ui)` + `firstUnitTopBandBand` (top-band implicit tie AND a real/derived base tie → 2-corr) and a midpoint-quad render acceptance (`facingFirstDiffers` → per-side `onlap` shape is a valid band render, not `2corr-not-band`). The top band is folded into 2-corr ONLY paired with a base tie — a first unit tied ONLY by the top band (no base tie) stays a 0-corr §8-Q3 surface void (CS1 g7 KLEI verified). CORRECTED BASELINE (acceptance denominator): byCorr **41/145/756** (was 41/186/715 — 41 first units promoted 1-corr→2-corr), **0corr-not-lens 22, 1corr-not-onlap 99, 2corr-not-band 0**, q3-legit 6, reach-cap advisory 2. Instrument-only — engine output, holes/overlaps 0/0/0, CS1 gates 7/7 all unchanged |
| Shared corr-arithmetic helper (ruling 8c terminations-first foundation) | SHIPPED (2026-07-15, `partitionFillV2/effectiveCorr.ts`). The per-unit-per-gap-per-side effective-corr (2/1/0) arithmetic — `tiedFlags` (direct + derived base-tie), `derivedBandTies` (ruling-8a shared contact), `isBandMember` (`collectGapBands`), `topBandTies` (ruling-8d first-unit implicit top band), `unitHasDirectTie`, and the collapsing `effectiveCorrForUnit`/`effectiveCorrForSide` — is now ONE source of truth in the ENGINE package. The conformance gate's `partitionFillV2.conformance.classify.ts` RE-EXPORTS it (verdicts byte-identical: 22/99/0, byCorr 41/145/756 confirmed unchanged before/after), and `emitIntervals.tiedContacts` DELEGATES to the shared `tiedFlags` (bridge-anchor extension layered on top; engine output byte-identical). Engine and gate now CANNOT drift — the gate checks exactly the outcome the arithmetic names. Full battery green (holes 0/0/0, CS1 7/7, strict210/loneSidePinch/simplerings/bandAuthority/derivedTieOnlap 23/23, tsc clean); v1 untouched |
| Terminate-by-default (ruling 8c) DEFAULT FLIP — the interval tiler | STOPPED WITH GEOMETRY (2026-07-15, §8 ruling 7). Baseline 22 `0corr-not-lens` + 99 `1corr-not-onlap` + 0 `2corr-not-band`; by render shape: 85 1-corr full-width BAND + 17 0-corr full-width BAND + 14 1-corr ABSENT + 5 0-corr ABSENT (86 of 121 in CS1/CS2/CS3). The bulk are NOT un-routed remainders a tiler one-liner fixes: traced (Tie-section 4 g0 ZAND, the section's ONLY violation) the offending band face is a COMPOSED face — a genuine matched-pair ZAND band (u5/u3, correctly 2-corr) merged DOWN through flood wedges + `bandc` contours to a base-tied ZAND u7 (1-corr) with NO own termination curve, so the arrangement traces ONE ZAND face reaching full width (boundary ids: tie×2, bandc×2, flood×3, onlap×1, close×2). The ruling-8c fix (emit u7's onlap termination FIRST) requires per-unit termination curves in the TWO-SIDED interval tiler, which today emits interval SEAMS (thickness-weighted meet fraction) — a fundamental restructuring of `tileInterval`/`meetFraction`, with the vacated-space re-closure being exactly what increments 8–18 got right for lone-side ONLY. Cannot land as one increment with the "battery green (holes 0/0/0) after EVERY milestone" bar + the 613-hole-sensitive `intersect.ts`/`seamAnchor.ts` core off-limits; a partial flip violates ruling 7 (no gaps). FIX PATH (its own red→green increment): drive `tileInterval` from `effectiveCorrForSide` — for each unit per side emit its termination (2→band; 1→onlap tip 0.5 riding its tie via the `emitSharedContactOnlap`/`emitSurfaceOnlap` machinery generalized to two-sided; 0→8b-capped lens), replacing the seam model, then re-close the interval residue against the emitted lines; validate per-section (Tie-4 first) against the frozen battery. The shared helper (row above) is the ready foundation. **ROOT DEEPENED (2026-07-15 follow-up session):** an empirical facing-thickness probe over ALL 121 violations found **converging=0, thick=117** — NONE are the zero-thickness converging triangle first suspected; every offender faces a REAL-thickness column. The true root is **SAME-FORMATION ENCLOSURE**: the offending unit's enclosing matrix on its UNTIED side EQUALS its own formation (Tie-4 R u7 ZAND base-onlaps the KLEI band below, but the ZAND matched band ABOVE is the untied-side enclosing — same ZAND), so ANY termination flood past the tip re-merges into one full-width same-formation face the by-formation gate flags `1corr-not-onlap`. The gate cannot distinguish "the unit" from "its same-formation enclosing flood"; the ONLY render it accepts is the vacated wedge filled by a DIFFERENT formation (the neighbour band on the tied side rising around the notch — ruling 8a boundary composition generalised). **LANDED (safe first piece):** `partitionFillV2/emitTerminations.ts` `chooseOnlapEnclosing` — the single-unit interior onlap (`emitSharedContactOnlap` path, `loneMatrix.length===1`) now floods the wedge with whichever bracket enclosing DIFFERS from the unit (untied-side by default per 8a; the tied-band side when the untied enclosing is the unit's own formation). Verified holes 0/0/0, CS1 7/7, all 23 shape gates, conformance UNCHANGED at 22/99/0, v1 untouched, tsc clean. Produces no counter drop yet because ALL 121 violations route through the MULTI-UNIT `routeLoneStack` (or the two-sided seam tiler), NOT the single-unit path — the same-formation boundary unit (e.g. Tie-4 R u7) is currently ABSORBED as the stack's flood-matrix (`bracketMatrix.formationId === u.formationId`). REMAINING (the multi-unit fan, next increment): `routeLoneStack` must EXCLUDE a tied boundary unit whose formation equals the picked matrix from the flood, emit it as a per-unit onlap (own apex — the shared apex self-inverts, increment-11) with `chooseOnlapEnclosing` picking the differing neighbour band, and split adjacent onlaps by their shared-contact seam; validate per-section against the frozen holes/overlaps battery (the `routeLoneStack` change touches 32 currently-OK cases — regression-guard each). The RED gate is READY at `partitionFillV2.twoSidedTermination.test.ts` (describe.skip, Tie-4 g0 offender encoded) |
| Ruling-8e GATE RESCOPE (same-formation enclosure conforms) | SHIPPED — INSTRUMENT ONLY (2026-07-15, ruling 8e). The `ROOT DEEPENED` row above found 117 of the 121 conformance violations are SAME-FORMATION ENCLOSURE; owner ruling 8e re-judged them a GATE FALSE POSITIVE ("it should be one sand" — the traced loop closes ONE same-formation body around any minority). The rescope lives in the conformance gate (`partitionFillV2.conformance.classify.ts` `sameFormationEnclosedByTiedBand` + the `8e-enclosure` advisory in `.conformance.diag.test.ts`), NO engine change. **EXEMPTION CRITERION:** a flagged unit whose render is FULL-WIDTH / band in its OWN formation AND that formation carries a matched-pair band (drawn/derived tie, `collectGapBands`) across the gap → tagged `8e-enclosure`, not flagged. **NEGATIVE GUARD (ruling 8 preserved):** a same-formation full-width with NO tie of that formation in the gap STAYS flagged (opposing lenses, retired auto-match). **ABSENT NEVER EXEMPT** — an absent minority is missing from the line network (ruling 8e's mandatory "don't forget the silt lens" condition), so it stays REAL engine work. NEW TRUE BASELINE: **0corr-not-lens 6, 1corr-not-onlap 26, 2corr-not-band 0 → 32 total** (was 121); 90 tagged `8e-enclosure`; q3-legit 5; reach-cap 2. Of the 32: **19 ABSENT** (13 1-corr + 6 0-corr — Milestone-2 engine work) + **13 full-width UNTIED** (the ruling-8 `same-form-enclosure`/`mixed-bracket` residual, correctly still flagged). The `shapeaudit.zerocorr` region counter is UNCHANGED at 12 (it already excluded tied-formation full-widths via `formationHasTieAcrossGap` — 8e-consistent by construction; documented in the file header). Engine output byte-identical, holes 0/0/0, CS1 7/7, all shape gates green, v1 untouched, tsc clean. The RED `twoSidedTermination.test.ts` gate was REWRITTEN as a GREEN 8e case (Tie-4 g0: the ZAND boundary unit merges into the ZAND band above = ONE sand, AND the enclosed SILT lens between the two ZAND runs is present) |
| Ruling-8e Milestone 2 — the ABSENT class (engine) | STOPPED WITH GEOMETRY (2026-07-15, §8 ruling 7). 19 absent minorities remain; enumerated: Tie-9 g0 SILT R el[5.01,5.96]; Tie-10 g0 VEEN L el[5.06,8.55] + ZAND R el[5.73,6.44]; Tie-11 g0 KLEI L el[4.6,5.86]; CS3 g0 SILT L el[0.56,0.91] + KLEI R el[-1.34,0.35] + SILT R el[-2.41,-1.85]; CS3 g3 SILT L el[-2.53,-1.74]; CS1 g3 SILT L el[0.23,0.67]; CS1 g6 ZAND L el[5.19,5.79]; CS1 g7 SILT R el[9.29,9.85]; CS1 g15 SILT L el[-1.17,-0.26]; CS1 g20 ZAND R el[8.88,9.23]; CS1 g21 ZAND L el[8.88,9.23]; CS1 g22 ZAND L el[9.83,10.42]; CS2 g16 KLEI L el[10.78,11.32] + SILT R el[-3.83,-3.14]; CS2 g19 SILT L el[-1.85,-1.18]; CS2 g21 SILT L el[-3.99,-3.67]. ROOT (confirmed by the render probe): every absent minority is an ENCLOSED MINORITY (same-formation above+below on its own column, or a thin interbedded band) whose lens/onlap closing IS emitted by the interval tiler but whose face is ABSORBED by the enclosing SAME-FORMATION flood/band face — the `emitIntervalLenses`/`routeLoneStack`/same-formation-band (`emitIntervals` line ~441) closings produce `close`-id notch faces that the spanning matrix face (or its label) swallows; nested interbedding (CS3 g0: ZAND/KLEI/ZAND/SILT/ZAND) compounds it (the column-level `extractEnclosedLenses` pulls SOME lenses, the interval tiler cannot separate the rest). This is the SAME `splitAnnulus`-bypass / flood-absorbs-the-lens wall the `ROOT DEEPENED` + `Strict-2/1/0 residual` rows document: the notch face rides the column edge (holes=0) so `slice.splitAnnulus` (fires only on holes>0) never separates it. A correct fix routes enclosed-minority closings through the annulus/notch splitter even at holes=0 (or emits per-unit termination faces the flood cannot merge), and MUST regression-guard the 32 currently-OK `routeLoneStack` cases + holes 0/0/0 — a fundamental restructuring §4 already flags cannot land while holding the holes-0/0/0-per-milestone bar. A partial fix on one case would leave others gapped/regressed (ruling 7). Left for its own red→green increment; the 19-resister geometry above is the repro set. **TRIAGE CONFIRMED (2026-07-15 follow-up, per-instance render + arrangement-face probe against the conformance gate's own `renderedShape`):** the three candidate mechanisms resolve to — (a) DANGLING closing (seam-anchor class): ZERO instances; (b) LABEL swallow (a separate face traced but mislabelled): ZERO in-gap instances (the SILT lens seen at CS1 g15 is the LEFT-gap emission, apex 572.5, correctly SILT — the in-gap right emission has no separate face at all); (c) TRUE MERGED TRACE: **17 of 19** — the minority's lens/onlap closings ARE emitted into the gap at its own contacts (`close`/`flood` pairs, apex 0.45 verified in the probe) but NO own-formation face is traced there; the enclosing same-formation flood/band is ONE face that geometrically absorbs the notch region (the notch apex curves neither cross a flood curve — `intersect.ts` won't register it, 613-hole warning — nor form a separated sub-loop; the flood face `units.length===0` bypasses `splitAnnulus` at holes=0). The remaining **2 of 19** (CS1 g20/g21 ZAND, both-tied) are a `routeLoneStack`-didn't-fire NO-EMIT variant (zero termination curves; the SILT band sweeps the ZAND slot). One surgical attempt (extend `emitLoneStackBand` slab seams full-width to the facing column when the facing carries the matrix at that boundary) was built + measured: it did NOT separate the notch AND regressed 19→20 absent (new Tie-14 leak) + 8e 90→88 — REVERTED clean (engine byte-identical, full battery green). Empirically confirms the doc's standing verdict: the fix is the two-sided terminations-first / notch-splitter-at-holes=0 restructuring, not a seam tweak. Still its own red→green increment. **PARTIAL FIX LANDED (2026-07-15 — 19 → 8 absent, holes/overlaps 0/0/0, all gates green).** ARRANGEMENT-INTERNALS TRACE of CS1 g15 SILT (the owner's s10 spot) found the exact death point: the enclosed-minority notch closings (`close61`/`close62` right-gap, `close58`/`close59` left-gap) ARE emitted, and the closing endpoints DO become T-junction vertices on the column vertical (the DCEL registers them — NOT a snap-dangle) — but the ZAND band-base contour (`bandc112`) SHARES the notch's TOP vertex (the SILT-top = ZAND-base contact) and, in the angular ring there, sits between `col15:u4` and `close61`, so the `next`-wiring routes the walk arriving via the SILT vertical OUT along the band contour, never forming the notch triangle's own cycle. The whole region traces as ONE weakly-simple walk; `splitAtRepeats` reconstructs the LEFT-gap notch (CCW, +area, survives) but the RIGHT-gap notch traces CW (−area, dropped as a hole-candidate, absorbed) — the winding asymmetry (LEFT +1.077, RIGHT −0.596) IS why left renders and right does not. ROOT CAUSE of the merged trace: the SILT is enclosed by ZAND above (body A) + ZAND below (body B) with DIFFERENT bodyIds, so the column-level `extractEnclosedLenses` (which would make it a proper matrix ANNULUS with the lens as a HOLE that `splitAnnulus` handles) was BLOCKED by its `above.bodyId === below.bodyId` guard, dropping the SILT to the interval-level flood where the notch merges. Empirically 14 of the 19 absent are this exact body-guard-blocked class (enclosed, sameBody=FALSE). FIX (mechanism, not symptom): (1) `sectionGeom.extractEnclosedLenses` — RELAXED the same-body guard (the two same-formation units ARE one continuous band around the minority; the merge keeps the shallower unit's identity, an accepted approximation vs. the lens ABSENT; §7 body resolution is the resolver's job, the hole geometry is the engine's and must not depend on a body split invisible to the section). (2) `slice.sliceFaces` — strip-clip the holed face + its holes to each gap FIRST, then annulus-split per-gap (a lens emitted into both gaps forms ONE diamond hole straddling the column; per-gap it becomes a clean triangle with the column vertical as one edge). (3) NEW `partitionFillV2/sliceAnnulus.ts` (extracted from slice.ts, debt #201) — `subtractHole` rewritten: cuts CONFINED to the hole's elevation band (matrix top/base contours stay single straight edges aligned with the neighbour, killing the ZAND×ZAND snap-slivers), and the middle-slab wedges follow the hole's ACTUAL sloped UPPER/LOWER envelope chains (`holeEnvelopes` + `clipAgainstChain`) — a lens hole is a TRIANGLE, so a flat-box split dropped the 44 cm matrix wedges beside it. Two crossChain bugs fixed en route: (a) on `d(mid)===0` it returned `(mid+hi)/2` not `mid` (off by half the interval → the −0.488-vs-−0.715 wedge pinch); (b) an endpoint EXACTLY on the chain seeded bisection with `dlo=0`, never saw a sign change, and drifted to the far endpoint (the SILT×ZAND lens overlap). Behavioural gate: `sliceAnnulus.test.ts` gains 3 triangular-lens-hole cases (tile-exactly, simple-rings, no-lens-overlap). REMAINING 8 (own red→green increment, ruling 7): the 2 no-emit CS1 g20/g21 ZAND (routeLoneStack skips them because the enclosing SILT's BELOW unit is EDGED — merging would drop its base-tie layerId; both enclosing SILT are tied, so neither can be spliced) + 3 enclosed-but-lens-EDGED (CS1 g3 SILT, g22 ZAND, CS2 g21 SILT — the minority is tied in the ADJACENT gap, so `edgedLayerIds` excludes it from the per-column extraction, but it must still terminate in THIS gap → needs per-gap-aware extraction) + 3 boundary/mixed (Tie-10 ZAND, CS1 g5 ZAND, CS1 g7 SILT — enclosed by DIFFERENT formations above/below, not a same-formation lens). All three residual sub-classes need the interval-level restructuring (per-gap or two-sided termination emission), not the column-level annulus path this increment fixed |
| Completeness increment Case 1 — ruling-8d deep-facing rows | STOPPED WITH GEOMETRY (2026-07-15, §8 ruling 7 "partial-that-holds"). The prompt framed CS1 g8×2 + g19 KLEI as clean facing-first-unit MISMATCHED bands (midpoint quads). Three empirical probes proved they are NOT: CS1 g8's LEFT column GEO-10/170-S8 has only TWO units (ZAND 11.27→9.85, SILT 9.85→9.29; TD 9.29 mTAW) while the RIGHT column GEO-23/125-S10 is deep — so R's shallow KLEI u0 (11.26→9.87) fills SIDEWAYS into L's shallow-TD region via the lone-side / enclosed-lens routing (the L ZAND u0 dissolves to a lone 0.45 lens spanning 9.85→11.27, R's KLEI/SILT flood full-width). It is a shallow-column sideways-fill entangled with the §8-Q3 sub-TD substrate, not a `[topBand, tie]` facing pair. A clean-facing-pair detector (`mismatchedFirstBand.ts` + top-band-as-implicit-anchor in `emitIntervals`) was built and verified SAFE (holes 0/0/0, CS1 7/7, tsc clean) but fired on ZERO real intervals, so it was REVERTED (engine kept clean, no god-component growth). CS1 g19 ZAND = same-formation first units, ALREADY a legitimate band (renders full-width `el[10.65..11.43]`, now counts 2-corr via Case 0 — no emission change needed, confirmed). g7 KLEI retag deferred: its sibling surface rows (g8/g19 KLEI) are NOT resolved, so the design-doc condition for retag is NOT met. FIX PATH for a future session: intercept the mismatched pair BEFORE the lone-side/enclosed-lens routing dissolves the shallow first unit — but that restructures the shallow-column interval handling (loneSidePinch/lens battery regression risk), needs its own red→green increment |

FINAL SHAPES increment (2026-07-15, the 19-residual completion attempt):

| v1 rule / pass | v2 disposition |
|---|---|
| FINAL SHAPES — close the last 19 conformance violations (5 `0corr-not-lens` + 14 `1corr-not-onlap` + 0 `2corr-not-band`) + the 8b lens-reach cap | STOPPED WITH GEOMETRY (2026-07-15, §8 ruling 7). Deep re-diagnosis of ALL 8 remaining absent/mixed sub-classes (the 19 = 8 absent-family after the 8e rescope; the rest are the ruling-8 untied-pair residual the gate keeps flagging by design) confirmed EVERY one routes through the interval-level per-gap / two-sided termination restructuring §4 already flags as its own red→green increment. Exact geometry (from a per-gap arrangement + region probe, ``diag_probe.json``): **(a) no-emit pair** CS1 g20/g21 ZAND el[8.88,9.23] — a ZAND minority in the 5-unit interbedded SILT/ZAND stack `SILT,ZAND,SILT,ZAND,SILT` on BOTH columns; `sectionGeom.extractEnclosedLenses` skips it because its enclosing SILT-below (`63eb72`) is EDGED (base-tie), and the section-wide `edgedLayerIds` set cannot tell "edged in the ADJACENT gap" from "edged here" — a per-column pre-pass on a per-gap distinction; the SILT band sweeps the ZAND slot (absent). **(b) lens-edged trio** CS1 g3 SILT el[0.232,0.665] / CS1 g22 ZAND el[9.83,10.42] / CS2 g21 SILT el[-3.99,-3.67] — the minority is TIED IN THE ADJACENT gap, so the same section-wide `edgedLayerIds` excludes it from the column-level extraction, yet per the per-side rule it must terminate as a 0.45 lens in THIS gap; relaxing the column-wide guard would drop the adjacent-gap band's tie layerId (the Cross-section-3 regress the guard was added to prevent). **(c) boundary/mixed trio** Tie-10 ZAND el[5.73,6.44] / CS1 g5 ZAND el[5.73,6.44] / CS1 g7 SILT el[9.29,9.85] — enclosed by DIFFERENT formations above/below (not a same-formation lens), each needs its 8b lens/onlap emission via a two-sided `chooseOnlapEnclosing` close; g7 SILT faces a 2-unit shallow column (ZAND 11.27→9.85, SILT 9.85→9.29) so it entangles with the §8-Q3 sub-TD substrate. **(d) untied same-formation pairs** (the remaining `1corr`/`0corr` full-widths — Tie-9/10/12 VEEN/SILT/ZAND, CS1 g18/g19/g22, CS2 g13) are the ruling-8 retired-auto-match residual: the gate flags them correctly (opposing 8b-capped lenses until the owner ties them), NOT engine defects. **8b REACH CAP — RESISTER:** the cap helper (`lensReachCap` = `max(0.08, min(0.45, 2·thicknessM/gapWidthM))`, thickness→gap-fraction via real alongM; the conversion documented) was built + applied to the `emitLonePinch` `isLens` apex. Measured: the two advisory `0corr-reach-exceeds-cap` rows did NOT flip (they render at the 0.5 INTERIOR fraction via a NON-`isLens` lone-side path — an engine/gate routing disagreement, not a lens-branch apex), and shrinking the `isLens` apexes REGRESSED the counter (`1corr-not-onlap` 14→16, `8e-enclosure` 52→50: a nearer apex re-traced two conformant faces to full-width). REVERTED clean (engine byte-identical, holes 0/0/0, CS1 7/7, all 31 shape gates, conformance back to 5/14/0=19, tsc clean, v1 90/90). The 8b cap cannot land as an advisory-only flip without either (i) restructuring the lone-side onlap/lens routing so a 0-corr unit takes the `isLens` path (then cap it), or (ii) perturbing conformant faces — both the two-sided restructuring. FIX PATH (all 8 + the cap, ONE increment): drive `tileInterval`/the lone-side router from `effectiveCorrForSide` PER GAP PER SIDE — extract enclosed minorities at the INTERVAL level (per-gap `edgedLayerIds`, not the column pre-pass), emit each unit's own termination (0→8b-capped lens; 1→onlap; 2→band) BEFORE flooding, then re-close the residue — regression-guarding the 32 currently-OK `routeLoneStack` cases + holes 0/0/0. Baseline for that increment: **0corr-not-lens 5, 1corr-not-onlap 14, 2corr-not-band 0 (19 total); 8e-enclosure 52; q3-legit 5; reach-cap advisory 2**; parity grand Δ −0.0% (worst section residual −0.047, within the <0.05 gate; the v1Only=39 double-paint / v2 vacancy-hole classes are the documented ruling-8 auto-match divergence, not regressions) |

Anything discovered in v1 during the build that is NOT in this table gets
ADDED to this table with a disposition — nothing is dropped silently.

## 5. Output contract (unchanged — consumers untouched)

`computeSectionFill(columns, edges, lensApexOverrides?, alongM?) →
SectionRegion[]` with `{formationId, bodyId, kind: 'quad'|'pinch'|'lens',
polygon: {fraction, elevation}[], gapIndex}`. v2 faces span multiple gaps →
**slice each face at the column verticals** and emit one per-gap polygon per
slice, `kind` mapped from the face classification (BAND→quad, one-sided
closure→pinch, LENS→lens). Consumers that must not change:
`PartitionFillOverlay`, `refineLithoPartition` (geotech), the voxel builder,
`buildSectionModelFill`, fence/`buildProjectFence`.

## 6. Migration — COMPLETE, v1 archived (2026-08-31)

The parallel build ran its course: v2 became the measured default on
2026-08-01 (drilled gate identical at 54 exact / 0 wrong; p90 contact error
0.125 → 0.123 m; worst 5.335 → 3.145 m), the owner declared it the main
engine on 2026-08-27, and on 2026-08-31 he archived v1 outright — see
docs/debt.md #280. There is no engine choice left: the Settings toggle, the
``STRIX_PARTITION_V2`` env override, the v1 fallback arms, v1's own test
suites and the A/B parity tooling are all deleted. The shared vocabulary
(types, matcher, the surviving column-reduction helpers, ``SectionRegion``,
``regionArea``) lives in ``utils/sectionPartition/``; the entry points in
``partitionEngineSelect`` keep their names and wrap v2 with its sweep-flag
wiring.

## 7. Out of scope for v2

Body semantics (bodies stay resolver connected-components over approved
edges — Track 2 handles same-litho enclosed-lens merging), geotech
refinement internals, render warp/spacing (consumer-side), 3D voxel builder
internals, sedimentological feature-shapes (Phase 5).

## 8. Owner decisions (recorded 2026-07-13, reviewed one-by-one with visuals)

1. **Closing-curve defaults — KEEP for parity.** v2 uses v1's apex fractions
   verbatim (`LENS_PINCH_FRACTION` 0.45 / `INTERIOR_PINCH_FRACTION` 0.5) so
   the A/B diff compares like-for-like. Any retune is a post-cutover
   follow-up with its own dogfeed.
2. **Onlap-on-bracket verification — CARVE tests + dogfeed.** No extra
   dedicated seam gate before dogfeed: run CARVE1-5 against v2 plus the
   0-overlap invariant gate on all 14 sections; owner visually confirms the
   seam-riding spots on the real model during dogfeed week.
3. **Sub-TD strip with no bridge — STAYS EMPTY (match v1),** with the
   owner's explicit qualifier: **a tie that reaches the shallow test's TD
   counts as an anchor** — the band follows that tie line and colours below
   the TD (v1's `facingBandTd`/`reanchorBandToFacing` behaviour, kept as a
   curve rule; see the §4 row). White is only correct where genuinely
   nothing anchors the fill.
4. **Crossing approved ties — HARD CONFLICT, neither bands.** Both ties are
   suspended for banding (units fall back to pinch/lens) and the user gets a
   visual warning in the section until the conflict is resolved by deleting
   one tie. No silent winner (the "newest wins" proposal was rejected).
   Detection reuses the existing crossings endpoint; the warning surface is
   part of the cutover scope.

Status of the dogfeed-round-1 work (increment 10, 2026-07-14 afternoon):
ruling 5 SHIPPED (`9c017b3d5` — first unit's column vertical extends to
surface; parity grew to +3.6%, entirely the intentional ruling-5 strips).
Ruling 6 verified ALREADY SATISFIED by the increment-6/9 substrate (B2
measured: sand fills base −4.45 down to the clay-top tie −7.55, clay only
below). The five boundary-minority repros stay OPEN — increment 11 (the mandated
contact-extension mechanism) hit the TRUE wall and reverted clean. Refined
diagnosis: the repro class is a LONE MULTI-UNIT INTERBEDDED STACK against a
zero-thickness facing bracket (S7 gap18: `[KLEI,SILT,KLEI,VEEN,SILT]`
rejected by `routeLoneSidePinch`'s single-matrix guard). v1 renders it as
own-elevation lenses OVERLAID on the facing bands — but a true partition
cannot overlay: the facing band behind an own-elevation lens must become a
matrix ANNULUS with the lens as a hole. That is exactly the disabled
`ENABLE_ENCLOSED_LENS` path (this table, increment-3 row). A shared-apex
multi-unit wedge instead self-inverts (+19 overlap pairs measured).
**Dependency chain, now load-bearing: (1) increment 12 = make the
enclosed-lens-as-hole annulus correct on its pure synthetic case AND
slice annulus faces into per-gap SIMPLE polygons (the keyhole approach was
removed in increment 6 for producing self-touching rings — the slicer must
split the annulus at the lens's fraction extents, v1-carve style);
(2) increment 13 = the lone multi-unit stack fills as own-elevation lenses
holing into the facing matrix.**

Increment-13 status (2026-07-14 afternoon): the LONE MULTI-UNIT STACK class
is IMPLEMENTED (`edc74fe55`, `emitLoneStack.ts`) — a lone stack reduces to
the enclosing matrix (facing lithology at the facing-convergence point,
v1's `belowLith ?? aboveLith`) flooded as a wedge, each minority an
own-elevation 0.45 lens clamped inside the wedge (shared-apex banned —
increment-11 self-inverts). S7 gap18 measured at v1 parity. Cosmetic:
S7's matrix wedge reads kind='pinch' vs v1 'quad' (both non-lens; voxel/
geotech filter on kind!=='lens' so coverage unaffected).

Increment-14 verdict (2026-07-14, nothing shipped — §8 ruling 7 held):
**S6 gap19 SETTLED — increment 9 was correct** (v1 = right lenses
f[0.55..1.00], apex 0.55; increment-13's "@1.00" was a mis-measurement),
so S6 IS a v2 defect. The four remaining repros unified into ONE class:

| v1 rule / pass | v2 disposition |
|---|---|
| Boundary minority riding an interval bracket in a lone stack (S6 gap19 KLEI, S8 gap14 SILT, B4\|S13 gap3 ZAND, B6 gap2 KLEI) | BLOCKED (increment 14) — v1 renders a pinch/lens (0.45 lens / 0.5 onlap tip) over a FULL-WIDTH matrix band; v2's converging flood-wedge (`emitLoneStackWedge`) cannot hold the apex (measured: the apex sits above the wedge's sloping edge → the lens merges into the matrix, mislabel + self-intersecting ring; or the ruling-5 surface-strip fill-check bails to full-width). Interior minorities are correct (S7 parity holds). LARGELY UNBLOCKED (increment 16, mechanism (b), `2e5e0c74b`): the increment-15 comb diagnosis was incomplete — the true root defect was the WEDGE itself (facing bracket collapsed to a point, interleaving notches with `conv`). The facing column carries the matrix CONTINUOUSLY across the lone span (`facingMatrixRunSpan`), so the matrix bands FULL-WIDTH and the notched comb traces SIMPLE; the left strip is sliced by horizontal seams at each minority top/base (loneX → notch-apex line only — full-width seams cross the converging brackets); all stack minorities share one apex fraction. Every minority now PINCHES (was full-width); f≈1.0 slivers swept (`MIN_FRACTION_WIDTH`, `79b2c7a14`); parity kindChanges 93→58, v2Only 62→19. Increment-17 dispositions (`3270942ba`..`29f78cc68`): (i) adjacent-minority mislabel FIXED — `faces.walkLoops` sub-loops split from a figure-8 walk inherited the parent's curve-id UNION; each sub-loop now carries only its own edges' ids, so the notch reads its own lithology (S6 KLEI + S8 SILT correct at f[0.55..1.00]). Side-effect fixed: `resolveLabel` broke count-ties ALPHABETICALLY (flipped a thin-ZAND/thick-SILT face at CS1 gap21) — now length-weighted by column-edge overlap with the face extent. (ii) the clean base-tied onlap route FIXED (`forceKind='onlap'` at 0.5 via threaded tie state, after the `facingCoversSpan` guard). S7 apexes RESTORED to v1 per-unit 0.45/0.38. RESOLVED (increment 18, `15179b648`, `emitSurfaceOnlap.ts`): B4|S13 gap3 + B6 gap2 onlap surface-anchored — `surfaceExtendedUnit` gives the ruling-5 first unit an effective top on the surface band (fill-check passes; the facing matrix sample is clamped to the facing column's own surface). The onlap uses v1's RISING apex `(own drilled top + conv)/2` — a base-interface apex lands on a dipping band and collapses the pinch full-width (the B6 symptom); the rising apex traces strictly simple. An `onlap`-id base edge (counted as a tie, no label) classifies the face ONLAP→pinch. Convergence gate keeps S7's real-thickness-facing SILT on its existing route. Tips at f=0.5, tops on the surface band, ruling-5 strip fully covered; the five earlier locations re-measured UNCHANGED. loneSidePinch gate at 12 cases. **Dogfeed round 1 is fully closed at the engine level.** |

Rulings from dogfeed round 1 (2026-07-14, owner on CS1):

5. **Top band — REVISED 2026-07-14 evening (owner rejected the surface
   extension on round-2 dogfeed: "that quad is made up").** The implicit
   top correlation band follows each test's FIRST LITHO BOUNDARY, snapped
   to the first DATA point when within 10 cm; where they diverge, fall
   back to the first data point (and only where a litho exists at all).
   NEVER the ground surface unless first data starts there. The strip
   between that line and the ground stays EMPTY — no invented lithology
   above the first data point. (The original "extend first unit to
   surface" implementation `9c017b3d5` is REVERTED by this ruling; the
   band-authority top polyline mechanism stays, re-anchored to the
   first-litho/data line.)
6. **Sub-TD fill follows the lowest tie lines (B2 finding — owner
   overruled "v1 does it too, so not a bug": "it is wrong" in both).**
   Under a column with no bottom tie to its TD, the substrate fill must
   respect the LOWEST tie: at 23/126-B2 the lowest tie is clay-below /
   sand-above, so the wedge under B2's sand down to that clay-top tie
   line is SAND — clay may not rise above its tie line under the column.
   General rule: a substrate formation is bounded above by its own tie
   line traced across the gap, not by the shallow column's unit base.
   Fix lands in v2 only (v1 stays the frozen fallback).
7. **Process standard (owner):** no partial fixes and no gaps — a
   termination-shape class is either at v1 parity (or better, per these
   rulings) or the increment is not done.
8a. **Shared-contact onlap closes by composition — NO mixed-bracket rule
   exists (owner, 2026-07-15, on the real S5A|S5 render).** A minority
   whose base (or top) rides a TIED shared contact is 1-corr → ONLAP
   riding that tie, tip at 0.5. The space beyond the tip is NOT a
   vacancy needing a fill rule: the adjacent unit's face closes around
   the onlap by boundary composition (owner's own trace: sand tie from
   the right test → up the clay onlap → silt top → back — a closed silt
   face with the onlap as a notch). The "mixed-bracket-awaiting-ruling"
   class is DISSOLVED — those instances take the same onlap emission as
   the one-band class. 14 of the 15 zerocorr violations = ONE mechanism
   (onlap riding the tied shared contact, unified across the four
   emission paths); the 15th is a genuine §8-Q3 surface-void (correct
   as-is, retag in the audit).
8f. **The owner's algorithm statement (2026-07-15 late, while reading
   `effectiveCorr.ts` — the canonical formulation of 8c, verbatim):**
   "First find lenses per column by looking if a contact has a
   correlation on one side: if it has no correlation on the left side,
   emit lens left; if it has 1 correlation on left side, emit onlap left
   (same for the right). That way you'll have all lenses and onlaps
   FIRST; if the model is correlated correctly you can just fill in the
   void with the dominant lithology between correlations." Notes: the
   'has a correlation' predicate = `effectiveCorr` (direct + shared-
   contact derived + band membership + top band — each owner-ruled);
   'dominant lithology fill' = boundary composition (the void's claimant
   is the unit whose contacts bound it), with the validated midpoint
   seam as the mismatched tiebreak. This is the target shape of
   `tileGap.ts` in the rewrite: simple loop, rich predicate, no routing
   fall-throughs — a unit cannot be missed if its termination is emitted
   before any filling happens.
8g. **The boundary-walk elaboration of 8f + same-litho closure (owner,
   2026-07-16 morning, ruled on the Tie-10 g0 S22↔S12 visual — verbatim):**
   "First draw imaginary correlation bands for 0 correlations (halfway
   lenses on one or both sides of the test). Then draw the onlaps as
   imaginary correlation bands. Then fill all closed shapes. If a shape is
   not closed then look at the open ends on both sides, they have to be
   the same litho. If you have a sand on the left, a silt lens and then
   again a sand, you can just follow the correlation band: go down from
   the sand top correlation, you meet the silt — this is a closed shape so
   you can just follow it to the right to the lens apex, follow it back;
   if beneath that silt is another sand, just follow it down to the base
   correlation tie and then to the right!" Consequences, owner-ruled:
   (a) an enclosed lens/onlap is a DETOUR in the enclosing band's contour,
   never a wall — the enclosing formation flows around it and reconnects;
   (b) **base-tied same-formation pairs are ONE BAND** (the Tie-10 g0
   ZANDs: with or without the extra sand-top tie the sands connect —
   "the visual indicates that it doesn't matter"), so the conformance
   gate's expected shape for a 1-corr unit whose single (derived) tie
   faces a same-formation unit is band, not onlap; (c) emission order is
   normative: 0-corr lenses first, onlaps second, closed-shape fill last.
   This ruling is the SPEC for the session-7 flip (terminations-first
   becomes the only path; the seam-based interval tiler and its bail
   taxonomy are deleted).
8d-rev. **The top band counts as ONE correlation (owner, 2026-07-16
   evening, dogfeeding the CS1 walkthrough — "top band counts as one
   correlation, this keeps it consistent").** Supersedes 8d's "top band
   only = 0-corr/Q3 void": a FIRST unit whose only tie is the top band is
   1-corr and ONLAPS riding the surface (the `emitSurfaceOnlap` geometry —
   top rides the top band, base closes to it at the apex fraction). Top
   band + real/derived base tie stays 2-corr band (unchanged). In
   `effectiveCorr`, `topBandTies` feeds `topTied`/`hasAnchor` instead of
   only the `firstUnitTopBandBand` 2-corr case. Model-wide effect: every
   untied first unit flips lens → surface-riding onlap.
8u. **MIXED TIES SAMPLE THE FAR COLUMN'S SAME-SIDE UNIT — 8m
   confirmed on the base↔top shape (owner, 2026-07-20, ruled on the
   mixed-tie visual, verbatim): "just follow the rule man, the clay
   has one correlation to the right, follow the tie, oh hey there is
   a clay there, nothing is drawn".** For a tie connecting a unit's
   BASE to a far unit's TOP (or vice versa), the 8m same-litho check
   follows the tie to the far column and reads the unit sitting on
   the SAME side of that shared contact as the tied unit (the clay
   above S6's sand top, not the sand below it). Same litho → the tie
   is the boundary, no onlap line, fill flows, 8j merges. The
   followTieOnlap/oneCorrActualTie locked tests encode this
   correctly; the S58 far-side experiment (`tieRefFarSide`) stays
   dormant/dead. The onlap-flank diamond-detour built alongside it
   remains live machinery (8t: flanks detour around lens diamonds).
8t. **COLLISION HALVES THE LENS — THE THICKNESS HUG IS RETIRED (owner,
   2026-07-20, paint-round on 23/125-S7's peat vs tie83, verbatim):
   "retire the thickness hug, just halve the length to 0.225".** When
   a corr-0 lens's wedge is crossed by REAL correlation art (drawn
   tie / 8a shared-contact line / bridge), the reach HALVES: 0.45 →
   0.225 of the gap, halving again while still blocked (0.1125, ...,
   down to the snap floor). The ~2×thickness rung is DELETED
   everywhere — no reach is ever derived from unit thickness. The
   collision SET stays literal art only (8s: derived contours never
   cap; they detour). Onlap flanks crossing a lens diamond do not
   shorten the lens either — the flank detours around the diamond
   (the S51 mechanism). Supersedes the 8b-rev ladder's thickness rung.
8s. **MIXED-ENCLOSURE LENS KEEPS 0.45 — THE MATRIX DETOURS; an overlap
   is a region-construction defect, never a reason to cap (owner,
   2026-07-19, S46 ask-first on the real CS1 gap5 exemplar — S7's sand
   [5.79..5.19] between silts opening 43 m toward S12): ruled "0.45
   stands, matrix detours".** A corr-0 lens whose 0.45 wedge crosses
   NO correlation line art keeps the FULL 0.45 reach even when its
   enclosing hosts are two different lithologies and the wedge opens
   into space filled by the surrounding regions — the surrounding
   litho flows AROUND the wedge (the 8g detour); the wedge lines split
   the surrounding region, so fill-between-the-lines makes overlap
   impossible BY CONSTRUCTION. Consequences: (1) the facing-sample
   caps are DELETED (`enclosedLensReach` facingDiffers,
   `drawTermination` facingCompetes) — the ONLY reach shortener is a
   genuine wedge-vs-correlation-art collision (drawn ties + bridges +
   band contours; never scaffolds, never litho sampling), which drops
   to the 8b-rev thickness rung; (2) the 3 measured cm-slivers this
   exposes (CS1 gap5 ZAND×SILT 14.7 cm; CS2 gap13 KLEI×ZAND 24.3 cm +
   ZAND×KLEI 2.8 cm) are identity-pinned ENGINE DEFECTS — the
   enclosing region's contour must clip around the lens wedge
   (lensEnclosure contour clip); until that lands they ride an
   explicit ratchet, they do not justify re-capping the lens.
8r. **LINES BEFORE THE MERGE — termination line art is emitted on the
   RAW PICKED UNITS, never on merged hosts (owner, 2026-07-19, paint-
   tool dogfeed on 23/125-S7's middle clay, verbatim): "the middle
   clay should lens, i want the lines before the merge. (first fill
   then merge remember)".** The enclosed-lens pre-merge
   (extractEnclosedLenses collapsing same-formation sandwiches BEFORE
   emission) violates the pipeline order: every picked unit — however
   thin, however enclosed — gets its own 2/1/0 termination lines;
   the fill paints; THEN the 8j merge welds touching same-litho
   regions. The col18 middle-clay host-split (`literalCorr` (c)/(d))
   is therefore NOT a separately-pinned limitation — it is mandated
   Step-4 linework repair under SEED_FILL_MANDATE.
8q. **THE FILL IS A SEEDED PAINT BUCKET — no label rule exists (owner,
   2026-07-19, rejecting the (a)/(b) continuation-rule preview,
   verbatim): "my rules are perfect, lens lines first left and right,
   onlap lines second left and right, then you have a connected set of
   lines and you don't have any gaps, you just need to fill like the
   fill tool in paint?"** Operationally: after the termination sweep
   the line set (columns, contacts, ties, lens flanks, onlap flanks,
   surface, TD floor) is CONNECTED and closes every region. Each face
   is painted by the flood from the PICKED UNIT COLUMN FACE(S) on its
   boundary — the litho comes from the seed, never from a rule: the
   646.74 KLEI wrap = the KLEI column segments' own flood spreading
   around the closed lens wedges; B3's wedge = col13's silt face flood
   spreading past the closed clay lens; the sand under B2 = the
   neighbours' sand segments flooding under the TD (no column line
   exists below a TD, so the face connects straight to them). A face
   whose boundary carries ZERO unit-column segments, or segments of
   TWO different lithologies, is not a labelling question — it is a
   LINE-ART DEFECT (a missing or unclosed line) to be fixed in the
   geometry. Supersedes the S30/S31 label lookups AND the orchestrator's
   interim (a)/(b) continuation rule (never built).
8p. **THE COMPLETE DOCTRINE — lithos, ties, no-ties, fill between the
   lines; NEVER extrapolate (owner, 2026-07-19, confirming the B3
   one-silt-body and B2 one-sand-body interpretation renders
   letter-for-letter, verbatim): "thats it, only litho's ties no ties
   and filling between lines, no extrapolating downward, upward
   leftward or rightward follow the lines".** The engine's ONLY
   inputs: picked lithos (columns are ground truth, 8k), drawn ties,
   and the ABSENCE of ties (literal 2/1/0 → terminations); its only
   operation: fill between the lines (8n face-fill + 8o
   unterminated-litho hole-fill + 8j merge). No construction may
   extrapolate in ANY direction — no downward column extension, no
   matrix search, no facing sample, no formation-overlap authority.
   Confirmed instance (the B2 sub-TD case): below B2's TD the hole is
   bounded below by the deep clay-top jump tie (S8 −7.64 → S6 −5.87)
   and above by B2's TD + the sand-top tie line (S8 3.20 → S10 4.09 →
   B2 4.25 → S7-TD 4.23 → S6 7.03); SAND is the only unterminated
   lithology in it → the hole fills sand and merges with B2's own
   sand into ONE body — produced entirely by the tie geometry, "not a
   fill down". Confirmed instance (the B3 case): the one-silt-body of
   ruling 8o's example, terminations closing the clay lens and sand
   onlaps inside it.
8o. **HOLES FILL WITH THE UNTERMINATED LITHOLOGY — no matrix lookup,
   no facing sample (owner, 2026-07-19, answering the mixed-enclosure
   question on B3's 2nd silt, verbatim): "the sand below the second
   silt on b3 onlaps left and right. the top clay on b3 just lens
   right. then just fills shapes? which means you get one silt body
   going from top silt of s9 to second silt on b3 terminating as a
   lens. you have the same pattern for the clay above? you then fill
   the hole between B3 and S9 with silt ofcourses because that is the
   only unterminated lithology and then merge the touching silt
   bodies?"** Operationally: (1) the sweep emits EVERY termination per
   literal 2/1/0 — those close shapes; (2) each remaining hole is
   filled by THE ONLY lithology left UNTERMINATED on its boundary (the
   unit whose flow no lens/onlap closed — a corr-2 band flows, a
   facing unit whose termination apexes short of the hole flows into
   it); (3) the 8j merge welds touching same-litho regions into one
   body (two facing corr-0 lenses + the hole-fill between them = ONE
   body with lens-shaped ends, the lens analogue of 8l's emergent
   band). RETIRES the lens flood-wedge label lookups entirely (the
   s30 flooded-contact sample and the s31 lensEnclosingMatrix walk are
   superseded by hole-fill at the face level; the 8-of-436
   mixed-enclosure question DISSOLVES — no matrix concept exists). If
   a hole's boundary ever carries ZERO or MORE THAN ONE unterminated
   lithology, that is undecided — ask the owner, never pick.
8b-rev. **LENS REACH IS 0.45 — the thickness cap applies ONLY on
   collision (owner, 2026-07-19, app dogfeed round 1: "lenses should
   fill to 0.45 dist … we only need to shorten lenses that collide with
   a sloping correlation no?" and, confirming: "do the 0.45 lens rule
   (the thickness rule was only in case of collision with a correlation
   band)").** Supersedes 8b's universal min(0.45×gap, ~2×thickness):
   the default lens reach is 0.45 of the gap, for every lens. A lens is
   shortened ONLY when its flank/wedge would collide with tie/band line
   art: first to the ~2×thickness reach (the thickness rule's real
   home), then halving further if still colliding (8b's original
   conflict mechanic). One PLANNED apex per termination — the flank
   line and the fill wedge consume the same value. Note of record: the
   old tie-conflict halver (fitLensReach) was only wired into the
   legacy tiler, so the collision shortener must be (re)built into the
   live flag-ON path as the sole reach override.
8n. **THE FILL IS THE FACE-FILL OF THE LINE ART — paint the polygons the
   lines already bound (owner, 2026-07-18, dogfeeding the first painted
   fill render: "You litterally have every line and point correct now.
   You just need to take all the points which make up the polygon and
   fill the area inside that polygon?").** The line structure (columns,
   contacts, drawn/derived/bridge ties, lens flanks, onlap flanks,
   surface, TD floor) is CORRECT and COMPLETE; every fill defect in the
   dogfeed round was the fill NOT following those lines — regions
   spilling past an onlap flank, wedges absorbed into the neighbour,
   interval brackets diverging from the drawn geometry. The fill must be
   the pure paint-bucket of the arrangement faces: every closed polygon
   bounded by the emitted line art is one region, its label the unit
   whose line art bounds it (an onlap/lens wedge carries the TERMINATING
   unit's litho up to its apex, and NOT ONE POINT PAST IT — "the second
   silt from the top has an onlap which is correct but it fills all the
   way to the test to the right (if the user wants this then he has to
   draw a correlation from the top of that silt to the bottom of the
   clay on the next test)"). Sub-TD fill at a column (the 456.07 case,
   owner verbatim): "take the intersect of the correlation band and the
   column and extrapolate that point to the left of the column and the
   right of the column. that way you have 2 points one on each side
   through which you can connect and fill above and below." No interval
   reconstruction may override a face the line art already closes.
8n(b). **A LENS PINCHES INSIDE ITS ENCLOSING MATRIX — the wrap past the
   apex is the OWN-column matrix, never the far facing column (owner,
   2026-07-18, on the col18 thin-lens stack at x=646.74 — verbatim, asked
   whether the sand filling past col18's SILT/VEEN lens apexes where the
   facing col19 has its big ZAND was correct facing-fill): "oh no that is
   wrong, it should be silt and veen in the lens and there is no sand
   adjacency."** A corr-0 LENS (both sides flood, `skipSide===null`) is a
   DETOUR in its enclosing formation's contour (ruling 8g — the matrix
   flows around the pinch and reconnects, its two open ends the SAME
   litho). The lens interior carries the lens's OWN litho to its apex; the
   space PAST the apex belongs to that ENCLOSING MATRIX, read from the
   lens's OWN column — NEVER `facingMatrixLabel(facing, midElev)`, which
   at col18 sampled col19's ZAND [-5.87..7.027] 78 m away and painted a
   phantom "sand lens" past the thin SILT [6.03..5.46] / VEEN [5.46..5.05]
   apexes (they wrap in the KLEI above [6.65..6.03] and below [5.05..4.23]).
   THE WALK: a minority STACK (SILT over VEEN, both corr-0) pinches as ONE
   stack — each lens's interior is its own litho, the wrap is the shared
   enclosing matrix, so the matrix lookup walks PAST adjacent minorities
   (the sibling lens) to the formation that appears NEAREST on BOTH the
   up-walk and the down-walk (`lensEnclosingMatrix`). When the up-walk and
   down-walk share NO formation (no common enclosure — the 8g "same litho
   on both open ends" invariant fails) that is a GENUINE RULE GAP →
   ASK-FIRST, do NOT invent a preference (the engine keeps the s30 facing
   fallback for that instance and the case is surfaced to the owner). This
   is 8n's "NOT ONE POINT PAST the apex" applied to the LENS wrap: the
   fill past a lens apex is the enclosing matrix (own column), exactly as
   the fill past an ONLAP apex is the facing unit onlapped into (s30). The
   ONLAP path is unchanged. Implemented `emitFloodWedge` (label-only,
   flag-ON) + `lensEnclosure.ts`; gate `faceLabel8n` gap18 cases (a)(b)(c),
   RED-first proven. See REWRITE_STATE §36.
8m. **THE 8i SAME-LITHO ONLAP SUPPRESSION IS RESTORED, in its correct
   follow-the-tie form (owner, 2026-07-17, dogfeeding the x=23.45 5th
   silt: "restore it — just add a lithology check before drawing").**
   Before drawing a corr-1 onlap flank: FOLLOW the actual tie to the
   MATCHED facing contact (below-for-top-tie / above-for-bottom-tie),
   compare litho — SAME → skip the flank (the tie is the boundary, the
   fill flows, the 8j merge welds; the flank would be an interior seam of
   the identical final body); DIFFERENT → draw the onlap. History: 8i
   dictated this; the original implementation fired on a run-existence
   heuristic instead of following the tie (the absent-unit bugs), so 8j
   deleted suppression wholesale (always-draw + merge-after). Both forms
   produce IDENTICAL final bodies — restoring the literal check trades
   redundant interior seams and merge work for one rule-derived litho
   comparison. Scope: corr-1 onlaps ONLY; lenses stay untouchable
   (8i(e)); different-litho onlaps always draw.
8l. **CORR IS THE LITERAL COUNT — the matched-pair band promotion is
   DELETED (owner, 2026-07-17, on the 646.74 three-clay column: "the top
   clay has a top tie, the middle clay has no ties and the bottom clay
   has a bottom tie. That makes the top a 1corr litho, the middle a 0
   corr litho and the bottom a 1 corr litho again!").** A side's corr =
   the number of that unit's contacts effectively tied on that side —
   literally. ONE tie = ONLAP, even between same-formation units (the
   old ruling-8 matched-pair promotion, `isBandMember` corr-2 from a
   single same-side same-formation tie, is deleted). TWO tied contacts =
   band (incl. 8d-rev's top band + base tie). The BAND LOOK is an
   EMERGENT OUTCOME, not a classification: two facing same-formation
   onlaps riding the same tie meet at the 0.5 apex, the fill closes
   around them, and the 8j post-fill merge (same litho + touching) welds
   them into one body. Bands are what onlaps become after the merge.
   Consequences: (a) `effectiveCorr` simplifies to the literal count;
   (b) enclosed interbeds SPLIT their host into visible pieces for the
   sweep (8k — the three clays ARE three units), each piece counting its
   own contacts (host-contact pieces inherit that contact's ties;
   interbed-cut contacts are untied); (c) the conformance gate's
   band expectation applies only to genuinely 2-tied sides; the
   one-tie-same-formation "band" rows re-expect onlap-pre-merge.
8k. **COLUMNS ARE GROUND TRUTH — iterate columns, not gaps (owner,
   2026-07-17: "you're looking at gaps not at columns; on the columns the
   user's picked lithos are ground truth").** The termination sweep's
   primary loop is COLUMN-first: for each column, for each unit of the
   user's picked stack (including the pieces an enclosed lens visibly
   splits), ask leftSide/rightSide and draw. The gap is only the
   direction a unit looks — never the owner of the iteration, never a
   context that may reinterpret the stack (no gap-frame "runs",
   "intervals", or unit merges/splits the user didn't pick). Gap-frame
   iteration is the recorded ROOT of the double-emit (one unit visited
   via two gap contexts), the run-bails, and the mis-narrated sub-pieces.
   This restates 8h's parenthetical ("I'm thinking per column") as the
   binding architecture.
8j. **MERGE AFTER FILL (owner, 2026-07-17 — "you merge after everything
   is fucking filled!").** Supersedes 8i's pre-emptive "same litho → do
   nothing": NO termination is ever suppressed by a predicted merge. A
   corr-1 side onlaps its tie regardless of the facing litho; a corr-0
   side lenses; THEN the fill runs; THEN same-litho regions that TOUCH
   merge into one body as a POST-FILL labelling step (the Track-2
   same-formation body-merge analogue, now in the 2D engine). This
   deletes the `mergesSameFormationBand` pre-emption from the sweep — a
   sub-piece of a carved unit (e.g. the clay sliver a lens interbed
   splits off) simply lenses within the carve's shadow and reconnects to
   its encompassing body around the lens tips, automatically. The 8e/8g(b)
   rulings survive as the post-fill merge criteria (same litho + touching
   / base-tied), no longer as emission guards.
   **The staged body model (owner, 2026-07-17, clarifying):** a litho
   unit STARTS as its own body; bodies form by GEOMETRIC CONNECT at three
   scales, each after that scale's geometry exists — (1) per section:
   after the fill, all units connected through the fill bands become one
   unit/body in the DB; (2) across sections: after the tie sections, all
   bodies connected through a tie-section's fill (CS1↔TS↔CS2) become one
   body in the DB; (3) in 3D: the voxel build repeats the connect in the
   volume — a CS1 body meeting a CS2 body through the voxels is one body.
   Same connected-components operation at three scales, never pre-emptive
   — owner's ordering principle: "we're going from small to large, first
   in 2D then in 3D" (the same little-to-big direction as the 8h
   containment fill).
   NOTE: stages 2-3 imply the body resolver moves from edge-union to
   geometry-connectivity — a recorded direction for the backend resolver
   increment (interacts with the body-identity review finding), NOT part
   of the 2D sweep work.
8i. **The three-function spec (owner, 2026-07-17 night, dogfeeding the
   hoisted render — verbatim, supersedes every heuristic guard in the
   termination sweep):** "Write a function that checks if there are
   correlation bands left and if there are correlation bands on the
   right: call a function called leftside that checks the left side — if
   that has 0 bands classify as lens, if it has 1 classify as onlap, 2
   classify as band. Same one for right side. Then write a function that
   actually draws: 0 correlation bands — easy, draw the lens lines on the
   left or/and right side. If it has 1 correlation band, FOLLOW that
   band: if it is the same litho (below for a top tie, above for a bottom
   tie) do nothing; if it is a different litho make it onlap the tie."
   Consequences: (a) the 8e/8g(b) merge exemption is NOT a run-existence
   heuristic — it fires ONLY by following the unit's tie and finding the
   SAME litho on the matched side of the facing unit (below-for-top-tie /
   above-for-bottom-tie); different litho → the unit onlaps that tie,
   never absent; (b) 0-corr has NO exemptions beyond physical
   (reach-halving, sub-snap degeneration) — a 0-corr side ALWAYS draws
   its lens lines; (c) the classify and draw functions are LITERAL,
   separately-testable code (leftSide / rightSide / drawTermination) and
   the sweep may call nothing else. (d) **An onlap is ONE extra line
   (owner, 2026-07-17: "an onlap on the left just needs one extra line —
   the correlation band is already there — same for the right side"):**
   the tie is existing line art; the engine draws ONLY the closing flank
   from the unit's free contact to the apex point on the tie. A second
   flank riding the tie duplicates given line art (the recorded source of
   the onlap-rendered-as-lens confusion) and is forbidden.
   (e) **EVERYTHING MUST LENS (owner, 2026-07-17: "everything must lens,
   no narrow gap guard — make it so that all 0-corr bodies lens in first
   instance"):** every 0-corr unit-side draws its lens, no exceptions.
   The SUB_SNAP_GAP_M policy threshold is DELETED; the only permissible
   collapse is the physical snap floor (``segmentDegenerate`` at the 1 mm
   grid), each instance individually listed by the audit. The
   letter-of-the-law audit (every corr-0 unit-side has a phase-1 flank,
   MISSING = 0 per section) becomes a permanent gate. Jump-tie bridges
   feed the corr arithmetic (a drawn correlation is a correlation
   regardless of adjacency): a bridge's ANCHORED contacts are tied
   (onlap/band per the rules); pass-through columns it crosses without
   anchoring stay untied (their units lens).
   the CS1 flip walkthrough — verbatim):** "Phase 1: 0 correlations on
   left side, emit lens on left. Phase 2: 0 correlations on right side,
   emit lens to the right. Phase 3 and 4: the same but with 1
   correlations — phase 3 left, phase 4 right (I'm thinking per column
   but should work per gap too, except on the edges). Phase 5: outer left
   test of the section — make a connection between top of a litho body
   and bottom. Phase 6: outer right test of the section — do the same.
   Now you should have all closed bodies and you can start filling from
   little to big with the lithology inside the enclosed body — of course
   never overwrite a little fill with that of a body that encompasses
   it." Consequences, owner-ruled:
   (a) **Emission is PER SIDE and UNCONDITIONAL** — every 0-corr
   unit-side always gets its lens, every 1-corr unit-side always its
   onlap. This RETIRES the bail concept (converging-facing etc.): there
   is no interval-level routing decision left; closure is guaranteed by
   the phase order, not by shape classification.
   (b) **Section-edge closure (phases 5-6)**: the outermost columns'
   verticals close every body's loop at the section frame — where the
   arrangement already provides this by construction, phases 5-6 are a
   stated invariant to VERIFY, not new curves.
   (c) **Containment-ordered fill**: paint from little to big — a face
   belongs to the SMALLEST enclosing loop; an encompassing body's fill
   must never overwrite an enclosed body's face. Emit all small closures
   before any large fill so the small faces exist when the flood arrives.
   Supersedes the interval-level construction of the session-7 flip where
   they conflict; ruling 8b (lens reach cap) and 8g(b) (base-tied
   same-formation = band) unchanged.
8e. **Same-formation enclosure CONFORMS — one body by construction (owner,
   2026-07-15 afternoon, ruled on the real TS4 visual with his own traced
   loop).** A unit whose flagged extent is enclosed by its own formation's
   legitimately-tied face is NOT a violation: "it should be one sand" —
   following the lines (zand-top tie → down the right column around the
   silt lens → across the basal clay tie → up the left column → back)
   closes ONE sand face. The 117 same-formation-enclosure audit flags are
   gate FALSE POSITIVES (per-unit scoping of an invisible distinction) —
   fixed at the GATE, no engine change, pixels already correct. THE
   CONDITION (owner: "don't forget the silt lens ;)"): enclosed
   DIFFERENT-formation minorities must render as their ruling-8b lenses —
   never absorbed/absent — or the line network is incomplete and the
   body-by-construction reading breaks. The 'absent' violation class
   therefore stays REAL and is the remaining engine work.
   **STATUS (2026-07-15): Milestone 1 (gate rescope) SHIPPED; Milestone 2
   (absent class) PARTIALLY SHIPPED — 19 → 8 absent** — see the §4 "Ruling-8e
   GATE RESCOPE" + "Ruling-8e Milestone 2" rows. The Milestone-2 notch-cycle-loss
   ROOT was traced through the arrangement internals to a body-guard blocker in
   `sectionGeom.extractEnclosedLenses` (an enclosed same-formation minority whose
   two enclosing units carry DIFFERENT bodyIds fell out of the clean
   enclosed-lens ANNULUS path into the interval-level flood, where the notch
   merges into the enclosing face and the right-gap CW notch sub-loop is dropped).
   Relaxing that guard + a `slice`/`sliceAnnulus` sloped-edge rewrite (strip-clip-
   first, band-confined cuts, envelope-chain wedges, two crossChain fixes) fixed
   14 of the 19 (holes/overlaps 0/0/0, CS1 7/7, all shape gates green, v1
   untouched). REMAINING 8: 2 no-emit (routeLoneStack skips a lens whose enclosing
   unit is edged), 3 enclosed-but-lens-edged (per-column extraction excludes a
   unit tied in the adjacent gap), 3 boundary/mixed (enclosed by DIFFERENT
   formations) — all three need the interval-level per-gap/two-sided termination
   restructuring, their own red→green increment (ruling 7). The 13 full-width
   untied stay the ruling-8 residual.
8d. **Deep-facing surface case = mismatched band, midpoint quads (owner,
   2026-07-15, on the S8|S10 phone visual — supersedes the A/B tip
   question, which was a false dichotomy).** The top band (ruling
   5-revised) is an IMPLICIT TIE: a surface-topped unit whose base rides
   a real tie is therefore 2-corr → BAND between the top band and the
   base tie. When the facing formation differs (sand left, clay right),
   the existing no-auto-facies rule applies: TWO RECTANGULAR QUADS
   meeting at a straight vertical midpoint seam. No onlap tip, no
   invented sliver. General principle: the top band counts as a tie in
   the 2/1/0 arithmetic for first units — the conformance gate's
   tie-counting must include it (several "1corr" surface rows become
   2-corr mismatched bands). CS1 g8×2 + g19 KLEI resolve this way;
   g7 KLEI stays the genuine Q3 void (no facing to band to).
8c. **Terminations-first emission (owner's ordering principle, adopted
   2026-07-15 after the conformance baseline proved him right).** Every
   failure class chased since increment 8 is a MISSING TERMINATION CURVE
   (no lens/onlap line in the arrangement → nothing bounds the band →
   full-width leak; the 22 + 110 conformance violations are all this).
   The strategy for the remaining engine work is therefore NOT per-path
   bail fixes but emission completeness: for EVERY unit, per gap per
   side, emit its termination curve FIRST — 0-corr → the ruling-8b lens
   closing; 1-corr → the onlap curve riding its (derived) tie — and only
   then tile bands/floods between the lines. With the line network
   complete, faces close by composition (the owner: "you have all lines —
   correlation bands, onlap bands and lens bands — and you can just
   follow the lines to see what is one body and what is not"). The
   authority ladder (drawn ties > synthesized closings) still governs
   CONFLICTS; this principle governs COMPLETENESS.
8b. **0-corr lens reach — capped by unit size (owner, 2026-07-15).** A
   0-corr unit renders as a SMALL LENS AROUND THE UNIT (the unit never
   "terminates" away): auto lens reach = min(`LENS_PINCH_FRACTION` 0.45 ×
   gap, ~2× the unit's own thickness), so thin units get a hugging halo
   and wide gaps stop producing long tongues. HARD CONSTRAINT (owner:
   "make sure it doesn't cross correlation bands"): the lens curve is
   clipped by band-authority curves — already by construction in the
   arrangement, restated here so no emission path bypasses it. Drawn
   apex overrides keep their behaviour. Conformance-gate vocabulary:
   0 → a small lens around the unit; 1 → onlaps its tie; 2 → bands.
   **SHIPPED (`4d09864ed`, 2026-07-16):** `lensReach.ts` is the single
   source of the cap; all five 0-corr emission paths route through it
   (the `emitIntervalLenses` closing chokepoint, the lone-pinch shared
   apex, the lone-stack plan fraction after its band-clip bail, the
   override-aware enclosed-lens default). Overrides pass un-capped.
   Effect on the 14 real sections: violations 19 → 17 (1corr-not-onlap
   14 → 12, 8e-enclosure 50 → 48), holes 0/0/0, CS1 7/7. The two
   `0corr-reach-exceeds-cap` advisory rows render at 0.5 via a NON-lens
   routing path — out of 8b scope, owned by the two-sided restructuring
   (FINAL SHAPES row). Owner dogfeed pending (thin lenses now hug).
   **Conflict resolution (owner, 2026-07-16 late — "you can just shorten
   the lenses by half if there is conflict with a tie? this had been said
   many times"):** the 8b hard constraint's MECHANISM is reach-halving —
   when a lens closing would cross a tie/bracket curve, HALVE its reach
   and retry until it fits inside the wedge (floor: the snap grid; a lens
   that cannot fit even at minimal reach degenerates per the session-10
   guard). Seams never chase sloping brackets; the LENS shrinks. This is
   the owner-ruled answer to the session-10 sloping-bracket negative.
8. **STRICT 2/1/0 (owner, 2026-07-14 evening, after the model-wide shape
   audit).** Uncorrelated units TERMINATE — always. Facing same-formation
   units with no drawn tie render as opposing lenses/pinches (apex
   conventions unchanged); they band ONLY when a correlation edge is
   drawn/accepted. v1's geometric same-formation auto-matching is
   RETIRED in v2 (an intentional, owner-ruled divergence — most of the
   round-2 dogfeed list is this class, present in BOTH engines). The
   parity target for termination shapes is hereby superseded: the
   acceptance is the shape-audit instrument at strict-2/1/0 semantics
   (every 0-corr unit terminates; every band maps to a drawn tie), not
   v1 equivalence. Side effect embraced: the ~60 untied same-litho
   overlaps will show as double lenses until the owner ties them.

## 9. Build plan (subagent-driven; month shape)

* **Wk 1** — owner reviews this doc → arrangement core (curve emission,
  snap, half-edge trace) + parity harness runner; topology parity on the 14
  sections (face counts, classifications).
* **Wk 2** — closing-curve rules (pinch/apex/freedraw/substrate bridges) to
  full geometric parity; invert the pinned-bug tests; gates green.
* **Wk 3** — cutover flag + owner dogfeed (litho + geotech axes) + voxel
  fidelity on v2; fix fallout.
* **Wk 4** — buffer; v2 frozen snapshot; beta polish. Track 2 (body-level
  fixes) proceeds independently in week 1.

## 10. Safe-default repair + review flags (owner ruling 2026-07-26)

**The bug.** The 8m same-litho onlap suppression (`drawTermination`) is correct
when the facing genuinely continues the unit's litho, but combined with the
formation-global `bandFids` seam suppression (`closeInterval` — a *deep* KLEI
band puts `KLEI` in the set, so the seam that would separate a *shallow* KLEI is
skipped) it left the drilled unit unbounded → the enclosing flood painted it a
FOREIGN litho. TS7-g0's drilled clay rendered as silt (data loss, an 8k
ground-truth violation). Root-caused by instrumentation, not the onlap-vs-merge
framing.

**The fix — a post-pass, engine-default untouched.** `computeSectionFillV2`:
1. run the fill once (unchanged);
2. `detectFloodedUnits` scans for any drilled unit painted a foreign litho at its
   OWN column edge (samples the near-column band interior above the shallow TD);
3. if any, re-run with those units' onlaps FORCED ON (`forceOnlapUnits` bypasses
   the 8m skip for exactly them), accumulating over ≤3 iterations to a fixed
   point.

Clean cases flood nothing → detect nothing → never re-run → **byte-identical** to
the pre-repair engine (verified: full v2 suite unchanged, conformance 10, holes
0/0/0). Only the failing cases are repaired. This deliberately does NOT change the
merge engine's default — the reason two earlier upfront discriminators
(body-identity, `facingCoversSpan`) were rejected: both perturbed clean merges.

**Review flags (the UX call, owner "give the ux call").** The repaired units ARE
the uncorrelated same-litho neighbours worth surfacing. `computeSectionFillV2WithConflicts`
returns `reviewFlags: {layerId, gapIndex, side}[]`, surfaced through
`computeSectionFillActiveWithDiagnostics`. **SHIPPED** as `ReviewFlagLayer`
(rendered by `PartitionFillOverlay`; dismissal persisted via `reviewFlagPrefs` →
`view_state.review_flags`; positioned at the drilled unit's gap-facing column
edge via `screenByInv`, nudge-aware). Owner dogfeed pending (live marker render +
correlate/dismiss round-trip can only be verified in the running app). The surface is:
* **Advisory, not an error** — the engine already preserved the data; the flag
  invites an *optional* correlation. Never a modal/confirm/build-blocker
  (assisted-manual, explicit-content model).
* **Amber, low-emphasis** — not red (red is for conflicts/errors); amber is the
  project's "attention, not error" colour (dirty-marker convention).
* **Litho axis only** — a small marker on the repaired region; hidden on the
  geology/geotech axes.
* **Interaction** — click → popover "These units aren't correlated. [Correlate]
  [Keep separate]". Correlate draws the edge (→ they band next build); Keep
  separate dismisses and persists the dismissal in the `.gmproj` bundle so it
  does not re-nag.
* **Always-on** (soft coupling → always-on), Settings → Litho toggle if noisy.

## 11. Ground-truth overpaint gate + enclosed-lens floor clamp + conformance → 0 (owner ruling 2026-07-26, cont.)

**The independent invariant (`partitionFillV2.groundTruth.diag.test.ts`).** The
2/1/0 shape-conformance gate checks data loss only by PROXY — its shape rule
(corr → lens/onlap/band) has both false positives (a dipping band, a sub-TD
substrate wedge, a split band component all render correctly yet trip the bbox
rule) AND a false negative (it exempted a swallowed drilled unit as a
`facesShallowVoid`). So it cannot be the sole data-loss guard. The new gate is the
DIRECT invariant (ruling 8k, "columns are ground truth"): for every gap of all 14
real sections (flag-ON), sample each drilled unit of both facing columns at
25/50/75 % of its OWN thickness (never at a contact) and assert the fill at that
column edge contains the drilled unit's formation. Runs UNCONDITIONALLY (a hard
invariant, enforced in the normal suite — not an opt-in audit). It is the backstop
that makes the conformance FP-accepts (below) safe: any accept that ever swallows
real data loss turns this gate RED.

**The defect it caught — CS1 g21 (enclosed lens below its band floor).** A drilled
0.35 m ZAND lens enclosed by a tied SILT band, in a 0.17 m near-coincident-borehole
gap, was painted SILT (the sand vanished). Root cause: the enclosed lens's base
(8.88) sat 0.04 m BELOW the gap's substrate floor (shallow TD 8.92), so the lens
poked out of the bottom of its enclosing matrix band into the deep-to-deep
substrate zone; `detourBandContourAroundLenses` only carves a lens fully INSIDE the
band, so the straddling lens was not carved and the enclosing flood absorbed it.
NOT the `ENABLE_ENCLOSED_LENS_EDGED` wall (the ordinary `extractEnclosedLenses`
already records it flag-ON via `edgedBelowMergeEnabled`); the only missing piece was
a geometry clamp. **Fix:** `emitLenses.enclosedLensDiamond` clamps the lens base UP
to the substrate floor (`max(minBase(col), minBase(facing))`), making it a clean
interior hole the existing detour carves; the sub-floor sliver is substrate. A lens
already at/above the floor is byte-identical; a lens entirely below the floor is left
for `emitSubTdLenses`. Holes/overlaps stay 0/0.

**Conformance flag-ON → 0 (guarded FP accepts).** With g21 fixed and the overpaint
gate green, the five remaining flag-ON conformance instances (TS10-g0, CS1
g12/g18/g19/g22) are all render-correct false positives of the bbox shape rule.
Three guarded predicates in the classify loop accept them, each with a negative
guard: (A) same-litho FACING band (facing carries the unit's own formation across
the band → 8j merge, one body) → TS10-g0, g22; (B) sub-TD substrate STRADDLE (the
full-width render is the deep-to-deep substrate below the shallow TD, not a
termination band) → g18, g19; (C) own full-width band component EXISTS (a dipping
band split at the unit's window boundary) → g12. **Scoped to the flag-ON literal-8l
product path** (`twoSidedTerminationsEnabled`) so the frozen flag-OFF seam-engine
reference stays pinned by identity at 10 (byte-identical). Flag-ON conformance is now
a true 0; the overpaint gate is the independent data-loss backstop.

## 12. A closure exists to MEET the facing test (owner ruling 2026-08-21)

**Owner, verbatim,** on S7's thin interbeds drawn as phantom pinches around the
short S7A: *"it should be a continuous band starting from S7 but now it is
interrupted at S7A's column by a SF clay render."*

**The law.** A termination — a lens apex, a pinch — is a statement about where a
unit meets what the FACING test read. Where the facing column has no litho unit at
any of the unit's own levels (the ground over there is below that column's TD, or
above the first thing it logged) there is nothing to meet: the unit **continues to
that column at full thickness** instead of pinching. It closes per the ordinary
2/1/0 rules in the first gap whose facing column DOES read that ground. This is the
litho arm's half of the rule the geotech constructive arm already carries
(`geotechHierarchicalFill/constructive/constructs.ts` → `extendsToFar`); the two
must read a short log the same way, because the geotech frame can never exceed the
litho cover.

**Scope.** corr-0 only. A corr-1 onlap HAS a tie to follow — that IS a reading to
meet — and is untouched (CS1 gap 17's KLEI +5.05..+4.23 still onlaps its bridge tie).

**Implementation.** `partitionFillV2/emitContinuation.ts`:
`facingReadsNothing(facing, top, base)` (no facing unit overlaps the window) +
`emitContinuation` (top contact carried across → a CURTAIN on the facing column →
base contact carried back; with the unit's own column-vertical that is a closed
rectangle, the `btcurtain` idiom). Wired at the **one** corr-0 emission authority,
`emitTerminationSweep.emitCorr0Termination`, so the above-TD sweep and the sub-TD
pass inherit it together, and at the enclosed-lens carrier `emitLenses.emitOne`
(a freedraw-override lens is exempt — explicit user nodes are never auto-corrected).
`detourBandContour.collectEnclosedLensDiamonds` mirrors the skip so no onlap flank
detours around a diamond the emitter no longer draws. Only the CURTAIN carries the
unit's `LensLabel`: the two carried contacts are shared with the units above and
below, so naming one of them hands a neighbour's face this unit's litho.

**Consequence for `emitSubTdLenses`.** Below the facing TD there is by definition no
reading, so the corr-0 sub-TD *hugging lens* is superseded everywhere; its geometry
survives only as the physical fallback when the rectangle would be sub-snap
degenerate. The pass's F5 corr-1 sub-TD onlap is unchanged.

**Measured on the live 14-section model** (`lithoLedger.diag`, LITHO_LEDGER=1):
13 regions removed / 16 added, **every one a named continuation instance**, zero
unexplained; **13 of 14 sections byte-identical** (only Cross-section 1 moves, gaps
14/15/17/18/19/20); holes 0→0 and different-soil overlaps 0→0; **total covered area
unchanged to 0.01 m²** (18844.1 m²) — no new ground is claimed, 119.9 m² changes
hands. CS1 gates 8/8, the litho-consistency ratchet unmoved, the geotech scene pin
S23 (the owner's own scene, held RED as `it.fails`) now satisfied end-to-end.
