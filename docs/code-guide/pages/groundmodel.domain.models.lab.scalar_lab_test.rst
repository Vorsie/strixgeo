groundmodel.domain.models.lab.scalar_lab_test
=============================================

.. CG-PAGE source=src/groundmodel/domain/models/lab/scalar_lab_test.py complete=true

*Source file:* ``src/groundmodel/domain/models/lab/scalar_lab_test.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-29

.. literalinclude:: ../../../src/groundmodel/domain/models/lab/scalar_lab_test.py
   :language: python
   :lines: 1-29
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** A long module docstring plus the toolbox (``dataclass``, ``date``, ``LabTest``). The docstring explains that this is the *catch-all* family for DOV scalar lab results that do not fit a typed family, and describes how a result string is read as a number first and kept as text only when it is not numeric — for example the ASTM soil-classification codes ``CL`` / ``SP`` / ``GW``.

**Why it is here.** The docstring records the design rule from CLAUDE.md's domain model: ``ScalarLabTest`` is the default home for any new scalar parameter (grain density, pH, mineralogy, ...), so adding one is a single lookup entry with no database migration. A *migration* is a scripted change to the database's shape; avoiding one is the whole point of the catch-all. A parameter is *promoted* to its own typed family only when it needs structural columns a tuple cannot express, or a first-class validation rule.

.. CG-EXPLANATION-END id=module-header

Class ``ScalarLabTest``
-----------------------

.. CG-BLOCK id=class:ScalarLabTest lines=30-72

.. literalinclude:: ../../../src/groundmodel/domain/models/lab/scalar_lab_test.py
   :language: python
   :lines: 30-72
   :lineno-match:

.. CG-EXPLANATION-START id=class:ScalarLabTest

**What this does.** Defines ``ScalarLabTest`` (a ``LabTest``): a single measurement as a ``(parameter_group, parameter, value)`` tuple, where the value is held as ``value_numeric`` when it is a number and ``value_text`` when it is not, plus the unit, method, date, and DOV's ``detection_condition`` code (its 'not measurable' marker).

**Why it is here.** This is the catch-all made concrete. Every source token — group, parameter, unit, method, detection condition — is stored verbatim (even DOV's doubled ``parameter (parameter)`` spelling), because translating or normalising them is a presentation concern, not an ingest one. Keeping both a numeric and a text slot lets one shape hold both a grain density (a number) and an ASTM class (a short code) with no special case per parameter.

.. CG-EXPLANATION-END id=class:ScalarLabTest

