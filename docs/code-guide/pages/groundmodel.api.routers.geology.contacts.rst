groundmodel.api.routers.geology.contacts
========================================

.. CG-PAGE source=src/groundmodel/api/routers/geology/contacts.py complete=true

*Source file:* ``src/groundmodel/api/routers/geology/contacts.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-66

.. literalinclude:: ../../../src/groundmodel/api/routers/geology/contacts.py
   :language: python
   :lines: 1-66
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Names the file (formation-contact create/read/update/delete plus batch update) and imports the router tools, the shared scope guard, the contact request/response schemas, the application use cases for each operation, the domain result type, the database rows, the cross-section repository, and the logger. It makes a module-level logger and a bare, prefix-less router.

**Why it is here.** Same split-package pattern as the other geology sub-routers (debt #40): no prefix here, mounted under the shared geology prefix by the package ``__init__``; one module-level logger because routers are functions, not classes. A *formation contact* is one recorded depth at which a geological formation begins in one investigation — the raw picks the whole model is built from.

.. CG-EXPLANATION-END id=module-header

Function ``async def create_contact``
-------------------------------------

.. CG-BLOCK id=function:create_contact lines=67-178

.. literalinclude:: ../../../src/groundmodel/api/routers/geology/contacts.py
   :language: python
   :lines: 67-178
   :lineno-match:

.. CG-EXPLANATION-START id=function:create_contact

**What this does.** The handler for ``POST .../models/{model_id}/contacts`` — record a new formation contact. It runs the scope guard, calls the create use case, and on success returns the new contact as ``201 Created``. It handles two failure paths: a duplicate contact returns ``409`` carrying the existing contact's id, and a malformed anchor returns ``400``. When the draw came from a section it adds the contact's id to that section's seeded set.

**Why it is here.** The ``409`` ("conflict") carries the existing id so the desktop can offer "move it here" instead of a hard failure. The seeding step enforces the *explicit-content invariant* (owner directive 2026-05-17): a contact the engineer drew on a section must appear on that section, so even the survivor of a de-duplication is added to the section's set (debt #57), and a manual draw joins the set too. The ``400`` is defence-in-depth: the anchor must name exactly one of borehole or CPT, which the schema already enforces with a ``422``, so reaching this branch means a non-API caller bypassed validation.

.. CG-EXPLANATION-END id=function:create_contact

Function ``async def list_contacts``
------------------------------------

.. CG-BLOCK id=function:list_contacts lines=179-227

.. literalinclude:: ../../../src/groundmodel/api/routers/geology/contacts.py
   :language: python
   :lines: 179-227
   :lineno-match:

.. CG-EXPLANATION-START id=function:list_contacts

**What this does.** The handler for ``GET .../models/{model_id}/contacts`` — list the contacts in a model, optionally filtered to one borehole or one formation. It runs the scope guard and returns the matching rows.

**Why it is here.** The project id in the path is the cross-project id-enumeration guard: the model must belong to the project or the request is refused ``404``. The optional filters let the desktop fetch just the contacts it needs for a borehole or a formation without pulling the whole model.

.. CG-EXPLANATION-END id=function:list_contacts

Function ``async def update_contact``
-------------------------------------

.. CG-BLOCK id=function:update_contact lines=228-305

.. literalinclude:: ../../../src/groundmodel/api/routers/geology/contacts.py
   :language: python
   :lines: 228-305
   :lineno-match:

.. CG-EXPLANATION-START id=function:update_contact

**What this does.** The handler for ``PATCH .../models/{model_id}/contacts/{contact_id}`` — partially update one contact (its depth, formation, anchor, confidence, or notes). It runs a two-stage scope guard, applies only the fields the body set, and returns the updated contact — or ``204 No Content`` when a drag-down merge absorbed the contact into the one above.

**Why it is here.** The anchor is updatable so the section editor's drag-to-re-anchor works without a delete-and-create round-trip; an anchor change must send both anchor fields (the unused side explicitly null) so the exactly-one-anchor rule survives a partial update, and the schema rejects a malformed shape with a ``422``. The two-stage guard checks the contact belongs to the model AND the model to the project, returning one identical ``404`` either way so it never leaks which boundary a probing caller hit. The ``204`` path exists because a drag-down can merge the dragged contact away entirely, and the desktop refetches on any success.

.. CG-EXPLANATION-END id=function:update_contact

Function ``async def delete_contact``
-------------------------------------

.. CG-BLOCK id=function:delete_contact lines=306-357

.. literalinclude:: ../../../src/groundmodel/api/routers/geology/contacts.py
   :language: python
   :lines: 306-357
   :lineno-match:

.. CG-EXPLANATION-START id=function:delete_contact

**What this does.** The handler for ``DELETE .../models/{model_id}/contacts/{contact_id}`` — remove one contact. It runs the same two-stage scope guard, deletes through the use case, and answers ``204 No Content``.

**Why it is here.** The two-stage guard (contact in model, model in project) gives the same single ``404`` for any mismatch, protecting against cross-project id enumeration without revealing which check failed.

.. CG-EXPLANATION-END id=function:delete_contact

Function ``async def update_contacts_batch``
--------------------------------------------

.. CG-BLOCK id=function:update_contacts_batch lines=358-427

.. literalinclude:: ../../../src/groundmodel/api/routers/geology/contacts.py
   :language: python
   :lines: 358-427
   :lineno-match:

.. CG-EXPLANATION-START id=function:update_contacts_batch

**What this does.** The handler for ``PUT .../models/{model_id}/contacts/batch`` — update many contacts in one all-or-nothing call. It runs the model scope guard, builds a list of per-contact patches, and hands them to the batch use case; any single miss returns ``404`` with nothing written, and success returns the updated rows in the order sent.

**Why it is here.** The section editor's multi-drag ships every selected contact's new depth and anchor together so a partial failure cannot strand half the selection mid-move — the use case validates every entry's scope before mutating, and one commit covers the whole list. Returning the rows in input order lets the desktop patch its local state by position.

.. CG-EXPLANATION-END id=function:update_contacts_batch

