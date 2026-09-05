groundmodel.infrastructure.db.models.body_geometry_fact_orm
===========================================================

.. CG-PAGE source=src/groundmodel/infrastructure/db/models/body_geometry_fact_orm.py complete=true

*Source file:* ``src/groundmodel/infrastructure/db/models/body_geometry_fact_orm.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-14

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/models/body_geometry_fact_orm.py
   :language: python
   :lines: 1-14
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The description line and the toolbox: ``CheckConstraint``, ``DateTime``, ``ForeignKey``, ``UniqueConstraint`` and ``func``, plus ``Base``, the Postgres ``UUID`` type and ``Mapped`` / ``mapped_column``.

**Why it is here.** ``CheckConstraint`` is a rule the database enforces on every row (here, that the two layer ids are stored in a fixed order). ``func`` gives access to database functions such as ``now()`` for timestamps.

.. CG-EXPLANATION-END id=module-header

Class ``BodyGeometryFactOrm``
-----------------------------

.. CG-BLOCK id=class:BodyGeometryFactOrm lines=15-86

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/models/body_geometry_fact_orm.py
   :language: python
   :lines: 15-86
   :lineno-match:

.. CG-EXPLANATION-START id=class:BodyGeometryFactOrm

**What this does.** Defines the ``body_geometry_fact`` table: one observed geometric adjacency between two same-lithology layers — a ``model_id`` and the two layer ids ``layer_a_id`` / ``layer_b_id`` (both cascade-delete), stored smallest-first. A ``CheckConstraint`` enforces that order and a ``UniqueConstraint`` allows only one fact per pair.

**Why it is here.** This is the owner ruling that 'every same litho that is connected should get the same body id' made durable (see docs/design/body-model.md). A fact is read off the partition fill and used purely as an edge for the body resolver — it draws nothing and carries no fill meaning. It is stored separately from a correlation tie because a tie does two jobs at once (it defines the 2/1/0 fill shape AND body membership), so 'same body, different boundary drawing' needs its own record. Storing the pair in canonical order makes the unique constraint enough to prevent a duplicate whichever way round the two were observed.

.. CG-EXPLANATION-END id=class:BodyGeometryFactOrm

