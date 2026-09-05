groundmodel.api.schemas.project.rebuild_litho_solids_response
=============================================================

.. CG-PAGE source=src/groundmodel/api/schemas/project/rebuild_litho_solids_response.py complete=true

*Source file:* ``src/groundmodel/api/schemas/project/rebuild_litho_solids_response.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-10

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/rebuild_litho_solids_response.py
   :language: python
   :lines: 1-10
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Imports the base model and ``Field``, the gapless-report shape, and the solid response shape.

**Why it is here.** The reply embeds both a per-build gapless report and the rebuilt solid list, so it imports both.

.. CG-EXPLANATION-END id=module-header

Class ``RebuildLithoSolidsResponse``
------------------------------------

.. CG-BLOCK id=class:RebuildLithoSolidsResponse lines=11-80

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/rebuild_litho_solids_response.py
   :language: python
   :lines: 11-80
   :lineno-match:

.. CG-EXPLANATION-START id=class:RebuildLithoSolidsResponse

**What this does.** The result of a 3-D voxel build: counts of bodies considered, built, skipped by checksum, and flagged; orphan solids deleted; the full solid list after the build; the investigations dropped from the model floor or left outside the footprint; a reason when the build produced nothing; and the seven-clause gapless report.

**Why it is here.** The docstring records several honesty decisions. The list of investigations outside the footprint means the build is INCOMPLETE even though it succeeded, so the desktop must not report a plain success — the toast severity is derived from it, the same way the geotech verbs derive theirs. The empty-reason field exists because a degenerate build deletes the stored model yet its counts read like a happy build of zero bodies, so without it the client could show a green "Built 0 bodies" over a model that was just erased. The full solid list rides back to avoid a second round-trip. The name predates the voxel builder (a retired builder returned the same shape).

.. CG-EXPLANATION-END id=class:RebuildLithoSolidsResponse

