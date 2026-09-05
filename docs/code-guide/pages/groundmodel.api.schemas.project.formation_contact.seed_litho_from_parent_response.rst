groundmodel.api.schemas.project.formation_contact.seed_litho_from_parent_response
=================================================================================

.. CG-PAGE source=src/groundmodel/api/schemas/project/formation_contact/seed_litho_from_parent_response.py complete=true

*Source file:* ``src/groundmodel/api/schemas/project/formation_contact/seed_litho_from_parent_response.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-11

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/formation_contact/seed_litho_from_parent_response.py
   :language: python
   :lines: 1-11
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The docstring and imports (``UUID``, Pydantic ``BaseModel``, the cross-section response).

**Why it is here.** A *response schema* is the shape the API returns to the desktop, kept separate from the database row so internal storage can change without breaking the web contract; new fields are additive (default to optional/null) per the API contract in ``docs/api.md``.

.. CG-EXPLANATION-END id=module-header

Class ``SeedLithoFromParentResponse``
-------------------------------------

.. CG-BLOCK id=class:SeedLithoFromParentResponse lines=12-32

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/formation_contact/seed_litho_from_parent_response.py
   :language: python
   :lines: 12-32
   :lineno-match:

.. CG-EXPLANATION-START id=class:SeedLithoFromParentResponse

**What this does.** The result: the created contact ids, a skipped-existing count (idempotency), and the optional updated section row.

**Why it is here.** The docstring records the section is echoed only when a section id was given, so the desktop patches its local state without a second request. A *response schema* is the shape the API returns to the desktop, kept separate from the database row so internal storage can change without breaking the web contract; new fields are additive (default to optional/null) per the API contract in ``docs/api.md``.

.. CG-EXPLANATION-END id=class:SeedLithoFromParentResponse

