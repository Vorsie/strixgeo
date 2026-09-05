groundmodel.domain.models.lab.water_content
===========================================

.. CG-PAGE source=src/groundmodel/domain/models/lab/water_content.py complete=true

*Source file:* ``src/groundmodel/domain/models/lab/water_content.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-8

.. literalinclude:: ../../../src/groundmodel/domain/models/lab/water_content.py
   :language: python
   :lines: 1-8
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The description line and the toolbox: ``dataclass``, ``date``, and ``LabTest``.

**Why it is here.** ``LabTest`` is imported so ``WaterContent`` inherits the shared ``sample_id`` and ``id``.

.. CG-EXPLANATION-END id=module-header

Class ``WaterContent`` — header
-------------------------------

.. CG-BLOCK id=class:WaterContent lines=9-43

.. literalinclude:: ../../../src/groundmodel/domain/models/lab/water_content.py
   :language: python
   :lines: 9-43
   :lineno-match:

.. CG-EXPLANATION-START id=class:WaterContent

**What this does.** Defines ``WaterContent`` (a ``LabTest``): moisture content as a percentage of dry mass, plus method and date.

**Why it is here.** The validation ceiling is 1000 %, not 100 %, because water content is measured against *dry* mass — an organic soil, peat, or quick clay can hold far more water than its dry solids weigh, so a reading above 100 % is genuine, not an error. Only clearly non-physical values are rejected.

.. CG-EXPLANATION-END id=class:WaterContent

Method ``WaterContent``. ``def __post_init__``
----------------------------------------------

.. CG-BLOCK id=method:WaterContent.__post_init__ lines=44-46

.. literalinclude:: ../../../src/groundmodel/domain/models/lab/water_content.py
   :language: python
   :lines: 44-46
   :lineno-match:

.. CG-EXPLANATION-START id=method:WaterContent.__post_init__

**What this does.** Checks that the content, when present, lies within 0–1000 %, raising ``ValueError`` otherwise.

**Why it is here.** A single-field range guard with the wide upper bound the docstring explains.

.. CG-EXPLANATION-END id=method:WaterContent.__post_init__

