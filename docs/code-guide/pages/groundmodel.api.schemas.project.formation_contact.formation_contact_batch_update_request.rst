groundmodel.api.schemas.project.formation_contact.formation_contact_batch_update_request
========================================================================================

.. CG-PAGE source=src/groundmodel/api/schemas/project/formation_contact/formation_contact_batch_update_request.py complete=true

*Source file:* ``src/groundmodel/api/schemas/project/formation_contact/formation_contact_batch_update_request.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-11

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/formation_contact/formation_contact_batch_update_request.py
   :language: python
   :lines: 1-11
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The docstring and imports (Pydantic ``Field``, the strict base, the batch entry).

**Why it is here.** A *request schema* declares and validates what the desktop may send; it inherits ``StrictRequestModel``, which rejects unknown fields and non-finite numbers so a client typo fails loudly with a 422 instead of silently writing junk.

.. CG-EXPLANATION-END id=module-header

Class ``FormationContactBatchUpdateRequest``
--------------------------------------------

.. CG-BLOCK id=class:FormationContactBatchUpdateRequest lines=12-24

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/formation_contact/formation_contact_batch_update_request.py
   :language: python
   :lines: 12-24
   :lineno-match:

.. CG-EXPLANATION-START id=class:FormationContactBatchUpdateRequest

**What this does.** The batch body: a list of update entries, at least one and at most 500.

**Why it is here.** The docstring records it is all-or-nothing (one transaction, so a failure on entry N rolls back the first N−1); the minimum rejects a no-op call and the maximum keeps one transaction bounded. A *request schema* declares and validates what the desktop may send; it inherits ``StrictRequestModel``, which rejects unknown fields and non-finite numbers so a client typo fails loudly with a 422 instead of silently writing junk.

.. CG-EXPLANATION-END id=class:FormationContactBatchUpdateRequest

