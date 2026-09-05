groundmodel.shared.logging.ground_model_logger
==============================================

.. CG-PAGE source=src/groundmodel/shared/logging/ground_model_logger.py complete=true

*Source file:* ``src/groundmodel/shared/logging/ground_model_logger.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-8

.. literalinclude:: ../../../src/groundmodel/shared/logging/ground_model_logger.py
   :language: python
   :lines: 1-8
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Opens the typed logger wrapper. It imports the standard logging library and the two custom levels, and defines ``_STACKLEVEL = 2`` — the number of call frames between where a module calls ``self.info(...)`` and the standard library's own logging call.

**Why it is here.** The comment records that ``_STACKLEVEL`` exists so the file-and-line-number stamp in each log line points at the real call site, not at this wrapper. Without it, every log line would blame this one file.

.. CG-EXPLANATION-END id=module-header

Class ``GroundModelLogger`` — header
------------------------------------

.. CG-BLOCK id=class:GroundModelLogger lines=9-15

.. literalinclude:: ../../../src/groundmodel/shared/logging/ground_model_logger.py
   :language: python
   :lines: 9-15
   :lineno-match:

.. CG-EXPLANATION-START id=class:GroundModelLogger

**What this does.** The wrapper class. It exposes every standard log level plus the custom TRACE and SUCCESS, and can be used directly (from the factory) or inherited by a service class.

**Why it is here.** CLAUDE.md's logging convention is "logging via inheritance": every parser, exporter, service and logic class inherits this and calls ``super().__init__(__name__)``, gaining all the log methods on ``self``. Data holders — dataclasses, enums, value objects — do NOT inherit it: they hold data, they do not act, so they do not log.

.. CG-EXPLANATION-END id=class:GroundModelLogger

Method ``GroundModelLogger``. ``def __init__``
----------------------------------------------

.. CG-BLOCK id=method:GroundModelLogger.__init__ lines=16-18

.. literalinclude:: ../../../src/groundmodel/shared/logging/ground_model_logger.py
   :language: python
   :lines: 16-18
   :lineno-match:

.. CG-EXPLANATION-START id=method:GroundModelLogger.__init__

**What this does.** The set-up method. It accepts either a ready logger object or a name string, and keeps the underlying standard logger.

**Why it is here.** Accepting a name string is what lets a subclass write ``super().__init__(__name__)`` and get a logger named after its own module; accepting a ready logger is what lets the factory pass one it has already built.

.. CG-EXPLANATION-END id=method:GroundModelLogger.__init__

Method ``GroundModelLogger``. ``def name``
------------------------------------------

.. CG-BLOCK id=method:GroundModelLogger.name lines=19-23

.. literalinclude:: ../../../src/groundmodel/shared/logging/ground_model_logger.py
   :language: python
   :lines: 19-23
   :lineno-match:

.. CG-EXPLANATION-START id=method:GroundModelLogger.name

**What this does.** A read-only property returning the underlying logger's name.

**Why it is here.** A small accessor so callers and tests can read the logger's name without reaching into the private wrapped logger.

.. CG-EXPLANATION-END id=method:GroundModelLogger.name

Method ``GroundModelLogger``. ``def trace``
-------------------------------------------

.. CG-BLOCK id=method:GroundModelLogger.trace lines=24-27

.. literalinclude:: ../../../src/groundmodel/shared/logging/ground_model_logger.py
   :language: python
   :lines: 24-27
   :lineno-match:

.. CG-EXPLANATION-START id=method:GroundModelLogger.trace

**What this does.** Logs a message at the custom TRACE (5) level, passing along any extra arguments.

**Why it is here.** TRACE is the finest level — per-row / per-byte detail — and is reached through the standard library's generic ``log`` call because, unlike the built-in levels, it has no dedicated method. The ``stacklevel`` argument keeps the file-and-line stamp on the caller.

.. CG-EXPLANATION-END id=method:GroundModelLogger.trace

Method ``GroundModelLogger``. ``def debug``
-------------------------------------------

.. CG-BLOCK id=method:GroundModelLogger.debug lines=28-31

.. literalinclude:: ../../../src/groundmodel/shared/logging/ground_model_logger.py
   :language: python
   :lines: 28-31
   :lineno-match:

