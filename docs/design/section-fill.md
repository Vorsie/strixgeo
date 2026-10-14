# Section Fill — current design

> Current state only. Superseded designs (geometric matrix inference, bodyId-LCS
> matching, whole-section shared reduce, auto-facies seams, meeting-fraction
> seams) were deleted from this doc — git history of CLAUDE.md pre-2026-07-12 has
> the full evolution if ever needed.

**The 2D partition is the single source of truth for interpreted geometry.**
The 3D voxel build LABELS space from it (`buildVoxelRequest` threads the same
inputs); every render and export derives from the same engine.

Code: `desktop/.../utils/partitionFillV2/computeSectionFillV2.ts` (pure engine)
+ `PartitionFillOverlay.tsx` (render). Entry point: `computeSectionFillActive(columns,
edges, …)` in `utils/partitionEngineSelect.ts` (v1 archived 2026-08-31).

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
* Correlation is stored only at layer level. `body_id` = resolver
  connected-components of the geometry facts this fill paints (owner
  2026-10-04: identity follows the drawing — a tie the fill does not band joins
  no bodies; [body-model.md](body-model.md)). There is NO per-contact
  correlation entity.
* Known approximation: the 1-corr ONLAP geometry uses `emitInterval`'s pinch at
  the bracket, not a dedicated lap-to-tie-line wedge — refine only if a truer
  onlap shape is wanted.

Owner-validated on real `test.strix` ("LOOKS PERFECT": S1 sand = one band, S7 =
lower-band + upper-lens, no wriggly).

## Below a shallow TD: no tie, no band (owner ruling 2026-10-04)

Below a shallow test's TD nothing was drilled, so the fill there comes from **stored ties only**.
Owner, on section "test" (GEO-08/118-S11 -> S10 -> S8 -> GEO-19/100-S3): *"as long as the bottom of
S11 is not correlated to 19/100-S3 the loop isn't closed and there is nothing to draw"*, and
*"bridge bands can close a polygon; if the polygon is closed on all sides it is a band"*. The rule:

* **A loop closes only through stored ties.** A deep column's unit below a shallow TD is drawn from
  its own ties and nothing else: **two ties = band** to the tied partner, **one tie = onlap** to the
  halfway point of that tie, **zero ties = lens** at its own level. Everything else under the shallow
  TD is the no-data void.
* **A jump tie closes across the columns it skips.** A stored tie whose endpoints skip shallower
  columns is drawn as a bridge (`emitSubstrate.emitSubstrateBridges`) through every intervening
  column at the along-interpolated elevation (real `alongM`); two bridges over the same pair that
  bracket one unit top and base are a band straight through the pass-through columns
  (`BracketStrip`). A chain of stored ties through a shallow TD point closes the same way (dev CS1
  S7A/S7/S6: the sand under S7 is closed by the S7-TD -> 1411-B2 sand-top jump tie and the S6
  clay-top -> S8 clay-top jump tie — it stays filled).
* **A level read by a far test closes nothing.** Retired on 2026-10-04 (git history has them):
  - the flat-floor substrate (`emitBottomTieSubstrate`: a floor at the deepest base-tie level,
    flat-extended across the whole section, plus column curtains — the bottom Boom-clay floors on
    CS1 and the "test" floor under S10/S8 are gone; a base<->base tie between two TDs now gives the
    band a sloping base TD to TD);
  - the level guards that suppressed an onlap because "a column beyond reads these levels, the
    substrate carries it" (`emitSubTdLenses`; replaced by a tie test, `bridgeUnderFacing`: a stored
    jump tie under the shallow column below the unit closes the strip);
  - the 2026-08-21 flat run to the section edge of a unit no column reads (`emitContinuation` via
    `terminationRun`): a unit below the adjacent column's TD that no column in that direction reads
    now lenses toward that column (`terminationRun` returns the adjacent column, `toEdge = false`).
    Only a unit RESTING on the adjacent column's ground (no overlap, not below its TD) still runs to
    the edge.
