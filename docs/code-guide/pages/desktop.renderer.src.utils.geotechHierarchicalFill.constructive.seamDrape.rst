desktop.renderer.src.utils.geotechHierarchicalFill.constructive.seamDrape
=========================================================================

.. CG-PAGE source=desktop/src/renderer/src/utils/geotechHierarchicalFill/constructive/seamDrape.ts complete=true

*Source file:* ``desktop/src/renderer/src/utils/geotechHierarchicalFill/constructive/seamDrape.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-68

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechHierarchicalFill/constructive/seamDrape.ts
   :language: typescript
   :lines: 1-68
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** This module smooths a specific ugly join. When two facing stacks of bands close against each other at a mid-gap seam, ``stackedSeamHalf.ts`` lets them meet in a vertical step, which the owner accepted in general. This file handles the one case where that step should instead drape: where a lens is cut back from one test, the mass on the other side follows the seam up to the tongue tip, then follows the lens's own flank down, so there is no cliff and no orphan diagonal. It imports the band shape and the stacked-seam helper.

**Why it is here.** Owner, 2026-08-25, Cross-section 3 gap 6: "why doesn't the dense sand just follow the lens flank up to the flat tongue point" and "yes C is the ruling, implement it, looks best in this particular case, make sure you test so it doesn't affect other cases". The rule is three geometric facts — a step has two ends belonging to different halves, a notch is a construct cut into the cover facing the seam, and the join replaces the step's vertical with the tongue tip, the notch's point, and that flank's landing. It deliberately refuses a step whose two ends are one half's own contacts, a notch whose point is not strictly inside the step, and anything ambiguous — "it doesn't affect other cases" is half the ruling, so when more than one reading qualifies the plain vertical stands.

.. CG-EXPLANATION-END id=module-header

``const LEVEL_EPS``
-------------------

.. CG-BLOCK id=const:LEVEL_EPS lines=69-76

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechHierarchicalFill/constructive/seamDrape.ts
   :language: typescript
   :lines: 69-76
   :lineno-match:

.. CG-EXPLANATION-START id=const:LEVEL_EPS

**What this does.** A constant: an elevation tolerance, a millionth of a metre, for "strictly inside" and "at or past".

**Why it is here.** Contacts arrive as surface-minus-depth on a millimetre grid, so a millimetre is the finest real distinction; this sits three orders below it, tight enough to refuse a point level with a step's own end and loose enough that floating-point noise on a shared contact is not mistaken for a step.

.. CG-EXPLANATION-END id=const:LEVEL_EPS

``const SEGMENT_MIN_SPAN``
--------------------------

.. CG-BLOCK id=const:SEGMENT_MIN_SPAN lines=77-88

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechHierarchicalFill/constructive/seamDrape.ts
   :language: typescript
   :lines: 77-88
   :lineno-match:

.. CG-EXPLANATION-START id=const:SEGMENT_MIN_SPAN

**What this does.** The smallest elevation span, a millionth of a metre, that is a real interval rather than a shared contact stated twice.

**Why it is here.** Two stacks routinely state the same contact, putting two breakpoints a hair apart, and sampling the sliver between them would read noise.

.. CG-EXPLANATION-END id=const:SEGMENT_MIN_SPAN

``const COVER_EDGE_EPS``
------------------------

.. CG-BLOCK id=const:COVER_EDGE_EPS lines=89-91

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechHierarchicalFill/constructive/seamDrape.ts
   :language: typescript
   :lines: 89-91
   :lineno-match:

.. CG-EXPLANATION-START id=const:COVER_EDGE_EPS

**What this does.** How close, in fraction, a notch's flank must stand to a cover edge to count as on it — the same tolerance ``pocketFaces`` anchors on.

**Why it is here.** Same measured reason: the litho fill insets its regions by a real distance so a cover edge lands at 0.9956 or 0.9996, and the arrangement grids fractions anyway; a notch's flanks are the cover's own vertices so they agree far better, and this only exists so "the edge" means the cover's, not a literal 1.

.. CG-EXPLANATION-END id=const:COVER_EDGE_EPS

``type SeamSide``
-----------------

.. CG-BLOCK id=type:SeamSide lines=92-94

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechHierarchicalFill/constructive/seamDrape.ts
   :language: typescript
   :lines: 92-94
   :lineno-match:

.. CG-EXPLANATION-START id=type:SeamSide

**What this does.** A named pair of values, ``left`` or ``right`` — which half of a stacked seam something belongs to.

**Why it is here.** The whole module reasons about left half versus right half, so a named value keeps that unambiguous.

