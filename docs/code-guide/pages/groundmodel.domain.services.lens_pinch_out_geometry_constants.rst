groundmodel.domain.services.lens_pinch_out_geometry_constants
=============================================================

.. CG-PAGE source=src/groundmodel/domain/services/lens_pinch_out_geometry_constants.py complete=true

*Source file:* ``src/groundmodel/domain/services/lens_pinch_out_geometry_constants.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-34

.. literalinclude:: ../../../src/groundmodel/domain/services/lens_pinch_out_geometry_constants.py
   :language: python
   :lines: 1-34
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Holds the two small thresholds the wedge-tip geometry needs:
the minimum along-section distance between two contacts for a dip to be
trustworthy (one millimetre), and the minimum gradient difference below which two
surfaces are treated as parallel (a billionth of a metre per metre).

**Why it is here.** The same project convention applies — constants live beside
their code, importable and override-able in tests without monkey-patching the
service. The comments explain both values as protection against the arithmetic:
dividing by a near-zero along-distance produces enormous, unstable slopes, and
two surfaces with almost-equal slopes meet only at a practically infinite
distance, so the code refuses rather than compute a meaningless crossing. Real
contacts projected from one anchor cannot legitimately sit closer than a
millimetre apart, so anything below that is treated as a duplicate.

.. CG-EXPLANATION-END id=module-header