* **Still standing:** a zero-tie unit whose levels a column BEYOND the shallow one did read crosses
  the blind column and closes against that reader as a lens (the 2026-08-21 relocation — a lens at its
  own level, not a band; dev CS1 S7's interbeds toward 1411-B2); the straddle sliver below
  (installer #37) where nothing beyond reads; the bottom-tie void rule (below).
* This SUPERSEDES the 2026-09-23 exception "where a deeper test beyond the shallow one reads the level,
  nothing changes" (dev CS1 S7 -> S6, worked example GEO-02/145-S13 -> S14). The owner accepted that
  such gaps show the void unless he ties them. On CS1 S7 -> S6 the stored jump ties already close the
  band, so it is unchanged; on the 2026-09-16 worked example the S13 glauconitic sand now onlaps its
  bottom tie halfway.

Pinned in the owner's words: `partitionFillV2/ownerTestNoTieNoBand.test.ts` (fixture
`__fixtures__/owner_test_notie_2026-10-04.json`, his DB after he deleted the base<->base bottom ties:
nothing under S10's and S8's TDs, S3's clean sand onlaps halfway, the matig siltig below it lenses,
no floor/curtain curve, every bridge a stored jump tie). The two band-capped-hole scans
(`__fixtures__/bandCappedHoleScan.ts`, `gapScanFloor`) measure a gap without a bottom tie only above
its shallow TD.

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

## Below a shallow test's TD: plain 2/1/0 (owner ruling 2026-09-23)

When a deep test's unit TOP is tied to the FACING (shallow) column's DEEPEST contact — its TD — the
tie is that shallow test's **bottom tie** (a mixed base↔top tie the base↔base `emitBottomTieSubstrate`
never sees). The owner's 7 September rulings had the tied unit reach the TD point and the untied
unit below tile the wedge hole-free; on CS1 S13 → S6 he read that construction as *"not plain 2/1/0
... it now onlaps the sand above, which only has one tie and should onlap halfway that tie but
instead spans the whole tie"*, and shown both readings on that gap and on Tie-section 4 he ruled:
*"let's go with plain 2 / 1 / 0 everywhere."* So, flag-ON:

* **The tied unit onlaps to the HALFWAY point of its bottom tie** — the ordinary 8i(d) onlap, tip at
  `INTERIOR_PINCH_FRACTION` on the tie. Above the TD it is `drawTermination.emitOnlap` (a unit
  straddling the TD); entirely below it is `emitSubTdLenses.emitSubTdOnlapFlank` (shared with the F5
  bridge-tie onlap). In both there is NO flood wedge past the tip: below the shallow TD there is no
  facing litho to flood with (the wedge would invent one, the `floodsw` KLEI defect), so the space
  past the tip is the §8-Q3 no-data void. `drawTermination` keeps its `bottomTieIntoShallowTd` gate
  only to skip that wedge.
