groundmodel.infrastructure.db.migrations.versions.t4u5v6w7x8y9_schema_model_active_partial_unique
=================================================================================================

.. CG-PAGE source=src/groundmodel/infrastructure/db/migrations/versions/t4u5v6w7x8y9_schema_model_active_partial_unique.py complete=true

*Source file:* ``src/groundmodel/infrastructure/db/migrations/versions/t4u5v6w7x8y9_schema_model_active_partial_unique.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-44

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/t4u5v6w7x8y9_schema_model_active_partial_unique.py
   :language: python
   :lines: 1-44
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Header for the migration (revision ``t4u5v6w7x8y9``, following ``c3e4f5a6b7c8``) that enforces at most one active geological model per project-and-kind with a *partial unique index* — a uniqueness rule that applies only to rows matching a condition.

**Why it is here.** The docstring records the invariant: the repository already clears same-kind siblings before setting one active, but there is no database-level guard, so a direct insert or buggy migration could leave two active models and make the desktop's active-model lookup non-deterministic. The partial unique allows many inactive models per kind and one active geological plus one active lithostratigraphic in the same project (different kinds do not clash), matching the three-level hierarchy.

.. CG-EXPLANATION-END id=module-header

Function ``def upgrade``
------------------------

.. CG-BLOCK id=function:upgrade lines=45-87

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/t4u5v6w7x8y9_schema_model_active_partial_unique.py
   :language: python
   :lines: 45-87
   :lineno-match:

.. CG-EXPLANATION-START id=function:upgrade

**What this does.** First deactivates duplicate active models per project-and-kind, keeping the most-recently-updated one, then creates the partial unique index over active rows only.

**Why it is here.** The docstring notes the de-duplication makes the index safe to add; the dev database had zero violations, and the index is created with a plain table lock because pre-ship there are no concurrent writes.

.. CG-EXPLANATION-END id=function:upgrade

Function ``def downgrade``
--------------------------

.. CG-BLOCK id=function:downgrade lines=88-90

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/t4u5v6w7x8y9_schema_model_active_partial_unique.py
   :language: python
   :lines: 88-90
   :lineno-match:

.. CG-EXPLANATION-START id=function:downgrade

**What this does.** Drops the partial unique index.

**Why it is here.** This reverses the guard.

.. CG-EXPLANATION-END id=function:downgrade

