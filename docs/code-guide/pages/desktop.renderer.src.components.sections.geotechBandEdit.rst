desktop.renderer.src.components.sections.geotechBandEdit
========================================================

.. CG-PAGE source=desktop/src/renderer/src/components/sections/geotechBandEdit.ts complete=true

*Source file:* ``desktop/src/renderer/src/components/sections/geotechBandEdit.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-35

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/geotechBandEdit.ts
   :language: typescript
   :lines: 1-35
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Names the file: it holds the hard-bounds arithmetic for hand-editing packing sub-bands on the geotech axis. It is pure — no React, no network, no screen access. It imports the layer type and the absorb-threshold helper the litho axis uses.

**Why it is here.** The docstring records owner ruling 2 (debt #227, 2026-08-01, amended 2026-08-26): a packing boundary moves freely inside its litho body and clamps at the edge, and can never move a litho contact — the litho unit is the one hard wall. It also records that a geological contact is NOT a wall (owner 2026-08-26, 'just drop the wall everywhere'); this module always clamped to the litho layer alone, and now that the machine no longer cuts a litho body at a geological contact, that clamp is unchanged and correct, and the server matches it.

.. CG-EXPLANATION-END id=module-header

``const SPLIT_EDGE_EPSILON_M``
------------------------------

.. CG-BLOCK id=const:SPLIT_EDGE_EPSILON_M lines=36-43

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/geotechBandEdit.ts
   :language: typescript
   :lines: 36-43
   :lineno-match:

.. CG-EXPLANATION-START id=const:SPLIT_EDGE_EPSILON_M

**What this does.** How far inside the litho body a hand-placed split is allowed to land, 1 centimetre.

**Why it is here.** The docstring records this is a structural floor, not a geological rule: layer depths are stored millimetre-rounded under a no-overlap constraint, so a split landing exactly on the litho contact would ask for a zero-thickness band and come back as a server error; 1 cm keeps that unreachable.

.. CG-EXPLANATION-END id=const:SPLIT_EDGE_EPSILON_M

``const BAND_ADJACENCY_TOLERANCE_M``
------------------------------------

.. CG-BLOCK id=const:BAND_ADJACENCY_TOLERANCE_M lines=44-46

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/geotechBandEdit.ts
   :language: typescript
   :lines: 44-46
   :lineno-match:

.. CG-EXPLANATION-START id=const:BAND_ADJACENCY_TOLERANCE_M

**What this does.** How close two band boundaries must be to count as touching, 1 centimetre.

**Why it is here.** The docstring records it matches the 1 cm contiguity tolerance the database's contiguity trigger enforces, so this walk can never disagree with the database about what is adjacent.

.. CG-EXPLANATION-END id=const:BAND_ADJACENCY_TOLERANCE_M

``interface DepthInterval``
---------------------------

.. CG-BLOCK id=interface:DepthInterval lines=47-54

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/geotechBandEdit.ts
   :language: typescript
   :lines: 47-54
   :lineno-match:

.. CG-EXPLANATION-START id=interface:DepthInterval

**What this does.** Describes a depth range on one column — a top and a base in metres below the collar, measured positive downward.

**Why it is here.** A small shared data shape for a depth range.

.. CG-EXPLANATION-END id=interface:DepthInterval

``interface GeotechBandInterval``
---------------------------------

.. CG-BLOCK id=interface:GeotechBandInterval lines=55-79

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/geotechBandEdit.ts
   :language: typescript
   :lines: 55-79
   :lineno-match:

.. CG-EXPLANATION-START id=interface:GeotechBandInterval

**What this does.** Describes one packing sub-band reduced to what the edit code needs — its layer id, its NAD-stamped formation, whether it hangs off a CPT or a borehole, and the resolver body it belongs to.

**Why it is here.** The docstring records that whether the band hangs off a CPT drives hand-editability, because only a CPT carries cone resistance; the body id is optional so the many hand-built test fixtures stay valid, and it is carried only for the unit-statistics jump (owner ruling 2026-08-27) — no edit verb reads it.

.. CG-EXPLANATION-END id=interface:GeotechBandInterval

``type SplitClampWall``
-----------------------

.. CG-BLOCK id=type:SplitClampWall lines=80-82

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/geotechBandEdit.ts
   :language: typescript
   :lines: 80-82
   :lineno-match:

.. CG-EXPLANATION-START id=type:SplitClampWall

**What this does.** Names which wall stopped a proposed split — none, the litho top, or the litho base.

**Why it is here.** A small set of the possible outcomes a clamp reports.

.. CG-EXPLANATION-END id=type:SplitClampWall

``interface ClampedSplitDepth``
-------------------------------

.. CG-BLOCK id=interface:ClampedSplitDepth lines=83-92

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/geotechBandEdit.ts
   :language: typescript
   :lines: 83-92
   :lineno-match:

.. CG-EXPLANATION-START id=interface:ClampedSplitDepth

**What this does.** Describes a proposed split after the hierarchy has had its say — the depth it would be placed at, which wall stopped it, and a reason phrased for the readout.

**Why it is here.** A data shape carrying both the clamped result and the sentence the gesture shows.

.. CG-EXPLANATION-END id=interface:ClampedSplitDepth

``type MergeEligibility``
-------------------------

.. CG-BLOCK id=type:MergeEligibility lines=93-116

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/geotechBandEdit.ts
   :language: typescript
   :lines: 93-116
   :lineno-match:

.. CG-EXPLANATION-START id=type:MergeEligibility

**What this does.** Describes whether two bands may be merged — either an OK, or a not-OK with the reason to show the owner.

**Why it is here.** A small tagged shape so the caller gets the reason along with the yes-or-no.

.. CG-EXPLANATION-END id=type:MergeEligibility

``function clampSplitDepth``
----------------------------

.. CG-BLOCK id=function:clampSplitDepth lines=117-169

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/geotechBandEdit.ts
   :language: typescript
   :lines: 117-169
   :lineno-match:

.. CG-EXPLANATION-START id=function:clampSplitDepth

**What this does.** Clamps a proposed split depth into the litho body that bounds it: inside the body it follows the cursor exactly (including across the owner's own packing boundaries), and at the litho contact it stops one epsilon short and reports which edge it hit. A body thinner than two epsilons collapses to its middle.

**Why it is here.** The docstring records the drag reads this every frame so the clamp the owner feels in the gesture and the clamp the server enforces on commit are the same rule stated once; crossing a packing boundary simply re-targets which band gets split, because those boundaries are the owner's subdivision, not a level above him.

.. CG-EXPLANATION-END id=function:clampSplitDepth

``function enclosingLithoBody``
-------------------------------

.. CG-BLOCK id=function:enclosingLithoBody lines=170-196

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/geotechBandEdit.ts
   :language: typescript
   :lines: 170-196
   :lineno-match:

.. CG-EXPLANATION-START id=function:enclosingLithoBody

**What this does.** Finds the litho body a depth falls in, or nothing when the depth is below the deepest litho layer (where no body would bound a split).

**Why it is here.** The comment records the half-open interval — top inclusive, base exclusive — matches how the build samples a band, so a depth sitting exactly on a contact belongs to the body below it, giving it one owner, never two.

.. CG-EXPLANATION-END id=function:enclosingLithoBody

``function bandAtDepth``
------------------------

.. CG-BLOCK id=function:bandAtDepth lines=197-221

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/geotechBandEdit.ts
   :language: typescript
   :lines: 197-221
   :lineno-match:

.. CG-EXPLANATION-START id=function:bandAtDepth

**What this does.** Finds the packing band a depth falls in, or nothing when no band covers it.

**Why it is here.** It tells the split which band it would divide.

.. CG-EXPLANATION-END id=function:bandAtDepth

``function columnBands``
------------------------

.. CG-BLOCK id=function:columnBands lines=222-267

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/geotechBandEdit.ts
   :language: typescript
   :lines: 222-267
   :lineno-match:

.. CG-EXPLANATION-START id=function:columnBands

**What this does.** Reduces the model-wide layer list to one column's bands, sorted shallowest-first.

**Why it is here.** The docstring records the sort so the stack matches the drawing; the endpoint gives no ordering guarantee, so pairing unsorted rows would compare non-neighbours.

.. CG-EXPLANATION-END id=function:columnBands

``function columnIsHandEditable``
---------------------------------

.. CG-BLOCK id=function:columnIsHandEditable lines=268-284

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/geotechBandEdit.ts
   :language: typescript
   :lines: 268-284
   :lineno-match:

.. CG-EXPLANATION-START id=function:columnIsHandEditable

**What this does.** Answers whether a column's packing bands may be hand-edited at all — only when every band on the column hangs off a CPT.

**Why it is here.** The docstring records owner ruling A (2026-08-01): both edit verbs re-derive the NAD packing class from the cone resistance over the band's new extent, and a borehole records none, so editing there would trade the class the divide extrapolated from surrounding CPTs for no class at all. The gesture is not offered rather than offered and refused.

.. CG-EXPLANATION-END id=function:columnIsHandEditable

``function pairLithoBodies``
----------------------------

.. CG-BLOCK id=function:pairLithoBodies lines=285-321

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/geotechBandEdit.ts
   :language: typescript
   :lines: 285-321
   :lineno-match:

.. CG-EXPLANATION-START id=function:pairLithoBodies

**What this does.** A private helper that returns which litho body each band of a pair sits in, probing each band at its own midpoint.

**Why it is here.** The docstring records it is the one probe both the merge check and the contact-restatement check ask, kept in one place so a merge and a contact drag can never disagree about which body a band belongs to; the midpoint probe avoids a band that exactly spans its body picking up the body above it on a shared contact.

.. CG-EXPLANATION-END id=function:pairLithoBodies

``function boundaryRestatesLithoContact``
-----------------------------------------

.. CG-BLOCK id=function:boundaryRestatesLithoContact lines=322-352

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/geotechBandEdit.ts
   :language: typescript
   :lines: 322-352
   :lineno-match:

.. CG-EXPLANATION-START id=function:boundaryRestatesLithoContact

**What this does.** Answers whether the boundary between two touching bands IS a lithostratigraphic contact — true when the bands touch and sit in different litho bodies.

**Why it is here.** The docstring records it is stated once so the two callers cannot drift into disagreeing about what a contact is: the boundary a packing merge may not cross is precisely the one the contact drag owns.

.. CG-EXPLANATION-END id=function:boundaryRestatesLithoContact

``function canMergeBands``
--------------------------

.. CG-BLOCK id=function:canMergeBands lines=353-389

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/geotechBandEdit.ts
   :language: typescript
   :lines: 353-389
   :lineno-match:

.. CG-EXPLANATION-START id=function:canMergeBands

**What this does.** Decides whether two packing bands may be merged by hand, refusing only on the hierarchy — when they do not touch, when one is outside the litho stack, or when they sit in different litho bodies.

**Why it is here.** The docstring records that a refusal on qc grounds would break ruling 5 (manual override always wins), which is why nothing about the classes is consulted; the comment records the refusal wording names the contact-drag remedy first (added 2026-08-08) so the engineer is not sent away to the litho axis for a gesture he can make where he is standing.

.. CG-EXPLANATION-END id=function:canMergeBands

``interface ClampedDragDepth``
------------------------------

.. CG-BLOCK id=interface:ClampedDragDepth lines=390-411

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/geotechBandEdit.ts
   :language: typescript
   :lines: 390-411
   :lineno-match:

.. CG-EXPLANATION-START id=interface:ClampedDragDepth

**What this does.** Describes where a dragged boundary stopped — the clamped depth and which limit (upper, lower, or none) stopped it.

**Why it is here.** A data shape for the drag clamp's result.

.. CG-EXPLANATION-END id=interface:ClampedDragDepth

``function clampDragDepth``
---------------------------

.. CG-BLOCK id=function:clampDragDepth lines=412-441

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/geotechBandEdit.ts
   :language: typescript
   :lines: 412-441
   :lineno-match:

.. CG-EXPLANATION-START id=function:clampDragDepth

**What this does.** Clamps a dragged packing boundary to the outer envelope of the pair it belongs to, one epsilon inside each edge.

**Why it is here.** The docstring records the drag verb is offered only on a mergeable same-litho-body pair, so the pair's own envelope is exactly ruling 2's wall; the boundary moves freely between the edges and visibly refuses to leave them, and the epsilon keeps both survivors as real rows.

.. CG-EXPLANATION-END id=function:clampDragDepth

``function dragAbsorbPrediction``
---------------------------------

.. CG-BLOCK id=function:dragAbsorbPrediction lines=442-467

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/geotechBandEdit.ts
   :language: typescript
   :lines: 442-467
   :lineno-match:

.. CG-EXPLANATION-START id=function:dragAbsorbPrediction

**What this does.** Answers whether releasing the drag should absorb one of the pair rather than just move the boundary — when the squeeze leaves a neighbour below the greater of 0.1 m and 15 percent of its original thickness.

**Why it is here.** The docstring records owner decision 2026-08-07 ('Absorb, like litho') using the exact threshold helper the litho ghost cross-merge uses; the comment records the direction test stops a band that was already thinner than the floor from reading as collapsing at rest or while being grown, and that the server never owns this threshold because a server silently turning a move into a delete would break preview honesty (ruling 6).

.. CG-EXPLANATION-END id=function:dragAbsorbPrediction

