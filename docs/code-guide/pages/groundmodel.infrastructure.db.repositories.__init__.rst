groundmodel.infrastructure.db.repositories
==========================================

.. CG-PAGE source=src/groundmodel/infrastructure/db/repositories/__init__.py complete=true

*Source file:* ``src/groundmodel/infrastructure/db/repositories/__init__.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-4

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/repositories/__init__.py
   :language: python
   :lines: 1-4
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** One docstring line, one import of ``CptRepository``, and an ``__all__`` naming it as the package's public export.

**Why it is here.** It marks the ``repositories`` package. A *repository* is the one class that knows how to read and write a particular kind of thing in the database, so the rest of the program asks the repository for a CPT or a borehole and never writes SQL itself. Only the CPT repository is re-exported here for convenience; the others are imported directly from their own modules.

.. CG-EXPLANATION-END id=module-header

