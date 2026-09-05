groundmodel.api.schemas.project.formation_contact.deduplicate_contacts_response
===============================================================================

.. CG-PAGE source=src/groundmodel/api/schemas/project/formation_contact/deduplicate_contacts_response.py complete=true

*Source file:* ``src/groundmodel/api/schemas/project/formation_contact/deduplicate_contacts_response.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-9

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/formation_contact/deduplicate_contacts_response.py
   :language: python
   :lines: 1-9
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The docstring and imports (``UUID``, Pydantic ``BaseModel``).

**Why it is here.** A *response schema* is the shape the API returns to the desktop, kept separate from the database row so internal storage can change without breaking the web contract; new fields are additive (default to optional/null) per the API contract in ``docs/api.md``.

.. CG-EXPLANATION-END id=module-header

Class ``DeduplicateContactsResponse``
-------------------------------------

.. CG-BLOCK id=class:DeduplicateContactsResponse lines=10-20

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/formation_contact/deduplicate_contacts_response.py
   :language: python
   :lines: 10-20
   :lineno-match:

.. CG-EXPLANATION-START id=class:DeduplicateContactsResponse

**What this does.** The count of inspected groups, the count of removed duplicates, and their ids.

**Why it is here.** The docstring records that the ids are returned so the toast is meaningful and a future undo could re-create the deleted rows. A *response schema* is the shape the API returns to the desktop, kept separate from the database row so internal storage can change without breaking the web contract; new fields are additive (default to optional/null) per the API contract in ``docs/api.md``.

.. CG-EXPLANATION-END id=class:DeduplicateContactsResponse

