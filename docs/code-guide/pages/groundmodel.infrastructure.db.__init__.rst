groundmodel.infrastructure.db
=============================

.. CG-PAGE source=src/groundmodel/infrastructure/db/__init__.py complete=true

*Source file:* ``src/groundmodel/infrastructure/db/__init__.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-1

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/__init__.py
   :language: python
   :lines: 1-1
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Marks the database folder as a package and names what it holds: the ORM models and the repositories.

**Why it is here.** A folder becomes an importable package once it holds an ``__init__.py``. An *ORM* (object-relational mapper) is the library that lets the code work with database rows as Python objects; the models describe the tables and the repositories hold the queries.

.. CG-EXPLANATION-END id=module-header