.. CG-EXPLANATION-START id=method:GroundModelLogger.debug

**What this does.** Logs a message at the standard DEBUG (10) level.

**Why it is here.** DEBUG is the per-item-decision level in CLAUDE.md's level guide; the ``stacklevel`` keeps the source stamp on the caller, matching every other method here.

.. CG-EXPLANATION-END id=method:GroundModelLogger.debug

Method ``GroundModelLogger``. ``def info``
------------------------------------------

.. CG-BLOCK id=method:GroundModelLogger.info lines=32-35

.. literalinclude:: ../../../src/groundmodel/shared/logging/ground_model_logger.py
   :language: python
   :lines: 32-35
   :lineno-match:

.. CG-EXPLANATION-START id=method:GroundModelLogger.info

**What this does.** Logs a message at the standard INFO (20) level.

**Why it is here.** INFO marks phase boundaries — the level CLAUDE.md's Definition of Done wants at the entry and exit of every public method.

.. CG-EXPLANATION-END id=method:GroundModelLogger.info

Method ``GroundModelLogger``. ``def warning``
---------------------------------------------

.. CG-BLOCK id=method:GroundModelLogger.warning lines=36-39

.. literalinclude:: ../../../src/groundmodel/shared/logging/ground_model_logger.py
   :language: python
   :lines: 36-39
   :lineno-match:

.. CG-EXPLANATION-START id=method:GroundModelLogger.warning

**What this does.** Logs a message at the standard WARNING (30) level.

**Why it is here.** WARNING is the "degraded but continuing" level in the guide — something is wrong but the work goes on.

.. CG-EXPLANATION-END id=method:GroundModelLogger.warning

Method ``GroundModelLogger``. ``def error``
-------------------------------------------

.. CG-BLOCK id=method:GroundModelLogger.error lines=40-43

.. literalinclude:: ../../../src/groundmodel/shared/logging/ground_model_logger.py
   :language: python
   :lines: 40-43
   :lineno-match:

.. CG-EXPLANATION-START id=method:GroundModelLogger.error

**What this does.** Logs a message at the standard ERROR (40) level.

**Why it is here.** ERROR is the "this item failed, processing continues" level in the guide.

.. CG-EXPLANATION-END id=method:GroundModelLogger.error

Method ``GroundModelLogger``. ``def critical``
----------------------------------------------

.. CG-BLOCK id=method:GroundModelLogger.critical lines=44-47

.. literalinclude:: ../../../src/groundmodel/shared/logging/ground_model_logger.py
   :language: python
   :lines: 44-47
   :lineno-match:

.. CG-EXPLANATION-START id=method:GroundModelLogger.critical

**What this does.** Logs a message at the standard CRITICAL (50) level, the most severe.

**Why it is here.** Kept for completeness so the wrapper covers the whole standard severity range, even though the engine rarely needs it.

.. CG-EXPLANATION-END id=method:GroundModelLogger.critical

Method ``GroundModelLogger``. ``def success``
---------------------------------------------

.. CG-BLOCK id=method:GroundModelLogger.success lines=48-51

.. literalinclude:: ../../../src/groundmodel/shared/logging/ground_model_logger.py
   :language: python
   :lines: 48-51
   :lineno-match:

.. CG-EXPLANATION-START id=method:GroundModelLogger.success

**What this does.** Logs a message at the custom SUCCESS (25) level, which sits between INFO and WARNING.

**Why it is here.** SUCCESS is the happy-path completion level; it is reached through the generic ``log`` call because it is a custom level with no built-in method.

.. CG-EXPLANATION-END id=method:GroundModelLogger.success

Method ``GroundModelLogger``. ``def exception``
-----------------------------------------------

.. CG-BLOCK id=method:GroundModelLogger.exception lines=52-54

.. literalinclude:: ../../../src/groundmodel/shared/logging/ground_model_logger.py
   :language: python
   :lines: 52-54
   :lineno-match:

.. CG-EXPLANATION-START id=method:GroundModelLogger.exception

**What this does.** Logs at ERROR level and additionally attaches the current exception's traceback (the record of where the failure came from).

**Why it is here.** Called inside an ``except`` block so the log carries the full stack trace, per the Definition-of-Done rule to log what failed and where.

.. CG-EXPLANATION-END id=method:GroundModelLogger.exception

