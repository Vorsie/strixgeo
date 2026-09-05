groundmodel.infrastructure.db.migrations.versions.11878f8a5732_backfill_litho_formation_colors_from_
====================================================================================================

.. CG-PAGE source=src/groundmodel/infrastructure/db/migrations/versions/11878f8a5732_backfill_litho_formation_colors_from_.py complete=true

*Source file:* ``src/groundmodel/infrastructure/db/migrations/versions/11878f8a5732_backfill_litho_formation_colors_from_.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-46

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/11878f8a5732_backfill_litho_formation_colors_from_.py
   :language: python
   :lines: 1-46
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Opens a *backfill* migration — one that fills in a value for rows that already exist rather than changing the schema. It stamps the correct lithology colour onto litho formation rows that were created carrying a grey placeholder. It keeps its own literal copy of the five base-lithology colours and the grey placeholder.

**Why it is here.** The docstring records issue #145: rows created before the colour-at-create fix carry the neutral grey ``#9ca3af`` instead of their lithology colour, so read-side consumers (section bands, 3-D viewer, exports, the .strix bundle) show the wrong colour. The colour table is copied here rather than imported so the migration is frozen at the values current when it was written — a later edit to the shared constant must not retroactively change what this migration did.

.. CG-EXPLANATION-END id=module-header

Function ``def upgrade``
------------------------

.. CG-BLOCK id=function:upgrade lines=47-59

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/11878f8a5732_backfill_litho_formation_colors_from_.py
   :language: python
   :lines: 47-59
   :lineno-match:

.. CG-EXPLANATION-START id=function:upgrade

**What this does.** For each of the five base soils, updates every formation row that both still carries the grey placeholder and has that soil code, setting its colour to the lithology colour.

**Why it is here.** The docstring records only rows that BOTH carry grey AND have a recognised soil code are touched — geological formations (no soil code) keep their user-chosen colour, and an unrecognised soil code is left grey, matching the create-time fallback.

.. CG-EXPLANATION-END id=function:upgrade

Function ``def downgrade``
--------------------------

.. CG-BLOCK id=function:downgrade lines=60-75

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/11878f8a5732_backfill_litho_formation_colors_from_.py
   :language: python
   :lines: 60-75
   :lineno-match:

.. CG-EXPLANATION-START id=function:downgrade

**What this does.** Reverts the backfilled colours to grey, but only for rows whose colour still matches the backfilled lithology colour and whose soil code matches.

**Why it is here.** So a colour the user has since changed by hand is left alone — the reverse only touches rows the upgrade itself would have set.

.. CG-EXPLANATION-END id=function:downgrade

