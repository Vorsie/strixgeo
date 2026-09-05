desktop.renderer.src.shell.stages.shared.makeDividePartitionBuilder
===================================================================

.. CG-PAGE source=desktop/src/renderer/src/shell/stages/shared/makeDividePartitionBuilder.ts complete=true

*Source file:* ``desktop/src/renderer/src/shell/stages/shared/makeDividePartitionBuilder.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-35

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/shared/makeDividePartitionBuilder.ts
   :language: typescript
   :lines: 1-35
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Names the file and pulls in its tools. Its job is to assemble the partition that the geotech 'Divide boreholes' step reads a borehole's class off. A partition here is the filled cross-section — the 2-D picture cut into regions (bands, onlaps, lenses) between the CPT columns. It imports the section-input assembler, the divide-partition builder, a feature flag, the partition-input type, the logger, and the per-section edge fetch.

**Why it is here.** The comment records the owner ruling that shaped it (2026-08-15): the borehole problem is really a geometry problem — half-length lenses are drawn between two CPTs, likewise onlaps, and one just checks whether a borehole column falls inside a lens or an onlap. The engine does that intersecting; this file decides which geometry it intersects. Three differences from its two sibling builders are called out as deliberate: it assembles ONE section, not every visible one, because the divide step is section-scoped and a partition for a section the press does not touch is dead weight on the wire; it KEEPS the suspended-reason ties (the voxel rule, not the recompute rule) because the divide must read the same geometry the engineer is looking at, which is what the 2-D overlay draws; and a refusal simply returns nothing so the caller falls back to the older 'donor' rule, meaning a borehole can never come out worse than it does today just because the geometry failed to load.

.. CG-EXPLANATION-END id=module-header

``interface DividePartitionAssemblyParams``
-------------------------------------------

.. CG-BLOCK id=interface:DividePartitionAssemblyParams lines=36-66

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/shared/makeDividePartitionBuilder.ts
   :language: typescript
   :lines: 36-66
   :lineno-match:

.. CG-EXPLANATION-START id=interface:DividePartitionAssemblyParams

**What this does.** Describes the snapshot of inputs read when the divide fires (an 'interface' names the exact shape). The fields are: the project id, the geotech model id (the partition is of its bands, not the litho ones), the single section being divided, the investigations, the geotech band rows, and the set of investigation ids that are boreholes.

**Why it is here.** The borehole ids are carried so they can be held out of the partition's columns: the partition is built from CPT columns, and a borehole is read OFF that geometry rather than being one of the columns that defines it.

.. CG-EXPLANATION-END id=interface:DividePartitionAssemblyParams

``function assembleDividePartition``
------------------------------------

.. CG-BLOCK id=function:assembleDividePartition lines=67-116

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/shared/makeDividePartitionBuilder.ts
   :language: typescript
   :lines: 67-116
   :lineno-match:

.. CG-EXPLANATION-START id=function:assembleDividePartition

**What this does.** The async assembler. It first returns nothing when its feature flag is off. It also returns nothing when there is no project, model or section; when the section's edge fetch failed; when fewer than two CPT columns remain; or when the fill produced nothing. Otherwise it fetches the one section's approved edges, assembles the section inputs, builds the divide partition with the boreholes excluded, logs a one-line summary, and returns the partition keyed by its section id.

**Why it is here.** Returning nothing when the flag is off keeps the whole path one import away from being live again, and makes the divide behave exactly as it did before this geometry existed — the engine answers with its older donor rule. Refusing on a failed edge fetch matters because reading a borehole off a partition built from partial ties would place bands the engineer never drew; every one of the null cases means 'let the donor rule answer', never 'write nothing wrong'. The one-line log is named so a divide that fell back to the donor rule can be told apart from one that read the geometry, without re-running anything.

.. CG-EXPLANATION-END id=function:assembleDividePartition

