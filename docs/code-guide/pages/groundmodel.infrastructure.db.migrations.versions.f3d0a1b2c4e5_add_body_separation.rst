groundmodel.infrastructure.db.migrations.versions.f3d0a1b2c4e5_add_body_separation
==================================================================================

.. CG-PAGE source=src/groundmodel/infrastructure/db/migrations/versions/f3d0a1b2c4e5_add_body_separation.py complete=true

*Source file:* ``src/groundmodel/infrastructure/db/migrations/versions/f3d0a1b2c4e5_add_body_separation.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-35

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/f3d0a1b2c4e5_add_body_separation.py
   :language: python
   :lines: 1-35
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Header for the migration (revision ``f3d0a1b2c4e5``, following ``e2c9f4a7b3d1``) that adds the ``body_separation`` table — a record that two layers must never be treated as the same body.

**Why it is here.** The docstring records the owner ruling of 2026-08-31 (debt #278): a Separate verb, the counterpart to Dissolve, so the engineer can state two layers are not the same body and have the resolver honour it permanently. It is additive and cleanly reversible — an empty table changes no existing behaviour, so every prior saved project restores unchanged — and it mirrors the shape of the body-geometry-fact table.

.. CG-EXPLANATION-END id=module-header

Function ``def upgrade``
------------------------

.. CG-BLOCK id=function:upgrade lines=36-70

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/f3d0a1b2c4e5_add_body_separation.py
   :language: python
   :lines: 36-70
   :lineno-match:

.. CG-EXPLANATION-START id=function:upgrade

**What this does.** Creates ``body_separation`` with an id, a model link, the two layer endpoints (all cascading foreign keys), and a timestamp; adds a check constraint forcing the fixed endpoint order, a unique constraint on the model-plus-pair, and an index by model.

**Why it is here.** The docstring explains it is a cannot-link constraint in layer-id space that only the user writes; the fixed order and per-model uniqueness store each pairing once, matching the body-geometry-fact table's conventions.

.. CG-EXPLANATION-END id=function:upgrade

Function ``def downgrade``
--------------------------

.. CG-BLOCK id=function:downgrade lines=71-74

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/f3d0a1b2c4e5_add_body_separation.py
   :language: python
   :lines: 71-74
   :lineno-match:

.. CG-EXPLANATION-START id=function:downgrade

**What this does.** Drops the index and then the ``body_separation`` table.

**Why it is here.** The reverse in dependency order; nothing else references the table.

.. CG-EXPLANATION-END id=function:downgrade

