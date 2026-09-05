groundmodel.infrastructure.db.models.formation_contact_orm
==========================================================

.. CG-PAGE source=src/groundmodel/infrastructure/db/models/formation_contact_orm.py complete=true

*Source file:* ``src/groundmodel/infrastructure/db/models/formation_contact_orm.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-25

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/models/formation_contact_orm.py
   :language: python
   :lines: 1-25
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The description line and the toolbox: ``CheckConstraint``, the column types, ``ForeignKey`` / ``Index``, ``func`` and ``text`` (for raw SQL fragments in index conditions), the Postgres ``UUID`` type, ``Mapped`` / ``mapped_column`` / ``relationship``, ``Base`` and the loader-strategy constant.

**Why it is here.** ``text`` lets an index carry a raw SQL condition (a *partial index* — one that indexes only the rows matching a condition), used below to keep the uniqueness rules anchor-specific.

.. CG-EXPLANATION-END id=module-header

Class ``FormationContactOrm``
-----------------------------

.. CG-BLOCK id=class:FormationContactOrm lines=26-212

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/models/formation_contact_orm.py
   :language: python
   :lines: 26-212
   :lineno-match:

.. CG-EXPLANATION-START id=class:FormationContactOrm

**What this does.** Defines the ``formation_contact`` table — 'this formation tops out at depth X at this investigation', the primary data point of the geological model. It carries the model and formation ids (cascade-delete), one of three anchor flavours (a borehole, a CPT, or a synthetic pinch-out point with its own x/y/elevation), the ``depth_top_m``, provenance and confidence, optional observation backlinks, and a coupling link to a geological contact. A ``CheckConstraint`` enforces that exactly one anchor flavour is present, and partial unique indexes forbid exact-duplicate contacts.

**Why it is here.** This is the boundary-centric primitive of a geological model (docs/domain-model.md). The three-way anchor rule is written as 'the count of present anchors equals 1' so a future fourth flavour is one extra term. The 'no gaps' rule (a borehole's contacts must cover it continuously) is deliberately NOT a hard database constraint — it runs as a domain validation on save, because a hard rule would fight legitimate mid-edit states where a new contact momentarily overlaps an old one (Data-Integrity rule 5). The synthetic anchor is the anchorless point the pinch-out tool places where a formation thins out.

.. CG-EXPLANATION-END id=class:FormationContactOrm

