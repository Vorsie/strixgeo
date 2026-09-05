groundmodel.api.schemas.project.body_separation.body_separation_schemas
=======================================================================

.. CG-PAGE source=src/groundmodel/api/schemas/project/body_separation/body_separation_schemas.py complete=true

*Source file:* ``src/groundmodel/api/schemas/project/body_separation/body_separation_schemas.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-27

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/body_separation/body_separation_schemas.py
   :language: python
   :lines: 1-27
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** A docstring explaining the "Separate" verb and listing the three endpoints it serves, then the imports (``datetime``, ``UUID``, Pydantic's ``BaseModel`` and ``model_validator``, the strict base).

**Why it is here.** The docstring records the owner ruling (2026-08-31): "Separate" lets the engineer state that two touching masses are NOT the same body and have the resolver honour it permanently — the subtractive counterpart to a join. The anchors are stored in a canonical order (smaller id first) so the same pair is one row whichever order it arrives. A *model_validator* is a whole-object check that runs after the fields are parsed.

.. CG-EXPLANATION-END id=module-header

Class ``CreateBodySeparationRequest`` — header
----------------------------------------------

.. CG-BLOCK id=class:CreateBodySeparationRequest lines=28-42

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/body_separation/body_separation_schemas.py
   :language: python
   :lines: 28-42
   :lineno-match:

.. CG-EXPLANATION-START id=class:CreateBodySeparationRequest

**What this does.** The create request: two anchor layer ids, given in either order.

**Why it is here.** A *request schema* declares and validates what the desktop may send; it inherits ``StrictRequestModel``, which rejects unknown fields and non-finite numbers so a client typo fails loudly with a 422 instead of silently writing junk.

.. CG-EXPLANATION-END id=class:CreateBodySeparationRequest

Method ``CreateBodySeparationRequest``. ``def _distinct``
---------------------------------------------------------

.. CG-BLOCK id=method:CreateBodySeparationRequest._distinct lines=43-50

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/body_separation/body_separation_schemas.py
   :language: python
   :lines: 43-50
   :lineno-match:

.. CG-EXPLANATION-START id=method:CreateBodySeparationRequest._distinct

**What this does.** A whole-object check that rejects a request whose two anchors are the same layer.

**Why it is here.** Defence in depth at the API boundary — a self-separation is meaningless, so it is refused with a clear 422 rather than reaching the use case.

.. CG-EXPLANATION-END id=method:CreateBodySeparationRequest._distinct

Class ``BodySeparationResponse``
--------------------------------

.. CG-BLOCK id=class:BodySeparationResponse lines=51-85

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/body_separation/body_separation_schemas.py
   :language: python
   :lines: 51-85
   :lineno-match:

.. CG-EXPLANATION-START id=class:BodySeparationResponse

**What this does.** The create reply: the separation id, its model, the two canonical anchors, a ``was_created`` flag, ``bodies_changed`` (how many bodies the in-request re-resolve added or removed), and ``renamed`` (unit labels the re-resolve displaced).

**Why it is here.** The docstring records that the verb is reversible, so a duplicate create is a 200 with the existing row, never a 409; the diff counts drive the toast the engineer reads. A *response schema* is the shape the API returns to the desktop, kept separate from the database row so internal storage can change without breaking the web contract; new fields are additive (default to optional/null) per the API contract in ``docs/api.md``.

.. CG-EXPLANATION-END id=class:BodySeparationResponse

Class ``BodySeparationAnchorInfo``
----------------------------------

.. CG-BLOCK id=class:BodySeparationAnchorInfo lines=86-116

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/body_separation/body_separation_schemas.py
   :language: python
   :lines: 86-116
   :lineno-match:

.. CG-EXPLANATION-START id=class:BodySeparationAnchorInfo

**What this does.** Server-resolved display info for one anchor: the layer id and the body it currently belongs to (id, name, ordinal, formation), any of which may be ``None``.

**Why it is here.** The docstring records why the server sends this: the desktop can render "Rejoin with <label>" without keeping its own resolution map, because each anchor's CURRENT body is reported at request time so the label always matches the live partition. A *response schema* is the shape the API returns to the desktop, kept separate from the database row so internal storage can change without breaking the web contract; new fields are additive (default to optional/null) per the API contract in ``docs/api.md``.

.. CG-EXPLANATION-END id=class:BodySeparationAnchorInfo

Class ``BodySeparationListItem``
--------------------------------

.. CG-BLOCK id=class:BodySeparationListItem lines=117-146

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/body_separation/body_separation_schemas.py
   :language: python
   :lines: 117-146
   :lineno-match:

.. CG-EXPLANATION-START id=class:BodySeparationListItem

**What this does.** One row of the separations list: the row id, model, the two anchors, and the resolved display info for each.

**Why it is here.** A *response schema* is the shape the API returns to the desktop, kept separate from the database row so internal storage can change without breaking the web contract; new fields are additive (default to optional/null) per the API contract in ``docs/api.md``.

.. CG-EXPLANATION-END id=class:BodySeparationListItem

Class ``BodySeparationRejoinResponse``
--------------------------------------

.. CG-BLOCK id=class:BodySeparationRejoinResponse lines=147-161

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/body_separation/body_separation_schemas.py
   :language: python
   :lines: 147-161
   :lineno-match:

.. CG-EXPLANATION-START id=class:BodySeparationRejoinResponse

**What this does.** The reply to deleting a separation ("Rejoin"): ``bodies_changed`` and ``renamed`` from the re-resolve after the separation is lifted.

**Why it is here.** A *response schema* is the shape the API returns to the desktop, kept separate from the database row so internal storage can change without breaking the web contract; new fields are additive (default to optional/null) per the API contract in ``docs/api.md``.

.. CG-EXPLANATION-END id=class:BodySeparationRejoinResponse

