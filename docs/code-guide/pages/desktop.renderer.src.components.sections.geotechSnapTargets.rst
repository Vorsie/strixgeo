desktop.renderer.src.components.sections.geotechSnapTargets
===========================================================

.. CG-PAGE source=desktop/src/renderer/src/components/sections/geotechSnapTargets.ts complete=true

*Source file:* ``desktop/src/renderer/src/components/sections/geotechSnapTargets.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-54

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/geotechSnapTargets.ts
   :language: typescript
   :lines: 1-54
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Names the file and its first helper's docstring: it decides what a dragged lithostratigraphic contact may snap to on the geotech axis. It is pure — no React, no network — and imports the layer type and the snap-candidate type.

**Why it is here.** The docstring records that the packing bands are the cone resistance's own reading of where the ground changes, so on finely interbedded ground the boundary the engineer wants is usually one of these rather than the one the driller's log implied — the evidence pulls the interpretation onto itself.

.. CG-EXPLANATION-END id=module-header

``function packingSnapCandidates``
----------------------------------

.. CG-BLOCK id=function:packingSnapCandidates lines=55-127

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/geotechSnapTargets.ts
   :language: typescript
   :lines: 55-127
   :lineno-match:

.. CG-EXPLANATION-START id=function:packingSnapCandidates

**What this does.** Collects the snap targets each CPT column offers — one candidate per internal band boundary, ascending by depth; a column with no internal boundary is left out of the map entirely.

**Why it is here.** The docstring records two exclusions that carry the meaning: borehole columns offer nothing because their bands were extrapolated from neighbouring CPTs rather than measured, and the column's own top and base are not candidates because they mark where the cone started and stopped, not where the ground was observed to change. Each candidate also carries the id of the band whose top it is, so the row being dragged skips its own top and does not snap straight back to where it started (debt #136).

.. CG-EXPLANATION-END id=function:packingSnapCandidates

``function clampToNextBoundary``
--------------------------------

.. CG-BLOCK id=function:clampToNextBoundary lines=128-158

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/geotechSnapTargets.ts
   :language: typescript
   :lines: 128-158
   :lineno-match:

.. CG-EXPLANATION-START id=function:clampToNextBoundary

**What this does.** Clamps one contact drag to the first packing boundary it crosses in the direction of travel, or returns nothing when the drag crossed no boundary.

**Why it is here.** The docstring records the owner's rule that one drag may consume only one boundary ('can't skip a boundary right, drag merge first, then drag merge second'), so a long sweep lands on the first boundary crossed; nothing means the contact does not move at all rather than 'move as far as you can', because sliding it to the free depth the cursor stopped at would record a boundary the cone never resolved. The origin end is exclusive so a contact already on a boundary is not stranded there, and the destination end is inclusive so releasing exactly on a boundary lands on it.

.. CG-EXPLANATION-END id=function:clampToNextBoundary

``type ContactDragRelease``
---------------------------

.. CG-BLOCK id=type:ContactDragRelease lines=159-203

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/geotechSnapTargets.ts
   :language: typescript
   :lines: 159-203
   :lineno-match:

.. CG-EXPLANATION-START id=type:ContactDragRelease

**What this does.** Names what letting go of a contact drag would do — move (the line lands where it is), merge (it is on a packing boundary and the band between is absorbed), or blocked (it is held short of a litho contact it cannot reach).

**Why it is here.** The docstring records it is kept separate from whether the drag is clamped because the two answer different questions: a drag landing exactly on a packing boundary is not clamped at all and yet releasing it absorbs a whole band.

.. CG-EXPLANATION-END id=type:ContactDragRelease

``function clampContactDrag``
-----------------------------

.. CG-BLOCK id=function:clampContactDrag lines=204-239

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/geotechSnapTargets.ts
   :language: typescript
   :lines: 204-239
   :lineno-match:

.. CG-EXPLANATION-START id=function:clampContactDrag

**What this does.** Clamps a contact drag while knowing which walls may be landed on: a packing boundary is reachable and a landing there absorbs the band between, while a boundary that restates a litho contact stops the line a minimum thickness short. It returns where the line may be drawn, whether it is being held back, and what letting go would do.

**Why it is here.** The docstring records the gap has to be applied here and not only in the refusal, because the engineer meets the wall with the cursor — letting the line travel all the way and then refusing on release reads as the app losing the gesture, which is how the owner met it ('this happens when i try to move a solid on another solid'). Landing on a litho contact would absorb the last packing band of the unit between two contacts and delete the unit, and a drag on this axis refines a boundary, it does not remove a layer; the backend keeps its own refusal as the second line of defence.

.. CG-EXPLANATION-END id=function:clampContactDrag

