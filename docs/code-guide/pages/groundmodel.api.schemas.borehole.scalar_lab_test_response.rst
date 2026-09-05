groundmodel.api.schemas.borehole.scalar_lab_test_response
=========================================================

.. CG-PAGE source=src/groundmodel/api/schemas/borehole/scalar_lab_test_response.py complete=true

*Source file:* ``src/groundmodel/api/schemas/borehole/scalar_lab_test_response.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-8

.. literalinclude:: ../../../src/groundmodel/api/schemas/borehole/scalar_lab_test_response.py
   :language: python
   :lines: 1-8
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** A one-line docstring and the date/UUID/BaseModel/ConfigDict imports.

**Why it is here.** The response-schema pattern for the catch-all lab family.

.. CG-EXPLANATION-END id=module-header

Class ``ScalarLabTestResponse``
-------------------------------

.. CG-BLOCK id=class:ScalarLabTestResponse lines=9-34

.. literalinclude:: ../../../src/groundmodel/api/schemas/borehole/scalar_lab_test_response.py
   :language: python
   :lines: 9-34
   :lineno-match:

.. CG-EXPLANATION-START id=class:ScalarLabTestResponse

**What this does.** A generic single-value lab measurement that does not fit the typed families: parameter group and name, a numeric value or a text value, unit, method, test date, and a detection-condition flag.

**Why it is here.** It is the catch-all for DOV scalar observations outside the five typed families, so a future parameter lands here as configuration with no schema change (the ScalarLabTest catch-all pattern). A numeric result goes in the number field and a code result in the text field; both are empty only when the row was flagged not-measurable.

.. CG-EXPLANATION-END id=class:ScalarLabTestResponse

