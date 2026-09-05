groundmodel.domain.services.robertson_2015_constants
====================================================

.. CG-PAGE source=src/groundmodel/domain/services/robertson_2015_constants.py complete=true

*Source file:* ``src/groundmodel/domain/services/robertson_2015_constants.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-392

.. literalinclude:: ../../../src/groundmodel/domain/services/robertson_2015_constants.py
   :language: python
   :lines: 1-392
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Holds the fixed numbers the Robertson soil-behaviour method reads: the assumed water-table depth to use when a CPT records none, the default and allowed range of the soil and water unit weights, the seven boundary lines of the soil-behaviour chart (each a list of chart knots the code interpolates between), and a hydraulic-conductivity lookup. Interpolation means reading a value between two known points by drawing a straight line between them.

**Why it is here.** The docstring names the published sources exactly and forbids simplifying the numbers: the nine-zone chart of Robertson (2009), the iterative stress normalisation of Robertson (2015), and the peat boundary of Lengkeek & Brinkgreve (2022). The water table and unit weights live here as single sources because the whole pipeline normalises against effective stress: if the Ic chart and the litho segmenter substituted different values, the curve the engineer validates and the boundaries he is offered would be computed from different stresses — and at 2 m depth a 0 m versus 1 m water table is about a 50 % difference, enough to flip the soil-behaviour zone. The assumed water table is 0 m (at the surface), the conservative choice when unknown, and the comment flags it as an assumption a derived surface must declare. The hydraulic-conductivity table is Phase 5 scope, included only for a faithful copy of the source.

.. CG-EXPLANATION-END id=module-header

