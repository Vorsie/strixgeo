groundmodel.infrastructure.db.lock_errors
=========================================

.. CG-PAGE source=src/groundmodel/infrastructure/db/lock_errors.py complete=true

*Source file:* ``src/groundmodel/infrastructure/db/lock_errors.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-22

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/lock_errors.py
   :language: python
   :lines: 1-22
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Opens the single place that recognises a PostgreSQL lock-timeout error, and defines the database's own code for that condition.

**Why it is here.** A *lock* is a claim on data that blocks other writers until released; a *lock timeout* aborts a statement that has waited too long for one. The docstring records that PostgreSQL signals this with a specific state code, that the async driver raises its own error and SQLAlchemy wraps it, and that matching on the state-code string (rather than the exact error type) means this file needs neither a driver import nor to care whether the error arrived wrapped or bare.

.. CG-EXPLANATION-END id=module-header

Function ``def is_lock_not_available``
--------------------------------------

.. CG-BLOCK id=function:is_lock_not_available lines=23-40

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/lock_errors.py
   :language: python
   :lines: 23-40
   :lineno-match:

.. CG-EXPLANATION-START id=function:is_lock_not_available

**What this does.** Reports whether an error is, or wraps, a PostgreSQL lock-timeout error, by reading its state code from either the wrapper or the underlying driver error.

**Why it is here.** This is the one check the body-partition write path uses to turn a lock timeout into a clean "busy, try again" answer instead of a raw failure. Reading the code off either layer means it works whether the error arrived wrapped by SQLAlchemy or bare from the driver.

.. CG-EXPLANATION-END id=function:is_lock_not_available

