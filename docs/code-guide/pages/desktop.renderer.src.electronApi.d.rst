desktop.renderer.src.electronApi.d
==================================

.. CG-PAGE source=desktop/src/renderer/src/electronApi.d.ts complete=true

*Source file:* ``desktop/src/renderer/src/electronApi.d.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-15

.. literalinclude:: ../../../desktop/src/renderer/src/electronApi.d.ts
   :language: typescript
   :lines: 1-15
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The file's documentation comment and its imports. The comment says this file declares the ``window.electron`` bridge contract shared by every renderer entry point — it was moved out of ``App.tsx`` so the second entry (the PDF-sheet window) sees the same ``Window`` shape without importing the shell; the *preload* script is the real implementation, and this file is the type that implementation must satisfy. The imports pull in the data shapes used further down (the activation status and result types, the updater-event type, and the sheet payload / ready-message types).

**Why it is here.** This is an *ambient declarations file* — a ``.d.ts`` file that contains only type descriptions, no running code; it tells the type-checker the shape of something defined elsewhere. The renderer web page is *sandboxed*: it cannot touch the operating system or the main process directly, and reaches them only across the *preload / contextBridge* boundary, where the preload exposes a small, fixed set of functions as ``window.electron``. This file is the agreed description of that surface — the counterpart, for the main process, to the rule that the frontend always goes through the API for the engine (CLAUDE.md).

.. CG-EXPLANATION-END id=module-header

``interface RecentProject``
---------------------------

.. CG-BLOCK id=interface:RecentProject lines=16-25

.. literalinclude:: ../../../desktop/src/renderer/src/electronApi.d.ts
   :language: typescript
   :lines: 16-25
   :lineno-match:

.. CG-EXPLANATION-START id=interface:RecentProject

**What this does.** The shape of one recent-projects entry: the file ``path``, the display ``name``, and ``lastOpened`` (when it was last opened).

**Why it is here.** A named shape so the main process (which builds and stores the list) and the renderer (which shows it) agree on an entry's fields — the shared-bridge-contract point the module comment above makes for every type in this file.

.. CG-EXPLANATION-END id=interface:RecentProject

``interface FileFilter``
------------------------

.. CG-BLOCK id=interface:FileFilter lines=26-36

.. literalinclude:: ../../../desktop/src/renderer/src/electronApi.d.ts
   :language: typescript
   :lines: 26-36
   :lineno-match:

.. CG-EXPLANATION-START id=interface:FileFilter

**What this does.** The shape of a file-dialog filter — a display ``name`` plus the list of ``extensions`` it matches (for example a ``.strix`` filter).

**Why it is here.** The comment explains it is declared inline, matching Electron's own ``FileFilter``, so the renderer does not have to pull in the entire Electron type namespace just for this one small shape — the renderer never imports the Electron module directly (only the main and preload sides do).

.. CG-EXPLANATION-END id=interface:FileFilter

``interface RecoveryDescriptor``
--------------------------------

.. CG-BLOCK id=interface:RecoveryDescriptor lines=37-194

.. literalinclude:: ../../../desktop/src/renderer/src/electronApi.d.ts
   :language: typescript
   :lines: 37-194
   :lineno-match:

.. CG-EXPLANATION-START id=interface:RecoveryDescriptor

**What this does.** First, the ``RecoveryDescriptor`` shape — what a crash-recovery file advertises about itself without carrying its contents: the project id and name, the file path, when it was written, the app version, its size in bytes, and a ``declined`` flag recording that the user already chose ``Open without restoring`` for this copy (still a live offer). Then this block declares the whole ``window.electron`` bridge — the complete list of functions the sandboxed renderer may call on the main process, grouped by concern: boot (get the API base URL, wait for the API); file dialogs and reads; the project-file lifecycle (open / save dialogs, an existence check, a read result where a damaged or too-new file comes back as ``{ ok: false, reason }``, and a write); a generic export save-dialog plus binary write; the recent-projects list; the crash-recovery calls (write / list / read, plus the carefully separated delete calls — ``deleteRecovery`` destroys both slots, ``deletePrimaryRecovery`` clears only this session's slot, and ``declineRecovery`` / ``deleteDeclinedRecovery`` manage the ``opened without restoring`` state); window title and visibility; the quit handshake; the menu-event subscriptions; backend failed / restarting / ready events; the logs path and renderer error logging; optional diagnostic capture; optional beta-expiry status; the launch-prototype surface (boot flags, onboarding / licensing / updater events and calls, sample-project availability and install); the guided-tutorial menu events; and the PDF-sheet calls.

**Why it is here.** The recovery calls take a project id and never a file path, so this surface can neither read nor write an arbitrary file — a deliberate safety boundary (``docs/design/autosave-recovery.md`` §5). The ``declined`` flag and the split delete calls encode the owner decision that ``Open without restoring`` preserves the copy (2026-08-03) so it keeps being offered. Several functions are marked optional with a ``?`` — ``onAppBackendRestarting``, ``captureDiagnostic``, ``getBetaStatus`` — so a renderer running against an older preload degrades gracefully instead of crashing on a missing function; that is the additive-only discipline applied at the bridge. And the ``getBetaStatus`` comment records that the blocking decision belongs to the main process alone, this being display-only (``docs/design/beta-expiry.md``). The whole thing lives in one declared surface because the renderer is sandboxed and may reach the main process only through this fixed list.

.. CG-EXPLANATION-END id=interface:RecoveryDescriptor

