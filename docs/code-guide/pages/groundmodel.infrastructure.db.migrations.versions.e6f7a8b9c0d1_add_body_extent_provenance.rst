groundmodel.infrastructure.db.migrations.versions.e6f7a8b9c0d1_add_body_extent_provenance
=========================================================================================

.. CG-PAGE source=src/groundmodel/infrastructure/db/migrations/versions/e6f7a8b9c0d1_add_body_extent_provenance.py complete=true

*Source file:* ``src/groundmodel/infrastructure/db/migrations/versions/e6f7a8b9c0d1_add_body_extent_provenance.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-46

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/e6f7a8b9c0d1_add_body_extent_provenance.py
   :language: python
   :lines: 1-46
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Header for the migration (revision ``e6f7a8b9c0d1``, following ``c2d3e4f5a6b7``) that adds two columns recording, for each side of a body's lateral extent, whether that side was set automatically or claimed by the user.

**Why it is here.** The docstring explains the problem it fixes: provenance used to be guessed from the extent's kind, which made an auto-defaulted pinch indistinguishable from a user-claimed one, so the automatic pass could not safely recompute its own defaults and they went stale. An explicit per-side flag lets the automatic body-detection recompute every ``auto`` side each pass while never touching a ``user`` side — owner directive 2026-06-04 that the 2-D body-and-extent set is the source of truth feeding the 3-D model.

.. CG-EXPLANATION-END id=module-header

Function ``def upgrade``
------------------------

.. CG-BLOCK id=function:upgrade lines=47-79

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/e6f7a8b9c0d1_add_body_extent_provenance.py
   :language: python
   :lines: 47-79
   :lineno-match:

.. CG-EXPLANATION-START id=function:upgrade

**What this does.** Adds the two not-empty provenance columns, each defaulting to ``auto``, then runs two *backfill* updates — writes that fill the new columns on existing rows — setting a side to ``user`` wherever its kind is one of the three user-claimed kinds.

**Why it is here.** The docstring records that the backfill mirrors the old kind-based rule exactly, so existing rows keep their current meaning and there is no behaviour change for data written before this migration.

.. CG-EXPLANATION-END id=function:upgrade

Function ``def downgrade``
--------------------------

.. CG-BLOCK id=function:downgrade lines=80-83

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/e6f7a8b9c0d1_add_body_extent_provenance.py
   :language: python
   :lines: 80-83
   :lineno-match:

.. CG-EXPLANATION-START id=function:downgrade

**What this does.** Drops the two provenance columns.

**Why it is here.** This reverses the addition; the derived provenance falls back to being inferred from the extent kind as before.

.. CG-EXPLANATION-END id=function:downgrade

