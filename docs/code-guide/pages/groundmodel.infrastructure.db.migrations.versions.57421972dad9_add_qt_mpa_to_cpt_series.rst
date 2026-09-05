groundmodel.infrastructure.db.migrations.versions.57421972dad9_add_qt_mpa_to_cpt_series
=======================================================================================

.. CG-PAGE source=src/groundmodel/infrastructure/db/migrations/versions/57421972dad9_add_qt_mpa_to_cpt_series.py complete=true

*Source file:* ``src/groundmodel/infrastructure/db/migrations/versions/57421972dad9_add_qt_mpa_to_cpt_series.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-19

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/57421972dad9_add_qt_mpa_to_cpt_series.py
   :language: python
   :lines: 1-19
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Opens a small migration that adds a ``qt_mpa`` array column to the CPT series table. Names its revision id and the migration it follows.

**Why it is here.** Why: not recorded — ask the owner. (The docstring carries only the revision bookkeeping. This column later splits into ``qt`` and ``q_total`` in a separate migration; the CLAUDE.md GEF-parser note records those must stay distinct because one is the corrected cone resistance on a CPTU and the other the total resistance on a mechanical CPT.)

.. CG-EXPLANATION-END id=module-header

Function ``def upgrade``
------------------------

.. CG-BLOCK id=function:upgrade lines=20-25

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/57421972dad9_add_qt_mpa_to_cpt_series.py
   :language: python
   :lines: 20-25
   :lineno-match:

.. CG-EXPLANATION-START id=function:upgrade

**What this does.** Adds a nullable ``qt_mpa`` array column to ``cpt_series``.

**Why it is here.** Nullable because the value is only present for the CPT types that carry it, and existing rows have none.

.. CG-EXPLANATION-END id=function:upgrade

Function ``def downgrade``
--------------------------

.. CG-BLOCK id=function:downgrade lines=26-29

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/57421972dad9_add_qt_mpa_to_cpt_series.py
   :language: python
   :lines: 26-29
   :lineno-match:

.. CG-EXPLANATION-START id=function:downgrade

**What this does.** Drops the ``qt_mpa`` column, reversing the add.

**Why it is here.** So the chain can step back.

.. CG-EXPLANATION-END id=function:downgrade

