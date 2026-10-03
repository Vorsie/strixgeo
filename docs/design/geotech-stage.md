# Geotech Stage — current design

> Current state only. The 2026-06-24 "connected NAD-band section render" and
> the 2026-07-07 fraction-space refinement are both SUPERSEDED by the direct
> partition (section 2 below).

Sequencing decision (owner, 2026-06-29): **the geotech subdivision stage is
worked out FIRST**; the provenance-based parameter-suggestion slice is a noted
future MVP candidate revisited only after this stage (rationale in
`CLAUDE.local.md` → Active Focus).

## 1. Subdivision (shipped 2026-06-24, develop)

Body-centric Option A: `SubdivideAllBodies` use case — policy-B aggregator +
TIN split-surface + geotech `litho_layer`/edge/`BodyOrm` materialisation via
the litho machinery, **same-position-edges-only** to prevent NAD-class
over-merge. Surface: "Subdivide all bodies" toolbar verb +
`GeotechnicalCanvas` + `GeotechnicalInspector` roster.

Real-data validated on `test.strix`: 14 sections, 273 body groups, 20 %
consistent-split / 73 % one-class / 7 % borehole-only.

Deferred: e2e spec/fixture (F6); `parameter_group` analytical layer (#223,
Slice 3, waits for lab-test import).

### 1b. No silent upgrades — the standing sliver (owner ruling 2026-08-11, audit F05)

A sub-minimum seam is absorbed into a neighbour only if that neighbour's class
SURVIVES the union's re-derivation (weaker neighbour tried first, as always).
When every absorption would come out denser — the owner's case: a near-minimum
matig band with a near-minimum very dense seam and nothing else in the unit —
the seam STANDS as its own band below the minimum thickness, and the engineer
decides with the shipped band verbs (the merge sheet warns about the class
pull). His words: *"this would make a matig zand jump to a dense one, i don't
like this, in this case i'd rather get a smaller sliver and make the user
choose."* Going LOOSER stays automatic — that is the conservative direction the
weaker-neighbour rule exists for, and the harmonic statistic's documented bias.

To make such seams visible to the merge at all, the cut persistence is HALF the
minimum thickness (a 0.34 m coherent run cuts at the 0.35 m setting; isolated
spikes stay noise for the statistic). Pinned: CMD1–CMD4.

### 1c. Unread ground is not silently claimed (owner ruling 2026-08-11, audit F32)

An unread head or tail of a litho segment LONGER than the minimum layer
thickness becomes its own needs-review band; shorter gaps stretch to the
boundary as before. No machine inference across columns fills it — the owner's
completion of the ruling, verbatim: *"the user will have to correlate the
packing density and make a good decision, the 2/1/0 will stand in geotech stage
also."* The engineer correlates the packing bands; the fill follows the same
2/1/0 contact-correlation rule as the litho stage. The tail starts one sample
spacing below the last reading, so it is genuinely sample-free and neither the
re-derive loop nor the edit path can classify it from the orphan boundary
sample. Pinned: UC1–UC3.

## 2. The hierarchical fill — densities within lithos, by CONSTRUCTION

> **THE LAW** (owner, 2026-08-19, verbatim — the whole specification):
> *"If litho has no ties emit lens, if litho has one tie, follow tie - if litho
> at other end of tie has same litho and packing density emit nothing. If it is
> a different litho emit an onlap, if a litho has two ties, follow ties and
> check litho and packing density on the other end. if it is different then
> vertical line in the middle, else no emit. Fill = emit lenses first, then emit
> onlaps, then fill in the rest with the dominant lithology (should be the same
> if all onlaps and lenses are emitted). Fill sweep if a lens is touching a body
> with same litho and packing then lens disappears and it becomes one body, in
> the renderer and in the database."* · *"a few very simple rules that can be
> written in 50 lines of code when bare."*

...and the TERMINATION CLAUSE that governs every construct it emits (owner,
2026-08-20, on the ground a construct painted over at the facing test):

> *"an onlap can't paint over ground near test itself, it terminates at 0.5
> Distance approximately."*

Every construct owns at most its OWN HALF of the gap; the far half belongs to
the far test. The one exception is a band that emits NOTHING — the mass at the
other end of its ties is the same litho and packing, so its ground runs the
whole way and the merge welds the two into the one body the law asks for. Held
by `geotechOwnColumnEdge.diag.test.ts` (`OWN_EDGE=1`): sampled a hair into each
gap beside every banded column, at the middle of each of that column's own
bands, the paint is that band's own class — **0 of 1120 wrong** (44 before).

It lives in ONE bare module, `constructive/emitKernel.ts` (72 lines, 27 of
them code): the emit table, the fill order, the absorb predicate. Everything
else is plumbing that DRAWS what the kernel decides.

**The construction** (`utils/geotechHierarchicalFill/`):

1. Compute the litho partition (the frame) on the litho columns + approved
   litho edges.
2. Group litho units into FAMILIES (`families.ts`); pair each band with the
   unit it subdivides by geometric containment (`bandParents.ts`). A packing
   tie whose ends sit in different families is KEPT — each end counts at its
   own in-family contact (the 2026-08-21 tied-contact ruling) — and counted
   as a statistic only.
3. Per family, per gap: **LINES → LOOPS → FILL → MERGE** (`constructive/`).
   * **LINES** (`constructs.ts`) — the kernel is asked per band. Ties are
     counted on a band's CONTACTS (a contact is shared, so the clay-top tie
     under a sand band is that sand band's bottom tie), and the far end of a tie
     is **the band on the SAME SIDE of the contact over there** — his own worked
     example: *"top dense sand has one tie, follow the tie, it is the same litho
     and packing density don't emit onlap"*. Lens = the 0-tie diamond (reach
     `LENS_PINCH_FRACTION`, halved while it would cross a tie — ruling 8t);
     onlap = the tied contact follows its line, the untied one holds its own
     level; vertical = the two tie lines plus the line in the middle; nothing =
     no line at all. Crossing ties stay a hard conflict (owner Q4).
   * **LOOPS** — every line plus the family's litho cover into ONE planar
     arrangement, so no emission order exists to depend on.
   * **FILL** (`fillGap.ts`) — each loop asked once at an interior point, in his
     order: lens, then onlap, then the vertical's own side, then the DOMINANT
     mass of the ground. The dominant is taken among the masses that drew no
     shape of their own, which is exactly his *"(should be the same if all
     onlaps and lenses are emitted)"*.
   * **MERGE** (`mergeFaces.ts`) — the fill sweep: faces of one soil and one
     packing class that touch weld into one region, so a lens touching a body of
     the same mass disappears into it. The welded region carries every
     contributing band's `layerIds`, which is the evidence the body recompute
     reads.
4. **Column rule per family run:** a frame column carrying a family litho unit
   but NO band of it BLOCKS (its cover reads "correlate me" — the 2026-08-15
   ruling); a column carrying no unit of the family is EXCLUDED and the run
   spans it.

