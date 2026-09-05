desktop.renderer.src.shell.stages.sections.useEdgeDragRetarget
==============================================================

.. CG-PAGE source=desktop/src/renderer/src/shell/stages/sections/useEdgeDragRetarget.ts complete=true

*Source file:* ``desktop/src/renderer/src/shell/stages/sections/useEdgeDragRetarget.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-22

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/sections/useEdgeDragRetarget.ts
   :language: typescript
   :lines: 1-22
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Header for the drag machine that lets the engineer grab the endpoint of an unapproved correlation edge, drag it to a different contact on the section, and drop it there. A plain drag re-targets the grabbed end; Ctrl/Cmd-drag leaves the original edge and adds a second one (the lens gesture).

**Why it is here.** Extracted verbatim from the canvas (debt #201 round 2). The correlation edge is a line tying one column's contact to a neighbour's; this gesture edits which contact an end points at.

.. CG-EXPLANATION-END id=module-header

``interface UseEdgeDragRetargetDeps``
-------------------------------------

.. CG-BLOCK id=interface:UseEdgeDragRetargetDeps lines=23-46

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/sections/useEdgeDragRetarget.ts
   :language: typescript
   :lines: 23-46
   :lineno-match:

.. CG-EXPLANATION-START id=interface:UseEdgeDragRetargetDeps

**What this does.** What the drag reads from the canvas: the litho contacts (for anchor and drop lookups), the active litho model, the project and section ids, the several refetch functions, mark-dirty, an optional body-recompute scheduler, and the toast action.

**Why it is here.** The gesture writes to the server and must refresh the edge list, the contacts, and any materialised lens wedges, so it takes every refetch it needs plus the dirty and recompute signals.

.. CG-EXPLANATION-END id=interface:UseEdgeDragRetargetDeps

``interface EdgeDragState``
---------------------------

.. CG-BLOCK id=interface:EdgeDragState lines=47-69

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/sections/useEdgeDragRetarget.ts
   :language: typescript
   :lines: 47-69
   :lineno-match:

.. CG-EXPLANATION-START id=interface:EdgeDragState

**What this does.** The live drag: which edge and which endpoint is grabbed, the stable anchor contact and its investigation, the dragged contact, a duplicate flag (Ctrl/Cmd held), and the cursor's current screen position.

**Why it is here.** The anchor investigation is recorded so a drop onto the anchor's own investigation can be rejected; the duplicate flag distinguishes 're-target the grabbed end' from 'create an extra boundary' (which forms a lens when the drop is the layer's other boundary).

.. CG-EXPLANATION-END id=interface:EdgeDragState

``interface UseEdgeDragRetargetResult``
---------------------------------------

.. CG-BLOCK id=interface:UseEdgeDragRetargetResult lines=70-91

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/sections/useEdgeDragRetarget.ts
   :language: typescript
   :lines: 70-91
   :lineno-match:

.. CG-EXPLANATION-START id=interface:UseEdgeDragRetargetResult

**What this does.** What the hook returns: the live drag state (for the overlay to draw the rubber-band line) and the grab-handle mousedown starter.

**Why it is here.** The canvas passes the starter to the overlay's handles and renders from the live state.

.. CG-EXPLANATION-END id=interface:UseEdgeDragRetargetResult

``function useEdgeDragRetarget``
--------------------------------

.. CG-BLOCK id=function:useEdgeDragRetarget lines=92-364

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/sections/useEdgeDragRetarget.ts
   :language: typescript
   :lines: 92-364
   :lineno-match:

.. CG-EXPLANATION-START id=function:useEdgeDragRetarget

**What this does.** On mousedown on a handle it records which end is grabbed and whether Ctrl/Cmd is held; window-level mousemove tracks the cursor; mouseup hit-tests the drop by walking up from the element under the cursor for a contact id, rejects a drop on empty space, on the anchor, on the same contact, or on the anchor's own investigation, then either (duplicate) deletes and re-creates the original plus a twin to the drop, or (plain) deletes the old edge and creates the replacement. Both paths refetch, mark dirty and schedule the recompute; a failure restores from the server. It reads the contact list through a ref so a mid-drag refetch is respected.

**Why it is here.** The new edge is created with source 'manual', which the server treats as approved — re-targeting an auto suggestion is itself a form of blessing (Option Y). The fresh-read ref is load-bearing (review 2026-07-13): a refetch completing mid-drag can reassign the drop target's investigation, and the same-investigation guard must judge against the current list, not the drag-start snapshot.

.. CG-EXPLANATION-END id=function:useEdgeDragRetarget