* **Every untied unit below the bottom tie is a lens at its OWN level** (`emitCorr0Termination` in its
  sub-TD flood context, the bare closing at `LENS_PINCH_FRACTION` about the unit's mid-elevation),
  measured against the first column that READ these levels (the 2026-08-21 relocation, unchanged: dev
  CS1's S7 lenses still cross the blind S7A toward 1411-B2). The bottom tie changes ONE thing: where
  NO column beyond the shallow one reads the level, the shallow column is the boundary the tie
  declares and the unit lenses toward it, instead of running flat to the section edge
  (`emitContinuation`). The 2026-09-07 shared-apex wedge (`emitBottomTieWedge`) is gone.
* **A deeper test beyond the shallow one reading the level does not fill the void** (2026-10-04,
  "no tie, no band" above): only stored ties close it. Dev CS1 GEO-23/125-S7 → S6 stays filled
  because jump ties close the sand under S7; worked example GEO-02/145-S13 → S14's glauconitic sand
  onlaps its bottom tie halfway like any other.
* The `declared` seam of `emitEnclosingFlood.closeInterval` still never fires on a bottom tie: the
  void past the tip is not a meeting of two masses.
* **The void stays void (owner 2026-10-04, section "test").** Three leaks had filled it anyway:
  - the bottom-tie FLOOR closed the space under the shallow TD into a face and painted it with a
    base-tie formation from elsewhere (a flat extension of S14/S15's base tie onto GEO-08/119-B15;
    GEO-19/100-S3/S2's base tie under GEO-08/118-S8). The floor is now retired outright ("no tie, no
    band", above);
  - a bottom tie that RISES from the shallow TD (B15's TD tied 2.6 m higher, to S15's silt top) did
    not count as one (`facingTdTied`), so the units below ran flat to the section edge instead of
    lensing toward the shallow column;
  - a top-tied sub-TD onlap on a jump tie that passes UNDER the shallow column (S3's bottom silty sand
    on the GEO-08/118-S11 jump tie) was refused because its halfway apex sits above the unit's top; it
    now onlaps like any other tie, unless another stored jump tie passes under the shallow column
    below the unit (then that bridge closes the strip; the level test is retired). Pinned in
    `partitionFillV2/ownerTestSubTdGaps.test.ts` (fixture `__fixtures__/owner_test_subtd_2026-10-04.json`).

Pinned in the owner's words: `partitionFillV2/ownerCs1SubTd.test.ts` (CS1 S13 → S6, fixture
`__fixtures__/owner_cs1_s13_s6_2026-09-23.json`) and `ownerRulings.test.ts` rulings 3/4 (Tie-section
4 gap 1: tip at 0.5, clay lens within its own span, void under the tie past the tip, hole-free above
the shallow TD). The two permanent band-capped-hole scans (`bottomTieRenderHole.test.ts`,
`zandGlSeamHole.test.ts`, shared `__fixtures__/bandCappedHoleScan.ts`) measure holes only ABOVE a
gap's bottom tie (`gapBottomTie`); a gap without one only above its shallow TD (`gapScanFloor`).

## Stacked enclosed lenses come apart (owner 2026-09-23)

Section "test", GEO-19/100-S1: peat 3.74..1.85, silt 1.85..1.39, peat 1.39..0.85 mTAW inside clay,
none tied. Owner: *"should be three stacked lensen peat on top of silt on top of peat but now there
is overlap?"* The enclosed-lens walk (`sectionGeom.extractEnclosedLenses`) pulls the silt out from
between the peats and merges the peats into one run; when that run is itself pulled as a lens it
came out as ONE diamond from 0.85 to 3.74, and the silt's own diamond (apex at its own mid) poked
out of it — silt over clay, the top peat dipping below its own base. The walk now remembers the raw
units a merged run was welded from (`rawPieces`) and, when the run is pulled, pushes one
`EnclosedLens` per raw piece — each a lens at its own level (2/1/0) — and re-parents the lenses
pulled from inside the run (the silt, matrix = peat) to the run's own matrix (the clay), the mass
that really wraps the stack. The clay host still merges around the whole stack, so its raw split
(`splitHostIntoRawPieces`) is unchanged. Pinned in `partitionFillV2/ownerTestS1Sandwich.test.ts`
(fixture `__fixtures__/owner_test_s1_sandwich_2026-09-23.json`, both gaps: each of the three drawn
and inside its own top..base, no cross-lithology overlap); CS1 golden byte-identical.

**The same, one level deeper, on the per-gap edged path (owner 2026-09-23, section "test",
GEO-08/118-S8 toward GEO-19/100-S3).** S8 is a clay/silt comb whose silt is tied toward S10 only.
The section-wide walk pulled the two inner clays as lenses IN SILT and welded the three silts into
one run; `edgedEnclosedLens.extractPerGapEnclosedLenses` (ruling 8v) then recorded that run as ONE
silt lens toward S3 with the clay lenses nested inside it, and `splitHostIntoRawPieces` cut the clay
host at those nested clay intervals — phantom clay pieces exactly where the silt is (*"the fuk is
happening here ... these wrong lens fills"*). Now: the raw make-up of a merged unit rides on the
unit itself (`UnitGeom.rawPieces`), so the 8v path splits a pulled run into its raw pieces, and
`lensIntervalsInHost` takes the gap index and ignores a lens that does not cut the host in that gap.

**Its tied side (owner 2026-09-27, the same comb toward S10: *"the silt lenses get a clay lens/wedge
to the left"*).** Only the TOP silt piece is tied toward S10 (2.78 ↔ S10's silt 2.40). So the run
comes apart in EVERY gap, each raw piece classified on its own ties (plain 2/1/0, 8r): a piece is a
lens in each gap where it is untied (`emitGaps` per piece), and where it is tied it keeps its own
termination (`EnclosedLens.tiedGaps` — the host's raw split cuts it out, `rawUnitSplit.cutsHostInGap`,
and the sweep draws it, `tiedRawPiece`). The clay lenses nested inside the run are the clay host's own
material in every gap and are never emitted. The clay around the comb carries
`UnitGeom.wrapsCameApartRun`: inside it the onlaps' flood wedges carry the host clay instead of the
facing read (8n), and the tied piece's onlap skips the 8m same-litho check — its facing is silt, but
under its flank lies its own clay host, so skipping would leave it unbounded. Toward S3: a clay band
with three silt lenses hugging S8; toward S10: the clay host, S8's top silt and S10's silt each
onlapping to the halfway point of their shared tie, S8's two untied silts as lenses hugging S8, S10's
untied sand and silt as lenses/onlaps at their own level. Pinned in
`partitionFillV2/ownerTestS8Alternation.test.ts` (fixture `__fixtures__/owner_test_s8_alternation_2026-09-23.json`,
S10 / S8 / S3) and `partitionFillV2/ownerTestS8TiedSide.test.ts` (fixture
`__fixtures__/owner_test_s8_tied_side_2026-09-27.json`, the whole section, gap S10 → S8); only that gap
of the section changes; CS1 golden byte-identical.

## Same-litho enclosed lens is one mass (owner ruling 2, 2026-09-07)

`mergeTouchingBodies` welds a same-lithology enclosed lens and its enclosing matrix under one body
but never moves a vertex, so the pocket kept its own closed lens polygon (a distinct shape + lens
outline) inside the facing sand. Owner: *"the sand pocket keeping its lens shape means that
something is wrong in the merge step after the fill."* A post-merge pass
(`absorbEnclosedSameLithoLens`, run right after `mergeTouchingBodies` on the flag-ON path) ABSORBS
such a lens: when a `kind:'lens'` region is the SAME `formationId` and SAME `bodyId` as an enclosing
non-lens region whose ring carries the lens's carved notch (its interior vertices are an exact
contiguous run in that ring), the matrix's notch is filled, the lens's `layerIds` fold into the
matrix, and the lens region is dropped — one simple sand mass, no seam, no lens outline. A lens
enclosed by a DIFFERENT lithology (a real interbed) is never same-formation, so it stays a lens; the
pass is inert (CS1 golden byte-identical) unless a genuine same-litho same-body carved lens exists.

## Narrowed top band + cross-lithology seam (owner ruling 2026-09-07)

Three coupled parts, from the installer #22 dogfeed of the worked example (Cross-section 2,
GEO-19/081-S5 sand top hand-tied to GEO-61/2891-C silt top; and Cross-section 1 gap 1 of the
dev project, a B4 silt top tied to a B6 silt top). Owner's words are quoted; pinned in
`partitionFillV2/ownerRulings.test.ts` (Ruling 5) and `partitionFillV2/firstUnitTopBand.test.ts`.

* **Part 1 — narrow the implicit top band.** *"removing top tie = narrow, only when the user
  has tied the top, no extra top tie is emitted; if only left top is bound no left top is
  emitted, if only right top is bound no right top is emitted, if both are correlated, then
  both are not emitted."* The 8d-rev implicit top-band tie is dropped for a gap once the user
  hand-ties EITHER column's FIRST unit top across that gap (`effectiveCorr.gapTopBandSuppressed`
  → `topBandTied` false for the gap's first units), so each first unit falls back to its own
  2/1/0 outcome instead of a top-band flood: *"above my tie, on the CPTs nothing can flood.
  There are no ties to the borehole column, so they all become lenses and are closed loops ...
  except for of course the unit right above the top tie that onlaps also."* The ground line
  (`surface:gi`) is STILL emitted — it is the physical top boundary the vacancy closure closes
  against (dropping it leaves the wedge above a narrowed first unit unbounded, a hole); only the
  implicit top-band TIE is narrowed, never the ground line.
* **Part 2 — a cross-lithology TOP-to-TOP tie draws a vertical seam.** *"a tie whose two layers differ in
  lithology makes both units band along the ties and meet at a vertical seam at the column."*
  In `emitEnclosingFlood.closeInterval` the coarse `bandFids` (formationId) guard is lifted for
  a `crossLithoDeclaredMeeting` — a tie whose left endpoint IS this interval's left enclosing
  unit and whose right endpoint IS its right enclosing unit, the two differing in lithology,
  **and both endpoints on the TOP side** (`leftSide === 'top' && rightSide === 'top'`).
  The test is the TIE's own two layers (DIRECT unit-index match, never the shared-contact
  derivation `tieLandsOn` gives a same-litho tie landing on the unit above it), so a real
  same-formation band is untouched and the geotech jump-tie run (H9) is not seamed. The top-to-top
  restriction (owner 2026-09-08, installer #25) keeps the seam OFF a MIXED base↔top tie — a bottom
  tie into a shallow test's TD (plain 2/1/0 territory, see "Below a shallow test's TD"): lifting the
  guard there drew a mid-gap fence that SPLIT the bottom-tie onlap (its
  facing half vanished), opening a coverage hole under a bottom-test correlation (dev CS1 gap 18
  GEO-23/125-S7 → S6, gap 19 S6 → S5A; owner CS2/TS4 at the deepest TD). Litho pass
  only (`allowFirstUnitTopSeam`, threaded `computeSectionFillV2 → emitCurves → emitEnclosingFlood`);
  the geotech constructive fill draws its own seams and never reaches this tiler. Pinned in
  `partitionFillV2/bottomTieRenderHole.test.ts` (*"no gap in the render under a bottom test correlation"*),
  a permanent band-capped-hole scan over every gap of both real fixtures.
* **Part 3 — the clay onlaps, the units above are lenses, and the wedge above the tie stays EMPTY.**
  *"the clay onlaps, the sand above is a lens on cs2. 2/1/0 rule again, that sand has no ties. it
  should be empty."* The unit whose base is the tied contact onlaps the tie to mid-gap (the ordinary
  1-tie onlap); every unit ABOVE it with no ties is a closed lens pinching INSIDE the gap; and the
  space above the tie past those lenses is left EMPTY (white) — no far litho, and no vacancy fill,
  floods it. Two mechanisms make the wedge empty where the facing borehole is SHORT (its ground below
  the units the tall test logged):
    - ``emitContinuation.terminationRun`` SPLITS the 2026-08-21 "a column that read nothing is not a
      boundary" law. A facing column whose GROUND is below the unit — the unit sits ABOVE its collar,
      only sky there — is now a BOUNDARY: the unit pinches its ordinary lens TOWARD it (not across the
      blind short test to a far tall one). A column that read nothing because the unit is BELOW its TD
      (it may carry the unit deeper) STILL crosses to the first reading test.
    - ``emitSurfaceCurves`` skips the ground-line (``surface:gi``) closing for exactly that shape (a
      hand-tied first-unit top AND a unit entirely above the facing collar), so the wedge above the
      tie is left untraced (empty) instead of ``labelFaces`` stamping it with the tall test's shallow
      lithology. Every other gap keeps its ground line (an interior minority under a same-height
      converging band is byte-identical).
  On the same-lithology case (dev CS1 gap 1) the two silt tops band (no seam) and the B6 clay onlaps
  halfway — *"just follow the 2/1/0 rule ... it onlaps on that correlation band halfway"* — with the
  white wedge under the ground accepted as the unlogged top of the short test (owner, approved).

The CS1 golden legitimately moves where CS1's first-unit-top ties reshape the litho the geotech
fill is framed on (the B6 clay onlaps to mid-gap; a cross-litho tie splits a silt band) — a
downstream reshape, not a change to the geotech engine (H9 unchanged, no new holes/overlaps).

## A first-unit lens facing a short borehole closes at its own band (owner ruling 2026-09-08)

Installer #25 dogfeed of the worked example (Cross-section 2, the top silts of GEO-19/081-S5 and
GEO-20/034-S2 facing the short borehole GEO-61/2891-C). Owner: *"still unhappy with those upper
silts on cs2, why do they droop down and not lens horizontally? 0 correlation to the right side for
the left test, so emit lens at mid band level."*

