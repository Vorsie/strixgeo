groundmodel.infrastructure.db.migrations.versions.c4d5e6f7a8b9_add_body_geometry_fact
=====================================================================================

.. CG-PAGE source=src/groundmodel/infrastructure/db/migrations/versions/c4d5e6f7a8b9_add_body_geometry_fact.py complete=true

*Source file:* ``src/groundmodel/infrastructure/db/migrations/versions/c4d5e6f7a8b9_add_body_geometry_fact.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-26

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/c4d5e6f7a8b9_add_body_geometry_fact.py
   :language: python
   :lines: 1-26
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** A migration that adds one new table, ``body_geometry_fact``. The header names its revision id and the one it follows.

**Why it is here.** The docstring records the owner ruling that every set of same-lithology units whose fill regions touch must share one body id, so qc or sample data can be read per body. The geometric merge used to live twice as throwaway maps; this table persists it — the observed adjacent layer pairs the resolver unions alongside the user's approved correlation edges.

.. CG-EXPLANATION-END id=module-header

Function ``def upgrade``
------------------------

.. CG-BLOCK id=function:upgrade lines=27-63

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/c4d5e6f7a8b9_add_body_geometry_fact.py
   :language: python
   :lines: 27-63
   :lineno-match:

.. CG-EXPLANATION-START id=function:upgrade

**What this does.** Creates ``body_geometry_fact`` with an id, the model it belongs to, two litho-layer ids naming the touching pair, and a creation timestamp. It adds a check constraint forcing the two layer ids into a fixed order, a uniqueness rule on (model, layer A, layer B), and an index on the model.

**Why it is here.** The forced ordering plus the uniqueness rule mean each touching pair is stored once, never twice in mirror image. The foreign keys with cascade delete tie the fact to its model and layers so it disappears when they do.

.. CG-EXPLANATION-END id=function:upgrade

Function ``def downgrade``
--------------------------

.. CG-BLOCK id=function:downgrade lines=64-67

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/c4d5e6f7a8b9_add_body_geometry_fact.py
   :language: python
   :lines: 64-67
   :lineno-match:

.. CG-EXPLANATION-START id=function:downgrade

**What this does.** Drops the index and the table.

**Why it is here.** The exact reverse of the upgrade.

.. CG-EXPLANATION-END id=function:downgrade

