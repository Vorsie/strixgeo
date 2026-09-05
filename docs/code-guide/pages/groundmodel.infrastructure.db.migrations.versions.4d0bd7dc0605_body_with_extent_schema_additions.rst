groundmodel.infrastructure.db.migrations.versions.4d0bd7dc0605_body_with_extent_schema_additions
================================================================================================

.. CG-PAGE source=src/groundmodel/infrastructure/db/migrations/versions/4d0bd7dc0605_body_with_extent_schema_additions.py complete=true

*Source file:* ``src/groundmodel/infrastructure/db/migrations/versions/4d0bd7dc0605_body_with_extent_schema_additions.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-21

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/4d0bd7dc0605_body_with_extent_schema_additions.py
   :language: python
   :lines: 1-21
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Opens the first of several migrations for the "body with extent" work: it adds the new extent columns and a source-investigation link to the litho-lens table, all empty-allowed.

**Why it is here.** It is deliberately additive-only — every new column is empty-allowed so existing code keeps working — because later migrations in the same slice populate the columns, rename the tables, and absorb synthetic pinch-out contacts. Splitting the change this way lets each step land safely.

.. CG-EXPLANATION-END id=module-header

Function ``def upgrade``
------------------------

.. CG-BLOCK id=function:upgrade lines=22-88

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/4d0bd7dc0605_body_with_extent_schema_additions.py
   :language: python
   :lines: 22-88
   :lineno-match:

.. CG-EXPLANATION-START id=function:upgrade

**What this does.** Adds the lens's source-investigation link, the left/right extent descriptor columns (kind, target-contact link, neighbour-investigation link), and a body link on the lens-shape table.

**Why it is here.** So a lens can record how far it reaches on each side and which investigation it came from, ahead of the later step that fills these in. All are empty-allowed so the additive change breaks nothing.

.. CG-EXPLANATION-END id=function:upgrade

Function ``def downgrade``
--------------------------

.. CG-BLOCK id=function:downgrade lines=89-98

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/4d0bd7dc0605_body_with_extent_schema_additions.py
   :language: python
   :lines: 89-98
   :lineno-match:

.. CG-EXPLANATION-START id=function:downgrade

**What this does.** Drops all the added columns in reverse.

**Why it is here.** Kept minimal on purpose: the pre-ship amnesty (backwards-compatibility suspended before first release) means a full careful reverse is not required.

.. CG-EXPLANATION-END id=function:downgrade

