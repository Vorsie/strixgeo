groundmodel.infrastructure
==========================

.. CG-PAGE source=src/groundmodel/infrastructure/__init__.py complete=true

*Source file:* ``src/groundmodel/infrastructure/__init__.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-1

.. literalinclude:: ../../../src/groundmodel/infrastructure/__init__.py
   :language: python
   :lines: 1-1
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Marks the infrastructure folder as a package and names, in one line, what it holds: the database, the file parsers, the exporters, and the GIS helpers.

**Why it is here.** A folder becomes an importable group of modules once it holds an ``__init__.py``. The infrastructure layer is the one that deals with the messy outside world — storage, files, geometry — while the pure geotechnical knowledge stays in the domain layer above it.

.. CG-EXPLANATION-END id=module-header

