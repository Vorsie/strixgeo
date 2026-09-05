groundmodel.infrastructure.dem
==============================

.. CG-PAGE source=src/groundmodel/infrastructure/dem/__init__.py complete=true

*Source file:* ``src/groundmodel/infrastructure/dem/__init__.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-6

.. literalinclude:: ../../../src/groundmodel/infrastructure/dem/__init__.py
   :language: python
   :lines: 1-6
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Marks this folder as the DEM package and, in its docstring, says what the package is for: sampling a *DEM* (a Digital Elevation Model — a grid of ground-surface heights covering an area) to draw the ground line across the top of a cross-section.

**Why it is here.** A folder only becomes an importable group of modules once it holds an ``__init__.py``, and this one is nearly empty on purpose. The docstring records the design stance the project follows everywhere: build for one region first (Belgium/DHMVII), and only promote a shared interface once a second region (the Netherlands/AHN) actually lands — do not design an abstraction you have not needed yet.

.. CG-EXPLANATION-END id=module-header

