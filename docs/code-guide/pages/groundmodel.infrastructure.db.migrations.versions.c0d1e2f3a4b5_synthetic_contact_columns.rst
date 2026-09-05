groundmodel.infrastructure.db.migrations.versions.c0d1e2f3a4b5_synthetic_contact_columns
========================================================================================

.. CG-PAGE source=src/groundmodel/infrastructure/db/migrations/versions/c0d1e2f3a4b5_synthetic_contact_columns.py complete=true

*Source file:* ``src/groundmodel/infrastructure/db/migrations/versions/c0d1e2f3a4b5_synthetic_contact_columns.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-43

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/c0d1e2f3a4b5_synthetic_contact_columns.py
   :language: python
   :lines: 1-43
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** A migration that adds three synthetic-anchor columns to the ``formation_contact`` table and replaces the rule that governs how a contact is anchored. The header carries its revision id and the id it follows, plus three module constants naming the table and the old and new check-constraint name.

**Why it is here.** A formation contact normally hangs off a borehole or a CPT. The docstring adds a third flavour used by the pinch-out extrapolation tool: a purely modelled tip-point with no investigation, which instead carries its own x, y and elevation so the surface computation can place it in space. The existing rule of exactly one of borehole or CPT is widened to exactly one of borehole, CPT, or a complete synthetic triple, phrased as a sum so a fourth flavour later is just one more term.

.. CG-EXPLANATION-END id=module-header

Function ``def upgrade``
------------------------

.. CG-BLOCK id=function:upgrade lines=44-67

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/c0d1e2f3a4b5_synthetic_contact_columns.py
   :language: python
   :lines: 44-67
   :lineno-match:

.. CG-EXPLANATION-START id=function:upgrade

**What this does.** Adds ``synthetic_x``, ``synthetic_y`` and ``synthetic_elevation_m``, then drops the old two-way check constraint (a check constraint is a rule the database enforces on every row) and adds a three-way one: exactly one of a borehole id, a CPT id, or all three synthetic columns being present must hold.

**Why it is here.** The comment notes PostgreSQL cannot edit a check constraint in place, so it must be dropped and re-added. The three-way rule lets a synthetic, investigation-free contact exist while still forbidding a row anchored two ways at once.

.. CG-EXPLANATION-END id=function:upgrade

Function ``def downgrade``
--------------------------

.. CG-BLOCK id=function:downgrade lines=68-83

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/c0d1e2f3a4b5_synthetic_contact_columns.py
   :language: python
   :lines: 68-83
   :lineno-match:

.. CG-EXPLANATION-START id=function:downgrade

**What this does.** Reverses it: drops the three-way check, restores the original two-way check, then drops the three synthetic columns.

**Why it is here.** The docstring notes any synthetic contacts must have been cleaned up first, since they would violate the restored two-way rule; backwards compatibility is suspended pre-ship (CLAUDE.md), so that is acceptable.

.. CG-EXPLANATION-END id=function:downgrade

