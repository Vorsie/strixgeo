groundmodel.infrastructure.db.models.formation_surface_orm
==========================================================

.. CG-PAGE source=src/groundmodel/infrastructure/db/models/formation_surface_orm.py complete=true

*Source file:* ``src/groundmodel/infrastructure/db/models/formation_surface_orm.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-26

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/models/formation_surface_orm.py
   :language: python
   :lines: 1-26
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The description line and the toolbox: the column types including ``LargeBinary`` (for a checksum), ``ForeignKey`` / ``Index`` / ``UniqueConstraint``, ``false`` and ``func``, the Postgres ``JSONB`` and ``UUID`` types, ``Mapped`` / ``mapped_column`` and ``Base``.

**Why it is here.** ``LargeBinary`` stores the raw bytes of a checksum; ``false`` is the SQL literal used as a column default.

.. CG-EXPLANATION-END id=module-header

Class ``FormationSurfaceOrm``
-----------------------------

.. CG-BLOCK id=class:FormationSurfaceOrm lines=27-126

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/models/formation_surface_orm.py
   :language: python
   :lines: 27-126
   :lineno-match:

.. CG-EXPLANATION-START id=class:FormationSurfaceOrm

**What this does.** Defines the ``formation_surface`` table: the cached interpolated top of one formation in one model, stored as ``vertices`` and ``triangles`` JSONB blobs, plus a ``method`` name, a source-contact count and checksum, an ``is_stale`` flag, and a ``UniqueConstraint`` of one surface per (model, formation).

**Why it is here.** This is a *cache*, not a source of truth — the truth is the formation-contact rows, and this row is the triangulated surface (TIN) computed from them, kept so the section editor and exporters need not re-run the triangulation on every render. The checksum is a cheap validity tag: when the contacts change and the checksum no longer matches, the surface is marked stale and re-computed. The docstring notes the on-click build pivot — a contact edit flips ``is_stale`` cheaply, and only an explicit rebuild clears it, which the section view signals by drawing stale surfaces faintly.

.. CG-EXPLANATION-END id=class:FormationSurfaceOrm

