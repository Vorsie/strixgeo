groundmodel.infrastructure.db.migrations.versions.a1c2d3e4f5a6_schema_invariant_checks
======================================================================================

.. CG-PAGE source=src/groundmodel/infrastructure/db/migrations/versions/a1c2d3e4f5a6_schema_invariant_checks.py complete=true

*Source file:* ``src/groundmodel/infrastructure/db/migrations/versions/a1c2d3e4f5a6_schema_invariant_checks.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-69

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/a1c2d3e4f5a6_schema_invariant_checks.py
   :language: python
   :lines: 1-69
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Opens a schema-hardening migration that adds several check constraints enforcing domain rules previously enforced only at the application layer, and lists them: the model kind must be one of three values, the contact source one of five, a body ordinal non-negative, and the body extent-kinds (when set) known tokens. It keeps literal copies of the allowed token lists.

**Why it is here.** The docstring records these invariants are documented in CLAUDE.md "Domain Model" and "Data Integrity Rules" but were only enforced in Pydantic before; the pre-ship amnesty allows adding them cleanly, and any violating rows are corrected inline before each constraint lands. The token lists are copied here so the migration is frozen at authoring time.

.. CG-EXPLANATION-END id=module-header

Function ``def upgrade``
------------------------

.. CG-BLOCK id=function:upgrade lines=70-184

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/a1c2d3e4f5a6_schema_invariant_checks.py
   :language: python
   :lines: 70-184
   :lineno-match:

.. CG-EXPLANATION-START id=function:upgrade

**What this does.** For each invariant it first corrects any bad rows (resets an unknown model kind to 'geological', an unknown contact source to 'manual_pick', a negative body ordinal to 0, an invalid extent-kind to empty), printing how many it fixed, then adds the check constraint.

**Why it is here.** The docstring records the correction pass runs first so the constraint lands cleanly on the dev database; the integration database is built from scratch each run so it never has bad data. The corrections are safety nets — existing rows came through the server default or Pydantic validation.

.. CG-EXPLANATION-END id=function:upgrade

Function ``def downgrade``
--------------------------

.. CG-BLOCK id=function:downgrade lines=185-191

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/a1c2d3e4f5a6_schema_invariant_checks.py
   :language: python
   :lines: 185-191
   :lineno-match:

.. CG-EXPLANATION-START id=function:downgrade

**What this does.** Drops all the check constraints this migration added.

**Why it is here.** So the chain can step back; the corrected data is left as-is (only the rules are removed).

.. CG-EXPLANATION-END id=function:downgrade

