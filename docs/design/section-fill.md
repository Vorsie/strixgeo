# Section Fill — current design

> Current state only. Superseded designs (geometric matrix inference, bodyId-LCS
> matching, whole-section shared reduce, auto-facies seams, meeting-fraction
> seams) were deleted from this doc — git history of CLAUDE.md pre-2026-07-12 has
> the full evolution if ever needed.

**The 2D partition is the single source of truth for interpreted geometry.**
The 3D voxel build LABELS space from it (`buildVoxelRequest` threads the same
inputs); every render and export derives from the same engine.

Code: `desktop/.../utils/partitionFill.ts` (pure engine) +
`PartitionFillOverlay.tsx` (render). Entry point: `computeSectionFill(columns,
edges, …)`; `computePartitionFill` is a 2-column delegate.

## The contact-correlation model (shipped 2026-06-09, owner directive)

A unit's shape toward a neighbour is decided purely by **how many of its TWO
bounding contacts are correlated to that neighbour**:

| correlated contacts | shape |
|---|---|
| 2 | **BAND** |
| 1 | **ONLAP** (flat on the correlated bracket, tip at `INTERIOR_PINCH_FRACTION`; top-correlated laps up, base-correlated laps down) |
| 0 | **LENS** (horizontal apex at own elevation) |

* Top contact correlated = an approved `LithoContactCorrelationEdge` on THIS
  layer's id; base contact = an edge on the layer BELOW (a `litho_layer.id`
  keys the contact at its top).
* Pure classifier: `classifyTermination(units, i, neighbourLayerIds, correlated)`.
* `reduceColumn` pulls a unit as a lens iff `classifyTermination === 'lens'`
  (0-corr), merging the same-litho matrix around it so the matrix bands via its
  OUTER edges (the lens contact — the matrix's internal boundary — stays
  uncorrelated).
* Resolution is **PER-GAP / PER-SIDE** (fresh column copies per gap) — a unit
  can band toward one neighbour and pinch toward the other.
* **No auto-facies**: a mismatched matrix meets at a straight midpoint seam. A
  facies/disturbed contact is the engineer's explicit call, never a geometric
  inference.
* Bands follow drawn correlations — delete an edge and the band un-bands. Edges
  are the real `LithoContactCorrelationEdge`s (direct, approved, same-litho),
  NOT the resolver's transitive `body_id` (which over-lumps).
* Correlation is stored only at layer level (`body_id` = resolver
  connected-components of approved layer↔layer edges). There is NO per-contact
  correlation entity.
* Known approximation: the 1-corr ONLAP geometry uses `emitInterval`'s pinch at
  the bracket, not a dedicated lap-to-tie-line wedge — refine only if a truer
  onlap shape is wanted.

Owner-validated on real `test.strix` ("LOOKS PERFECT": S1 sand = one band, S7 =
lower-band + upper-lens, no wriggly).

## Deep-to-deep substrate pass (shipped 2026-06-21, owner-dogfed 2D+3D)

Below a shallow test's TD the deep stratigraphy runs as straight deep-to-deep
bands via a dedicated `computeBracketSubstrate` pass:

* `computeSectionFill` caps each gap's `emitGap` output at the gap's shallow
  TD = `max(leftFloorElev, rightFloorElev)` (output-clip via
  `clipPolyAboveElev`; fully-above regions pass through verbatim so above-TD
  output is byte-identical).
* `computeBracketSubstrate` fills below: per maximal run of consecutive shallow
  gaps it brackets the nearest deep anchor each side (L,R), runs the same
  reduce/match/`emitGap` machinery on (L,R) (shared helper `emitGapBetween`),
  clips below the run's shallow TD, and slices per intervening gap at each
  column's along-fraction.
* `alongM` is threaded from the overlay (`ColumnScreen.along`) +
  `buildVoxelRequest` so the 3D voxel build inherits identical geometry;
  uniform-spacing fallback when absent (keeps the gate + old callers firing).

Layered dogfeed fixes, ALL gate-guarded:

* one-sided clay pinch tapers to a point at the cap (`emitOneSidedPinch` apex
  clamp);
* band-path lens apex anchored to `LENS_PINCH_FRACTION` instead of linear
  strip-remap (carve deferred per-gap to avoid a masked void);
* under-column fills render BENEATH gap overlays in `PartitionFillOverlay`
  (2D-render-order only — NOT carried to 3D);
* matched silt over a shallow TD merges to one slanted quad
  (`mergeSplitBodyRegions`, area-preserving guard);
* an explicit top-correlated band dips below a shallow neighbour's TD instead
  of lensing (`facingBandTd` / `reanchorBandToFacing` — band top from the
  correlation, base owned by the substrate).

## Outer-edge terminations (owner ruling 2026-09-07)

