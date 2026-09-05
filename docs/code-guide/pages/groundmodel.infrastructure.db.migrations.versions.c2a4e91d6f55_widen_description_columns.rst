groundmodel.infrastructure.db.migrations.versions.c2a4e91d6f55_widen_description_columns
========================================================================================

.. CG-PAGE source=src/groundmodel/infrastructure/db/migrations/versions/c2a4e91d6f55_widen_description_columns.py complete=true

*Source file:* ``src/groundmodel/infrastructure/db/migrations/versions/c2a4e91d6f55_widen_description_columns.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-28

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/c2a4e91d6f55_widen_description_columns.py
   :language: python
   :lines: 1-28
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** A migration that widens two free-text ``description`` columns — on ``observation_layer`` and on ``sample`` — from a capped length to uncapped text. The header carries its revision id and the id it follows.

**Why it is here.** The docstring records a real crash: DOV ships descriptions longer than the old 500-character cap, and a real import failed mid-batch with a truncation error that killed the API process. Moving both columns to uncapped TEXT is the fix, matching the project rule that free-form text from an external source defaults to TEXT, not a fixed length (CLAUDE.md schema-design pattern).

.. CG-EXPLANATION-END id=module-header

Function ``def upgrade``
------------------------

.. CG-BLOCK id=function:upgrade lines=29-46

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/c2a4e91d6f55_widen_description_columns.py
   :language: python
   :lines: 29-46
   :lineno-match:

.. CG-EXPLANATION-START id=function:upgrade

**What this does.** Changes the ``description`` column on ``observation_layer`` and on ``sample`` to uncapped TEXT, keeping their existing nullability and defaults.

**Why it is here.** Widening to TEXT is a no-op for existing data — every stored string already fits — so it is a safe, non-rewriting change that ends the truncation crashes.

.. CG-EXPLANATION-END id=function:upgrade

Function ``def downgrade``
--------------------------

.. CG-BLOCK id=function:downgrade lines=47-61

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/c2a4e91d6f55_widen_description_columns.py
   :language: python
   :lines: 47-61
   :lineno-match:

.. CG-EXPLANATION-START id=function:downgrade

**What this does.** Reverses both back to the 500-character cap, sample first.

**Why it is here.** The docstring warns this would truncate any long descriptions inserted in the meantime, so it should be applied only to an environment that has not seen long text yet.

.. CG-EXPLANATION-END id=function:downgrade

