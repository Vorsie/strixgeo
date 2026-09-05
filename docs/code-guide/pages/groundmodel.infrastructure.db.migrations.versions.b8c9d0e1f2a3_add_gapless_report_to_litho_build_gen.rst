groundmodel.infrastructure.db.migrations.versions.b8c9d0e1f2a3_add_gapless_report_to_litho_build_gen
====================================================================================================

.. CG-PAGE source=src/groundmodel/infrastructure/db/migrations/versions/b8c9d0e1f2a3_add_gapless_report_to_litho_build_gen.py complete=true

*Source file:* ``src/groundmodel/infrastructure/db/migrations/versions/b8c9d0e1f2a3_add_gapless_report_to_litho_build_gen.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-39

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/b8c9d0e1f2a3_add_gapless_report_to_litho_build_gen.py
   :language: python
   :lines: 1-39
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** A migration that adds a nullable JSON ``gapless_report`` column to the build-generation table.

**Why it is here.** The docstring cites the owner constraint (2026-08-26) that the model must have no gaps or fallbacks unless the user made a mistake. The seven-clause gapless gate answers that per build, and this column stores its report so reopening a project shows the last build's verdict without recomputing it. It is deliberately nullable rather than defaulting to an empty object, because an empty object would falsely read as "the gate ran and found nothing", which is different from "nobody ran the gate here". Additive and nullable, so every existing bundle restores unchanged; hand-written for the recorded drift reason.

.. CG-EXPLANATION-END id=module-header

Function ``def upgrade``
------------------------

.. CG-BLOCK id=function:upgrade lines=40-47

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/b8c9d0e1f2a3_add_gapless_report_to_litho_build_gen.py
   :language: python
   :lines: 40-47
   :lineno-match:

.. CG-EXPLANATION-START id=function:upgrade

**What this does.** Adds the nullable JSON ``gapless_report`` column.

**Why it is here.** Gives each build a place to store its gapless-gate verdict.

.. CG-EXPLANATION-END id=function:upgrade

Function ``def downgrade``
--------------------------

.. CG-BLOCK id=function:downgrade lines=48-50

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/b8c9d0e1f2a3_add_gapless_report_to_litho_build_gen.py
   :language: python
   :lines: 48-50
   :lineno-match:

.. CG-EXPLANATION-START id=function:downgrade

**What this does.** Drops the column, discarding every stored gate verdict.

**Why it is here.** So the chain can step backwards; the reverse of the add.

.. CG-EXPLANATION-END id=function:downgrade

