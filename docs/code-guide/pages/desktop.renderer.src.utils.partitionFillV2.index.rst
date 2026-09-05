desktop.renderer.src.utils.partitionFillV2.index
================================================

.. CG-PAGE source=desktop/src/renderer/src/utils/partitionFillV2/index.ts complete=true

*Source file:* ``desktop/src/renderer/src/utils/partitionFillV2/index.ts``

.. contents::
   :local:
   :depth: 1

Module header — the whole file
------------------------------

.. CG-BLOCK id=module-header lines=1-51

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/index.ts
   :language: typescript
   :lines: 1-51
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** This is the package's index file — the one place that lists what the ``partitionFillV2`` package exposes to the rest of the app. It re-exports the arrangement types and builder, the domain entry points that compute a section's fill, and the shared types (ties, faces, columns, review flags, crossing conflicts). It contains no logic of its own.

**Why it is here.** The docstring describes the pipeline the package implements (snap to grid, intersect and split, build the planar DCEL, trace faces) and marks the public entry point, so a reader knows this file is the front door, not where any work happens.

.. CG-EXPLANATION-END id=module-header

