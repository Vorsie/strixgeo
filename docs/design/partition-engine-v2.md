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
| Enclosed-lens matrix merge (v1 step-0 interval extraction → matrix continuous, lens overlaid) | KEPT as lens-as-HOLE face, but BLOCKED: increment-3 re-evaluation showed the path mis-shapes even the pure synthetic lens case and adds false overlaps on 2 real sections — stays guarded (`ENABLE_ENCLOSED_LENS = false` in `sectionGeom.ts`) pending a dedicated pass that first fixes its pure-case geometry. Enclosed minorities flow through the ordinary 0-tied lens closing path meanwhile |

Discovered during the increment-3 build (2026-07-14):

| v1 rule / pass | v2 disposition |
|---|---|
| Deep-to-deep substrate (concrete v2 mechanism) | IMPLEMENTED as jump-tie BRIDGE curves (`emitSubstrate.ts`): a non-adjacent tie emits a bridge polyline from the lo anchor's contact through every intervening column x (real alongM) to the hi anchor; a deep anchor unit whose contact a bridge carries skips its own lens/onlap closing; bridge-bounded faces read BAND. Bridge-less strips stay empty (owner §8 Q3) |
| Vacancy closure at terminations (v1 `emitInterval` two-pieces-plus-filler + the owner-validated "no auto-facies" straight midpoint seam) | IMPLEMENTED (increment 4a, `emitIntervals.ts`) — untied units of each interval between tie-anchored bands tile it fully via vertical seams (thickness-weighted; straight midpoint 0.5 for a mismatched matrix; full width for a lone side) + horizontal sub-seams + a shallow-TD floor curve. Holes/overlaps 0/0 on all 14 sections, confirmed by BOTH the scan diag and an independent PIP sweep. PARITY GAP remaining: seam SHARE differs from v1 in places (equal-and-opposite formation-pair deltas in the A/B diff) — seam placement must become v1-exact (increment 5) |
| Enclosed-lens disjointness (v1 `carveOverlays`) | REPLACED (increment 4a, `emitIntervalLenses.ts`) — a 0.45-apex lens stays a disjoint hole via a mandatory seam margin (`LENS_MARGIN`: the seam sits strictly outside the apex) + a single-matrix guard (enclosed-minority extraction only fires when the residual matrix is ONE formation; interbedded stacks tile as ordinary seam-meeting units). Widen-the-cell instead of subtract-the-overlap |

Discovered during increment 5 (2026-07-14, parity + gates against v2):

| v1 rule / pass | v2 disposition |
|---|---|
| Substrate WITHOUT explicit ties — v1 `computeBracketSubstrate` brackets the nearest deep anchor each side of a shallow run and fills deep-to-deep with NO correlation edge required | MUST IMPLEMENT (increment 6) — v2's increment-3 bridges only fire on explicit jump ties, leaving −79.9 fraction·m sub-TD unfilled vs v1 and FAILING the ported cs1void gate. Increment 5 mislabelled this "owner Q3 by design" — WRONG: Q3's stay-empty applies only to bridge-LESS strips (no deep anchor); anchor-bracketed runs fill in both engines (the Q3 review visual's "Situation 1") |
| Band authority over adjacent tiling (cs1bandauthority interior invariant) | REAL v2 DEFECT (increment 6) — correlated KLEI/SILT bands at CS1 cols 11-14 are not authoritative; adjacent-column lithology tiles into the band interior. Fix by construction; the ported gate pins it |
| Onlap-on-shared-matrix placement — v1 bands the shared-formation matrix full-width and onlaps the odd unit; v2 tiles both as opposing seam-meeting pinches | DIVERGENT, area/litho-conserving — but implicated in the band-authority defect; resolve together in increment 6 (band-first tiling), re-judge the residual seam diffs after |
| Output-polygon simplicity — v1 emits simple (concave, carved) polygons; v2's `slice.keyholePolygon` emits self-touching keyhole rings for enclosed lenses (179 model-wide) | MUST CHANGE (increment 6) — keyholes break shoelace-vs-PIP agreement (parity residuals), trip the sliver gate with false positives, and are a hazard for downstream consumers (geotech refinement, voxel builder, DXF export assume simple rings). Emit the matrix as a simple carved ring or the lens as a separate face-pair |

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
