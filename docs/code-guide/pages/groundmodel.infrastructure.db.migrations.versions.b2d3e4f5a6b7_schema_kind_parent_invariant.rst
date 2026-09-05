groundmodel.infrastructure.db.migrations.versions.b2d3e4f5a6b7_schema_kind_parent_invariant
===========================================================================================

.. CG-PAGE source=src/groundmodel/infrastructure/db/migrations/versions/b2d3e4f5a6b7_schema_kind_parent_invariant.py complete=true

*Source file:* ``src/groundmodel/infrastructure/db/migrations/versions/b2d3e4f5a6b7_schema_kind_parent_invariant.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-35

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/b2d3e4f5a6b7_schema_kind_parent_invariant.py
   :language: python
   :lines: 1-35
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** A migration that adds one check constraint tying a model's kind to whether it must have a parent model.

**Why it is here.** The docstring cites CLAUDE.md's modelling hierarchy: a parent model is mandatory for lithostratigraphic and geotechnical models, and the column is only database-nullable because plain geological models share it and have no parent. The application enforces this, but a stray write path could insert a litho model with no parent and be silently mistreated as a standalone geological model; this constraint encodes the documented rule in the database.

.. CG-EXPLANATION-END id=module-header

Function ``def upgrade``
------------------------

.. CG-BLOCK id=function:upgrade lines=36-118

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/b2d3e4f5a6b7_schema_kind_parent_invariant.py
   :language: python
   :lines: 36-118
   :lineno-match:

.. CG-EXPLANATION-START id=function:upgrade

**What this does.** Corrects any litho or geotech rows that ended up with no parent, then adds the check constraint requiring the parent to be empty for geological models and present for the other two kinds.

**Why it is here.** The correction runs first under the pre-ship amnesty so the constraint lands cleanly; the docstring notes there should be zero such rows on a legitimate database, but the guard is added for safety.

.. CG-EXPLANATION-END id=function:upgrade

Function ``def downgrade``
--------------------------

.. CG-BLOCK id=function:downgrade lines=119-121

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/b2d3e4f5a6b7_schema_kind_parent_invariant.py
   :language: python
   :lines: 119-121
   :lineno-match:

.. CG-EXPLANATION-START id=function:downgrade

**What this does.** Drops the kind-and-parent constraint.

**Why it is here.** So the chain can step backwards; the reverse of the upgrade.

.. CG-EXPLANATION-END id=function:downgrade

