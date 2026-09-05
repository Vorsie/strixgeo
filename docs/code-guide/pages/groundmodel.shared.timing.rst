groundmodel.shared.timing
=========================

.. CG-PAGE source=src/groundmodel/shared/timing.py complete=true

*Source file:* ``src/groundmodel/shared/timing.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-34

.. literalinclude:: ../../../src/groundmodel/shared/timing.py
   :language: python
   :lines: 1-34
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Opens the timing-helpers module and captures ``_PROCESS_START_PERF``, a high-resolution clock reading taken the first time this module is imported — the anchor for "how long has this process been alive".

**Why it is here.** The docstring records why the anchor lives here and not in an entrypoint file: running ``python -m groundmodel.api.serve`` loads the entrypoint twice under two identities, so an anchor stored there would give a different, later reference; ``shared.timing`` has one identity in the import table and is imported early, so it is set once. ``perf_counter`` is a monotonic clock — it only ever moves forward and is unaffected by wall-clock adjustments.

.. CG-EXPLANATION-END id=module-header

Function ``def process_uptime_ms``
----------------------------------

.. CG-BLOCK id=function:process_uptime_ms lines=35-51

.. literalinclude:: ../../../src/groundmodel/shared/timing.py
   :language: python
   :lines: 35-51
   :lineno-match:

.. CG-EXPLANATION-START id=function:process_uptime_ms

**What this does.** Returns the number of milliseconds since that start anchor was captured.

**Why it is here.** A single per-process clock every module can share for the INFO startup timeline. The docstring notes it measures from the first ``shared.timing`` import onward, not from interpreter bootstrap, because the tiny pre-import cost cannot be observed from Python.

.. CG-EXPLANATION-END id=function:process_uptime_ms

Class ``_InfoLogger`` — header
------------------------------

.. CG-BLOCK id=class:_InfoLogger lines=52-54

.. literalinclude:: ../../../src/groundmodel/shared/timing.py
   :language: python
   :lines: 52-54
   :lineno-match:

.. CG-EXPLANATION-START id=class:_InfoLogger

**What this does.** Declares a minimal *protocol* — a description of the shape an object must have, here "anything with an ``info`` and a ``warning`` method".

**Why it is here.** It lets ``phase_timer`` accept any logger without importing a concrete logger class, keeping to the helper-hygiene rule that a helper never imports a logger instance at module load time (CLAUDE.md).

.. CG-EXPLANATION-END id=class:_InfoLogger

Method ``_InfoLogger``. ``def info``
------------------------------------

.. CG-BLOCK id=method:_InfoLogger.info lines=55-58

.. literalinclude:: ../../../src/groundmodel/shared/timing.py
   :language: python
   :lines: 55-58
   :lineno-match:

.. CG-EXPLANATION-START id=method:_InfoLogger.info

**What this does.** The protocol's ``info`` method signature — a method that takes a message and returns nothing.

**Why it is here.** Part of the shape description above; it has no body because a protocol only declares the shape an object must have, it is never called directly.

.. CG-EXPLANATION-END id=method:_InfoLogger.info

Method ``_InfoLogger``. ``def warning``
---------------------------------------

.. CG-BLOCK id=method:_InfoLogger.warning lines=59-63

.. literalinclude:: ../../../src/groundmodel/shared/timing.py
   :language: python
   :lines: 59-63
   :lineno-match:

.. CG-EXPLANATION-START id=method:_InfoLogger.warning

**What this does.** The protocol's ``warning`` method signature, used when a timed phase fails.

**Why it is here.** It declares the second method ``phase_timer`` needs, so the timer can log a failure at warning level against any logger that satisfies this shape.

.. CG-EXPLANATION-END id=method:_InfoLogger.warning

Function ``def ms_since``
-------------------------

.. CG-BLOCK id=function:ms_since lines=64-87

.. literalinclude:: ../../../src/groundmodel/shared/timing.py
   :language: python
   :lines: 64-87
   :lineno-match:

.. CG-EXPLANATION-START id=function:ms_since

**What this does.** Returns the elapsed time since a given ``perf_counter`` snapshot, as a whole number of milliseconds.

**Why it is here.** The docstring records this is the canonical way the application layer formats timing for logs — one source of truth for the unit (integer milliseconds) and the conversion (seconds times 1000, truncated), because sub-millisecond precision is not useful for phases that span seconds to minutes. ``perf_counter`` is chosen over ``time.time`` because it is monotonic.

.. CG-EXPLANATION-END id=function:ms_since

Function ``def phase_timer``
----------------------------

.. CG-BLOCK id=function:phase_timer lines=88-139

.. literalinclude:: ../../../src/groundmodel/shared/timing.py
   :language: python
   :lines: 88-139
   :lineno-match:

.. CG-EXPLANATION-START id=function:phase_timer

**What this does.** A *context manager* (start/stop code used with a ``with`` block) that times a named build phase. On a clean exit it logs one INFO line ``"<label> [<seconds>s]"``; on an exception it logs a WARNING line ``"<label> FAILED [<seconds>s]"`` and re-raises the exception.

**Why it is here.** The docstring records this makes a crashing or hung phase diagnosable from the log without a re-run, and that it takes the logger as a parameter so it never imports a logger instance at module load time (the helper-hygiene rule, CLAUDE.md).

.. CG-EXPLANATION-END id=function:phase_timer

