desktop.main.activationService
==============================

.. CG-PAGE source=desktop/src/main/activationService.ts complete=true

*Source file:* ``desktop/src/main/activationService.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-37

.. literalinclude:: ../../../desktop/src/main/activationService.ts
   :language: typescript
   :lines: 1-37
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Names the file and imports the three pieces it stitches
together: the pure evaluator (the state machine that decides which state a
licence is in), the local store (the offline authority that reads and writes the
licence file on disk), and the issuer seam (the "server"). This is main-process
code, and it is the *orchestrator* — the one thing the app's message layer in
``index.ts`` talks to for anything about licensing.

**Why it is here.** Someone has to coordinate the three steps — ask the server,
save the answer to disk, and work out the resulting state. Putting that
coordination in one file, importing nothing from Electron itself (the folder and
the clock are handed in from outside), keeps the deferred database choice from
leaking in and lets the tests drive the whole flow. The docstring is candid
about the prototype line: the moving parts here are real, but the issuer is an
in-memory stand-in with no network or signature, and this prototype only *shows*
each state rather than actually blocking the app on it.

.. CG-EXPLANATION-END id=module-header

``const DAY_MS``
----------------

.. CG-BLOCK id=const:DAY_MS lines=38-40

.. literalinclude:: ../../../desktop/src/main/activationService.ts
   :language: typescript
   :lines: 38-40
   :lineno-match:

.. CG-EXPLANATION-START id=const:DAY_MS

**What this does.** The number of milliseconds in a day.

**Why it is here.** The preview helper further down expresses its made-up dates
in days ("20 days from now", "40 days ago"); naming the conversion once keeps
those readable.

.. CG-EXPLANATION-END id=const:DAY_MS

``interface ActivationStatus``
------------------------------

.. CG-BLOCK id=interface:ActivationStatus lines=41-52

.. literalinclude:: ../../../desktop/src/main/activationService.ts
   :language: typescript
   :lines: 41-52
   :lineno-match:

.. CG-EXPLANATION-START id=interface:ActivationStatus

**What this does.** The shape the licensing screen renders: the evaluated
verdict, this device's readable name, the active key *masked* down to its last
group, and whether it is a trial.

**Why it is here.** The screen needs one tidy object holding everything it
displays. The key is masked — most of it replaced with dots — so the screen can
show *which* key is active without ever putting the full credential on screen or
into a log.

.. CG-EXPLANATION-END id=interface:ActivationStatus

``type ActivationActionResult``
-------------------------------

.. CG-BLOCK id=type:ActivationActionResult lines=53-57

.. literalinclude:: ../../../desktop/src/main/activationService.ts
   :language: typescript
   :lines: 53-57
   :lineno-match:

.. CG-EXPLANATION-START id=type:ActivationActionResult

**What this does.** The answer to an activate / trial / deactivate action:
either success carrying the new status, or failure carrying a code and message.

**Why it is here.** The screen reacts differently to success and failure, and
two clearly different shapes make it handle both. As with the issuer's own
result, a failure carries a code rather than finished wording, so the screen
owns the message and its translation.

.. CG-EXPLANATION-END id=type:ActivationActionResult

``interface ActivationServiceConfig``
-------------------------------------

.. CG-BLOCK id=interface:ActivationServiceConfig lines=58-69

.. literalinclude:: ../../../desktop/src/main/activationService.ts
   :language: typescript
   :lines: 58-69
   :lineno-match:

.. CG-EXPLANATION-START id=interface:ActivationServiceConfig

**What this does.** Everything the service needs handed to it at start-up: the
issuer to use, this device's display name, and (optionally) where to read the
current time.

**Why it is here.** Passing these in — rather than the class reaching for them
itself — is what keeps the service free of any Electron or database assumption,
and it lets a test pin the clock to a fixed instant so time-based behaviour is
repeatable.

.. CG-EXPLANATION-END id=interface:ActivationServiceConfig

``class ActivationService``
---------------------------

.. CG-BLOCK id=class:ActivationService lines=70-285

.. literalinclude:: ../../../desktop/src/main/activationService.ts
   :language: typescript
   :lines: 70-285
   :lineno-match:

.. CG-EXPLANATION-START id=class:ActivationService

**What this does.** The orchestrator class. It exposes a handful of simple
actions the message layer calls: ``getStatus`` (work out and return the current
state, recording this launch's time as it goes), ``refreshOnLaunch`` (ask the
server once whether a stored licence has been renewed), ``activate`` (turn a key
into a saved licence), ``startTrial`` (get and save a trial licence),
``deactivate`` (release this device and clear the local licence), and a
prototype-only ``previewState`` (force any screen so the owner can look at it).
Small private helpers mask the key for display and turn a stored state into the
screen's status object.

**Why it is here.** This is where the pieces actually work together, and several
methods carry hard-won rules. ``refreshOnLaunch`` is how a renewed subscription's
later end-date ever reaches a customer — without it a paying user would be
blocked the day after renewal; it runs only when a server that supports it is
configured, and any failure is deliberately swallowed so the 30-day offline
grace still opens the app. ``deactivate`` clears the local licence only when the
server confirms the seat is (or already was) free — a mere network failure keeps
the local licence, because destroying it while the seat is still held would
strand the transfer half-done. ``previewState`` exists purely so the owner can
see every licensing screen without waiting out a real clock; it is flagged for
removal and is withheld from packaged builds elsewhere.

.. CG-EXPLANATION-END id=class:ActivationService

