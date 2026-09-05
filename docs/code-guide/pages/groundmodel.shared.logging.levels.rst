groundmodel.shared.logging.levels
=================================

.. CG-PAGE source=src/groundmodel/shared/logging/levels.py complete=true

*Source file:* ``src/groundmodel/shared/logging/levels.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-7

.. literalinclude:: ../../../src/groundmodel/shared/logging/levels.py
   :language: python
   :lines: 1-7
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Adds two logging levels the standard library does not ship: ``TRACE`` (numbered 5, below DEBUG) and ``SUCCESS`` (numbered 25, between INFO and WARNING). A *log level* is a severity number; a message is shown only when its level is at least the configured threshold. The two ``addLevelName`` calls register the human names so they print as ``TRACE`` and ``SUCCESS``.

**Why it is here.** CLAUDE.md's level guide reserves TRACE for per-row / per-byte detail (the finest level, usually suppressed in production) and SUCCESS for happy-path completion ("CPT imported: 10,432 rows"). Python's built-in levels have no slot for either, so they are registered here once, at import, before any logger uses them.

.. CG-EXPLANATION-END id=module-header

