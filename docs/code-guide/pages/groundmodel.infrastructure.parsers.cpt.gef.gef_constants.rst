groundmodel.infrastructure.parsers.cpt.gef.gef_constants
========================================================

.. CG-PAGE source=src/groundmodel/infrastructure/parsers/cpt/gef/gef_constants.py complete=true

*Source file:* ``src/groundmodel/infrastructure/parsers/cpt/gef/gef_constants.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-127

.. literalinclude:: ../../../src/groundmodel/infrastructure/parsers/cpt/gef/gef_constants.py
   :language: python
   :lines: 1-127
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Holds the fixed lookup tables the GEF parser reads against: which GEF *quantity number* maps to which standard column name, how to convert each pressure unit to megapascals (MPa), which columns are pressures, how the coordinate-system codes translate to EPSG, which characters may act as separators, the ceiling on how many columns a file may declare, and the numbered slots of the MEASUREMENTVAR header lines. A GEF file numbers its data channels by a standard *quantity* code — quantity 2 is always tip resistance qc, quantity 3 is always sleeve friction fs, and so on — and ``#MEASUREMENTVAR=`` lines carry single header values by a numbered index.

**Why it is here.** The project keeps this kind of fixed lookup data in a dedicated constants file, next to the parser that uses it, with a comment on *why* each value was chosen rather than just what it is. Two choices here are load-bearing and much explained in the comments. First, quantity 1 (``length_m``, the length of rod pushed in, measured along a rod that leans off vertical) is a different thing from quantity 11 (``depth_m``, the true vertical depth after correcting for that lean) — the corrected depth is always the shallower of the two, and confusing them puts every soil layer at the wrong level. Second, quantity 15 (``qt_mpa``, a piezocone's corrected tip resistance) and quantity 128 (``q_total_mpa``, a mechanical Begemann cone's combined tip-plus-sleeve reading) share the old symbol "qt" but are physically different measurements, so they get separate columns and are never derived from one another. The ``MAX_GEF_COLUMNS`` cap of 512 is a safety limit: a hostile 200-byte file could otherwise declare a billion columns and drive the program to allocate tens of gigabytes.

.. CG-EXPLANATION-END id=module-header

