desktop.renderer.src.utils.insertManualGhostLayer
=================================================

.. CG-PAGE source=desktop/src/renderer/src/utils/insertManualGhostLayer.ts complete=true

*Source file:* ``desktop/src/renderer/src/utils/insertManualGhostLayer.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-59

.. literalinclude:: ../../../desktop/src/renderer/src/utils/insertManualGhostLayer.ts
   :language: typescript
   :lines: 1-59
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** This file is a pure helper for the "left-click creates a ghost" interaction: it inserts a manual-pick ghost layer into an anchor's set of suggested layers at the depth the engineer clicked. The comment notes no index-shifting is needed because the new layer is added to the suggestions and then the whole list is re-sorted by depth, so the existing layers stay in order. A thin hook wrapper feeds this transform into the model state.

**Why it is here.** The comment records the design of the new layer: it is given a 20 cm visible band (owner directive 2026-05-27, replacing an earlier hair-thin sentinel) so it is both user-visible and wide enough for the drag handles to be grabbed independently, and it is stamped as a manual pick with medium confidence. As a *pure function* it takes state in and returns new state out, changing nothing in place, which is what lets the hook feed it cleanly.

.. CG-EXPLANATION-END id=module-header

``function insertManualGhostLayer``
-----------------------------------

.. CG-BLOCK id=function:insertManualGhostLayer lines=60-99

.. literalinclude:: ../../../desktop/src/renderer/src/utils/insertManualGhostLayer.ts
   :language: typescript
   :lines: 60-99
   :lineno-match:

.. CG-EXPLANATION-START id=function:insertManualGhostLayer

**What this does.** Inserts a manual-pick ghost layer at the clicked depth. It builds the new layer with its top at that depth, its base 20 cm deeper, the chosen soil and admixtures, medium confidence and a manual-pick source. If the anchor had no ghost state yet it returns a fresh one containing just this layer with empty accepted/rejected/edits sets; otherwise it appends the new layer to the existing suggestions and returns a copy with the list re-sorted by depth.

**Why it is here.** The docstring records the details. A fresh entry is created when this is the first manual ghost on the anchor, carrying the surface elevation so the ghost column can convert depth to elevation for drawing; when a ghost already exists its own elevation is kept. Re-sorting by depth after appending keeps the drawing order consistent no matter what order the engineer clicks at, and returning new objects rather than mutating the input keeps the helper pure.

.. CG-EXPLANATION-END id=function:insertManualGhostLayer

