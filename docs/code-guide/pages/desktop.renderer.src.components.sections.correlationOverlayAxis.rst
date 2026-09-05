desktop.renderer.src.components.sections.correlationOverlayAxis
===============================================================

.. CG-PAGE source=desktop/src/renderer/src/components/sections/correlationOverlayAxis.ts complete=true

*Source file:* ``desktop/src/renderer/src/components/sections/correlationOverlayAxis.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-27

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/correlationOverlayAxis.ts
   :language: typescript
   :lines: 1-27
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Names the file and states the rules it encodes. It holds the axis-aware decisions for the section-view correlation overlay, pulled out of the ``SectionPanel`` component so they are pure and testable. The section can show three model axes — geological, lithostratigraphic (litho), and geotechnical (geotech) — and these helpers decide which model's data the overlay reads on each axis. It imports the correlation-edge and layer types.

**Why it is here.** The comment records two load-bearing rules: the overlay mounts on both the litho and geotech axes, with the geotech axis reading a separate geotech edge list; and (owner ruling 2026-08-13) the geotech axis's partition is the geotech model's own, so the edge source and the layer source must move together. This supersedes an earlier guard (commit 7329738b) that forced the partition to read litho edges on every axis and, by feeding geotech edges to a litho-layer partition, pinched every litho band to a lens.

.. CG-EXPLANATION-END id=module-header

``type AxisMode``
-----------------

.. CG-BLOCK id=type:AxisMode lines=28-54

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/correlationOverlayAxis.ts
   :language: typescript
   :lines: 28-54
   :lineno-match:

.. CG-EXPLANATION-START id=type:AxisMode

**What this does.** Names the section-view model axis — one of geological, lithostratigraphic, or geotechnical.

**Why it is here.** It mirrors the ``axisMode`` input the ``SectionPanel`` component already carries, so the helpers speak the same vocabulary.

.. CG-EXPLANATION-END id=type:AxisMode

``function shouldMountCorrelationOverlay``
------------------------------------------

.. CG-BLOCK id=function:shouldMountCorrelationOverlay lines=55-85

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/correlationOverlayAxis.ts
   :language: typescript
   :lines: 55-85
   :lineno-match:

.. CG-EXPLANATION-START id=function:shouldMountCorrelationOverlay

**What this does.** Decides whether the correlation overlay should be drawn for the current axis and gesture state — on the litho and geotech axes, when correlations are shown or the correlate gesture is armed.

**Why it is here.** The docstring records it stays absent on the geological axis so it never intercepts geological-axis interactions, and stays mounted while correlate mode is on even if correlations are hidden, because the overlay also hosts the correlate hit-targets and unmounting it would silently break correlate clicks.

.. CG-EXPLANATION-END id=function:shouldMountCorrelationOverlay

``function overlayEdgeSource``
------------------------------

.. CG-BLOCK id=function:overlayEdgeSource lines=86-106

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/correlationOverlayAxis.ts
   :language: typescript
   :lines: 86-106
   :lineno-match:

.. CG-EXPLANATION-START id=function:overlayEdgeSource

**What this does.** Returns the edge list the overlay draws as ribbons and right-click targets — the separate geotech packing edges on the geotech axis, and the litho contact edges on every other axis.

**Why it is here.** The geotech axis hosts the geotech model's own packing correlations, so its ribbons must come from that separate list rather than the litho edges.

.. CG-EXPLANATION-END id=function:overlayEdgeSource

``function partitionsGeotechModel``
-----------------------------------

.. CG-BLOCK id=function:partitionsGeotechModel lines=107-139

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/correlationOverlayAxis.ts
   :language: typescript
   :lines: 107-139
   :lineno-match:

.. CG-EXPLANATION-START id=function:partitionsGeotechModel

**What this does.** A small private predicate answering whether the geotech model frames the partition on this axis — true on the geotech axis unless the 'Show litho fill' toggle is on.

**Why it is here.** The docstring records that one place answers this so the edge source and the layer source can never disagree — a layer-versus-edge mismatch was exactly the fault the retired 7329738b guard was built around.

.. CG-EXPLANATION-END id=function:partitionsGeotechModel

``function partitionEdgeSource``
--------------------------------

.. CG-BLOCK id=function:partitionEdgeSource lines=140-172

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/correlationOverlayAxis.ts
   :language: typescript
   :lines: 140-172
   :lineno-match:

.. CG-EXPLANATION-START id=function:partitionEdgeSource

**What this does.** Returns the edge list that frames the partition fill — the geotech model's packing ties on the geotech axis (the same approved set the 3-D build consumes), and the litho contact edges otherwise.

**Why it is here.** The docstring records that an absent geotech list yields an empty list, never the litho list, because a section with no packing model must paint nothing rather than the litho fill (dogfeed 2026-08-06); and it deliberately does not drive the correlated-pair column spacing, which stays litho-framed on every axis so the columns do not shift when the fill's source changes.

.. CG-EXPLANATION-END id=function:partitionEdgeSource

``function partitionLayerSource``
---------------------------------

.. CG-BLOCK id=function:partitionLayerSource lines=173-209

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/correlationOverlayAxis.ts
   :language: typescript
   :lines: 173-209
   :lineno-match:

.. CG-EXPLANATION-START id=function:partitionLayerSource

**What this does.** Returns the layers the partition's columns are assembled from — the geotech model's packing bands on the geotech axis, the litho model's layers otherwise.

**Why it is here.** The docstring records it is the sibling of the edge source: the correlation edges reference layer ids, so the edge list and the layer list must always name the same model.

.. CG-EXPLANATION-END id=function:partitionLayerSource

``function partitionColorSource``
---------------------------------

.. CG-BLOCK id=function:partitionColorSource lines=210-220

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/correlationOverlayAxis.ts
   :language: typescript
   :lines: 210-220
   :lineno-match:

.. CG-EXPLANATION-START id=function:partitionColorSource

**What this does.** Returns the formation-to-colour palette matching whichever model frames the partition, swapping to the litho palette only when the geotech 'Show litho fill' toggle is on.

**Why it is here.** The docstring records that a palette keyed by the wrong model resolves nothing and every region falls back to neutral grey — the axis palette knows only geotech formation ids on the geotech axis, so when the fill swaps back to the litho model its regions carry litho formation ids that palette has never heard of; the palette has to travel with the model.

.. CG-EXPLANATION-END id=function:partitionColorSource

