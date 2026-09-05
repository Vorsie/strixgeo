groundmodel.infrastructure.db.migrations.versions.cf77c4baaddf_drop_avg_qc_mpa_from_cpt
=======================================================================================

.. CG-PAGE source=src/groundmodel/infrastructure/db/migrations/versions/cf77c4baaddf_drop_avg_qc_mpa_from_cpt.py complete=true

*Source file:* ``src/groundmodel/infrastructure/db/migrations/versions/cf77c4baaddf_drop_avg_qc_mpa_from_cpt.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-18

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/cf77c4baaddf_drop_avg_qc_mpa_from_cpt.py
   :language: python
   :lines: 1-18
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** A short migration that removes the ``avg_qc_mpa`` column from the ``cpt`` table. The header carries its revision id and the id it follows.

**Why it is here.** The docstring says the average is not needed as a stored summary — in line with the rule that a value derivable from the series is computed on read rather than stored, so the database cannot disagree with its own inputs (CLAUDE.md Data Integrity Rule 1).

.. CG-EXPLANATION-END id=module-header

Function ``def upgrade``
------------------------

.. CG-BLOCK id=function:upgrade lines=19-23

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/cf77c4baaddf_drop_avg_qc_mpa_from_cpt.py
   :language: python
   :lines: 19-23
   :lineno-match:

.. CG-EXPLANATION-START id=function:upgrade

**What this does.** Drops the ``avg_qc_mpa`` column from ``cpt``.

**Why it is here.** The average cone resistance is derivable from the stored series, so keeping it as a column adds a value that could go stale.

.. CG-EXPLANATION-END id=function:upgrade

Function ``def downgrade``
--------------------------

.. CG-BLOCK id=function:downgrade lines=24-26

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/cf77c4baaddf_drop_avg_qc_mpa_from_cpt.py
   :language: python
   :lines: 24-26
   :lineno-match:

.. CG-EXPLANATION-START id=function:downgrade

**What this does.** Re-adds ``avg_qc_mpa`` as a nullable column; restored rows are left empty.

**Why it is here.** The docstring notes the value can be recomputed from the series, so restoring the column empty is enough to return to the earlier shape.

.. CG-EXPLANATION-END id=function:downgrade

