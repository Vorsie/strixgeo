desktop.renderer.src.utils.partitionEngineSelect
================================================

.. CG-PAGE source=desktop/src/renderer/src/utils/partitionEngineSelect.ts complete=true

*Source file:* ``desktop/src/renderer/src/utils/partitionEngineSelect.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-43

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionEngineSelect.ts
   :language: typescript
   :lines: 1-43
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The opening comment and the imports. This file is the one place the 2D section overlay, the 3D voxel build request, and the fence builder go to obtain the section partition; it offers three entry points that all wrap the v2 fill engine. It imports the partition data types, the v2 engine and its helpers, the sweep flag, and the logger.

**Why it is here.** The comment records that there is no longer any engine CHOICE: v2 became the measured default (2026-08-01, its drilled-borehole gate identical to v1 while its contact error and mesh size improved), the owner declared it the main engine (2026-08-27) and archived the old one (2026-08-31, debt #280), and the selector flag, the settings toggle, the environment override and the v1 fallback were all removed. The three entry points survive by name and signature only so their many call sites did not have to change.

.. CG-EXPLANATION-END id=module-header

``let loggedEngine``
--------------------

.. CG-BLOCK id=let:loggedEngine lines=44-46

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionEngineSelect.ts
   :language: typescript
   :lines: 44-46
   :lineno-match:

.. CG-EXPLANATION-START id=let:loggedEngine

**What this does.** A module-level flag remembering whether the active engine has already been logged this session.

**Why it is here.** The comment records that it exists so the engine name is logged once and not on every one of the many per-render compute calls.

.. CG-EXPLANATION-END id=let:loggedEngine

``function logEngineOnce``
--------------------------

.. CG-BLOCK id=function:logEngineOnce lines=47-63

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionEngineSelect.ts
   :language: typescript
   :lines: 47-63
   :lineno-match:

.. CG-EXPLANATION-START id=function:logEngineOnce

**What this does.** Logs which engine is active, once per session, on the first compute.

**Why it is here.** The comment records that this keeps a dogfeed screenshot's console naming the engine that drew, without spamming a line on every render.

.. CG-EXPLANATION-END id=function:logEngineOnce

``function withSweepFlag``
--------------------------

.. CG-BLOCK id=function:withSweepFlag lines=64-96

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionEngineSelect.ts
   :language: typescript
   :lines: 64-96
   :lineno-match:

.. CG-EXPLANATION-START id=function:withSweepFlag

**What this does.** Runs a given compute with the two-sided-terminations sweep flag turned on, then restores the flag to whatever it was before.

**Why it is here.** The docstring records that the sweep flag is module state that only the tests set until session 39, and without this the app silently ran the flag-off seam engine (owner dogfeed 2026-07-19, "this doesn't look like any renders"). Because the compute is synchronous, setting and restoring the flag cannot leak across renders.

.. CG-EXPLANATION-END id=function:withSweepFlag

``function computeSectionFillActive``
-------------------------------------

.. CG-BLOCK id=function:computeSectionFillActive lines=97-126

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionEngineSelect.ts
   :language: typescript
   :lines: 97-126
   :lineno-match:

.. CG-EXPLANATION-START id=function:computeSectionFillActive

**What this does.** Computes the section partition — the regions only — running the v2 engine under the sweep flag. It has the same signature and same region contract as the old engine-selecting version.

**Why it is here.** The docstring records that it is the single seam every production call site — the 2D overlay, the 3D voxel build, the fence panels — goes through, and documents its inputs, including the true along-section spacing that lets the deep-to-deep substrate slice at real distances rather than a uniform fallback.

.. CG-EXPLANATION-END id=function:computeSectionFillActive

``function computeSectionFillActiveWithIdentity``
-------------------------------------------------

.. CG-BLOCK id=function:computeSectionFillActiveWithIdentity lines=127-176

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionEngineSelect.ts
   :language: typescript
   :lines: 127-176
   :lineno-match:

.. CG-EXPLANATION-START id=function:computeSectionFillActiveWithIdentity

**What this does.** The identity-carrying version: it returns the partition regions relabelled by the fallback-excluding body weld, plus that weld's merge groups expressed in layer-id space (one group per connected component, the union of its regions' layer ids, dropping components with fewer than two layers).

**Why it is here.** The docstring records that the engine's ordinary output welds same-lithology regions THROUGH substrate and flood fallback paint so the render reads coherently, but the identity the backend persists must NOT include those fallback welds — and that layer ids, never body ids, are the currency sent over the wire.

.. CG-EXPLANATION-END id=function:computeSectionFillActiveWithIdentity

``function computeSectionFillActiveWithDiagnostics``
----------------------------------------------------

.. CG-BLOCK id=function:computeSectionFillActiveWithDiagnostics lines=177-198

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionEngineSelect.ts
   :language: typescript
   :lines: 177-198
   :lineno-match:

.. CG-EXPLANATION-START id=function:computeSectionFillActiveWithDiagnostics

**What this does.** The diagnostics-carrying version: it returns the regions plus the crossing-tie conflicts, the review flags, and the free-draw override status, consuming the classifier's outcome directly so there is no extra engine pass.

**Why it is here.** The docstring records that the plain version stays the regions-only drop-in for the voxel build and fence builder, which draw no warning, while the 2D overlay uses this one so it can show a persistent, non-blocking warning when approved correlation ties cross (bands are suppressed until resolved). The override status is the load-bearing signal for the owner's "red handle, snap back" behaviour: a rejected-unsafe outcome means the engine refused the reach, so the overlay reddens the dragged handle and snaps it back on release.

.. CG-EXPLANATION-END id=function:computeSectionFillActiveWithDiagnostics

