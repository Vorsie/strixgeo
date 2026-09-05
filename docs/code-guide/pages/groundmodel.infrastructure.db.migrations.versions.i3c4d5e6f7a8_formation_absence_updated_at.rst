groundmodel.infrastructure.db.migrations.versions.i3c4d5e6f7a8_formation_absence_updated_at
===========================================================================================

.. CG-PAGE source=src/groundmodel/infrastructure/db/migrations/versions/i3c4d5e6f7a8_formation_absence_updated_at.py complete=true

*Source file:* ``src/groundmodel/infrastructure/db/migrations/versions/i3c4d5e6f7a8_formation_absence_updated_at.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-25

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/i3c4d5e6f7a8_formation_absence_updated_at.py
   :language: python
   :lines: 1-25
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Header for the migration (revision ``i3c4d5e6f7a8``, following ``h2b3c4d5e6f7``) that adds an ``updated_at`` timestamp column to the ``formation_absence`` table.

**Why it is here.** The docstring records that the model was extended with an ``updated_at`` column to track when an absence record was last touched by the inference engine, and the migration that created the table pre-dates that change, so this migration fills the schema gap.

.. CG-EXPLANATION-END id=module-header

Function ``def upgrade``
------------------------

.. CG-BLOCK id=function:upgrade lines=26-47

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/i3c4d5e6f7a8_formation_absence_updated_at.py
   :language: python
   :lines: 26-47
   :lineno-match:

.. CG-EXPLANATION-START id=function:upgrade

**What this does.** Adds the not-empty ``updated_at`` timestamp column, temporarily defaulting it to now so existing rows are filled, then drops that default.

**Why it is here.** The docstring's reasoning here — that the default should be dropped to avoid stale values on updates outside the ORM — was later found wrong and corrected in revision ``k5e6f7a8b9c0``, which restores the default.

.. CG-EXPLANATION-END id=function:upgrade

Function ``def downgrade``
--------------------------

.. CG-BLOCK id=function:downgrade lines=48-50

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/i3c4d5e6f7a8_formation_absence_updated_at.py
   :language: python
   :lines: 48-50
   :lineno-match:

.. CG-EXPLANATION-START id=function:downgrade

**What this does.** Removes the ``updated_at`` column.

**Why it is here.** This reverses the single-column addition.

.. CG-EXPLANATION-END id=function:downgrade