A FIRST (top) 0-tie unit takes the watertight SURFACE boundary lens (`emitBoundaryLens`), whose apex
rides the top-band polyline — which slopes down to the FACING collar (its first-litho top). When the
facing is a SHORT borehole whose collar sits far below the unit (the `terminationRun` short-facing
boundary), that ride dragged the apex DOWN past the unit's own band (measured: the +5.53..+5.29 silt
apex rode to +3.76, the ground line to the +1.60 collar). The fix (`emitBoundaryLens`, surface branch):
when — and only when — the ridden apex would fall BELOW the unit's own base, lift it to the unit's mid
band level so the lens closes HORIZONTALLY at its own level, a closed loop like every other 0-tie lens;
the space vacated past it is the enclosing flood's (empty above a hand-tied short-collar tie, ruling 5).
A strict NO-OP when the apex already sits in the band (an ordinary near-flat ground line — a facing
collar just below the base, e.g. dev CS2 gap 15, is byte-identical) and never applied to a user
free-draw override or the TD boundary lens. Pinned in `partitionFillV2/ownerRulings.test.ts` (Ruling 6).

## A top-tied band member reaches under a shallow neighbour's TD (owner installer #37, 2026-09-14)

Owner (Cross-section 2, gap 0, between borehole GEO-99/201-B1 [TD -4.32 mTAW] and CPT
GEO-25/021-S23): *"the small black rectangle is still there. it sits left of Sand(f)-D top boundary
between -4.4 mtaw and -4.8 mtaw."* The strip -4.32..-4.69 mTAW was an unfilled HOLE in the litho
partition — on the geotech axis the empty strip's frame drew as a near-black rectangle
(`lithoOutlineEdges` strokes the two single-owner horizontal edges); on the litho axis it was the
hole itself.

