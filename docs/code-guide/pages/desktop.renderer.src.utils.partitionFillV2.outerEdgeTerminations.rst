desktop.renderer.src.utils.partitionFillV2.outerEdgeTerminations
================================================================

.. CG-PAGE source=desktop/src/renderer/src/utils/partitionFillV2/outerEdgeTerminations.ts complete=true

*Source file:* ``desktop/src/renderer/src/utils/partitionFillV2/outerEdgeTerminations.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-58

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/outerEdgeTerminations.ts
   :language: typescript
   :lines: 1-58
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** This module answers one narrow question for the render: which units of the section's OUTERMOST columns (the first and the last) have zero correlation ties toward the interior. The imports pull in the shared 2/1/0 classifier, the tie resolver, the section-input builder, and the correlation-edge and column types.

**Why it is here.** Owner ruling 2026-09-04, "zero ties = lens", found on the packaged build: a unit at the bottom of the first column, tied on neither side, was being drawn as an OPEN half-band running out to the section boundary. Under the rule it must instead pinch out toward the edge as a closed lens. The section's outer edges are NOT gaps, so the arrangement engine emits nothing there — the outward extension is drawn by the overlay's open-end stub. This module gives that stub the one thing it cannot see for itself: the engine's own 2/1/0 verdict for each outer unit, reusing ``effectiveCorrForSide`` rather than reinventing the classification.

.. CG-EXPLANATION-END id=module-header

``function outerColumnZeroTieLayerIds``
---------------------------------------

.. CG-BLOCK id=function:outerColumnZeroTieLayerIds lines=59-93

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/outerEdgeTerminations.ts
   :language: typescript
   :lines: 59-93
   :lineno-match:

.. CG-EXPLANATION-START id=function:outerColumnZeroTieLayerIds

**What this does.** Returns the layer ids of outer-column units that are zero-tie toward the interior. It builds the normalised section, resolves the ties, then classifies the first column looking right into gap 0 and the last column looking left into the last gap, collecting each unit whose correlation count comes back as 0.

**Why it is here.** These are exactly the units the open-end stub must pinch out as a lens rather than extend flat to the boundary (owner 2026-09-04). The docstring notes it deliberately uses the light DIRECT-tie path (``resolveTies``) so it runs cheaply on every render including pan and zoom, without the full arrangement pass; it therefore does not fold the rare crossing-tie suspension or jump-tie bridge anchor, which only ever shift the outer-stub shape of a single unit and never touch the interior fill the engine owns.

.. CG-EXPLANATION-END id=function:outerColumnZeroTieLayerIds

