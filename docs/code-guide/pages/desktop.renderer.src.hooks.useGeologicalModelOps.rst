desktop.renderer.src.hooks.useGeologicalModelOps
================================================

.. CG-PAGE source=desktop/src/renderer/src/hooks/useGeologicalModelOps.ts complete=true

*Source file:* ``desktop/src/renderer/src/hooks/useGeologicalModelOps.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-44

.. literalinclude:: ../../../desktop/src/renderer/src/hooks/useGeologicalModelOps.ts
   :language: typescript
   :lines: 1-44
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The doc comment and the imports (``useCallback`` and React setter types, the API client and response types, the lumping type, the undo-command type, the logger, the translation helper, and the shared borehole-exclusion toggle). This is a focused sub-hook of the geological-model composer, covering the model-level operations that are not formation- or contact-editing: auto-populate from stratigraphy, litho seed-from-parent, dedupe, rebuild surfaces, Plaxis 3D export, borehole toggle, and model delete.

**Why it is here.** It was extracted (debt #201, the god-component decomposition) so the composer stays a thin owner of the shared state; that state lives in the composer and is passed in, so this hook owns only the operation callbacks. The dep-array convention is carried over verbatim: the toast and the state setters are left out of the ``useCallback`` dependency lists because they are stable by construction and listing them would only churn the callbacks' identities, while the values that actually vary ARE listed.

.. CG-EXPLANATION-END id=module-header

``interface UseGeologicalModelOpsParams``
-----------------------------------------

.. CG-BLOCK id=interface:UseGeologicalModelOpsParams lines=45-91

.. literalinclude:: ../../../desktop/src/renderer/src/hooks/useGeologicalModelOps.ts
   :language: typescript
   :lines: 45-91
   :lineno-match:

.. CG-EXPLANATION-START id=interface:UseGeologicalModelOpsParams

**What this does.** The inputs: the project, the active geological and litho models, the formation list, the current lumping snapshot, the manifest and session-import helpers, the undo-push and mark-changed actions, the toast, the composer's state setters, and the refetch functions.

**Why it is here.** The shared state is owned by the composer and handed down so this sub-hook does not duplicate it; the doc marks each stable reference as intentionally omitted from the dependency arrays, so the reasoning is visible at each field.

.. CG-EXPLANATION-END id=interface:UseGeologicalModelOpsParams

``interface UseGeologicalModelOpsResult``
-----------------------------------------

.. CG-BLOCK id=interface:UseGeologicalModelOpsResult lines=92-122

.. literalinclude:: ../../../desktop/src/renderer/src/hooks/useGeologicalModelOps.ts
   :language: typescript
   :lines: 92-122
   :lineno-match:

.. CG-EXPLANATION-START id=interface:UseGeologicalModelOpsResult

**What this does.** The seven handlers it returns: auto-populate from stratigraphy, dedupe contacts, rebuild surfaces, export the model to Plaxis 3D, toggle a borehole in the geological model, toggle a borehole in the litho model, and delete the model.

**Why it is here.** It names the operation surface. The litho toggle mirrors the geological one but confirms with a toast (the geology checkbox toggles silently), and both reuse the shared borehole-exclusion helper so they flip the exclusion list the same way.

.. CG-EXPLANATION-END id=interface:UseGeologicalModelOpsResult

``function useGeologicalModelOps``
----------------------------------

.. CG-BLOCK id=function:useGeologicalModelOps lines=123-634

.. literalinclude:: ../../../desktop/src/renderer/src/hooks/useGeologicalModelOps.ts
   :language: typescript
   :lines: 123-634
   :lineno-match:

.. CG-EXPLANATION-START id=function:useGeologicalModelOps

**What this does.** The hook. It builds the seven callbacks over the injected state and setters; each one makes its API call, updates the composer's state, records an undo command where the action is reversible, and shows a toast.

**Why it is here.** It composes into the geological-model hook to keep that composer thin (debt #201). The borehole toggles delegate to the shared exclusion helper so the geological and litho models flip their exclusion lists identically, and every write goes through the API client (the window always reaches the engine through the API). The Plaxis 3D export produces a machine-readable design-tool artefact, part of the export suite.

.. CG-EXPLANATION-END id=function:useGeologicalModelOps

