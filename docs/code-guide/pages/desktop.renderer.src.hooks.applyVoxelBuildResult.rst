desktop.renderer.src.hooks.applyVoxelBuildResult
================================================

.. CG-PAGE source=desktop/src/renderer/src/hooks/applyVoxelBuildResult.ts complete=true

*Source file:* ``desktop/src/renderer/src/hooks/applyVoxelBuildResult.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-13

.. literalinclude:: ../../../desktop/src/renderer/src/hooks/applyVoxelBuildResult.ts
   :language: typescript
   :lines: 1-13
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The opening comment and the imports (two response types from the API client, the gapless-report type, the logger, and the translation helper). This file holds one function that applies a finished 3-D voxel-build response to the on-screen litho-solid state.

**Why it is here.** It was pulled out of the litho-solids hook so that BOTH the one-shot build path and the newer streaming background-job path (debt #282) refresh in exactly the same way — the solids list, the gapless verdict, the project-dirty flag, and the outcome message are identical whichever path ran (the ``extract on the second copy`` rule from CLAUDE.md).

.. CG-EXPLANATION-END id=module-header

``interface VoxelBuildResultSink``
----------------------------------

.. CG-BLOCK id=interface:VoxelBuildResultSink lines=14-32

.. literalinclude:: ../../../desktop/src/renderer/src/hooks/applyVoxelBuildResult.ts
   :language: typescript
   :lines: 14-32
   :lineno-match:

.. CG-EXPLANATION-START id=interface:VoxelBuildResultSink

**What this does.** The bundle of setters and side-effect hooks the apply needs: ``setSolids``, ``setGaplessReport``, ``toast``, and an optional ``onMutated`` (mark the project changed). These lines also carry the documentation of the function below.

**Why it is here.** Passing this bundle in — rather than wiring the function to one caller — is what lets the same apply serve both build paths, each supplying its own setters, which are owned by the litho-solids hook.

.. CG-EXPLANATION-END id=interface:VoxelBuildResultSink

``function applyVoxelBuildResult``
----------------------------------

.. CG-BLOCK id=function:applyVoxelBuildResult lines=33-118

.. literalinclude:: ../../../desktop/src/renderer/src/hooks/applyVoxelBuildResult.ts
   :language: typescript
   :lines: 33-118
   :lineno-match:

.. CG-EXPLANATION-START id=function:applyVoxelBuildResult

**What this does.** Takes the build response and the setter bundle. It logs the outcome, applies the returned solids directly, stores the gapless verdict alongside them (or clears a stale one when the response carries none), logs whether the gate passed or failed, marks the project changed, then chooses the message: a build that produced nothing (and so cleared the stored model) warns with the reason; otherwise it names any uncovered investigations and any under-constrained bodies as a warning, or shows a success message when the build is clean.

**Why it is here.** The response already carries the updated solids, so they are applied directly with no second fetch, and the verdict lands with them because it describes THESE solids — a missing report clears the old verdict rather than leaving a stale one beside a fresh model. The gate fails the REPORT, never the build, so a failed verdict is a warning beside a successful build, not an error. The project is marked changed only AFTER the call lands, because a refused build changes nothing (a build rides in the ``.strix`` bundle like any other unsaved change). An empty build says what happened instead of a green ``Built 0 bodies`` over an erased model, and uncovered investigations lead the message because those have no 3-D model at all — the harder problem.

.. CG-EXPLANATION-END id=function:applyVoxelBuildResult

