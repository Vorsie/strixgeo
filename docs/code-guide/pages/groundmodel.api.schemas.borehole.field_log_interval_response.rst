groundmodel.api.schemas.borehole.field_log_interval_response
============================================================

.. CG-PAGE source=src/groundmodel/api/schemas/borehole/field_log_interval_response.py complete=true

*Source file:* ``src/groundmodel/api/schemas/borehole/field_log_interval_response.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-7

.. literalinclude:: ../../../src/groundmodel/api/schemas/borehole/field_log_interval_response.py
   :language: python
   :lines: 1-7
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** A one-line docstring and the UUID/BaseModel/ConfigDict imports.

**Why it is here.** The response-schema pattern for one field-log observation.

.. CG-EXPLANATION-END id=module-header

Class ``FieldLogIntervalResponse``
----------------------------------

.. CG-BLOCK id=class:FieldLogIntervalResponse lines=8-17

.. literalinclude:: ../../../src/groundmodel/api/schemas/borehole/field_log_interval_response.py
   :language: python
   :lines: 8-17
   :lineno-match:

.. CG-EXPLANATION-START id=class:FieldLogIntervalResponse

**What this does.** One depth interval of a field-log observation: id, top and base, the observation ``kind`` (colour, moisture, consistency, ...), and its value.

**Why it is here.** It keeps the kind as a raw token so the desktop decides how to display each observation type; read straight off the row.

.. CG-EXPLANATION-END id=class:FieldLogIntervalResponse

