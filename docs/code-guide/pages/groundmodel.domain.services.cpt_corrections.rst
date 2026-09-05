groundmodel.domain.services.cpt_corrections
===========================================

.. CG-PAGE source=src/groundmodel/domain/services/cpt_corrections.py complete=true

*Source file:* ``src/groundmodel/domain/services/cpt_corrections.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-18

.. literalinclude:: ../../../src/groundmodel/domain/services/cpt_corrections.py
   :language: python
   :lines: 1-18
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Introduces a module of primitive CPT corrections and sets up its logger. The headline correction is the corrected cone resistance, qt = qc + u2(1 - a): the measured tip resistance plus the shoulder pore pressure scaled by one minus the cone's net area ratio.

**Why it is here.** The docstring is careful to separate this from interpretation: these are basic mechanical identities applied at every read of a CPTU (a CPT that also measures pore water pressure), not the Phase 5 engineering scope. Only the fundamentals (qc, u2, cone area ratio) are stored; qt is recomputed on read so the database can never disagree with its own inputs, which is the project's Data Integrity Rule 1 (tag and derive, do not persist a value that can drift from its inputs).

.. CG-EXPLANATION-END id=module-header

Function ``def calculate_qt_series``
------------------------------------

.. CG-BLOCK id=function:calculate_qt_series lines=19-69

.. literalinclude:: ../../../src/groundmodel/domain/services/cpt_corrections.py
   :language: python
   :lines: 19-69
   :lineno-match:

.. CG-EXPLANATION-START id=function:calculate_qt_series

**What this does.** Computes the corrected cone resistance qt for every row of a CPTU series. It returns nothing when there are no pore-pressure readings or no cone area ratio, warns and returns nothing when the two arrays are different lengths, and otherwise returns qt per row, leaving a row empty wherever qc or u2 is missing.

**Why it is here.** qt is only defined when both the pore pressure and the cone's area ratio are known, and the docstring is emphatic that a missing area ratio is never filled with a default: the wrong value would quietly corrupt qt and every Robertson normalisation that consumes it, so the function hands back nothing and forces the caller to handle the absence rather than receive fabricated data. The length check catches a mismatched pair loudly instead of silently pairing the wrong rows.

.. CG-EXPLANATION-END id=function:calculate_qt_series

