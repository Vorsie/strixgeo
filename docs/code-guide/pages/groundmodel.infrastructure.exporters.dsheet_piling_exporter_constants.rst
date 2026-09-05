groundmodel.infrastructure.exporters.dsheet_piling_exporter_constants
=====================================================================

.. CG-PAGE source=src/groundmodel/infrastructure/exporters/dsheet_piling_exporter_constants.py complete=true

*Source file:* ``src/groundmodel/infrastructure/exporters/dsheet_piling_exporter_constants.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-119

.. literalinclude:: ../../../src/groundmodel/infrastructure/exporters/dsheet_piling_exporter_constants.py
   :language: python
   :lines: 1-119
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The fixed values for the D-Sheet Piling (``.shi``) exporter: where along the section to take the 1-D profile when the caller does not say (mid-section), the smallest layer thickness and the same polygon tolerances as D-Stability, the fixed names for the exported profile / surface / construction stage, the placeholder water-level name and value, and the text lines of the ``[RUN IDENTIFICATION]`` block (a provenance line, a missing-inputs TODO, and two alternate parameter lines).

**Why it is here.** The strings are written as full sentences because the ``[RUN IDENTIFICATION]`` block is the only place a ``.shi`` lets Strix speak. A ``.shi`` is the D-Sheet Piling input file (cp1252 ASCII text). Mid-section is the least arbitrary default sample point. GEOLib always writes a water-level block, so the level cannot be omitted, only NAMED — it is left at GEOLib's forced 0.00 with the name ``TODO set water level``, and must NEVER be set to the ground surface, which was the 2026-08-02 mistake that made every exported model fully saturated. D-Sheet's GUI shows only three run-identification lines, so the whole message is budgeted to three. The parameter line has two forms: a TODO when no exported unit carried NAD-table parameters (the shipped state), and a provenance line naming the source table (NBN EN 1997-1 ANB Tabel 2.1) when some did — because a ``.shi`` soil block has no per-soil free-text field, this is the only place that provenance can go (docs/exports.md).

.. CG-EXPLANATION-END id=module-header

