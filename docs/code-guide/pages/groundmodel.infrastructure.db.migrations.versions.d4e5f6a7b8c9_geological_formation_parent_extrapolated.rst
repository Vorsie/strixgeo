groundmodel.infrastructure.db.migrations.versions.d4e5f6a7b8c9_geological_formation_parent_extrapolated
=======================================================================================================

.. CG-PAGE source=src/groundmodel/infrastructure/db/migrations/versions/d4e5f6a7b8c9_geological_formation_parent_extrapolated.py complete=true

*Source file:* ``src/groundmodel/infrastructure/db/migrations/versions/d4e5f6a7b8c9_geological_formation_parent_extrapolated.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-43

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/d4e5f6a7b8c9_geological_formation_parent_extrapolated.py
   :language: python
   :lines: 1-43
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** A migration that adds a ``parent_extrapolated`` flag to ``geological_formation`` and backfills parent links for orphan litho units. The header carries its revision id and the id it follows, and imports only standard tools so it stays independent of the app code.

**Why it is here.** The docstring records debt #87. The flag marks litho units whose parent formation was guessed by surface extrapolation (no contact covered the depth) so the inspector can show an amber dot with a confirm, reassign or detach dialog. The backfill gives existing orphans a parent using the same rule the live accept path uses. The surface helper is copied in on purpose so the migration keeps working even if the runtime helper is later moved or renamed.

.. CG-EXPLANATION-END id=module-header

Function ``def _evaluate_tin_at``
---------------------------------

.. CG-BLOCK id=function:_evaluate_tin_at lines=44-74

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/d4e5f6a7b8c9_geological_formation_parent_extrapolated.py
   :language: python
   :lines: 44-74
   :lineno-match:

.. CG-EXPLANATION-START id=function:_evaluate_tin_at

**What this does.** A self-contained copy of the surface-sampling helper: given a triangulated surface (a TIN) and a map point, it returns the interpolated elevation at that point, or nothing when the point falls outside every triangle.

**Why it is here.** The docstring says it is a migration-local copy that must not be merged with the runtime helper, because a migration has to keep running unchanged even as the application evolves.

.. CG-EXPLANATION-END id=function:_evaluate_tin_at

Function ``def _extrapolate_parent``
------------------------------------

.. CG-BLOCK id=function:_extrapolate_parent lines=75-98

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/d4e5f6a7b8c9_geological_formation_parent_extrapolated.py
   :language: python
   :lines: 75-98
   :lineno-match:

.. CG-EXPLANATION-START id=function:_extrapolate_parent

**What this does.** Given a target elevation and every geology surface in the parent model, it samples each surface at the investigation's position and returns the formation whose surface sits just above the target — the same choice the live accept path makes.

**Why it is here.** It reproduces the runtime rule for choosing a litho unit's parent geological formation, so backfilled links match what the app would have assigned.

.. CG-EXPLANATION-END id=function:_extrapolate_parent

Function ``def upgrade``
------------------------

.. CG-BLOCK id=function:upgrade lines=99-244

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/d4e5f6a7b8c9_geological_formation_parent_extrapolated.py
   :language: python
   :lines: 99-244
   :lineno-match:

.. CG-EXPLANATION-START id=function:upgrade

**What this does.** Adds the ``parent_extrapolated`` flag defaulting to false, finds every orphan litho unit (has a soil code but no parent), and for each one loads a contact, resolves the parent geological model, loads the investigation's position and surveyed elevation, loads that model's surfaces, extrapolates the parent, and stores it with the flag set. Rows it cannot resolve are counted and left unchanged, and a summary line is printed.

**Why it is here.** The docstring lists exactly why a row may be unfixable — no contacts, no elevation, no parent model, outside the surface footprint, or above all surfaces — and those rows are left as-is rather than guessed. A migration cannot use the app logger, so a plain print is the conventional Alembic diagnostic.

.. CG-EXPLANATION-END id=function:upgrade

Function ``def downgrade``
--------------------------

.. CG-BLOCK id=function:downgrade lines=245-253

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/d4e5f6a7b8c9_geological_formation_parent_extrapolated.py
   :language: python
   :lines: 245-253
   :lineno-match:

.. CG-EXPLANATION-START id=function:downgrade

**What this does.** Drops the ``parent_extrapolated`` flag; the backfilled parent links are kept.

**Why it is here.** The docstring notes the parent links stay valid without the provenance flag, and a re-upgrade would simply skip the rows that already have a parent.

.. CG-EXPLANATION-END id=function:downgrade

