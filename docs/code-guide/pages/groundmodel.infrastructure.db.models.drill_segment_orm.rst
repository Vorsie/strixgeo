groundmodel.infrastructure.db.models.drill_segment_orm
======================================================

.. CG-PAGE source=src/groundmodel/infrastructure/db/models/drill_segment_orm.py complete=true

*Source file:* ``src/groundmodel/infrastructure/db/models/drill_segment_orm.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-14

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/models/drill_segment_orm.py
   :language: python
   :lines: 1-14
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The description line and a small toolbox: ``Double``, ``ForeignKey``, ``Index``, ``String``, the Postgres ``UUID`` type, ``Mapped`` / ``mapped_column`` / ``relationship``, ``Base`` and the loader-strategy constant.

**Why it is here.** The building blocks for a child table with a single foreign key to its borehole.

.. CG-EXPLANATION-END id=module-header

Class ``DrillSegmentOrm``
-------------------------

.. CG-BLOCK id=class:DrillSegmentOrm lines=15-38

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/models/drill_segment_orm.py
   :language: python
   :lines: 15-38
   :lineno-match:

.. CG-EXPLANATION-START id=class:DrillSegmentOrm

**What this does.** Defines the ``drill_segment`` table: one interval of one drilling technique — a ``borehole_id`` foreign key (cascade-delete), ``top_m`` / ``base_m`` / ``method``, and a ``relationship`` back to the borehole. Indexed on ``borehole_id``.

**Why it is here.** The borehole's overall drill method is only a summary; these per-interval rows, kept in source order along ``top_m``, are the ground truth. Cascade delete means removing a borehole removes its segments with it.

.. CG-EXPLANATION-END id=class:DrillSegmentOrm

