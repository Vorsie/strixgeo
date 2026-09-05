groundmodel.infrastructure.db.migrations.versions.a3f1d9c82b47_add_app_project_id_to_cpt
========================================================================================

.. CG-PAGE source=src/groundmodel/infrastructure/db/migrations/versions/a3f1d9c82b47_add_app_project_id_to_cpt.py complete=true

*Source file:* ``src/groundmodel/infrastructure/db/migrations/versions/a3f1d9c82b47_add_app_project_id_to_cpt.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-18

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/a3f1d9c82b47_add_app_project_id_to_cpt.py
   :language: python
   :lines: 1-18
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** A migration that adds an ``app_project_id`` column (and its index) to the CPT table.

**Why it is here.** The upgrade docstring records the reason: this is the app-level project scope, kept separate from the GEF file's own project identifier. A CPT belongs to one StrixGeo project regardless of what project code its source file carried.

.. CG-EXPLANATION-END id=module-header

Function ``def upgrade``
------------------------

.. CG-BLOCK id=function:upgrade lines=19-24

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/a3f1d9c82b47_add_app_project_id_to_cpt.py
   :language: python
   :lines: 19-24
   :lineno-match:

.. CG-EXPLANATION-START id=function:upgrade

**What this does.** Adds the nullable ``app_project_id`` column and an index over it.

**Why it is here.** The index speeds the very common "all CPTs in this project" query; nullable so existing rows can be assigned later.

.. CG-EXPLANATION-END id=function:upgrade

Function ``def downgrade``
--------------------------

.. CG-BLOCK id=function:downgrade lines=25-28

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/a3f1d9c82b47_add_app_project_id_to_cpt.py
   :language: python
   :lines: 25-28
   :lineno-match:

.. CG-EXPLANATION-START id=function:downgrade

**What this does.** Drops the index and the column.

**Why it is here.** So the chain can step backwards; the reverse of the add.

.. CG-EXPLANATION-END id=function:downgrade

