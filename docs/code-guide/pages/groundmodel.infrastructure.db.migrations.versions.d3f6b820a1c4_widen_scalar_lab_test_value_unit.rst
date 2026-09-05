groundmodel.infrastructure.db.migrations.versions.d3f6b820a1c4_widen_scalar_lab_test_value_unit
===============================================================================================

.. CG-PAGE source=src/groundmodel/infrastructure/db/migrations/versions/d3f6b820a1c4_widen_scalar_lab_test_value_unit.py complete=true

*Source file:* ``src/groundmodel/infrastructure/db/migrations/versions/d3f6b820a1c4_widen_scalar_lab_test_value_unit.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-34

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/d3f6b820a1c4_widen_scalar_lab_test_value_unit.py
   :language: python
   :lines: 1-34
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** A migration that widens two columns on ``scalar_lab_test`` — ``unit`` and ``value_text`` — to uncapped TEXT. The header carries its revision id and the id it follows.

**Why it is here.** The docstring explains this catch-all table must accept any DOV scalar observation, so the old length caps repeated the earlier truncation problem. It gives real examples that exceed the caps (a methylene-blue unit string; a long soil description). Uncapped TEXT ends the risk, matching the free-text-defaults-to-TEXT rule.

.. CG-EXPLANATION-END id=module-header

Function ``def upgrade``
------------------------

.. CG-BLOCK id=function:upgrade lines=35-51

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/d3f6b820a1c4_widen_scalar_lab_test_value_unit.py
   :language: python
   :lines: 35-51
   :lineno-match:

.. CG-EXPLANATION-START id=function:upgrade

**What this does.** Changes ``unit`` and ``value_text`` on ``scalar_lab_test`` to uncapped TEXT, keeping their nullability.

**Why it is here.** Widening to TEXT is a no-op for existing data, so it is a safe change that removes the truncation risk.

.. CG-EXPLANATION-END id=function:upgrade

Function ``def downgrade``
--------------------------

.. CG-BLOCK id=function:downgrade lines=52-66

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/d3f6b820a1c4_widen_scalar_lab_test_value_unit.py
   :language: python
   :lines: 52-66
   :lineno-match:

.. CG-EXPLANATION-START id=function:downgrade

**What this does.** Reverses both back to the earlier lengths, ``value_text`` first.

**Why it is here.** The docstring warns this would truncate any longer values inserted meanwhile.

.. CG-EXPLANATION-END id=function:downgrade

