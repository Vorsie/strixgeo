groundmodel.infrastructure.db.migrations.versions.b9f3c7e2a1d4_add_cpt_provenance_flags
=======================================================================================

.. CG-PAGE source=src/groundmodel/infrastructure/db/migrations/versions/b9f3c7e2a1d4_add_cpt_provenance_flags.py complete=true

*Source file:* ``src/groundmodel/infrastructure/db/migrations/versions/b9f3c7e2a1d4_add_cpt_provenance_flags.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-18

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/b9f3c7e2a1d4_add_cpt_provenance_flags.py
   :language: python
   :lines: 1-18
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** A migration that adds two small provenance columns, ``rf_source`` and ``qt_source``, to the ``cpt_series`` table (the per-CPT depth-series storage). The header names its revision id and the one it follows.

**Why it is here.** Each flag records whether that quantity was measured at the source or computed by the parser — provenance, per CLAUDE.md Data Integrity Rule 1 (tag provenance on derived values). The upgrade comment states this.

.. CG-EXPLANATION-END id=module-header

Function ``def upgrade``
------------------------

.. CG-BLOCK id=function:upgrade lines=19-26

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/b9f3c7e2a1d4_add_cpt_provenance_flags.py
   :language: python
   :lines: 19-26
   :lineno-match:

.. CG-EXPLANATION-START id=function:upgrade

**What this does.** Adds two nullable text columns to ``cpt_series``: ``rf_source`` and ``qt_source``.

**Why it is here.** The comment explains each flag marks a value as measured (came from the file) or computed (derived by the parser). They are nullable because older rows have unknown provenance, so the desktop must handle an empty value gracefully.

.. CG-EXPLANATION-END id=function:upgrade

Function ``def downgrade``
--------------------------

.. CG-BLOCK id=function:downgrade lines=27-29

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/b9f3c7e2a1d4_add_cpt_provenance_flags.py
   :language: python
   :lines: 27-29
   :lineno-match:

.. CG-EXPLANATION-START id=function:downgrade

**What this does.** Drops the two columns in reverse order, ``qt_source`` then ``rf_source``.

**Why it is here.** The exact reverse of the upgrade.

.. CG-EXPLANATION-END id=function:downgrade

