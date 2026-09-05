groundmodel.infrastructure.db.models.body_boundary_node_orm
===========================================================

.. CG-PAGE source=src/groundmodel/infrastructure/db/models/body_boundary_node_orm.py complete=true

*Source file:* ``src/groundmodel/infrastructure/db/models/body_boundary_node_orm.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-19

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/models/body_boundary_node_orm.py
   :language: python
   :lines: 1-19
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The description line and a small toolbox: ``Float``, ``ForeignKey``, ``Integer``, ``String`` and ``UniqueConstraint``, plus ``Base``, the Postgres ``UUID`` type, and ``Mapped`` / ``mapped_column``.

**Why it is here.** ``UniqueConstraint`` is a rule that a combination of columns may appear at most once in the table — used below to keep the node ordering stable.

.. CG-EXPLANATION-END id=module-header

Class ``BodyBoundaryNodeOrm``
-----------------------------

.. CG-BLOCK id=class:BodyBoundaryNodeOrm lines=20-62

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/models/body_boundary_node_orm.py
   :language: python
   :lines: 20-62
   :lineno-match:

.. CG-EXPLANATION-START id=class:BodyBoundaryNodeOrm

**What this does.** Defines the ``body_boundary_node`` table: one hand-drawn control point on a body's upper or lower boundary line, holding its ``shape_id`` (the boundary shape it belongs to), which ``boundary`` (upper or lower), a ``node_index`` for order, and its ``along_m`` / ``elevation_m`` position. A ``UniqueConstraint`` on ``(shape_id, boundary, node_index)`` keeps the points in a stable order.

**Why it is here.** These are the points an engineer drags to shape a body's outline on a cross-section. The unique constraint guarantees two points on the same boundary never claim the same index, so the polyline reads back in a definite order. The renderer merges these with the body's extent endpoints and sorts by ``along_m`` (distance along the section).

.. CG-EXPLANATION-END id=class:BodyBoundaryNodeOrm

