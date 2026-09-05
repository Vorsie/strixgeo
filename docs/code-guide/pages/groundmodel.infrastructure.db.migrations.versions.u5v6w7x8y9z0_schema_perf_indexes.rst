groundmodel.infrastructure.db.migrations.versions.u5v6w7x8y9z0_schema_perf_indexes
==================================================================================

.. CG-PAGE source=src/groundmodel/infrastructure/db/migrations/versions/u5v6w7x8y9z0_schema_perf_indexes.py complete=true

*Source file:* ``src/groundmodel/infrastructure/db/migrations/versions/u5v6w7x8y9z0_schema_perf_indexes.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-48

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/u5v6w7x8y9z0_schema_perf_indexes.py
   :language: python
   :lines: 1-48
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Header for the migration (revision ``u5v6w7x8y9z0``, following ``t4u5v6w7x8y9``) that adds three read indexes: one on the contacts table for CPT-anchored lookups, and two on the contact-correlation edge table for adjacency lookups from each endpoint.

**Why it is here.** The docstring records the access patterns each index serves: a two-column model-and-CPT lookup used by the segmenter and cross-section queries, and the two endpoint-adjacency scans the correlation-graph loader would otherwise do as sequential scans. It notes these are performance indexes needing no data correction (debt #107 guidance).

.. CG-EXPLANATION-END id=module-header

Function ``def upgrade``
------------------------

.. CG-BLOCK id=function:upgrade lines=49-72

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/u5v6w7x8y9z0_schema_perf_indexes.py
   :language: python
   :lines: 49-72
   :lineno-match:

.. CG-EXPLANATION-START id=function:upgrade

**What this does.** Creates the three read indexes.

**Why it is here.** The docstring explains they are plain (table-locking) creates because pre-ship there are no concurrent writes, and each matches a documented query shape.

.. CG-EXPLANATION-END id=function:upgrade

Function ``def downgrade``
--------------------------

.. CG-BLOCK id=function:downgrade lines=73-81

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/u5v6w7x8y9z0_schema_perf_indexes.py
   :language: python
   :lines: 73-81
   :lineno-match:

.. CG-EXPLANATION-START id=function:downgrade

**What this does.** Drops the three indexes.

**Why it is here.** This reverses the additions.

.. CG-EXPLANATION-END id=function:downgrade

