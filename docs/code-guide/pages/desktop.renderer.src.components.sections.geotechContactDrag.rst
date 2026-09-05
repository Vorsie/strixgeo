desktop.renderer.src.components.sections.geotechContactDrag
===========================================================

.. CG-PAGE source=desktop/src/renderer/src/components/sections/geotechContactDrag.ts complete=true

*Source file:* ``desktop/src/renderer/src/components/sections/geotechContactDrag.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-41

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/geotechContactDrag.ts
   :language: typescript
   :lines: 1-41
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Names the file: it decides what a contact drag on the geotech axis actually does. It is pure — no React, no network. It imports the contact and layer types, helpers from the band-edit and snap-target modules, and the shared coincident-depth tolerance.

**Why it is here.** The docstring records that the geotech axis is view-only for contacts with one deliberate exception (owner ruling 2026-08-08): a lithostratigraphic contact may be dragged from here, because on finely interbedded ground the boundary the engineer wants to move IS the litho contact, and the cone resolved it three to four times finer than the driller's 0.5 m log grid. It stresses this is not a weakening of the hierarchy — dragging the contact itself is an explicit, consented edit of the litho model, made from the screen showing the best evidence for it.

.. CG-EXPLANATION-END id=module-header

``const RESTATED_CONTACT_TOLERANCE_M``
--------------------------------------

.. CG-BLOCK id=const:RESTATED_CONTACT_TOLERANCE_M lines=42-44

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/geotechContactDrag.ts
   :language: typescript
   :lines: 42-44
   :lineno-match:

.. CG-EXPLANATION-START id=const:RESTATED_CONTACT_TOLERANCE_M

**What this does.** How far a litho contact may sit from the boundary that restates it — the shared coincident-depth tolerance.

**Why it is here.** The docstring records that the two models record the same depth at two precisions, so exact equality would refuse a fifth of the owner's real coincident boundaries; and that this site uses it only to pick WHICH litho row a boundary already known to restate one belongs to, never whether a boundary is a contact.

.. CG-EXPLANATION-END id=const:RESTATED_CONTACT_TOLERANCE_M

``type GeotechContactDragPlan``
-------------------------------

.. CG-BLOCK id=type:GeotechContactDragPlan lines=45-86

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/geotechContactDrag.ts
   :language: typescript
   :lines: 45-86
   :lineno-match:

.. CG-EXPLANATION-START id=type:GeotechContactDragPlan

**What this does.** Names what a drag on one geotech boundary resolves to — move (the only outcome that writes anything), packing-boundary, no-boundary-crossed, no-packing-boundaries, unmatched, or not-a-boundary.

**Why it is here.** The docstring records that the move outcome carries the two bands, not just the litho row, because the write moves both the packing boundary and the contact it restates — they are one boundary recorded in two models, and moving one without the other splits it. Every non-move outcome is a distinct reason on purpose, because the failure this feature exists to remove is a gesture that silently does nothing.

.. CG-EXPLANATION-END id=type:GeotechContactDragPlan

``interface GeotechContactDragInput``
-------------------------------------

.. CG-BLOCK id=interface:GeotechContactDragInput lines=87-124

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/geotechContactDrag.ts
   :language: typescript
   :lines: 87-124
   :lineno-match:

.. CG-EXPLANATION-START id=interface:GeotechContactDragInput

**What this does.** Describes everything the plan is decided from — the grabbed geotech row, where the drag released, and the three row sets: the geotech packing bands, the litho layers, and the litho contacts.

**Why it is here.** A data shape bundling the inputs the planner needs.

.. CG-EXPLANATION-END id=interface:GeotechContactDragInput

``function planGeotechContactDrag``
-----------------------------------

.. CG-BLOCK id=function:planGeotechContactDrag lines=125-197

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/geotechContactDrag.ts
   :language: typescript
   :lines: 125-197
   :lineno-match:

.. CG-EXPLANATION-START id=function:planGeotechContactDrag

**What this does.** Resolves one contact drag on the geotech axis: it identifies the grabbed boundary, checks it restates a litho contact, finds the litho row within tolerance, and clamps the destination to the next packing boundary, returning a move with the litho contact id and the clamped depth or a distinct reason nothing happened.

**Why it is here.** The docstring records the order is deliberate — identity, whether it is a contact and which one, is settled before the destination, so 'no litho row within a millimetre' is reported as itself rather than hidden behind 'the drag reached no boundary'. The comment records the next packing boundary is a wall, not a magnet (owner dogfeed 2026-08-09), that one drag consumes one boundary, and that a zero-travel release must not write an update for the depth the row already has.

.. CG-EXPLANATION-END id=function:planGeotechContactDrag

``function nearestLithoContact``
--------------------------------

.. CG-BLOCK id=function:nearestLithoContact lines=198-216

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/geotechContactDrag.ts
   :language: typescript
   :lines: 198-216
   :lineno-match:

.. CG-EXPLANATION-START id=function:nearestLithoContact

**What this does.** Returns the litho contact a boundary restates, if one is within the rounding allowance on that column.

**Why it is here.** The comment records the less-than-or-equal comparison so a contact exactly at the tolerance still matches, because the far edge of the allowance is inside the rounding, not outside it.

.. CG-EXPLANATION-END id=function:nearestLithoContact

