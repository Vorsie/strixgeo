desktop.renderer.src.api.networkHealth
======================================

.. CG-PAGE source=desktop/src/renderer/src/api/networkHealth.ts complete=true

*Source file:* ``desktop/src/renderer/src/api/networkHealth.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-28

.. literalinclude:: ../../../desktop/src/renderer/src/api/networkHealth.ts
   :language: typescript
   :lines: 1-28
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The opening comment for the module that keeps track of whether the Python engine is still answering. It explains the problem it fixes — before it existed, when the engine died the shell kept running and looking healthy, each action caught its own failure and showed at most a small toast, and the engineer went on working into a void (on 2026-08-02 a whole accept loop finished having saved nothing). It then lists three things this module deliberately does NOT do: it does not poll on a timer, it does not treat an HTTP error as unreachability, and it does not retry or replay anything.

**Why it is here.** This module is a *store* — a small shared holder of state that other parts of the app can watch. It exists so the app can show one honest "backend unreachable" banner instead of a scatter of per-action toasts. The three non-behaviours are the design: the reachability signal comes free from the requests the app already makes, so a second health-check timer would only add another thing to debug; an HTTP error means the engine answered and so is alive; and recovering a half-written session needs the engine's own transactional safety, not a guess in the window — the honest answer is to tell the engineer to restart.

.. CG-EXPLANATION-END id=module-header

``const CONSECUTIVE_NETWORK_FAILURES_BEFORE_UNREACHABLE``
---------------------------------------------------------

.. CG-BLOCK id=const:CONSECUTIVE_NETWORK_FAILURES_BEFORE_UNREACHABLE lines=29-31

.. literalinclude:: ../../../desktop/src/renderer/src/api/networkHealth.ts
   :language: typescript
   :lines: 29-31
   :lineno-match:

.. CG-EXPLANATION-START id=const:CONSECUTIVE_NETWORK_FAILURES_BEFORE_UNREACHABLE

**What this does.** Sets the threshold to three: three network failures in a row are needed before the engine is declared gone.

**Why it is here.** The comment explains the choice — a single dropped connection while the engine restarts is normal and heals itself on the next call, so one failure is noise; three in a row is a real state worth telling the engineer about.

.. CG-EXPLANATION-END id=const:CONSECUTIVE_NETWORK_FAILURES_BEFORE_UNREACHABLE

``let consecutiveFailures``
---------------------------

.. CG-BLOCK id=let:consecutiveFailures lines=32-34

.. literalinclude:: ../../../desktop/src/renderer/src/api/networkHealth.ts
   :language: typescript
   :lines: 32-34
   :lineno-match:

.. CG-EXPLANATION-START id=let:consecutiveFailures

**What this does.** A running count of network failures since the last time a request got through.

**Why it is here.** It is the tally the threshold is compared against; a success resets it to zero.

.. CG-EXPLANATION-END id=let:consecutiveFailures

``let unreachable``
-------------------

.. CG-BLOCK id=let:unreachable lines=35-37

.. literalinclude:: ../../../desktop/src/renderer/src/api/networkHealth.ts
   :language: typescript
   :lines: 35-37
   :lineno-match:

.. CG-EXPLANATION-START id=let:unreachable

**What this does.** Remembers the current verdict — whether the engine is currently believed unreachable.

**Why it is here.** Holding the last-told verdict lets the module notify its watchers only when the verdict actually flips, not on every failed request.

.. CG-EXPLANATION-END id=let:unreachable

``const listeners``
-------------------

.. CG-BLOCK id=const:listeners lines=38-40

.. literalinclude:: ../../../desktop/src/renderer/src/api/networkHealth.ts
   :language: typescript
   :lines: 38-40
   :lineno-match:

.. CG-EXPLANATION-START id=const:listeners

**What this does.** The set of watcher functions currently subscribed to reachability changes.

**Why it is here.** A store keeps its list of watchers so it can tell each of them when its state changes; a set avoids ever holding the same watcher twice.

.. CG-EXPLANATION-END id=const:listeners

``function notify``
-------------------

