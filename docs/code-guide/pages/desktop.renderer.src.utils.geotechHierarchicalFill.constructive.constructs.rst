desktop.renderer.src.utils.geotechHierarchicalFill.constructive.constructs
==========================================================================

.. CG-PAGE source=desktop/src/renderer/src/utils/geotechHierarchicalFill/constructive/constructs.ts complete=true

*Source file:* ``desktop/src/renderer/src/utils/geotechHierarchicalFill/constructive/constructs.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-41

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechHierarchicalFill/constructive/constructs.ts
   :language: typescript
   :lines: 1-41
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Opens Phase 1 of the fill, THE LINES. For each band of a family on the two tests a gap runs between, this module works out the ties on the band's contacts, reads what each shows at its far end, asks the law what to emit, and draws that shape. A tie is a correlation — a line the engineer drew tying one column's contact to the next. It imports the taper, reads-the-ground, cover-weld, emit-kernel (the law), far-band and onlap-resting helpers plus the shared section-partition types.

**Why it is here.** Owner 2026-08-19: 'we said first draw all lines, lenses, onlaps, vertical lines, this makes closed loops, then we fill everything and merge it'. The docstring stresses that this module takes no decision of its own — it is geometry — and names the three things it must get right, all the owner's words: a tie is drawn on a shared contact (so the clay-top tie under a sand band is that sand's bottom tie); the far end of a tie is the band on the same side of the contact over there; and an untied contact holds the band's own flat level, unless it is the parent litho unit's own boundary (ruling A) or a same-mass weld (2026-08-26).

.. CG-EXPLANATION-END id=module-header

``const MIN_REACH_FRACTION``
----------------------------

.. CG-BLOCK id=const:MIN_REACH_FRACTION lines=42-43

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechHierarchicalFill/constructive/constructs.ts
   :language: typescript
   :lines: 42-43
   :lineno-match:

.. CG-EXPLANATION-START id=const:MIN_REACH_FRACTION

**What this does.** A constant, 1e-3 — the smallest fraction of the gap a lens may reach before it is treated as a hair.

**Why it is here.** It is the floor that stops the repeated halving of a lens's reach from shrinking the pinch all the way to nothing.

.. CG-EXPLANATION-END id=const:MIN_REACH_FRACTION

``const LENS_COLLISION_SAMPLES``
--------------------------------

.. CG-BLOCK id=const:LENS_COLLISION_SAMPLES lines=44-46

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechHierarchicalFill/constructive/constructs.ts
   :language: typescript
   :lines: 44-46
   :lineno-match:

.. CG-EXPLANATION-START id=const:LENS_COLLISION_SAMPLES

**What this does.** A constant, 8 — how many points along a lens flank are tested against a tie line when checking whether the lens would cross it.

**Why it is here.** The crossing test cannot check a whole edge at once, so it samples the flank at discrete points; eight is the sampling density chosen for that check.

.. CG-EXPLANATION-END id=const:LENS_COLLISION_SAMPLES

``interface RunBand``
---------------------

.. CG-BLOCK id=interface:RunBand lines=47-66

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechHierarchicalFill/constructive/constructs.ts
   :language: typescript
   :lines: 47-66
   :lineno-match:

.. CG-EXPLANATION-START id=interface:RunBand

**What this does.** The shape of one packing band in absolute elevation on a known column: its layer, formation and body ids; its top and base elevation in metres TAW (the Belgian height datum, where 0 m is a real elevation, never a missing marker); the frame column index and along-section position it stands on; optional flags marking whether a contact is the parent litho unit's own boundary; and an optional carry.

**Why it is here.** This is the atom the whole constructive arm passes around. The geometry works in absolute elevation and along-section metres, so the band is stored that way rather than as a depth below surface.

.. CG-EXPLANATION-END id=interface:RunBand

``interface RunColumn``
-----------------------

