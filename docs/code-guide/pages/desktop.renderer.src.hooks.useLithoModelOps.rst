desktop.renderer.src.hooks.useLithoModelOps
===========================================

.. CG-PAGE source=desktop/src/renderer/src/hooks/useLithoModelOps.ts complete=true

*Source file:* ``desktop/src/renderer/src/hooks/useLithoModelOps.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-29

.. literalinclude:: ../../../desktop/src/renderer/src/hooks/useLithoModelOps.ts
   :language: typescript
   :lines: 1-29
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The file's opening documentation and its imports: ``useCallback`` and three TypeScript ref/setter types from React, the API client, two response types, the ghost type, the logger, and the translation helper.

**Why it is here.** The same extraction pattern as the ``desktop.renderer.src.hooks.useContactCrud`` page: this is the whole-model operations cluster for the lithostratigraphic model — rebuild surfaces, clear the model, create, activate, delete — pulled out of the oversized ``useGeologicalModel`` hook (debt #201) so the parent stays a thin owner of shared state. The docstring records a dependency-array convention specific to this cluster: the state setters are stable and left out of the lists, but ``toast`` IS listed here (carried verbatim from the original handlers), and the model refs are stable and never listed.

.. CG-EXPLANATION-END id=module-header

``interface UseLithoModelOpsParams``
------------------------------------

.. CG-BLOCK id=interface:UseLithoModelOpsParams lines=30-68

.. literalinclude:: ../../../desktop/src/renderer/src/hooks/useLithoModelOps.ts
   :language: typescript
   :lines: 30-68
   :lineno-match:

.. CG-EXPLANATION-START id=interface:UseLithoModelOpsParams

**What this does.** Describes the inputs: the open project; two stable refs to the active litho and geological models; four refetch helpers (models, litho contacts, formations, litho surfaces); two setters for dismissing the ghost overlay and the focused anchor; a mark-changed helper; and the toast function.

**Why it is here.** The docstrings record why the models come in as refs: a handler can read the latest model value at call time without listing it as a trigger, which keeps the handler's identity stable. The ghost overlay is ephemeral on-screen state, separate from the saved model, so clearing the model must also reset it here — the engine's clear endpoint never touches it.

.. CG-EXPLANATION-END id=interface:UseLithoModelOpsParams

``interface UseLithoModelOpsResult``
------------------------------------

.. CG-BLOCK id=interface:UseLithoModelOpsResult lines=69-90

.. literalinclude:: ../../../desktop/src/renderer/src/hooks/useLithoModelOps.ts
   :language: typescript
   :lines: 69-90
   :lineno-match:

.. CG-EXPLANATION-START id=interface:UseLithoModelOpsResult

**What this does.** Lists the five operations returned: rebuild litho surfaces, clear the litho model, create a litho model, activate one, and delete one.

**Why it is here.** Naming the return shape gives the inspector one object of model-level actions; each returns a Promise because every one is an asynchronous call to the engine — the frontend always goes through the API (CLAUDE.md).

.. CG-EXPLANATION-END id=interface:UseLithoModelOpsResult

``function useLithoModelOps``
-----------------------------

.. CG-BLOCK id=function:useLithoModelOps lines=91-296

.. literalinclude:: ../../../desktop/src/renderer/src/hooks/useLithoModelOps.ts
   :language: typescript
   :lines: 91-296
   :lineno-match:

.. CG-EXPLANATION-START id=function:useLithoModelOps

**What this does.** The hook itself. Each of the five handlers reads the current model from its ref, calls the matching engine endpoint, refetches whatever the change affected (surfaces after a rebuild; contacts, formations and surfaces after a clear; the model list after create/activate/delete), marks the project changed when rows were actually removed, logs the outcome, and reports failures as a translated toast. ``handleClearLithoModel`` additionally dismisses the suggestion ghosts and clears the focused anchor. ``handleCreateLithoModel`` refuses with a toast and returns null when there is no geological backbone to hang the model under. It returns the five handlers.

**Why it is here.** Clearing the litho model is irreversible — it removes contacts, correlation edges, surfaces and orphan formations in one atomic call — so the docstring records that the caller must present a confirmation dialog first (docs/ux.md, reversible-vs-irreversible; the confirm gating lives on the ``desktop.renderer.src.hooks.useDedupeContactsConfirm`` page pattern). Create surfaces the engine's parent-invariant refusal as a toast and a null return rather than throwing into the UI, because a litho model must have a geological parent (the engine answers 422 otherwise). Rebuild works for any model kind, so no engine change was needed, and it refetches the surfaces so the stale-count badge updates at once. Rows removed by a clear or delete call ``markMutated`` so a close-without-save reverts them.

.. CG-EXPLANATION-END id=function:useLithoModelOps

