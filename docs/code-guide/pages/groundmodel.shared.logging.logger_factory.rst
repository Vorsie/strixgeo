groundmodel.shared.logging.logger_factory
=========================================

.. CG-PAGE source=src/groundmodel/shared/logging/logger_factory.py complete=true

*Source file:* ``src/groundmodel/shared/logging/logger_factory.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-7

.. literalinclude:: ../../../src/groundmodel/shared/logging/logger_factory.py
   :language: python
   :lines: 1-7
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Opens the logger factory. It imports the standard logging library, the ``GroundModelLogger`` wrapper, and the custom ``TRACE`` level.

**Why it is here.** The factory is the one place that configures logging and hands out ready-to-use loggers, so the imports it needs sit at the top of the file.

.. CG-EXPLANATION-END id=module-header

Class ``LoggerFactory`` — header
--------------------------------

.. CG-BLOCK id=class:LoggerFactory lines=8-12

.. literalinclude:: ../../../src/groundmodel/shared/logging/logger_factory.py
   :language: python
   :lines: 8-12
   :lineno-match:

.. CG-EXPLANATION-START id=class:LoggerFactory

**What this does.** A *singleton* configurator — a class of which effectively one shared setup exists. A class-level flag ``_handlers_configured`` remembers whether logging has been set up yet.

**Why it is here.** Logging must be configured exactly once for the whole process; the flag guarantees the setup runs on the first request and is skipped on every request after.

.. CG-EXPLANATION-END id=class:LoggerFactory

Method ``LoggerFactory``. ``def get_logger``
--------------------------------------------

.. CG-BLOCK id=method:LoggerFactory.get_logger lines=13-19

.. literalinclude:: ../../../src/groundmodel/shared/logging/logger_factory.py
   :language: python
   :lines: 13-19
   :lineno-match:

.. CG-EXPLANATION-START id=method:LoggerFactory.get_logger

**What this does.** The method every module calls. It runs the one-time configuration if it has not run yet, then returns a ``GroundModelLogger`` wrapping the standard logger for the given name.

**Why it is here.** Callers get a fully configured, typed logger without each having to set anything up. Naming the logger after the module (``__name__``) is what puts the module path in every log line.

.. CG-EXPLANATION-END id=method:LoggerFactory.get_logger

Method ``LoggerFactory``. ``def _configure``
--------------------------------------------

.. CG-BLOCK id=method:LoggerFactory._configure lines=20-32

.. literalinclude:: ../../../src/groundmodel/shared/logging/logger_factory.py
   :language: python
   :lines: 20-32
   :lineno-match:

.. CG-EXPLANATION-START id=method:LoggerFactory._configure

**What this does.** Runs the one-time setup: it reads the configured log level from settings (falling back to TRACE if the value is not a valid level), then installs a log format that stamps each line with the time, level, logger name, source file and line number, and the message.

**Why it is here.** The comment records that the late import of ``settings`` avoids a circular dependency — settings and logging would otherwise import each other at load time. The fixed format gives every log line the same shape so the file is readable and searchable; falling back to TRACE on a bad level means a typo in ``.env`` never silences logging entirely.

.. CG-EXPLANATION-END id=method:LoggerFactory._configure

