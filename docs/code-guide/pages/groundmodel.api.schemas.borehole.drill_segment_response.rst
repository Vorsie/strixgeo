groundmodel.api.schemas.borehole.drill_segment_response
=======================================================

.. CG-PAGE source=src/groundmodel/api/schemas/borehole/drill_segment_response.py complete=true

*Source file:* ``src/groundmodel/api/schemas/borehole/drill_segment_response.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-7

.. literalinclude:: ../../../src/groundmodel/api/schemas/borehole/drill_segment_response.py
   :language: python
   :lines: 1-7
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** A one-line docstring and the UUID/BaseModel/ConfigDict imports.

**Why it is here.** The response-schema pattern for one drilling interval.

.. CG-EXPLANATION-END id=module-header

Class ``DrillSegmentResponse``
------------------------------

.. CG-BLOCK id=class:DrillSegmentResponse lines=8-16

.. literalinclude:: ../../../src/groundmodel/api/schemas/borehole/drill_segment_response.py
   :language: python
   :lines: 8-16
   :lineno-match:

.. CG-EXPLANATION-START id=class:DrillSegmentResponse

**What this does.** One drilling interval: id, top and base depth in metres, and the method (which may be empty).

**Why it is here.** A minimal shape carrying just the depth interval and the technique used over it, read straight off the row.

.. CG-EXPLANATION-END id=class:DrillSegmentResponse

