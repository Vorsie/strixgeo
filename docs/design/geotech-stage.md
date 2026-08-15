# Geotech Stage — current design (ACTIVE MILESTONE)

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

## 2. The direct partition — one engine, more classes (owner rulings 2026-08-13)

> *"we don't need to invent the fill bands engine, it is build for the litho
> stage — we only have more classes"* · *"you have to start from the exact
> litho geometries"*

**The geotech axis renders the DIRECT partition:**
`computeSectionFillActive(GEOTECH bands, GEOTECH ties, overrides, alongM)` —
the same computation the 3-D build has always used
(`makeVoxelRequestBuilder` → `buildVoxelRequest`). One engine, one input set,
so render and build cannot diverge, and the engineer's NAD correlations drive
the fill with litho's own 2/1/0 semantics (2 tied contacts = BAND, 1 = ONLAP,
0 = LENS) — nothing transposed, nothing re-derived.

**The litho geometry stays authoritative** three ways:

* **By construction — complete tie restatement.** Every direct litho tie
  restates onto the packing bands that own the same contact surfaces
  (`application/geotech_edge_derivation.py`): the topmost pair is FORCED
  regardless of class (`aligned_pairs_with_forced_top`), and a litho
  base↔base bottom tie restates as a base↔base edge between the two deepest
  bands. Both are born accepted — they carry the litho approval down (§4a).
  Without the class-blind forcing, a litho tie whose top bands differed in
  class never restated, and the fill redrew the litho boundary (the owner's
  clay case: the sand reached below the litho clay top because the machine
  had tied the contact to a band one step deeper).