.. CG-BLOCK id=function:notify lines=41-50

.. literalinclude:: ../../../desktop/src/renderer/src/api/networkHealth.ts
   :language: typescript
   :lines: 41-50
   :lineno-match:

.. CG-EXPLANATION-START id=function:notify

**What this does.** Calls every subscribed watcher function once.

**Why it is here.** This is the *notify* half of a store: when the verdict changes, every watcher is told so the interface can redraw.

.. CG-EXPLANATION-END id=function:notify

``function noteNetworkFailure``
-------------------------------

.. CG-BLOCK id=function:noteNetworkFailure lines=51-64

.. literalinclude:: ../../../desktop/src/renderer/src/api/networkHealth.ts
   :language: typescript
   :lines: 51-64
   :lineno-match:

.. CG-EXPLANATION-START id=function:noteNetworkFailure

**What this does.** Records one network-level failure: it bumps the count, and if the engine was still believed reachable and the count has now reached three, it flips the verdict to unreachable and notifies the watchers.

**Why it is here.** The docstring is emphatic that this must be called only when the transport itself failed — nothing answered — never for a non-success HTTP response, because an HTTP error still proves the engine is alive.

.. CG-EXPLANATION-END id=function:noteNetworkFailure

``function noteNetworkSuccess``
-------------------------------

.. CG-BLOCK id=function:noteNetworkSuccess lines=65-81

.. literalinclude:: ../../../desktop/src/renderer/src/api/networkHealth.ts
   :language: typescript
   :lines: 65-81
   :lineno-match:

.. CG-EXPLANATION-START id=function:noteNetworkSuccess

**What this does.** Records that a request reached the engine and got an answer: it resets the failure count to zero, and if the engine had been marked unreachable it flips the verdict back and notifies the watchers.

**Why it is here.** The docstring notes that any answer counts, including an HTTP error, because the thing being measured is whether something is listening, not whether it liked the request.

.. CG-EXPLANATION-END id=function:noteNetworkSuccess

``function isBackendUnreachable``
---------------------------------

.. CG-BLOCK id=function:isBackendUnreachable lines=82-102

.. literalinclude:: ../../../desktop/src/renderer/src/api/networkHealth.ts
   :language: typescript
   :lines: 82-102
   :lineno-match:

.. CG-EXPLANATION-START id=function:isBackendUnreachable

**What this does.** Returns the current verdict — true once the three-in-a-row threshold has been crossed and nothing has succeeded since.

**Why it is here.** It is the plain read other code uses to ask the store its current state without subscribing to changes.

.. CG-EXPLANATION-END id=function:isBackendUnreachable

``function subscribeBackendReachability``
-----------------------------------------

.. CG-BLOCK id=function:subscribeBackendReachability lines=103-115

.. literalinclude:: ../../../desktop/src/renderer/src/api/networkHealth.ts
   :language: typescript
   :lines: 103-115
   :lineno-match:

.. CG-EXPLANATION-START id=function:subscribeBackendReachability

**What this does.** Adds a watcher to the set and hands back a function that removes it again.

**Why it is here.** The docstring says it is shaped for React's ``useSyncExternalStore`` — React's built-in way to redraw a component when an outside store changes. The watcher takes no arguments and fires only on a real change of verdict, so a storm of failed requests against a dead engine redraws the interface once, not once per failed request.

.. CG-EXPLANATION-END id=function:subscribeBackendReachability

``function resetNetworkHealth``
-------------------------------

.. CG-BLOCK id=function:resetNetworkHealth lines=116-120

.. literalinclude:: ../../../desktop/src/renderer/src/api/networkHealth.ts
   :language: typescript
   :lines: 116-120
   :lineno-match:

.. CG-EXPLANATION-START id=function:resetNetworkHealth

**What this does.** Clears the count, the verdict and every watcher back to the starting state.

**Why it is here.** The docstring marks it a test-only seam: the store's state is shared across the whole process, so a test that armed the unreachable condition would otherwise leak it into the next test running in the same worker.

.. CG-EXPLANATION-END id=function:resetNetworkHealth

