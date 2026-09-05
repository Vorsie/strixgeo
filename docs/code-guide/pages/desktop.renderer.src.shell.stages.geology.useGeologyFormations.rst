desktop.renderer.src.shell.stages.geology.useGeologyFormations
==============================================================

.. CG-PAGE source=desktop/src/renderer/src/shell/stages/geology/useGeologyFormations.ts complete=true

*Source file:* ``desktop/src/renderer/src/shell/stages/geology/useGeologyFormations.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-31

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/geology/useGeologyFormations.ts
   :language: typescript
   :lines: 1-31
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Opens the file — the geology inspector's formation-roster create/edit/delete plus drag-reorder hook — and imports React hooks, the API client with its payload and response types, the logger, the undo-command type, and the reorder command plus the sort helper.

**Why it is here.** Extracted verbatim from the inspector (debt #201) so the orchestrator stays a thin composer. A custom hook is a ``use...`` function of the app's own that packages reusable stateful logic; this one owns the local formations mirror, the effect that re-syncs it from the shell bus, the dialog state, the drag state, and the mutation handlers (each pushing its own undo). Behaviour is unchanged — the local mirror is the optimistic-update target while the on-screen render reads the bus list, so a mutation appears only once the bus refreshes.

.. CG-EXPLANATION-END id=module-header

``interface UseGeologyFormationsArgs``
--------------------------------------

.. CG-BLOCK id=interface:UseGeologyFormationsArgs lines=32-53

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/geology/useGeologyFormations.ts
   :language: typescript
   :lines: 32-53
   :lineno-match:

.. CG-EXPLANATION-START id=interface:UseGeologyFormationsArgs

**What this does.** Declares what the hook needs from the shell bus: the project id, the bus formation list, a refresh counter, the visible-formation manifest, the created / updated / deleted notifiers, a refetch function, and the undo-push.

**Why it is here.** All of these are sourced by the orchestrator's ``useShell()`` destructure and passed in, so the hook has no direct coupling to the bus — it receives its inputs the way a component receives props.

.. CG-EXPLANATION-END id=interface:UseGeologyFormationsArgs

``interface UseGeologyFormationsResult``
----------------------------------------

.. CG-BLOCK id=interface:UseGeologyFormationsResult lines=54-97

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/geology/useGeologyFormations.ts
   :language: typescript
   :lines: 54-97
   :lineno-match:

.. CG-EXPLANATION-START id=interface:UseGeologyFormationsResult

**What this does.** Declares what the hook returns: the dialog state and setters (the create/edit dialog open flag, the row being edited, the pending-delete row, the delete-busy flag), the drag state and setters, the reorder-busy flag, and the handlers — reorder, create, update, colour-change and delete.

**Why it is here.** The orchestrator calls the hook once and threads these fields into its presentational sibling panels, so one hook feeds many consumers.

.. CG-EXPLANATION-END id=interface:UseGeologyFormationsResult

``function useGeologyFormations``
---------------------------------

.. CG-BLOCK id=function:useGeologyFormations lines=98-402

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/geology/useGeologyFormations.ts
   :language: typescript
   :lines: 98-402
   :lineno-match:

.. CG-EXPLANATION-START id=function:useGeologyFormations

**What this does.** The hook body. It keeps a local, sorted mirror of the bus formations and re-seeds it whenever the bus list or the refresh counter changes; it owns the dialog and drag state. ``reorderFormations`` is a thin wrapper over the pure reorder command. The create, update, colour-change and delete handlers each call the API, optimistically update the mirror, fire the matching bus notifier, and push an undo command carrying a revert and a reapply step.

**Why it is here.** The local mirror is the optimistic-update target so an edit shows on screen instantly while the bus refreshes behind it. Every mutation is undoable: revert re-creates, re-deletes or re-colours, and reapply mirrors the change forward. The inline colour override rides the existing project-scoped ``color`` field — no new persistence layer — so a recolour flows automatically to the section editor, the 3-D viewer and the DXF and Plaxis exports, and ships in the ``.gmproj`` bundle on the next save. The reorder wrapper's dependency-list suppression is preserved verbatim because the manifest is stable within a project.

.. CG-EXPLANATION-END id=function:useGeologyFormations

