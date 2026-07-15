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
| Ruling-8e Milestone 2 — the ABSENT class (engine) | STOPPED WITH GEOMETRY (2026-07-15, §8 ruling 7). 19 absent minorities remain; enumerated: Tie-9 g0 SILT R el[5.01,5.96]; Tie-10 g0 VEEN L el[5.06,8.55] + ZAND R el[5.73,6.44]; Tie-11 g0 KLEI L el[4.6,5.86]; CS3 g0 SILT L el[0.56,0.91] + KLEI R el[-1.34,0.35] + SILT R el[-2.41,-1.85]; CS3 g3 SILT L el[-2.53,-1.74]; CS1 g3 SILT L el[0.23,0.67]; CS1 g6 ZAND L el[5.19,5.79]; CS1 g7 SILT R el[9.29,9.85]; CS1 g15 SILT L el[-1.17,-0.26]; CS1 g20 ZAND R el[8.88,9.23]; CS1 g21 ZAND L el[8.88,9.23]; CS1 g22 ZAND L el[9.83,10.42]; CS2 g16 KLEI L el[10.78,11.32] + SILT R el[-3.83,-3.14]; CS2 g19 SILT L el[-1.85,-1.18]; CS2 g21 SILT L el[-3.99,-3.67]. ROOT (confirmed by the render probe): every absent minority is an ENCLOSED MINORITY (same-formation above+below on its own column, or a thin interbedded band) whose lens/onlap closing IS emitted by the interval tiler but whose face is ABSORBED by the enclosing SAME-FORMATION flood/band face — the `emitIntervalLenses`/`routeLoneStack`/same-formation-band (`emitIntervals` line ~441) closings produce `close`-id notch faces that the spanning matrix face (or its label) swallows; nested interbedding (CS3 g0: ZAND/KLEI/ZAND/SILT/ZAND) compounds it (the column-level `extractEnclosedLenses` pulls SOME lenses, the interval tiler cannot separate the rest). This is the SAME `splitAnnulus`-bypass / flood-absorbs-the-lens wall the `ROOT DEEPENED` + `Strict-2/1/0 residual` rows document: the notch face rides the column edge (holes=0) so `slice.splitAnnulus` (fires only on holes>0) never separates it. A correct fix routes enclosed-minority closings through the annulus/notch splitter even at holes=0 (or emits per-unit termination faces the flood cannot merge), and MUST regression-guard the 32 currently-OK `routeLoneStack` cases + holes 0/0/0 — a fundamental restructuring §4 already flags cannot land while holding the holes-0/0/0-per-milestone bar. A partial fix on one case would leave others gapped/regressed (ruling 7). Left for its own red→green increment; the 19-resister geometry above is the repro set. **TRIAGE CONFIRMED (2026-07-15 follow-up, per-instance render + arrangement-face probe against the conformance gate's own `renderedShape`):** the three candidate mechanisms resolve to — (a) DANGLING closing (seam-anchor class): ZERO instances; (b) LABEL swallow (a separate face traced but mislabelled): ZERO in-gap instances (the SILT lens seen at CS1 g15 is the LEFT-gap emission, apex 572.5, correctly SILT — the in-gap right emission has no separate face at all); (c) TRUE MERGED TRACE: **17 of 19** — the minority's lens/onlap closings ARE emitted into the gap at its own contacts (`close`/`flood` pairs, apex 0.45 verified in the probe) but NO own-formation face is traced there; the enclosing same-formation flood/band is ONE face that geometrically absorbs the notch region (the notch apex curves neither cross a flood curve — `intersect.ts` won't register it, 613-hole warning — nor form a separated sub-loop; the flood face `units.length===0` bypasses `splitAnnulus` at holes=0). The remaining **2 of 19** (CS1 g20/g21 ZAND, both-tied) are a `routeLoneStack`-didn't-fire NO-EMIT variant (zero termination curves; the SILT band sweeps the ZAND slot). One surgical attempt (extend `emitLoneStackBand` slab seams full-width to the facing column when the facing carries the matrix at that boundary) was built + measured: it did NOT separate the notch AND regressed 19→20 absent (new Tie-14 leak) + 8e 90→88 — REVERTED clean (engine byte-identical, full battery green). Empirically confirms the doc's standing verdict: the fix is the two-sided terminations-first / notch-splitter-at-holes=0 restructuring, not a seam tweak. Still its own red→green increment |
| Completeness increment Case 1 — ruling-8d deep-facing rows | STOPPED WITH GEOMETRY (2026-07-15, §8 ruling 7 "partial-that-holds"). The prompt framed CS1 g8×2 + g19 KLEI as clean facing-first-unit MISMATCHED bands (midpoint quads). Three empirical probes proved they are NOT: CS1 g8's LEFT column GEO-10/170-S8 has only TWO units (ZAND 11.27→9.85, SILT 9.85→9.29; TD 9.29 mTAW) while the RIGHT column GEO-23/125-S10 is deep — so R's shallow KLEI u0 (11.26→9.87) fills SIDEWAYS into L's shallow-TD region via the lone-side / enclosed-lens routing (the L ZAND u0 dissolves to a lone 0.45 lens spanning 9.85→11.27, R's KLEI/SILT flood full-width). It is a shallow-column sideways-fill entangled with the §8-Q3 sub-TD substrate, not a `[topBand, tie]` facing pair. A clean-facing-pair detector (`mismatchedFirstBand.ts` + top-band-as-implicit-anchor in `emitIntervals`) was built and verified SAFE (holes 0/0/0, CS1 7/7, tsc clean) but fired on ZERO real intervals, so it was REVERTED (engine kept clean, no god-component growth). CS1 g19 ZAND = same-formation first units, ALREADY a legitimate band (renders full-width `el[10.65..11.43]`, now counts 2-corr via Case 0 — no emission change needed, confirmed). g7 KLEI retag deferred: its sibling surface rows (g8/g19 KLEI) are NOT resolved, so the design-doc condition for retag is NOT met. FIX PATH for a future session: intercept the mismatched pair BEFORE the lone-side/enclosed-lens routing dissolves the shallow first unit — but that restructures the shallow-column interval handling (loneSidePinch/lens battery regression risk), needs its own red→green increment |

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

## 6. Migration & verification (parallel build, never big-bang)

* New module `desktop/src/renderer/src/utils/partitionFillV2/` — the v1
  package is NOT touched. Entry: `computeSectionFillV2` (same signature).
* Cutover switch: a dev-only toggle (Settings → Litho segmenter, plus env
  `STRIX_PARTITION_V2=1` for tests) selecting the engine in the ONE place
  the overlay/build call it. Old engine remains the beta fallback until the
  owner has dogfed v2 on the real model.
* **A/B parity harness (exists today, reuse):**
  - 14 real sections: `scripts/diag_allsections_extract.py` →
    `scripts/diag_allsections_input.json` (thread REAL alongM).
  - Region-diff runner: new `partitionFillV2.parity.diag.test.ts` — run both
    engines per section, match regions by (gapIndex, formationId, bodyId),
    report area deltas + classification changes. Every intentional
    difference must map to a v1 bug class (documented per section);
    everything else must be < 1 cm² noise.
  - Invariant gates on v2 output: holes/overlaps reporter (0/0 on all
    sections), `cs1lensdisjoint`, `cs1sandbody`, `cs1bandauthority`,
    `cs1void`, tie-straddle diag. The FROZEN gate pins v1 only; v2 gets its
    own frozen snapshot after owner dogfeed sign-off.
  - **Full 2/1/0 conformance gate** (`partitionFillV2.conformance.diag.test.ts`,
    `SHAPE_AUDIT=1`, 2026-07-15): per unit per gap, the engine's own tie
    state vs the rendered shape — `0corr-not-lens` / `1corr-not-onlap` /
    `2corr-not-band` + advisory `0corr-reach-exceeds-cap` (ruling 8b) and
    `q3-legit`. **CORRECTED baseline (ruling 8d landed 2026-07-15): the top
    band is an implicit tie for FIRST units — a surface-topped first unit
    whose base rides a real/derived tie is 2-corr (band between the top band
    and the base tie; midpoint quads when the facing first unit's formation
    differs). ``topBandTies``/``firstUnitTopBandBand`` in
    `partitionFillV2.conformance.classify.ts` fold this in; the `corr===2`
    render check accepts the midpoint-quad ``onlap``-per-side shape when the
    facing first unit differs.** Corrected totals on the 14 real sections:
    **0corr-not-lens 22, 1corr-not-onlap 99, 2corr-not-band 0** (byCorr
    41/145/756 — 41 first units promoted from 1-corr to 2-corr; was
    41/186/715; 32 sub-TD substrate excluded per Q3; q3-legit 6, reach-cap
    advisory 2; CS1-g7 KLEI correctly q3-legit — a first unit tied ONLY by the
    top band with no base tie stays a 0-corr §8-Q3 surface void). This
    corrected baseline is the acceptance denominator. Band authority for the
    "2" classification = the engine's matched-pair `collectGapBands` + the
    ruling-8d first-unit case (naive both-contacts-tied miscounts mixed-bracket
    minorities).
    CUTOVER CRITERION: all three counters 0 (advisories triaged).
    WARNING for the frozen snapshot: a rare cross-process determinism gap
    exists in `computeSectionFillV2` (V8 hash-seed-sensitive Map/Set
    iteration on one borderline region) — fix before freezing.
  - Verification note (2026-07-14): overlap claims are settled by BOTH the
    interval-scan diag AND an independent dense point-in-polygon
    double-coverage sample — increment 3 asserted the CS1 gap18 triple
    junction was a diag false positive, but the PIP sample proved a real
    ~cm-scale patch claimed by three output polygons at once. The
    `SectionRegion` polygons are the output contract; "the arrangement
    faces are disjoint" is not sufficient — the sliced output must be.
  - Unit tests: the pure-geometry cases in `partitionFill.test.ts` /
    `partitionFill.oneGesture.test.ts` run against BOTH engines via the
    2-column wrapper (parameterised), except cases that pin v1 bug
    behaviour — those get inverted for v2 with a comment citing this doc.
* Definition of cutover-ready: all gates green on v2 + parity diffs fully
  explained + owner dogfeed on the real model (litho AND geotech axes) +
  voxel build from v2 output passes the fidelity harness
  (`scripts/eval_strat_fidelity.py`).

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
   **STATUS (2026-07-15): Milestone 1 (gate rescope) SHIPPED, Milestone 2
   (absent class) STOPPED WITH GEOMETRY** — see the §4 "Ruling-8e GATE
   RESCOPE" + "Ruling-8e Milestone 2" rows. New true baseline: 32 conformance
   violations (was 121); 90 tagged `8e-enclosure`; 19 remaining absent
   minorities enumerated with geometry as the §4 repro set; 13 full-width
   untied stay the ruling-8 residual. The absent class is the same
   `splitAnnulus`-bypass / flood-absorbs-the-lens wall, needing its own
   red→green increment under the holes-0/0/0-per-milestone bar (ruling 7).
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
