desktop.renderer.src.hooks.useProjectLifecycle
==============================================

.. CG-PAGE source=desktop/src/renderer/src/hooks/useProjectLifecycle.ts complete=true

*Source file:* ``desktop/src/renderer/src/hooks/useProjectLifecycle.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-33

.. literalinclude:: ../../../desktop/src/renderer/src/hooks/useProjectLifecycle.ts
   :language: typescript
   :lines: 1-33
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The comment and the imports. This hook owns the project lifecycle: computing the dirty flag, wiring the File menu, the close-flow dialogs, Save / Save As / Discard, and the operating-system window title and quit handshake.

**Why it is here.** ``discardSessionImports`` needs the contact-discard action and the active geological model, and both are passed in rather than imported, so the hook does not reach across architectural layers (the one-way dependency rule). The comment on the translation helper notes it reads the active language at call time, which is the right shape for a toast built inside a callback without threading a translator through the callback's dependency list.

.. CG-EXPLANATION-END id=module-header

``interface ActiveModel``
-------------------------

.. CG-BLOCK id=interface:ActiveModel lines=34-37

.. literalinclude:: ../../../desktop/src/renderer/src/hooks/useProjectLifecycle.ts
   :language: typescript
   :lines: 34-37
   :lineno-match:

.. CG-EXPLANATION-START id=interface:ActiveModel

**What this does.** The minimal shape of the active geological model — just its id.

**Why it is here.** The id is all the contact cleanup needs, so the interface deliberately carries nothing more.

.. CG-EXPLANATION-END id=interface:ActiveModel

``interface UseProjectLifecycleResult``
---------------------------------------

.. CG-BLOCK id=interface:UseProjectLifecycleResult lines=38-188

.. literalinclude:: ../../../desktop/src/renderer/src/hooks/useProjectLifecycle.ts
   :language: typescript
   :lines: 38-188
   :lineno-match:

.. CG-EXPLANATION-START id=interface:UseProjectLifecycleResult

**What this does.** The large return shape: the dirty flag, an itemised summary of the unsaved work, the open/close state and setters for the new-project, metadata-editor, close-confirm and unsaved-changes dialogs, plus the handlers for saving, discarding, closing, and the buttons on the unsaved dialog.

**Why it is here.** It names the whole lifecycle surface the App render consumes. The itemised summary exists so the close-without-save dialog can show the engineer exactly what would be lost, rather than a bare ``you have unsaved changes``.

.. CG-EXPLANATION-END id=interface:UseProjectLifecycleResult

``function useProjectLifecycle``
--------------------------------

.. CG-BLOCK id=function:useProjectLifecycle lines=189-822

.. literalinclude:: ../../../desktop/src/renderer/src/hooks/useProjectLifecycle.ts
   :language: typescript
   :lines: 189-822
   :lineno-match:

.. CG-EXPLANATION-START id=function:useProjectLifecycle

**What this does.** The hook. It takes the project, the per-session import id sets and their setters, the manifest / save / close / open actions, the contact-discard action, the active model, the lumping stage, the unsaved-mutation flags, the revert and recovery helpers, the file path, and the toast. It computes the derived dirty flag and the unsaved summary, wires the File menu and the window-title and quit handshake through *effects*, and defines the close flow — the confirm dialog and its Save-and-close, Discard and Cancel branches — honouring each revert outcome.

**Why it is here.** The dirty flag is derived from the metadata-dirty flag plus the session imports plus any unsaved mutations plus the lumping, so it cannot drift out of step with what is actually unsaved. The close flow reads each revert outcome and deletes the session's newly-created rows ONLY on a ``no-snapshot`` result — the audit-driven rule carried over from the project hook — and shows an honest message on a refusal or a failure instead of silently destroying work. Every dependency it needs from another layer is injected, keeping the hook from importing across architectural boundaries.

.. CG-EXPLANATION-END id=function:useProjectLifecycle

