groundmodel.infrastructure.db.migrations.versions.a7b8c9d0e1f2_add_formation_color_override
===========================================================================================

.. CG-PAGE source=src/groundmodel/infrastructure/db/migrations/versions/a7b8c9d0e1f2_add_formation_color_override.py complete=true

*Source file:* ``src/groundmodel/infrastructure/db/migrations/versions/a7b8c9d0e1f2_add_formation_color_override.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-33

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/a7b8c9d0e1f2_add_formation_color_override.py
   :language: python
   :lines: 1-33
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** A migration that adds a nullable ``color_override`` column to the geological-formation table.

**Why it is here.** The docstring cites the owner ruling (2026-08-26) that pane colours must be choosable. A picked colour has to win over the automatic one (the NAD packing colour on a geotech unit), which means intent must be distinguishable from the machine-stamped colour — the ordinary colour column cannot carry that, because the materialiser copies the source unit's colour when it creates a geotech unit. Empty means nobody chose, so nullability itself is the provenance and reset-to-automatic is simply setting it empty. It is additive and nullable, so every existing bundle restores unchanged.

.. CG-EXPLANATION-END id=module-header

Function ``def upgrade``
------------------------

.. CG-BLOCK id=function:upgrade lines=34-41

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/a7b8c9d0e1f2_add_formation_color_override.py
   :language: python
   :lines: 34-41
   :lineno-match:

.. CG-EXPLANATION-START id=function:upgrade

**What this does.** Adds the nullable ``color_override`` column.

**Why it is here.** Gives the engineer's picked colour a home distinct from the machine-stamped one.

.. CG-EXPLANATION-END id=function:upgrade

Function ``def downgrade``
--------------------------

.. CG-BLOCK id=function:downgrade lines=42-44

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/a7b8c9d0e1f2_add_formation_color_override.py
   :language: python
   :lines: 42-44
   :lineno-match:

.. CG-EXPLANATION-START id=function:downgrade

**What this does.** Drops the column, discarding every engineer-picked colour.

**Why it is here.** So the chain can step backwards; the docstring flags the loss of picked colours.

.. CG-EXPLANATION-END id=function:downgrade

