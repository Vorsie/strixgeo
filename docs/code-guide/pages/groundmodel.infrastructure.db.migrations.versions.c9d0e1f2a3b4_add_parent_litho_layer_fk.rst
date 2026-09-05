groundmodel.infrastructure.db.migrations.versions.c9d0e1f2a3b4_add_parent_litho_layer_fk
========================================================================================

.. CG-PAGE source=src/groundmodel/infrastructure/db/migrations/versions/c9d0e1f2a3b4_add_parent_litho_layer_fk.py complete=true

*Source file:* ``src/groundmodel/infrastructure/db/migrations/versions/c9d0e1f2a3b4_add_parent_litho_layer_fk.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-34

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/c9d0e1f2a3b4_add_parent_litho_layer_fk.py
   :language: python
   :lines: 1-34
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** A migration that adds a self-referential foreign key ``parent_litho_layer_id`` to ``litho_layer``, links a geotech band to its covering litho band, and backfills existing rows. The header carries its revision id and the id it follows.

**Why it is here.** The docstring records the owner asking for a plain database foreign key. It is kept at band level, not body level, because litho recomputes re-mint body ids, so a body-to-body link would break on every recompute, whereas the covering litho band is stable. It is nullable and additive so every existing .strix restores, with empty meaning a true orphan the Parameters tree reports honestly.

.. CG-EXPLANATION-END id=module-header

Function ``def upgrade``
------------------------

.. CG-BLOCK id=function:upgrade lines=35-75

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/c9d0e1f2a3b4_add_parent_litho_layer_fk.py
   :language: python
   :lines: 35-75
   :lineno-match:

.. CG-EXPLANATION-START id=function:upgrade

**What this does.** Adds the nullable self-foreign-key column set to clear on delete, indexes it, then backfills each geotech-model band with the accepted litho band on the same investigation whose depth interval contains the band's vertical midpoint.

**Why it is here.** The midpoint rule plus the litho contiguity guarantee means at most one covering litho band matches, so the backfill is unambiguous.

.. CG-EXPLANATION-END id=function:upgrade

Function ``def downgrade``
--------------------------

.. CG-BLOCK id=function:downgrade lines=76-80

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/c9d0e1f2a3b4_add_parent_litho_layer_fk.py
   :language: python
   :lines: 76-80
   :lineno-match:

.. CG-EXPLANATION-START id=function:downgrade

**What this does.** Drops the index, the foreign key and the column.

**Why it is here.** The exact reverse of the upgrade.

.. CG-EXPLANATION-END id=function:downgrade

