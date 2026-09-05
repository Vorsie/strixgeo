groundmodel.infrastructure.db.migrations.versions.a91c4e7b6f23_add_dov_permkey_for_refresh
==========================================================================================

.. CG-PAGE source=src/groundmodel/infrastructure/db/migrations/versions/a91c4e7b6f23_add_dov_permkey_for_refresh.py complete=true

*Source file:* ``src/groundmodel/infrastructure/db/migrations/versions/a91c4e7b6f23_add_dov_permkey_for_refresh.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-48

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/a91c4e7b6f23_add_dov_permkey_for_refresh.py
   :language: python
   :lines: 1-48
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** A migration that adds a nullable ``dov_permkey`` column to every borehole- or sample-child table holding DOV data, plus a partial unique index per parent.

**Why it is here.** The docstring records the purpose: a *permkey* is DOV's stable permanent identifier for a record, so a future re-import can detect "row already stored" by upstream identity rather than by whether the whole borehole was new. A *partial unique index* forbids duplicate values only among rows that have a permkey; it is partial (not a hard not-null) because legacy rows have no permkey and must neither be guessed nor refused. Empty permkey means no upstream identity and never takes part in duplicate detection.

.. CG-EXPLANATION-END id=module-header

Function ``def upgrade``
------------------------

.. CG-BLOCK id=function:upgrade lines=49-60

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/a91c4e7b6f23_add_dov_permkey_for_refresh.py
   :language: python
   :lines: 49-60
   :lineno-match:

.. CG-EXPLANATION-START id=function:upgrade

**What this does.** For each covered table, adds the nullable permkey column and the per-parent partial unique index over the parent-and-permkey pair.

**Why it is here.** The unique index enforces one row per upstream identity within a parent, which is what makes idempotent re-import possible; scoping it per parent matches how DOV identity is scoped.

.. CG-EXPLANATION-END id=function:upgrade

Function ``def downgrade``
--------------------------

.. CG-BLOCK id=function:downgrade lines=61-64

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/a91c4e7b6f23_add_dov_permkey_for_refresh.py
   :language: python
   :lines: 61-64
   :lineno-match:

.. CG-EXPLANATION-START id=function:downgrade

**What this does.** For each covered table, drops the index and the permkey column.

**Why it is here.** So the chain can step backwards; the reverse of the upgrade.

.. CG-EXPLANATION-END id=function:downgrade

