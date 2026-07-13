# Partition Engine v2 — closed-loop (face-tracing) model

**Status: DESIGN DRAFT (2026-07-13, owner-commissioned) — review with owner
before any code.** Decision record: CLAUDE.local.md → "DECISION 2026-07-13 —
partition engine v2". Target: closed beta ~mid-August; v2 built in parallel,
cut over behind a dev flag, old engine stays as fallback.

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
| Band authority (cs1bandauthority semantics) | KEPT — arbitration when two ties disagree becomes curve-priority at arrangement build |
| Same-formation lens-on-own-matrix overlay retained for nested-body render | CHANGED — in v2 the enclosed unit is its own face (not an overlay on the matrix). The overlay render must draw it as a face; nested-body visuals come from face adjacency, not painting order |
| `computePartitionFill(left, right)` 2-column wrapper | KEPT — thin wrapper over the v2 section call (public API compat; the pure-geometry unit tests ride it) |
| Open bug: horizontal-only band-emit (band dips below shallow TD) | Must be FIXED-BY-DESIGN in v2 (bridge curves are the mechanism); add a gate from the dogfeed repro before cutover |

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

## 8. Open questions (owner)

1. **Closing-curve defaults** — keep 0.45/0.55 apex fractions as-is for v2
   parity, or take the opportunity to revisit? (Recommend: keep for parity;
   revisit after cutover.)
2. **Onlap apex on the bracket** — when an onlap loop rides a bracket
   tie-line, v1 clips it to the seam ("ride the seam", Solution 2). v2 gets
   this from the arrangement automatically — confirm the visual matches on
   the CARVE1-5 dogfeed cases.
3. **Sub-TD faces under shallow tests** — v2 naturally fills the column
   footprint below TD from the bridge curves (v1 needed the under-column
   pass). Is always-fill correct, or should a genuinely uncorrelated void
   stay empty (v1 behaviour: no gap region sampled → stays empty)? Default:
   match v1 (empty when no bridge exists).
4. **Where band arbitration lands** when two approved ties conflict
   (crossing ties) — v1 band-authority rules; v2 needs an explicit
   curve-priority order. Propose: newer edge wins + a validation warning
   (crossings endpoint already exists).

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
