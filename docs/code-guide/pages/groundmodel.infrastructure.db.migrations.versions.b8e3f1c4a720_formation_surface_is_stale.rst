groundmodel.infrastructure.db.migrations.versions.b8e3f1c4a720_formation_surface_is_stale
=========================================================================================

.. CG-PAGE source=src/groundmodel/infrastructure/db/migrations/versions/b8e3f1c4a720_formation_surface_is_stale.py complete=true

*Source file:* ``src/groundmodel/infrastructure/db/migrations/versions/b8e3f1c4a720_formation_surface_is_stale.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-38

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/b8e3f1c4a720_formation_surface_is_stale.py
   :language: python
   :lines: 1-38
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** A migration that adds one true/false column, ``is_stale``, to the ``formation_surface`` table. The header carries its revision id and the id of the migration it follows.

**Why it is here.** The docstring records the on-click build change. Editing a contact used to rebuild the cached surface (its triangulated network, a TIN) straight away. Now an edit just flips ``is_stale`` to true — a cheap one-row update — and only the user's explicit rebuild clears it back. The column is kept per formation, not per model, so a future Phase-5 build can rebuild only the affected formations.

.. CG-EXPLANATION-END id=module-header

Function ``def upgrade``
------------------------

.. CG-BLOCK id=function:upgrade lines=39-51

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/b8e3f1c4a720_formation_surface_is_stale.py
   :language: python
   :lines: 39-51
   :lineno-match:

.. CG-EXPLANATION-START id=function:upgrade

**What this does.** Adds the ``is_stale`` boolean column, not-nullable, defaulting to false.

**Why it is here.** A default of false means every existing surface — all built under the old always-recompute rule — reads as fresh with no backfill and raises no false stale warning on first launch; new edits set it true. Not-nullable so every surface always carries a definite fresh-or-stale answer.

.. CG-EXPLANATION-END id=function:upgrade

Function ``def downgrade``
--------------------------

.. CG-BLOCK id=function:downgrade lines=52-54

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/b8e3f1c4a720_formation_surface_is_stale.py
   :language: python
   :lines: 52-54
   :lineno-match:

.. CG-EXPLANATION-START id=function:downgrade

**What this does.** Drops the ``is_stale`` column.

**Why it is here.** The exact reverse of the upgrade.

.. CG-EXPLANATION-END id=function:downgrade

