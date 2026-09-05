groundmodel.api.schemas.project.body.name_body_request
======================================================

.. CG-PAGE source=src/groundmodel/api/schemas/project/body/name_body_request.py complete=true

*Source file:* ``src/groundmodel/api/schemas/project/body/name_body_request.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-11

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/body/name_body_request.py
   :language: python
   :lines: 1-11
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The docstring and imports (``UUID``, Pydantic ``BaseModel`` and ``Field``, and the strict request base).

**Why it is here.** ``Field`` attaches per-field rules such as length and minimum value.

.. CG-EXPLANATION-END id=module-header

Class ``NameBodyRequest``
-------------------------

.. CG-BLOCK id=class:NameBodyRequest lines=12-39

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/body/name_body_request.py
   :language: python
   :lines: 12-39
   :lineno-match:

.. CG-EXPLANATION-START id=class:NameBodyRequest

**What this does.** The request to name a body, identifying it by its ``(formation_id, body_ordinal)`` pair and carrying the new ``name`` (1–120 characters) plus the optional section it was named from. ``Field(min_length=1, ...)`` refuses an empty name.

**Why it is here.** The docstring records that the ordinal is assigned by the correlation resolver and must be known before calling. The section id is stored so the perpendicular-companion feature can find the section later. A *request schema* declares and validates what the desktop may send; it inherits ``StrictRequestModel``, which rejects unknown fields and non-finite numbers so a client typo fails loudly with a 422 instead of silently writing junk.

.. CG-EXPLANATION-END id=class:NameBodyRequest

Class ``NameBodyResponse``
--------------------------

.. CG-BLOCK id=class:NameBodyResponse lines=40-53

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/body/name_body_request.py
   :language: python
   :lines: 40-53
   :lineno-match:

.. CG-EXPLANATION-START id=class:NameBodyResponse

**What this does.** The reply: the body's row id and a ``was_created`` flag (true for a new row, false when an existing one was updated in place).

**Why it is here.** A *response schema* is the shape the API returns to the desktop, kept separate from the database row so internal storage can change without breaking the web contract; new fields are additive (default to optional/null) per the API contract in ``docs/api.md``.

.. CG-EXPLANATION-END id=class:NameBodyResponse

