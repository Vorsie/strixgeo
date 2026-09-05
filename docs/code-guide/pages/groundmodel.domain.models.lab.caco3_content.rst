groundmodel.domain.models.lab.caco3_content
===========================================

.. CG-PAGE source=src/groundmodel/domain/models/lab/caco3_content.py complete=true

*Source file:* ``src/groundmodel/domain/models/lab/caco3_content.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-8

.. literalinclude:: ../../../src/groundmodel/domain/models/lab/caco3_content.py
   :language: python
   :lines: 1-8
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The description line and the toolbox: ``dataclass``, ``date``, and ``LabTest``.

**Why it is here.** ``LabTest`` is imported so ``CaCO3Content`` inherits the shared ``sample_id`` and ``id``.

.. CG-EXPLANATION-END id=module-header

Class ``CaCO3Content`` — header
-------------------------------

.. CG-BLOCK id=class:CaCO3Content lines=9-42

.. literalinclude:: ../../../src/groundmodel/domain/models/lab/caco3_content.py
   :language: python
   :lines: 9-42
   :lineno-match:

.. CG-EXPLANATION-START id=class:CaCO3Content

**What this does.** Defines ``CaCO3Content`` (a ``LabTest``): the calcium-carbonate (lime) content of a sample as a percentage of dry mass, with its method and date.

**Why it is here.** Often called 'lime content' in practice. The docstring draws a sharp line the code depends on: this is a *measurement* of how much lime a sample contains, quite different from ``GrainSize.lime_removed``, which is a yes/no flag saying whether lime was chemically stripped out *before* a grain-size test. Confusing the two would mix a measurement with a lab procedure.

.. CG-EXPLANATION-END id=class:CaCO3Content

Method ``CaCO3Content``. ``def __post_init__``
----------------------------------------------

.. CG-BLOCK id=method:CaCO3Content.__post_init__ lines=43-45

.. literalinclude:: ../../../src/groundmodel/domain/models/lab/caco3_content.py
   :language: python
   :lines: 43-45
   :lineno-match:

.. CG-EXPLANATION-START id=method:CaCO3Content.__post_init__

**What this does.** Checks that the content, when present, lies within 0–100 %, raising ``ValueError`` otherwise.

**Why it is here.** A single-field range guard — a percentage of dry mass cannot sit outside 0–100.

.. CG-EXPLANATION-END id=method:CaCO3Content.__post_init__

