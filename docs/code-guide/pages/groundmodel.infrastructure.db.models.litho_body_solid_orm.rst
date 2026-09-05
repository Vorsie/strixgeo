groundmodel.infrastructure.db.models.litho_body_solid_orm
=========================================================

.. CG-PAGE source=src/groundmodel/infrastructure/db/models/litho_body_solid_orm.py complete=true

*Source file:* ``src/groundmodel/infrastructure/db/models/litho_body_solid_orm.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-26

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/models/litho_body_solid_orm.py
   :language: python
   :lines: 1-26
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The description line and the toolbox: the column types including ``LargeBinary``, ``ForeignKey`` / ``Index`` / ``UniqueConstraint``, ``false`` and ``func``, the Postgres ``JSONB`` and ``UUID`` types, ``Mapped`` / ``mapped_column`` and ``Base``.

**Why it is here.** The same cache-table building blocks as the formation-surface table, plus a build-generation link.

.. CG-EXPLANATION-END id=module-header

Class ``LithoBodySolidOrm``
---------------------------

.. CG-BLOCK id=class:LithoBodySolidOrm lines=27-162

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/models/litho_body_solid_orm.py
   :language: python
   :lines: 27-162
   :lineno-match:

.. CG-EXPLANATION-START id=class:LithoBodySolidOrm

**What this does.** Defines the ``litho_body_solid`` table: the cached watertight 3-D solid for one body in one model — ``vertices`` and ``triangles`` JSONB blobs, a ``method``, a source-pick count and checksum, ``is_stale`` and ``is_flagged`` flags, and a link to the build that produced it. One solid per (model, body).

**Why it is here.** Like the formation surface, this is a *cache*: the truth is the litho-layer rows whose ``body_id`` matches, and this row is their triangulated solid, kept so the 3-D viewer and the DXF/Plaxis exporters need not re-triangulate on every render. The checksum short-circuits a rebuild when the pick set has not changed. The docstring notes that ``body_id`` is deliberately *not* a foreign key here, because geology-split halves get synthesised ids with no row in the body table; ``is_flagged`` marks a best-effort (non-watertight) solid so the UI can badge it without blocking export.

.. CG-EXPLANATION-END id=class:LithoBodySolidOrm

