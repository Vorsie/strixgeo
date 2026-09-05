groundmodel.infrastructure.db.session_constants
===============================================

.. CG-PAGE source=src/groundmodel/infrastructure/db/session_constants.py complete=true

*Source file:* ``src/groundmodel/infrastructure/db/session_constants.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-48

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/session_constants.py
   :language: python
   :lines: 1-48
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Holds the three per-connection timeout settings applied to every database connection — lock timeout, statement timeout, idle-in-transaction timeout — as strings, and the block that carries them to the engine.

**Why it is here.** The project convention keeps fixed values in a constants file. The docstring records the audit reason (M3 — a request must fail loudly, never hang) and why each value is what it is: the lock timeout (30 s) makes a blocked write abort and become a clean "busy" answer; the statement timeout (5 min) catches a runaway single statement and is deliberately larger than the lock timeout so the lock case is reached first; the idle-in-transaction timeout (5 min) closes a transaction a crashed client left open, freeing its locks and connection. The values are strings because the driver requires these settings as strings.

.. CG-EXPLANATION-END id=module-header