.. CG-BLOCK id=interface:RunColumn lines=67-74

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechHierarchicalFill/constructive/constructs.ts
   :language: typescript
   :lines: 67-74
   :lineno-match:

.. CG-EXPLANATION-START id=interface:RunColumn

**What this does.** One banded column of a family: its frame column index, its along-section position, and its bands shallowest-first.

**Why it is here.** It groups a column's bands so a run can be handled as a simple left-to-right list of these columns.

.. CG-EXPLANATION-END id=interface:RunColumn

``interface RunTie``
--------------------

.. CG-BLOCK id=interface:RunTie lines=75-86

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechHierarchicalFill/constructive/constructs.ts
   :language: typescript
   :lines: 75-86
   :lineno-match:

.. CG-EXPLANATION-START id=interface:RunTie

**What this does.** One packing tie between two bands, stored as a straight line: an order-invariant key identifying the correlation it came from, plus the left and right column indices, positions and elevations of its two ends.

**Why it is here.** A tie is drawn as a straight line between two contacts, so it is kept as its two endpoints; the key is order-invariant so it names the same edge whichever end is listed first.

.. CG-EXPLANATION-END id=interface:RunTie

``interface BandConstruct``
---------------------------

.. CG-BLOCK id=interface:BandConstruct lines=87-149

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechHierarchicalFill/constructive/constructs.ts
   :language: typescript
   :lines: 87-149
   :lineno-match:

.. CG-EXPLANATION-START id=interface:BandConstruct

**What this does.** One band's construct in one gap: what the law emits (lens, onlap or nothing); its top and base boundaries as functions of along-x; a lens's closing position; an onlap's apex elevation and its free contact stated once as a polyline; the two carry fields for a band still closing as it crosses a blind column; whether each contact rides its tie or holds its own flat level; and the far column's position.

**Why it is here.** The field comments pin several rulings. The apex is computed once as a single vertex (owner verification contract, 2026-08-25) so the wedge closes exactly with no epsilon-wide sliver left for the arrangement to mint. The free contact is stated once so the drawn line and the ownership test state one shape rather than two — the fix for the plunging-tie bug. The extend-to-far flag handles sub-TD ground where there is nothing over there to meet (owner 2026-08-21). The tied flags say whether the construct rides a tie line or is a flat boundary of its own.

.. CG-EXPLANATION-END id=interface:BandConstruct

``const contactKey``
--------------------

.. CG-BLOCK id=const:contactKey lines=150-153

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechHierarchicalFill/constructive/constructs.ts
   :language: typescript
   :lines: 150-153
   :lineno-match:

.. CG-EXPLANATION-START id=const:contactKey

**What this does.** A tiny helper turning a column index plus an elevation into a string identity on the millimetre grid.

**Why it is here.** It gives every contact a stable string key so contacts can be collected in a set and compared exactly, despite float noise, when counting which of a band's contacts are tied.

.. CG-EXPLANATION-END id=const:contactKey

``function runBandsOf``
-----------------------

.. CG-BLOCK id=function:runBandsOf lines=154-186

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechHierarchicalFill/constructive/constructs.ts
   :language: typescript
   :lines: 154-186
   :lineno-match:

.. CG-EXPLANATION-START id=function:runBandsOf

**What this does.** Builds the family bands of one column, shallowest-first, converting each unit's depths into elevations (surface elevation minus depth) and stamping on the column index and along-section position.

**Why it is here.** It converts the stored depth-below-surface form into the absolute-elevation, along-metres form the rest of the geometry works in.

.. CG-EXPLANATION-END id=function:runBandsOf

``function resolveRunTies``
---------------------------

.. CG-BLOCK id=function:resolveRunTies lines=187-278

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechHierarchicalFill/constructive/constructs.ts
   :language: typescript
   :lines: 187-278
   :lineno-match:

.. CG-EXPLANATION-START id=function:resolveRunTies

