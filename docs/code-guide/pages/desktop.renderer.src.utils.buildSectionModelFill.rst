desktop.renderer.src.utils.buildSectionModelFill
================================================

.. CG-PAGE source=desktop/src/renderer/src/utils/buildSectionModelFill.ts complete=true

*Source file:* ``desktop/src/renderer/src/utils/buildSectionModelFill.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-40

.. literalinclude:: ../../../desktop/src/renderer/src/utils/buildSectionModelFill.ts
   :language: typescript
   :lines: 1-40
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The opening comment and imports for a pure helper that turns the backend's body-solid responses into the mesh format the section sampler and slicer consume. The block also shows the function's documentation of the three rules it follows.

**Why it is here.** The comment records that it is kept pure — no React, no input/output — so it can be unit-tested and reused anywhere the API response must be bridged to the sampler, and that it lives in its own module (debt #201) to keep the already-large section panel component lean while making the business rule testable in isolation.

.. CG-EXPLANATION-END id=module-header

``function buildModelFillMeshes``
---------------------------------

.. CG-BLOCK id=function:buildModelFillMeshes lines=41-68

.. literalinclude:: ../../../desktop/src/renderer/src/utils/buildSectionModelFill.ts
   :language: typescript
   :lines: 41-68
   :lineno-match:

.. CG-EXPLANATION-START id=function:buildModelFillMeshes

**What this does.** Walks the backend body solids and builds a mesh for each, with three rules: it skips any solid marked flagged; it uses the solid's own display colour when it has one, otherwise it asks the supplied colour resolver for the formation's colour; and it keeps stale solids rather than dropping them. Each kept solid becomes a mesh carrying its body id, formation id, resolved colour, vertices, and triangles.

**Why it is here.** The docstring records each rule's reason: flagged solids are under-constrained best-effort slabs that may not be watertight, and both the ray sampler and the plane slicer assume a watertight shape, so they are excluded; the colour falls back to the formation lookup so the section fill matches the litho inspector's palette; and staleness is only a freshness flag (a contact changed since the last Build), not a geometry-correctness flag, so the last-built mesh is still valid and is rendered rather than made to vanish after every contact edit — the engineer refreshes it by pressing Build again.

.. CG-EXPLANATION-END id=function:buildModelFillMeshes

