groundmodel.api.schemas.project.formation_contact.crossing_validation_response
==============================================================================

.. CG-PAGE source=src/groundmodel/api/schemas/project/formation_contact/crossing_validation_response.py complete=true

*Source file:* ``src/groundmodel/api/schemas/project/formation_contact/crossing_validation_response.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-11

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/formation_contact/crossing_validation_response.py
   :language: python
   :lines: 1-11
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The docstring and imports (``UUID``, Pydantic ``BaseModel`` and ``Field``, the gap-issue item).

**Why it is here.** A *response schema* is the shape the API returns to the desktop, kept separate from the database row so internal storage can change without breaking the web contract; new fields are additive (default to optional/null) per the API contract in ``docs/api.md``.

.. CG-EXPLANATION-END id=module-header

Class ``CrossingValidationResponse``
------------------------------------

.. CG-BLOCK id=class:CrossingValidationResponse lines=12-22

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/formation_contact/crossing_validation_response.py
   :language: python
   :lines: 12-22
   :lineno-match:

.. CG-EXPLANATION-START id=class:CrossingValidationResponse

**What this does.** The model id plus a list of issues (each a gap-issue item).

**Why it is here.** The docstring records the meaning: an empty list means no two formation surfaces violate the stratigraphic-order rule; any issue is a geological warning the editor surfaces as an inline banner on the offending formation pair. A *response schema* is the shape the API returns to the desktop, kept separate from the database row so internal storage can change without breaking the web contract; new fields are additive (default to optional/null) per the API contract in ``docs/api.md``.

.. CG-EXPLANATION-END id=class:CrossingValidationResponse

