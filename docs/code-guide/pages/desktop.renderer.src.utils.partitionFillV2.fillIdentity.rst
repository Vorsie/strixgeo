desktop.renderer.src.utils.partitionFillV2.fillIdentity
=======================================================

.. CG-PAGE source=desktop/src/renderer/src/utils/partitionFillV2/fillIdentity.ts complete=true

*Source file:* ``desktop/src/renderer/src/utils/partitionFillV2/fillIdentity.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-41

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/fillIdentity.ts
   :language: typescript
   :lines: 1-41
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** This module produces the geometric-identity view of one fill pass — the version of the regions the backend persists as body-connectivity evidence. The display merge unions same-soil regions THROUGH inferred substrate and flood paint so the picture reads as one body; the persisted identity must not, because inferred fill is not evidence that two drilled bodies are one. So this runs the same weld with fallback paint excluded, on the pre-merge regions carrying layer ids, and only when a caller asks for it.

**Why it is here.** The docstring records the render path never pays for this, and that before the weld it augments each real region's layer ids with geometric column-edge attribution to fix the S10-S6 refused-tie defect (dogfeed 2026-08-12): the seed path names only the seed units, and the enclosed-lens merge can splice an interbedded column's middle units out entirely, so their layer ids appear in zero regions and can never join a group.

.. CG-EXPLANATION-END id=module-header

``const ELEV_OVERLAP_M``
------------------------

.. CG-BLOCK id=const:ELEV_OVERLAP_M lines=42-53

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/fillIdentity.ts
   :language: typescript
   :lines: 42-53
   :lineno-match:

.. CG-EXPLANATION-START id=const:ELEV_OVERLAP_M

**What this does.** A constant, one millimetre: the strict elevation-overlap floor for column-edge attribution.

**Why it is here.** The docstring records it mirrors the backend's overlap floor: a unit merely touching a span at its top or base contact is abutment, not overlap, and must not be credited.

.. CG-EXPLANATION-END id=const:ELEV_OVERLAP_M

``interface FillIdentity``
--------------------------

.. CG-BLOCK id=interface:FillIdentity lines=54-87

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/fillIdentity.ts
   :language: typescript
   :lines: 54-87
   :lineno-match:

.. CG-EXPLANATION-START id=interface:FillIdentity

**What this does.** A type holding the identity view of a pass: the sliced regions relabelled by the fallback-excluding weld, plus that weld's merge groups expressed as lists of layer ids.

**Why it is here.** The docstring records layer ids are the wire currency of the recompute because they never change, whereas body-id groups could not survive their own success (a merge relabelled the refetched regions and erased its own evidence).

.. CG-EXPLANATION-END id=interface:FillIdentity

``function augmentRegionLayerIdsAtColumnEdges``
-----------------------------------------------

.. CG-BLOCK id=function:augmentRegionLayerIdsAtColumnEdges lines=88-153

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/fillIdentity.ts
   :language: typescript
   :lines: 88-153
   :lineno-match:

.. CG-EXPLANATION-START id=function:augmentRegionLayerIdsAtColumnEdges

**What this does.** Adds to each non-fallback region's layer ids the same-soil raw drilled units its paint geometrically covers at its gap's two column edges. It groups the raw units by column, and for each region samples its elevation span at each edge using the engine's own gap-edge snap tolerance and credits every same-soil raw unit that strictly overlaps that span.

**Why it is here.** The docstring records that a region's paint reaching a column over an elevation window that strictly overlaps a same-soil drilled unit is evidence of that unit whatever the seed said, and that fallback-painted regions are left untouched because inferred fill names no layer. The default render output stays byte-identical.

.. CG-EXPLANATION-END id=function:augmentRegionLayerIdsAtColumnEdges

``function computeFillIdentity``
--------------------------------

.. CG-BLOCK id=function:computeFillIdentity lines=154-162

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/fillIdentity.ts
   :language: typescript
   :lines: 154-162
   :lineno-match:

.. CG-EXPLANATION-START id=function:computeFillIdentity

**What this does.** Computes the identity view of one pass's pre-merge regions: on the product path it augments the layer ids and runs the fallback-excluding weld with groups; on the frozen fallback path it returns the raw regions with no groups.

**Why it is here.** The docstring records the fallback path has no display merge either, so its identity is the raw regions with nothing welded, and both paths weld on the same per-gap tolerance the display merge used so identity and display agree on geometry.

.. CG-EXPLANATION-END id=function:computeFillIdentity

