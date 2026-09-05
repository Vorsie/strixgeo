groundmodel.infrastructure.db.models.body_boundary_shape_orm
============================================================

.. CG-PAGE source=src/groundmodel/infrastructure/db/models/body_boundary_shape_orm.py complete=true

*Source file:* ``src/groundmodel/infrastructure/db/models/body_boundary_shape_orm.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-20

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/models/body_boundary_shape_orm.py
   :language: python
   :lines: 1-20
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The description line and a small toolbox: ``ForeignKey``, ``String`` and ``UniqueConstraint``, plus ``Base``, the Postgres ``UUID`` type and ``Mapped`` / ``mapped_column``.

**Why it is here.** Only the pieces a one-row-per-body shape record needs.

.. CG-EXPLANATION-END id=module-header

Class ``BodyBoundaryShapeOrm``
------------------------------

.. CG-BLOCK id=class:BodyBoundaryShapeOrm lines=21-69

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/models/body_boundary_shape_orm.py
   :language: python
   :lines: 21-69
   :lineno-match:

.. CG-EXPLANATION-START id=class:BodyBoundaryShapeOrm

**What this does.** Defines the ``body_boundary_shape`` table: one row per body, holding its ``body_id`` (cascade-delete), its ``model_id``, and a ``render_style`` (default ``straight``). A ``UniqueConstraint`` on ``body_id`` enforces one shape row per body.

**Why it is here.** A shape row is the parent that owns a body's boundary nodes; a body has at most one, hence the unique constraint. Joining the nodes to the body through this row (rather than by a model-plus-key lookup) is the clean form that replaced the earlier lens-shape table.

.. CG-EXPLANATION-END id=class:BodyBoundaryShapeOrm

