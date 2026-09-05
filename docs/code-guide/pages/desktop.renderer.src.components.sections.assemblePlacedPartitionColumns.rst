desktop.renderer.src.components.sections.assemblePlacedPartitionColumns
=======================================================================

.. CG-PAGE source=desktop/src/renderer/src/components/sections/assemblePlacedPartitionColumns.ts complete=true

*Source file:* ``desktop/src/renderer/src/components/sections/assemblePlacedPartitionColumns.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-23

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/assemblePlacedPartitionColumns.ts
   :language: typescript
   :lines: 1-23
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The top of the module that assembles one model's partition columns and their screen x-edges for a section. It imports the layer type, the partition-column type, the shared fence-assembly helper and its types, the screen-edge type, and the placed-column type.

**Why it is here.** The comment records it was extracted (13 August 2026, extract-on-the-second-copy) because the geotech axis now assembles two independent column sets per render — the geotech model here and the litho frame drawn on top. Crucially, the unit-stack half is the SAME shared assembly the project fence and voxel builds consume, so on-screen and built geometry assemble identical columns; only the screen x-edge derivation is overlay-local.

.. CG-EXPLANATION-END id=module-header

``interface PlacedPartitionColumns``
------------------------------------

.. CG-BLOCK id=interface:PlacedPartitionColumns lines=24-50

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/assemblePlacedPartitionColumns.ts
   :language: typescript
   :lines: 24-50
   :lineno-match:

.. CG-EXPLANATION-START id=interface:PlacedPartitionColumns

**What this does.** The named shape of the result: the investigation ids in left-to-right order, a map from id to its gap-free unit stack, and a map from id to its screen left/right edges plus true along-metres.

**Why it is here.** Bundling the ordered ids with the two lookups gives the overlay everything it needs to draw the partition in one place, all sharing the one left-to-right order.

.. CG-EXPLANATION-END id=interface:PlacedPartitionColumns

``function assemblePlacedPartitionColumns``
-------------------------------------------

.. CG-BLOCK id=function:assemblePlacedPartitionColumns lines=51-100

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/assemblePlacedPartitionColumns.ts
   :language: typescript
   :lines: 51-100
   :lineno-match:

.. CG-EXPLANATION-START id=function:assemblePlacedPartitionColumns

**What this does.** The function. It turns each accepted layer into a fence-layer input keyed to its investigation, maps each placed column to its along-distance and surface elevation, runs the shared partition-input assembly, and then pairs each assembled column with the placed column's nudged screen edges to fill the two lookups and the ordered id list.

**Why it is here.** The comments record two points: it uses the canonical CPT-first-then-borehole anchor order so the on-screen and built paths agree, which is the whole point of sharing the assembly; and it derives the screen edges from the placed columns' nudged x and width, the one piece that must stay overlay-local because the 3-D builds have no screen.

.. CG-EXPLANATION-END id=function:assemblePlacedPartitionColumns

