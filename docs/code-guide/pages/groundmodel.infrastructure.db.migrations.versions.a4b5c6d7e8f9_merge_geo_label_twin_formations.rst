groundmodel.infrastructure.db.migrations.versions.a4b5c6d7e8f9_merge_geo_label_twin_formations
==============================================================================================

.. CG-PAGE source=src/groundmodel/infrastructure/db/migrations/versions/a4b5c6d7e8f9_merge_geo_label_twin_formations.py complete=true

*Source file:* ``src/groundmodel/infrastructure/db/migrations/versions/a4b5c6d7e8f9_merge_geo_label_twin_formations.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-374

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/a4b5c6d7e8f9_merge_geo_label_twin_formations.py
   :language: python
   :lines: 1-374
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Opens a one-time data-repair migration that merges duplicate geotech formation rows into one, and declares the module constants it needs: a flag marking it as rewriting user data, the ordinal renumber offset, the trigger enable/disable statements, and the loser-to-survivor mapping query.

**Why it is here.** The docstring records the owner ruling (debt #278): a body crossing two geological formations is ONE geotech unit, not two. Before the lookup keys were narrowed, the materialiser forked a second formation row (a "geo-label twin") whenever the same litho unit sat under a different geological formation, and 56 such rows already exist. The engine no longer mints twins, but this migration repairs the ones already written — the owner accepted that it rewrites rows he did not touch. The design keeps the oldest row as the survivor, re-points every child reference to it before deleting the losers, and renumbers body ordinals rather than merging body rows. The two mirror triggers are disabled for the repair window. It is destructive and refuses a downgrade.

.. CG-EXPLANATION-END id=module-header

Function ``def _repair_statements``
-----------------------------------

.. CG-BLOCK id=function:_repair_statements lines=375-413

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/a4b5c6d7e8f9_merge_geo_label_twin_formations.py
   :language: python
   :lines: 375-413
   :lineno-match:

.. CG-EXPLANATION-START id=function:_repair_statements

**What this does.** Returns the ordered list of labelled SQL statements that perform the repair: disable the two mirror triggers, null the survivor's geo id and adopt a colour, deduplicate and re-point each child table (contacts, absences, surfaces, solids, layers), renumber body ordinals, delete the losers, force the deferred contiguity check, then re-enable the triggers.

**Why it is here.** The docstring records that each statement is a single command (no semicolons) because the async driver rejects multi-command statements, and the whole list runs in order inside one transaction. The trigger disable-and-re-enable brackets the repair so the mirror triggers do not fight the re-points and deletes mid-repair; the deferred-check step runs before re-enabling because Postgres refuses to alter a table with pending deferred trigger events.

.. CG-EXPLANATION-END id=function:_repair_statements

Module-level constants and statements
-------------------------------------

.. CG-BLOCK id=module-statements lines=414-428

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/a4b5c6d7e8f9_merge_geo_label_twin_formations.py
   :language: python
   :lines: 414-428
   :lineno-match:

.. CG-EXPLANATION-START id=module-statements

**What this does.** Defines three read-only pre-flight report queries: count the loser rows, count the twin groups, and list every survivor-versus-loser name difference.

**Why it is here.** The docstring records these follow the print-precedent of an earlier repair migration and are named so the migration's test can run the exact same SQL against a seeded state — a typo surfaces in the test, not first during the real run.

.. CG-EXPLANATION-END id=module-statements

Function ``def upgrade``
------------------------

.. CG-BLOCK id=function:upgrade lines=429-451

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/a4b5c6d7e8f9_merge_geo_label_twin_formations.py
   :language: python
   :lines: 429-451
   :lineno-match:

.. CG-EXPLANATION-START id=function:upgrade

**What this does.** Prints the pre-repair counts and any differing loser names, then runs each repair statement in order, printing the row count for every survivor, dedup, re-point, body and delete step.

**Why it is here.** The printed counts give a coworker running the migration a visible record of exactly what it changed, since the survivor keeps its own name and any dropped loser name is surfaced rather than silently lost.

.. CG-EXPLANATION-END id=function:upgrade

Function ``def downgrade``
--------------------------

.. CG-BLOCK id=function:downgrade lines=452-464

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/a4b5c6d7e8f9_merge_geo_label_twin_formations.py
   :language: python
   :lines: 452-464
   :lineno-match:

.. CG-EXPLANATION-START id=function:downgrade

**What this does.** Raises a "not implemented" error — there is no downgrade.

**Why it is here.** The docstring records that the losers held the same litho parent and NAD class as the survivor plus a geo label the repair deliberately discards, so there is nothing to restore, and pre-ship backwards-compat is suspended.

.. CG-EXPLANATION-END id=function:downgrade

