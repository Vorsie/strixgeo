groundmodel.api.schemas.project.formation_contact.formation_contact_create_request
==================================================================================

.. CG-PAGE source=src/groundmodel/api/schemas/project/formation_contact/formation_contact_create_request.py complete=true

*Source file:* ``src/groundmodel/api/schemas/project/formation_contact/formation_contact_create_request.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-13

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/formation_contact/formation_contact_create_request.py
   :language: python
   :lines: 1-13
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The docstring and imports (``UUID``, Pydantic ``model_validator``, the strict base, the contact enums).

**Why it is here.** A *request schema* declares and validates what the desktop may send; it inherits ``StrictRequestModel``, which rejects unknown fields and non-finite numbers so a client typo fails loudly with a 422 instead of silently writing junk.

.. CG-EXPLANATION-END id=module-header

Class ``FormationContactCreateRequest`` — header
------------------------------------------------

.. CG-BLOCK id=class:FormationContactCreateRequest lines=14-39

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/formation_contact/formation_contact_create_request.py
   :language: python
   :lines: 14-39
   :lineno-match:

.. CG-EXPLANATION-START id=class:FormationContactCreateRequest

**What this does.** The create request: the formation, the top depth, exactly one of a borehole or CPT anchor, the source and confidence enums (with defaults), optional observation links and notes, and an optional section id.

**Why it is here.** The docstring records that only borehole-anchored contacts are accepted in v1 (CPT anchors are reserved for Phase 5) and that passing a section id appends the new contact to that section's seeded set in the same request — the explicit-content invariant (owner directive 2026-05-17). A *request schema* declares and validates what the desktop may send; it inherits ``StrictRequestModel``, which rejects unknown fields and non-finite numbers so a client typo fails loudly with a 422 instead of silently writing junk.

.. CG-EXPLANATION-END id=class:FormationContactCreateRequest

Method ``FormationContactCreateRequest``. ``def _exactly_one_anchor``
---------------------------------------------------------------------

.. CG-BLOCK id=method:FormationContactCreateRequest._exactly_one_anchor lines=40-51

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/formation_contact/formation_contact_create_request.py
   :language: python
   :lines: 40-51
   :lineno-match:

.. CG-EXPLANATION-START id=method:FormationContactCreateRequest._exactly_one_anchor

**What this does.** A whole-object check requiring exactly one of the borehole or CPT anchor to be set.

**Why it is here.** The docstring records it mirrors the database check constraint so the client gets a clean 422 instead of an opaque insert error.

.. CG-EXPLANATION-END id=method:FormationContactCreateRequest._exactly_one_anchor

