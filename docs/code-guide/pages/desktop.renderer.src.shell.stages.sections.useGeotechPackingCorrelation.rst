desktop.renderer.src.shell.stages.sections.useGeotechPackingCorrelation
=======================================================================

.. CG-PAGE source=desktop/src/renderer/src/shell/stages/sections/useGeotechPackingCorrelation.ts complete=true

*Source file:* ``desktop/src/renderer/src/shell/stages/sections/useGeotechPackingCorrelation.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-31

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/sections/useGeotechPackingCorrelation.ts
   :language: typescript
   :lines: 1-31
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Header for the create / delete / accept / confirm-review handlers behind the geotech axis's manual 'Correlate packing' gesture, used by the canvas.

**Why it is here.** Extracted verbatim from the canvas (debt #201 round 2). They mirror the litho correlate handlers but use the geotech model and, after success, refetch the geotech layers because the layer list is the body-id source, not the edges themselves. The same-class / same-body guard was dropped per the R1 directive (owner 2026-06-25) — geotech ties are now as permissive as litho's; the litho-partition frame keeps the result sensible, and an out-of-region tie simply does not render.

.. CG-EXPLANATION-END id=module-header

``interface UseGeotechPackingCorrelationDeps``
----------------------------------------------

.. CG-BLOCK id=interface:UseGeotechPackingCorrelationDeps lines=32-74

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/sections/useGeotechPackingCorrelation.ts
   :language: typescript
   :lines: 32-74
   :lineno-match:

.. CG-EXPLANATION-START id=interface:UseGeotechPackingCorrelationDeps

**What this does.** What the handlers read from the canvas: the active geotech model, the project and section ids, the refetches, the recompute and mark-dirty signals, the toast action, the arm-state setters, the two edge-list setters, and the undo stack.

**Why it is here.** The handlers keep clear of litho state, but an undo entry for a geotech disconnect is geotech's own — it recreates a geotech edge — because the only alternative repair is re-subdividing, which is model-wide, destructive, and would throw away every other manual correlation.

.. CG-EXPLANATION-END id=interface:UseGeotechPackingCorrelationDeps

``interface UseGeotechPackingCorrelationResult``
------------------------------------------------

.. CG-BLOCK id=interface:UseGeotechPackingCorrelationResult lines=75-105

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/sections/useGeotechPackingCorrelation.ts
   :language: typescript
   :lines: 75-105
   :lineno-match:

.. CG-EXPLANATION-START id=interface:UseGeotechPackingCorrelationResult

**What this does.** The four handlers returned: create a packing correlation, delete one (with undo), accept a pending one, and confirm-clear a flagged one.

**Why it is here.** These four are the whole manual packing-tie surface the geotech axis offers.

.. CG-EXPLANATION-END id=interface:UseGeotechPackingCorrelationResult

``function useGeotechPackingCorrelation``
-----------------------------------------

.. CG-BLOCK id=function:useGeotechPackingCorrelation lines=106-450

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/sections/useGeotechPackingCorrelation.ts
   :language: typescript
   :lines: 106-450
   :lineno-match:

.. CG-EXPLANATION-START id=function:useGeotechPackingCorrelation

**What this does.** Create links two bands on the geotech model, clears the arm state, refetches edges and layers, schedules the recompute, marks the borehole division stale, and toasts a warning (naming both bands) when the tie exceeds the litho frame, else success. Delete removes the edge optimistically, commits, refetches, pushes an undo that recreates then re-deletes, and on failure rolls back and shows a sticky error naming the gesture. Accept promotes a pending tie and refreshes; confirm-review clears a flagged tie's review reason without moving anything.

**Why it is here.** The frame-mismatch WARNING (owner 2026-08-21, after he deleted a silt-clay packing tie whose ground the fill answered with an onlap: 'flag a tie like that when it doesn't conform') states that the tie stands but the litho frame will never band it — the plain success toast would claim something false. The optimistic-delete rollback shows a sticky error naming the gesture after a dogfeed where the backend had gone away, the edge flickered out and back, and the only record was a log nobody was watching. Confirm-review refetches nothing else because the tie is already approved and points where it points — only the flag drops.

.. CG-EXPLANATION-END id=function:useGeotechPackingCorrelation

