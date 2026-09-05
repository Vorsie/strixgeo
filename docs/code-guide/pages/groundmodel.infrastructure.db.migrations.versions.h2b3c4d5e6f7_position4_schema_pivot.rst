groundmodel.infrastructure.db.migrations.versions.h2b3c4d5e6f7_position4_schema_pivot
=====================================================================================

.. CG-PAGE source=src/groundmodel/infrastructure/db/migrations/versions/h2b3c4d5e6f7_position4_schema_pivot.py complete=true

*Source file:* ``src/groundmodel/infrastructure/db/migrations/versions/h2b3c4d5e6f7_position4_schema_pivot.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-73

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/h2b3c4d5e6f7_position4_schema_pivot.py
   :language: python
   :lines: 1-73
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Header for the migration (revision ``h2b3c4d5e6f7``, following ``g1a2b3c4d5e6``) that reshapes the lens schema so lens-ness is inferred from correlation topology, keeping the explicit gesture only as an override and naming layer. It renames a lens column, adds a body-ordinal, drops the contact's lens tag, and renames the absence table to be formation-scoped.

**Why it is here.** The long docstring records the Position 4 architecture (debt #101): the lens row becomes metadata attached to a body identified by formation-plus-ordinal, absence rows are scoped to formations rather than lenses, and the body ordinal for an investigation is computed at query time rather than stored. The check constraints are named so their allowed values can be extended by a later migration.

.. CG-EXPLANATION-END id=module-header

Function ``def upgrade``
------------------------

.. CG-BLOCK id=function:upgrade lines=74-227

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/h2b3c4d5e6f7_position4_schema_pivot.py
   :language: python
   :lines: 74-227
   :lineno-match:

.. CG-EXPLANATION-START id=function:upgrade

**What this does.** Renames the lens parent-formation column to ``formation_id`` and its foreign key and index to match; adds a ``body_ordinal`` column with a per-body unique constraint; drops the contact's lens tag, foreign key and index; then renames the absence table to ``formation_absence``, drops its lens column and old constraints, and adds a formation link, a source column with a check constraint, an investigation-kind check, a unique constraint, and an index.

**Why it is here.** The comments explain the details: the body-ordinal defaults to zero so existing rows satisfy the not-empty rule without a back-fill, and a temporary default value is used while adding the not-empty formation link on a possibly-empty pre-ship table, then dropped so new rows must supply a real value.

.. CG-EXPLANATION-END id=function:upgrade

Function ``def downgrade``
--------------------------

.. CG-BLOCK id=function:downgrade lines=228-346

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/h2b3c4d5e6f7_position4_schema_pivot.py
   :language: python
   :lines: 228-346
   :lineno-match:

.. CG-EXPLANATION-START id=function:downgrade

**What this does.** Reverses every step in the opposite order: turns ``formation_absence`` back into ``litho_lens_absence`` with its lens column and old constraints, restores the contact's lens tag, drops the body-ordinal, and renames the lens formation column back to parent-formation.

**Why it is here.** The reverse walks the same changes backward so the schema returns exactly to its pre-pivot shape.

.. CG-EXPLANATION-END id=function:downgrade

