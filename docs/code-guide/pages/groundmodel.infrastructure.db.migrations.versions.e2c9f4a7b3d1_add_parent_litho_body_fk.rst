groundmodel.infrastructure.db.migrations.versions.e2c9f4a7b3d1_add_parent_litho_body_fk
=======================================================================================

.. CG-PAGE source=src/groundmodel/infrastructure/db/migrations/versions/e2c9f4a7b3d1_add_parent_litho_body_fk.py complete=true

*Source file:* ``src/groundmodel/infrastructure/db/migrations/versions/e2c9f4a7b3d1_add_parent_litho_body_fk.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-45

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/e2c9f4a7b3d1_add_parent_litho_body_fk.py
   :language: python
   :lines: 1-45
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** A migration that adds a self-referential foreign key ``parent_litho_body_id`` to ``body``, naming a geotech body's litho parent body. The header carries its revision id and the id it follows.

**Why it is here.** The docstring records the owner ruling that one connected geotech body should be one row with a link to its litho parent, stored so the units pane, fence and exports read it from a single column. It deliberately reverses the earlier band-only decision, and the docstring explains it no longer dangles because the resolver now re-stamps this link in the same transaction as every litho and geotech resolve; clear-on-delete catches the residual case where a litho body row is deleted outright.

.. CG-EXPLANATION-END id=module-header

Function ``def upgrade``
------------------------

.. CG-BLOCK id=function:upgrade lines=46-66

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/e2c9f4a7b3d1_add_parent_litho_body_fk.py
   :language: python
   :lines: 46-66
   :lineno-match:

.. CG-EXPLANATION-START id=function:upgrade

**What this does.** Adds the nullable self-foreign-key column set to clear on delete and indexes it; no backfill, because the next resolve stamps every body.

**Why it is here.** The docstring notes it is nullable and additive so every existing .strix restores, with empty meaning no derivable litho parent.

.. CG-EXPLANATION-END id=function:upgrade

Function ``def downgrade``
--------------------------

.. CG-BLOCK id=function:downgrade lines=67-71

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/e2c9f4a7b3d1_add_parent_litho_body_fk.py
   :language: python
   :lines: 67-71
   :lineno-match:

.. CG-EXPLANATION-START id=function:downgrade

**What this does.** Drops the index, the foreign key and the column.

**Why it is here.** The exact reverse of the upgrade; the docstring calls it additive and cleanly reversible.

.. CG-EXPLANATION-END id=function:downgrade

