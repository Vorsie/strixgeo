groundmodel.infrastructure.db.migrations.versions.c2d3e4f5a6b7_add_body_app_project_id_index
============================================================================================

.. CG-PAGE source=src/groundmodel/infrastructure/db/migrations/versions/c2d3e4f5a6b7_add_body_app_project_id_index.py complete=true

*Source file:* ``src/groundmodel/infrastructure/db/migrations/versions/c2d3e4f5a6b7_add_body_app_project_id_index.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-24

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/c2d3e4f5a6b7_add_body_app_project_id_index.py
   :language: python
   :lines: 1-24
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** A migration that adds one index to the ``body`` table, on its ``app_project_id`` column. The header names its revision id and the one it follows.

**Why it is here.** The docstring explains that saving and restoring a project both filter bodies by project id; without an index that is a full-table scan every time. Every other project-scoped root table already had such an index; ``body`` was the one missing it.

.. CG-EXPLANATION-END id=module-header

Function ``def upgrade``
------------------------

.. CG-BLOCK id=function:upgrade lines=25-29

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/c2d3e4f5a6b7_add_body_app_project_id_index.py
   :language: python
   :lines: 25-29
   :lineno-match:

.. CG-EXPLANATION-START id=function:upgrade

**What this does.** Creates the index ``idx_body_app_project_id`` on the ``body`` table's project-id column.

**Why it is here.** An index is a lookup shortcut; this one makes reading all bodies in one project fast on every save and restore, matching the other root tables.

.. CG-EXPLANATION-END id=function:upgrade

Function ``def downgrade``
--------------------------

.. CG-BLOCK id=function:downgrade lines=30-32

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/c2d3e4f5a6b7_add_body_app_project_id_index.py
   :language: python
   :lines: 30-32
   :lineno-match:

.. CG-EXPLANATION-START id=function:downgrade

**What this does.** Drops that index.

**Why it is here.** The exact reverse of the upgrade.

.. CG-EXPLANATION-END id=function:downgrade

