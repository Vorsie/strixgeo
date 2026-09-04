groundmodel.infrastructure.parsers.lab.dov.scalar_observation_wfs_row
=====================================================================

.. CG-PAGE source=src/groundmodel/infrastructure/parsers/lab/dov/scalar_observation_wfs_row.py complete=true

*Source file:* ``src/groundmodel/infrastructure/parsers/lab/dov/scalar_observation_wfs_row.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-19

.. literalinclude:: ../../../src/groundmodel/infrastructure/parsers/lab/dov/scalar_observation_wfs_row.py
   :language: python
   :lines: 1-19
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** A docstring explaining why scalar lab tests need no detail XML at all, then the imports for the row type.

**Why it is here.** A grain-size test is a whole curve, which lives in a detail XML — but a scalar test is a single number, and DOV puts that number and all its metadata straight on the WFS row. So the scalar client fetches nothing beyond the rectangle scan and the orchestrator maps each row directly into a stored result.

.. CG-EXPLANATION-END id=module-header

Class ``ScalarObservationWfsRow``
---------------------------------

.. CG-BLOCK id=class:ScalarObservationWfsRow lines=20-77

.. literalinclude:: ../../../src/groundmodel/infrastructure/parsers/lab/dov/scalar_observation_wfs_row.py
   :language: python
   :lines: 20-77
   :lineno-match:

.. CG-EXPLANATION-START id=class:ScalarObservationWfsRow

**What this does.** An unchangeable data-holder for one scalar lab observation from the WFS: its key and parent sample key, the parameter group and parameter, the value (as text) and its unit, the method, the test date, and a detection condition.

**Why it is here.** The value is kept as text, not a number, because DOV ships values like ``"0.000"`` and the domain type validates them after parsing. The detection condition explains why a value is blank — for example a plastic-limit test marked not-measurable means the soil could not be rolled, which the orchestrator turns into a non-plastic flag. Source-vocabulary words like the unit and method are stored as DOV sent them and translated only at the screen.

.. CG-EXPLANATION-END id=class:ScalarObservationWfsRow

