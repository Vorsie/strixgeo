groundmodel.infrastructure.db.migrations.versions.0314d9e63258_geological_model_tables
======================================================================================

.. CG-PAGE source=src/groundmodel/infrastructure/db/migrations/versions/0314d9e63258_geological_model_tables.py complete=true

*Source file:* ``src/groundmodel/infrastructure/db/migrations/versions/0314d9e63258_geological_model_tables.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-53

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/0314d9e63258_geological_model_tables.py
   :language: python
   :lines: 1-53
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The opening of an Alembic *migration* — a small, ordered, replayable script that changes the database's shape (its tables and columns). The docstring names the change (three new tables for the geological model) and Alembic's bookkeeping: the *revision id* ``0314d9e63258`` (this migration's own unique code-name) and ``Revises: e1c4a7b9d28f`` (its *down_revision*, the migration that must run just before it — the ids form one ordered chain that is the schema's history).

**Why it is here.** The docstring records this introduces the geological-model data layer behind the v1.0 MVP: ``geological_formation`` (the per-project vocabulary of units like Boom Klei), ``geological_model`` (an interpretation container, one flagged active), and ``formation_contact`` (the core data point — "this formation tops out at this depth at this investigation"). It also records why the "no gaps" rule is a domain check on save rather than a hard database rule: a hard rule would fight a legitimate mid-edit overlap when inserting a contact between two others.

.. CG-EXPLANATION-END id=module-header

Function ``def upgrade``
------------------------

.. CG-BLOCK id=function:upgrade lines=54-248

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/0314d9e63258_geological_model_tables.py
   :language: python
   :lines: 54-248
   :lineno-match:

.. CG-EXPLANATION-START id=function:upgrade

**What this does.** Applies the change (*upgrade* = move the schema forward). It creates the three tables with their columns and indexes: a *column* is one field on every row; a *foreign key* is a column that must point at a real row in another table; a *check constraint* is a rule the database enforces on every row; an *index* is a lookup structure that makes a query fast; *nullable* means a column may be left empty.

**Why it is here.** The inline comments record the deliberate choices: the anchor is an exclusive-or CHECK constraint (exactly one of borehole or CPT set), phrased as a count so a future third anchor is a small edit; the CPT anchor is column-reserved for Phase 5; ``regional_ref`` is free text so a new upstream source needs no migration; and the delete rules cascade a contact away with its model, formation or investigation but only null out its provenance links when the source observation is reshuffled.

.. CG-EXPLANATION-END id=function:upgrade

Function ``def downgrade``
--------------------------

.. CG-BLOCK id=function:downgrade lines=249-257

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/0314d9e63258_geological_model_tables.py
   :language: python
   :lines: 249-257
   :lineno-match:

.. CG-EXPLANATION-START id=function:downgrade

**What this does.** Undoes the change (*downgrade* = step the schema back), dropping the three tables and their indexes in the reverse of the order they were created.

**Why it is here.** So the migration chain can be stepped backwards cleanly; the reverse order respects the foreign keys (a table pointed at is dropped last).

.. CG-EXPLANATION-END id=function:downgrade

