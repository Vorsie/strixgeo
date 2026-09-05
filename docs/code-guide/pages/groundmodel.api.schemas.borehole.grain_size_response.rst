groundmodel.api.schemas.borehole.grain_size_response
====================================================

.. CG-PAGE source=src/groundmodel/api/schemas/borehole/grain_size_response.py complete=true

*Source file:* ``src/groundmodel/api/schemas/borehole/grain_size_response.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-8

.. literalinclude:: ../../../src/groundmodel/api/schemas/borehole/grain_size_response.py
   :language: python
   :lines: 1-8
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** A one-line docstring and the date/UUID/BaseModel/ConfigDict imports.

**Why it is here.** The response-schema pattern for the grain-size lab family.

.. CG-EXPLANATION-END id=module-header

Class ``GrainSizeResponse``
---------------------------

.. CG-BLOCK id=class:GrainSizeResponse lines=9-30

.. literalinclude:: ../../../src/groundmodel/api/schemas/borehole/grain_size_response.py
   :language: python
   :lines: 9-30
   :lineno-match:

.. CG-EXPLANATION-START id=class:GrainSizeResponse

**What this does.** One grain-size curve for a sample: two parallel arrays (diameters and the percentage larger than each), the method, the test date, and two pre-treatment flags. Reads off the row.

**Why it is here.** The two arrays are parallel and in ascending-diameter order, so index i in one lines up with index i in the other. The docstring keeps the method as the raw DOV token (translated at display) and stresses that the ``lime_removed`` / ``organics_removed`` flags are pre-treatment markers, not measurements of lime or organic content (Data Integrity Rule 3).

.. CG-EXPLANATION-END id=class:GrainSizeResponse

