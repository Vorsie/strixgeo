groundmodel.infrastructure.db.migrations.versions.d5e9a1f8b40c_add_elevation_source
===================================================================================

.. CG-PAGE source=src/groundmodel/infrastructure/db/migrations/versions/d5e9a1f8b40c_add_elevation_source.py complete=true

*Source file:* ``src/groundmodel/infrastructure/db/migrations/versions/d5e9a1f8b40c_add_elevation_source.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-39

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/d5e9a1f8b40c_add_elevation_source.py
   :language: python
   :lines: 1-39
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** A migration that adds an ``elevation_source`` column to both ``cpt`` and ``borehole`` and backfills it. The header carries its revision id and the id it follows.

**Why it is here.** The docstring records debt #8: the refresh-on-duplicate import must be able to overwrite an imported elevation (say DOV corrected a value) without clobbering a manual edit the user made afterwards, and the provenance column is how it tells the two apart. It is stored as a short text value rather than a database ENUM type so that adding a new source later needs no separate type-altering migration.

.. CG-EXPLANATION-END id=module-header

Function ``def upgrade``
------------------------

.. CG-BLOCK id=function:upgrade lines=40-76

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/d5e9a1f8b40c_add_elevation_source.py
   :language: python
   :lines: 40-76
   :lineno-match:

.. CG-EXPLANATION-START id=function:upgrade

**What this does.** Adds the column as nullable on both tables, backfills each row — empty elevation becomes none, a DOV-tagged row becomes dov, any other row with an elevation becomes gef — then flips the column to not-nullable.

**Why it is here.** Adding nullable first lets existing rows be backfilled before the not-null rule is enforced, so every row ends up carrying a definite provenance. This serves the elevation-trust rule that a manual edit outranks an imported value (CLAUDE.local.md).

.. CG-EXPLANATION-END id=function:upgrade

Function ``def downgrade``
--------------------------

.. CG-BLOCK id=function:downgrade lines=77-79

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/d5e9a1f8b40c_add_elevation_source.py
   :language: python
   :lines: 77-79
   :lineno-match:

.. CG-EXPLANATION-START id=function:downgrade

**What this does.** Drops the ``elevation_source`` column from both tables.

**Why it is here.** The exact reverse of the upgrade.

.. CG-EXPLANATION-END id=function:downgrade

