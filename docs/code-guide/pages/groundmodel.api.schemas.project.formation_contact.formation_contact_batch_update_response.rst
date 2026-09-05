groundmodel.api.schemas.project.formation_contact.formation_contact_batch_update_response
=========================================================================================

.. CG-PAGE source=src/groundmodel/api/schemas/project/formation_contact/formation_contact_batch_update_response.py complete=true

*Source file:* ``src/groundmodel/api/schemas/project/formation_contact/formation_contact_batch_update_response.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-9

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/formation_contact/formation_contact_batch_update_response.py
   :language: python
   :lines: 1-9
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The docstring and the import of the single contact response.

**Why it is here.** A *response schema* is the shape the API returns to the desktop, kept separate from the database row so internal storage can change without breaking the web contract; new fields are additive (default to optional/null) per the API contract in ``docs/api.md``.

.. CG-EXPLANATION-END id=module-header

Class ``FormationContactBatchUpdateResponse``
---------------------------------------------

.. CG-BLOCK id=class:FormationContactBatchUpdateResponse lines=10-15

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/formation_contact/formation_contact_batch_update_response.py
   :language: python
   :lines: 10-15
   :lineno-match:

.. CG-EXPLANATION-START id=class:FormationContactBatchUpdateResponse

**What this does.** The updated contacts, returned in the same order as the input.

**Why it is here.** The docstring records the order is preserved so the client can patch its local state by index. A *response schema* is the shape the API returns to the desktop, kept separate from the database row so internal storage can change without breaking the web contract; new fields are additive (default to optional/null) per the API contract in ``docs/api.md``.

.. CG-EXPLANATION-END id=class:FormationContactBatchUpdateResponse