Cause: S23's ZAND unit (-2.52..-4.69) is TOP-TIED to B1's ZAND across the gap (a band), but it
STRADDLES B1's TD (-4.32) — top above, base below. Its above-TD portion bands but caps FLAT at the
shallow TD (`emitEnclosingFlood`'s shallow-TD floor `flood`); its sub-TD sliver [-4.32..-4.69] was
owned by NEITHER the band NOR `emitSubTdLenses` (which only took units ENTIRELY below the facing TD).
The deeper ZAND(GL) unit's sub-TD lens reached only up to -4.69, so the strip stayed empty.

The fix (`emitSubTdLenses`, the straddle-sliver branch): a deep unit that straddles the facing TD,
is TOP-TIED to the facing column (a declared band/onlap continuation — 2/1/0), has an untied base on
this side, AND whose strip is a GENUINE hole fills its sub-TD sliver GAP-LOCALLY with a flat
`emitContinuation` band to the facing column, so the deep sand continues under the shallow column's
TD to meet its base and the litho outline dissolves (same soil on both sides — no black rectangle).
Which unit takes it: the SAME formation as the band above it (the tied deep sand continuing), so
`mergeTouchingBodies` welds them into one mass, base at the ZAND(GL) top.

Four guards, each real-data-proven, keep it from over-firing:

* **Untied straddlers stay pinches** (2/1/0 — a lone marginally-deeper unit is NOT a declared
  continuation): CS1 gap21's 0.04 m untied straddler at two tests 0.2 m apart is skipped (its tiny
  fill only slivered a neighbouring lens).
