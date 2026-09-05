groundmodel.infrastructure.db.models.investigation_review_orm
=============================================================

.. CG-PAGE source=src/groundmodel/infrastructure/db/models/investigation_review_orm.py complete=true

*Source file:* ``src/groundmodel/infrastructure/db/models/investigation_review_orm.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-23

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/models/investigation_review_orm.py
   :language: python
   :lines: 1-23
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The description line and the toolbox: the column types (``Boolean``, ``DateTime``, ``String``, ``Text``), ``CheckConstraint`` / ``Index`` / ``UniqueConstraint``, ``func``, the Postgres ``UUID`` type, ``Mapped`` / ``mapped_column`` and ``Base``.

**Why it is here.** The pieces for a small per-investigation decision table with database-level guards.

.. CG-EXPLANATION-END id=module-header

Class ``InvestigationReviewOrm``
--------------------------------

.. CG-BLOCK id=class:InvestigationReviewOrm lines=24-96

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/models/investigation_review_orm.py
   :language: python
   :lines: 24-96
   :lineno-match:

.. CG-EXPLANATION-START id=class:InvestigationReviewOrm

**What this does.** Defines the ``investigation_review`` table: one per-(project, investigation) decision — a review status, notes, a reviewed-at time and an ``is_hidden`` flag — anchored polymorphically by a ``target_kind`` (cpt or borehole) plus a ``target_id``. A ``CheckConstraint`` restricts the kind and status, and a ``UniqueConstraint`` allows one review per target.

**Why it is here.** One table holds decisions for both CPT- and borehole-anchored investigations, so a new decision field is one column here rather than two mirrored across the CPT and borehole tables. A row exists only where a decision was made — the absence of a row means 'unreviewed, not hidden' — which keeps the table small in a project with thousands of investigations. Like the formation contact, the polymorphic link is not database-enforced; the application checks the target exists at write time. These decisions ride the ``.strix`` bundle so a wiped database does not lose the engineer's review history.

.. CG-EXPLANATION-END id=class:InvestigationReviewOrm

