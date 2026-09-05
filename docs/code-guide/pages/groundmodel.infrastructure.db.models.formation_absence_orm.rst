groundmodel.infrastructure.db.models.formation_absence_orm
==========================================================

.. CG-PAGE source=src/groundmodel/infrastructure/db/models/formation_absence_orm.py complete=true

*Source file:* ``src/groundmodel/infrastructure/db/models/formation_absence_orm.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-14

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/models/formation_absence_orm.py
   :language: python
   :lines: 1-14
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The description line and the toolbox: ``CheckConstraint``, ``DateTime``, ``ForeignKey``, ``UniqueConstraint`` and ``func``, plus the Postgres ``UUID`` type, ``Mapped`` / ``mapped_column`` and ``Base``.

**Why it is here.** The pieces for a small evidence table with database-level check and uniqueness rules.

.. CG-EXPLANATION-END id=module-header

Class ``FormationAbsenceOrm``
-----------------------------

.. CG-BLOCK id=class:FormationAbsenceOrm lines=15-125

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/models/formation_absence_orm.py
   :language: python
   :lines: 15-125
   :lineno-match:

.. CG-EXPLANATION-START id=class:FormationAbsenceOrm

**What this does.** Defines the ``formation_absence`` table: positive evidence that a given investigation *lacks* a formation's body. It holds the ``formation_id`` (cascade-delete), a polymorphic ``investigation_id`` plus an ``investigation_kind`` discriminator (borehole or cpt), and a ``source`` (inferred / manual / observed). ``CheckConstraint`` rules restrict the source and kind to their allowed strings, and a ``UniqueConstraint`` allows one absence per formation-and-investigation.

**Why it is here.** Recording absence *positively* lets the model say 'this formation is genuinely missing here', not just 'we have no data'. The reference is *polymorphic* — one raw UUID plus a ``kind`` string that says which table it points at — because an investigation can be a borehole or a CPT and there is no single investigations table; the application checks the id against the right table at write time. The ``source`` distinction protects the engineer: the inference engine never overwrites a ``manual`` or ``observed`` row.

.. CG-EXPLANATION-END id=class:FormationAbsenceOrm