**What this does.** Turns candidate packing edges into straight tie lines and reports crossings. It gathers this family's contacts, builds each raw tie (placing an out-of-run endpoint by its own along-section position), keeps a tie only when it lands on a family contact, then scans each gap pairwise for crossings and suspends both ties of every crossing pair.

**Why it is here.** Owner ruling Q4: crossing approved ties are a hard conflict, so both are dropped, the bands fall back to their no-tie construct, and the pair is reported for the warning chip. One end inside the run is enough (owner 2026-08-21, 'two ties is two tied contacts'): the line is drawn between two real tests and bounds the contact it lands on whatever lies at its far end. The crossing scan is a symmetric pairwise comparison, so it cannot depend on the order the rows arrived in.

.. CG-EXPLANATION-END id=function:resolveRunTies

``function tieElevAt``
----------------------

.. CG-BLOCK id=function:tieElevAt lines=279-285

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechHierarchicalFill/constructive/constructs.ts
   :language: typescript
   :lines: 279-285
   :lineno-match:

.. CG-EXPLANATION-START id=function:tieElevAt

**What this does.** Returns a tie's elevation at a given along-section position, by straight-line interpolation between its two endpoints.

**Why it is here.** A tie is drawn as a straight line, so its height at any position is a linear interpolation of its two ends.

.. CG-EXPLANATION-END id=function:tieElevAt

``function crossesGap``
-----------------------

.. CG-BLOCK id=function:crossesGap lines=286-299

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechHierarchicalFill/constructive/constructs.ts
   :language: typescript
   :lines: 286-299
   :lineno-match:

.. CG-EXPLANATION-START id=function:crossesGap

**What this does.** Answers whether a tie spans the gap between two run columns — its low column index at or left of the gap's left, its high index at or right of the gap's right.

**Why it is here.** Only a tie that actually crosses this gap may bound a contact within it, so this filter is applied before a tie is considered here.

.. CG-EXPLANATION-END id=function:crossesGap

``function tieOnContact``
-------------------------

.. CG-BLOCK id=function:tieOnContact lines=300-342

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechHierarchicalFill/constructive/constructs.ts
   :language: typescript
   :lines: 300-342
   :lineno-match:

.. CG-EXPLANATION-START id=function:tieOnContact

**What this does.** Finds the single tie bounding one contact of one column across this gap. Where several ties name the same contact (a fan), it breaks the tie deterministically: the one reaching the facing test wins, then the nearest partner, then the lowest far elevation.

**Why it is here.** A contact is shared by the bands above and below it, so a tie drawn on it bounds both. The tie-break is fully ordered so the winner never depends on the order the rows arrived in.

.. CG-EXPLANATION-END id=function:tieOnContact

``function fanWeldsSameMass``
-----------------------------

.. CG-BLOCK id=function:fanWeldsSameMass lines=343-366

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechHierarchicalFill/constructive/constructs.ts
   :language: typescript
   :lines: 343-366
   :lineno-match:

.. CG-EXPLANATION-START id=function:fanWeldsSameMass

**What this does.** Answers whether ANY tie of a contact's fan reaches a same-mass far end, surveying them all run-wide rather than just one.

**Why it is here.** Owner ruling 2026-08-21: a contact may carry several ties (the fan), and the far-end read must survey them all because one same-mass end welds the contact whatever the others say. Reading only one tie let a band's tail read an empty far end and call itself an onlap while its jump tie to a same-mass body said weld the whole time. A tie whose far side holds no band states nothing about the mass.

.. CG-EXPLANATION-END id=function:fanWeldsSameMass

``function lensReach``
----------------------

.. CG-BLOCK id=function:lensReach lines=367-399

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechHierarchicalFill/constructive/constructs.ts
   :language: typescript
   :lines: 367-399
   :lineno-match:

.. CG-EXPLANATION-START id=function:lensReach

**What this does.** Computes a lens's reach: the standard pinch fraction, halved repeatedly while the diamond would cross a tie line, and floored at ``MIN_REACH_FRACTION``. The crossing test samples both flanks against every gap tie.