.. CG-EXPLANATION-END id=type:SeamSide

``interface DrapePoint``
------------------------

.. CG-BLOCK id=interface:DrapePoint lines=95-100

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechHierarchicalFill/constructive/seamDrape.ts
   :language: typescript
   :lines: 95-100
   :lineno-match:

.. CG-EXPLANATION-START id=interface:DrapePoint

**What this does.** A point in the gap's own space: a fraction across and an elevation in metres TAW.

**Why it is here.** It is the coordinate the drape's path is stated in.

.. CG-EXPLANATION-END id=interface:DrapePoint

``interface CoverEdges``
------------------------

.. CG-BLOCK id=interface:CoverEdges lines=101-106

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechHierarchicalFill/constructive/seamDrape.ts
   :language: typescript
   :lines: 101-106
   :lineno-match:

.. CG-EXPLANATION-START id=interface:CoverEdges

**What this does.** Where the seam's two tests stand, in the cover's own fraction space — a low and a high edge.

**Why it is here.** Same shape and same reason as the identically named holder in ``pocketFaces``: the tests are not at a literal 0 and 1.

.. CG-EXPLANATION-END id=interface:CoverEdges

``interface ElevationRange``
----------------------------

.. CG-BLOCK id=interface:ElevationRange lines=107-112

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechHierarchicalFill/constructive/seamDrape.ts
   :language: typescript
   :lines: 107-112
   :lineno-match:

.. CG-EXPLANATION-START id=interface:ElevationRange

**What this does.** The elevation span the cover occupies — a low and a high — the range the seam is walked inside.

**Why it is here.** The seam is only meaningful where the cover has ground, so the walk is bounded to this range.

.. CG-EXPLANATION-END id=interface:ElevationRange

``interface SeamDrapeInput``
----------------------------

.. CG-BLOCK id=interface:SeamDrapeInput lines=113-130

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechHierarchicalFill/constructive/seamDrape.ts
   :language: typescript
   :lines: 113-130
   :lineno-match:

.. CG-EXPLANATION-START id=interface:SeamDrapeInput

**What this does.** The data shape holding everything the drape is read from: the two stacks the seam stands between, where the seam is, the family's own cover rings, where the tests stand, the cover's elevation span, the mass-identity function, and a band's NAD-class function for the least-dense rule.

**Why it is here.** It gathers the drape's inputs into one value so the reader function's signature stays short.

.. CG-EXPLANATION-END id=interface:SeamDrapeInput

``interface SeamDrape``
-----------------------

.. CG-BLOCK id=interface:SeamDrape lines=131-140

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechHierarchicalFill/constructive/seamDrape.ts
   :language: typescript
   :lines: 131-140
   :lineno-match:

.. CG-EXPLANATION-START id=interface:SeamDrape

**What this does.** The result shape: the three-point path that replaces the step's vertical (tongue tip at the seam, the notch's point, the flank's landing), which half owns the ground between the seam and the drape, and where the seam it detours stands.

**Why it is here.** It is the single answer the fill draws and reads ownership from.

.. CG-EXPLANATION-END id=interface:SeamDrape

``interface SeamStep``
----------------------

.. CG-BLOCK id=interface:SeamStep lines=141-149

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechHierarchicalFill/constructive/seamDrape.ts
   :language: typescript
   :lines: 141-149
   :lineno-match:

.. CG-EXPLANATION-START id=interface:SeamStep

**What this does.** A private data shape for one stretch of seam over which the two halves answer different masses, carrying its low and high elevations and, where exactly one half changed at that end, which half's contact that end is.

**Why it is here.** Whose contact each end is tells a genuine step between the two halves from one half's band merely pinching against ground the other holds continuously.

.. CG-EXPLANATION-END id=interface:SeamStep

``interface Segment``
---------------------

.. CG-BLOCK id=interface:Segment lines=150-157

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechHierarchicalFill/constructive/seamDrape.ts
   :language: typescript
   :lines: 150-157
   :lineno-match:

.. CG-EXPLANATION-START id=interface:Segment

**What this does.** A private data shape for one elevation interval between two adjacent contacts, recording what each half says there.

**Why it is here.** The seam is walked interval by interval, and this holds each interval's two answers.

.. CG-EXPLANATION-END id=interface:Segment

``interface CoverNotch``
------------------------

.. CG-BLOCK id=interface:CoverNotch lines=158-172

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechHierarchicalFill/constructive/seamDrape.ts
   :language: typescript
   :lines: 158-172
   :lineno-match:

.. CG-EXPLANATION-START id=interface:CoverNotch

**What this does.** A private data shape for one construct cut into a cover edge: which edge, its point, and its two flanks.

