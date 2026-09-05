groundmodel.infrastructure.db.models
====================================

.. CG-PAGE source=src/groundmodel/infrastructure/db/models/__init__.py complete=true

*Source file:* ``src/groundmodel/infrastructure/db/models/__init__.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-79

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/models/__init__.py
   :language: python
   :lines: 1-79
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Imports every ORM model class in the package and lists them all in ``__all__`` (the public export list — the names this package hands out when another file does ``from ...models import *``).

**Why it is here.** An *ORM model* is a Python class that stands for one database table, so working with a row feels like working with an object instead of writing raw SQL. SQLAlchemy only wires up the relationships between tables once every model class has been imported, so this file pulls them all in from one place — importing this package guarantees the whole set is loaded and connected.

.. CG-EXPLANATION-END id=module-header

