desktop.main.embedded.bootSequence
==================================

.. CG-PAGE source=desktop/src/main/embedded/bootSequence.ts complete=true

*Source file:* ``desktop/src/main/embedded/bootSequence.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-29

.. literalinclude:: ../../../desktop/src/main/embedded/bootSequence.ts
   :language: typescript
   :lines: 1-29
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** This opening block is the file's *docstring* — a long comment written for whoever reads the code. It explains that this file is the packaged desktop app's startup recorder: as the app starts it works through a fixed list of ordered steps, and this file writes down which step ran, how long each took, and exactly where it stopped if it stopped. Electron (the framework this desktop app is built on) runs two programs at once — the *main process*, which has full access to the computer (files, launching other programs, windows), and the *renderer*, the sandboxed web page the user actually sees; this whole group of files is the main process. The note contrasts two situations. In development a person has already started PostgreSQL (the database) inside Docker on port ``5433`` and launched the app by hand. A shipped (*packaged*) build has none of that: it must pick a free network *port* (a numbered channel other programs connect to), create the database's on-disk storage on first launch, start the database program, bring an empty schema up to date, start the Python engine, and only then open the window. The file is deliberately *pure* — it touches no files, launches no programs, and borrows nothing from Electron; the caller does the real work and simply reports each outcome back here.

**Why it is here.** A shipped build starts on a stranger's machine with no terminal window, in front of someone who cannot read a programmer's stack trace (the wall of technical text a crash prints). Two things make that survivable, and both are the whole point of this file. First, a failure can name the *step* — for example ``StrixGeo could not start its database`` — instead of only a cryptic code, which is something a tester can act on where a bare error is not. Second, the successful path leaves behind a timed log, and those per-step timings are the only way to see that, say, creating the database on the very first launch costs several seconds while every later launch costs a fraction of that. Keeping the file pure (no files, no Electron) is a deliberate choice so every possible outcome can be tested on any machine without cutting a real build.

.. CG-EXPLANATION-END id=module-header

``type BootStage``
------------------

.. CG-BLOCK id=type:BootStage lines=30-50

.. literalinclude:: ../../../desktop/src/main/embedded/bootSequence.ts
   :language: typescript
   :lines: 30-50
   :lineno-match:

.. CG-EXPLANATION-START id=type:BootStage

**What this does.** Defines ``BootStage`` as a *type* — a note to the rest of the code that a value must be exactly one of a fixed set of words. Each word names one ordered step of a packaged startup, and the comment above each one says what that step does: locate the bundled files, read or create this install's password, pick a free port, create the database storage (first launch only), start the database program, wait until it answers, bring the empty schema up to date, start the Python engine, and wait until the engine answers over the web.

**Why it is here.** Naming each step as a fixed word, in the order they run, makes the startup logic easy to follow and lets the compiler catch a typo like a mis-spelled step name before the app ever runs. This type is only the *vocabulary* of possible steps; which of them actually run, and in what order, is decided by the code that drives the boot (the neighbouring ``embeddedStack.ts``). That is why a migration step appears here even though, in today's packaged app, the schema update is done inside the Python engine rather than as its own launcher step.

.. CG-EXPLANATION-END id=type:BootStage

``type BootStepStatus``
-----------------------

.. CG-BLOCK id=type:BootStepStatus lines=51-53

.. literalinclude:: ../../../desktop/src/main/embedded/bootSequence.ts
   :language: typescript
   :lines: 51-53
   :lineno-match:

.. CG-EXPLANATION-START id=type:BootStepStatus

**What this does.** Defines ``BootStepStatus`` — the three ways a step can finish: ``ok`` (it did its work), ``skipped`` (it was not needed this time), and ``failed`` (it stopped the launch).

**Why it is here.** ``skipped`` is kept separate from ``ok`` on purpose. The database storage being created in several seconds and it already existing so nothing was done are different facts about the machine, and only one of them explains a slow first launch — so the log must be able to tell them apart.

.. CG-EXPLANATION-END id=type:BootStepStatus

``interface BootStep``
----------------------

.. CG-BLOCK id=interface:BootStep lines=54-63

.. literalinclude:: ../../../desktop/src/main/embedded/bootSequence.ts
   :language: typescript
   :lines: 54-63
   :lineno-match:

.. CG-EXPLANATION-START id=interface:BootStep

