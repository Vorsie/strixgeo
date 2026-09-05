desktop.renderer.src.utils.newTestFilter
========================================

.. CG-PAGE source=desktop/src/renderer/src/utils/newTestFilter.ts complete=true

*Source file:* ``desktop/src/renderer/src/utils/newTestFilter.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-17

.. literalinclude:: ../../../desktop/src/renderer/src/utils/newTestFilter.ts
   :language: typescript
   :lines: 1-17
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The opening comment and the imports. This file holds filter helpers for a "new test" — an investigation that has no committed contacts yet in the active model — which power the "Suggest for new tests" and "Seed for new tests" verbs. It imports the borehole-list and contact data shapes.

**Why it is here.** The comment records that the point is to scope a bulk action to investigations not yet processed, leaving existing accepted or placed contacts untouched. Both helpers are pure — no React, no hooks, no reading or writing — and do their work in two passes: one over the contacts to build a set of investigations already seen, one over the input list to keep those not in that set.

.. CG-EXPLANATION-END id=module-header

``interface LithoAnchor``
-------------------------

.. CG-BLOCK id=interface:LithoAnchor lines=18-51

.. literalinclude:: ../../../desktop/src/renderer/src/utils/newTestFilter.ts
   :language: typescript
   :lines: 18-51
   :lineno-match:

.. CG-EXPLANATION-START id=interface:LithoAnchor

**What this does.** One target for the bulk Suggest-litho fan-out: its kind (CPT or borehole), its id, and its surface elevation.

**Why it is here.** It is the shape the bulk suggest works over.

.. CG-EXPLANATION-END id=interface:LithoAnchor

``function filterAnchorsWithNoLithoContacts``
---------------------------------------------

.. CG-BLOCK id=function:filterAnchorsWithNoLithoContacts lines=52-85

.. literalinclude:: ../../../desktop/src/renderer/src/utils/newTestFilter.ts
   :language: typescript
   :lines: 52-85
   :lineno-match:

.. CG-EXPLANATION-START id=function:filterAnchorsWithNoLithoContacts

**What this does.** Returns the anchors that have no contacts in the given litho model, keeping the input order, by first collecting the ids of every investigation that already carries a litho contact and then dropping any anchor in that set.

**Why it is here.** The docstring records that the caller has already built the anchor list, doing all the corridor, exclusion and elevation scoping, so this helper only applies the "zero litho contacts" filter on top. Synthetic contacts — pinch-out wedges with no borehole or CPT id — are ignored, because they are not anchored to any investigation and so cannot make an anchor count as already processed.

.. CG-EXPLANATION-END id=function:filterAnchorsWithNoLithoContacts

``function filterBoreholesWithNoGeologyContacts``
-------------------------------------------------

.. CG-BLOCK id=function:filterBoreholesWithNoGeologyContacts lines=86-95

.. literalinclude:: ../../../desktop/src/renderer/src/utils/newTestFilter.ts
   :language: typescript
   :lines: 86-95
   :lineno-match:

.. CG-EXPLANATION-START id=function:filterBoreholesWithNoGeologyContacts

**What this does.** Returns the ids of the boreholes that have no contacts in the given geology model, keeping the input order.

**Why it is here.** The docstring records that the section's "Seed for new tests" verb uses it to scope its seed-from-stratigraphy bulk call to boreholes that have not had any geology contact placed yet, and that synthetic-anchor contacts are ignored for the same reason as above.

.. CG-EXPLANATION-END id=function:filterBoreholesWithNoGeologyContacts