The section's outer edges — left of the first column, right of the last — are NOT
gaps, so the arrangement engine emits nothing there; the outward extension is drawn
by `PartitionFillOverlay`'s open-end stub. **Every unit on an outermost column bands
flat to the section edge, whatever its tie count on the inner side** — there is no
data beyond the edge, so the interpretation carries the last known layer out. The
engine expresses this in `outerColumnZeroTieLayerIds` (partitionFillV2), which the
overlay consults for the set of outer units to PINCH: under this ruling the set is
always empty, so nothing pinches. This REVERSES, at the outer edge only, the earlier
"zero ties = lens" pinch (2026-09-04); interior zero-tie lenses between two columns
are unchanged. (Owner: *"the basal clay on 20/034-S5 emits a lens to the left; it is
a test on the utter left side, it should band left, like all the other columns."*)

## Bottom-tie onlap below a shallow test (owner rulings R3/R4, 2026-09-07)

When a deep test's unit TOP is tied to the FACING (shallow) column's DEEPEST contact — its TD — the
tie is that shallow test's **bottom tie** (a mixed base↔top tie the base↔base
`emitBottomTieSubstrate` never sees). Two coupled behaviours follow, both flag-ON:

* The tied unit ONLAPS all the way to that bottom-tie point on the shallow column (reach 1.0), filling
  the sub-TD wedge, instead of pinching at `INTERIOR_PINCH_FRACTION` and letting `emitFloodWedge` invent
  a facing litho below the shallow TD. Implemented as `drawTermination`'s `bottomTieToTd` gate in
  `emitOnlap` (top-tied, facing endpoint == facing TD, own free base below that TD, no free-draw
  override) — every ordinary onlap stays byte-identical. Owner: *"below a shallow test, the tied sand
  onlaps its bottom tie."*
* The single untied unit BELOW the bottom tie fills the remaining sub-TD triangle as ONE hole-free
  wedge (`emitBottomTieWedge`, gated in `emitSubTdLenses` on `facingTdTied`): its flanks ride the onlap
  base-flank line so no gap opens under the rising onlap, and it pinches short of the apex column (a
  visible LENS, never a full-width flood). The space past the pinch is the §8-Q3 no-data void. Owner:
  *"the untied clay lenses ... it leaves the no-data void below its own pinch."* The wedge flanks carry
  an `oflank` prefix so `channelMatrix.isEnclosingFloodFace` treats the face as the unit's own closed
  loop (immune) — the apex rides into the tied unit's elevation band, which the channel-matrix vacancy
  rule would otherwise repaint to the tied litho.

**Scope guard:** the wedge is the CLEAN single-untied-unit case (the TS4 clay). A multi-unit /
interspersed sub-TD config is NOT general to the shared-apex wedge (it can overpaint an interspersed
unit and it is where the 2026-08-21 continuous-band ruling lives, e.g. CS1 S7), so those units fall
back to the ORIGINAL sub-TD path (flat continuation to the edge, else the ordinary lens) — byte-
identical to the pre-R3 behaviour. So `facingTdTied` only ever reshapes the clean single wedge.

Pinned in the owner's words in `partitionFillV2/ownerRulings.test.ts` (rulings 3 + 4, Tie-section 4);
the CS1 golden's gap 18 legitimately moves where the same bottom-tie config occurs there.

## The arbiter — the CS1 real-data gate

`partitionFill.cs1void.test.ts`, run with `CS1_GATE=1`; regenerate the input
first via `scripts/throwaway_cs1_partition_extract.py` against the dev DB.
Asserts: **cross-formation overlap 0 / interior void 0 / lithology correct /
quad 0.**

* **Synthetic tests are NECESSARY-NOT-SUFFICIENT** — twice a fix went green on
  synthetic fixtures while real CS1 stayed broken. Any change to the fill
  engine runs the gate.
* The lithology check exempts a point covered by exactly ONE region whose
  formation is correlation-banded (honours correlation-driven sloping bands;
  the single-coverage clause is the load-bearing guard, banded-formations 3/4
  keeps teeth).
* The geotech axis adds a second, always-on **frozen-CS1 gate at zero
  cross-class overlap** — see [geotech-stage.md](geotech-stage.md).

## Known-open + dogfeed traps

* **KNOWN-OPEN cosmetic (#A, owner-deferred):** a two-sided different-lithology
  facies meeting in a data void renders as a straight off-center vertical seam.
  The deep fill itself is correct; a true taper is Phase-5 interfingering.
* **RECURRING trap — a "band won't draw" report is usually a MIS-DRAWN
  correlation, not an engine bug.** The contact-picker grabs the clay-top when
  you tie a silt-base (silt-base == clay-top contact), recording a mixed
  (base↔top) tie the engine doesn't count as a band; and a too-shallow test
  can't band a bed below its TD (reach guard). **INSTRUMENT against the real
  input before "fixing" the engine.**
* Section-view spacing modifier matters for ALL geometry: every section overlay
  must use `warpedXToScreen` (and the warp-aware inverse for drag commits),
  never raw `xToScreen`. This trap has fired three times — see
  [[feedback]] memory on section geometry.

Specs/plans (history + rationale):
`docs/superpowers/specs/2026-06-21-deep-to-deep-substrate*.md`,
`docs/superpowers/plans/2026-06-21-deep-to-deep-substrate*.md`,
`docs/superpowers/specs/2026-06-08-partition-fill-pinchout-matrix-design.md`
(taxonomy correct; framing partially superseded).