**What this does.** Describes the shape of one finished step as it appears in the boot log. An *interface* is simply a written description of the fields a value must carry. A ``BootStep`` records the ``stage`` (which step), the ``status`` (how it finished), ``ms`` (the wall-clock time it took, in milliseconds — thousandths of a second, the unit computers keep time in), and an optional ``note`` — a scrap of detail worth keeping, such as the port that was chosen, why a step was skipped, or the error text.

**Why it is here.** Bundling the four facts about a step into one tidy record means the log renderer has a single, uniform thing to print for every step, and the timings are captured in a form that adds up to a believable total at the end.

.. CG-EXPLANATION-END id=interface:BootStep

``interface BootFailure``
-------------------------

.. CG-BLOCK id=interface:BootFailure lines=64-81

.. literalinclude:: ../../../desktop/src/main/embedded/bootSequence.ts
   :language: typescript
   :lines: 64-81
   :lineno-match:

.. CG-EXPLANATION-START id=interface:BootFailure

**What this does.** Describes everything the failure dialog and the log need when a launch dies: the ``stage`` that failed, a ``summary`` (a plain-language sentence a non-technical tester can read), a ``message`` (the underlying technical error, kept for the log and a bug report), and ``log`` (the full boot log up to and including the failure).

**Why it is here.** Carrying both a plain sentence and the raw technical message in one object lets the same failure serve two very different readers at once — the tester sees the ordinary-words summary in a dialog, while the log and any bug report they send back carry the exact error a developer needs to diagnose it.

.. CG-EXPLANATION-END id=interface:BootFailure

``const STAGE_SENTENCES``
-------------------------

.. CG-BLOCK id=const:STAGE_SENTENCES lines=82-99

.. literalinclude:: ../../../desktop/src/main/embedded/bootSequence.ts
   :language: typescript
   :lines: 82-99
   :lineno-match:

.. CG-EXPLANATION-START id=const:STAGE_SENTENCES

**What this does.** A fixed lookup table pairing every startup step with a plain-language sentence describing what the app was doing — for example, the port step maps to ``StrixGeo could not reserve a network port on this machine.`` and the database-start step to ``StrixGeo could not start its database.``

**Why it is here.** These sentences are read by a non-technical tester in an error dialog, so they are written in ordinary words and deliberately never repeat the internal step name. The module note records that a unit test pins exactly this property, because it is precisely the kind of thing a later cleanup that simply printed the internal step name would quietly break — turning a readable apology back into jargon.

.. CG-EXPLANATION-END id=const:STAGE_SENTENCES

``function describeStage``
--------------------------

.. CG-BLOCK id=function:describeStage lines=100-110

.. literalinclude:: ../../../desktop/src/main/embedded/bootSequence.ts
   :language: typescript
   :lines: 100-110
   :lineno-match:

.. CG-EXPLANATION-START id=function:describeStage

**What this does.** A one-line helper that hands back the plain-language sentence for a given step, by looking it up in the table above.

**Why it is here.** Wrapping the lookup in a named function gives the rest of the code one obvious place to turn a step into its human sentence, and keeps the failure-building code from reaching into the table directly.

.. CG-EXPLANATION-END id=function:describeStage

``class BootSequence``
----------------------

.. CG-BLOCK id=class:BootSequence lines=111-228

.. literalinclude:: ../../../desktop/src/main/embedded/bootSequence.ts
   :language: typescript
   :lines: 111-228
   :lineno-match:

.. CG-EXPLANATION-START id=class:BootSequence

**What this does.** The recorder itself — one instance is created per launch. It offers a small set of actions: ``begin`` opens a step and notes the time; ``succeed``, ``skip`` and ``fail`` close the open step with its outcome (``fail`` also builds and returns the full ``BootFailure``); ``format`` renders the whole log as one line per step plus a total; and the read-only ``steps`` and ``failed`` let the caller inspect progress. Every method is instant and side-effect free — the caller performs the real work between ``begin`` and the closing call. Its clock is *injected*: the constructor takes a function that returns the current time (a *monotonic clock* — one that only ever counts forward and never jumps when the wall-clock is corrected), so tests can feed exact times while production passes the real one.

**Why it is here.** This is the single object that turns the scattered, error-prone startup into a recorded sequence. Two guards make the recording trustworthy: ``begin`` refuses to open a new step while one is still open, and closing refuses when none is open — either would mean a code path returned without reporting its outcome, and the boot log would silently drop a step. Injecting the clock instead of reading the time directly is what lets a test assert exact durations and keeps the pure, testable-anywhere design the module note insists on.

.. CG-EXPLANATION-END id=class:BootSequence

