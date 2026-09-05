groundmodel.domain.value_objects.water_depth_source
===================================================

.. CG-PAGE source=src/groundmodel/domain/value_objects/water_depth_source.py complete=true

*Source file:* ``src/groundmodel/domain/value_objects/water_depth_source.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-5

.. literalinclude:: ../../../src/groundmodel/domain/value_objects/water_depth_source.py
   :language: python
   :lines: 1-5
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The description line and one import of ``StrEnum``.

**Why it is here.** The water-depth provenance is stored in a database column, so a string-valued enum fits.

.. CG-EXPLANATION-END id=module-header

Class ``WaterDepthSource``
--------------------------

.. CG-BLOCK id=class:WaterDepthSource lines=6-32

.. literalinclude:: ../../../src/groundmodel/domain/value_objects/water_depth_source.py
   :language: python
   :lines: 6-32
   :lineno-match:

.. CG-EXPLANATION-START id=class:WaterDepthSource

**What this does.** Defines ``WaterDepthSource``, a StrEnum with two members — ``GEF`` and ``ENGINEER`` — recording where a CPT's water-table depth came from.

**Why it is here.** Same contract as ``ElevationSource``: it sits next to ``water_depth_m`` so a re-import can overwrite a file-derived water table but must never silently overwrite one the engineer typed, because the whole Ic profile is normalised against that water table. The docstring makes a deliberate point: there is no ``ASSUMED`` member — a NULL column means no record, the consumer falls back to the default depth and must label the value as ASSUMED, and an assumption is the *absence* of a record, not a third kind of record (Data-Integrity rule 1).

.. CG-EXPLANATION-END id=class:WaterDepthSource

