groundmodel.api.schemas.project.formation_absence.upsert_formation_absence_request
==================================================================================

.. CG-PAGE source=src/groundmodel/api/schemas/project/formation_absence/upsert_formation_absence_request.py complete=true

*Source file:* ``src/groundmodel/api/schemas/project/formation_absence/upsert_formation_absence_request.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-13

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/formation_absence/upsert_formation_absence_request.py
   :language: python
   :lines: 1-13
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The docstring and imports (``datetime``, ``Literal``, ``UUID``, Pydantic ``BaseModel``, the strict base).

**Why it is here.** A *Literal* type restricts a field to a fixed set of allowed strings — used below to pin the investigation kind and the source.

.. CG-EXPLANATION-END id=module-header

Class ``FormationAbsenceItem``
------------------------------

.. CG-BLOCK id=class:FormationAbsenceItem lines=14-45

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/formation_absence/upsert_formation_absence_request.py
   :language: python
   :lines: 14-45
   :lineno-match:

.. CG-EXPLANATION-START id=class:FormationAbsenceItem

**What this does.** One absence row returned by the list endpoint: the row id, the formation, the investigation and its kind, the source, and timestamps. Reads off the database row via ``from_attributes``.

**Why it is here.** An *absence* records that a named formation is deliberately not present at one investigation. A *response schema* is the shape the API returns to the desktop, kept separate from the database row so internal storage can change without breaking the web contract; new fields are additive (default to optional/null) per the API contract in ``docs/api.md``.

.. CG-EXPLANATION-END id=class:FormationAbsenceItem

Class ``UpsertFormationAbsenceRequest``
---------------------------------------

.. CG-BLOCK id=class:UpsertFormationAbsenceRequest lines=46-68

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/formation_absence/upsert_formation_absence_request.py
   :language: python
   :lines: 46-68
   :lineno-match:

.. CG-EXPLANATION-START id=class:UpsertFormationAbsenceRequest

**What this does.** The create/update request: the investigation id, its kind (borehole or CPT, pinned by a Literal), and the source (manual or observed, also pinned).

**Why it is here.** The docstring records that ``inferred`` is deliberately excluded — that source is the engine's domain and is rejected by the use case; only a user-intent source is accepted here. A *request schema* declares and validates what the desktop may send; it inherits ``StrictRequestModel``, which rejects unknown fields and non-finite numbers so a client typo fails loudly with a 422 instead of silently writing junk.

.. CG-EXPLANATION-END id=class:UpsertFormationAbsenceRequest

Class ``UpsertFormationAbsenceResponse``
----------------------------------------

.. CG-BLOCK id=class:UpsertFormationAbsenceResponse lines=69-82

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/formation_absence/upsert_formation_absence_request.py
   :language: python
   :lines: 69-82
   :lineno-match:

.. CG-EXPLANATION-START id=class:UpsertFormationAbsenceResponse

**What this does.** The reply: the absence row id and a ``was_created`` flag (true for a new row, false when an existing row's source was updated).

**Why it is here.** A *response schema* is the shape the API returns to the desktop, kept separate from the database row so internal storage can change without breaking the web contract; new fields are additive (default to optional/null) per the API contract in ``docs/api.md``.

.. CG-EXPLANATION-END id=class:UpsertFormationAbsenceResponse

