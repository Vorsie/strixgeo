groundmodel.api.schemas.project.formation_contact.seed_litho_from_parent_request
================================================================================

.. CG-PAGE source=src/groundmodel/api/schemas/project/formation_contact/seed_litho_from_parent_request.py complete=true

*Source file:* ``src/groundmodel/api/schemas/project/formation_contact/seed_litho_from_parent_request.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-11

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/formation_contact/seed_litho_from_parent_request.py
   :language: python
   :lines: 1-11
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The docstring and imports (``UUID``, Pydantic ``Field``, the strict base).

**Why it is here.** A *request schema* declares and validates what the desktop may send; it inherits ``StrictRequestModel``, which rejects unknown fields and non-finite numbers so a client typo fails loudly with a 422 instead of silently writing junk.

.. CG-EXPLANATION-END id=module-header

Class ``SeedLithoFromParentRequest``
------------------------------------

.. CG-BLOCK id=class:SeedLithoFromParentRequest lines=12-36

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/formation_contact/seed_litho_from_parent_request.py
   :language: python
   :lines: 12-36
   :lineno-match:

.. CG-EXPLANATION-START id=class:SeedLithoFromParentRequest

**What this does.** The request: the in-corridor borehole ids to copy contacts for, and an optional section id.

**Why it is here.** The docstring records that an empty list returns immediately with nothing created, and that passing a section id makes the endpoint union the created and found contacts into that section's seeded set — the explicit-content invariant. A *request schema* declares and validates what the desktop may send; it inherits ``StrictRequestModel``, which rejects unknown fields and non-finite numbers so a client typo fails loudly with a 422 instead of silently writing junk.

.. CG-EXPLANATION-END id=class:SeedLithoFromParentRequest

