desktop.renderer.src.utils.closeFlowNote
========================================

.. CG-PAGE source=desktop/src/renderer/src/utils/closeFlowNote.ts complete=true

*Source file:* ``desktop/src/renderer/src/utils/closeFlowNote.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-24

.. literalinclude:: ../../../desktop/src/renderer/src/utils/closeFlowNote.ts
   :language: typescript
   :lines: 1-24
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** A long comment explaining a small logging helper that writes one close-flow line to both consoles, and the import of the logger. The close flow is the sequence: close requested, is the project dirty, which dialog, which button, quit or not.

**Why it is here.** The comment records why the line must reach the main process too: the close flow never touches the API, so a report like "it discarded my work without asking" has no server log and no repro; the renderer's own info lines are the only witness, and in a packaged build the developer tools are disabled (debt #200) and the renderer console is forwarded nowhere, while dogfeed reports arrive as pasted terminal output that shows only the main process. It also records the deliberate limit: this is not a general renderer-to-main log bridge, because that would flood the output and every string would be one more untrusted renderer value to bound — it carries the close flow's few decision points and nothing else.

.. CG-EXPLANATION-END id=module-header

``let bridgeWarned``
--------------------

.. CG-BLOCK id=let:bridgeWarned lines=25-33

.. literalinclude:: ../../../desktop/src/renderer/src/utils/closeFlowNote.ts
   :language: typescript
   :lines: 25-33
   :lineno-match:

.. CG-EXPLANATION-START id=let:bridgeWarned

**What this does.** A single remembered flag recording whether the "the bridge is unavailable" warning has already been printed.

**Why it is here.** The comment on its use records the reason: if the bridge is missing it is missing for every line, so warning once instead of on every decision point keeps the warning from burying the very notes it is about.

.. CG-EXPLANATION-END id=let:bridgeWarned

``function noteCloseFlow``
--------------------------

.. CG-BLOCK id=function:noteCloseFlow lines=34-55

.. literalinclude:: ../../../desktop/src/renderer/src/utils/closeFlowNote.ts
   :language: typescript
   :lines: 34-55
   :lineno-match:

.. CG-EXPLANATION-START id=function:noteCloseFlow

**What this does.** Records one close-flow decision point: it logs the message to the renderer console, then tries to forward it to the main process over a dedicated channel — quietly doing nothing if the channel is absent, ignoring a rejection, and printing the one-time warning if forwarding is impossible.

**Why it is here.** The comments record that the forward is fire-and-forget because a close decision must never wait on or fail because of its own diagnostics, and the renderer line already landed; the channel is deliberately reached through an optional call because it is absent in unit tests and older builds; and a rejection during forwarding is treated as the normal end of a quit, not a problem.

.. CG-EXPLANATION-END id=function:noteCloseFlow

