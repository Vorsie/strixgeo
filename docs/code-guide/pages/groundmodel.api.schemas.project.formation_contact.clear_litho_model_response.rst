groundmodel.api.schemas.project.formation_contact.clear_litho_model_response
============================================================================

.. CG-PAGE source=src/groundmodel/api/schemas/project/formation_contact/clear_litho_model_response.py complete=true

*Source file:* ``src/groundmodel/api/schemas/project/formation_contact/clear_litho_model_response.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-7

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/formation_contact/clear_litho_model_response.py
   :language: python
   :lines: 1-7
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The docstring and the single Pydantic import.

**Why it is here.** A *response schema* is the shape the API returns to the desktop, kept separate from the database row so internal storage can change without breaking the web contract; new fields are additive (default to optional/null) per the API contract in ``docs/api.md``.

.. CG-EXPLANATION-END id=module-header

Class ``ClearLithoModelResponse``
---------------------------------

.. CG-BLOCK id=class:ClearLithoModelResponse lines=8-32

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/formation_contact/clear_litho_model_response.py
   :language: python
   :lines: 8-32
   :lineno-match:

.. CG-EXPLANATION-START id=class:ClearLithoModelResponse

**What this does.** Four per-table deletion counts (contacts, edges, surfaces, formations) from clearing a litho model.

**Why it is here.** The docstring records that the operation is irreversible, so no id list is returned (nothing to undo via the API); the counts make the toast meaningful, and shared formations are excluded from the formation count (orphan-safe). A *response schema* is the shape the API returns to the desktop, kept separate from the database row so internal storage can change without breaking the web contract; new fields are additive (default to optional/null) per the API contract in ``docs/api.md``.

.. CG-EXPLANATION-END id=class:ClearLithoModelResponse

