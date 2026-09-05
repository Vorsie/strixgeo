groundmodel.domain.models.lab.grain_size
========================================

.. CG-PAGE source=src/groundmodel/domain/models/lab/grain_size.py complete=true

*Source file:* ``src/groundmodel/domain/models/lab/grain_size.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-8

.. literalinclude:: ../../../src/groundmodel/domain/models/lab/grain_size.py
   :language: python
   :lines: 1-8
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The description line and the toolbox: ``dataclass`` / ``field``, ``date``, and ``LabTest``.

**Why it is here.** ``LabTest`` is imported so ``GrainSize`` inherits the shared ``sample_id`` and ``id``.

.. CG-EXPLANATION-END id=module-header

Class ``GrainSize`` — header
----------------------------

.. CG-BLOCK id=class:GrainSize lines=9-108

.. literalinclude:: ../../../src/groundmodel/domain/models/lab/grain_size.py
   :language: python
   :lines: 9-108
   :lineno-match:

.. CG-EXPLANATION-START id=class:GrainSize

**What this does.** Defines ``GrainSize`` (a ``LabTest``): the grain-size distribution curve, stored as two parallel lists — ``diameters_mm`` (particle sizes, strictly ascending) and ``pct_larger`` (the percentage of the sample coarser than each diameter) — plus the method, date, and two pre-treatment flags (``lime_removed``, ``organics_removed``).

**Why it is here.** The curve is stored the way DOV ships it — cumulative percentage *larger* than each diameter (``Fractie met grotere diameter``), not percentage passing — so nothing is flipped or lost at ingest; a consumer that wants percentage-passing converts it. One shape serves all five DOV methods (sieving, hydrometer, laser diffraction, pipette, sedigraph), which differ only in their size range and resolution. The two *removed* flags are procedural metadata — what was done to the sample before the test — and are carefully NOT confused with the ``CaCO3Content`` and ``OrganicContent`` measurements, which are separate tests on the same sample.

.. CG-EXPLANATION-END id=class:GrainSize

Method ``GrainSize``. ``def __post_init__``
-------------------------------------------

.. CG-BLOCK id=method:GrainSize.__post_init__ lines=109-122

.. literalinclude:: ../../../src/groundmodel/domain/models/lab/grain_size.py
   :language: python
   :lines: 109-122
   :lineno-match:

.. CG-EXPLANATION-START id=method:GrainSize.__post_init__

**What this does.** Checks three things: the two lists are the same length, every percentage is within 0–100, and the diameters strictly increase. Any failure raises ``ValueError``.

**Why it is here.** The two lists are read together by index, so a length mismatch would silently pair the wrong diameter with the wrong percentage; strictly-ascending diameters are what make the curve a curve. These are internal-consistency guards on a single test's own arrays, so they belong in the dataclass.

.. CG-EXPLANATION-END id=method:GrainSize.__post_init__

