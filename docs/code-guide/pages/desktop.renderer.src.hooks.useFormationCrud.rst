desktop.renderer.src.hooks.useFormationCrud
===========================================

.. CG-PAGE source=desktop/src/renderer/src/hooks/useFormationCrud.ts complete=true

*Source file:* ``desktop/src/renderer/src/hooks/useFormationCrud.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-21

.. literalinclude:: ../../../desktop/src/renderer/src/hooks/useFormationCrud.ts
   :language: typescript
   :lines: 1-21
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The file's opening documentation and imports: ``useCallback`` and two state-setter types from React, the API client, three formation-related types, and the logger.

**Why it is here.** The same split as the ``desktop.renderer.src.hooks.useContactCrud`` page — this is the create / update / delete cluster for geological *formations* (the named rock or soil units), pulled out of the larger ``useGeologicalModel`` hook (debt #201) so the parent stays a thin owner of shared state. The docstring records that it is a leaf: no other handler calls these, so it lifts out cleanly.

.. CG-EXPLANATION-END id=module-header

``interface UseFormationCrudParams``
------------------------------------

.. CG-BLOCK id=interface:UseFormationCrudParams lines=22-39

.. literalinclude:: ../../../desktop/src/renderer/src/hooks/useFormationCrud.ts
   :language: typescript
   :lines: 22-39
   :lineno-match:

.. CG-EXPLANATION-START id=interface:UseFormationCrudParams

**What this does.** Describes the shared state and helpers passed in: the open project; four helpers to add or remove formation ids from the bundle manifest and from the session-import (dirty) set; a refetch helper; and the setter for the formation list.

**Why it is here.** Same reason as the contacts cluster on the ``desktop.renderer.src.hooks.useContactCrud`` page: the shared state lives in the parent and only the change-callbacks live here. The manifest records which formations belong to the saved project; the session-import set marks formations that were created this session but not yet saved.

.. CG-EXPLANATION-END id=interface:UseFormationCrudParams

``interface UseFormationCrudResult``
------------------------------------

.. CG-BLOCK id=interface:UseFormationCrudResult lines=40-61

.. literalinclude:: ../../../desktop/src/renderer/src/hooks/useFormationCrud.ts
   :language: typescript
   :lines: 40-61
   :lineno-match:

.. CG-EXPLANATION-START id=interface:UseFormationCrudResult

**What this does.** Lists the four handlers returned: formation-created, formation-updated, formation-deleted, and an inline-create that both calls the engine and returns the new id.

**Why it is here.** Naming the return shape gives the parent one object of formation actions; the inline-create returns a Promise because it is an asynchronous call to the engine, while the other three just adjust local bookkeeping after a change made elsewhere.

.. CG-EXPLANATION-END id=interface:UseFormationCrudResult

``function useFormationCrud``
-----------------------------

.. CG-BLOCK id=function:useFormationCrud lines=62-123

.. literalinclude:: ../../../desktop/src/renderer/src/hooks/useFormationCrud.ts
   :language: typescript
   :lines: 62-123
   :lineno-match:

.. CG-EXPLANATION-START id=function:useFormationCrud

**What this does.** The hook itself. ``handleFormationCreated`` records the new id in the manifest and the dirty set and refetches; ``handleFormationUpdated`` only refetches, so a rename or recolour lands in the picker and section overlay; ``handleFormationDeleted`` removes the id from both the manifest and the dirty set and refetches; and ``handleInlineCreateFormation`` sends a create to the engine, inserts the result into the on-screen list, runs the created bookkeeping, and returns the new id (or null on failure). It returns the four handlers.

**Why it is here.** The create goes through the API, the same rule as every other write (CLAUDE.md). The delete-path comment records a specific correctness point: deleting a formation that was created but not yet saved must also drop it from the dirty set, or the project would report unsaved changes forever over a row that no longer exists. An update changes no manifest or dirty state because the formation is already tracked — only the cached list needs to resync.

.. CG-EXPLANATION-END id=function:useFormationCrud

