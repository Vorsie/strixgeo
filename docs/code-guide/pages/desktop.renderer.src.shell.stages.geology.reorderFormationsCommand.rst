desktop.renderer.src.shell.stages.geology.reorderFormationsCommand
==================================================================

.. CG-PAGE source=desktop/src/renderer/src/shell/stages/geology/reorderFormationsCommand.ts complete=true

*Source file:* ``desktop/src/renderer/src/shell/stages/geology/reorderFormationsCommand.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-24

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/geology/reorderFormationsCommand.ts
   :language: typescript
   :lines: 1-24
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Opens the file — the formation drag-reorder command, the pure logic plus its undo — and imports the API client and formation type, the logger, the shared oldest-first comparator, and the undo-command type.

**Why it is here.** Extracted from the inspector's reorder callback (debt #201) so the ``useGeologyFormations`` hook stays under the 500-line file cap; the hook keeps a thin wrapper that just builds the dependency bag and delegates here, and behaviour is byte-identical. A formation's ``display_order`` is its stratigraphic order (oldest first) — the order sections and the 3-D view paint in. The reorder runs in the displayed youngest-first space and inverts each index back to ``display_order = (N - 1 - i)`` so the data contract and every renderer stay unchanged; only the human-facing list flips. Every reordered formation is pinned so the next Build leaves the ordering intact, and the undo restores each row's pre-drag pin state exactly (debt #35).

.. CG-EXPLANATION-END id=module-header

``interface ReorderFormationsDeps``
-----------------------------------

.. CG-BLOCK id=interface:ReorderFormationsDeps lines=25-60

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/geology/reorderFormationsCommand.ts
   :language: typescript
   :lines: 25-60
   :lineno-match:

.. CG-EXPLANATION-START id=interface:ReorderFormationsDeps

**What this does.** Declares everything the command reads or writes, supplied per call by the hook's wrapper: the project id, the local formation mirror (the reorder's source of truth), the visible-formation manifest, the state setters, the bus notifier fired after an update, the undo-push, and the refetch used on failure.

**Why it is here.** The command takes its dependencies as one parameter rather than closing over the hook's variables, which is what lets it live outside the hook as testable pure-ish logic — the file-cap split and the helper-hygiene rule both point this way.

.. CG-EXPLANATION-END id=interface:ReorderFormationsDeps

``function reorderFormationsCommand``
-------------------------------------

.. CG-BLOCK id=function:reorderFormationsCommand lines=61-232

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/geology/reorderFormationsCommand.ts
   :language: typescript
   :lines: 61-232
   :lineno-match:

.. CG-EXPLANATION-START id=function:reorderFormationsCommand

**What this does.** Persists a drag-reorder and pushes its undo. It derives the visible list, reverses it to youngest-first, moves the dragged formation to the drop position, maps each new slot back to a ``display_order`` value, keeps only the rows whose order actually changed, optimistically updates the local mirror (pinning the moved rows), sends one PATCH per changed row (pinned), then registers an undo that restores both the order and the pre-drag pin state plus a redo that re-applies. If a PATCH fails it refetches the list from the server.

**Why it is here.** Youngest-first is the human reading order (a borehole log or stratigraphic column) while ``display_order`` is ascending oldest-first (the paint order), so the inversion keeps the stored contract fixed while flipping only the on-screen list. Pinning (debt #35) stops the next Build from re-inferring the age order and quietly reverting the deliberate arrangement; undo must restore the exact pre-drag pin state, so a row that was not pinned goes back to unpinned and Build can re-infer it. The refetch on error re-syncs the mirror after a failed optimistic update.

.. CG-EXPLANATION-END id=function:reorderFormationsCommand

``function sortFormations``
---------------------------

.. CG-BLOCK id=function:sortFormations lines=233-237

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/geology/reorderFormationsCommand.ts
   :language: typescript
   :lines: 233-237
   :lineno-match:

.. CG-EXPLANATION-START id=function:sortFormations

**What this does.** A tiny helper that returns a copy of the rows sorted oldest-first — ``display_order`` ascending, with the name as tiebreak — using the shared comparator.

**Why it is here.** Extracted so the command and the hook both sort through one shared comparator, keeping the ordering rule a single source of truth.

.. CG-EXPLANATION-END id=function:sortFormations

