desktop.main.backendLifecycle
=============================

.. CG-PAGE source=desktop/src/main/backendLifecycle.ts complete=true

*Source file:* ``desktop/src/main/backendLifecycle.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-34

.. literalinclude:: ../../../desktop/src/main/backendLifecycle.ts
   :language: typescript
   :lines: 1-34
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** This is the file's *docstring* — a comment explaining the file for the reader. It states the rule this file exists to enforce: the Python backend and the bundled database are shut down ONLY after the user has answered the save-or-discard prompt that appears when they close the window. Electron (this desktop app's framework) runs two programs: the *main process* (full computer access — this file is part of it) and the *renderer* (the web page the user sees). The renderer owns whether the project has unsaved changes and runs the closing prompt; if the user chooses Save there, that Save must reach a backend that is still alive. The docstring then walks through Electron's shutdown order and explains that the teardown is wired to the two late events that fire only once every window has actually closed — ``window-all-closed`` and ``will-quit`` — and never to the early ``before-quit``.

**Why it is here.** Electron's quit order is a trap. When the app is told to quit, it fires an early about-to-quit signal FIRST, then the window-closing prompts, then — only if the quit was not cancelled — the final teardown signals. So shutting the backend down on that early signal would kill it before the save prompt has even appeared; and if the user then cancels the prompt, the backend would be dead for the rest of the session with no way back. Wiring the teardown to the late events guarantees the backend is still alive while the renderer runs its prompt, which is exactly after the user has answered. The file is kept as pure wiring so the ORDER can be unit-tested with a fake app and a scripted sequence of events, without importing Electron itself.

.. CG-EXPLANATION-END id=module-header

``interface QuitLifecycleApp``
------------------------------

.. CG-BLOCK id=interface:QuitLifecycleApp lines=35-39

.. literalinclude:: ../../../desktop/src/main/backendLifecycle.ts
   :language: typescript
   :lines: 35-39
   :lineno-match:

.. CG-EXPLANATION-START id=interface:QuitLifecycleApp

**What this does.** Describes the small slice of Electron's ``app`` this file actually uses — just the ability to register a handler on the three quit-related events. An *interface* is a written description of the members a value must have; a *handler* is a function handed over to be run later when the event fires.

**Why it is here.** Describing only the sliver it needs, rather than depending on the whole Electron ``app``, is what lets a test pass in a tiny stand-in and fire the events in a chosen order to prove the wiring is correct.

.. CG-EXPLANATION-END id=interface:QuitLifecycleApp

``interface BackendLifecycleWiring``
------------------------------------

.. CG-BLOCK id=interface:BackendLifecycleWiring lines=40-69

.. literalinclude:: ../../../desktop/src/main/backendLifecycle.ts
   :language: typescript
   :lines: 40-69
   :lineno-match:

.. CG-EXPLANATION-START id=interface:BackendLifecycleWiring

**What this does.** Describes the callbacks this file drives — a *callback* being a function you hand to something else to run later. ``stopBackend`` stops the backend child process and the embedded database and must be safe to call more than once; the optional ``onWindowAllClosed`` runs the platform-specific quit after the backend is stopped on the normal close path; and the optional ``onWillQuit`` runs any final teardown, such as cancelling a retry timer that could otherwise keep the app alive.

**Why it is here.** ``stopBackend`` is required to be idempotent — safe to run twice — because a graceful quit fires both late events and so calls it twice. Splitting the two extra callbacks apart lets each late event do only the follow-up work that belongs to it, keeping the shutdown steps in a clear, testable order.

.. CG-EXPLANATION-END id=interface:BackendLifecycleWiring

``function registerBackendLifecycle``
-------------------------------------

.. CG-BLOCK id=function:registerBackendLifecycle lines=70-87

.. literalinclude:: ../../../desktop/src/main/backendLifecycle.ts
   :language: typescript
   :lines: 70-87
   :lineno-match:

.. CG-EXPLANATION-START id=function:registerBackendLifecycle

**What this does.** Attaches the teardown to the quit lifecycle. On ``window-all-closed`` it stops the backend first and then runs the platform quit; on ``will-quit`` it stops the backend and then runs any final teardown. It deliberately registers nothing on the early ``before-quit``.

**Why it is here.** Stopping the backend before the platform quit on the normal path keeps the shutdown free of connection-error noise in the log, since the database client is gone before the server. Leaving ``before-quit`` empty is the crux of the whole file: the renderer's save prompt runs after that early signal and before the window closes, so anything torn down there would be torn down underneath a live, still-unsaved session.

.. CG-EXPLANATION-END id=function:registerBackendLifecycle

