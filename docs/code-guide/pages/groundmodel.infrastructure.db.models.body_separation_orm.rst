groundmodel.infrastructure.db.models.body_separation_orm
========================================================

.. CG-PAGE source=src/groundmodel/infrastructure/db/models/body_separation_orm.py complete=true

*Source file:* ``src/groundmodel/infrastructure/db/models/body_separation_orm.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-14

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/models/body_separation_orm.py
   :language: python
   :lines: 1-14
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The description line and the toolbox: ``CheckConstraint``, ``DateTime``, ``ForeignKey``, ``UniqueConstraint`` and ``func``, plus ``Base``, the Postgres ``UUID`` type and ``Mapped`` / ``mapped_column``.

**Why it is here.** The pieces for a small constraint table recording one user ruling per row.

.. CG-EXPLANATION-END id=module-header

Class ``BodySeparationOrm``
---------------------------

.. CG-BLOCK id=class:BodySeparationOrm lines=15-96

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/models/body_separation_orm.py
   :language: python
   :lines: 15-96
   :lineno-match:

.. CG-EXPLANATION-START id=class:BodySeparationOrm

**What this does.** Defines the ``body_separation`` table: one user 'Separate' ruling — a *cannot-link* constraint saying the body containing ``layer_a_id`` is never the same body as the one containing ``layer_b_id`` (both cascade-delete, stored smallest-first). Unique per ordered pair.

**Why it is here.** This is the engineer's subtractive half of the body-identity rule (owner ruling 2026-08-31): the resolver reads these rows and drops any edge whose merge would put the two layers under one body, even through an indirect chain. It is anchored on *layer* ids, never body ids, because body ids are re-minted on every resolve — a body-anchored rule would bind the wrong mass after a renumbering. Only the user writes here (the 'tombstone' principle): a separation records the engineer's judgement, not the machine's housekeeping.

.. CG-EXPLANATION-END id=class:BodySeparationOrm

