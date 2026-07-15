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
| Shared-contact onlap (ruling 8a — interior converging case) | SHIPPED (2026-07-15, `87e6ccb9c`, `emitSharedContactOnlap.ts`): a minority between two REAL tied brackets whose top OR base rides a TIED shared contact — including a CONVERGING facing bracket — onlaps that tie (tip 0.5); the untied-side enclosing matrix floods both wedges past the tip, the tied band never enters the interval. Owner's S5A\|S5 KLEI verified per his closed-loop trace (clay pinch tip (0.5,·), silt quad closing around the notch, sand band below; hole-free). zerocorr 15→14. The `top.anchor && base.anchor` guard is LOAD-BEARING (without it the flood invents a full-width band to the surface — measured CS1 g8). REMAINING 13, three shapes: (i) ~7 surface-topped onlaps facing a NON-converging deep column — need `emitSurfaceOnlap`'s rising apex extended without inventing a top matrix; (ii) interior tied-onlap with an UNTIED opposite bracket — relaxing the guard runs the flood full-width; (iii) ~4 same-formation enclosed LENSES (0-corr, v1 pinches 0.45) — the documented interbedded-facing annulus wall. CS1 g7 KLEI = genuine §8-Q3 surface-void, correct, NOT retagged while real defects remain |
| Strict-2/1/0 residual (16 zerocorr violations) | DIAGNOSED (2026-07-15 session): THREE sub-shapes, not one — (a) ~7 same-formation enclosure incl. interbedded facing; (b) ~6 mixed-bracket (minority between two DIFFERENT tied bands — needs an owner ruling on what floods the vacated width); (c) ~3 surface-boundary + facing-void (judge against §8 Q3). Root of (a): `routeLoneStack`'s `facingMatrixLabel(convElev)` samples the WRONG facing unit at a zero-thickness facing bracket on a contact → bail → full-width. The routing fix exists (`enclosingMatrixOfInterval`, lone-column bracket adjacency `belowLith ?? aboveLith`) and reshapes the lens correctly, but the FLOOD face then absorbs the base-boundary lens (measured Tie-6 SILT×KLEI 15.9 cm): flood-labelled faces (`units.length===0`) BYPASS `splitAnnulus` (fires only on holes>0). FIX PATH: bound the `emitLoneStackBand` flood below a base-boundary minority (base-bracket split at apex-x, or route flood faces through the annulus/notch splitter even at holes=0), verified against the 32 currently-OK routeLoneStack cases |

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
