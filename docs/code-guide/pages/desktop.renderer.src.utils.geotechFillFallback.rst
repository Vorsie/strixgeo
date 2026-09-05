desktop.renderer.src.utils.geotechFillFallback
==============================================

.. CG-PAGE source=desktop/src/renderer/src/utils/geotechFillFallback.ts complete=true

*Source file:* ``desktop/src/renderer/src/utils/geotechFillFallback.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-16

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechFillFallback.ts
   :language: typescript
   :lines: 1-16
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** This file decides which litho regions the geotech partition leaves unpainted, so those can be shown in their lithology colour beneath the geotech fills. The comment records the owner ruling (2026-08-13) behind the surrounding design: the geotech axis renders the geotech partition directly (the same computation the 3-D build runs) rather than a refined litho partition, litho geometry stays visually authoritative as dark outlines on top, and any litho region the geotech model has no bands for is painted in its lithology colour underneath. This module answers the second half — which regions those are. It is pure, leaving projection and painting to the caller.

**Why it is here.** The reason is recorded in the comment: the owner's guidance was to reuse the litho stage's fill engine rather than invent a new one, since geotech simply has more classes, and to keep lithology visible where the packing model has no data so the section is never left with a blank patch.

.. CG-EXPLANATION-END id=module-header

``interface FallbackPackingBand``
---------------------------------

.. CG-BLOCK id=interface:FallbackPackingBand lines=17-29

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechFillFallback.ts
   :language: typescript
   :lines: 17-29
   :lineno-match:

.. CG-EXPLANATION-START id=interface:FallbackPackingBand

**What this does.** Describes one packing band on a column in absolute elevation: its top and base in metres above the reference datum, and its main soil code (or nothing when its formation carries none).

**Why it is here.** The fallback rule tests each band's elevation span and soil against a litho region, so those three fields are what it needs from a band.

.. CG-EXPLANATION-END id=interface:FallbackPackingBand

``interface FallbackCandidateRegion``
-------------------------------------

.. CG-BLOCK id=interface:FallbackCandidateRegion lines=30-48

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechFillFallback.ts
   :language: typescript
   :lines: 30-48
   :lineno-match:

.. CG-EXPLANATION-START id=interface:FallbackCandidateRegion

**What this does.** Describes the litho-region fields the rule reads: the index of the gap it tiles, its litho formation id (which gives its lithology and hence its soil), and its ring, of which only the elevations are read.

**Why it is here.** The rule needs only the vertical envelope and the region's lithology, so this states the minimal shape; callers may carry more fields on their own region objects.

.. CG-EXPLANATION-END id=interface:FallbackCandidateRegion

``const OVERLAP_SLOP_M``
------------------------

.. CG-BLOCK id=const:OVERLAP_SLOP_M lines=49-83

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechFillFallback.ts
   :language: typescript
   :lines: 49-83
   :lineno-match:

.. CG-EXPLANATION-START id=const:OVERLAP_SLOP_M

**What this does.** A vertical tolerance of two centimetres.

**Why it is here.** The comment records it is inherited from the retired refinement engine's own overlap filter: a band grazing a region by less than two centimetres is not that region's packing. The exact number is kept so that swapping the engine did not silently repaint any region that was already classified.

.. CG-EXPLANATION-END id=const:OVERLAP_SLOP_M

``function selectLithoFallbackRegions``
---------------------------------------

.. CG-BLOCK id=function:selectLithoFallbackRegions lines=84-120

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechFillFallback.ts
   :language: typescript
   :lines: 84-120
   :lineno-match:

.. CG-EXPLANATION-START id=function:selectLithoFallbackRegions

**What this does.** Selects the litho regions the geotech partition does not cover. For each region it finds its top and base elevation from its ring, reads its lithology's soil code, and checks each flanking column: a column covers the region if it carries a packing band of the region's own soil whose elevation span overlaps the region's (beyond the two-centimetre tolerance). A region is returned as fallback only when neither flanking column covers it. A ring with no usable envelope is treated as unpacked rather than crashed on.

**Why it is here.** The docstring records the logic. One packed side is enough to disqualify a region because the geotech partition reaches across a gap from a single tied column, so a region with data on one side is already painted in packing colours and must not be double-painted. The soil guard is the refinement engine's own — a sand band can never stand in for a clay region — while a region whose lithology has no soil code accepts any packing soil, matching the engine's own null-soil branch. Using a *generic type* ``<R>`` lets the function return the caller's own region objects, order preserved, rather than stripped-down copies.

.. CG-EXPLANATION-END id=function:selectLithoFallbackRegions

