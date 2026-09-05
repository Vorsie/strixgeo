groundmodel.infrastructure.db.migrations.versions.e3f4a5b6c7d8_add_litho_correlation_edge
=========================================================================================

.. CG-PAGE source=src/groundmodel/infrastructure/db/migrations/versions/e3f4a5b6c7d8_add_litho_correlation_edge.py complete=true

*Source file:* ``src/groundmodel/infrastructure/db/migrations/versions/e3f4a5b6c7d8_add_litho_correlation_edge.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-49

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/e3f4a5b6c7d8_add_litho_correlation_edge.py
   :language: python
   :lines: 1-49
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Header for the migration (revision ``e3f4a5b6c7d8``, following ``d0e1f2a3b4c5``) that introduces the ``litho_correlation_edge`` *table* — a new store of rows recording that two formation rows in the same lithostratigraphic model are the same stratigraphic body of a lithology.

**Why it is here.** The long docstring records the architect-locked decisions: the edge joins formation rows, not individual picks, so it outlives any single boundary; the two endpoint ids are kept in a fixed order (smaller id first) so each pairing is stored once; deleting a model or a formation removes its edges automatically; and the provenance is a short text token so future automatic sources can be added without a schema change.

.. CG-EXPLANATION-END id=module-header

Function ``def upgrade``
------------------------

.. CG-BLOCK id=function:upgrade lines=50-147

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/e3f4a5b6c7d8_add_litho_correlation_edge.py
   :language: python
   :lines: 50-147
   :lineno-match:

.. CG-EXPLANATION-START id=function:upgrade

**What this does.** Creates the table with an id, a link to the model, the two formation endpoints, a provenance token defaulting to ``manual``, and two timestamps. It adds *check constraints* (rules the database enforces on every row) forcing the fixed endpoint order and forbidding an edge from a formation to itself, a *unique constraint* (no duplicate) on the model-plus-both-endpoints triple, and two indexes for walking the correlation graph.

**Why it is here.** The docstring and inline comments explain each guard: cascading deletes keep the graph free of dangling rows, the fixed order plus the unique triple make a symmetric duplicate impossible, and the two indexes serve the resolver's walk from either endpoint. A comment notes that no third index on the full triple is added because the unique constraint already builds one (review S5).

.. CG-EXPLANATION-END id=function:upgrade

Function ``def downgrade``
--------------------------

.. CG-BLOCK id=function:downgrade lines=148-150

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/e3f4a5b6c7d8_add_litho_correlation_edge.py
   :language: python
   :lines: 148-150
   :lineno-match:

.. CG-EXPLANATION-START id=function:downgrade

**What this does.** Drops the whole ``litho_correlation_edge`` table; its indexes and constraints go with it.

**Why it is here.** A table drop removes everything attached to it in one step, so no separate index removal is needed. This simply reverses the create.

.. CG-EXPLANATION-END id=function:downgrade

