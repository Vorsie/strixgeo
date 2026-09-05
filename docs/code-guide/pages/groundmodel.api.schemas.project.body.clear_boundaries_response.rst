groundmodel.api.schemas.project.body.clear_boundaries_response
==============================================================

.. CG-PAGE source=src/groundmodel/api/schemas/project/body/clear_boundaries_response.py complete=true

*Source file:* ``src/groundmodel/api/schemas/project/body/clear_boundaries_response.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-7

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/body/clear_boundaries_response.py
   :language: python
   :lines: 1-7
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The docstring and the single Pydantic import.

**Why it is here.** A *response schema* is the shape the API returns to the desktop, kept separate from the database row so internal storage can change without breaking the web contract; new fields are additive (default to optional/null) per the API contract in ``docs/api.md``.

.. CG-EXPLANATION-END id=module-header

Class ``ClearBoundariesResponse``
---------------------------------

.. CG-BLOCK id=class:ClearBoundariesResponse lines=8-23

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/body/clear_boundaries_response.py
   :language: python
   :lines: 8-23
   :lineno-match:

.. CG-EXPLANATION-START id=class:ClearBoundariesResponse

**What this does.** One count, ``shapes_deleted`` — how many hand-drawn boundary shapes the bulk "Reset manual points" removed.

**Why it is here.** The docstring notes the control nodes are dropped by the database cascade and not counted separately; the count is what the desktop toast reports. A *response schema* is the shape the API returns to the desktop, kept separate from the database row so internal storage can change without breaking the web contract; new fields are additive (default to optional/null) per the API contract in ``docs/api.md``.

.. CG-EXPLANATION-END id=class:ClearBoundariesResponse

