groundmodel.infrastructure.db.migrations.versions.d70b1a8e9c34_drop_qt_mpa_from_cpt_series
==========================================================================================

.. CG-PAGE source=src/groundmodel/infrastructure/db/migrations/versions/d70b1a8e9c34_drop_qt_mpa_from_cpt_series.py complete=true

*Source file:* ``src/groundmodel/infrastructure/db/migrations/versions/d70b1a8e9c34_drop_qt_mpa_from_cpt_series.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-34

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/d70b1a8e9c34_drop_qt_mpa_from_cpt_series.py
   :language: python
   :lines: 1-34
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** A migration that drops the ``qt_mpa`` column from ``cpt_series`` because the CPTU corrected cone resistance is computed on read. The header carries its revision id and the id it follows.

**Why it is here.** The docstring explains qt = qc + u2(1 minus a) is fundamentally a calculation, not an instrument reading — even when a file supplies it, the same arithmetic reproduces it from the stored qc, u2 and cone-area ratio. Per CLAUDE.md Data Integrity Rule 1, derivable values are computed on read so the database can never disagree with its inputs. The CPTM total resistance is left untouched because it is a real measurement.

.. CG-EXPLANATION-END id=module-header

Function ``def upgrade``
------------------------

.. CG-BLOCK id=function:upgrade lines=35-38

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/d70b1a8e9c34_drop_qt_mpa_from_cpt_series.py
   :language: python
   :lines: 35-38
   :lineno-match:

.. CG-EXPLANATION-START id=function:upgrade

**What this does.** Drops the ``qt_mpa`` column from ``cpt_series``.

**Why it is here.** Its inputs (qc, u2, cone-area ratio) are preserved, so qt is losslessly recomputed for each plot request; storing it would only risk going stale after a row edit.

.. CG-EXPLANATION-END id=function:upgrade

Function ``def downgrade``
--------------------------

.. CG-BLOCK id=function:downgrade lines=39-47

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/d70b1a8e9c34_drop_qt_mpa_from_cpt_series.py
   :language: python
   :lines: 39-47
   :lineno-match:

.. CG-EXPLANATION-START id=function:downgrade

**What this does.** Re-adds ``qt_mpa`` as a nullable array, left empty on every row.

**Why it is here.** The comment notes a restored row cannot be told apart from one whose source did not provide qt, so callers should recompute it from the surviving inputs.

.. CG-EXPLANATION-END id=function:downgrade

