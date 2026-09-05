desktop.renderer.src.utils.buildDividePartition
===============================================

.. CG-PAGE source=desktop/src/renderer/src/utils/buildDividePartition.ts complete=true

*Source file:* ``desktop/src/renderer/src/utils/buildDividePartition.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-45

.. literalinclude:: ../../../desktop/src/renderer/src/utils/buildDividePartition.ts
   :language: typescript
   :lines: 1-45
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The imports and a long docstring for the one function this file exports. The docstring explains what the "Divide boreholes" feature reads: it casts each borehole's vertical line through a cross-section partition and reads off what the line cuts, so this function's only job is to get right which partition to send. It also describes the crucial subtlety — the boreholes must be dropped from the columns first — and the inputs and return.

**Why it is here.** The docstring records the owner's ruling (2026-08-15) that borehole division is a pure geometry problem, and warns of a silent failure: a borehole a previous press already divided carries geotech bands, so if it were left in the columns the fill would treat it as a column and split the gap at it, leaving no geometry spanning the borehole to intersect — the feature would look broken, but only on the second press. Excluding the boreholes makes the payload the CPT-to-CPT partition, which is the geometry the borehole is meant to be a sample of.

.. CG-EXPLANATION-END id=module-header

``function buildDividePartition``
---------------------------------

.. CG-BLOCK id=function:buildDividePartition lines=46-93

.. literalinclude:: ../../../desktop/src/renderer/src/utils/buildDividePartition.ts
   :language: typescript
   :lines: 46-93
   :lineno-match:

.. CG-EXPLANATION-START id=function:buildDividePartition

**What this does.** Makes a copy of the section with every borehole removed from both its columns and its layers, then bails out (returning null) if fewer than two CPT columns remain. Otherwise it assembles the section partition frame, runs the active fill engine to get the regions, and returns the partition — the section endpoints, the CPT-only columns, and the regions.

**Why it is here.** The docstring and inline log record the reason for the two-column floor: one column has no gap, so there is no geometry for a borehole to stand inside, and in that case the backend's donor rule should answer instead of this partition. Dropping the boreholes before the fill is the whole point explained in the header — it keeps them inside a gap to be read, not standing on a gap edge.

.. CG-EXPLANATION-END id=function:buildDividePartition

