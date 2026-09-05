desktop.renderer.src.shell.stages.geology.GeologyFormationList
==============================================================

.. CG-PAGE source=desktop/src/renderer/src/shell/stages/geology/GeologyFormationList.tsx complete=true

*Source file:* ``desktop/src/renderer/src/shell/stages/geology/GeologyFormationList.tsx``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-30

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/geology/GeologyFormationList.tsx
   :language: tsx
   :lines: 1-30
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Opens the file — the formation list with drag-to-reorder plus its per-row component — and imports React's ``useState``, the state-setter types, the grip and trash icons, the formation response type from the API client, the unsaved-marker asterisk, and the translator.

**Why it is here.** Extracted verbatim from the inspector (debt #201); presentation only, with the parent hook owning the list, the drag state and the mutation handlers. The row component is defined at module scope, NOT nested inside the list, so it keeps a stable identity across parent redraws — a component defined inside another re-identifies on every render and React unmount- then remounts it (the LithoUnitRow precedent). Youngest-first reading order is the caller's concern: the parent passes the already-reversed list and the reorder math inverts it back to ``display_order``.

.. CG-EXPLANATION-END id=module-header

``interface FormationRowProps``
-------------------------------

.. CG-BLOCK id=interface:FormationRowProps lines=31-80

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/geology/GeologyFormationList.tsx
   :language: tsx
   :lines: 31-80
   :lineno-match:

.. CG-EXPLANATION-START id=interface:FormationRowProps

**What this does.** Declares one row's inputs: the formation, an unsaved flag, two drag-visual flags (this row is the drag source; this row is the hovered drop target), a reorder-busy flag, the edit / delete / colour-change / drag callbacks, and the row's display index.

**Why it is here.** The unsaved flag draws an amber left-stripe and asterisk matching the CPT and borehole unsaved convention, so the engineer can see which formations still need a save. The display index is there for ordinal test targeting in the end-to-end harness. Everything is a prop because the parent owns all the state.

.. CG-EXPLANATION-END id=interface:FormationRowProps

``function GeologyFormationRow``
--------------------------------

.. CG-BLOCK id=function:GeologyFormationRow lines=81-208

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/geology/GeologyFormationList.tsx
   :language: tsx
   :lines: 81-208
   :lineno-match:

.. CG-EXPLANATION-START id=function:GeologyFormationRow

**What this does.** Draws one formation row: a drag handle, a colour swatch that doubles as a native colour picker, the formation name (with its regional-reference sub-line and an amber asterisk when unsaved), and a delete button. It remembers a pending colour while the picker is open and commits it when the picker loses focus.

**Why it is here.** The drag handle sets a ``text/plain`` payload because Firefox refuses to start a drag without one, and the row calls ``preventDefault`` on drag-over because the browser fires no drop event otherwise. The colour commit happens on blur and is equality-checked, so pressing Escape to cancel the picker (which never fires a change) is naturally a no-op. The input is kept visually hidden but reachable so the swatch stays keyboard-accessible.

.. CG-EXPLANATION-END id=function:GeologyFormationRow

``interface GeologyFormationListProps``
---------------------------------------

.. CG-BLOCK id=interface:GeologyFormationListProps lines=209-259

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/geology/GeologyFormationList.tsx
   :language: tsx
   :lines: 209-259
   :lineno-match:

.. CG-EXPLANATION-START id=interface:GeologyFormationListProps

**What this does.** Declares the list's inputs: the formations already in displayed (youngest-first) order, the set of unsaved formation ids, the drag state (dragged id, drag-over id, reorder-busy), the mutation callbacks (edit, delete, colour, reorder), and the two drag-state setters.

**Why it is here.** All of this state is owned by the parent hook; the list only wires each row's event callbacks to the parent's setters and handlers — props flow down, callbacks flow up, and the list itself holds no state.

.. CG-EXPLANATION-END id=interface:GeologyFormationListProps

``function GeologyFormationList``
---------------------------------

.. CG-BLOCK id=function:GeologyFormationList lines=260-327

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/geology/GeologyFormationList.tsx
   :language: tsx
   :lines: 260-327
   :lineno-match:

.. CG-EXPLANATION-START id=function:GeologyFormationList

**What this does.** Renders the formations in order, each as a ``GeologyFormationRow`` wired to the drag-state setters and the mutation handlers; while a drag is active it also renders a dashed drop-zone at the bottom of the list so a formation can be dropped at the end.

**Why it is here.** The bottom drop-zone appears only during a drag to avoid clutter the rest of the time. Dropping onto a row or the end-zone calls ``onReorder`` with the source and target, which the parent persists; ``preventDefault`` on drag-over is what marks a spot as a valid drop target.

.. CG-EXPLANATION-END id=function:GeologyFormationList

