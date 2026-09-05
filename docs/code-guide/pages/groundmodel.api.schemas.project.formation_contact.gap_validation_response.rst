groundmodel.api.schemas.project.formation_contact.gap_validation_response
=========================================================================

.. CG-PAGE source=src/groundmodel/api/schemas/project/formation_contact/gap_validation_response.py complete=true

*Source file:* ``src/groundmodel/api/schemas/project/formation_contact/gap_validation_response.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-11

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/formation_contact/gap_validation_response.py
   :language: python
   :lines: 1-11
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The docstring and imports (``UUID``, Pydantic pieces, the gap-issue item).

**Why it is here.** A *response schema* is the shape the API returns to the desktop, kept separate from the database row so internal storage can change without breaking the web contract; new fields are additive (default to optional/null) per the API contract in ``docs/api.md``.

.. CG-EXPLANATION-END id=module-header

Class ``GapValidationResponse``
-------------------------------

.. CG-BLOCK id=class:GapValidationResponse lines=12-22

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/formation_contact/gap_validation_response.py
   :language: python
   :lines: 12-22
   :lineno-match:

.. CG-EXPLANATION-START id=class:GapValidationResponse

**What this does.** The model id, the borehole id, and a list of gap issues.

**Why it is here.** The docstring records that an empty list means the contacts form a clean contiguous stratigraphy; any issue is a soft warning the editor may or may not block save on. A *response schema* is the shape the API returns to the desktop, kept separate from the database row so internal storage can change without breaking the web contract; new fields are additive (default to optional/null) per the API contract in ``docs/api.md``.

.. CG-EXPLANATION-END id=class:GapValidationResponse

