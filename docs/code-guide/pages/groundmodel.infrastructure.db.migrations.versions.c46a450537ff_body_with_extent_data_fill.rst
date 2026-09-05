groundmodel.infrastructure.db.migrations.versions.c46a450537ff_body_with_extent_data_fill
=========================================================================================

.. CG-PAGE source=src/groundmodel/infrastructure/db/migrations/versions/c46a450537ff_body_with_extent_data_fill.py complete=true

*Source file:* ``src/groundmodel/infrastructure/db/migrations/versions/c46a450537ff_body_with_extent_data_fill.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-20

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/c46a450537ff_body_with_extent_data_fill.py
   :language: python
   :lines: 1-20
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** A migration whose job is to fill in values on existing rows (a backfill) rather than change the table shape. The header carries its revision id and the id it follows.

**Why it is here.** It is one step of the multi-stage body-with-extent rewrite. It sets up two links the later steps rely on before an old column is dropped.

.. CG-EXPLANATION-END id=module-header

Function ``def upgrade``
------------------------

.. CG-BLOCK id=function:upgrade lines=21-110

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/c46a450537ff_body_with_extent_data_fill.py
   :language: python
   :lines: 21-110
   :lineno-match:

.. CG-EXPLANATION-START id=function:upgrade

**What this does.** Runs two SQL updates. First it copies each lens shape's parent body id by matching on the old content key. Second it fills each lens's source-investigation id, chosen as the most-common investigation among the three contacts named in the lens's content key, with ties broken deterministically.

**Why it is here.** The docstring explains that in the bilateral lens geometry the two source contacts share one investigation and the target is on another, so the majority investigation is always the source side. Both updates touch only rows still missing the value, so re-running the migration is safe. It deliberately does not fill the extent columns — a start-up sweep repopulates those later.

.. CG-EXPLANATION-END id=function:upgrade

Function ``def downgrade``
--------------------------

.. CG-BLOCK id=function:downgrade lines=111-131

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/c46a450537ff_body_with_extent_data_fill.py
   :language: python
   :lines: 111-131
   :lineno-match:

.. CG-EXPLANATION-START id=function:downgrade

**What this does.** Clears the two filled columns back to empty.

**Why it is here.** The values are re-derivable, so the docstring calls this forward-only in spirit; clearing them simply returns the database to its pre-fill state so the step below stays consistent.

.. CG-EXPLANATION-END id=function:downgrade

