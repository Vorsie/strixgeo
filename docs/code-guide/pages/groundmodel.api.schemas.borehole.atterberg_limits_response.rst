groundmodel.api.schemas.borehole.atterberg_limits_response
==========================================================

.. CG-PAGE source=src/groundmodel/api/schemas/borehole/atterberg_limits_response.py complete=true

*Source file:* ``src/groundmodel/api/schemas/borehole/atterberg_limits_response.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-8

.. literalinclude:: ../../../src/groundmodel/api/schemas/borehole/atterberg_limits_response.py
   :language: python
   :lines: 1-8
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** A one-line docstring and imports of ``date``, ``UUID``, ``BaseModel``, and ``ConfigDict``.

**Why it is here.** The same response-schema pattern introduced on the admixture page; a ``UUID`` is the long unique identifier a row carries, and ``date`` types the test date.

.. CG-EXPLANATION-END id=module-header

Class ``AtterbergLimitsResponse``
---------------------------------

.. CG-BLOCK id=class:AtterbergLimitsResponse lines=9-31

.. literalinclude:: ../../../src/groundmodel/api/schemas/borehole/atterberg_limits_response.py
   :language: python
   :lines: 9-31
   :lineno-match:

.. CG-EXPLANATION-START id=class:AtterbergLimitsResponse

**What this does.** The liquid limit, plastic limit, non-plastic flag, method, and test date for one sample, each allowed to be empty, plus the row id. Reads off the row via ``from_attributes``.

**Why it is here.** The docstring records a data-integrity choice: the plasticity index is NOT a field, because it is simply liquid minus plastic and storing it would risk drift after an edit — clients compute it when both parts are present (derived on read, Data Integrity Rule 1). ``non_plastic`` is the import's interpretation of a sample that cannot be rolled into a thread.

.. CG-EXPLANATION-END id=class:AtterbergLimitsResponse

