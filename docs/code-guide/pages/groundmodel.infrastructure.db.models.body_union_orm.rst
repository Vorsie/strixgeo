groundmodel.infrastructure.db.models.body_union_orm
===================================================

.. CG-PAGE source=src/groundmodel/infrastructure/db/models/body_union_orm.py complete=true

*Source file:* ``src/groundmodel/infrastructure/db/models/body_union_orm.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-14

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/models/body_union_orm.py
   :language: python
   :lines: 1-14
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The description line and the toolbox: ``CheckConstraint``, ``DateTime``, ``ForeignKey``, ``UniqueConstraint`` and ``func``, plus ``Base``, the Postgres ``UUID`` type and ``Mapped`` / ``mapped_column``.

**Why it is here.** The same small toolbox as the separation table — a mirror-image constraint.

.. CG-EXPLANATION-END id=module-header

Class ``BodyUnionOrm``
----------------------

.. CG-BLOCK id=class:BodyUnionOrm lines=15-97

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/models/body_union_orm.py
   :language: python
   :lines: 15-97
   :lineno-match:

.. CG-EXPLANATION-START id=class:BodyUnionOrm

**What this does.** Defines the ``body_union`` table: one user 'Join with…' ruling — a *must-link* constraint saying the body containing ``layer_a_id`` IS the same body as the one containing ``layer_b_id`` (both cascade-delete, stored smallest-first). Unique per ordered pair.

**Why it is here.** This is the positive counterpart of ``body_separation`` (owner ruling 2026-08-31): the engineer's standing rule is that two bodies are one 'if they are geometrically connected, OR if the user says so' — a union is that second, additive half. The resolver merges the two anchors even with no tie or geometry fact between them, but a union that would create a mixed body, or that contradicts a standing separation, is silently ignored (cannot-link wins). Like separation it anchors on layer ids and is written only by the user.

.. CG-EXPLANATION-END id=class:BodyUnionOrm

