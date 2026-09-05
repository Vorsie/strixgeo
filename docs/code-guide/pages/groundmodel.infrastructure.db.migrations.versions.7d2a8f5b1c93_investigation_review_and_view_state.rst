groundmodel.infrastructure.db.migrations.versions.7d2a8f5b1c93_investigation_review_and_view_state
==================================================================================================

.. CG-PAGE source=src/groundmodel/infrastructure/db/migrations/versions/7d2a8f5b1c93_investigation_review_and_view_state.py complete=true

*Source file:* ``src/groundmodel/infrastructure/db/migrations/versions/7d2a8f5b1c93_investigation_review_and_view_state.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-50

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/7d2a8f5b1c93_investigation_review_and_view_state.py
   :language: python
   :lines: 1-50
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Opens a migration that lands two things: the ``investigation_review`` table (a per-investigation decision row) and a ``view_state`` JSON column on the project. Names its revision id and the migration it follows.

**Why it is here.** The docstring records both serve the "all engineering decisions persist in the .gmproj bundle" principle (memory: project_decisions_in_bundle): without them, opening a bundle on a wiped database could not rehydrate review state or project view toggles, which would then live only in the browser's local storage and break the moment the file is shared or moved to another machine.

.. CG-EXPLANATION-END id=module-header

Function ``def upgrade``
------------------------

.. CG-BLOCK id=function:upgrade lines=51-154

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/7d2a8f5b1c93_investigation_review_and_view_state.py
   :language: python
   :lines: 51-154
   :lineno-match:

.. CG-EXPLANATION-START id=function:upgrade

**What this does.** Creates ``investigation_review`` (a polymorphic anchor of target-kind plus target-id, a review status, notes, a reviewed-at time, and a hidden flag) with a uniqueness rule of one row per target and check constraints on the allowed kinds and statuses, plus indexes; then adds a ``view_state`` JSON column to ``project`` defaulting to an empty object.

**Why it is here.** The comments record the decision-row-per-investigation shape avoids bloating the CPT and borehole tables with mostly-default columns across thousands of investigations, and one polymorphic table means a future decision field is one column in one place; the kinds and statuses are check constraints rather than database enums so adding a value is a constraint edit, not a type rewrite. The hidden flag replaces a browser-local-storage hide so the soft hide rides in the bundle (no row is deleted).

.. CG-EXPLANATION-END id=function:upgrade

Function ``def downgrade``
--------------------------

.. CG-BLOCK id=function:downgrade lines=155-160

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/7d2a8f5b1c93_investigation_review_and_view_state.py
   :language: python
   :lines: 155-160
   :lineno-match:

.. CG-EXPLANATION-START id=function:downgrade

**What this does.** Drops the project ``view_state`` column, then the two indexes and the ``investigation_review`` table.

**Why it is here.** So the chain can step back.

.. CG-EXPLANATION-END id=function:downgrade

