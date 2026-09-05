groundmodel.infrastructure.gis
==============================

.. CG-PAGE source=src/groundmodel/infrastructure/gis/__init__.py complete=true

*Source file:* ``src/groundmodel/infrastructure/gis/__init__.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-1

.. literalinclude:: ../../../src/groundmodel/infrastructure/gis/__init__.py
   :language: python
   :lines: 1-1
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Marks the GIS folder as a package holding the spatial and PostGIS helpers.

**Why it is here.** A folder becomes an importable package once it holds an ``__init__.py``. *GIS* is geographic information handling, and *PostGIS* is the add-on that lets PostgreSQL store and query geometry (points, lines, boxes).

.. CG-EXPLANATION-END id=module-header

