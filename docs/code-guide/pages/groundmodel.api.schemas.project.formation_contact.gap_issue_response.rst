groundmodel.api.schemas.project.formation_contact.gap_issue_response
====================================================================

.. CG-PAGE source=src/groundmodel/api/schemas/project/formation_contact/gap_issue_response.py complete=true

*Source file:* ``src/groundmodel/api/schemas/project/formation_contact/gap_issue_response.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-9

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/formation_contact/gap_issue_response.py
   :language: python
   :lines: 1-9
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The docstring and imports (``UUID``, Pydantic ``BaseModel`` and ``Field``).

**Why it is here.** A *response schema* is the shape the API returns to the desktop, kept separate from the database row so internal storage can change without breaking the web contract; new fields are additive (default to optional/null) per the API contract in ``docs/api.md``.

.. CG-EXPLANATION-END id=module-header

Class ``GapIssueResponse``
--------------------------

.. CG-BLOCK id=class:GapIssueResponse lines=10-25

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/formation_contact/gap_issue_response.py
   :language: python
   :lines: 10-25
   :lineno-match:

.. CG-EXPLANATION-START id=class:GapIssueResponse

**What this does.** One validator issue: a kind, a human-readable detail, an optional depth, and two optional id lists (the contacts involved, or the formation pair for a crossing).

**Why it is here.** The docstring records it is shared by two validators (the per-borehole no-gaps check and the cross-formation crossing check), which populate different id lists — one schema for both keeps the editor's issue rendering uniform. A *response schema* is the shape the API returns to the desktop, kept separate from the database row so internal storage can change without breaking the web contract; new fields are additive (default to optional/null) per the API contract in ``docs/api.md``.

.. CG-EXPLANATION-END id=class:GapIssueResponse

