groundmodel.infrastructure.db.migrations.versions.z0a1b2c3d4e5_body_boundary_shape_parity_fix
=============================================================================================

.. CG-PAGE source=src/groundmodel/infrastructure/db/migrations/versions/z0a1b2c3d4e5_body_boundary_shape_parity_fix.py complete=true

*Source file:* ``src/groundmodel/infrastructure/db/migrations/versions/z0a1b2c3d4e5_body_boundary_shape_parity_fix.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-47

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/z0a1b2c3d4e5_body_boundary_shape_parity_fix.py
   :language: python
   :lines: 1-47
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Header for the migration (revision ``z0a1b2c3d4e5``, following ``y9z0a1b2c3d4``) that reconciles the live ``body_boundary_shape`` table with its model after the body-with-extent rename left four details behind. It sets ``DATA_REWRITE = True``.

**Why it is here.** The docstring records TEST-08: the earlier rename swapped the table's key for a direct body foreign key but never tightened the body id to not-empty, never added the one-shape-per-body unique constraint, and never dropped two stale timestamp columns, so a schema-comparison tool reported genuine drift. The flag names it among the data-rewriting migrations the migrator backs up first (audit H2b).

.. CG-EXPLANATION-END id=module-header

Function ``def upgrade``
------------------------

.. CG-BLOCK id=function:upgrade lines=48-75

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/z0a1b2c3d4e5_body_boundary_shape_parity_fix.py
   :language: python
   :lines: 48-75
   :lineno-match:

.. CG-EXPLANATION-START id=function:upgrade

**What this does.** Deletes rows with an empty body id, de-duplicates rows sharing a body id (keeping the lexically first), tightens the body id to not-empty, adds the one-shape-per-body unique constraint, and drops the two stale timestamp columns.

**Why it is here.** The docstring explains the delete and de-duplicate steps clear the orphan and degenerate rows first so the not-empty and unique tightening cannot fail on existing data; a shape without its body is meaningless.

.. CG-EXPLANATION-END id=function:upgrade

Function ``def downgrade``
--------------------------

.. CG-BLOCK id=function:downgrade lines=76-78

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/z0a1b2c3d4e5_body_boundary_shape_parity_fix.py
   :language: python
   :lines: 76-78
   :lineno-match:

.. CG-EXPLANATION-START id=function:downgrade

**What this does.** Raises an error instead of reversing.

**Why it is here.** The docstring states there is no downgrade because backwards-compatibility is suspended pre-ship; this is a forward-only reconciliation.

.. CG-EXPLANATION-END id=function:downgrade

