groundmodel.domain.services.representative_statistic
====================================================

.. CG-PAGE source=src/groundmodel/domain/services/representative_statistic.py complete=true

*Source file:* ``src/groundmodel/domain/services/representative_statistic.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-46

.. literalinclude:: ../../../src/groundmodel/domain/services/representative_statistic.py
   :language: python
   :lines: 1-46
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Introduces the one place a run of cone-resistance readings is reduced to a single representative value, and names the four allowed statistics (median, arithmetic, harmonic, geometric) and the default (median). It imports the standard statistics library.

**Why it is here.** Owner ruling 7 makes the statistic selectable per geotech model, because the four are ordered — harmonic at or below geometric at or below arithmetic for the same positive readings — so the choice systematically shifts the packing class, with harmonic the conservative one weighted toward the low values that govern bearing and settlement. Ruling 6 makes single-sourcing load-bearing: the band-edit warning must be computed with the same statistic the classifier reads, or it would predict a reclassification that does not happen, so the classifier and the band-edit planners both call this one function rather than a local median. A zero reading is a valid loosest-class value, kept as such.

.. CG-EXPLANATION-END id=module-header

Function ``def representative_qc``
----------------------------------

.. CG-BLOCK id=function:representative_qc lines=47-86

.. literalinclude:: ../../../src/groundmodel/domain/services/representative_statistic.py
   :language: python
   :lines: 47-86
   :lineno-match:

.. CG-EXPLANATION-START id=function:representative_qc

**What this does.** Reduces a series of cone-resistance readings to its representative value under the chosen statistic — median, arithmetic mean, harmonic mean, or geometric mean — and raises an error on any unknown statistic name.

**Why it is here.** This is the single reduction every NAD reader goes through, so the classifier and the band-edit warning can never disagree about the number. A zero in the series comes back as zero under the harmonic and geometric choices — the conservative loosest-class answer, and a guard is added for the geometric case because its library function would otherwise raise on a zero. An unknown statistic is a programming error, surfaced loudly rather than silently defaulted.

.. CG-EXPLANATION-END id=function:representative_qc

