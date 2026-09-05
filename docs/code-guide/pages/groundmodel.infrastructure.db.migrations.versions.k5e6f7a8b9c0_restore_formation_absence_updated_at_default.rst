groundmodel.infrastructure.db.migrations.versions.k5e6f7a8b9c0_restore_formation_absence_updated_at_default
===========================================================================================================

.. CG-PAGE source=src/groundmodel/infrastructure/db/migrations/versions/k5e6f7a8b9c0_restore_formation_absence_updated_at_default.py complete=true

*Source file:* ``src/groundmodel/infrastructure/db/migrations/versions/k5e6f7a8b9c0_restore_formation_absence_updated_at_default.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-47

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/k5e6f7a8b9c0_restore_formation_absence_updated_at_default.py
   :language: python
   :lines: 1-47
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Header for the migration (revision ``k5e6f7a8b9c0``, following ``j4d5e6f7a8b9``) that restores the now-default on the ``formation_absence.updated_at`` column.

**Why it is here.** The docstring records the correction: revision ``i3c4d5e6f7a8`` dropped the default on a mistaken belief it would cause stale values on updates; in fact a *server default* fires only on insert, so with it dropped every insert left the column empty and violated the not-empty rule, breaking 11 integration tests. Restoring the default aligns the schema with the model contract.

.. CG-EXPLANATION-END id=module-header

Function ``def upgrade``
------------------------

.. CG-BLOCK id=function:upgrade lines=48-56

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/k5e6f7a8b9c0_restore_formation_absence_updated_at_default.py
   :language: python
   :lines: 48-56
   :lineno-match:

.. CG-EXPLANATION-START id=function:upgrade

**What this does.** Restores the now-default on the ``updated_at`` column.

**Why it is here.** The docstring explains this makes the database fill the column on insert, which is what the model expects; the change is safe to re-apply because setting the same default twice is a no-op.

.. CG-EXPLANATION-END id=function:upgrade

Function ``def downgrade``
--------------------------

.. CG-BLOCK id=function:downgrade lines=57-59

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/k5e6f7a8b9c0_restore_formation_absence_updated_at_default.py
   :language: python
   :lines: 57-59
   :lineno-match:

.. CG-EXPLANATION-START id=function:downgrade

**What this does.** Drops the default again, matching the pre-fix state.

**Why it is here.** This returns the column to the shape left by the earlier migration.

.. CG-EXPLANATION-END id=function:downgrade