**Why it is here.** This is the litho engine's own ruling 8t, 'just halve the length to 0.225': a lens may never cross a correlation, because the line is the statement and the lens must close short of it.

.. CG-EXPLANATION-END id=function:lensReach

``function buildGapConstructs``
-------------------------------

.. CG-BLOCK id=function:buildGapConstructs lines=400-768

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechHierarchicalFill/constructive/constructs.ts
   :language: typescript
   :lines: 400-768
   :lineno-match:

.. CG-EXPLANATION-START id=function:buildGapConstructs

**What this does.** For both columns of the gap and each band, it finds the top and base ties, reads each tie's far mass (with the fan-weld and cover-weld special cases), decides whose line each contact is — ride the tie, hold a flat level, or the contested case that becomes a vertical seam — then asks the law what to emit and pushes the resulting construct. An onlap pinches to a single computed apex vertex; a lens tapers to its apex, or extends flat to the far column when that test is blind (with an optional carried taper); a spanning 'nothing' band follows both its lines. A second pass rests each onlap's free contact on the construct below it.

**Why it is here.** Nearly every owner ruling of the stage is threaded through here as comments. Ruling A's geometry half (2026-08-22): an untied contact that is the parent unit's own boundary follows the litho line, not a flat level. The cover weld (2026-08-26): a same-mass far band across a cover boundary counts as tied. The termination clause (2026-08-20): a construct owns at most its own half of the gap. One tie always onlaps that tie, thickness never consulted (2026-08-25). Two tied contacts make a band that follows both ties unconditionally (2026-08-22). The apex is one vertex computed once (verification contract), and the free contact converges on it to fix the plunging-tie inside-out wedge (owner dogfeed 2026-08-26). A lens facing no data extends to the far column (owner 2026-08-21). The onlap-rest second pass runs separately because bands are built shallowest-first, so the mass below an onlap does not yet exist when the onlap is emitted.

.. CG-EXPLANATION-END id=function:buildGapConstructs

``function seamMeets``
----------------------

.. CG-BLOCK id=function:seamMeets lines=769-788

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechHierarchicalFill/constructive/constructs.ts
   :language: typescript
   :lines: 769-788
   :lineno-match:

.. CG-EXPLANATION-START id=function:seamMeets

**What this does.** Answers whether this gap draws the vertical 'two statements meet' seam — true only where two onlaps reach from opposite tests, or two open (nothing) masses span into each other.

**Why it is here.** The owner's table says 'if it is different then vertical line in the middle', and the reviewer finding of 2026-08-22 sharpened it: the line exists only where two statements actually MEET. A lone onlap, or a lone open mass with nothing disagreeing on the facing side, has nobody to meet, so no seam is drawn and the ground fills through instead — the SF silt case.

.. CG-EXPLANATION-END id=function:seamMeets

``function claims``
-------------------

.. CG-BLOCK id=function:claims lines=789-824

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechHierarchicalFill/constructive/constructs.ts
   :language: typescript
   :lines: 789-824
   :lineno-match:

.. CG-EXPLANATION-START id=function:claims

**What this does.** Answers whether a construct's own shape contains a point. A 'nothing' band owns everything between its two contact lines and is not capped at the middle; every other construct owns at most its own half of the gap, and a lens or onlap also stops at its apex; a construct extended to the far column owns its window the whole way across.

**Why it is here.** This is the termination clause (owner 2026-08-20, 'an onlap can't paint over ground near test itself, it terminates at 0.5 Distance approximately') applied to every construct, not just onlaps — without it a construct riding a tie painted over ground the facing test itself measured (44 of 1120 own-edge samples wrong before, 0 after). A 'nothing' band is uncapped because the mass at the other end of its ties is the same, so both halves paint one class and the merge welds them; an extended construct is uncapped because the far half is below the facing test's drilled depth, so there is no facing statement for the middle to protect.

.. CG-EXPLANATION-END id=function:claims

