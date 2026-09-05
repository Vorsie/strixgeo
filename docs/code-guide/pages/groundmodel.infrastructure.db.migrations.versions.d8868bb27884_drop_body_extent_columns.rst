groundmodel.infrastructure.db.migrations.versions.d8868bb27884_drop_body_extent_columns
=======================================================================================

.. CG-PAGE source=src/groundmodel/infrastructure/db/migrations/versions/d8868bb27884_drop_body_extent_columns.py complete=true

*Source file:* ``src/groundmodel/infrastructure/db/migrations/versions/d8868bb27884_drop_body_extent_columns.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-50

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/d8868bb27884_drop_body_extent_columns.py
   :language: python
   :lines: 1-50
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** A migration that retires the ten per-side ``extent_*`` marker columns from the ``body`` table. The header carries its revision id, the id it follows, and a constant listing the ten columns.

**Why it is here.** The docstring explains the partition-fill model — member-layer chains keyed on body id plus the boundary-shape table — is now the single source of truth for body shape, so the extent columns and the enum they were checked against are dead, and their only live reader was removed in the same change. Backwards compatibility is suspended pre-ship, so this is a clean break.

.. CG-EXPLANATION-END id=module-header

Function ``def upgrade``
------------------------

.. CG-BLOCK id=function:upgrade lines=51-68

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/d8868bb27884_drop_body_extent_columns.py
   :language: python
   :lines: 51-68
   :lineno-match:

.. CG-EXPLANATION-START id=function:upgrade

**What this does.** Inside one table alteration, drops the two kind-check constraints, then the two anchor-layer foreign keys, then all ten extent columns; the inline target-contact foreign keys drop with their columns.

**Why it is here.** Constraints are dropped before the columns they reference. The comment notes PostgreSQL DDL is transactional, so a failure mid-batch rolls the whole thing back and never leaves the table half-migrated.

.. CG-EXPLANATION-END id=function:upgrade

Function ``def downgrade``
--------------------------

.. CG-BLOCK id=function:downgrade lines=69-71

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/d8868bb27884_drop_body_extent_columns.py
   :language: python
   :lines: 69-71
   :lineno-match:

.. CG-EXPLANATION-START id=function:downgrade

**What this does.** Refuses, raising a not-implemented error.

**Why it is here.** The docstring states backwards compatibility is suspended pre-ship, so there is no downgrade for this clean break.

.. CG-EXPLANATION-END id=function:downgrade

