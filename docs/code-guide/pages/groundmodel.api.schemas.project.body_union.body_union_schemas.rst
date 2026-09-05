groundmodel.api.schemas.project.body_union.body_union_schemas
=============================================================

.. CG-PAGE source=src/groundmodel/api/schemas/project/body_union/body_union_schemas.py complete=true

*Source file:* ``src/groundmodel/api/schemas/project/body_union/body_union_schemas.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-26

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/body_union/body_union_schemas.py
   :language: python
   :lines: 1-26
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** A docstring explaining the "Join with…" verb and its three endpoints, then the imports (``datetime``, ``UUID``, Pydantic ``BaseModel`` and ``model_validator``, the strict base).

**Why it is here.** The docstring records the owner ruling (2026-08-31): "Join with…" lets the engineer state that two bodies ARE the same and have the resolver honour it — the additive counterpart to Separate. Anchors are stored in canonical order, same as separations.

.. CG-EXPLANATION-END id=module-header

Class ``CreateBodyUnionRequest`` — header
-----------------------------------------

.. CG-BLOCK id=class:CreateBodyUnionRequest lines=27-41

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/body_union/body_union_schemas.py
   :language: python
   :lines: 27-41
   :lineno-match:

.. CG-EXPLANATION-START id=class:CreateBodyUnionRequest

**What this does.** The create request: two anchor layer ids, given in either order.

**Why it is here.** A *request schema* declares and validates what the desktop may send; it inherits ``StrictRequestModel``, which rejects unknown fields and non-finite numbers so a client typo fails loudly with a 422 instead of silently writing junk.

.. CG-EXPLANATION-END id=class:CreateBodyUnionRequest

Method ``CreateBodyUnionRequest``. ``def _distinct``
----------------------------------------------------

.. CG-BLOCK id=method:CreateBodyUnionRequest._distinct lines=42-49

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/body_union/body_union_schemas.py
   :language: python
   :lines: 42-49
   :lineno-match:

.. CG-EXPLANATION-START id=method:CreateBodyUnionRequest._distinct

**What this does.** A whole-object check rejecting a request whose two anchors are the same layer.

**Why it is here.** Defence in depth — a self-union is meaningless and is refused with a 422 before the use case runs.

.. CG-EXPLANATION-END id=method:CreateBodyUnionRequest._distinct

Class ``BodyUnionResponse``
---------------------------

.. CG-BLOCK id=class:BodyUnionResponse lines=50-97

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/body_union/body_union_schemas.py
   :language: python
   :lines: 50-97
   :lineno-match:

.. CG-EXPLANATION-START id=class:BodyUnionResponse

**What this does.** The create reply: the union id, its model, the canonical anchors, a ``was_created`` flag, ``bodies_changed``, ``renamed``, and two outcome flags — ``suppressed`` (a standing separation overruled this join) and ``inert`` (the two anchors re-derive to different masses, so the join can never make one body).

**Why it is here.** The docstring records why the extra flags exist: without them a blocked join would look like a misleading "created, changed nothing" success, so the flags let the toast say "join blocked by a separation". "Cannot-link wins" is the resolver's ground-truth backstop; the write-time guards normally refuse such a join with a 422. A reversible verb, so a duplicate is a 200. A *response schema* is the shape the API returns to the desktop, kept separate from the database row so internal storage can change without breaking the web contract; new fields are additive (default to optional/null) per the API contract in ``docs/api.md``.

.. CG-EXPLANATION-END id=class:BodyUnionResponse

Class ``BodyUnionAnchorInfo``
-----------------------------

.. CG-BLOCK id=class:BodyUnionAnchorInfo lines=98-128

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/body_union/body_union_schemas.py
   :language: python
   :lines: 98-128
   :lineno-match:

.. CG-EXPLANATION-START id=class:BodyUnionAnchorInfo

**What this does.** Server-resolved display info for one union anchor — layer id and its current body's id, name, ordinal, and formation.

**Why it is here.** Same reasoning as the separation anchor info: the desktop renders "Disjoin from <label>" from the live server-reported body without its own map. A *response schema* is the shape the API returns to the desktop, kept separate from the database row so internal storage can change without breaking the web contract; new fields are additive (default to optional/null) per the API contract in ``docs/api.md``.

.. CG-EXPLANATION-END id=class:BodyUnionAnchorInfo

Class ``BodyUnionListItem``
---------------------------

.. CG-BLOCK id=class:BodyUnionListItem lines=129-158

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/body_union/body_union_schemas.py
   :language: python
   :lines: 129-158
   :lineno-match:

.. CG-EXPLANATION-START id=class:BodyUnionListItem

**What this does.** One row of the unions list: id, model, the two anchors, and each anchor's resolved display info.

**Why it is here.** A *response schema* is the shape the API returns to the desktop, kept separate from the database row so internal storage can change without breaking the web contract; new fields are additive (default to optional/null) per the API contract in ``docs/api.md``.

.. CG-EXPLANATION-END id=class:BodyUnionListItem

Class ``BodyUnionDisjoinResponse``
----------------------------------

.. CG-BLOCK id=class:BodyUnionDisjoinResponse lines=159-182

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/body_union/body_union_schemas.py
   :language: python
   :lines: 159-182
   :lineno-match:

.. CG-EXPLANATION-START id=class:BodyUnionDisjoinResponse

**What this does.** The reply to deleting a union ("Disjoin"): ``bodies_changed`` and ``renamed`` plus two model-level counts — how many OTHER unions the re-resolve still finds suppressed by a separation, and how many it finds inert.

**Why it is here.** The model-level counts let the desktop flag joins that remain blocked elsewhere on the model after this disjoin. A *response schema* is the shape the API returns to the desktop, kept separate from the database row so internal storage can change without breaking the web contract; new fields are additive (default to optional/null) per the API contract in ``docs/api.md``.

.. CG-EXPLANATION-END id=class:BodyUnionDisjoinResponse

