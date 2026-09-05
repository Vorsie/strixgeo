groundmodel.api.schemas.project.geotech_suggestion.clear_geotech_column_request
===============================================================================

.. CG-PAGE source=src/groundmodel/api/schemas/project/geotech_suggestion/clear_geotech_column_request.py complete=true

*Source file:* ``src/groundmodel/api/schemas/project/geotech_suggestion/clear_geotech_column_request.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-11

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/geotech_suggestion/clear_geotech_column_request.py
   :language: python
   :lines: 1-11
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Names the file and imports ``UUID``, ``Field``, ``BaseModel``, and the strict base.

**Why it is here.** This file holds a request and its response together; the request uses the strict base.

.. CG-EXPLANATION-END id=module-header

Class ``ClearGeotechColumnRequest``
-----------------------------------

.. CG-BLOCK id=class:ClearGeotechColumnRequest lines=12-24

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/geotech_suggestion/clear_geotech_column_request.py
   :language: python
   :lines: 12-24
   :lineno-match:

.. CG-EXPLANATION-START id=class:ClearGeotechColumnRequest

**What this does.** The body to clear one investigation's geotech bands: the CPT or borehole id.

**Why it is here.** The docstring notes the ties cascade and no tombstones are written, because this is rebuild preparation (owner ask 2026-08-18).

.. CG-EXPLANATION-END id=class:ClearGeotechColumnRequest

Class ``ClearGeotechColumnResponse``
------------------------------------

.. CG-BLOCK id=class:ClearGeotechColumnResponse lines=25-40

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/geotech_suggestion/clear_geotech_column_request.py
   :language: python
   :lines: 25-40
   :lineno-match:

.. CG-EXPLANATION-START id=class:ClearGeotechColumnResponse

**What this does.** The result of a clear: the model, the cleared investigation, and how many band rows were deleted.

**Why it is here.** A count of zero is a valid idempotent no-op (the column carried no bands), which the caller can report plainly.

.. CG-EXPLANATION-END id=class:ClearGeotechColumnResponse

