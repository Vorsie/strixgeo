groundmodel.infrastructure.db.migrations.versions.f7a8b29d4e15_scalar_lab_test_all_text
=======================================================================================

.. CG-PAGE source=src/groundmodel/infrastructure/db/migrations/versions/f7a8b29d4e15_scalar_lab_test_all_text.py complete=true

*Source file:* ``src/groundmodel/infrastructure/db/migrations/versions/f7a8b29d4e15_scalar_lab_test_all_text.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-33

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/f7a8b29d4e15_scalar_lab_test_all_text.py
   :language: python
   :lines: 1-33
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Header for the migration (revision ``f7a8b29d4e15``, following ``d3f6b820a1c4``) that widens three text columns on the catch-all lab-test table from capped strings to unbounded TEXT.

**Why it is here.** The docstring records the policy: any column holding free-form text from an external source defaults to TEXT, and only a fixed-spec value keeps a length cap; the truncation problem had bitten three times in two days on other columns. One column, the detection condition, deliberately stays capped because it is a small known set of values.

.. CG-EXPLANATION-END id=module-header

Function ``def upgrade``
------------------------

.. CG-BLOCK id=function:upgrade lines=34-57

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/f7a8b29d4e15_scalar_lab_test_all_text.py
   :language: python
   :lines: 34-57
   :lineno-match:

.. CG-EXPLANATION-START id=function:upgrade

**What this does.** Changes the parameter-group, parameter and method columns to unbounded TEXT.

**Why it is here.** The docstring notes the values currently fit the old caps, so the cost is one cheap change per column on an empty table — cheap insurance against a future longer value from DOV.

.. CG-EXPLANATION-END id=function:upgrade

Function ``def downgrade``
--------------------------

.. CG-BLOCK id=function:downgrade lines=58-79

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/f7a8b29d4e15_scalar_lab_test_all_text.py
   :language: python
   :lines: 58-79
   :lineno-match:

.. CG-EXPLANATION-START id=function:downgrade

**What this does.** Changes the three columns back to their original capped lengths.

**Why it is here.** This restores the exact pre-migration column types.

.. CG-EXPLANATION-END id=function:downgrade

