desktop.main.mainCrashPolicy
============================

.. CG-PAGE source=desktop/src/main/mainCrashPolicy.ts complete=true

*Source file:* ``desktop/src/main/mainCrashPolicy.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-21

.. literalinclude:: ../../../desktop/src/main/mainCrashPolicy.ts
   :language: typescript
   :lines: 1-21
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** This is the file's opening note (a *docstring*). It explains that this module decides what the main process should DO about an uncaught error — an error that escaped every attempt to catch it and would otherwise take the app down. Its whole job is to tell two cases apart: a real programming fault, and a *broken pipe* — the case where whoever was reading the app's printed output (its *stdout* / *stderr*, the two normal channels a program prints to) simply went away, which leaves the app's own state completely intact.

**Why it is here.** The crash handler used to treat every uncaught error the same way — log it, show a blocking error dialog, exit. That is right for a genuine bug and wrong for a dead output pipe: on 28 August 2026 ten such dialogs stacked up on the owner's desktop, one per orphaned Electron instance, each announcing breakage when nothing was actually wrong and throwing away whatever the user was doing. It reaches real users too — a packaged app launched from a terminal the user then closes takes exactly this path. The policy is kept a pure, Electron-free module so it can be tested on its own, with the startup code merely wiring it up.

.. CG-EXPLANATION-END id=module-header

``type CrashAction``
--------------------

.. CG-BLOCK id=type:CrashAction lines=22-30

.. literalinclude:: ../../../desktop/src/main/mainCrashPolicy.ts
   :language: typescript
   :lines: 22-30
   :lineno-match:

.. CG-EXPLANATION-START id=type:CrashAction

**What this does.** Names the two possible decisions as a *type* (a note that a value must be exactly one of these words): ``'ignore-broken-pipe'`` (log it and carry on) or ``'fatal'`` (warn and exit). The block also carries the note that leads into the next value.

**Why it is here.** Reducing the whole policy to two named outcomes makes the decision explicit at every call site and lets the compiler catch any typo in the two words.

.. CG-EXPLANATION-END id=type:CrashAction

``const BROKEN_PIPE_CODES``
---------------------------

.. CG-BLOCK id=const:BROKEN_PIPE_CODES lines=31-40

.. literalinclude:: ../../../desktop/src/main/mainCrashPolicy.ts
   :language: typescript
   :lines: 31-40
   :lineno-match:

.. CG-EXPLANATION-START id=const:BROKEN_PIPE_CODES

**What this does.** The set of error codes that mean "the far end of our output is gone": ``EPIPE`` (the classic broken pipe), ``ERR_STREAM_DESTROYED`` (Node's own code when the stream object was torn down beneath us), and ``EIO`` (what a dying terminal raises instead on some platforms). The block also carries the note that leads into the next value.

**Why it is here.** These are the exact codes that signal a departed reader rather than an internal fault; gathering them into one named set turns the classification below into a simple membership check.

.. CG-EXPLANATION-END id=const:BROKEN_PIPE_CODES

``const OUTPUT_SYSCALLS``
-------------------------

.. CG-BLOCK id=const:OUTPUT_SYSCALLS lines=41-56

.. literalinclude:: ../../../desktop/src/main/mainCrashPolicy.ts
   :language: typescript
   :lines: 41-56
   :lineno-match:

.. CG-EXPLANATION-START id=const:OUTPUT_SYSCALLS

**What this does.** The set of system-call names — ``write`` and ``writev`` — that mean the failure happened while writing output. The block also carries the note that leads into the next function.

**Why it is here.** A bare ``EPIPE`` is not automatically the console dying: a network socket the app itself owns can raise it too, and that IS a real fault worth surfacing. Requiring the failure to be an output write — or to name no syscall at all, which is how Node reports stream-level errors — keeps a genuine socket fault from being mistaken for a harmless dead pipe.

.. CG-EXPLANATION-END id=const:OUTPUT_SYSCALLS

``function isBrokenPipe``
-------------------------

.. CG-BLOCK id=function:isBrokenPipe lines=57-80

.. literalinclude:: ../../../desktop/src/main/mainCrashPolicy.ts
   :language: typescript
   :lines: 57-80
   :lineno-match:

.. CG-EXPLANATION-START id=function:isBrokenPipe

**What this does.** Answers whether an uncaught value is a dead stdout/stderr rather than a real application fault. It rejects anything that is not an object, then requires the error's code to be one of the broken-pipe codes, then requires its syscall to be an output write (or to be absent). The block also carries the note that leads into the next function.

**Why it is here.** This is the classifier the whole policy rests on, and it is deliberately strict — every part of the error must match "a write to a pipe nobody is reading" — so that a real fault that merely happens to carry an ``EPIPE`` code is not waved through. It accepts a value of unknown shape because a thrown non-error value is legal JavaScript and could arrive here.

.. CG-EXPLANATION-END id=function:isBrokenPipe

``function crashActionFor``
---------------------------

.. CG-BLOCK id=function:crashActionFor lines=81-83

.. literalinclude:: ../../../desktop/src/main/mainCrashPolicy.ts
   :language: typescript
   :lines: 81-83
   :lineno-match:

.. CG-EXPLANATION-START id=function:crashActionFor

**What this does.** The one-line policy: return ``'ignore-broken-pipe'`` when the value is a broken pipe, otherwise ``'fatal'``.

**Why it is here.** Everything that is not provably a dead output pipe stays fatal — an unclassifiable value is never swallowed, because silently surviving a real corruption is a worse outcome than an unnecessary exit.

.. CG-EXPLANATION-END id=function:crashActionFor

