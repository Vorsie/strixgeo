groundmodel.api.schemas.project.formation_contact.formation_contact_update_request
==================================================================================

.. CG-PAGE source=src/groundmodel/api/schemas/project/formation_contact/formation_contact_update_request.py complete=true

*Source file:* ``src/groundmodel/api/schemas/project/formation_contact/formation_contact_update_request.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-13

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/formation_contact/formation_contact_update_request.py
   :language: python
   :lines: 1-13
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The docstring and imports (``UUID``, Pydantic ``model_validator``, the strict base, the contact enums).

**Why it is here.** A *request schema* declares and validates what the desktop may send; it inherits ``StrictRequestModel``, which rejects unknown fields and non-finite numbers so a client typo fails loudly with a 422 instead of silently writing junk.

.. CG-EXPLANATION-END id=module-header

Class ``FormationContactUpdateRequest`` — header
------------------------------------------------

.. CG-BLOCK id=class:FormationContactUpdateRequest lines=14-33

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/formation_contact/formation_contact_update_request.py
   :language: python
   :lines: 14-33
   :lineno-match:

.. CG-EXPLANATION-START id=class:FormationContactUpdateRequest

**What this does.** The partial-update request: every field optional, including the anchor, so the editor can drag-re-anchor a contact onto another investigation without deleting and recreating it.

**Why it is here.** The docstring records the anchor rule: to keep exactly-one-anchor safe on a partial update, both anchor fields must be sent together when either is touched (see the check below). A *request schema* declares and validates what the desktop may send; it inherits ``StrictRequestModel``, which rejects unknown fields and non-finite numbers so a client typo fails loudly with a 422 instead of silently writing junk.

.. CG-EXPLANATION-END id=class:FormationContactUpdateRequest

Method ``FormationContactUpdateRequest``. ``def _xor_when_anchor_touched``
--------------------------------------------------------------------------

.. CG-BLOCK id=method:FormationContactUpdateRequest._xor_when_anchor_touched lines=34-61

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/formation_contact/formation_contact_update_request.py
   :language: python
   :lines: 34-61
   :lineno-match:

.. CG-EXPLANATION-START id=method:FormationContactUpdateRequest._xor_when_anchor_touched

**What this does.** A whole-object check on the anchor pair: if neither anchor field is in the body it is left alone; if exactly one is present it is rejected; if both are present exactly one must be non-null.

**Why it is here.** The docstring lays out all three rules — it keeps the exactly-one-anchor invariant true across partial updates, rejecting an ambiguous half-update with a clear 422.

.. CG-EXPLANATION-END id=method:FormationContactUpdateRequest._xor_when_anchor_touched

