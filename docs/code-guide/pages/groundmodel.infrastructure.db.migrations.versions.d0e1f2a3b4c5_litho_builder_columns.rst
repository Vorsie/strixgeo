groundmodel.infrastructure.db.migrations.versions.d0e1f2a3b4c5_litho_builder_columns
====================================================================================

.. CG-PAGE source=src/groundmodel/infrastructure/db/migrations/versions/d0e1f2a3b4c5_litho_builder_columns.py complete=true

*Source file:* ``src/groundmodel/infrastructure/db/migrations/versions/d0e1f2a3b4c5_litho_builder_columns.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-43

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/d0e1f2a3b4c5_litho_builder_columns.py
   :language: python
   :lines: 1-43
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** A migration that adds five litho-builder columns and one index to ``geological_formation``. The header carries its revision id and the id it follows, plus module constants naming the table and index.

**Why it is here.** The docstring lists the columns the Litho Builder's first phase needs: a self-foreign-key to the parent geological formation; the main soil code (one of ZAND, KLEI, SILT, GRIND, VEEN); an ordered JSONB admixture list; an instance ordinal for same-composition units; and a lock flag that stops the auto-resolver overwriting a hand-assigned ordinal. Each is empty on plain geological-model rows where the concept does not apply.

.. CG-EXPLANATION-END id=module-header

Function ``def upgrade``
------------------------

.. CG-BLOCK id=function:upgrade lines=44-94

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/d0e1f2a3b4c5_litho_builder_columns.py
   :language: python
   :lines: 44-94
   :lineno-match:

.. CG-EXPLANATION-START id=function:upgrade

**What this does.** Adds the five columns — parent formation id (self-foreign-key, clear-on-delete), main soil code, admixtures (JSONB), instance ordinal, and its lock flag defaulting to false — then a composite index over (project, parent, soil code).

**Why it is here.** Clear-on-delete on the parent link means deleting a geological formation degrades a litho unit to parentless rather than cascading and wiping the user's litho work. The index accelerates the Accept step's find-or-create key lookup, as the docstring states.

.. CG-EXPLANATION-END id=function:upgrade

Function ``def downgrade``
--------------------------

.. CG-BLOCK id=function:downgrade lines=95-102

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/d0e1f2a3b4c5_litho_builder_columns.py
   :language: python
   :lines: 95-102
   :lineno-match:

.. CG-EXPLANATION-START id=function:downgrade

**What this does.** Drops the index and the five columns in reverse order.

**Why it is here.** The exact reverse of the upgrade.

.. CG-EXPLANATION-END id=function:downgrade

