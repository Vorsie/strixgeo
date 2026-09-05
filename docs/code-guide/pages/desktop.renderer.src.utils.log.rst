desktop.renderer.src.utils.log
==============================

.. CG-PAGE source=desktop/src/renderer/src/utils/log.ts complete=true

*Source file:* ``desktop/src/renderer/src/utils/log.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-36

.. literalinclude:: ../../../desktop/src/renderer/src/utils/log.ts
   :language: typescript
   :lines: 1-36
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The opening comment. This file is the frontend's logging wrapper — a thin shim over the browser's console that adds a structured prefix and a timestamp to every message.

**Why it is here.** The comment records that it is a single seam where a real logger (telemetry, file-based crash reporting) can be swapped in later, and that its levels deliberately match the backend's own logger so a user-reported issue reads identically across the engine's ``[api]`` lines and the window's ``[ui]`` lines (CLAUDE.md: both frontend and backend need logging). Debug is silenced in production to keep the console quiet, and trace is silenced even in dev unless a device opts in, because per-render trace lines written at debug once drowned the console (dogfeed 2026-08-02).

.. CG-EXPLANATION-END id=module-header

``type LogLevel``
-----------------

.. CG-BLOCK id=type:LogLevel lines=37-40

.. literalinclude:: ../../../desktop/src/renderer/src/utils/log.ts
   :language: typescript
   :lines: 37-40
   :lineno-match:

.. CG-EXPLANATION-START id=type:LogLevel

**What this does.** The list of allowed log levels: trace, debug, info, success, warn, error.

**Why it is here.** The comment records that success mirrors the backend's SUCCESS level so an end-to-end flow logs identically on both sides; because browsers offer no success colour, it is routed through the ordinary info channel and readers tell it apart by the SUCCESS text in the prefix, not by colour.

.. CG-EXPLANATION-END id=type:LogLevel

``const IS_DEV``
----------------

.. CG-BLOCK id=const:IS_DEV lines=41-49

.. literalinclude:: ../../../desktop/src/renderer/src/utils/log.ts
   :language: typescript
   :lines: 41-49
   :lineno-match:

.. CG-EXPLANATION-START id=const:IS_DEV

**What this does.** A true/false value that is true in a development run and false in a production build.

**Why it is here.** The comment records that the build tool injects this flag — true for the dev command, false for the build command — and it is what silences debug and trace output for end users.

.. CG-EXPLANATION-END id=const:IS_DEV

``const TRACE_OPT_IN_KEY``
--------------------------

.. CG-BLOCK id=const:TRACE_OPT_IN_KEY lines=50-58

.. literalinclude:: ../../../desktop/src/renderer/src/utils/log.ts
   :language: typescript
   :lines: 50-58
   :lineno-match:

.. CG-EXPLANATION-START id=const:TRACE_OPT_IN_KEY

**What this does.** The browser-storage key a device sets to switch trace output on: ``strix.log.trace``.

**Why it is here.** The docstring records that setting it to ``1`` in the DevTools console turns tracing on and removing it turns tracing off.

.. CG-EXPLANATION-END id=const:TRACE_OPT_IN_KEY

``function traceEnabled``
-------------------------

.. CG-BLOCK id=function:traceEnabled lines=59-68

.. literalinclude:: ../../../desktop/src/renderer/src/utils/log.ts
   :language: typescript
   :lines: 59-68
   :lineno-match:

.. CG-EXPLANATION-START id=function:traceEnabled

**What this does.** Answers whether trace lines should be printed right now: only in a dev run, and only when the opt-in key is set to ``1``; the storage read is wrapped so a locked-down page cannot crash on it.

**Why it is here.** The docstring records that the flag is read on every call rather than cached at load, so it can be flipped from the DevTools console mid-session — the moment you want tracing is always after the interesting thing has already started — and that the try/catch is there because storage can throw on a restricted origin and tracing is never worth a crash.

.. CG-EXPLANATION-END id=function:traceEnabled

``function emit``
-----------------

.. CG-BLOCK id=function:emit lines=69-91

.. literalinclude:: ../../../desktop/src/renderer/src/utils/log.ts
   :language: typescript
   :lines: 69-91
   :lineno-match:

.. CG-EXPLANATION-START id=function:emit

**What this does.** The central emitter: it drops debug lines in production and trace lines when tracing is off, builds a prefix of the form [ui, timestamp, level, scope], and forwards the message to the matching console method.

**Why it is here.** It is the one place that applies the level gates and the shared prefix so every level formats the same way; trace and debug route to the console's debug channel, info and success to its info channel, and warn and error to their own.

.. CG-EXPLANATION-END id=function:emit

``const log``
-------------

.. CG-BLOCK id=const:log lines=92-99

.. literalinclude:: ../../../desktop/src/renderer/src/utils/log.ts
   :language: typescript
   :lines: 92-99
   :lineno-match:

.. CG-EXPLANATION-START id=const:log

**What this does.** The exported logger object, with one method per level (trace, debug, info, success, warn, error), each forwarding to the emitter with its level filled in.

**Why it is here.** It is the surface callers import, so a log line reads simply as, for example, ``log.info('boot', { apiBase, projectId })``.

.. CG-EXPLANATION-END id=const:log

