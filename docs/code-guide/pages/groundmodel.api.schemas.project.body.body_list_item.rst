groundmodel.api.schemas.project.body.body_list_item
===================================================

.. CG-PAGE source=src/groundmodel/api/schemas/project/body/body_list_item.py complete=true

*Source file:* ``src/groundmodel/api/schemas/project/body/body_list_item.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-12

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/body/body_list_item.py
   :language: python
   :lines: 1-12
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The docstring and imports (``datetime``, ``UUID``, Pydantic's ``BaseModel`` and ``ConfigDict``, and the geo-formation reference schema).

**Why it is here.** ``ConfigDict`` carries the schema's settings; it is used on the class below to switch on ``from_attributes``.

.. CG-EXPLANATION-END id=module-header

Class ``BodyListItem``
----------------------

.. CG-BLOCK id=class:BodyListItem lines=13-97

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/body/body_list_item.py
   :language: python
   :lines: 13-97
   :lineno-match:

.. CG-EXPLANATION-START id=class:BodyListItem

**What this does.** One row of the bodies list: identity fields (id, project, model, formation, ordinal, source investigation, optional name and section), the litho-parent link, and three geological-attribution fields — a single majority formation id and name plus the full ``geo_formations`` list of everything the body crosses. ``model_config = ConfigDict(from_attributes=True)`` lets Pydantic read these straight off a database row.

**Why it is here.** *from_attributes* means the schema can be built directly from a loaded database object instead of a hand-built dictionary. The comments record which fields are stored versus *derived on read and never stored* (the majority geo-formation and the crossed-formations list, recomputed each read, debt #278 A2/R2) — a data-integrity distinction. The crossed list is additive and defaults to empty, so an older client reading only the singular fields is unaffected. A *response schema* is the shape the API returns to the desktop, kept separate from the database row so internal storage can change without breaking the web contract; new fields are additive (default to optional/null) per the API contract in ``docs/api.md``.

.. CG-EXPLANATION-END id=class:BodyListItem

