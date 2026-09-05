desktop.renderer.src.utils.lithoLayerInsert
===========================================

.. CG-PAGE source=desktop/src/renderer/src/utils/lithoLayerInsert.ts complete=true

*Source file:* ``desktop/src/renderer/src/utils/lithoLayerInsert.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-39

.. literalinclude:: ../../../desktop/src/renderer/src/utils/lithoLayerInsert.ts
   :language: typescript
   :lines: 1-39
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The opening comment and the imports. This file is a pure helper (debt #85) that inserts a new pending litho layer between two adjacent pending suggestions and shifts everything keyed by layer position — the accepted set, the rejected set, and the edits map — up by one above the insertion point. A Set here is a plain collection of layer positions; a Map is a table from a layer position to its pending depth or composition edit.

**Why it is here.** The comment records that the helper is kept module-level and pure so the fiddly index-shifting maths has a tight unit-test surface without needing to render anything; the model hook is a thin wrapper that feeds the result back into its ghost state.

.. CG-EXPLANATION-END id=module-header

``function insertLithoLayer``
-----------------------------

.. CG-BLOCK id=function:insertLithoLayer lines=40-118

.. literalinclude:: ../../../desktop/src/renderer/src/utils/lithoLayerInsert.ts
   :language: typescript
   :lines: 40-118
   :lineno-match:

.. CG-EXPLANATION-START id=function:insertLithoLayer

**What this does.** Builds a fresh copy of the ghost state with a new layer spliced in just below the layer at ``afterIdx``. It reads the shared boundary from the upper neighbour's current base, makes the new layer take the upper half of the lower neighbour, gives it the upper neighbour's parent formation and a manual origin, splices it into the layer list, shifts all higher accepted / rejected / edited positions up by one, and edits the (now shifted) lower neighbour's top down to the new layer's base so the three layers still line up exactly.

**Why it is here.** The docstring and comments record the choices: the new layer takes the upper HALF rather than a fixed 10 cm slice, because a fixed sliver was sub-pixel at normal section zoom — no visible colour band, no room for a label, no grabbable drag handles (dogfeed 2026-05-22). The parent formation is inherited as a sensible default that the engine re-checks at accept time (debt #87), and the layer is marked as not straddling a boundary because a user places it at one depth. The function is pure so the caller can pass the new ghost straight into its state setter.

.. CG-EXPLANATION-END id=function:insertLithoLayer