**Mass identity is the litho UNIT + the CLASS, never the formation row**
(owner 2026-08-21: *"yes one mass one body"*; owner 2026-10-03: *"a zand and
zand/matig siltig are 2 different lithologies, never weld those"* — the class
key `UNIT|SOIL|CLASS` leads with the packing row's `source_litho_formation_id`,
so a NAD-6 ZAND and a NAD-6 ZAND (SL:M) are two masses, two bodies, and their
contact keeps its seam). The subdivide keeps one geotech formation ROW per
`(nad_class, litho parent)` — the geological parent is a live-derived LABEL, not identity (R1, owner 2026-08-31, debt #278) — so a litho unit spanning a geological boundary keeps ONE row
instead of one per geological band. Everything that compares masses therefore translates row →
class first: the fill takes `packingClassOf` (built by
`geotechHierarchicalFill/packingClassOf.ts` from the formations' soil + class;
threaded from the overlay, the voxel build and the fence so render = build =
one identity), and the gates decode with the same map. A formation with no
class (a skeleton band) keeps row identity — two unknowns are not known equal.
Before this rule, every same-class tie across a geological boundary read
"different mass": both sides emitted onlaps, met at a mid-gap vertical seam
(the owner's "bug with vertical lines", 8 seams on CS1), and the DB body split.

**A class-change seam splits the gap — the nearer test owns each half** (owner
2026-09-08, installer #25 dogfeed: *"it should emit a vertical seam in the
middle because the packing class changes, this is an established rule."*). Two
SAME-lithology bands of DIFFERENT class, tied on both contacts, each emit
"nothing" (`emitKernel`) and reach into each other; the meeting is the vertical
seam at mid-gap (`seamMeets`). The seam LINE was already drawn, but a THIN
top-tied band whose quad PLUNGES below its own flat base lost the whole quad to
the thicker facing class: `fillGap`'s `constructOwner` tiebreak preferred the
class whose OWN FLAT extent contained a drooping face sample (the thin class
drew nothing while the thick one flooded — CS3 gap 4 VEEN class 29 vs 30, TS11
gap 0 SILT class 16 vs 15, both flagged as GEOTECH_210 `nospan`). The fix adds a
NEAR-SIDE priority to `constructOwner`'s spanning tier, applied ONLY when a
cross-column different-class spanning meeting exists: the band whose own column
is on the sample's side of the seam wins, so each class owns its half. The
same-column disambiguation (S16c) and every single-spanning gap stay byte-
identical. Pinned in `geotechHierarchicalFill/classChangeSeam.test.ts` against
the two real cases; the GEOTECH_210 gate then reads all-zero.

**The fill sweep crosses families of one litho unit** (owner ruling
2026-08-21, option 3 of the `gap0_lens_dissolve_choice` page — *"option 3
ofcourse"*): a closed lens touching a same-class mass of the SAME litho unit
from ANOTHER litho family welds into it, **no tie needed** — the one deliberate
exception to "ties define it". It never crosses two litho units (owner
2026-10-03): the class key carries the unit, so an admixture variant's lens
keeps its own outline (`hierarchicalFill.test.ts` H12b; H12c is the same-unit
control). The litho stage
closed such a lens with no litho tie (its own family), so the per-family merge
can never reach it; `crossFamilyWeld.ts` runs the same weld over a whole gap's
classed faces keyed on the class, pre-splitting shared boundaries the two
family runs state at different granularities. Geometry never moves — only
seams dissolve and layer ids combine. The DB half rides the body-recompute
EVIDENCE: `mergeTouchingBodiesWithGroups` takes `identityKeyOf` (the class
key) so touching same-class rows state one connectivity fact, and the
resolver's class filter accepts it. His S10|S6 proof scene: the two SILT-SF
interbeds on S10 dissolve into S6's spanning SF silt — one region, three
layer ids, one body after recompute.

**The database half of the fill sweep** (`resolve_litho_instances`): a geotech
body is one soil AND one packing class. `LayerNode.packing_formation_id` marks
a band as classed; `packing_nad_class` carries the CLASS the union compares —
where both ends carry one and they differ, the edge does not union; where
either is unknown, the row comparison stands. A litho layer passes neither, so
the litho model is untouched. Pinned by six unit tests; the DB-level pins live
in `tests/integration/api/test_geotech_body_mass.py` (run via the wrapper).

**Structural invariants**, held by the committed gate
`geotechHierarchicalCoverage.diag.test.ts` (`HIER_COV=1`, PIP sweep over all
14 real sections): **WRONGSOIL 0 · OVERLAP 0 · HOLE 0 · outside-frame 0**. A
geotech band can never paint outside its parent litho soil geometry — the
cross-soil vacancy-flood family is impossible, not patched. The cover is an
INPUT to the arrangement, so the clip is structural: `frameClip.ts` (the
per-family post-clip) and `clipPartitionToLithoFrame.ts` (the relabelling
post-hoc clip before it) are both DELETED; the geometry primitives live on in
`frameClipGeometry.ts`.

**No holes in the model — the geometric safety net** (`fillGeotechHoles.ts`,
owner installer #36 dogfeed, Cross-section 2: *"why is there a hole here on cs2
between s1 and s2, the litho doesn't have a hole there?"*). The raster HIER_COV
gate samples 60×60 per gap and is blind to a thin crack; the GEOMETRIC audit
(`geotechHoles.diag`, `GEOTECH_HOLES=1`) sees it. The #36 case: S1's deep SILT
unit is an enclosed litho lens (a ZAND lens carved above it) whose band looks
0-tie but carries a SHARED-CONTACT base tie (the ZAND-below's top↔top edge
lands on the silt's own base), so `emitFor` returns an ONLAP whose apex falls
EXACTLY on the litho unit's own base line; the arrangement then fails to trace
the sub-TD onlap wedge and a 19.5 m² triangle goes unpainted directly under a
correlation band. A post-pass runs AFTER the constructive fill + weld: it
overlays the litho frame with every painted region (same geometry as the audit,
grazing tolerance `EDGE_TOL` 3 mm) and closes any litho-covered face the fill
left empty with the packing class the MODEL already holds there (the geotech
band whose own litho parent unit is the face's unit and whose depth window
contains it), or the `lithoFallback` "correlate me" hatch when no band of that
unit reaches the depth. It never overpaints, never crosses soils, and is a
strict NO-OP on a section the fill already covered (CS1 golden byte-identical).
Pinned by `we2FillNoHole.test.ts` on the committed Cross-section 2 fixture. This
is a robustness layer, NOT the root fix for the sub-TD-onlap arrangement case
(debt #283, the emission rewrite from the 2/1/0 oracle).

**Render = build = one path.** `PartitionFillOverlay` renders the
hierarchical fill on the geotech axis (litho axis untouched);
`buildVoxelRequest` / `makeVoxelRequestBuilder` and the 3-D fences take the
same frame arm. The litho partition still draws as dark outlines on top, now
SOIL-DISSOLVED (`utils/lithoOutlineEdges.ts`): only edges where the soil
changes — or the frame's outer envelope — draw; internal seams between
touching same-soil litho units are machine anatomy and dissolve (owner
dogfeed 2026-08-18: "weird ass horizontal black lines without meaning to the
user"). Fallback faces render litho-coloured beneath the packing fills; the
"correlate me" hatch marks un-classed litho ground.

**Measured** by three ratchets on the real model, all re-frozen 2026-08-19 on
the constructive fill:

* coverage (`HIER_COV=1`): CS1 classed 92.4 → **99.2 %**, and every section
  holds WRONGSOIL/OVERLAP/HOLE/outside-frame at 0. Region count falls with the
  merge (CS1 764 → 411 faces);
* litho consistency (§7): **every one of the 14 sections improved** — CS1
  97.9 → 98.7 %, worst section 98.6 %, and every remaining mismatch bucket is
  soil→(void) raster hairline, never wrong-soil paint;
* 2/1/0 conformance (`GEOTECH_210=1`) — **balloon / missing / nospan /
  overreach all ZERO on all 14 sections**, and the gate counts ties the way the
  FILL counts them or it audits a law the constructor was never given: a tie
  whose two bands sit in different litho families is dropped by both (#273's
  cross-family case then audits as the lens the render draws); a tie that JUMPS
  a column the family has no bands on is the run's own adjacent tie (the
  2026-08-15 EXCLUDED ruling), and it is credited to BOTH bands adjoining the
  contact it lands on, not to the layer the row happens to name. A fourth check,
  `overreach`, audits the termination clause on the construct surface — measured
  on the RUN's middle, and inert for a band that emits NOTHING, whose twin is
  the same mass. Negative-controlled: a construct dropped 2 m below its own
  level gives CS1 balloon 18 / missing 23 / nospan 5; a lens reach widened to
  0.95 gives overreach 12 / 173 / 92.
* the retired reading of that gate: model-wide balloon 81 → 29, missing 103 →
  63, nospan 6 → 5. The survivors are attribution, not paint: a merged mass
  carries every contributing band's `layerIds`, so the gate measures a thin
  member against the whole mass (balloon); a 2-tie band facing a DIFFERENT
  class reaches the vertical termination, not the far column, which is the
  owner's own S5 ruling (nospan); and one Tie-section-11 balloon (0 → 1, the
  only number that grew) is a band following a litho line drawn on its SHARED
  contact, which the gate attributes to the neighbouring unit only.

**Litho geometry stays authoritative in the backend too — complete tie
restatement.** Every direct litho tie restates onto the packing bands that
own the same contact surfaces (`application/geotech_edge_derivation.py`): the
topmost pair is FORCED regardless of class (`aligned_pairs_with_forced_top`),
and a litho base↔base bottom tie restates as a base↔base edge between the two
deepest bands. Both are born accepted — they carry the litho approval down
(§4a). `DivideBoreholes` re-runs the shared edge derivation after
borehole-band fill (Phase 8.5) and re-resolves `body_id`, so
borehole-mediated restatements appear without a manual step-2 press.

**A LENT class never changes the receiver sand's NAD family** (owner installer
#36 dogfeed, borehole GEO-07/182-B2: *"this sand on B2 somehow got an
admixture, while it did not have that in the original litho"*). A borehole band
has no qc, so `DivideBoreholes` LENDS its packing from the flanking CPTs; the
donor CPT's stored NAD class carries the DONOR'S own column — clean (ZAND 5-8)
vs silt-/kleihoudend (ZAND 9-12). Copied verbatim onto a CLEAN-sand borehole
flanked by silty-sand CPTs, the lent class sat in the with-admixture column and
the band rendered `ZAND(f)`. The rule (owner): *"a lent class never changes the
sand's family"* — the lend carries only the PACKING LEVEL (los/matig/dicht/zeer
dicht) and lands it in the RECEIVER'S own column; the receiver's litho
composition is never rewritten. `nad_classifier.remap_class_to_variant` re-maps
a class to the target variant's column at the same level index (secondary dicht
11 → clean dicht 7), and `DivideBoreholes._plan_borehole_bands_litho_confined`
applies it (`receiver_variant` from `resolve_variant` on the borehole unit's own
soil + admixtures + `nad_admixture_choice`) at every donor-class source — the
flank fill, the tie-informed fill, the section-geometry fill and the body_min
statistic — so coarsen/merge/floor all reason in the receiver's family. The CPT
press (`SubdivideAllBodies`) classifies from its OWN qc + own unit variant, so it
never lends across families and is untouched. Pinned by
`test_geotech_lent_class_variant.py` (LV1–LV5); the effect is a DB
re-materialisation, so it appears on the next Divide-boreholes press.

Since the donor pool is now confined to the receiver's own litho UNIT (§8-0, the
2026-09-14 unit gate), a clean-sand borehole's donors are clean-unit CPT bands
whose stored class is already in the clean column, so `remap_class_to_variant`
is a no-op on the donor path — it survives to keep the variant-aware TABLE FLOOR
(`loosest_class_for(soil, admixtures, variant)`, §8-0b) landing in the receiver's
column when neither flank carries the unit. The LV3/LV4 behaviour is unchanged
because those pins drive the section-geometry path with hand-built `cpt_segs`,
which the unit gate does not touch.

## 3. Connecting geotech units (built 2026-06-25, develop UNPUSHED)

All four phases shipped (~31 commits, subagent-driven, two-stage-reviewed):

* (A) auto rule = **NAD-class LCS match within a litho body**
  (`derive_geotech_edges_from_litho` + pure helper
  `domain/services/geotech_packing_edges.py`). Since 2026-08-06 the LCS
  reconstruction takes matches as EARLY (shallow) as possible: when
  equally-long alignments exist, the tops-together pairing wins — it is the
  litho tie restated (§4a), and the old bottom-up traceback could tie a
  surface band to a deep band (the 2026-08-13 forced-topmost alignment
  removed this failure class for direct pairs entirely);
* (B) the render's band connectivity is the direct partition consuming the
  accepted edges (§2) — no separate connect module;
* (C) `ReSubdivideConfirmDialog` prompts before a re-subdivide clears the open
  section's connections — and only when that section has bands to lose (§4);
* (C2) the **admixture NAD-family gate** (`useAdmixtureChoiceGate.ts`, walk22b)
  is the FIRST gate of a subdivide: a sand unit carrying a qualifying admixture
  (clayey / silty / **glauconite**) with no stored `nad_admixture_choice` opens
  `GeotechAdmixtureChoiceDialog` before the subdivide runs. It is the SAME hook
  behind BOTH entry points now — the Geotech-stage **Build** preflight AND the
  Sections-toolbar **Subdivide** press — so the two cannot ask differently (the
  Sections Subdivide silently reused the last choice before walk22b);
* (D) manual "Correlate packing" gesture reusing the litho correlate machine
  pointed at the geotech model (`useGeotechPackingCorrelation.ts`,
  `requestGeotechLayersRefetch` nonce, toolbar verb). The client-side
  same-class/same-litho-body guard was dropped per the R1 ruling (tie freely,
  like litho); the surviving guard is server-side —
  `domain/services/litho_body_guard.py` refuses only ties whose bands share
  no adjacent litho body, and the refusal toast names both judged bands.

META-RULE real-data verified: 226 auto edges, 0 cross-class, 0 null-class.
See `memory/project_geotech_stage_body_centric.md`.

## 4. Hand editing of packing sub-bands (2026-08-01, extended 2026-08-08, develop UNPUSHED)

### 4-0. Set a BOREHOLE band's class by hand (owner ask 2026-08-18)

A borehole band's class is donor-extrapolated (§8), never measured, so the
engineer's judgement outranks it — the workflow half of the editing-section
ruling: the donors follow the section he edits, and where he still disagrees
he right-clicks the band and picks the class. `POST
.../geotech/bands/set-class` (`SetGeotechBandClass`): repoints the band at the
find-or-create NAD formation, stamps `source='manual'` + `confidence='high'`,
re-judges ties through the standing flag-not-drop machinery. Geometry never
moves. A CPT band is REFUSED (its class is measured — the inverse of ruling
A's `require_cpt_anchor`); a class outside the band's soil family is refused
naming both. The desktop menu offers the family only
(`nadClassFamily`), commits DIRECTLY (no consequence sheet — the outcome IS
the choice), pushes undo (set back to the previous class), and deliberately
does NOT amber "Divide boreholes": a re-divide REBUILDS every borehole band
and erases hand classes, so the pipeline's shape is one divide pass, hand
fixes after the last press. SC1–SC3 at the DB; the overlay rules suite pins
CPT-never/borehole-only and the family list.

Owner #35 (2026-09-13) restructured this menu: the packing classes crowded the
verbs below the fold, so they moved behind ONE keyboard-navigable
"Pakkingsklasse / Packing class ▸ (current: …)" submenu row and the VERBS now come
first — including the new "Band hier splitsen / Split band here" (§4-0-split).
The class list, the current-class tag and the foreign-class stranger row are
unchanged; only their home moved into the submenu.

### 4-0-split. Split a BOREHOLE band, keeping the class (owner #35, 2026-09-13)

The owner found no split button on a borehole band. A borehole records no qc, so
the split cannot re-derive — it KEEPS the original band's class on both halves
(`SplitGeotechBand`, the borehole branch: no `require_cpt_anchor`, both halves
take the target band's class, `source='manual'`). "Split band here" splits at the
right-click depth and commits DIRECTLY (no consequence sheet — a kept class has
nothing to preview), unlike the CPT split's armed placement. It is undoable: undo
re-merges the two halves, and `MergeGeotechBands` keeps the SURVIVOR's class on a
borehole (the split's inverse), so the original band comes back intact. The merge
is reached only by that undo — the borehole menu offers no merge affordance.
GB17/GB18 pin the DB round-trip; the overlay suite pins the menu.

The geotech axis is view-only **except** for the band-edit verbs and the one
contact gesture in §4c. Everything else stays shut: contacts on this axis cannot
be created, copied or deleted, and the only drag they accept is the snap in §4c
(`SectionsCanvas.geotechViewOnly` pins that, and
`SectionsCanvas.geotechBandEdit` pins the hole's exact width). The verbs are
allowed because they do not move a contact — they go through their own
endpoints, which re-derive the NAD class from the qc over each resulting
interval. The surface is six verbs wide:

* **Split** — right-click a band → "Split band…" ARMS a placement: the boundary
  follows the cursor, clamped, with a readout naming the wall; a click puts it
  down.
* **Merge** — right-click the boundary strip between two adjacent bands →
  "Merge bands".
* **Drag** (owner dogfeed 2026-08-07 — "tried dragging, get pan hand") —
  LEFT-PRESS the boundary strip and drag. The press target is ONLY the thin
  strip: left-drag anywhere else pans the section, and a band-wide press target
  would swallow the pan. The gesture lives on window listeners with a live
  dashed line, amber at a pair limit; Escape / blur / release-outside cancel.
  Squeezing a neighbour below `max(0.1 m, 15 %)` of its original thickness
  (`absorbRemainderThresholdM`, hoisted from `lithoLayerMerge.ts` — the SAME
  rule the litho axis absorbs by) turns the release into the pair MERGE.
* **Ctrl+drag absorb-all** (owner 2026-09-25 — the litho ghost gesture of PR #53
  on packing bands) — with Ctrl held at the press the boundary is clamped to the
  LITHO BODY instead of its pair (`absorbAllChains` / `clampAbsorbAllDepth`), and
  every band it fully passes (or squeezes to the same sliver) is absorbed into
  the dragged band while the band the release lands in keeps its far edge
  (`absorbAllPrediction`). The release is ONE edit: `POST …/bands/absorb-run`
  (`AbsorbGeotechBandRun`, planned by `plan_absorb_run`) unions the run and moves
  the far boundary in one transaction, previewed over the FINAL intervals
  (ruling 6). Undo moves the boundary back and re-splits the survivor at each
  carried boundary, top down. A release inside the immediate neighbour is the
  plain move; the neighbour alone squeezed is the pair merge.
* **Remove band** — band menu → "Remove band (merge into band above/below)",
  offered exactly where that merge is legal (no affordance rather than a
  refusing item; a sole band in its body has nothing to absorb it). Zero
  dedicated endpoints: remove IS the pair merge.
* **Lens absorb** — a thin band of one class enclosed by two same-class hosts
  gets a passive amber badge (`pointerEvents: none` — it can't break panning)
  plus a band-menu item "Merge into surrounding band". Detection is the pure
  `geotechLensSuggestion.ts` (hosts share a non-null class, lens differs incl.
  null, both boundaries merge-legal, badge gated on the model's own
  `minimumLayerThicknessM` pref); accepting is ONE merge over the
  `[host, lens, host]` RUN (`MergeGeotechBandsRequest.band_ids`), so one
  consequence sheet and one undo step.
* **Move** commits through `POST …/geotech/bands/move` — an atomic two-row
  write (`upper.depth_base = lower.depth_top`), both rows re-derived and
  stamped `source='manual'`.

Every committed edit pushes its inverse onto the section undo stack AFTER the
write succeeds (`useGeotechBandEdit.pushUndoFor`): a move moves back, a split
merges its halves, a merge re-splits at the carried boundary AND RESTORES each
half's pre-merge class + source, a lens absorb re-splits at BOTH carried
boundaries. Row ids change across redo cycles; a closure-mutable id re-anchors
them (the litho delete-undo pattern).

The merge undo restores rather than re-derives because a re-derived re-split lost
a class the merge had changed or a hand class it never measured (owner #35: *"ctrl+z
... deletes the merge but doesn't restore the earlier packing suggestion"*). The
merge captures both bands' class + source and returns them
(`pre_merge_upper/lower_nad_class` / `_source`); the undo re-splits with a `restore`
payload, which `SplitGeotechBand` assigns verbatim instead of reading qc (SR1/MU1
at the DB, HK11 in the hook). The lens-absorb (N-run) undo still re-derives — out
of #35's reported scope; a latent class-loss there is a known residual.

Owner rulings driving the shape are recorded in full in `docs/debt.md` #227.
The ones that constrain the code:

* **Hard bounds (ruling 2, amended 2026-08-26).** A packing boundary moves
  freely inside its litho body and clamps at the edge; it never moves or
  crosses a litho contact. **The litho unit is the only wall.** One test
  enforces it, on both sides of the wire:
  `components/sections/geotechBandEdit.ts` (`clampSplitDepth`,
  `clampDragDepth`, `canMergeBands`) and `enclosing_litho_bounds` /
  `_assert_same_litho_body` in `geotech_band_reclassification.py`, which now
  agree — the server used to clamp tighter.

  **A geological contact is NOT a wall.** Owner, 2026-08-26: *"just drop the
  wall everywhere, user wil have to manually do it"*. The machine never cuts a
  packing band at a geological line and the editor never refuses one. Five
  clays in his project were cut by the wall; GEO-05/040-S3's clay 0.05–1.48 m
  was cut at 0.57 m into NAD 21 over NAD 21 — twin halves of one band, a pure
  artefact. The Tertiary case he DOES want divided (GEO-10/171-B9, the
  Kortrijk top at 18.00 m) is a hand split, and the split tool already exists.
  The geological overlay lines keep rendering on the axis: they are display,
  not structure.

  **What the geological model does instead: it LABELS.** Each band carries
  `source_geo_formation_id` as a derived attribution, following the A2
  precedent (`docs/domain-model.md`) — thickness-weighted majority, which for
  one interval is the unit containing its MIDPOINT. One rule, two writers:
  `GeotechBoreholeMaterialiser._geo_formation_at_midpoint` for the build and
  `geo_parent_for_interval` for every hand edit, so a re-subdivide cannot
  relabel a band the engineer just touched. A band that straddles a contact —
  now possible, and before this date structurally impossible — takes the unit
  it mostly lies in. `None` means the open shallow band above the first
  contact. Nothing is refused when the answer is ambiguous; the label is
  informational.

  The stamp is still read live-first (dogfeed 2026-08-12, GEO-23/125-S6), so a
  hand edit heals a stale stamp on touch rather than copying it forward.
  Residual, deliberate: bands NOT touched after a geology-axis contact move
  keep their stale stamps until an edit or a re-subdivide touches them. That
  now costs nothing but a label — it used to also move the clamp. Known
  asymmetry: `move_restated_contact` stamps from the build-time context rather
  than through `geo_parent_for_interval`, so the contact-drag verb does not
  heal the label the way the other four writers do.
* **The class is derived (ruling 3), locally (ruling 4).** The server re-derives
  each resulting interval from qc and re-scopes nothing beyond the edited
  column (GB9 pins it at the database).
* **Manual override always wins (ruling 5).** The consequence sheet
  (`GeotechBandEditDialog`) never disables its action, whatever the warnings
  say, and is deliberately not styled as an irreversible confirmation — focus
  lands on the verb, not on Cancel.
* **The statistic must not lie (ruling 6) and is selectable (rulings 7+8).**
  `geological_model.representative_statistic` (median / arithmetic / harmonic /
  geometric, default median) is read by the classifier
  (`representative_statistic.representative_qc`), by every band-edit planner
  (`GeotechColumnContext.statistic`) and by the warning — one column, so they
  cannot disagree. Changing it via `POST …/geotech/statistic` writes that ONE
  column and re-derives NOTHING; staleness is DERIVED
  (`classified_with_statistic != representative_statistic`, the #266
  compare-on-load pattern) and surfaces as a "re-run under <statistic>" tag on
  pipeline step 1 (`SectionsToolbar` "qc statistic" dropdown). The 3-D Build
  button does NOT amber on a statistic change — the bands are unchanged.
  **Choosable before the model exists** (owner 2026-08-15: *"i can't choose
  harmonic qc before first subdivide, that's friction we don't need?"*). The
  column belongs to a row step 1 has not created yet, so the pick is held in
  the renderer (`pendingStatistic`) and travels on the subdivide request as an
  optional `representative_statistic`, which the backend applies ONLY when that
  call CREATES the geotech model — a re-run keeps the model's own choice and
  `POST …/geotech/statistic` stays the one writer of a change. An unknown token
  is a 422, never a silent fall back to median. The renderer drops the pending
  pick the moment a model exists, so the label always reads what got built
  rather than what was asked for. (ST-SUB5/6/7 in
  `tests/integration/api/test_move_restated_contact.py`, whose scene classifies
  matig under median and los under harmonic — so the pin is on the CLASS, not
  just on the column; ST-PRE1–6 in `SectionsToolbar.geotechStatistic.test.tsx`.)
* **Flag-not-drop (owner 2026-08-07).** An ACCEPTED tie whose class match a
  hand edit breaks is FLAGGED (`review_reason='class_changed'`, the violet
  badge + Confirm-tie flow), never deleted; restoring the match self-heals the
  flag (GB7). An absorbed row's accepted ties are RE-POINTED to the survivor
  and flagged (`class_changed` on mismatch, else `ambiguous_band`); self-loops
  and true duplicates drop. Pending mismatches still drop. The toast names both
  counts. (`geotech_band_edit_helpers.py` — `edge_review_actions`,
  `plan_edge_transfer`, `revalidate_layer_edges`.)

  Three rules make "never destroys accepted work" hold literally, each added
  after the 2026-08-08 review found the case that broke it:
  * **A tie's identity is both endpoints AND both surfaces** (`tie_key`,
    mirroring the DB uniqueness triple). The same two bands legitimately carry
    a top-to-top tie and a base-to-base tie; keying on ids alone read the
    second as a duplicate of the first and deleted it.
  * **Accepted outranks pending at a collision.** When the survivor's
    same-slot tie is only a machine proposal, the proposal is withdrawn
    (`displaced_edge_ids`, deleted before the re-point so the write never
    races the constraint) and the engineer's tie takes the slot.
  * **An existing flag is never overwritten.** Re-stamping an
    `ambiguous_band` tie as `class_changed` would hand it to the self-heal,
    and the next restored match would clear a review the engineer never gave.
    A flagged tie keeps the flag it has until they act on it.

The view-only line is enforced by handler ABSENCE, not by an axis check inside the
overlays, so every gesture that needs a handler has to be gated where the handler is
passed. `SectionsCanvas` withholds `onCreateContact`, `onUpdateContactDepth`,
`onDeleteContact` and the batch pair (`onBatchUpdateContacts` /
`onBatchCreateContacts`, the multi-select and cross-column-copy drags) on this axis.
`ContactsLayer` in turn draws no affordance it has no handler for — its drag hit-strip,
its per-column band "Remove this litho unit" menu and its per-column "Add new suggestion
here" capture rect all gate on the relevant handler, because
`perColumnBandsFromContacts` is true on the geotech axis too and those surfaces
otherwise render over packing bands (`ContactsLayer.viewOnly.test.tsx`).
Borehole columns carry no qc, so the verbs that RE-DERIVE from it stay refused
there — the two PREVIEWS and MOVE (`require_cpt_anchor`; GB8). But since owner #35
(2026-09-13) a borehole band can be SPLIT and MERGED without qc, by KEEPING the
class: the split gives both halves the original band's class, and the merge keeps
the survivor's class (the split's inverse, so ctrl+z re-merges it back). The
desktop offers "Split band here" on the borehole band's own menu; the merge is
reached only by that undo. GB17/GB18 pin the two, GB8 the four that still refuse.

DB-level behaviour is exercised by
`tests/integration/api/test_geotech_band_edit_endpoints.py` (GB1–GB16, wrapper
only): the LL→FC mirror trigger on geotech rows, contiguity at commit,
formation find-or-create, the accepted-tie transfer + flag/self-heal, the
borehole refusal, locality, preview≡commit, the N-run merge, and the statistic
threading end to end.

⚠ **A subdivide deletes and rebuilds every band it reaches**, so it destroys
the hand splits and merges on those columns. `ReSubdivideConfirmDialog` warns
first and names the count of hand-edited bands (`source='manual'`); accepted
ties are carried across per §5. What is NOT carried is the hand band geometry
itself.

**The warning is scoped to the press** (owner 2026-08-15: *"We do however get
an overwrite popup on cs2 while there is no subdivision there yet. Now it seems
like it is warning that i'll overwrite CS 1"*). The trigger is no longer "a
geotech model exists" — it is "this press has bands to destroy":
`geotechBandsInScope` narrows `geotechLayers` to the bands anchored on the open
section's members (`inCorridorInvestigationIds`, the renderer's half of the
membership rule), and the dialog opens only when that is non-empty. It then
names the section and states ITS hand-edit count flatly, with no hedging and no
sentence another section's work could be read into. An empty scope — a fresh
section, or the first-ever run — goes straight through. (SB1–SB5 in
`geotechHandEdits.test.ts`, HS1–HS4 in
`SectionsToolbar.handEditWarning.test.tsx`, AC12–AC14 in
`ReSubdivideConfirmDialog.test.tsx`. HS4 pins the case that DOES deserve the
warning: a column shared with another section is at risk from either press.)

## 4a. Only RESTATED ties are born accepted (owner ruling A 2026-08-05, refined 2026-08-06)

Owner's rule, in his words: *"all ties are born unaccepted except those that
are already ties in the litho model."* A derived tie is born
``user_approved=True`` ONLY when it RESTATES a litho tie — its litho pair is
a DIRECT approved litho edge (not a bridged jump pair) and its endpoints are
the TOPMOST packing sub-band of each stack, so it joins the very contact
surfaces the engineer tied at the litho level. The litho approval already
vouches for exactly that connection; re-reviewing it would ask the same
question twice.

Refined 2026-08-13 ("start from the exact litho geometries"): the topmost
pair is FORCED regardless of NAD class (`aligned_pairs_with_forced_top` —
the class-matched LCS then aligns only the bands below it, which also
killed the absurd deep↔shallow class-matched proposals), and a litho
base↔base bottom tie restates as a base↔base edge between the two DEEPEST
bands, also born accepted. A skeleton (class-``None``) top or deepest band
still blocks its restatement. Because accepted cross-class ties are now
normal, the band-edit flag machinery fires ``class_changed`` only when an
edit BREAKS a match — a tie that never matched stays unbadged, and an
absorb transfers it as ``band_absorbed`` (`edge_review_actions` /
`plan_edge_transfer`, EA10/EA11/TR10).

Second refinement 2026-08-14 ("auto correlate is fine, its just a tool to
make the users life easier"): inside a litho-banded pair the big same-class
INTERIOR bodies — which the monotone forced-top alignment consumed or
skipped — are proposed as PENDING ghosts by `overlap_gated_interior_pairs`
(same class + fraction-extent overlap ≥ `INTERIOR_MIN_OVERLAP_SHARE` of the
larger extent, monotone so ghost ribbons never cross, litho-window-scoped by
construction). The engineer judges them exactly like every other ghost;
ruling A keeps them pending.

Everything else is a NEW machine claim and arrives PENDING for the
accept/reject flow, the pending chip, and the divide gate:

* the packing-density pairs at machine-invented boundaries inside the body
  (the loose/dense boundary tie in the canonical example — the ONE ghost the
  engineer sees in an unsubdivided↔subdivided sand pair);
* every bridged jump pair (inferred by walking the litho chain across a
  bandless column — not "already a tie in the litho model").

``source='auto'`` on ALL derived ties regardless of approval (hand and
machine stay distinguishable; the 2026-08-01 bug of stamping derived ties as
manual must never return). Consequences: bodies union across a derived tie
only once it is accepted (the resolver ignores pending edges); only accepted
ties are carried across a re-subdivide; the borehole preview ghosts wait for
pending = 0 with ≥1 accepted tie. The 2026-08-05 interim form of ruling A
(every litho-backed tie born accepted, step 3 usually a no-op) is
superseded by this refinement.

### 4a-i. A derived tie may never CROSS another (owner dogfeed 2026-08-15)

The owner pressed step 2 and the section answered *"1 crossing correlation
tie — resolve to restore bands"*, with the bands gone on that gap. A crossing
is a HARD CONFLICT by his own partition-v2 §8 Q4 ruling: the renderer
(`partitionFillV2/crossingConflicts.ts`) suspends BOTH ties and neither side
bands. So a machine proposal that crosses is not just friction — it silently
kills the fill where it lands, and the fix belongs where the bad proposal is
born, not in the detector.

**Definition** (identical on both sides, deliberately): two ties in one gap
cross when their endpoint order is INVERTED between the two columns. Ties
sharing an endpoint fan out rather than cross. Sides matter — a `top`
endpoint is the band's top surface, a `base` endpoint its base.

**The rule.** `derive_geotech_edges_from_litho` keeps a per-gap registry
(`domain/services/geotech_edge_crossing_guard.py`) seeded with the section's
already-APPROVED edges and extended by everything the pass emits. Every
candidate — sided restatement, aligned pair, interior body proposal — is
checked before its `session.add`:

* a PENDING candidate is judged against everything standing in the gap;
* an ACCEPTED candidate is judged only against ACCEPTED neighbours, so a
  proposal can never veto a restatement the engineer drew at the litho stage;
* a refusal is counted (`EdgeDerivationCounts.skipped_crossing_tie`) and
  logged at INFO naming both endpoints of both ties, and the pair is NOT added
  to `seen_layer_pairs` — a later pass, after the engineer resolves the
  conflict, is free to reconsider it.

**Where the crossings came from.** The per-pair aligners are monotone by
construction, so every crossing arrives from a path that bypasses them. The
deterministic one is a direct litho pair carrying BOTH a `top↔top` tie and a
MIXED onlap declaration: the mixed restatement runs from the deepest left
band's base to the topmost right band's top, passing under every deeper pair
the aligner then proposes. The forced top pair is exempt (it shares the right
endpoint). The same shape arrives from an approval already in the model, which
is why the guard is seeded from the database — that is the case the owner hit,
and it is why the banner appeared the instant he pressed step 2.

**Known residual.** The guard's gap is the derivation's own column PAIR. A
bridged jump tie spanning several columns is checked in the gap between its
two terminals, not in each intervening sub-gap — the derivation has no section
geometry (column x, collar levels) to interpolate the bridge, which the
renderer does have. A bridge crossing a direct tie in a column it passes OVER
is therefore still reachable; it needs the section geometry threaded into the
derivation to close.

Depth vs elevation: the guard works in depth below collar, the renderer in
elevation. They cannot disagree — both differences the test takes are within a
single column, so the sign flip cancels in the product.

**The section SHOWS the fighting pair (owner ruling 2026-08-26, "mark the
crossing ties").** The guard above stops the machine from BORN-crossing a tie;
a crossing the engineer drew by hand still happens, and until now the only
evidence was the chip's count. Both ties of every reported conflict now draw a
`TieConflictHalo` — a fat dashed orange-600 stroke BEHIND the tie, so the tie
keeps its own colour and dash and still says which kind of tie it is while it
says it is suspended.

The hue is what is left after the eliminations, and the eliminations are the
reasoning: amber is unsaved-dirty AND is already the pending tie on this very
overlay (painting an ACCEPTED tie amber would state the opposite of the truth),
red is reserved for destructive intent, violet is the review flag. Orange is
Primer's `severe` tier and already reads as "degraded, act on it" in this stage
(the low-confidence badge). Colour is not the carrier in any case: the halo's
presence is binary, and its `2 5` dash matches no other dash a section draws
(pending `4 4`, interpretive `6 3`, review `7 3`, packing `5 4`, stale `8 4`).

The keys travel `PartitionFillOverlay` -> `SectionPanel` -> `CorrelationEdges-
Overlay` as `edgeKey`s taken from the SAME `TieConflict[]` the chip counts, and
are matched with the same `edgeKey` function. Nothing is recomputed: a mark
derived separately could name a different pair than the chip centres, which
would invite the engineer to delete the wrong tie. The publish is guarded on a
content signature, because a caller passing an inline callback would otherwise
loop (pinned by CK4).

ALL conflicting pairs are marked, not just the one the chip last centred: the
chip's cursor is deliberately a ref so advancing does not re-render, and every
marked pair is one the chip will centre.

### 4a-i-bis. The derivation emits each row at most once

`derive_geotech_edges_from_litho` carries TWO dedup keys, and both are load
bearing because they answer different questions.

* **`seen_layer_pairs` — the layer PAIR, sides discarded.** Deliberately
  conservative: two bands already joined by a `base↔base` bottom tie suppress
  the `top↔top` proposal rather than gaining a second edge beside it.
* **`seen_sided_edges` — the ROW IDENTITY `(pair, sides)`, canonicalised
  `(min, max)`.** This is `uq_litho_contact_corr_triple` itself. Every emit
  path — sided restatement, aligned pair, interior proposal — passes it before
  `session.add`, because the pair key is structurally blind to the case that
  matters: on a gap-free litho column a unit's BASE contact is the next unit's
  TOP contact, so a bottom tie on one unit pair and the ordinary tie on the
  pair below it restate onto the SAME two bands with the SAME two sides. The
  derivation reaches that one contact once from each litho tie; the second
  arrival is suppressed, counted (`skipped_duplicate_row`) and logged.

Both are preloaded per section from the persisted edges by all three callers,
which is what makes a re-press idempotent rather than a 500.

**Approval is order-independent.** `litho_approved_edges` is a set, so which
litho tie reaches a shared contact first is arbitrary. When the suppressed
candidate is APPROVED and the standing row is a pending proposal THIS pass
added, the standing row is promoted; a row the caller preloaded from the
database is never touched (the pass adds, it does not reconcile). Pinned by
DUP1–DUP3 in `tests/unit/application/test_geotech_edge_derivation.py`.

### 4a-ii. Two more machine-tie guards from the owner's deletions (2026-08-18)

He asked for the pattern in his 13 tombstoned deletions; two guards encode it:

* **An interior class match must CORRESPOND in its litho window**
  (`_EXTENT_GAP_SLACK` in `geotech_edge_derivation.py`). The LCS tied S9's
  deep D band (fractions 0.79–1.0 of its unit) to a shallow D band on S10
  (0.13–0.18) — a 5 m diagonal he deleted on sight. A non-restatement pair is
  withheld when the fraction gap between its extents exceeds 1.0× the thicker
  band's own height: a band may dip by about its own thickness; a jump is a
  different body. Restatements follow the litho frame and stay exempt
  (DE1–DE3, negative-controlled).
* **A span landing must present the span's own seam soils** (`split_span`).
  Nearest-by-depth landed a sand span on B6's ZAND8|KLEI22 seam (0.11 m off)
  past the VD top (0.42 m off) and wrote the SAND↔CLAY hops he pruned. The
  landing now picks the nearest contact within tolerance whose (above, below)
  soils match the span's endpoint seams; none compatible = keep spanning
  (SP9–SP11).

Not preventable by rule: his S13↔B4 case, where the machine landed on the
geometrically nearest of two same-class candidates and he wanted the other —
geological judgement; the tombstone remembers his deletion.

### 4a-iii. What the split leaves standing over a borehole is DELETED (2026-08-24)

Owner: *"i also had to manually deleted a correlation spanning a borehole from
cpt to cpt over borehole, write a check that checks if all those are gone after
divide boreholes"* and *"if no hops can be made, you just auto delete the
crossing correlation, user will notice something weird in the fill if he/she
needs to subdivide"*.

The split (4a-ii) answers the case where hops CAN be made. Phase 8.6 now runs a
second pass over what it left: every ACCEPTED CPT↔CPT edge whose straight line
reaches a borehole strictly between its endpoints, at an elevation inside that
borehole's own banded extent, is deleted
(`crossings_through_banded_range` → `_delete_ties_crossing_banded_boreholes`).
The invariant the verb now guarantees: **no accepted CPT↔CPT tie passes through
a borehole's banded data**. It welds one body across bands that disagree with
it and the fill draws the weld — which is why the owner was deleting them by
hand after every press.

Kept, deliberately: **sub-TD** (the borehole's bands stop above the line — it
says nothing at that depth, so the span is the only way the correlation can be
stated), a line ABOVE the shallowest band (same silence), a tie ANCHORED on the
borehole (only passing OVER one is a crossing), a borehole outside the run's
`borehole_ids` scope, and every PENDING edge (the emit-time guard owns those).
The judgement is pure geometry in the domain (XT1–XT6); the DB pass re-reads
the edges after the split, so a chain piece that itself jumps a borehole it
could not land on is judged like any other tie. A deletion removes
connectivity, so the pass also triggers the resolver re-run. Reported as
`deleted_crossing_span_count` on the result and the response (DB10).

## 4b. The packing-tie litho-body guard is a SURFACE rule (owner, 2026-08-04)

A contact touches the band above it and the band below it — up to TWO litho
bodies. The guard (`shares_litho_body` + `_resolve_litho_bodies_for_geotech`)
compares BOTH adjacent bodies of each contact and allows the tie when the two
sides share at least one ("if one matches it matches"): the tie is then a
surface tie of the shared body's boundary, mirroring the litho stage's own
cross-lithology surface ties. Disjoint sets still refuse — two separate sand
bodies never merge by this gesture — and body formation stays safe because the
resolver never unions cross-class bands.

**An enclosed lens cannot borrow its wrapper as licence** (owner ruling
2026-08-12 late evening, GC-5). When the tied band's litho unit has the SAME
body immediately above and below it, that wrapping body is dropped from the
contact's licensor set: the unit is a lens inside the wrapper, its boundaries
are the lens's own, and a tie licensed by the wrapper would bisect the very
body that licensed it (*"adding this correlation would mean we would split
the clay body in 2 at this location which is wrong"* — the S9 silt, enclosed
in the clay that wraps through B9, versus S10's silt). The rule became urgent
the day the persisted geometric merge shipped: wrapping bodies now correctly
weld through boreholes, so the one-adjacent-match door opened far more often.
The unit's OWN body always stays a licensor, and GC-4's surface tie (shared
clay above, no wrap below) is unchanged. The refusal toast names both judged
bands ("KLEI (NAD 23) on GEO-22/115-S10 and SILT (NAD 13) on GEO-10/170-S6
are in different litho bodies"), because the click that provoked this ruling
had silently landed one band below its target (thin-band hit area, debt #158).

**The litho body ids this guard reads are the PERSISTED geometric merge**
(owner ruling 2026-08-12: *"every same litho that is connected should get the
same body id"*). Connected same-litho units — per-section fill adjacency plus
cross-section shared columns and fence crossings — share one `body_id`, kept
current by the background body recompute (`POST .../bodies/recompute`,
`body_geometry_fact` rows into the resolver; see docs/design/body-model.md).
So a sand the fill draws as one mass passes this guard without extra ties; the
same persisted identity is what qc-per-body and sample-per-body extraction
read on the geotech model.

**Geometry consequence recorded for the 2/1/0 fill (owner, same evening): a
HALF-matched surface tie constrains the pinch.** When only one adjacent body
matches across the tie, the unmatched band (e.g. the clay below the clicked
clay-base) must taper out to a point AT the tied contact — the tie tells the
fill exactly where the pinch lands.

### 4b-i. The litho-frame FLAG warns on both hand and machine ties (owner order 2026-08-21; machine path 2026-09-02)

Separate from the `shares_litho_body` REFUSAL above is a WARNING that never
refuses: a packing tie can still exceed the litho frame lawfully (two bands that
state a shared surface but can never become one mass), and the owner asked for
it to be flagged rather than blocked -- *"next time flag a tie like that when
it doesn't conform to the litho model!"* (2026-08-21). The tie is written and
born with the violet `review_reason='frame_mismatch'` badge + Confirm-tie flow.
The pure decision is `domain/services/litho_frame_conformance.py`
(`frame_tie_warning`): different parent soils, or same soil with no accepted
litho-correlation path between the parent units.

The hand-drawn tie path ran this from the start. The machine tie path
(`AutoCorrelateGeotechEdges`) did NOT, so it could silently propose exactly the
ties the hand path flags -- it restates a direct top-to-top litho tie onto the
packing bands REGARDLESS of class (section 4a, owner ruling 2026-08-13), so a
cross-soil litho surface tie yields a cross-soil packing restatement. As of
2026-09-02 the machine path carries the SAME warning: after the crossing and
off-section sweeps it re-reads the ties it just created (id-diffed against a
pre-derivation snapshot, so an older cleared badge is never re-applied) and
stamps `frame_mismatch` on the non-conforming ones, logging the flagged count
(`frame_flagged` in the success line and the run's response). It WARNS, never
refuses -- a restatement is legitimate. Behaviour is otherwise unchanged: the
same ties are proposed, only the non-conforming ones now arrive badged. Both
paths call one shared resolver, `application/litho_frame_conformance_resolver.py`
(`band_frame_warning`), so the flag and its message are identical whoever drew
the tie. Note the equivalence for machine ties: a machine tie always restates a
litho edge, so its parent units are litho-connected by construction -- the only
non-conforming case it can produce is the cross-soil one (different soils = a
different litho body), which is why no separate `shares_litho_body`-style
refusal is added to the machine path.

## 4c. Dragging a litho contact onto a packing boundary (owner ruling 2026-08-09)

Ruling 2 forbids a *packing* boundary from crossing a litho contact. It never
said the contact itself may not move — and on interbedded ground the contact is
usually the thing the engineer wants to move, because the cone resolved it
better than the driller's 0.5 m log grid did. Measured on the dev model, CPT
`019e932e-7c4a`: 17 internal boundaries, of which only **3** are packing
boundaries and **14 are litho contacts**. The owner reached for one of the 14
twice in ten minutes and read the (correct) refusal as a broken app.

So on the geotech axis a litho contact is draggable. This is an explicit,
consented edit of the litho model made from the screen that happens to show the
best evidence for it — not a weakening of ruling 2, which still holds for every
packing boundary.

* **The next packing boundary is a WALL, not a magnet** (owner reversed the
  original snap-only ruling on dogfeed: *"i want to be able to nudge those
  solids"*). The contact goes anywhere the engineer puts it short of that
  boundary; it is stopped BY it, not pulled ONTO it. A refinement of a few
  centimetres is the common case and the first build threw it away.
* **One boundary per drag.** The clamp is a half-open `(from, to]` interval —
  origin-exclusive, or a contact already sitting on a boundary would be stranded
  there. Moving two boundaries takes two drags, each its own undo step (owner:
  *"can't skip a boundary right, drag merge first, then drag merge second"*).
* **Landing ON a neighbouring boundary is a MERGE, in BOTH directions** (the
  owner named the gesture; audit F02 found the upward half missing — the
  renderer telegraphed and confirmed it while the backend always refused it).
  Down: the unit above grows, the band between collapses into the band above.
  Up: the reverse — the unit below grows and the band above the contact
  collapses into the band below, classified under the LOWER unit's soil. Either
  way the survivor is classified from the qc over the whole of its new extent,
  and the plan names which side it swallows (``absorbs``) because the writer
  keeps different rows alive per direction. This is the headline case rather
  than an edge one — the clamp lands the drag exactly on the boundary every
  time.
* **A wall that is itself a litho contact may NOT be reached.** Merging there
  would absorb the last packing band of the unit between the two contacts, which
  deletes the unit — and a drag on this axis refines a boundary, it does not
  remove a layer. The line stops one minimum thickness short (the litho axis's own
  0.1 m drag floor, shared so the two axes cannot disagree about how thin a layer
  may become) and says what it hit. The planner refuses the same case
  independently, so a clamp bug cannot reach the database; before that guard
  existed it did, and the litho contiguity rule stopped it as an unhandled error
  — which the owner met as a bare "nothing was changed" with no reason attached.
* **A landing that IS a geological contact merges AND couples** (owner
  2026-08-12, reversing the audit-F03 geo wall: *"yes allow it and couple them,
  this is unnecessary friction"*). He hit the wall on GEO-10/170-S6: a silt
  unit spans a geological contact, so the drag-merge's only landing was exactly
  that interior boundary — and the swallowed interval stayed inside ONE
  formation, the geo contact neither moved nor was crossed. The litho contact
  comes to IT: the writer sets ``parent_geo_contact_id`` on the surviving row,
  so the boundary is a normal restated contact from then on and the next drag
  carries both (RC10/RC11 plan it, RM7 pins the coupling). ONE landing stays
  refused, in the writer: a contact already carrying its OWN geological contact
  may not land on another one — that would put two geological contacts at one
  depth. Before this guard the collision wrote straight through whenever the
  bands predated the geo contact, because the old wall read the bands' build-time
  geo stamps (RM8).
* **The drag telegraphs its consequence**, as the litho axis already did (owner:
  *"sure do the telegraph too, makes it more uniform?"*). Being clamped and
  landing on something are different questions and the engineer needs the second:
  a drag onto a packing boundary is not clamped at all and still costs a whole
  band. So the clamp returns a verdict — move, merge or blocked — and the readout
  says which.
* **Direction decides who swallows whom.** Drag down and the layer above grows;
  drag up and the reverse. No menu, no above/below choice — the thing grabbed is
  the thing that moves. An A/B/C "which contact comes to me?" menu was designed
  and REJECTED in the brainstorm; recorded so it is not re-proposed.
* **Nowhere to go is a clamp, not an error.** A litho unit the qc never
  subdivided offers no internal boundary, and the only thing beyond it is the
  next litho contact — snapping onto that would collapse a unit to nothing. The
  line stops and reads amber. Subdivide that unit first, or edit it on the litho
  axis.
* **Boreholes offer nothing.** Their bands were extrapolated from neighbouring
  CPTs, so snapping a contact onto one would dress a neighbour's reading up as an
  observation made here (`packingSnapCandidates` excludes them).
* **Parentage decides IF, depth decides WHICH.** A boundary is draggable when the
  bands either side have different `source_litho_formation_id` — it restates a
  litho contact. Sharing a parent makes it an internal packing boundary, which
  refuses. Depth proximity picks only WHICH litho row, never whether the gesture
  is offered.

**A severed litho→geo link self-heals** (owner ruling 2026-08-11, audit F34:
*"it shouldn't be that easy to unlink them"*). The accept-time snap copies the
litho depth onto the geological contact bit-for-bit, so a coinciding-but-unlinked
pair is always a severed coupling, never chance. Three defences: a re-accept
restores the link it used to throw out with the skipped snap; the contact move
resolves the geological contact by the same 1.1 mm coincidence it uses for the
litho pair, carries it, and writes the link back; and migration ``b3c4d5e6f7a8``
repaired the pairs that already existed. Only the explicit Unlink gesture severs.

**What is written: one boundary, in all three models, in one transaction**
(`MoveRestatedContact`). A contact restated in three models is ONE physical
boundary, so moving it in only one splits it — which is exactly what the first
build did, and it produced two symptoms that look unrelated and are not: the line
did not move (the geotech axis draws the BANDS), and the second drag on the same
line was refused, because the litho row is resolved by matching the band's depth
and the two no longer coincided. So one call writes: the geotech band boundary,
with **both bands re-derived** from the qc over their new extents (ruling 3 and
the owner's chain — soil type → qc → NAD parameters, so a changed interval must
be asked again); the litho contact it restates; and the geological contact the
litho row is derived from, when it carries one (about a third do). No correlation
is touched: a tie is between contacts, so it survives and re-slopes. Nothing else
on the column is re-derived (ruling 4).

**What happens to the correlations it breaks.** Both bands re-derive, so an
accepted tie anchored on one of them can stop matching its partner. Flag-not-drop
keeps it and badges it violet — the machine does not throw away the engineer's own
correlation on the strength of one edit — but that left him to find the badge later
and reconstruct which edit put it there. He did exactly that once and asked for the
question instead: *"check the correlations after merge ... then prompt user, do you
want to delete correlation band because packing densities mismatch?"*. So every hand
edit that flags accepted ties now raises it, once, after the refetch: keep them
flagged, or delete them. Keeping is the cancel, because it is also what a dismissal
means — the flags are already written. Deleting reuses the ordinary disconnect
gesture, so a tie removed here is indistinguishable afterwards from one disconnected
by hand. Two things are deliberately kept out of the question. A PENDING proposal
that stops matching is deleted outright — asking about the machine's own withdrawn
guess would turn every edit into paperwork — and a tie flagged ``band_absorbed``
still MATCHES, so offering it for deletion under "these no longer match" would state
something false about a correlation that is still right.

**A DOUBTED tie stops unioning** (owner ruling 2026-08-10, scoped 2026-08-11 after
audit F31). A tie does two jobs — it draws the correlation, and it makes its two
layers one body — and a flag that casts doubt on the union suspends the second:
``class_changed`` (the two ends no longer describe the same ground — the original
ruling's case, a body spanning NAD 8 and NAD 7 that a Build would have welded and
exported) and ``ambiguous_band`` (the re-anchor could not be sure WHICH band the tie
was drawn on). ``band_absorbed`` does NOT suspend: the band the tie was drawn on was
absorbed but the survivor still matches the partner, so the correlation is still
right — and since that flag never self-heals and is deliberately excluded from the
keep-or-delete prompt, suspending for it too made every routine contact drag-merge
silently and durably fragment bodies. The tie is otherwise untouched in every case:
still kept, still badged, ``class_changed`` still self-healing.

**The move is undoable, merge included.** The dialog has promised "One step on
the undo stack" since it shipped; audit F11 found nothing ever pushed that step.
A plain move's inverse is a move back (classes re-derive from restored extents,
so the round trip is exact). A merge's inverse is two calls in a fixed order —
move the contact back, THEN split the neighbour at the old boundary; reversed,
the split would land on the litho contact and be refused. Redo cycles re-anchor
onto the rows each revert's split creates (``restatedContactUndo.ts``).

**The drag names its blast radius before it commits.** Every other verb on this
axis stays inside the geotechnical model; this one gesture reaches up the
hierarchy, and nothing on screen says the row is shared. So the release opens a
consequence prompt that lists what will move, built from the row rather than
assumed — the geological line appears only when `parent_geo_contact_id` is set.
It is not styled as a destructive confirm: nothing is lost, the move is one undo
step, and refining a contact from the evidence is the intended workflow.

**Staleness is DERIVED, never stored (owner's choice).** A packing band's
contract is that it lies inside its litho parent; after a contact move some bands
on that column no longer do, and *that comparison IS the staleness*
(`geotechParentFit.columnsNeedingRederive`). No migration, no table, no write
path that can forget — and it cannot lie, because a flag can claim staleness the
data contradicts. Same shape as ruling 8. It was chosen in direct response to the
2026-08-08 review, which found two bugs that were only possible because staleness
had been cached.

The interim render is honest rather than hidden: between the drag and the
re-subdivide the bands genuinely do overhang their parent, and that is what the
section draws. The Subdivide verb carries a tag naming how many columns need
re-deriving. **Nothing rebuilds automatically** — `subdivide-cpts` begins by
deleting every geotech row it is about to rebuild, so an automatic rebuild would
destroy every hand edit on those columns as a side effect of fixing one contact.

**Telling the two kinds apart** (owner picked option 3 of three mockups): the
litho contact is a heavy near-black solid line, a packing boundary a thin dashed
one in mid-slate. Dash and width alone did NOT carry it on dogfeed — both kinds
read as near-black at 1 px versus 1.75 px — so the packing boundary is also
lighter, which puts it where it belongs: subordinate to the contact. A grip glyph
sits beside every draggable packing boundary at rest; a padlock appears on a litho
contact only on HOVER, because at rest an interbedded column would stack 14 of
them. Both glyphs render BESIDE the column, never on the line — anything drawn on
the line becomes another press target, and that surface is already contested
(§4's hit-strip clamp).

The padlock is raised by the **grab strip**, not by itself. It first drew at
`opacity 0` and listened for its own `onMouseEnter`, so it appeared only if the
engineer hovered an invisible 9 px glyph — which is why the owner reported no
padlock at all. Three unit tests passed throughout, because each fired the hover
on the glyph: the one action a user cannot perform. Any hover-revealed affordance
has to be armed by the surface that is actually hoverable.

`flow_geotech_snap_contact` is the only thing that proves the whole chain in the
real app — rendered hit strip → consequence prompt → plan → the three-model write
— and it drives the real gesture: drag past two packing boundaries, land on the
first, confirm, and assert that the absorbed band is gone and no band was created.
Three things it had to learn the hard way, all worth keeping in mind for any
future drag spec: a prepared band third is about **two pixels** at the scale a
section opens at, so the spec zooms with the wheel before aiming; `ContactsLayer`
DISCARDS a commit outside the dragged row rather than clamping it, so the release
has to stay inside that row's own extent; and the vertical-exaggeration slider is
not a substitute for the wheel — at 25× the band-edit overlay stops rendering its
grips altogether.

## 5. Carrying accepted ties across a re-subdivide (2026-08-02, develop UNPUSHED)

"Subdivide all bodies" throws the geotech bands IN SCOPE away and rebuilds them
with a fresh `uuid7` (every band of the model on a model-wide press, that
section's members on a scoped one — see §9a), and both endpoint FKs on
`litho_contact_correlation_edge` are `ON DELETE CASCADE`. So Postgres deletes
every correlation edge touching a rebuilt band as a side effect of the layer
wipe — silently, without passing through application code. Sparing
accepted edges in the reset's own `WHERE` clause makes no difference at all: the
cascade takes them anyway. Accepted ties survive only because
`GeotechTieReanchor` captures them before the wipe and re-creates them after the
rebuild, in the same transaction.

**Owner rule (2026-08-02):** *"i don't want accepted edges to just disappear
without any user explicitly deleting it."*

Three tiers, tried in order per endpoint:

| tier | condition | outcome |
|---|---|---|
| 1 | same investigation, same depth interval (to the mm), same NAD class | carried clean |
| 2 | exactly one band of the SAME class overlaps where the old band was | carried clean — the band was resized by a litho drag |
| 3 | anything else overlaps | carried, stamped `review_reason` |
| — | nothing overlaps anywhere | lost, logged at WARNING |

Tier 2 exists because tier 1 alone dropped 13 accepted ties on the real model:
12 of them had exactly one same-class band overlapping 72–100 % of the old
interval, with boundaries that had moved by as little as 4 cm. Tier 3 covers the
13th, whose packing class had genuinely re-derived.

`review_reason` is `'class_changed'` or `'ambiguous_band'`, free text on the edge
so a new reason needs no migration. A flagged edge stays `user_approved` **on
purpose** — demoting it to a proposal would hand it to the next rebuild's
dirty-delete pass, which is the silent disappearance this whole path prevents.

Real-data measurement (`scripts/measure_geotech_tie_reanchor.py`, dev model):
**217 of 217 accepted ties survive**, one flagged `class_changed`. The script
re-derives the rule independently from the band tables and cross-checks the use
case's counts, so a disagreement is a loud failure rather than a silent one.

**UI.** A flagged tie renders its accepted styling plus a violet `!` badge
(`components/sections/edgeReviewFlag.tsx`) — deliberately not amber, which
already means "auto-proposed, pending acceptance", and never colour alone. The
badge is right-clickable and its menu carries **Confirm tie** above **Delete**.
Confirming clears the flag (`ConfirmCorrelationEdgeReview`, per-edge and
model-wide endpoints); deleting is the other answer. A `warning` toast after
Subdivide reports the count, because the badges only reach someone looking at
the section they sit on, and a re-subdivide can flag a tie whose other endpoint
is on a section he does not have open.

**"Divide boreholes" carries ties the same way.** Phase 7 of `DivideBoreholes`
deletes every borehole `litho_layer` in the geotech model, so the same cascade
takes every accepted tie with a borehole endpoint — and the button is one click,
ambered on purpose after any packing correlation, so re-clicking it is the normal
flow. It therefore runs the SAME `GeotechTieReanchor`: `capture(...,
restrict_to_anchor_kind='borehole')` before the delete, `reanchor(...)` after the
borehole fill and BEFORE the Phase-8.5 derivation (so that pass's per-section
dedup set already holds the carried ties). CPT↔CPT ties are deliberately not
captured — Phase 7 does not touch their endpoints, so their rows survive
untouched and counting them would overstate what the verb did. The re-anchor sees
both the surviving CPT bands and the freshly written borehole bands, because both
live in the `geotech_layer_by_inv_depth` index the phase already builds.
`DivideBoreholeResult` / `DivideBoreholeResponse` carry `reanchored_tie_count`,
`review_tie_reasons`, `lost_tie_count` and `lost_tie_reasons`, and
`handleDivideBoreholes` reports all three outcomes in the same three toasts
Subdivide uses.

This is also why `REASON_BOREHOLE_DEFERRED` exists: Subdivide materialises CPT
bands only, so a borehole endpoint finds no band there. That is a build-order
fact, not geology the rebuild stopped drawing — the borehole bands come back one
verb later.

⚠ **No staleness detection between a litho model and its geotech child** —
debt #266. Drag a litho contact and the geotech bands below it silently describe
a stack that no longer exists; nothing marks the geotech model stale until the
next Subdivide re-derives it.

## 6. Seeing the packing before committing it (2026-08-04, develop UNPUSHED)

**Owner ruling (dogfeed 2026-08-04):** *"correlation bands aren't plotted over
boreholes so it is impossible to see how divide-all-boreholes will act — what
gets what packing — before you click the button."*

The gap is structural, not cosmetic. `SubdivideAllBodies` materialises CPT bands
only; every litho edge with a borehole endpoint is skipped there
(`skipped_empty_stack=229` on the dev model, "deferred to DivideBoreholes"), so a
borehole column on the geotech axis is genuinely blank until `DivideBoreholes`
runs — and that verb deletes and rebuilds every borehole band while it is at it.
The engineer had to commit to find out.

**The engine is now callable as a dry run.** `DivideBoreholes.plan()` is
everything up to the first write — load litho picks, geo-bound, group, read the
CPT geotech layers, TIN-interpolate each borehole, assign class / provenance /
body — returning a `DivideBoreholePlan`. `execute()` calls it and transcribes the
result (`_persist_planned_segment` decides nothing); `POST
.../geotech/divide-boreholes/preview` calls it and reports it. **There is
deliberately no second implementation of the rules.** A preview that re-stated
them could show one packing class and write another, and the engineer would have
no way to notice.

`plan()` issues only `SELECT`s. It does NOT read the prior borehole bands, so
planning before or after the Phase-7 delete produces identical bands.

**The gate.** Integration `test_db5_preview_equals_commit` runs preview, then
commit, on one fixture and asserts the committed bands EQUAL the previewed ones —
depth interval, NAD class, confidence — per borehole, not a tolerance and not a
count. `test_db6` asserts the same for the tie-carry counts. On its first run the
gate caught a real divergence: the preview reported a `body_id`, but the commit
re-runs `ResolveLithoInstances` after the borehole-mediated edges exist and
re-stamps `body_id` on every band. **The preview therefore reports no body_id at
all** — only fields the plan genuinely owns are promised.

`test_db7_preview_between_two_divides_equals_the_second_divide` is the same gate
on an ALREADY-divided model — the case the plan/execute split actually
introduced, since `plan()` now runs before the Phase-7 delete. It asserts the
preview mutates none of the first divide's rows and that its bands are what the
second divide commits. (`_committed_borehole_bands` orders in SQL, so two bands
sharing a top depth cannot make the comparison depend on physical row order.)

**Render.** `components/sections/GeotechBoreholePreviewGhosts.tsx` draws the plan
as ghost bands on the geotech axis: translucent `nadClassColor` fill, dashed
outline, 45° hatch — the litho pending-suggestion convention
(`LithoSuggestionLayer`), so "hatched = not committed" means one thing across the
editor. Geometry uses `col.nudgedX` like every other overlay.

*Confidence is visual, not only textual.* A class a neighbouring CPT resolved
(`cpt_interpolated` → `high`) and a conservative fallback (`body_min` /
`absolute_min` → `low`) must not carry the same weight on a feature whose whole
point is "what packing does this borehole get", so the low tier draws with a
lighter fill and a denser hatch. The `<title>` naming the provenance is the
second channel: the band rect stays hit-testable for it (a `pointer-events:none`
ancestor kills every `<title>` beneath it), while the hatch and label are
`none`. Accepted trade-off — a click on a ghost is swallowed rather than reaching
the fill underneath, and a ghosted column is an undivided borehole with no
geotech gesture of its own. Unknown provenance tokens are quoted verbatim rather
than described, so a future engine token cannot be given a false evidence claim.

*Nothing is dropped silently.* A band thinner than a pixel is drawn at a 1 px
floor; a band entirely outside the depth window cannot be drawn at all and is
COUNTED, surfaced by the toolbar next to the legend. Absence must never read as
"nothing is planned at this depth".

**First divide vs re-divide (#269, 2026-09-03).** An undivided column shows the
plan as a SOLID hatched ghost — the first divide. A column that already carries
committed bands is a RE-DIVIDE: `Divide boreholes` re-plans the already-divided
model (backend gate DB7) and rewrites every borehole band, so pressing it again
is not a no-op. That column now draws the new plan as an OUTLINE-ONLY diff over
the committed band — a dashed stroke in the class colour, no fill and no hatch —
so the committed band shows through and the new boundaries read as a diff, never
a solid overpaint (the invariant the old drop-it behaviour protected). The diff
is READ-ONLY: it answers "what would change", it offers no per-column accept,
because re-committing one already-divided column is undesigned. The
hatched-preview legend still counts the first divide only — a diff is an outline,
not a hatch. Chosen render = the debt entry's leading option (outline-only over
the committed bands); side-by-side before/after was the alternative. Per-band
change-flagging (bold the boundaries that moved) is a possible follow-up.

**Refresh + legend.** `useGeotechBoreholePreview` fetches while the geotech axis
is showing and a geotech model exists, keyed on `geotechLayersVersion` — a
counter `useGeologicalModel` ticks once per SUCCESSFUL load of the committed
rows, i.e. once after Subdivide (which invalidates every planned band) and once
after Divide (which turns the ghosts into rows). It is deliberately not the
`geotechLayers` array: the bus clears that to a fresh `[]` before every refetch,
so keying on its identity ran the whole planner — TIN interpolation included —
twice per mutation, and left a window in which the overlay read the empty array
as "no borehole is divided". `geotechLayersLoaded` closes that window: while the
committed rows are unknown, the last known answer holds. The planner's snap
tolerance (`geotech_subdivision.litho_snap_tolerance_m`) is a key too, since
`plan()` reads it — and `geotechSubdivisionPrefs` now round-trips that key, which
the patch builder used to drop.

Only the 404 carrying `detail.code = "geotech_model_not_found"` is silent (it
means Subdivide has not run). Every other 404 — a broken litho-model reference
404s with a plain-string detail — toasts like any other error, because an empty
borehole column otherwise reads as "this borehole gets no packing".

The toolbar's `geotech-preview-legend` is gated on what the overlay ACTUALLY
drew, published through `utils/geotechPreviewRenderStore`. Recomputing "is any
in-corridor borehole undivided" in the toolbar said "Hatched = preview" over an
empty axis whenever the overlay had declined to draw — no collar elevation,
still loading, or a failed request with the error toast already up.

⚠ **Visual dogfeed pending** — hatch weight at dense column spacing (now two
densities), and whether the NAD abbreviation is legible in a thin ghost band.

## 7. The litho-consistency gate (2026-08-13)

The 2026-08-04 render/build divergence programme (44.1 % → 39.7 % of the
section plane, seven owner questions, the agreement freeze) is CLOSED BY
CONSTRUCTION: since §2 the render and the build run the same engine on the
same inputs, so there is nothing left to reconcile. Its machinery
(`geotechEngineAgreement.diag.test.ts`, the agreement baseline, the
fallback / void / taxonomy diags) is superseded and leaves with the
refinement modules. Kept from its owner answers: Q1 — the build INHERITS the
litho geometry (2026-08-04), now realised literally; Q5 — hand-drawn litho
lens boundaries still apply to the litho render and both voxel builds but
not to the geotech axis (nothing stored on the dev model; still a rule
call, not a defect).

**The invariant that replaced it** is the owner's 2026-08-13 ruling: the
geotech fill may only SUBDIVIDE the litho fill, never redraw it. The gate:

* `desktop/.../utils/geotechLithoConsistency.diag.test.ts`
  (`GEOTECH_LITHO_CONSISTENCY=1`; input =
  `scripts/throwaway_geotech_axis_inputs.json`, regenerated read-only with
  `uv run python scripts/dump_geotech_axis_inputs.py`; missing input FAILS
  with the recipe). Both partitions are mapped into along-metres ×
  elevation, rastered painter-order (lenses last), and every litho-covered
  cell asks: does the geotech arm put the same SOIL here?
* **Frozen ratchet** —
  `__fixtures__/geotech_litho_consistency_baseline.json` records the model
  ids + per-section agreement; a drop > 0.1 pp FAILS, an improvement is
  re-frozen (`CONSISTENCY_FREEZE=1`). Different model ids → NOT COMPARABLE,
  nothing enforced.
* **The geotech arm IS the render's construction** (2026-08-15). It was not:
  the gate clipped unconditionally, remapping gap indices by matching the
  gap's left along-metre, while the render clipped only when the two column
  sets matched. On a fully divided model the two agree, which is why the
  discrepancy stayed invisible; on a MID-PIPELINE model the gate reported
  99–100 % for a fill nobody could see, because every gap the geotech arm
  could not reach fell back to litho and therefore agreed with litho by
  definition. The arm now assembles frame-aligned per-run exactly as §2
  describes, and `CONSISTENCY_LEGACY=1` reproduces the old render for a
  before/after read. The report line also carries the packed and un-banded
  FACE counts, so "the texture is drawn nowhere" is a number, not a look.
* **Numbers.** The gate measures the CLIPPED fill by default (the render's
  truth; `CONSISTENCY_RAW=1` measures the unclipped tie-driven partition
  for what-if analysis). Frozen 2026-08-14 on the LIVE dev model, clipped:
  **97.7–98.9 %** per section — before any restatement re-run, because the
  frame guarantees the soil geometry and ties only refine class placement
  within it. The residual 1–2 % is the gate's own raster quantisation
  (verified: a 10× finer per-gap raster shows < 2 m² per gap on CS1).
  Unclipped what-ifs (`scripts/diag_predict_restatement_rerun.py`):
  step-2 re-run 87.0–98.8 % (CS1 95.8); step-3 accept-all CS1 96.9 % while
  CS3 DROPS to 94.9 % — some old pending ghosts are geologically wrong,
  which is why the review flow beats a blind accept-all.
  On the owner's CURRENT (mid-pipeline) model the frame-aligned arm reads
  **99.2 % on CS1 and 100 % everywhere else**, against 90.5 % / 3.1–14.7 %
  for the render he dogfed (`CONSISTENCY_LEGACY=1`). The frozen baseline is
  NOT re-frozen for either: it was frozen on a different geotech model id,
  and re-running it against the fully-divided dump of that model reproduces
  its numbers to the digit — the change is a no-op once every borehole is
  divided, which is the property that makes it safe.
* **The target is 100 %** (owner ruling 2026-08-14: "litho consistency
  should be 100%"). The measured residual decomposes into three named
  classes (per-gap drill-downs: `geotechSectionDump.diag.test.ts`,
  SECTION_DUMP=1, + the gap-compare renderer in the session scratchpad):
  1. **Interior bodies awaiting the engineer's NAD correlations** — inside a
     litho-banded pair, the restatement carries the unit's OUTER contacts;
     the big same-class interior bodies (CS1 gap 3, B4|S13: the n13 silt
     masses, 287 m²) band only once the engineer ties them — ruling A keeps
     machine interiors pending, so the machine cannot accept these for him.
     The gate climbs as he correlates: exactly the litho workflow.
  2. **Engine-geometry residuals** — a subdivided unit's per-band 0-tie
     lenses union into a different envelope than the litho unit's single
     lens (Tie-11 gap 0: the VEEN lens, 133 m²), and a fully-untied
     interval's vacancy can flood from a FOREIGN soil (the n5 sand into the
     silt zone at CS1 gap 3) or stay void. These cannot be correlated away
     and need their own engine decisions.
  3. **Raster/measurement artefacts** — sub-0.3 pp, cell quantisation.
  The mismatch clusters name soil pair + elevation + along window so every
  point of residual is attributable to one of the three.

## 8. Where a borehole's packing comes from — the flanking CPTs (2026-08-04)

### 8-0. The unit of work is the LITHO LAYER (restructure 2026-08-16)

Donor candidates used to be the CPTs sharing the borehole's
``(body, geological band)`` group.  That is the wrong unit, and it produced
four separate dogfeed defects in one afternoon: a body owns several layers per
column where a lens splits it, so a dict keyed by column kept the wrong one; a
geological contact can put the two ends of one hand-drawn correlation in
different groups; and it can leave a group with no column near enough to say
anything, which is how a band the owner had tied to two MEDIUM DENSE columns
90 m away took LOOSE sand from a CPT 777 m off.

What owns a borehole's packing is the **litho layer**, so the layer names its
own donors (``layer_donor_picks``):

1. The columns its approved litho **correlations** point at — a tie is the
   engineer's statement that two layers are the same sheet, and it outranks any
   grouping the engine derived (his ruling of 2026-08-11, *"the user's ties
   will define this"*).
2. Failing that, the columns sharing its **body**, whatever geological band.
3. Under two hard constraints: the **same litho UNIT** — the same
   ``source_litho_formation_id`` (soil AND admixtures), the receiver group's
   own formation, not merely the same soil — and **within
   ``MAX_DONOR_MAP_DISTANCE_M``**.
4. One layer per column, chosen by elevation overlap.

The unit gate is finer than a soil gate on purpose (owner ruling 2026-09-14,
borehole GEO-07/182-B2: *"i redivided B2 but there is still a dense sand, while
there is no dense sand in that litho unit on each adjacent test"*). The resolver
then welded every admixture variant of one soil into ONE litho body, so a clean
``ZAND`` unit and the glauconitic ``ZAND (GL:|KL:)`` below it shared a body id —
and the donor pool is read per BODY (``cpt_layer_picks_by_body``). Since owner
2026-10-03 a body is one litho unit (``resolve_litho_instances.same_mass``), so
the body pool holds one unit by construction; the unit gate below stays as the
explicit rule (and for the correlated donors, whose tie may cross two units). Where the borehole's own clean sand
reaches deeper than the flank's clean sand, the flank's glauconitic pick
overlaps the receiver's extent MORE, so the old **same-soil** gate let
``flank_pick_for_unit`` pick it and lend its DENSE class onto a clean sand every
adjacent test read medium dense. ``layer_donor_picks`` now keeps only picks
whose own ``formation_id`` equals the receiver's, so **a neighbouring unit's
class is never lent**: only the same litho unit
on the flank donates; a flank carrying no band of that unit contributes nothing;
when neither flank does, the receiver falls to the conservative floor of
§8-0b (the loosest class the column measured for that unit, or the variant-aware
table floor). The finer key still floors only from the same soil, because a
formation carries exactly one soil. Since the group key already scopes each
planning group to one litho unit (§_group_segments), the CPT press was never
affected; the fix is on the borehole donor pool alone.

The packing is then derived **once across the whole layer**, and the
geological contacts **cut** that answer (``clip_bands_to_slice``).  A cut is a
cut: it divides a layer into pieces that may carry different geological
parents, and it is never a reason to read a neighbouring column twice.  Before
this, each slice re-derived independently and the owner's B9 received S9's
``6 → 8 → 7`` sand TWICE — *"none of that messy dense very dense succession on
top"*.

### 8-0b. A band with no evidence is CONSERVATIVE, never inherited (owner, 2026-08-16)

Owner, on a 0.43 m sliver that had been given a neighbour's medium dense
class: *"wouldn't have been easier to just take the least dense packing on the
column for the fallback. That's where you wouldn't have the loose end with a
medium scent instead."*

**A slice the donor rule cannot answer takes a floor, not a borrowed class**
— borrowing the neighbouring band's class dresses an unmeasured interval as
whatever sat next to it, which on a sliver above medium dense sand read medium
dense.  Which floor, he then corrected the same day:

> *"when the fallback fires, there is already a sand beneath it that does have
> a higher NAD class.  So we take that NAD class as the lowest on the column
> ... the upper bands which fall back to the lowest class will get medium
> instead of loose."*

So the ladder has two rungs (``apply_column_floor``):

1. **The loosest class the COLUMN measured for that LITHO UNIT** (``column_min``).
   The NAD table's floor is not the conservative answer, it is a fictional one:
   a LOOSE sand band dropped into a column whose every measured sand reads
   medium dense or better is a layer the site shows nowhere on that column, and
   inventing one can drive a design on data that does not exist.  The floor is
   **per unit, not per soil** (owner 2026-09-12, *"per unit ofcourse"*): the
   unit is the band's ``source_litho_formation_id`` (its litho formation row,
   keyed by the litho find-or-create on ``(soil, admixtures)``), so a
   glauconitic sand and a clean sand of the same soil floor independently and
   *"behave differently"* — the glauconitic sand never borrows the clean sand's
   measured class for an interval it never read.  Keying on the formation is
   strictly finer than keying on the soil, so a sand still floors only from sand.
2. **The table floor** ``loosest_class_for(soil, admixtures)`` — variant-aware
   per audit F19 — only where the column measured none of that unit
   (``absolute_min``).  On the live model that is mostly peat, which no CPT
   reads.

Both stay at ``low`` confidence: the interval was not read, and the badge must
keep saying so.  The pass raises only, never lowers, so a standing sub-minimum
sliver (his ruling of 2026-08-11) keeps its own conservative value.  It runs
after the donor rule across ALL of a borehole's segments, because the measured
sand that sets a sliver's floor is usually in a different body group from the
sliver.

**The raise can make two touching bands the same class, so the merge runs after
it too** (owner installer #40, GEO-07/182-B2: *"how come i have two stacked md
sands on B2?"*).  His litho ZAND layer carried a ``body_min`` NAD-5 floor band
over a measured NAD-6 band; the geo-cut merge saw a NAD-5 over a NAD-6 and
correctly left them split, and only then did ``column_min`` lift the NAD-5 band
to NAD 6 — two touching medium-dense sands in one litho layer that nothing
welded.  The three passes now live in one function
(``finalize_borehole_bands``): merge the geo cuts, raise the unanswered bands to
the column floor, and merge AGAIN.  Two touching bands of one class in one litho
layer are one band, whatever pass split them, so no pass that can make two
touching bands the same class runs without the merge behind it.  The second
merge keys on ``source_litho_layer_id`` like the first, so a user "Split here"
(two litho layers) still survives (§8-0c).

A short-lived "inherit the class from another slice of the same layer" pass
existed on 2026-08-16 and was **deleted the same day**.  Do not rebuild it: it
took the NEIGHBOURING class, which can be denser than anything the column
measured, where ``column_min`` takes the loosest and is bounded by the column's
own evidence.  On the live model the ladder reads 138 donor-backed bands, 5 at
``column_min`` and 22 at the table floor; ``body_min`` (weakest observed in the
BODY, across columns) fires zero times.

### 8-0c. A packing band never crosses a litho-LAYER contact (owner, 2026-09-12)

Owner: *"if a layer is split into two in the litho then it has to stay split in
geotech ofcourse."*  A geotech band belongs to ONE litho LAYER, not merely one
litho unit.  When the engineer splits one litho layer into two layers of the
SAME composition (the "Split here" verb), the two are different ``litho_layer``
rows sharing a formation, and the geotech divide must keep them two bands with a
boundary at the split depth — no band spans it.

The split survives in TWO steps, and both matter because two same-composition
halves share one formation and so fall in ONE planning group.

* **Emission confines each segment.** The borehole press plans each
  ``BodyLayerPick`` segment (one litho layer) alone: the fill is derived over
  that segment's own litho-layer extent (``derive = unit_layer``) and
  ``clip_bands_to_slice`` trims it to the slice, so no emitted band spans the
  union of two split halves even when the flanking CPTs read one class straight
  across the split.  The CPT press does the same by construction — each segment
  becomes its own column plan (``_build_column_plans``).  So the boundary at the
  split depth already exists before any merge.
* **The merge is the second guard.** Every band carries its source layer — a
  borehole band stamps ``source_litho_layer_id`` (``unit_layer[0]``), a CPT band
  ``parent_litho_layer_id`` — and ``merge_geo_split_bands`` merges two touching
  same-class bands only when they ALSO share that layer id, i.e. two pieces of
  ONE litho layer a geological surface cut, not two layers.  Before this it keyed
  only on class + formation, so where the flanking CPTs read one class on both
  sides of the split it welded the two halves into one band running through the
  litho contact (his b13 defect, same-composition variant); the boundary the
  engineer drew appeared to move to a tie-interpolation depth.

The grouping key stays ``(body_id, source_geo_formation_id, formation_id)`` on
BOTH presses: the litho LAYER is not a group key because layer ids are unique
per column, so keying on one would fragment a unit's cross-column group and
strand every borehole with no flanking donor.  Layer identity lives on the band
(and its merge), where the split is actually decided, not on the group.

**Owner ruling, dogfeed of §6:** *the borehole's packing must come from the CPT
to the right and to the left on the cross section.*

Rule (`domain/services/borehole_flank_donors.py`, applied by
`DivideBoreholes._plan_borehole_bands_litho_confined`):

1. A **donor** is a CPT that shares the borehole's body group AND reads packing
   inside its own litho extent for that group.
2. Donors are ranked **along a section line**: nearest at a smaller
   along-position = left flank, nearest at a larger one = right flank.
3. Both flanks, same ordered class list → their band boundaries are paired and
   blended in **thickness-fraction space** of each donor's own litho extent,
   weighted inversely to along-distance, then re-laid on the borehole's extent
   (`mode = flank_interpolated`).
4. One flank → that donor's stack, fraction-mapped (`single_donor`).
5. No section places the borehole beside a donor → nearest donor by map
   distance (`nearest_fallback`).
6. Depth the donors leave unclassified still falls to `body_min` /
   `absolute_min`, unchanged.

Each planned band carries its `mode`, the donor names with along- and
map-distances, and the section that decided — additive optional fields on the
preview payload, for the hover provenance.

**What it replaced.** `transition_surfaces[k]` TIN-blended the k-th band
boundary of EVERY CPT in the body group, whatever class pair each boundary
separated, and voted the class by majority across the same crowd. On the real
model that mixed up to ten class pairs (inversions included) over CPTs as far
as 777 m away, and any borehole outside the TIN footprint fell to the body-wide
mean. 1411-GEO-23/126-B4 came out 6→7→6 — a sequence no CPT reads — with the
dense sand at −1.11; its nearest three donors (4.7 / 78 / 78 m, all in its own
body) read 6→7→8 with the dense top at ≈ −0.9. The module
`geotech_split_surface.py` is DELETED; it had no other caller.

**Two interpretations — the second RULED 2026-08-18:**

* *Mismatched flank sequences* → the nearer flank's stack verbatim. There is no
  honest pairing between two different class lists; this follows the earlier
  "nearest test that does have packing" ruling.
* *Several sections* → **the section being EDITED wins** (owner ruling
  2026-08-18: *"the section you are editing wins — if the user edits TS11 he
  will notice and change it"*). A SCOPED divide passes its ``section_id`` as
  ``preferred_section_id``; when that section places the borehole beside any
  donor, its flanks decide, pair-beats-lone within it. The UNSCOPED
  all-sections press keeps the older tightest-pair ranking (least
  extrapolation) — there is no editing context to prefer. F11/F12 pin both
  arms. The class the engineer then disagrees with has its own lever: the
  set-class verb below. **This one is consequential**: on B4's shallow sand body,
  Tie-section 11 (lone left flank GEO-23/125-S34 at 78 m, all NAD 6) beats
  Cross-section 1 (lone right flank GEO-23/125-S13 at 90 m, NAD 7 from +1.26)
  by 11.6 m of along-distance — and that is what decides whether the borehole
  reads dense sand there. Candidate alternative if the owner disagrees: prefer
  the section that draws the most donors of the group.

## 9. The four-step packing pipeline (owner ruling 2026-08-04, late evening)

**Owner ruling.** "Subdivide all bodies" did too much at once: it subdivided the
CPTs *and* derived packing ties, and those ties arrived ALREADY ACCEPTED. It is
replaced by four verbs mirroring the litho stage's suggest → accept rhythm.

| step | verb | endpoint | what it does |
|---|---|---|---|
| 1 | subdivide CPTs into packing | `POST .../geotech/subdivide-cpts` (litho model) | packing bands on the CPTs, **no** edge derivation; optional `section_id` |
| 2 | auto-correlate packing | `POST .../geotech/auto-correlate` (geotech model) | PROPOSES ties (`user_approved=false`), jumping across borehole columns; optional `section_id` |
| 3 | accept | `POST .../contact-correlations/accept` (scope) · `.../{edge_id}/accept` (one) | promotes proposals; optional `section_id`; `GET .../geotech/tie-status` reports what is left, per section |
| 4 | divide boreholes | `POST .../geotech/divide-boreholes` (litho model) | gated on step 3 **in scope**; optional `section_id` and `borehole_ids` subset |

The accept verbs are the litho axis's own — `AcceptContactCorrelations` has
never been litho-specific, and the router applies no kind guard — so step 3 is
reuse, not a second implementation. Nothing was duplicated for the geotech axis.

`POST .../geotech/subdivide-all-bodies` still works and now declares what it is:
the COMBINED verb, running steps 1 + 2 in one press, answering
`edges_derived: true` and `proposed_tie_count`. Its derived edges have been
proposals since 2026-08-01; the response is what changed.

### First subdivision wins (owner ruling 2026-08-18)

*"Does this test already have a subdivision? If yes import and skip ... a test
has been subdivided once already before the tie section usually, I don't want
any discrepancies."* Both destructive steps take ``skip_existing``: a column
that already carries geotech bands is imported AS-IS — neither deleted nor
rebuilt, its hand edits and hand classes untouched — and only band-less
columns build. The toolbar presses send it by default, so working section by
section can never make one column tell two stories. Two deliberate
exceptions send the historic rebuild instead: step 1 pressed under a REBUILD
tag — the button announces the rebuild, and skipping would pin the tag on
forever. The STATISTIC re-run is MODEL-WIDE (owner: *"when you redivide with
another mean statistic all need to be rederived ofcourse"* — the stamp that
clears the tag is model-level, so a scoped re-run would clear it while other
sections still carried old-statistic bands, and first-wins would freeze the
discrepancy in; the confirm dialog names the whole-model blast radius). The
moved-contacts re-derive stays section-scoped — its stale columns are the
section on screen. SC1b/SC1c pin both arms. The statistic rebuild also wipes
the scope's borehole bands, so every borehole goes honestly empty and the
next step-4 press rebuilds it from the new CPT bands.
Pinned: SE1–SE3 at the DB.

**The escape hatch is per test:** right-click a test's LABEL on the geotech
axis → **Clear subdivision** (``POST .../geotech/columns/clear``,
``ClearGeotechColumn``). Its bands go, its ties cascade, NO tombstone is
written (rebuild preparation, not judgement) — then the next pipeline press
rebuilds exactly that column. Fires immediately per the owner ("you can fire
it"); the toast names the rebuilding press. Pinned: CL1/CL2 (the full
clear-then-press loop).

### Jump ties — the pairing crosses undivided borehole columns

Step 2 runs BEFORE step 4, so every borehole column is deliberately empty of
packing. The derivation aligns packing stacks inside a correlated litho unit, so
a litho edge with a bandless endpoint finds nothing to align and is skipped: a
section drawn CPT – borehole – CPT proposed **nothing at all**.

`domain/services/geotech_edge_bridging.py` walks the litho correlation graph:
a layer whose column carries packing bands is a TERMINAL, one whose column does
not is TRANSIT. From every terminal it walks through transit layers only,
stopping at the first terminal reached, and adds that pair. Expansion stops at
terminals on purpose — a chain A–B–C of three divided columns already has its
own two correlations, and an A→C shortcut would tie bands the engineer never put
beside each other. It ADDS; the approved set is never reduced.

Applied by all three derivation callers (`SubdivideAllBodies`,
`AutoCorrelateGeotechEdges`, `DivideBoreholes` phase 8.5) via
`geotech_edge_derivation.bridge_edges_over_bandless_columns`. It is a no-op once
every column is divided, and still earns its place in `DivideBoreholes`: a
`borehole_ids` subset run leaves some columns undivided.

**Real-model measurement (dev DB, read-only):** 418 approved litho edges across
6 sections; the bridge adds **90 jump pairs, 76 of which straddle at least one
borehole column**.

**Supersession (owner ruling 2026-08-14, dogfeed):** *"those cpt to cpt ties
should be replaced by cpt to borehole to borehole to cpt ties once i click
subdivide boreholes"* — and on sparing hand-drawn ones: *"just delete all,
it'll be a real bother to delete all by hand once the proper chain is there."*
`DivideBoreholes` phase 8.5, after deriving the borehole-mediated edges,
deletes every **bridged jump tie** (an edge whose two investigations carry NO
direct litho tie on the section) whose two endpoint bands are connected by a
path of **accepted, direct-litho-backed** edges — the mediated chain. Kept
alongside, the jump tie would still weld one body straight across a borehole
whose bands disagree, and the fill would still draw its deep-to-deep bridge
line over the real bands. Guards: a pending chain hop does not supersede
(deleting an accepted jump tie against an unaccepted chain would lose approved
information); a jump tie is never a carrier for another; an edge whose
investigations ARE directly litho-tied (a restatement — e.g. of a hand-drawn
litho jump tie) is never superseded. Deletion only fires when an accepted path
exists, so body connectivity is unchanged by construction. Response carries
`superseded_jump_tie_count`. `domain/services/geotech_jump_tie_supersession.py`
(JT1–JT8 unit, GP10/GP11 DB pins, negative-controlled).

### The gate

`divide-boreholes` answers `422 geotech_ties_pending` while any tie is still
proposed, carrying `pending_tie_count` / `accepted_tie_count` /
`geotech_model_id`. It is not bureaucracy: an accepted tie spanning a borehole
decides which CPTs that borehole's packing comes from (below), so dividing on
unreviewed proposals throws away evidence the engineer is one press from
supplying. `ignore_pending_ties: true` is the deliberate escape. The PREVIEW is
ungated — it writes nothing, and refusing it would only hide information.

The gate lives at the endpoint, not in the use case: it is a workflow policy,
and `DivideBoreholes.execute` stays callable by the tests and by any future
caller that has its own reason.

### Tie-informed donors (`mode = tie_interpolated`)

**Owner ruling:** when an accepted tie's span crosses the borehole's column on a
section and both endpoints are CPTs in the borehole's body group, THAT tied pair
becomes the donor pair, replacing the nearest-flank guess. §8's flanking rule
stays as the fallback wherever no tie spans.

`domain/services/geotech_tie_donors.py` returns a `FlankSelection` — the same
shape §8 produces — so both rules feed one laying-out function. Beyond naming
the donors, the tie supplies the band CORRESPONDENCE: both donors are reduced to
exactly the bands the engineer tied, in depth order, and everything else is left
for the conservative fill rather than invented. That is why a tied pair can pair
where the flanking rule refuses: §8 needs the two whole class sequences to
match, a tie says which band is which. A tie drawn across two different packing
classes is a surface tie, not a correspondence, and is left to the fallback.
Candidate pairs rank tightest-span first; a share below 0.5 % degrades to
`single_donor` exactly as F10 decided.

### The tie line places the boundary — mTAW (owner ruling 2026-08-18)

**Owner ruling:** *"go for the mtaw, it'll look better than the fractional."*
A tied boundary lands where the DRAWN TIE LINE crosses the borehole's column:
its elevation interpolated between the two columns' boundary elevations by the
borehole's along-position (`place_unit_boundaries`). The committed contact and
the line on screen are then the same thing — on B9 the earlier fraction blend
put the MD|VD contact 2.2 m above the line the engineer drew, because his unit
was far thicker than the flanks'. A one-sided lens/onlap carries FLAT at its
own elevation (still only within half the gap of its declaring column). A line
that leaves the borehole's unit places nothing there — the litho contact
already bounds it — but it still classifies the clipped unit (a thin deep body
entirely UNDER a dense-top line reads dense, not top-of-stack; `P8`). Pinned
by `test_geotech_unit_boundaries.py::UB1/UB3/UB7` and
`test_divide_boreholes_plan.py::P8/P9/P10`.

Three companion rules from the same dogfeed round:

* **The nearer flank names the class** where the two flanks disagree about the
  band between tied lines — the far flank's different class is an onlap that
  pinched before the borehole (`_bands_between`; B9 at w=0.93 toward S9 had
  taken S10's D over S9's MD; `P9`).
* **Flanks are judged per layer window** (`depth_aware_flanks`): *"If there
  are no cpt data below TD, then you look to the next cpt over ofcourse. Close
  cpt where there is data, further away below TD."* The walk steps past
  boreholes and past CPTs whose banded extent misses the layer's window (less
  coverage than one writable band = silence); a CPT with data of ANOTHER soil
  still blocks — data that disagrees is still data (`FW1–FW5`).
* **A straddling tie resolves from its own bands, not the flank pick**
  (`_tie_boundary`): B2's VD spans start from S10's LOWER sand unit while the
  flank machinery keeps one pick per column (the upper), so the endpoints
  resolved to nothing and B2's 8.7 m sand stayed one band. The neighbour band
  each boundary names is the nearest SAME-SOIL one (a cross-soil interbed is a
  lens inside the mass); a cross-soil endpoint band never places a boundary
  (Data Integrity Rule 3). Replayed read-only on the live model: B2 plans
  MD / VD / MD exactly on the two drawn lines (`P10`).

### The renderer half (2026-08-05)

The four verbs are four numbered toolbar buttons on the geotech axis, in press
order, replacing the single "Subdivide all bodies" press:

| button | testid | verb | gating |
|---|---|---|---|
| **1 · Subdivide CPTs** | `geotech-subdivide-cpts` | `subdivide-cpts` (open section's id) | needs a litho model **and an open section**; a RE-run still opens `ReSubdivideConfirmDialog` |
| **2 · Auto-correlate** | `geotech-auto-correlate` | `auto-correlate` (open section's id) | needs an open section that **already carries packing bands** |
| **3 · Accept ties** | `geotech-accept-correlations` | `contact-correlations/accept` (open section's id) | needs an open section that **already carries packing bands** |
| **4 · Divide boreholes** | `geotech-divide-boreholes` | `divide-boreholes` (open section's id) | needs an open section that **already carries packing bands**; **disabled while `pending > 0` on THAT section** |

The labels carry no "on this section" qualifier: an "on all sections" twin
stood beside each of the first three for one morning and the owner deleted it
(2026-08-15, *"I didn't ask for the on all sections option, it's ugly and
confusing delete it and keep only on this section"*), and a verb with one
meaning does not need a qualifier. The API keeps its optional `section_id`
(absent ⇒ model-wide) for compatibility and for tests.

`GET .../geotech/tie-status` feeds `useGeotechTieStatus`, re-read after EVERY
verb (steps 1–4 and each single-tie accept). Its `pending_by_section` breakdown
feeds the pure `utils/geotechPendingScope.ts`, which owns every sentence the
toolbar says about outstanding ties: the amber chip
(`geotech-pending-tie-chip`) reports THIS section's count with the model total
in its tooltip, and step 4's visible tag reads `accept 5 on this section`.
Because Chromium fires no mouse events on a `disabled` element, step 4's
explanation lives on a `role="presentation"` span wrapper — the same device the
axis toggle uses. When the breakdown is missing (older backend, request not
landed) the helpers degrade to the bare model total rather than claiming "0
sections pending" beside a disabled button, and the gate over-gates on that
total rather than sending a press the server will 422.

#### The pending chip ANSWERS its count (owner ask 2026-08-25)

*"now i get a one pending notification but i don't see any pending ties? Why
don't we make that clickable so it highlights the tie?"*

The count and the canvas disagree by construction, and both are right. The
count is per SECTION — it comes from `pending_by_section`, keyed on the edge's
own `section_id`. The canvas draws per RENDERED COLUMN —
`CorrelationEdgesOverlay` resolves both endpoints through the placed-column map
and `return null`s when either is missing. **A tie whose endpoint column is not
drawn counts and renders nothing.** In the reported scene the pending tie ran
between a CPT the section drew and a borehole it did not.

So the chip is now pressable whenever the OPEN section has a pending tie, and
answers either way. It is a native `<button>` (Enter / Space / focus ring come
from the platform; the crossing chip hand-rolls a keydown handler only because
an SVG `<g>` gets none of that). With every pending tie on another section it
stays the plain label it has always been — the passive-unless-it-can-act
contract `CrossingTieWarningChip` established.

**Whether** and **why** are answered by different surfaces, on purpose, so they
cannot disagree:

* **Whether** — `SectionPanel`, the only surface that knows where a column is
  drawn. The request names INVESTIGATIONS and an edge id, never a position or
  an index (`components/sections/sectionColumnReveal.ts`); `resolveColumnReveal`
  then centres on the midpoint of the two columns' `nudgedX`, so packing and
  nudging are respected, and `TieFlashHalo` pulses the tie for
  `FLASH_HIGHLIGHT_MS` tracing the tie's OWN points string. Half a tie is never
  revealed: one missing end means no pan at all.
* **Why** — the shell, which alone sees the project-level gates the panel never
  receives. `utils/pendingTieReveal.ts` walks them in the order the render path
  fires them and reports the FIRST that hit, because a column dropped upstream
  is trivially "not projected" too and blaming the corridor would send the
  engineer to widen one that is fine:

  1. not in the project's investigation list at all
  2. the project-local removed set (Data stage "X this row")
  3. the App-level manifest gate — in the database but not in the opened
     project file, i.e. imported in a session that was never saved
  4. the active axis model's `excluded_borehole_ids` ("Boreholes in model")
  5. the cross-section's own `excluded_*_ids`
  6. outside the projection corridor — tested through `investigationsOnSection`
     itself, so the answer cannot drift from what the canvas did
  7. column focus is on
  8. unknown — reported honestly rather than guessed at

An undrawable tie surfaces as one amber toast naming both ends with their band
depths and then the absent end again beside its reason, e.g. *"Pending tie:
GEO-10/170-S4 18.29–18.52 m ↔ 1411-GEO-23/126-B6 13.90–18.05 m —
1411-GEO-23/126-B6 is not drawn here: …"*. A revealed tie is silent: the pan and
the pulse already answered on screen.

`SectionsToolbar` and `SectionsCanvas` are sibling zone components with no
shared parent below the shell, so the press crosses on a module ref
(`pendingTieRevealBridge.ts`) — the same device `sectionsDividePartitionCallback`
already uses for step 4. Cycling reuses `tieVisitNav.nextVisitIndex`, shared with
the crossing chip (renamed from `crossingTieNav` when the second caller arrived).

### 9a. All four steps follow the open section (owner rulings 2026-08-15)

**Owner rulings.** *"I also see that this is model wide and not per section, i
don't like that"* and *"i want subdivide cpt's also to be section scoped, i
don't want any cpt's that aren't on any sections to be subdivided and included
in the model"* — then, reading the menu once the first three were scoped:
*"i'm reading divide boreholes (whole model), no that should also be section
scoped"*.

Every step takes an OPTIONAL `section_id` in its request body — present scopes
the run to that section, absent is the historic model-wide behaviour every
existing caller relies on. The toolbar always sends the open section's id, and
all four items are disabled with no section open. This REVERSES the 2026-08-05
review MAJOR-2 decision (model-wide feeder verbs so the model-wide step-4 gate
could be satisfied): the gate went with the scope instead.

**Their ENABLEMENT follows the same scope** (owner, same dogfeed: *"when i
switched to cs2 options 2 3 and 4 in the packing pipeline where clickable this
was not the case on the first subdivide in cs1"*). Steps 2, 3 and 4 asked
whether a geotech MODEL exists — a question that answers correctly exactly
once, on the first press of all. From the moment CS1's step 1 created the
model, every unsubdivided section offered three live presses that could only
no-op. They are now gated on the OPEN section carrying packing bands, read off
the same `subdivideScope` memo the re-subdivide confirmation counts (which
narrows `geoModel.geotechLayers` through `geotechBandsInScope` by the section's
member investigations), so there is one notion of "does this section have
bands". Their disabled title names the reason and the remedy — *"No packing
bands on this section yet — run “1 · Subdivide CPTs” on this section first"* —
where the predecessor told an engineer whose model already existed to create
it. Step 1 stays live throughout: it is the remedy. Precedence of reasons: no
section open wins first, then no bands here, then (step 4) this section's
pending ties. Pinned by SC17–SC21 in
`SectionsToolbar.geotechScope.test.tsx`.

**Step 4 is scoped through the subset path it already had.** A `section_id`
resolves to that section's MEMBER boreholes (`_scoped_borehole_ids`, the same
`project_investigations_onto_section` membership rule) and drives the existing
`borehole_ids` subset — which already scopes the delete, seeds the layer index
with the columns it leaves alone, and restricts the tie capture. Phase 8.5's
edge derivation is filtered to the scoped section as well, so a press cannot
author proposals on a section whose borehole it left undivided. The preview
endpoint takes the same field and resolves it through the same planner, so
preview ≡ commit (DB5) holds per section.

**The pending-tie gate follows the scope.** With a `section_id` the 422 counts
that section's proposals; without one it counts the model's. That is the point
of the change: CS1 can be finished end to end while CS2 still carries ties the
engineer has not reviewed. A borehole on TWO sections is divided by either
press — its bands come from its own donors and its body membership, not from
the section it is viewed on, so both presses produce the same rows.
Pinned by `tests/integration/api/test_geotech_divide_boreholes_scope.py`
(DS1–DS6; DS3 asserts on row IDS, so a whole-model delete that rebuilt the
neighbour identically still fails).

**A scoped step 1 only WIPES what it rebuilds** (2026-08-15, the same morning
the all-sections escape was deleted — with no escape left, a wholesale wipe
would have meant two sections could never be subdivided at once).
`_delete_all_geotech_data` takes a `restrict_to` set of investigation ids: with
a `section_id` the layers, the unaccepted edges hanging off them and the
matching `formation_contact` mirrors are deleted only for that section's
MEMBERS (the `project_investigations_onto_section` rule the model already
uses), and every other column's bands, ties and bodies are untouched. Three
consequences worth naming:

* **The tie re-anchor is scoped with it.** `GeotechTieReanchor.capture` takes
  `restrict_to_investigation_ids` and keeps a tie when EITHER endpoint is on a
  rebuilt column — one endpoint is enough, because the cascade takes the edge
  either way. A tie entirely outside the scope keeps its row and both its
  endpoints and is deliberately not captured. So the matcher can find the
  untouched half, `GeotechTieReanchor.surviving_bands` reads the model back
  between the delete and the write and those bands join the freshly-written
  ones in `rebuilt_bands`.
* **Bodies are NOT deleted in the scoped mode.** A body spans every column its
  ties reach, so there is no per-section subset of them, and dropping the lot
  would strip names, colours and hand-drawn boundaries off sections the run
  never touched. `ResolveLithoInstances` runs model-wide immediately afterwards
  and reconciles them instead (reuse, lineage adoption, unnamed-orphan delete);
  `litho_layer.body_id` is `ON DELETE SET NULL`, so nothing is lost either way.
  Formation find-or-create is likewise model-wide — those rows are shared by
  every column of the same class.
* **An investigation on TWO sections is rebuilt from either.** Its bands come
  from its own qc and its body membership, not from the section it is viewed
  on, so both routes produce the same rows; the neighbour section's ties onto
  it are carried by the re-anchor.

The skip report (`skipped_off_section_count` / `_labels`) is measured against
membership of ANY section, in both modes: a column on the neighbouring section
is *in* the model and keeps its bands, so a scoped run naming it as "left out"
would send the engineer hunting a problem that is not there.

**The membership invariant** (`application/section_membership.py`) applies in
BOTH modes and to `DivideBoreholes` as well: an investigation that projects onto
no cross-section is never subdivided and never enters the geotech model.
Membership is decided by `project_investigations_onto_section` — the same rule
the section view, the DXF/PDF render and the edge derivation use, and one that
already honours a section's `excluded_cpt_ids` / `excluded_borehole_ids`, so a
column excluded everywhere it projects counts as off-section. The skipped set is
logged at INFO **by name** and reported as `skipped_off_section_count` /
`skipped_off_section_labels`. The step-1 toast used to repeat it and no longer
does — owner, the same day: *"wtf are of section skips, this is useless info
for the user?"*. A column he never put on a cross-section is not work he lost,
so the audit trail stays in the log and on the wire and stops being UI.
Verified 2026-08-15 that the `DivideBoreholes` half was NOT redundant — before
the guard, an off-section borehole sharing a body with an on-section CPT was
filled from that CPT's transition surfaces.

**The edge derivation obeys the same rule — since 2026-08-25, not before.** The
three geotech writers (`SubdivideAllBodies`, `DivideBoreholes`,
`AutoCorrelateGeotechEdges`) all read their derivation input from
`load_approved_litho_edge_sets`, which used to select the parent model's
approved litho edges by `section_id` alone and hand them straight to the
aligner. That trusts the litho table's own scoping, and the litho table still
carries rows written before `project_onto_section_corridor` gained its
between-the-endpoints clamp (2026-08-03) — when a column inside the corridor but
past the end of the line counted as on-section. On the owner's model that is 38
approved litho edges across 5 tie-sections, and every geotech press restated the
reachable ones onto gaps the section does not draw. Shown one of them (a pending
`GEO-10/170-S4 ↔ 1411-GEO-23/126-B6` tie on Tie-section 7, where B6 projects at
along = −1.84 m), the owner ruled: *"yeah make it section scoped ofcourse"*.

`load_approved_litho_edge_sets` now takes the section's member set as a
**required** keyword argument and drops any tie reaching a column the section
does not draw, returning the excluded columns on
`ApprovedLithoEdgeSets.off_section_investigations` so each caller names them at
INFO. Required rather than optional on purpose: gating one caller would only
leave the next press to put the same tie back, and `DivideBoreholes` writes its
hops `born_accepted=True`, so a mis-scoped one enters the model looking like the
engineer's own line. A tie with one off-section endpoint is DROPPED, never
bridged across — the column is not on this section, so there is no gap here to
walk through. An endpoint the depth map cannot place at all is *unplaceable*,
not off-section: it passes through so the derivation still counts and logs it as
`skipped_no_litho_depth`.

**Legacy rows are swept, but only the machine's own proposals.**
`geotech_offsection_sweep.sweep_offsection_pending_ties` runs at the end of
auto-correlate (beside the crossing sweep, and for the same reason: a fixed
emitter cannot reach a row already in the table). It deletes only
`source='auto'` rows nobody has approved, scoped to the sections that press
examined. An ACCEPTED or hand-drawn mis-scoped tie is counted, named at WARNING,
and left exactly as it is — taking one back is the engineer's call. Reported on
the verb's response as `investigations_off_section` / `offsection_ties_deleted`
/ `offsection_ties_retained`.

**The gate falls OPEN on an unanswered tie-status.** Only a LOADED count blocks:
a 404, a network failure, or a backend predating the endpoint would otherwise
disable step 4 permanently. The server enforces the gate regardless, so falling
open costs a 422 at worst — whose structured `message` is surfaced verbatim in
the error toast — and never a dead button.

Steps 2 and 3 were PROMOTED out of the "Correlate packing" caret; that control
is now a plain button owning only the manual gesture. Two ways to press the same
verb in one toolbar is the clutter debt #23 warns about, and a pipeline step
hidden behind a caret is a step the engineer skips.

**Per-tie accept** reuses the litho path unchanged (`acceptSingleContactCorrelation`
→ `handleAcceptGeotechPackingCorrelation`, which refetches the packing edges and
the geotech layers so the 2/1/0 fill re-renders with the new band). Only the
wording is axis-specific: `acceptEdgeLabel="Accept tie"`, so the row names the
same object as "3 · Accept all ties".

**Jump ties render honestly.** An edge whose endpoints are non-adjacent columns
draws a polyline that BENDS at each column it crosses (`warpAwareEdgeVertices`).
The accepted seam has done so since 2026-07-10; the PENDING proposal's dashed
outline and its right-click hit polygon did not, and now do
(`warpAwareRibbonOutline`). Drawing the proposal straight and the accepted tie
bent told the engineer the surface moves when he accepts it — and on this axis a
jump tie is the ordinary case, not the exception. Residual: the two
drag-to-retarget grab lines on a pending edge are still straight; they are
invisible and split at the screen midpoint, so warping them is its own change.

**Ghost-accept.** Right-clicking an undivided borehole's ghost bands offers
"Accept these bands (divide this borehole)", which POSTs `divide-boreholes` with
`{borehole_ids: [id]}` — the subset the preview was drawn from (backend gate
GP9). Per COLUMN, never per band: one borehole's bands are a single plan (its
donors, its litho extents, its ties), so accepting a band out of the middle
would ask the planner a question it was never asked. A subset commit does NOT
clear the `boreholesStale` amber — the columns it left out are still out of
date. The committed rows then turn that column's solid ghost into a read-only
outline re-divide diff (#269, above) and leave every other column's alone. The
accept gesture is offered on the first-divide (undivided) columns only.

### An onlap is a triangle, and its shadow may be hatch (owner ruling 2026-08-23)

**Owner ruling:** *"The loose sand has a bottom tie, not a top tie that is why
it is an onlap and should be a triangle and not a quad"*, and on the cost:
*"hatch is fine, leave it."*

A band whose ONE tie is on its BASE contact rides that line and pinches its
free top down onto it — a triangle, apex at the termination. The engine drew
that correctly all along; what squared it into a quad was the REMAINDER step
handing the same band the wedge directly ABOVE its own pinching top (still
inside its nominal window, so it won the `ownsLevel` rank). The guard in
`fillGap.pickDominant` now refuses that: where a band's own construct speaks,
it speaks completely — the remainder may not re-take ground the band's own
closed shape has already declared it does not occupy at that x.

Scoped to ONLAP constructs, and held on every rung:

* a LENS keeps its existing level-scoped treatment (2026-08-21, *"only a LENS
  drops out, and only at the levels it closed on"*) — barring lenses too left
  the ground with NO candidate and un-tiled the cover (CF5/CF6 went red);
* dropping the guard on the last no-wall rung, as the walls drop, reopens the
  defect: in CS1 gap 19 every band in the run is closed, so the ground falls
  through and the onlap takes it back.

The guard's cost used to be hatch: the shadow under a closed onlap had no
candidate left and rendered "correlate me". The owner accepted that in 2026-08-23
(*"hatch is fine, leave it"*) and withdrew the concession three days later — see
the two rulings below, which between them leave the guard intact and the shadow
classed. S24 pins the neighbouring outcome positively (the MD sand above takes
the ground at the sampled point, `ZAND-6`).

### The leftover between two closed constructs (owner ruling 2026-08-26)

**Owner ruling:** *"if 2 lenses are pointed to eachother and there is nothing
else to fill the gap, no open band above or below, then you fill with the lowest
density"* — and, on the alternative put to him the same morning (split the
leftover at the vertical middle, each half to its own side): *"a big NOOOO"*.

The ground is a piece of litho cover trapped between two legally-closed facing
constructs where EVERY rung of `remainderLadder.ts` declines: the flanks are
closed, the closure bars stand between the sample and every band that might own
it, and the own-shape guard above refuses each band the shadow under its own
pinch. Real sand, plainly inside one body, rendered as hatch because no rule had
been written for it.

**The rule** (`constructive/leastDenseLeftover.ts`), applied at the ladder-null
site and nowhere else:

* **ONE region.** A connected run of leftover faces — the seam's own vertical
  cuts the owner's in two — is one piece with one owner, so the merge welds it
  and no seam appears where the law drew no line.
* **The LOWEST DENSITY among the masses that BOUND it.** "Bound" is defined in
  exactly one place, the module's header: every classed face that shares an edge
  of the arrangement with the leftover (`constructive/faceAdjacency.ts`). On his
  own scene that is the two facing constructs, whose flanks are its two walls;
  where a third band of the family lies against it, that band counts too. It is
  deliberately NOT "the facing pair" by name — the engine cannot know which pair
  a leftover faces until it looks at what touches it. Least dense is his own
  precedent from the stacked-seam holes (*"least dense yeah"*, 2026-08-25): the
  lowest NAD class number, read through the same `nadClassRank`.
* **Last resort only.** It runs after the constructs, after the ladder and after
  the pocket rule. An open mass takes the ground first (the SF-silt fill-through,
  2026-08-21) and a same-class facing pair is welded before a construct is drawn
  (`coverWeld.ts`), so *"nothing else to fill the gap, no open band above or
  below"* is a precondition the engine enforces by ordering rather than by test.
* **It redraws nothing.** The bounding constructs' rings are its boundaries; the
  wedges do not move.

**Measured** over all 14 sections of the owner's model plus the live canvas dump:
11 leftover faces classed, 455.2 m² in total, area conserved to the tenth of a
square metre on every section, and CS1 / CS2 / CS3 unchanged (CS1's own leftover
was already answered by the cover weld, so the golden master needed no re-freeze).
Region counts fall by one on the two sections where the leftover welded into an
existing body.

### The totality tripwire

With that rule in place the fill is TOTAL: on any gap a banded RUN spans, every
square metre of the family's cover has an owner. So residual there is no longer
an accounting line, it is a DEFECT — and `constructive/fillTotality.ts` says so
by name, reported on `diagnostics.totalityViolations`.

It is deliberately silent where no banded run spans the gap. One of those tests
carries the family and has not been divided (the 2026-08-15 ruling: an un-divided
borehole shows visibly EMPTY ground), or no test on that side carries the family
at all. Blank is the correct answer there, and a tripwire that cried wolf on it
would be switched off within a week.

## 10. Where the geotech stage lives, and its 3-D legend (owner ruling 2026-08-26)

**The Geotechnical stage is the 3-D room. It has no 2-D half.** It shipped with
a stage-local 2D ⟷ 3D pill whose 2-D side was `SectionsCanvas` with the axis
forced to `'geotechnical'` — a second door onto a surface the Sections stage
already owns. Owner: *"In geotech stage there is a 2D and 3D split... i don't
think we need the 2D stage either, you can just go to data or cross section
pane."* The pill is gone and so is the mount effect that reprogrammed the shared
`sectionModelAxis` from a stage that no longer renders sections. The stages are
now symmetric: **Sections = 2-D for every axis, Lithology / Geotechnical = the
3-D room for their model.** `GeotechnicalCanvas` mirrors `LithologyCanvas`
(`useBody3DViewState` + `BodyViewModePills` + `makeVoxelRequestBuilder`), with
two guided empty states — no litho model (nothing to subdivide) and no built
solids (run Build). Build stays on `GeotechnicalToolbar`.

**The 3-D LAYERS legend is a tree, on the geotech pane only.** The flat
per-formation list degenerates there: a subdivided model produces dozens of rows
whose text is identical ("SAND", "SAND", "SAND", "CLAY", …) and whose only
difference is an adjacent shade of one NAD ramp — unreadable, and unusable as a
visibility control. Three levels, closed at soil level:

* **soil family** — grouped on `litho_main_soil_code`, ordered by
  `NAD_SOIL_FAMILY_ORDER` (GRAVEL → PEAT, strangers last); the swatch is the
  colour of its most-populated class (within a family the palette is a lightness
  ramp of ONE hue, so any member reads as the family, and the dominant packing is
  the honest representative).
* **NAD class** — labelled by **density / firmness only** (`nadPackingLabel`:
  "medium dense", "silty/clayey, medium dense"), never a repeat of the soil word.
  Two litho units subdivided to the same class share ONE row and the row's eye
  hides both. A unit with no class yet (the borehole-only "(geotech)" skeletons,
  `nad_class = null`) gets a neutral-grey `#9ca3af` **"not yet classified"** row —
  shown, never dropped: it is real ground the viewer paints.
* **body** — one row per built solid; the label names its unit when the class row
  spans several units, so the third level cannot reproduce the identical-text
  disease the tree exists to kill.

An eye per level hides that family / class / body. Family and class write
`hiddenFormationIds` (honoured by solids, fence walls and cut-face caps); the
body level writes a separate `hiddenBodyIds` set because only the solid render
carries body identity. Consequence to know: **in Fence mode the per-body eye is
inert** (solids are not drawn there at all) while the family / class eyes still
bite; the body rows stay listed there rather than disappearing mid-flip.

**Only what the scene paints gets a row** (owner ruling 2026-08-26, on the
shipped legend: *"why are there suboptions like this ... not yet classified?"*).
A row whose eye cannot change anything is noise, and reads as a model the
engineer failed to build rather than as nothing at all. "Paints" is read PER
VIEW MODE, because the modes paint different things:

* **Solid mode** — the class has at least one built body solid with geometry.
* **Fence mode** — one of the class's units has a wall panel. Fence walls come
  from the geotech layers + accepted ties with no Build involved, so a band
  legitimately exists there with zero solids; conversely a built body with no
  wall paints nothing in fence mode and gets no row.

The mode signal is `fencePanels` (undefined = solid), passed from
`Geology3DViewer` straight into the builder. Families follow their classes. The
`nad_class = null` "not yet classified" row is not exempt — with a built body it
stays (unclassified ground is content), with nothing built it goes. Accepted
consequence: the tree changes shape when the engineer flips view mode, which is
the point — each mode describes what that mode draws.

The shape is built by the pure `utils/geotechLegendTree.ts`
(`buildGeotechLegendTree`), rendered by `stages/geology/GeotechLayersTree.tsx`.
The gate is `formations.some(isGeotechUnit)` — the canonical
`source_litho_formation_id` discriminator, NOT a `nad_class` probe, which would
miss exactly the skeleton rows the tree has to keep. **The geological and litho
3-D legends keep their flat list** — their formation names are already distinct,
so grouping there would only add clicks.

### 10a. The Build pre-flight — a test with no packing bands (owner ruling 2026-08-26)

A test imported AFTER the packing subdivision carries accepted litho and no
bands. It still enters the **litho frame** the geotech build is framed on
(`buildVoxelRequest` takes `lithoFrame.payloadColumns` as the payload's
columns), so it splits a gap the packing fill has no data for. Owner: *"yes that
suggestion is fine, these 2 tests… but ofcourse make it so that user can go to
those test through one click. Build without them should produce the model that
was there before the added tests, so just plain ignore them"* — serving *"I
can't have gaps or fallbacks in the model unless users make mistakes."*

**The check** (`utils/geotechBuildPreflight.ts`, pure) computes NOTHING of its
own: it runs `assembleLithoSectionInputs` + `assembleSectionsWithCanonical`
twice — once on the litho layers, once on the geotech bands — so the projection
gate, the acceptance gate and the "fewer than two columns is not a gap" rule are
the builder's own, never a restatement that can drift. A finding is an
investigation that is a **litho-frame column on ≥ 1 frame-kept section** and is a
**column of no section's geotech assembly**. Consequence reported alongside: a
frame-kept section whose geotech assembly is NOT kept leaves the payload
entirely (pinned against the builder in `makeVoxelRequestBuilder.exclusions`
EX5, not against a reading of it).

**The dialog** (`GeotechBuildPreflightDialog`) opens only on a non-empty result,
so a finished model builds exactly as before — same unwrapped canvas builder,
same payload. Every name is a `<button>` that deep-links to the test: the
Sections stage, a section that carries it, column centred and pulsed, through
the existing reveal machinery (`sectionColumnReveal` + `resolveColumnReveal`,
extended with `flashColumnId`; the panel owns *whether*, the shell owns *why*,
and only investigation ids cross the boundary). Focus sits on the DEFAULT
action, not Cancel — nothing here is irreversible.

**The three ways out.** *Subdivide them & build* runs `subdivideCpts`
(`deriveEdges: false`, the verb that carries skip-existing) for flagged CPT
columns and `divideBoreholes` scoped to the flagged boreholes with
`skipExisting`, then **waits** for the bands to reach the renderer before
building: the presses finish by bumping a refetch nonce whose GET runs on a
later render, so building on the spot would post the pre-press payload. The wait
is bounded (`GEOTECH_BAND_WAIT_MS`) and reports a stall instead of hanging.
*Build without them* excludes those investigations from BOTH arms before
assembly (`utils/excludeInvestigationsFromBuild.ts` — column, layers AND every
edge anchored on one of those layers, so no dangling tie survives), which is
byte-identical to a payload built from inputs the test was never in (EX1). A
chip on the toolbar then names what the last build left out, cycling one press
at a time. *Cancel* builds nothing.

## 11. The Geotech-units pane, and the vocabulary behind it (2026-08-26)

The pane was a flat roster, one row per geotech formation. On the owner's
project that read as ~94 rows: the same soil repeated dozens of times, rows with
no bands between rows with hundreds, and two rows whose entire text was the
character `0`. Three things changed, at three different layers.

### 11a. A geotech formation is retired when nothing references it

`geological_formation` rows are vocabulary — created on demand by the
find-or-create paths in `geotech_borehole_materialiser`, and until now never
deleted. Every verb that reshapes a model strands them: `SubdivideAllBodies` and
`DivideBoreholes` wipe their bands and re-derive, so a class the fresh qc no
longer produces is left with an empty formation; the band-edit verbs re-point
bands one at a time and retire a class the moment its last band moves away. Of
the owner's 94 rows, 62 were strays of exactly this kind, resurrected wholesale
by the `.strix` restore.

`application/orphan_formation_sweep.py` (`OrphanFormationSweep`) is the single
predicate. It deletes a candidate formation when NO `litho_layer`, NO
`formation_contact` **and NO `body`** references it, project-wide (not
model-scoped — a unit shared with a sibling model still describes real ground).

**The `body` term is load-bearing, not defensive.**
`ResolveLithoInstances._run_resolver` deliberately preserves an orphan body when
the engineer has NAMED it, so a formation can hold zero bands and zero contacts
and still own a named body. `body.formation_id` is `ON DELETE CASCADE` and
cascades on to `body_boundary_shape` → `body_boundary_node`, so a two-term
predicate would delete a hand-drawn body boundary silently.
`litho_body_solid` also cascades; a built solid for a formation with no ground
left is stale by definition, so the sweep counts those rows and reports them
rather than letting them go unmentioned.

Two scopes, one implementation: `sweep_geotech_units` (candidates =
`source_litho_formation_id IS NOT NULL`) and `sweep_litho_vocabulary`
(candidates = `litho_main_soil_code IS NOT NULL`). `ClearLithoModel`'s orphan
pass is now the second of those — it used to carry its own two-term copy of the
predicate, and the `body` term fixes it too.

Hook points — inside the verb, after the resolver, before its own `commit()`,
so the sweep is in the same transaction as the reshape that caused it and is
covered by the body-partition lock the verb already holds:
`SubdivideAllBodies` (both the main path and the empty-picks wipe),
`DivideBoreholes`, `ClearGeotechColumn`, `SetGeotechBandClass`,
`SplitGeotechBand`, `MergeGeotechBands`, `MoveGeotechBandBoundary`,
`MoveRestatedContact`. `DivideBoreholes`' `pick_count == 0` early return is
deliberately NOT swept: it reshapes nothing.

**Why deleting is safe.** Nothing about a geotech formation is authored. Its
identity is the find-or-create key — `(app_project_id, nad_class,
source_litho_formation_id, source_geo_formation_id)`, matched at
`geotech_borehole_materialiser.py:398-417` (classified) and `:492-511`
(skeleton) — and every other column is copied from the source litho formation
at create time (`:427-449`, `:517-537`). Hand edits go through the same
function via `geotech_band_edit_helpers.formation_for_class`, so there is no
parallel vocabulary of hand-made rows. A later divide that needs the class
rebuilds an equivalent row. The `id` is NOT stable across a sweep (fresh
`uuid7`), which is exactly why only unreferenced rows are ever touched.
Pinned end-to-end by `OS3` in
`tests/integration/api/test_geotech_band_edit_endpoints.py`, which compares
find-or-create KEYS across a clear → re-divide round trip.

### 11b. An unclassified unit says which ground it is

`nadClassName(null)` returns `""` by design — the section band overlay draws no
label for an empty string. Every roster that asked IT for row text therefore
rendered a blank row, which is where the bare `0` rows came from.

`utils/nadClasses.ts` now carries the roster-side formatters, and
`nadClassName` keeps its raw-lookup contract untouched:

* `geotechUnitLabel(unit, sourceLithoName?)` — never empty. Classified → the
  packing name. Unclassified → `"{SOIL} — not yet classified"`, plus the source
  litho unit in parentheses when several units would otherwise read alike.
* `geotechUnitSoil(unit)` — the one soil word per unit: the leading word of the
  NAD class name when classified, the inherited `litho_main_soil_code` through
  `LITHOLOGY_LABELS` otherwise. Both yield the same five words, so a skeleton
  groups under the same header as its classified siblings.
* `nadClassQualifier(n)` — the firmness/density half of the class name, DERIVED
  from `NAD_CLASS_NAMES` rather than kept in a parallel table (`L13`
  reconstructs all 31 full names from soil + qualifier).

### 11c. The pane is a tree

`shell/stages/geotechnical/geotechUnitTree.ts` builds soil ▸ NAD class ▸
instances; `GeotechnicalUnitRoster.tsx` renders it; `geotechBadges.tsx` holds
the two badges both levels share; `GeotechnicalInspector.tsx` keeps only the
panel chrome and the selected-body readout (debt #201 — the flat list fitted in
one file, the tree does not).

* Class row label = the firmness/density word. The soil is the header above.
* Bands are SUMMED per class across the unit instances carrying it.
* Badges roll up to the WORST value in the group — the severity ladders for
  both provenance and confidence are declared together at the top of
  `geotechUnitTree.ts`, because they are one rule applied to two badges.
* Instances render only when a class carries more than one. A class carried by
  exactly one unit IS that unit and takes its test ids; several units share the
  class key `"{SOIL}|{class}"` instead.
* Soil groups start expanded (the class row is the level an engineer works at);
  class rows start collapsed.

**"Empty" means the unit describes NOTHING in this model — no accepted band and
no layer — never "has no class".** A unit with no packing class but real bands
is unclassified GROUND and stays in the main tree; that row is the point. The
definition is the frontend twin of 10a's orphan predicate on purpose: the row
the pane drops is the row the next verb sweeps away.

**Empty rows are not listed, and there is no control to list them** (owner
ruling 2026-08-26: *"The show empty is weird though, if a bin is empty that
means there is nothing in it and nothing exists"*). The `show empty (N)` toggle
and the `emptyCount` that fed its label are gone: a count of invisible rows was
itself the thing that read as weird, and the orphan sweep deletes those units
shortly in any case.

**A colour the engineer picks wins over the automatic one.** The class-row
swatch is a native colour input (label-wrapped, committed on blur, the same
shape as the geological formation swatch in `GeologyInspector`), plus a reset
that returns the row to automatic. Storage is
`geological_formation.color_override`, nullable, NULL = "nobody chose" - the
`body.display_color` shape, chosen over a flag or a comparison-against-default
because `color` is a machine default (the materialiser copies the source litho
unit's colour at create) and because the engineer is allowed to pick exactly the
colour the NAD ramp would have produced. `utils/nadClasses.geotechUnitColor` is
the ONE rule (`color_override ?? nadClassColor(nad_class)`) and every geotech
surface asks it: the pane swatch, the section fills
(`SectionPanel.formationColorById`,
`contactsLayerGeometry.geotechDisplayFormation`), the 3-D solids (via
`nadColoredFormations`) and the 3-D legend. A class row standing for several
units shows a pick only when all of them agree — `utils/geotechRowColorOverride`
is that ROW-level rule, shared by this pane and the 3-D legend so the two cannot
disagree about one class. Editing a row writes every unit it stands for, so
mixed picks can only arrive from outside the pane.

## 12. Knowing when the litho moved under the bands (debt #266, 2026-08-26)

A packing band is derived from the litho stack under it, so editing that stack
leaves the band describing ground that is no longer there. The geotech model now
records what it built each column from, and says so when that stops holding.

**The stamp is per COLUMN, not per model.** `geological_model
.derived_from_litho_digests` is a JSONB `{column_id: digest}` on the geotech
model, beside `classified_with_statistic`. Per column because "1 · Subdivide
CPTs" and "4 · Divide boreholes" are two presses over disjoint column sets and
both honour `skip_existing` — a model legitimately holds columns built from
different litho revisions, and one model-level stamp would let a borehole press
clear the flag on a CPT column whose ground had moved. It is also the only
granularity that yields an actionable sentence: *"S17's litho changed after its
bands were made"* names the column to re-press.

**The digest is of the stack, not a counter each verb bumps.** `domain/services/
litho_column_digest.py` reduces a column's accepted `(depth_top, depth_base,
formation_id)` set to a `v1:<blake2b>` tag at millimetre resolution. Computed
FROM the rows, so no litho verb can forget to maintain it and no trigger can
move a row behind its back — which matters here specifically, because the
contiguity trigger rewrites a neighbour's `depth_base_m` without touching its
`updated_at`, and the litho↔contact mirror fires in both directions.

**Staleness is derived, never stored.** `GeotechLithoStaleness` recomputes
today's digests and compares. Re-pressing the named columns re-stamps them, so
the warning clears by doing the thing it asks for; there is no acknowledge
button and no clear-endpoint. A column with no stamp is NOT stale — unknown
provenance is not evidence of a move, and every project banded before this
shipped is in that state — but the count of unstamped banded columns is reported
separately, because an export guard has to tell "verified current" from "cannot
say".

**Two signals, one warning.** `utils/geotechParentFit.columnsNeedingRederive` is
the renderer-side check: instant, judging CPT and borehole bands alike, and
catching a band that overhangs its litho parent (the unit shrank) or whose parent
formation has no row left on the column (the unit was re-composed to another
soil or deleted — owner 2026-09-10, a sand band over a piece turned to GRIND on
an unstamped model). It stays blind to a unit that merely grew.
`utils/staleGeotechColumns.unionStaleGeotechColumns` merges it with the
provenance answer so the axis draws one amber mark per column
(`StaleColumnMarkers`) and the toolbar shows one count
(`geotech-stale-litho-chip`) — amber, never red: the bands are out of date, not
wrong.

**Seam for the export guard.** It reads `GeotechLithoStaleness` directly (session
+ geotech model id, no request context) and gates on `len(stale_columns)` and
`unstamped_column_count`. What it does about a non-zero value is its own
decision, not made here.

**Not covered, on purpose.** A body-wide aggregate shifting because a DIFFERENT
column in the same body was edited. Body regrouping and correlation edits change
lateral grouping, not a column's own intervals, and lighting up every column of a
body on every edit anywhere is the alarm fatigue this exists to avoid.

## Open dogfeed items (owner)

Tracked in `CLAUDE.local.md` → Active Focus: visual/gesture dogfeed of the
connect flow, the fraction-refinement render, and the two §8 interpretations.

Two items came off this list on 2026-08-26, both ruled by the owner and both
found ALREADY SHIPPED when the ruling was traced to the code:

* **NAD `gradient_snap` default = ON.** Ruled ON; it has defaulted ON since the
  knobs were first wired (`subdivide_all_bodies._read_gradient_snap`, the
  domain signature, and `GEOTECH_SUBDIVISION_DEFAULTS` all agree). A project
  that stored OFF keeps OFF -- a default applies in the absence of a choice,
  never over one. Both halves are now pinned
  (`tests/unit/application/test_geotech_gradient_snap_default.py`,
  `geotechSubdivisionPrefs.test.ts`); before that, the only frontend case
  compared the read against the defaults object, which passes whichever way
  the default points.
* **NAD-boundary line weight.** Ruled "lighten"; the subordinate treatment
  shipped 2026-08-09 (`d3d8cdd1d`) and is described above -- a within-unit
  packing boundary is mid-slate `#94a3b8`, dashed `5 4`, 1 px, against the
  litho contact's `#0f172a` solid 1.75 px. It was UNPINNED until
  `ContactsLayer.boundaryKinds.test.tsx`. In the gap fill the two never shared
  a stroke: the NAD sub-band seam is self-coloured at 0.75 px, and the
  near-black `#0d1117` outline is built from LITHO regions only.

## The 3-D builder closes a SUB-VOXEL interior void; clause 6 reports the rest (owner installer #41)

A section column can leave a void between two labelled entries when it reads a
SLOPED 2-D contact at a fraction -- the region above and the region below come
back a hairline apart. (The two-section blend never causes this: `_layout` is
gap-free by construction, so every interior gap in `label_voxels` comes from the
per-section column projection, not the blend.)

The size rule (owner ruling installer #41, 2026-09-16, *"Clause 6: close
interior voids smaller than voxel height?  Sounds about right"*):
`label_voxels._close_interior_voids(stack, dz)` (the un-bounded path only, which
is what the geology-independent geotech build runs) closes a void BETWEEN two
labelled entries -- below the ground/bed and above the model floor -- ONLY when
it is SHORTER than one voxel height (`dz`, the build's vertical spacing). The
sliver takes the label of the THICKER neighbour, or the UPPER one when the two
are equally thick. A void of ONE VOXEL HEIGHT OR MORE is a real gap: it is left
unknown and clause 6 (stack-voids) reports it. A BOTTOM void (below the deepest
entry -- a below-TD unknown) is never interior and is left exactly as it was
(owner ruling 2026-07-30, *"leave it unknown"*): `_interior_gaps` only ever
returns a gap sandwiched between two entries. This supersedes the installer-#40
pass that closed EVERY interior void whatever its height (which made clause 6
always read zero); the below-TD stance is untouched.

The close threshold and the clause-6 report threshold are ONE value -- the voxel
height `dz` -- so no gap falls between "closed" and "reported": the labeller
counts a surviving interior void of `dz` or more into `hairline_gaps_actionable`
and carries the voxel height on the report as `voxel_vertical_m`, which the
report assembler quotes as the action threshold. A report with no voxel height
(one stored before this rule, or a build that labelled no grid) falls back to the
`STACK_VOID_ACTIONABLE_M` 0.10 m floor. The smallest voxel height the build
request permits is 0.25 m, so the live threshold is always above that floor and a
surviving interior void always clears it too.

Clause 6's action line stays *"Send us the .strix file"* (a build defect, not a
user task; `geotech.clause.stack-voids.action` in `i18n/locales/{en,nl}/models.ts`)
and now names the size rule: the builder closes any gap smaller than one voxel, a
larger gap that remains is a build defect. Pinned by
`tests/unit/domain/services/voxel_litho/test_close_interior_voids.py` (a sub-voxel
void is closed, a void of one voxel or more stays and is reported, a below-TD void
is left unknown); `test_label_voxels.py` and `test_label_report_tripwires.py` pin
the sub-voxel close through the full labeller.

Measured at the default voxel height `dz = 1.0 m`: a well-filled model carries
only sub-voxel snap slivers (the owner's installer-#40 dogfeed model topped out at
154.5 mm, all below `dz`), so the builder closes them and clause 6 PASSES. Where a
build's 2-D section stacks still carry a genuine large gap -- the stored
3-section worked-example build has interior voids up to 5.83 m under a deep
isolated body at one section's end column -- those are one voxel or more and
clause 6 REPORTS them, rather than papering a real hole over.
