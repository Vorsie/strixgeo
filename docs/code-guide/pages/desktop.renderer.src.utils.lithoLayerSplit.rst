desktop.renderer.src.utils.lithoLayerSplit
==========================================

.. CG-PAGE source=desktop/src/renderer/src/utils/lithoLayerSplit.ts complete=true

*Source file:* ``desktop/src/renderer/src/utils/lithoLayerSplit.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-43

.. literalinclude:: ../../../desktop/src/renderer/src/utils/lithoLayerSplit.ts
   :language: typescript
   :lines: 1-43
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The opening comment and the imports. This file is a pure helper (debt #98) that splits one pending litho ghost layer into two at its midpoint, with both halves inheriting the original layer's composition.

**Why it is here.** The comment records that the engineer reaches this through the per-layer right-click "Split layer" menu, and that the helper is kept module-level and pure so its index-shifting maths has a tight unit-test surface without rendering; the model hook is a thin wrapper that applies the result to its ghost state.

.. CG-EXPLANATION-END id=module-header

``function splitLithoLayer``
----------------------------

.. CG-BLOCK id=function:splitLithoLayer lines=44-107

.. literalinclude:: ../../../desktop/src/renderer/src/utils/lithoLayerSplit.ts
   :language: typescript
   :lines: 44-107
   :lineno-match:

.. CG-EXPLANATION-START id=function:splitLithoLayer

**What this does.** Builds a fresh ghost state with the layer at ``idx`` cut in two at its middle. It resolves the layer's current depths and composition (an edit winning over the raw value), computes the midpoint, and inserts a new lower-half layer that runs from the midpoint to the old base and carries a copy of the composition. It shifts all higher positions up by one and edits the original layer's base up to the midpoint, keeping its other edits.

**Why it is here.** The docstring records the details: the upper half keeps its position and its lithology/admixture edits; the new lower half copies the composition by value so a later edit to one half never accidentally changes the other; the new layer is marked high-confidence and manual because it is a user-created body, and its straddle flag is forced off so the engine re-resolves its parent at accept time (debt #87). The function is pure, so the caller passes the result straight into its state setter.

.. CG-EXPLANATION-END id=function:splitLithoLayer

