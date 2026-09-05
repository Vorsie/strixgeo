desktop.renderer.src.utils.sectionPartition.index
=================================================

.. CG-PAGE source=desktop/src/renderer/src/utils/sectionPartition/index.ts complete=true

*Source file:* ``desktop/src/renderer/src/utils/sectionPartition/index.ts``

.. contents::
   :local:
   :depth: 1

Module header — the whole file
------------------------------

.. CG-BLOCK id=module-header lines=1-36

.. literalinclude:: ../../../desktop/src/renderer/src/utils/sectionPartition/index.ts
   :language: typescript
   :lines: 1-36
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The package barrel: it re-exports the shared partition vocabulary from the four sibling files (the types and constants, the matcher, the two column-reduction helpers, the region-area helpers and the polygon slicer) under one import path.

**Why it is here.** The comment records this is what SURVIVED the v1 partition engine (debt #280, archived 2026-08-31): it holds no engine of its own — the fill lives in ``partitionFillV2`` — only the currency every consumer of a partition speaks, gathered behind one door so callers import from one place.

.. CG-EXPLANATION-END id=module-header