* **By construction — the litho frame clip** (owner ruling 2026-08-14,
  "keep exactly the litho model and only subdivide bodies"):
  `utils/clipPartitionToLithoFrame.ts` overlays the two partitions in the v2
  arrangement (pre-splitting crossings/T-junctions in float — debt #271) and
  every face keeps its packing class only where its soil matches the litho
  region it sits in; foreign classes re-label to a same-soil class of the
  region; regions with no class of their soil fall back to litho colour;
  nothing exceeds the frame. The clip runs whenever the geotech and litho
  column sets match positionally; an undivided borehole (columns differ)
  keeps the raw partition + the whole-region fallback heuristic
  (`utils/geotechFillFallback.ts`) until step 4 divides it — the same answer
  the build has always had.
* **On screen.** The litho partition keeps rendering as the dark region
  outlines on top (`partition-litho-outline`); clip-fallback faces render
  litho-coloured beneath the packing fills (`partition-litho-fallback`).
* **Measured.** The litho-consistency gate (§7) rasterises the litho fill
  against the CLIPPED fill and ratchets the agreement per section.

**Render path.** The direct partition flows through the ordinary litho render
machinery in `PartitionFillOverlay` — the S61 dissolved fill layer, seam
strokes, under-column substrate — via per-axis sources in
`correlationOverlayAxis.ts` (`partitionLayerSource` / `partitionEdgeSource` /
`partitionColorSource`; the old always-litho edge guard is inverted, layers
and edges move together). The canvas ships a `geotechAxisModel` bundle; the
edge list is the same approved `geotechPackingEdges` the build reads
(suspended review ties included — parity with the build arm). Gesture
surfaces are gated on `viewOnly = axisMode === 'geotechnical'`; the "Show
litho fill" toggle swaps the partition source
(`selectSectionFill.showLithoFillInstead`).

This retired the fraction-space refinement from the render: the vertical
hairlines the owner circled (per-sample quads × doubled self-colour strokes
at 0.62 opacity) are gone structurally — one polygon per band. The
refinement modules (`refineLithoPartition.ts`, `.overlap.ts`,
`carveOverlayLenses.ts`, `geotechPackingTies.ts`) and their test/diag suites
are app-dead and get DELETED after owner dogfeed confirms; git holds the
2026-07-07..2026-08-12 design history.

Backend note that survives from the old model: `DivideBoreholes` re-runs the
shared edge derivation after borehole-band fill (Phase 8.5) and re-resolves
`body_id`, so borehole-mediated restatements appear without a manual step-2
press.

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
* (C) `ReSubdivideConfirmDialog` prompts before a re-subdivide clears
  connections;
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
merges its halves, a merge re-splits at the carried boundary, a lens absorb
re-splits at BOTH carried boundaries. Row ids change across redo cycles; a
closure-mutable id re-anchors them (the litho delete-undo pattern).

Owner rulings driving the shape are recorded in full in `docs/debt.md` #227.
The ones that constrain the code:

* **Hard bounds (ruling 2).** A packing boundary moves freely inside its litho
  body and clamps at the edge; it never moves a litho contact and never crosses
  a geological one. A litho body here is already geo-bounded, so "inside one
  litho body" enforces both walls in one test
  (`components/sections/geotechBandEdit.ts` — `clampSplitDepth`,
  `clampDragDepth`, `canMergeBands`). This is the ONE refusal that is correct
  rather than a defect. **The server's geo wall reads the LIVE contacts, not
  the bands' build-time stamps** (dogfeed 2026-08-12, GEO-23/125-S6): the
  engineer moved a geological contact on its own axis and the stamp-reading
  wall kept refusing his merges forever, with a message that steered him
  toward a re-subdivide — which deletes every hand edit on every column. Now
  `load_geotech_column_context` carries the live contacts, the planners refuse
  only a contact strictly inside the span (GW1–GW4, GL1/GL2), and every
  band-edit writer takes the written interval's geological parent from the
  live model (`geo_parent_for_interval`), so a hand edit heals a stale stamp
  on touch. Residual, deliberate: bands NOT touched after a geology-axis
  contact move keep their stale stamps (and their `enclosing_litho_bounds`
  clamp runs split at the old position) until an edit or a re-subdivide
  touches them — the reverse coupling (a geo-axis move carrying a coinciding
  band boundary) is undesigned.
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
Borehole columns are refused every verb — their bands carry no qc to re-derive
from (`require_cpt_anchor`; GB8 pins all six routes).

DB-level behaviour is exercised by
`tests/integration/api/test_geotech_band_edit_endpoints.py` (GB1–GB16, wrapper
only): the LL→FC mirror trigger on geotech rows, contiguity at commit,
formation find-or-create, the accepted-tie transfer + flag/self-heal, the
borehole refusal, locality, preview≡commit, the N-run merge, and the statistic
threading end to end.

⚠ **"Subdivide all bodies" deletes and rebuilds the entire geotech model**, so
it destroys every hand split and merge. `ReSubdivideConfirmDialog` warns first
and names the count of hand-edited bands (`source='manual'`); accepted ties are
carried across per §5. What is NOT carried is the hand band geometry itself.

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
re-deriving. **Nothing rebuilds automatically** — `subdivide-cpts` is model-wide
and begins by deleting every geotech row, so an automatic rebuild would destroy
every hand edit on every column as a side effect of fixing one contact.

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

"Subdivide all bodies" throws every geotech band away and rebuilds it with a
fresh `uuid7`, and both endpoint FKs on `litho_contact_correlation_edge` are
`ON DELETE CASCADE`. So Postgres deletes every correlation edge as a side effect
of the layer wipe — silently, without passing through application code. Sparing
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
Subdivide reports the count, because the badges only reach someone looking at the
section they sit on and a re-subdivide is model-wide.

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

**Scope: this previews the FIRST divide of a column, not a re-divide.** A column
carrying committed bands drops its ghosts, so pressing `Divide boreholes` a
second time is as blind as before — `boreholesStale` says the bands are out of
date, not what they would become. Deliberate: drawing a plan over the rows it
would REPLACE needs a diff render (outline-only against the committed bands),
which is its own design question. The backend is already ready for it (DB7).
Tracked as a small item in `docs/debt.md`.

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

**Two interpretations, owner veto pending:**

* *Mismatched flank sequences* → the nearer flank's stack verbatim. There is no
  honest pairing between two different class lists; this follows the earlier
  "nearest test that does have packing" ruling.
* *Several sections* → the section whose flanking pair is tightest (least
  extrapolation). **This one is consequential**: on B4's shallow sand body,
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
| 4 | divide boreholes | `POST .../geotech/divide-boreholes` (litho model) | model-wide by nature; gated on step 3; optional `borehole_ids` subset |

The accept verbs are the litho axis's own — `AcceptContactCorrelations` has
never been litho-specific, and the router applies no kind guard — so step 3 is
reuse, not a second implementation. Nothing was duplicated for the geotech axis.

`POST .../geotech/subdivide-all-bodies` still works and now declares what it is:
the COMBINED verb, running steps 1 + 2 in one press, answering
`edges_derived: true` and `proposed_tie_count`. Its derived edges have been
proposals since 2026-08-01; the response is what changed.

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

### "Check if the ties stay in the litho body" — the fraction rule

**Owner ruling:** *check if the ties stay in the litho body otherwise rescale
based on the litho thickness at that location.* A tied surface is read as a
fraction of each donor's own litho extent and re-laid at that fraction of the
BOREHOLE's extent (`flank_packing_surfaces`, unchanged from §8), so a litho body
that thins at the borehole rescales the surfaces instead of letting them walk
out of the envelope. Pinned by `test_geotech_tie_donors.py::T5` (2 m body) and
`test_divide_boreholes_plan.py::P8`, which runs the same donors against a 2 m
and a 1 m extent and requires 40 % of *whatever thickness is there*.

### What this changes on the dev model today: nothing, and why

All 217 accepted ties in the dev DB are CPT↔CPT and **none of them straddles a
borehole column** — they join adjacent CPTs, because the derivation that made
them stopped at borehole columns. So `diag_divide_borehole_explain.py "126-B4"`
is byte-identical before and after: 15 bands, 12 `single_donor` + 3
`flank_interpolated`, no `tie_interpolated`; model-wide the census is unchanged
at 139 `single_donor` / 32 `flank_interpolated` / 4 `nearest_fallback` / 9
`absolute_min` / 2 `body_min`. The rule only bites once the engineer re-runs the
new pipeline: the 76 straddling jump pairs are exactly the ties that can then
name a donor pair.

### The renderer half (2026-08-05)

The four verbs are four numbered toolbar buttons on the geotech axis, in press
order, replacing the single "Subdivide all bodies" press:

| button | testid | verb | gating |
|---|---|---|---|
| **1 · Subdivide CPTs on this section** | `geotech-subdivide-cpts` | `subdivide-cpts` | needs a litho model **and an open section**; a RE-run still opens `ReSubdivideConfirmDialog` |
| **1 · Subdivide CPTs on all sections** | `geotech-subdivide-cpts-all` | `subdivide-cpts` (no `section_id`) | needs a litho model |
| **2 · Auto-correlate on this section** | `geotech-auto-correlate` | `auto-correlate` | needs the geotech model + an open section |
| **2 · Auto-correlate on all sections** | `geotech-auto-correlate-all` | `auto-correlate` (no `section_id`) | needs the geotech model |
| **3 · Accept ties on this section** | `geotech-accept-correlations` | `contact-correlations/accept` | needs the geotech model + an open section |
| **3 · Accept ties on all sections** | `geotech-accept-correlations-all` | `contact-correlations/accept` (no `section_id`) | needs the geotech model |
| **4 · Divide boreholes (whole model)** | `geotech-divide-boreholes` | `divide-boreholes` | **disabled while `pending > 0` anywhere in the model** |

`GET .../geotech/tie-status` feeds `useGeotechTieStatus`, re-read after EVERY
verb (steps 1–4 and each single-tie accept). Its `pending_by_section` breakdown
feeds the pure `utils/geotechPendingScope.ts`, which owns every sentence the
toolbar says about outstanding ties: the amber chip
(`geotech-pending-tie-chip`) reports THIS section's count with the model total
in its tooltip, and step 4's visible tag reads `accept 12 on 2 sections`. Because
Chromium fires no mouse events on a `disabled` element, step 4's explanation
lives on a `role="presentation"` span wrapper — the same device the axis toggle
uses. When the breakdown is missing (older backend, request not landed) the
helpers degrade to the bare model total rather than claiming "0 sections
pending" beside a disabled button.

### 9a. Steps 1–3 follow the open section (owner ruling 2026-08-15)

**Owner ruling.** *"I also see that this is model wide and not per section, i
don't like that"* and *"i want subdivide cpt's also to be section scoped, i
don't want any cpt's that aren't on any sections to be subdivided and included
in the model"*.

Each of the first three steps takes an OPTIONAL `section_id` in its request
body — present scopes the run to that section, absent is the historic
model-wide behaviour every existing caller relies on. The toolbar's primary
item sends the open section's id and a second item beside it sends none. This
REVERSES the 2026-08-05 review MAJOR-2 decision (model-wide feeder verbs so the
model-wide step-4 gate could be satisfied); the objection is answered instead by
the "on all sections" items plus a gate that now names the sections still
pending.

**Step 4 stays model-wide** — `divide-boreholes` TIN-divides every borehole
column and so rewrites every section. Its gate therefore still demands the whole
model be clear, which is fair only because the tag says how many sections are
holding it shut.

⚠ **A scoped step 1 still WIPES the whole geotech model.** `SubdivideAllBodies`
has always been wipe-and-rebuild (`_delete_all_geotech_data` is model-wide, and
the tie re-anchor + body resolver run model-wide with it), which is why a re-run
is gated behind `ReSubdivideConfirmDialog`. `section_id` narrows WHICH columns
are rebuilt, not what is wiped: on a multi-section model, columns on the other
sections lose their bands until step 1 is run again without a scope. **Owner
confirmation pending** — the alternative (a section-scoped delete) is a
substantial change to the most destructive path in the stage.

**The membership invariant** (`application/section_membership.py`) applies in
BOTH modes and to `DivideBoreholes` as well: an investigation that projects onto
no cross-section is never subdivided and never enters the geotech model.
Membership is decided by `project_investigations_onto_section` — the same rule
the section view, the DXF/PDF render and the edge derivation use, and one that
already honours a section's `excluded_cpt_ids` / `excluded_borehole_ids`, so a
column excluded everywhere it projects counts as off-section. The skipped set is
logged at INFO **by name** and reported as `skipped_off_section_count` /
`skipped_off_section_labels`, which the step-1 toast repeats: a model that came
out smaller on purpose must say so, or the omission surfaces in an export.
Verified 2026-08-15 that the `DivideBoreholes` half was NOT redundant — before
the guard, an off-section borehole sharing a body with an on-section CPT was
filled from that CPT's transition surfaces.

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
date. The committed rows then drop that column's ghosts and leave every other
column's alone.

## Open dogfeed items (owner)

Tracked in `CLAUDE.local.md` → Active Focus: visual/gesture dogfeed of the
connect flow, the fraction-refinement render, the NAD `gradient_snap` default
decision, the NAD-boundary line weight call, and the two §8 interpretations.
