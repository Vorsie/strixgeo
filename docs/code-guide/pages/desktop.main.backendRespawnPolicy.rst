desktop.main.backendRespawnPolicy
=================================

.. CG-PAGE source=desktop/src/main/backendRespawnPolicy.ts complete=true

*Source file:* ``desktop/src/main/backendRespawnPolicy.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-22

.. literalinclude:: ../../../desktop/src/main/backendRespawnPolicy.ts
   :language: typescript
   :lines: 1-22
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** This is the file's *docstring* — a comment explaining the file for the reader. It decides one thing: when the Python backend dies part-way through a session, should the app start it again (*respawn* it) or give up? The rule it lands on is respawn once, but if the fresh copy dies again in quick succession, stop. The file is pure and free of Electron — it only makes the decision; the code that calls it keeps the timestamps and does the actual restarting.

**Why it is here.** Before this existed, a backend that died after the app was already running was simply ignored: the window stayed open talking to a dead service with no retry. Respawning once recovers the common, harmless case — a one-off crash, or a worker the operating system killed to reclaim memory. But respawning forever into a backend that dies the instant it starts is a *crash loop*, and looping on it endlessly is worse than stopping and showing the honest could-not-start banner. This file draws exactly that line.

.. CG-EXPLANATION-END id=module-header

``const BACKEND_RESPAWN_GUARD_MS``
----------------------------------

.. CG-BLOCK id=const:BACKEND_RESPAWN_GUARD_MS lines=23-25

.. literalinclude:: ../../../desktop/src/main/backendRespawnPolicy.ts
   :language: typescript
   :lines: 23-25
   :lineno-match:

.. CG-EXPLANATION-START id=const:BACKEND_RESPAWN_GUARD_MS

**What this does.** Sets the window in which a fresh death still counts as the SAME crash loop — 60,000 milliseconds, one minute.

**Why it is here.** One minute is long enough that a backend which came up, served for a while, and only then died is treated as a new, separate fault worth one more restart — yet short enough that a backend which dies almost immediately after being restarted is recognised as looping and stopped.

.. CG-EXPLANATION-END id=const:BACKEND_RESPAWN_GUARD_MS

``type BackendExitAction``
--------------------------

.. CG-BLOCK id=type:BackendExitAction lines=26-28

.. literalinclude:: ../../../desktop/src/main/backendRespawnPolicy.ts
   :language: typescript
   :lines: 26-28
   :lineno-match:

.. CG-EXPLANATION-START id=type:BackendExitAction

**What this does.** Names the two things the policy can decide about a backend that has died: ``respawn`` (start it again) or ``give-up`` (stop and surface the failure). A *type* here restricts a value to exactly one of these words.

**Why it is here.** Naming the two outcomes as fixed words makes the calling code read plainly and lets the compiler catch a mistyped decision before the app runs.

.. CG-EXPLANATION-END id=type:BackendExitAction

``type ExitAfterReadyAction``
-----------------------------

.. CG-BLOCK id=type:ExitAfterReadyAction lines=29-31

.. literalinclude:: ../../../desktop/src/main/backendRespawnPolicy.ts
   :language: typescript
   :lines: 29-31
   :lineno-match:

.. CG-EXPLANATION-START id=type:ExitAfterReadyAction

**What this does.** The two actions above plus a third, ``ignore`` — meaning the backend's own copy exited but the port is still being served by someone, so nothing needs doing.

**Why it is here.** A backend can exit without anything being actually wrong (see the next function), so the decision for a death that happens after readiness needs this extra leave-it-alone outcome that the plain respawn decision does not.

.. CG-EXPLANATION-END id=type:ExitAfterReadyAction

``type PortVerdict``
--------------------

.. CG-BLOCK id=type:PortVerdict lines=32-52

.. literalinclude:: ../../../desktop/src/main/backendRespawnPolicy.ts
   :language: typescript
   :lines: 32-52
   :lineno-match:

.. CG-EXPLANATION-START id=type:PortVerdict

**What this does.** Names the three results of probing the API port right after an exit: ``reachable`` (a backend still answers successfully), ``foreign`` (something answers but was refused as not ours), and ``unreachable`` (nothing usable answers). These are the same verdicts the probe file produces.

**Why it is here.** The decision below turns on what the port looks like immediately after the exit, so it needs this small shared vocabulary to reason about — reusing the probe's own three words keeps the two files speaking the same language.

.. CG-EXPLANATION-END id=type:PortVerdict

``function decideBackendRespawn``
---------------------------------

.. CG-BLOCK id=function:decideBackendRespawn lines=53-94

.. literalinclude:: ../../../desktop/src/main/backendRespawnPolicy.ts
   :language: typescript
   :lines: 53-94
   :lineno-match:

.. CG-EXPLANATION-START id=function:decideBackendRespawn

**What this does.** The core decision. Given when the backend was last restarted, the current time, and the crash-loop window, it answers ``give-up`` if the death fell inside the window after the last restart, and ``respawn`` otherwise — which covers both the very first death and any death that happened comfortably after the previous restart.

**Why it is here.** This is the respawn-once-but-not-into-a-loop rule written as one small, pure calculation. Keeping it separate from the timestamp-keeping and the actual restarting means the exact policy can be tested with made-up times, with no real backend involved.

.. CG-EXPLANATION-END id=function:decideBackendRespawn

``function decideExitAfterReady``
---------------------------------

.. CG-BLOCK id=function:decideExitAfterReady lines=95-103

.. literalinclude:: ../../../desktop/src/main/backendRespawnPolicy.ts
   :language: typescript
   :lines: 95-103
   :lineno-match:

.. CG-EXPLANATION-START id=function:decideExitAfterReady

**What this does.** Decides what a backend exit that happened after the app already marked the backend ready should mean, given a fresh probe of the port. If the port is still ``reachable`` it returns ``ignore``; otherwise it defers to the respawn decision above.

**Why it is here.** Readiness is judged by probing the port, not by watching our own child — so when an EXTERNAL backend owns the port (the developer's own server, or the test harness), our child loses the race for the port and exits even though the API is perfectly alive. That exit is not a crash. Respawning would only spawn another loser, and the crash-loop guard would then wrongly give up and show the fatal error box while every request was still succeeding — which is exactly how one test sweep lost forty interface tests. The ``reachable`` short-circuit prevents that.

.. CG-EXPLANATION-END id=function:decideExitAfterReady

