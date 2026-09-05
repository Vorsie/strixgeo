desktop.renderer.src.shell.useShellState
========================================

.. CG-PAGE source=desktop/src/renderer/src/shell/useShellState.ts complete=true

*Source file:* ``desktop/src/renderer/src/shell/useShellState.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-19

.. literalinclude:: ../../../desktop/src/renderer/src/shell/useShellState.ts
   :language: typescript
   :lines: 1-19
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** This file owns the shell's own interface preferences — which stage is active and whether the inspector is open. The comments explain that both are remembered in *localStorage*: a small store the app keeps on this one computer, holding per-user interface preferences (never project data). The imports bring in two React state hooks, the stage-id type, the stage order, and the logger.

**Why it is here.** The comments record the rule these two values follow: they are per-user preferences, not project decisions — different engineers opening the same project file may reasonably want to start on different stages — so they are kept on the computer and, deliberately, do NOT travel inside the saved project bundle. The inspector defaults to open so the panel is always-on unless the user hides it.

.. CG-EXPLANATION-END id=module-header

``const STAGE_KEY``
-------------------

.. CG-BLOCK id=const:STAGE_KEY lines=20-20

.. literalinclude:: ../../../desktop/src/renderer/src/shell/useShellState.ts
   :language: typescript
   :lines: 20-20
   :lineno-match:

.. CG-EXPLANATION-START id=const:STAGE_KEY

**What this does.** The name under which the active stage is stored in localStorage: ``groundmodel.shell.stage``.

**Why it is here.** Naming the storage slot once means the code that reads it and the code that writes it can never drift onto different names. The name follows the app's convention of ``groundmodel.<area>.<thing>`` for a stored preference.

.. CG-EXPLANATION-END id=const:STAGE_KEY

``const INSPECTOR_KEY``
-----------------------

.. CG-BLOCK id=const:INSPECTOR_KEY lines=21-23

.. literalinclude:: ../../../desktop/src/renderer/src/shell/useShellState.ts
   :language: typescript
   :lines: 21-23
   :lineno-match:

.. CG-EXPLANATION-START id=const:INSPECTOR_KEY

**What this does.** The name under which the inspector open/closed flag is stored: ``groundmodel.shell.inspector_open``.

**Why it is here.** Same single-source-of-truth reason as the stage key — one name, used by both the read and the write, so they cannot fall out of step.

.. CG-EXPLANATION-END id=const:INSPECTOR_KEY

``const DEFAULT_STAGE``
-----------------------

.. CG-BLOCK id=const:DEFAULT_STAGE lines=24-25

.. literalinclude:: ../../../desktop/src/renderer/src/shell/useShellState.ts
   :language: typescript
   :lines: 24-25
   :lineno-match:

.. CG-EXPLANATION-START id=const:DEFAULT_STAGE

**What this does.** The stage to fall back to when nothing is stored: the first stage in the workflow order, which is Data.

**Why it is here.** Taking the default from the front of the shared order list, rather than writing ``'data'`` here directly, means the default follows the workflow order automatically if that order is ever changed.

.. CG-EXPLANATION-END id=const:DEFAULT_STAGE

``function readStoredStage``
----------------------------

.. CG-BLOCK id=function:readStoredStage lines=26-37

.. literalinclude:: ../../../desktop/src/renderer/src/shell/useShellState.ts
   :language: typescript
   :lines: 26-37
   :lineno-match:

.. CG-EXPLANATION-START id=function:readStoredStage

**What this does.** Reads the saved active stage back from localStorage. If a value is there and it is one of the real stage names, it is returned; otherwise the default (Data) is used. The whole read is wrapped so that if localStorage cannot be reached at all, it quietly falls back to the default.

**Why it is here.** The comment records the guarded read: localStorage can be unavailable (a private-browsing mode, a full quota) and a stored value could be stale or hand-edited to a stage that no longer exists. Checking the value against the real stage list and swallowing any failure means a bad or missing preference can never crash the app or land it on a stage that does not exist — it just starts on Data.

.. CG-EXPLANATION-END id=function:readStoredStage

``function readStoredInspectorOpen``
------------------------------------

.. CG-BLOCK id=function:readStoredInspectorOpen lines=38-47

.. literalinclude:: ../../../desktop/src/renderer/src/shell/useShellState.ts
   :language: typescript
   :lines: 38-47
   :lineno-match:

.. CG-EXPLANATION-START id=function:readStoredInspectorOpen

**What this does.** Reads the saved inspector open/closed flag. If something is stored, the inspector is treated as open unless the stored text is exactly ``false``; if nothing is stored, or localStorage cannot be reached, it defaults to open.

**Why it is here.** Same defensive, parse-guarded read as the stage above, and the default is open on purpose — the inspector is an always-on workspace panel, so a first-time user or an unreadable preference should still see it.

.. CG-EXPLANATION-END id=function:readStoredInspectorOpen

``interface UseShellStateResult``
---------------------------------

.. CG-BLOCK id=interface:UseShellStateResult lines=48-75

.. literalinclude:: ../../../desktop/src/renderer/src/shell/useShellState.ts
   :language: typescript
   :lines: 48-75
   :lineno-match:

.. CG-EXPLANATION-START id=interface:UseShellStateResult

**What this does.** Describes what this hook hands back: the active stage id, the inspector open flag, and three functions — one to switch stage, one to toggle the inspector, and one to open or close it outright — each of which also saves the new value.

**Why it is here.** Bundling the two remembered values with the functions that change them gives the shell one tidy thing to read and one obvious set of actions to call, and documents that every setter also writes the preference to disk, not just to memory.

.. CG-EXPLANATION-END id=interface:UseShellStateResult

``function useShellState``
--------------------------

.. CG-BLOCK id=function:useShellState lines=76-116

.. literalinclude:: ../../../desktop/src/renderer/src/shell/useShellState.ts
   :language: typescript
   :lines: 76-116
   :lineno-match:

.. CG-EXPLANATION-START id=function:useShellState

**What this does.** The hook itself. It sets up two pieces of *state* (the remembered values that trigger a redraw when changed) — the active stage and the inspector flag — each seeded from its stored value. It then defines three *callbacks* (remembered functions kept stable across redraws): switching stage, toggling the inspector, and setting it open or closed. Each one logs the change, tries to save it to localStorage, and updates the in-memory value.

**Why it is here.** The comment on the stage-switch log records why it is logged at the ``info`` level rather than ``debug``: it stays visible in shipped builds so that "the user was on stage X" frames every log line that follows during a dogfeed session. Every write to localStorage is wrapped so that a storage failure is ignored — the in-memory value still updates, so the app keeps working even when the preference cannot be saved.

.. CG-EXPLANATION-END id=function:useShellState

