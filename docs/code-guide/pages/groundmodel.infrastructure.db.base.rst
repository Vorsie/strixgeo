groundmodel.infrastructure.db.base
==================================

.. CG-PAGE source=src/groundmodel/infrastructure/db/base.py complete=true

*Source file:* ``src/groundmodel/infrastructure/db/base.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-4

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/base.py
   :language: python
   :lines: 1-4
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Imports SQLAlchemy's declarative-base building block.

**Why it is here.** This one import is all that is needed to define the shared parent every table class inherits from.

.. CG-EXPLANATION-END id=module-header

Class ``Base``
--------------

.. CG-BLOCK id=class:Base lines=5-13

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/base.py
   :language: python
   :lines: 5-13
   :lineno-match:

.. CG-EXPLANATION-START id=class:Base

**What this does.** Declares the project-wide declarative base — the single parent class every ORM table model inherits from.

**Why it is here.** The *declarative Base* is the shared ancestor that ties all the table classes into one metadata registry, which the migration tooling reads to know the full set of tables. The docstring explains why there are no abstract methods here: SQLAlchemy's own machinery already forces every subclass to declare its table name and a primary key, and adding a separate abstract-class layer on top would clash with that machinery.

.. CG-EXPLANATION-END id=class:Base

