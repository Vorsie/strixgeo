desktop.renderer.src.hooks.useDedupeContactsConfirm
===================================================

.. CG-PAGE source=desktop/src/renderer/src/hooks/useDedupeContactsConfirm.ts complete=true

*Source file:* ``desktop/src/renderer/src/hooks/useDedupeContactsConfirm.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-17

.. literalinclude:: ../../../desktop/src/renderer/src/hooks/useDedupeContactsConfirm.ts
   :language: typescript
   :lines: 1-17
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The file's opening comment and its two imports, ``useCallback`` and ``useState`` from React.

**Why it is here.** This hook is the confirm-then-run logic behind the Dedupe button, which removes duplicate formation contacts. The comment records why it exists: Dedupe is offered in two places that had the same in-flight state, and once a confirmation dialog sits in front of the cleanup both need the same four pieces of state — so it was extracted before a third caller could grow a copy that forgets the gate. The gate is the whole point: the cleanup deletes contacts and nothing restores them, so it must not be reachable from a single click — the reversible-vs-irreversible rule (docs/ux.md).

.. CG-EXPLANATION-END id=module-header

``interface DedupeContactsConfirmController``
---------------------------------------------

.. CG-BLOCK id=interface:DedupeContactsConfirmController lines=18-47

.. literalinclude:: ../../../desktop/src/renderer/src/hooks/useDedupeContactsConfirm.ts
   :language: typescript
   :lines: 18-47
   :lineno-match:

.. CG-EXPLANATION-START id=interface:DedupeContactsConfirmController

**What this does.** Describes the wiring for a Dedupe button and its confirmation dialog: ``confirmOpen`` (should the dialog show), ``deduping`` (is the cleanup running, which disables the button and dialog), and three handlers — ``requestDedupe`` (the button, which only opens the dialog and deletes nothing), ``cancelDedupe`` (dismiss without running), and ``confirmDedupe`` (actually run, then close).

**Why it is here.** Separating the button's click (which just opens the dialog) from the confirm (which does the deletion) is exactly the irreversible-action pattern: a destructive cleanup needs a confirmation step, never a single click (docs/ux.md).

.. CG-EXPLANATION-END id=interface:DedupeContactsConfirmController

``function useDedupeContactsConfirm``
-------------------------------------

.. CG-BLOCK id=function:useDedupeContactsConfirm lines=48-81

.. literalinclude:: ../../../desktop/src/renderer/src/hooks/useDedupeContactsConfirm.ts
   :language: typescript
   :lines: 48-81
   :lineno-match:

.. CG-EXPLANATION-START id=function:useDedupeContactsConfirm

**What this does.** The hook itself. It keeps two flags — dialog-open and running. ``requestDedupe`` opens the dialog, but only when the feature is enabled and nothing is already running. ``cancelDedupe`` closes the dialog, but refuses to close while a run is in flight. ``confirmDedupe`` marks the run started, calls the cleanup once, and clears both flags when it finishes. It returns the two flags and the three handlers.

**Why it is here.** The docstring records the guards. The ``enabled`` input is false when there is no model to clean, so a stale click cannot open a dialog whose confirm would do nothing. Cancel is blocked mid-run because the dialog is the only thing on screen showing that a destructive action is still happening. The cleanup is called exactly once per confirmed run and never before the user confirms — the confirmation is the only protection against an irreversible mistake (docs/ux.md).

.. CG-EXPLANATION-END id=function:useDedupeContactsConfirm

