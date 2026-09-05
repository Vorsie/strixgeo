groundmodel.api.schemas.project.formation_contact.formation_candidate_item
==========================================================================

.. CG-PAGE source=src/groundmodel/api/schemas/project/formation_contact/formation_candidate_item.py complete=true

*Source file:* ``src/groundmodel/api/schemas/project/formation_contact/formation_candidate_item.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-7

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/formation_contact/formation_candidate_item.py
   :language: python
   :lines: 1-7
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The docstring and the single Pydantic import.

**Why it is here.** A *response schema* is the shape the API returns to the desktop, kept separate from the database row so internal storage can change without breaking the web contract; new fields are additive (default to optional/null) per the API contract in ``docs/api.md``.

.. CG-EXPLANATION-END id=module-header

Class ``FormationCandidateItem``
--------------------------------

.. CG-BLOCK id=class:FormationCandidateItem lines=8-29

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/formation_contact/formation_candidate_item.py
   :language: python
   :lines: 8-29
   :lineno-match:

.. CG-EXPLANATION-START id=class:FormationCandidateItem

**What this does.** One discovered candidate: a display name, an optional regional reference, a stable ``key``, and the count of boreholes it was found in.

**Why it is here.** The docstring records why the key matters: the desktop passes keys (not display names) on confirm, so discover and auto-populate share one stable identity regardless of informal-name variation across boreholes; the new fields are additive. A *response schema* is the shape the API returns to the desktop, kept separate from the database row so internal storage can change without breaking the web contract; new fields are additive (default to optional/null) per the API contract in ``docs/api.md``.

.. CG-EXPLANATION-END id=class:FormationCandidateItem

