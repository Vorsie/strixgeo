groundmodel.infrastructure.db.migrations.versions.ecc4014879af_absorb_synthetic_pinch_out_contacts_
===================================================================================================

.. CG-PAGE source=src/groundmodel/infrastructure/db/migrations/versions/ecc4014879af_absorb_synthetic_pinch_out_contacts_.py complete=true

*Source file:* ``src/groundmodel/infrastructure/db/migrations/versions/ecc4014879af_absorb_synthetic_pinch_out_contacts_.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-20

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/ecc4014879af_absorb_synthetic_pinch_out_contacts_.py
   :language: python
   :lines: 1-20
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Header for the migration (revision ``ecc4014879af``, following ``da111560a8d6``) that moves synthetic pinch-out contacts into body lateral extents. Imports for SQLAlchemy and Alembic (the schema-migration tool) are set up here.

**Why it is here.** Why: not recorded — ask the owner

.. CG-EXPLANATION-END id=module-header

Function ``def _extent_update_sql``
-----------------------------------

.. CG-BLOCK id=function:_extent_update_sql lines=21-62

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/ecc4014879af_absorb_synthetic_pinch_out_contacts_.py
   :language: python
   :lines: 21-62
   :lineno-match:

.. CG-EXPLANATION-START id=function:_extent_update_sql

**What this does.** A small helper that returns the exact ``UPDATE body`` statement for one side, chosen from two hard-coded literal statements; it first checks that the side is exactly ``left`` or ``right`` and raises if not.

**Why it is here.** The docstring records audit #1: the column name is never built by pasting the side into the SQL text; it is selected from fixed statements and the side is checked against an allow-list, so a value outside the two allowed ones cannot reach the database. This removes an injection-shaped pattern.

.. CG-EXPLANATION-END id=function:_extent_update_sql

Function ``def upgrade``
------------------------

.. CG-BLOCK id=function:upgrade lines=63-165

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/ecc4014879af_absorb_synthetic_pinch_out_contacts_.py
   :language: python
   :lines: 63-165
   :lineno-match:

.. CG-EXPLANATION-START id=function:upgrade

**What this does.** Reads every synthetic pinch-out contact, and for each one finds a body of the same formation on the opposite side, works out which side (left or right) it closes by comparing investigation ids, writes the extent on that side only if it is still empty, and finally deletes the synthetic contact. It prints running counts of absorbed, orphaned, and deleted rows.

**Why it is here.** The docstring lays out the steps and the edge cases: an orphaned synthetic contact whose host body cannot be found is dropped with a warning under the pre-ship amnesty; and a side that already has an extent keeps it, but the synthetic contact is still deleted because the closure is already encoded another way. The side ordering here is a rough id comparison; a later body-detection sweep refines it with real positions.

.. CG-EXPLANATION-END id=function:upgrade

Function ``def downgrade``
--------------------------

.. CG-BLOCK id=function:downgrade lines=166-183

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/ecc4014879af_absorb_synthetic_pinch_out_contacts_.py
   :language: python
   :lines: 166-183
   :lineno-match:

.. CG-EXPLANATION-START id=function:downgrade

**What this does.** Clears the extents this migration set (the ``extrapolated`` sides) back to empty, but cannot re-create the synthetic contacts it deleted.

**Why it is here.** The docstring marks this forward-only: the original contacts' dip-projection state is lost, so the reverse can only undo the extent writes, not restore the deleted rows.

.. CG-EXPLANATION-END id=function:downgrade

