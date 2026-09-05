groundmodel.infrastructure.db.migrate
=====================================

.. CG-PAGE source=src/groundmodel/infrastructure/db/migrate.py complete=true

*Source file:* ``src/groundmodel/infrastructure/db/migrate.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-53

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrate.py
   :language: python
   :lines: 1-53
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Opens the command-line entry point that brings the configured database up to the latest schema, imports the migrator and its exit-code and timeout constants, and creates a module logger.

**Why it is here.** The docstring records where this is invoked: by the desktop launcher on every start of the bundled-database build, after it has created a per-user database folder and started PostgreSQL, and before the backend starts. It lays out the exit-code contract — a distinct number for each failure stage, including a database written by a newer build — because on a coworker's machine there is no terminal, so a single clear line naming the failed stage is read straight from a dialog.

.. CG-EXPLANATION-END id=module-header

Function ``def _parse_args``
----------------------------

.. CG-BLOCK id=function:_parse_args lines=54-84

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrate.py
   :language: python
   :lines: 54-84
   :lineno-match:

.. CG-EXPLANATION-START id=function:_parse_args

**What this does.** Reads the two arguments the launcher passes — the database address (defaulting to the resolved setting) and how long to wait for the server — and returns them.

**Why it is here.** A thin argument reader so the launcher can override the address and timeout, defaulting to the same resolved values the rest of the stack uses.

.. CG-EXPLANATION-END id=function:_parse_args

Function ``def main``
---------------------

.. CG-BLOCK id=function:main lines=85-122

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrate.py
   :language: python
   :lines: 85-122
   :lineno-match:

.. CG-EXPLANATION-START id=function:main

**What this does.** Runs the migrator once and turns its outcome into a process exit code: success returns zero; a newer-database error, a named stage failure, or any unexpected error each print one clear line and return their own code.

**Why it is here.** The docstring records why the newer-database case is separated from a migration failure: the stored data is fine, this build is just too old to open it, so its own exit code lets the launcher show "install the current version; your data is intact". The last-resort catch guarantees even an unforeseen error becomes a readable dialog line rather than a stack trace.

.. CG-EXPLANATION-END id=function:main

Module-level constants and statements
-------------------------------------

.. CG-BLOCK id=module-statements lines=123-124

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrate.py
   :language: python
   :lines: 123-124
   :lineno-match:

.. CG-EXPLANATION-START id=module-statements

**What this does.** When the file is run directly, calls ``main`` and exits with its return code.

**Why it is here.** This is what makes the file runnable as a command by the launcher; the returned number is the exit code the launcher inspects.

.. CG-EXPLANATION-END id=module-statements

