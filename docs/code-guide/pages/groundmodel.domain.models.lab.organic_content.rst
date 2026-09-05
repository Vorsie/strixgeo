groundmodel.domain.models.lab.organic_content
=============================================

.. CG-PAGE source=src/groundmodel/domain/models/lab/organic_content.py complete=true

*Source file:* ``src/groundmodel/domain/models/lab/organic_content.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-8

.. literalinclude:: ../../../src/groundmodel/domain/models/lab/organic_content.py
   :language: python
   :lines: 1-8
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The description line and the toolbox: ``dataclass``, ``date``, and ``LabTest``.

**Why it is here.** ``LabTest`` is imported so ``OrganicContent`` inherits the shared ``sample_id`` and ``id``.

.. CG-EXPLANATION-END id=module-header

Class ``OrganicContent`` — header
---------------------------------

.. CG-BLOCK id=class:OrganicContent lines=9-66

.. literalinclude:: ../../../src/groundmodel/domain/models/lab/organic_content.py
   :language: python
   :lines: 9-66
   :lineno-match:

.. CG-EXPLANATION-START id=class:OrganicContent

**What this does.** Defines ``OrganicContent`` (a ``LabTest``): two independent measurements — organic carbon (``carbon_pct``) and organic matter (``matter_pct``), each a percentage of dry mass — plus method and date.

**Why it is here.** These are two different things measured by two different methods (carbon by combustion or oxidation; matter by burning the sample and weighing what disappears), and they are stored as *independent* fields on purpose. This is CLAUDE.md Data-Integrity rule 3: the textbook conversion ``OM ≈ 1.724 × OC`` is empirical and varies with soil type, so deriving one from the other would fabricate data the consumer could not tell from a real reading. If a lab reported only carbon, matter stays empty.

.. CG-EXPLANATION-END id=class:OrganicContent

Method ``OrganicContent``. ``def __post_init__``
------------------------------------------------

.. CG-BLOCK id=method:OrganicContent.__post_init__ lines=67-71

.. literalinclude:: ../../../src/groundmodel/domain/models/lab/organic_content.py
   :language: python
   :lines: 67-71
   :lineno-match:

.. CG-EXPLANATION-START id=method:OrganicContent.__post_init__

**What this does.** Checks that each of the carbon and matter percentages, when present, lies within 0–100 %, raising ``ValueError`` otherwise.

**Why it is here.** Two single-field range guards — each is a percentage of dry mass.

.. CG-EXPLANATION-END id=method:OrganicContent.__post_init__

