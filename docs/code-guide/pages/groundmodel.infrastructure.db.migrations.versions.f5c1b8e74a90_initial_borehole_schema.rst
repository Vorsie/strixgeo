groundmodel.infrastructure.db.migrations.versions.f5c1b8e74a90_initial_borehole_schema
======================================================================================

.. CG-PAGE source=src/groundmodel/infrastructure/db/migrations/versions/f5c1b8e74a90_initial_borehole_schema.py complete=true

*Source file:* ``src/groundmodel/infrastructure/db/migrations/versions/f5c1b8e74a90_initial_borehole_schema.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-29

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/f5c1b8e74a90_initial_borehole_schema.py
   :language: python
   :lines: 1-29
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Header for the migration (revision ``f5c1b8e74a90``, following ``d70b1a8e9c34``) that creates the first borehole tables: ``borehole`` plus the child tables ``drill_segment`` and ``field_log_interval``.

**Why it is here.** The docstring records this is the Phase-3a foundation for borehole imports; it mirrors the CPT pattern (source identifiers for de-duplication, raw coordinates with their own coordinate-reference codes, a PostGIS geometry, denormalised counts for cheap list views) and gives the two child tables cascading foreign keys so removing a borehole cleans up its children. PostGIS is the spatial add-on PostgreSQL needs to store locations.

.. CG-EXPLANATION-END id=module-header

Function ``def upgrade``
------------------------

.. CG-BLOCK id=function:upgrade lines=30-110

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/f5c1b8e74a90_initial_borehole_schema.py
   :language: python
   :lines: 30-110
   :lineno-match:

.. CG-EXPLANATION-START id=function:upgrade

**What this does.** Creates the ``borehole`` table with its identifiers, location, metadata and count columns plus a project index and a spatial index; then creates ``drill_segment`` and ``field_log_interval``, each linked back to the borehole with a cascading foreign key and their own indexes.

**Why it is here.** The docstring describes the layout; the spatial index on the location supports map queries, and the borehole-id indexes on the child tables support loading a borehole's segments and log intervals quickly.

.. CG-EXPLANATION-END id=function:upgrade

Function ``def downgrade``
--------------------------

.. CG-BLOCK id=function:downgrade lines=111-121

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/f5c1b8e74a90_initial_borehole_schema.py
   :language: python
   :lines: 111-121
   :lineno-match:

.. CG-EXPLANATION-START id=function:downgrade

**What this does.** Drops the two child tables and their indexes, then the ``borehole`` table and its indexes.

**Why it is here.** Children are removed before the parent so no foreign key is left pointing at a missing table.

.. CG-EXPLANATION-END id=function:downgrade

