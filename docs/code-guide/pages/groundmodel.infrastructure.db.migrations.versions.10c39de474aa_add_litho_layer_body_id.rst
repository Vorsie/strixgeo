groundmodel.infrastructure.db.migrations.versions.10c39de474aa_add_litho_layer_body_id
======================================================================================

.. CG-PAGE source=src/groundmodel/infrastructure/db/migrations/versions/10c39de474aa_add_litho_layer_body_id.py complete=true

*Source file:* ``src/groundmodel/infrastructure/db/migrations/versions/10c39de474aa_add_litho_layer_body_id.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-27

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/10c39de474aa_add_litho_layer_body_id.py
   :language: python
   :lines: 1-27
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Opens the migration that adds a ``body_id`` link to the ``litho_layer`` table. Names its revision id and the migration it follows.

**Why it is here.** The docstring records this is the database half of the per-instance body-identity feature: each distinct uncorrelated litho unit becomes its own instance backed by a ``body`` row. The column is nullable because legacy layers have no body.

.. CG-EXPLANATION-END id=module-header

Function ``def upgrade``
------------------------

.. CG-BLOCK id=function:upgrade lines=28-44

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/10c39de474aa_add_litho_layer_body_id.py
   :language: python
   :lines: 28-44
   :lineno-match:

.. CG-EXPLANATION-START id=function:upgrade

**What this does.** Adds the nullable ``body_id`` column, a foreign key from it to the ``body`` table with delete-sets-null, and an index over it.

**Why it is here.** The docstring records the delete rule is ``ON DELETE SET NULL`` so deleting a body orphans the layer rather than cascading the layer away with it; the index makes "which layers belong to this body" fast.

.. CG-EXPLANATION-END id=function:upgrade

Function ``def downgrade``
--------------------------

.. CG-BLOCK id=function:downgrade lines=45-49

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/10c39de474aa_add_litho_layer_body_id.py
   :language: python
   :lines: 45-49
   :lineno-match:

.. CG-EXPLANATION-START id=function:downgrade

**What this does.** Drops the index, the foreign key, and the column, reversing the upgrade.

**Why it is here.** So the chain can step back; the index and constraint are removed before the column they depend on.

.. CG-EXPLANATION-END id=function:downgrade

