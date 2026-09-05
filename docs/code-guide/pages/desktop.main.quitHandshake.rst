desktop.main.quitHandshake
==========================

.. CG-PAGE source=desktop/src/main/quitHandshake.ts complete=true

*Source file:* ``desktop/src/main/quitHandshake.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-31

.. literalinclude:: ../../../desktop/src/main/quitHandshake.ts
   :language: typescript
   :lines: 1-31
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The docstring explains this file holds the decision-making half of what happens when the user closes the window — the 'quit handshake'. Closing is not the main process's call to make alone: the renderer (the web page the user sees) owns the project's unsaved-changes state and runs the save-or-discard prompt. So the main process intercepts the close, asks the page 'is it safe to quit?' over IPC (the message channel between the two programs), and waits for the answer. The note also records the bug that made this its own module and the two escape hatches it adds.

**Why it is here.** A quit handshake is the main process asking the renderer whether it is safe to quit before actually closing. The real bug it fixes: the page's 'may I quit?' answerer lives inside a small piece of the ``App`` component's setup code; when the crash-recovery ErrorBoundary swaps ``App`` out, that answerer vanishes — the question is asked, nobody replies, and every later close is blocked forever, exactly on the screen built for crash recovery. Splitting the logic out (free of Electron) makes these tricky cases unit-testable, and adds two escapes: offer a native 'close anyway' when a second close arrives unanswered, and let a dead page's window close on the first try.

.. CG-EXPLANATION-END id=module-header

``interface CloseDecision``
---------------------------

.. CG-BLOCK id=interface:CloseDecision lines=32-49

.. literalinclude:: ../../../desktop/src/main/quitHandshake.ts
   :language: typescript
   :lines: 32-49
   :lineno-match:

.. CG-EXPLANATION-START id=interface:CloseDecision

**What this does.** Describes what the close handler should do with a close request: an ``action`` that is one of ``close`` (let it proceed), ``ask-renderer`` (stop, and ask the page to confirm), or ``confirm-force-close`` (stop, and offer the native way out), plus a plain-language ``reason`` to log alongside it.

**Why it is here.** Bundling the verdict and its reason in one shape gives the close handler a single thing to act on, and leaves a readable trail in the log of why each close was allowed, deferred, or escalated.

.. CG-EXPLANATION-END id=interface:CloseDecision

``class QuitHandshake``
-----------------------

.. CG-BLOCK id=class:QuitHandshake lines=50-141

.. literalinclude:: ../../../desktop/src/main/quitHandshake.ts
   :language: typescript
   :lines: 50-141
   :lineno-match:

.. CG-EXPLANATION-START id=class:QuitHandshake

**What this does.** A small state-tracker, one per window, that remembers three things — whether a close is already approved, whether one is waiting on the page's answer, and whether the page's process has died — and turns them into the close decision. ``requestClose`` reads that state to decide; the other methods record events: the page's yes/no answer, the page dying, a fresh page finishing load, and the user's choice on the native 'close anyway' box. Every method is synchronous and free of side effects — the caller does the actual messaging, dialog and closing.

**Why it is here.** This is where the handshake's careful edge cases live. It offers a second-attempt force-close only after the user asks, never on a timer, because the page's own save prompt can legitimately sit open for minutes while the engineer decides. A dead page closes immediately, since it can neither answer nor be holding unsaved work. Crucially, 'gone' is a state a window can leave: if a crashed page reloads it holds the project again and must be asked before closing — but an already-confirmed quit stays confirmed, so the programmatic close that follows a decision does not restart the whole handshake.

.. CG-EXPLANATION-END id=class:QuitHandshake