* **Only where nothing beyond reads the strip** (`terminationRun` in the facing direction returns
  `reads=false`). This is a RESTRICTION on the sliver, never a source of fill: with it lifted on
  2026-10-04 the sliver painted a flat glauconitic band across worked-example Cross-section 2 gaps 1-3
  that no tie closes, so it keeps the sliver to the edge case the owner asked for (CS1 gaps 14/15
  stay skipped).
* **Gap-local, not the cross-section `terminationRun` continuation**: a near column only MARGINALLY
  deeper than its facing (TS4 gap0: 1411-B8A 0.04 m below GEO-20/034-S5's TD) must not paint a
  section-wide sliver across the next gap's bottom-tie wedge.
* **Not the bottom-tie config** (`facingTdTied`): a deep unit tied to the facing TD there also
  looks like a straddler, but its halfway onlap owns that wedge and the rest is the no-data void by
  ruling (2026-09-23).

Pinned in `partitionFillV2/we2Gap0SubTdStrip.test.ts` (no strip under B1's TD, the strip is ZAND, and
the litho frame draws no closed black rectangle there) on the committed CS2 decode.

## An enclosed lens keeps its own base below the substrate floor (2026-09-23)

The 2026-07-26 clamp (`enclosedLensDiamond`) lifted a lens's base to the gap's substrate floor (the
shallow TD); on a 0.93 m peat whose base lay 0.86 m below S13's TD that left a 7 cm sliver, and the
clay band painted the rest. The diamond now uses the lens's real base. Two things had made the clamp
necessary, both fixed at their source: a closing curve registers cuts only at EXACT vertices
(`splitSegments`, debt #271), so a flank crossing the floor mid-segment dead-ended and was stripped —
`emitOne` now puts an explicit vertex on the flank at the floor crossing, so the floor splits the
diamond into two faces; and `labelFaces` disqualified any face touching a `flood` curve from being
the lens's own — the BARE shallow-TD floor (`flood<gap>`, the one flood curve with no label) no longer
does, so both pieces read the lens. A labelled flood (the lone-pinch vacated wedge, the sweep wedges)
still disqualifies; the floor still anchors band classification. The adopted-stack scene
(2026-08-19, "a band the far test read in one piece stays one piece") now reads its SF on both sides
of the floor, which is the stronger form of that ruling. Pinned in `ownerCs1SubTd.test.ts` (the peat).

## Stratigraphy stage: a unit absent on the next test pinches out there (owner ruling (b), 2026-10-14)

The Stratigraphy stage (geological axis) does NOT use the partition engine: it paints one band per
formation from its own top polyline down to the first older formation picked at that X
(`components/sections/formationFillBands.ts` -> `utils.buildFillBand`), padded 20 m flat past the
outermost pick. Worked example, GEO-25/021-S45 -> GEO-07/181-S1: Merelbeke on S45, Quartair directly
on Tielt on S1. The flat pad stopped Merelbeke 20 m past S45 while the Quartair base ran straight to
S1's Tielt top, so the triangle between them was empty. Owner: *"the wedge is Merelbeke"*.

* When the next interpreted test beyond a formation's outermost pick carries a pick of an OLDER
  formation, the formation is absent there: its top runs to that test on the first older top picked
  there, so the band closes to zero thickness AT the test under the overlying unit's base, and the
  overlying unit keeps its own base. Symmetric: a unit that appears on the next test grows from zero
  at the previous one.
* No older pick on the next test (it stopped above the unit), or no test beyond: the flat pad stays.
* A formation missing on a test BETWEEN two of its picks is still interpolated straight across it
  (unchanged).

Pinned on the real geometry in `components/sections/formationFillBands.test.ts` (fixture
`__fixtures__/worked_example_s45_s1_merelbeke_2026-10-14.json`).

## The arbiter — the CS1 real-data gate

`partitionFill.cs1void.test.ts`, run with `CS1_GATE=1`; regenerate the input
first via `scripts/extract_cs1_partition_input.py` against the dev DB.
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
