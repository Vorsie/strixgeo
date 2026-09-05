groundmodel.infrastructure.db.models.body_orm
=============================================

.. CG-PAGE source=src/groundmodel/infrastructure/db/models/body_orm.py complete=true

*Source file:* ``src/groundmodel/infrastructure/db/models/body_orm.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-20

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/models/body_orm.py
   :language: python
   :lines: 1-20
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The description line and the toolbox: ``DateTime``, ``ForeignKey``, ``Index``, ``Integer``, ``String``, ``Text``, ``UniqueConstraint`` and ``func``, plus ``Base``, the Postgres ``UUID`` type and ``Mapped`` / ``mapped_column``.

**Why it is here.** The building blocks for the body identity table and its constraints.

.. CG-EXPLANATION-END id=module-header

Class ``BodyOrm``
-----------------

.. CG-BLOCK id=class:BodyOrm lines=21-163

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/models/body_orm.py
   :language: python
   :lines: 21-163
   :lineno-match:

.. CG-EXPLANATION-START id=class:BodyOrm

**What this does.** Defines the ``body`` table — the identity row for one correlated single-lithology unit. It carries the project, model and formation ids (all cascade-delete), a ``body_ordinal``, the ``source_investigation_id``, an optional human ``name`` and ``display_color``, a ``primary_section_id`` (set-null on section delete), and a self-referential ``parent_litho_body_id`` linking a geotech body to the litho body it subdivides. A ``UniqueConstraint`` on ``(model_id, formation_id, body_ordinal)`` enforces one row per body.

**Why it is here.** A *body* is a single-lithology unit traced across a section — the connected component the correlation resolver finds (see docs/design/body-model.md). This table stores only the body's *identity*, never its lateral shape: the shape is derived by the partition fill. ``name`` is a ``Text`` column (not a length-capped ``String``) so a user's free-form label can never surprise-truncate (the CLAUDE.md schema rule). ``display_color`` lives here rather than in browser storage because a chosen colour is a per-project engineering decision that must travel in the ``.strix`` bundle. ``source_investigation_id`` is a plain UUID with no foreign key because it can point at either a CPT or a borehole — the same polymorphic pattern the formation contact uses.

.. CG-EXPLANATION-END id=class:BodyOrm

