groundmodel.infrastructure.db.migrations.versions.d1a2b3c4e5f6_formation_pinned_order
=====================================================================================

.. CG-PAGE source=src/groundmodel/infrastructure/db/migrations/versions/d1a2b3c4e5f6_formation_pinned_order.py complete=true

*Source file:* ``src/groundmodel/infrastructure/db/migrations/versions/d1a2b3c4e5f6_formation_pinned_order.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-38

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/d1a2b3c4e5f6_formation_pinned_order.py
   :language: python
   :lines: 1-38
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** A migration that adds a ``pinned_order`` true/false column to ``geological_formation``. The header carries its revision id and the id it follows.

**Why it is here.** The docstring records debt #35: the 3-D build's final step re-derives display order from contact depths, so a deliberate manual reorder was silently reverted on the next build — fatal for unusual stratigraphy where the data-driven order is simply wrong. This flag lets a manual reorder pin a formation's position while the rest flow into the free slots by age.

.. CG-EXPLANATION-END id=module-header

Function ``def upgrade``
------------------------

.. CG-BLOCK id=function:upgrade lines=39-51

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/d1a2b3c4e5f6_formation_pinned_order.py
   :language: python
   :lines: 39-51
   :lineno-match:

.. CG-EXPLANATION-START id=function:upgrade

**What this does.** Adds the ``pinned_order`` boolean column, not-nullable, defaulting to false.

**Why it is here.** The default of false means seeded and Fill-from-boreholes formations keep the data-driven ordering; only an explicit manual reorder opts a formation out of it.

.. CG-EXPLANATION-END id=function:upgrade

Function ``def downgrade``
--------------------------

.. CG-BLOCK id=function:downgrade lines=52-54

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/d1a2b3c4e5f6_formation_pinned_order.py
   :language: python
   :lines: 52-54
   :lineno-match:

.. CG-EXPLANATION-START id=function:downgrade

**What this does.** Drops the ``pinned_order`` column.

**Why it is here.** The exact reverse of the upgrade.

.. CG-EXPLANATION-END id=function:downgrade

