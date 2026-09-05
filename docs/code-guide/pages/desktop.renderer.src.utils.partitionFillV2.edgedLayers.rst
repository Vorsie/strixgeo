desktop.renderer.src.utils.partitionFillV2.edgedLayers
======================================================

.. CG-PAGE source=desktop/src/renderer/src/utils/partitionFillV2/edgedLayers.ts complete=true

*Source file:* ``desktop/src/renderer/src/utils/partitionFillV2/edgedLayers.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-32

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/edgedLayers.ts
   :language: typescript
   :lines: 1-32
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** This file computes, per gap, which layers are edged -- an endpoint of an approved tie that resolves to THAT gap. The section-wide edged set is too coarse: it excludes a unit from lensing in gap M just because it is tied by an edge in the adjacent gap N. This per-gap view fixes the lens-edged class where a minority tied in the adjacent gap must still terminate as a lens in this gap.

**Why it is here.** The docstring explains it uses the same adjacency test that turns an edge into a tie curve (a jump or non-adjacent edge belongs to no single gap and becomes a substrate bridge, so it is not counted). It gives the enclosed-lens extraction the fine per-gap membership it needs. Pure module.

.. CG-EXPLANATION-END id=module-header

``interface EdgedLayers``
-------------------------

.. CG-BLOCK id=interface:EdgedLayers lines=33-59

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/edgedLayers.ts
   :language: typescript
   :lines: 33-59
   :lineno-match:

.. CG-EXPLANATION-START id=interface:EdgedLayers

**What this does.** A type exposing both the coarse section-wide edged set (every layer in any edge) and a fine ``inGap`` test (is this layer tied by an edge resolving to this gap).

**Why it is here.** The docstring notes callers keep the coarse set where it is still correct and use ``inGap`` for the per-gap fix; a layer edged only in a different gap answers false to ``inGap`` even though the section-wide set contains it.

.. CG-EXPLANATION-END id=interface:EdgedLayers

``function buildEdgedLayers``
-----------------------------

.. CG-BLOCK id=function:buildEdgedLayers lines=60-102

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/edgedLayers.ts
   :language: typescript
   :lines: 60-102
   :lineno-match:

.. CG-EXPLANATION-START id=function:buildEdgedLayers

**What this does.** Builds the per-gap edged view: it maps each layer to its column, then for each approved edge adds both endpoints to the section-wide set and, when the endpoints are on adjacent columns, to that gap's edged set.

**Why it is here.** The docstring notes only an adjacent-column edge belongs to a single gap; a non-adjacent jump edge resolves to no gap (it becomes a substrate bridge) and is not counted in any gap's set.

.. CG-EXPLANATION-END id=function:buildEdgedLayers

