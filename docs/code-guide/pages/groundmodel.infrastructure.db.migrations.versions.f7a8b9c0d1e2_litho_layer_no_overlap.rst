groundmodel.infrastructure.db.migrations.versions.f7a8b9c0d1e2_litho_layer_no_overlap
=====================================================================================

.. CG-PAGE source=src/groundmodel/infrastructure/db/migrations/versions/f7a8b9c0d1e2_litho_layer_no_overlap.py complete=true

*Source file:* ``src/groundmodel/infrastructure/db/migrations/versions/f7a8b9c0d1e2_litho_layer_no_overlap.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-56

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/f7a8b9c0d1e2_litho_layer_no_overlap.py
   :language: python
   :lines: 1-56
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Header for the migration (revision ``f7a8b9c0d1e2``, following ``e6f7a8b9c0d1``) that installs a hard database rule forbidding two accepted litho layers from overlapping in depth on the same investigation.

**Why it is here.** The docstring records the dogfeed finding of 2026-06-05: the gap-free stack was only a convention, and a single-layer manual depth edit had no overlap check, so a hand-drawn sand could drop 3.3 m inside the silt below it. The guard is an *exclusion constraint* — a rule that forbids two rows from both matching a condition and overlapping in a range — using PostGIS's GiST index machinery; it is checked at commit so a mid-edit transient overlap is allowed as long as the final state is clean.

.. CG-EXPLANATION-END id=module-header

Function ``def upgrade``
------------------------

.. CG-BLOCK id=function:upgrade lines=57-72

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/f7a8b9c0d1e2_litho_layer_no_overlap.py
   :language: python
   :lines: 57-72
   :lineno-match:

.. CG-EXPLANATION-START id=function:upgrade

**What this does.** Installs the ``btree_gist`` extension and adds a partial, deferred exclusion constraint that forbids two accepted rows sharing a model and investigation from overlapping depth ranges, comparing depths rounded to the millimetre.

**Why it is here.** The docstring explains the millimetre rounding lets real overlaps trip while float noise at a shared boundary and exact adjacency stay legal; the rule covers accepted rows only because pending suggestions are allowed to overlap by design.

.. CG-EXPLANATION-END id=function:upgrade

Function ``def downgrade``
--------------------------

.. CG-BLOCK id=function:downgrade lines=73-75

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/f7a8b9c0d1e2_litho_layer_no_overlap.py
   :language: python
   :lines: 73-75
   :lineno-match:

.. CG-EXPLANATION-START id=function:downgrade

**What this does.** Drops the exclusion constraint but leaves the ``btree_gist`` extension installed.

**Why it is here.** The docstring notes leaving the extension is harmless; dropping the constraint is enough to reverse the guard.

.. CG-EXPLANATION-END id=function:downgrade