**Why it is here.** A notch is what the tongue reaches out to, so it is stored with its point and flanks ready to test.

.. CG-EXPLANATION-END id=interface:CoverNotch

``function seamDrapeOf``
------------------------

.. CG-BLOCK id=function:seamDrapeOf lines=173-201

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechHierarchicalFill/constructive/seamDrape.ts
   :language: typescript
   :lines: 173-201
   :lineno-match:

.. CG-EXPLANATION-START id=function:seamDrapeOf

**What this does.** The entry point. It finds the cover's notches and the seam's steps, tries every notch against every step, and returns the single drape when exactly one qualifies — otherwise nothing, meaning the seam keeps the vertical it already drew.

**Why it is here.** Invent nothing: more than one reading of the same seam is not a tie to break but a scene the ruling does not describe, and the accepted vertical is the honest answer there.

.. CG-EXPLANATION-END id=function:seamDrapeOf

``function drapeHolds``
-----------------------

.. CG-BLOCK id=function:drapeHolds lines=202-216

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechHierarchicalFill/constructive/seamDrape.ts
   :language: typescript
   :lines: 202-216
   :lineno-match:

.. CG-EXPLANATION-START id=function:drapeHolds

**What this does.** Asks whether a given sample point belongs to the drape's near half — true only between the seam and the drape line, over the drape's own elevation window.

**Why it is here.** Outside that window the seam is the vertical it always was, so this confines the drape's claim to exactly the pocket it opened.

.. CG-EXPLANATION-END id=function:drapeHolds

``function drapeFractionAt``
----------------------------

.. CG-BLOCK id=function:drapeFractionAt lines=217-239

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechHierarchicalFill/constructive/seamDrape.ts
   :language: typescript
   :lines: 217-239
   :lineno-match:

.. CG-EXPLANATION-START id=function:drapeFractionAt

**What this does.** Returns the drape line's own fraction at a given elevation, or nothing outside its window. It walks the path's segments and interpolates within the one spanning that elevation.

**Why it is here.** It is the geometric worker ``drapeHolds`` needs to know which side of the drape a sample is on.

.. CG-EXPLANATION-END id=function:drapeFractionAt

``function seamSteps``
----------------------

.. CG-BLOCK id=function:seamSteps lines=240-313

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechHierarchicalFill/constructive/seamDrape.ts
   :language: typescript
   :lines: 240-313
   :lineno-match:

.. CG-EXPLANATION-START id=function:seamSteps

**What this does.** Walks the seam over the contacts of BOTH stacks and returns every stretch where the two halves answer different masses, deepest first, each carrying whose contact its ends are. It builds the elevation intervals, records each half's answer per interval, and cuts a new step wherever the facing pair changes.

**Why it is here.** A step ends wherever either half changes its mind, and which of the two changed is exactly what says whose contact that end is — the asymmetry the join test relies on. Two different disagreements are two different steps, each with its own two ends.

.. CG-EXPLANATION-END id=function:seamSteps

``function coverNotches``
-------------------------

.. CG-BLOCK id=function:coverNotches lines=314-345

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechHierarchicalFill/constructive/seamDrape.ts
   :language: typescript
   :lines: 314-345
   :lineno-match:

.. CG-EXPLANATION-START id=function:coverNotches

**What this does.** Finds every construct cut into a cover edge — a ring vertex whose two neighbours both sit on the same edge is that construct's point, and the two edges meeting there are its flanks. It scans each cover ring for such vertices.

**Why it is here.** The notches are where a tongue can land, so detecting them from the cover's own geometry keeps the rule tied to the real shapes rather than to any emitted record.

.. CG-EXPLANATION-END id=function:coverNotches

``function joinAcross``
-----------------------

.. CG-BLOCK id=function:joinAcross lines=346-379

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechHierarchicalFill/constructive/seamDrape.ts
   :language: typescript
   :lines: 346-379
   :lineno-match:

.. CG-EXPLANATION-START id=function:joinAcross

**What this does.** Tests one step against one notch and returns the drape when the two describe each other: the tongue starts at the opposite half's own end of the step, the notch's point must be strictly inside the step and beyond the seam, and exactly one of the notch's flanks must land at or past the step's far end.

**Why it is here.** Each condition is load-bearing. The tongue comes from the half OPPOSITE the notch, because a notch cut into one test's edge belongs to that test's half. A point level with a step's end is not in it, a point on the tongue's own side of the seam would make the join double back, and two qualifying flanks (or none) is the ambiguity the module refuses.

.. CG-EXPLANATION-END id=function:joinAcross

