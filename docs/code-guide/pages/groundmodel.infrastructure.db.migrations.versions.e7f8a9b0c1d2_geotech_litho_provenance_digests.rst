groundmodel.infrastructure.db.migrations.versions.e7f8a9b0c1d2_geotech_litho_provenance_digests
===============================================================================================

.. CG-PAGE source=src/groundmodel/infrastructure/db/migrations/versions/e7f8a9b0c1d2_geotech_litho_provenance_digests.py complete=true

*Source file:* ``src/groundmodel/infrastructure/db/migrations/versions/e7f8a9b0c1d2_geotech_litho_provenance_digests.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-71

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/e7f8a9b0c1d2_geotech_litho_provenance_digests.py
   :language: python
   :lines: 1-71
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Header for the migration (revision ``e7f8a9b0c1d2``, following ``d5e6f7a8b9c0``) that adds a single JSONB column on the geological-model row stamping, per column, the fingerprint of the litho stack each column's geotech bands were built from. JSONB is PostgreSQL's format for storing a JSON document that can still be queried.

**Why it is here.** The long docstring records debt #266: dragging a litho contact used to leave the geotech bands silently describing a lithology stack that no longer existed. Staleness is derived, never stored — today's fingerprint is recomputed and compared — so the flag self-clears on the next press. The stamp is per column because CPT and borehole columns are banded by two different presses, so a model legitimately holds columns built from different litho revisions. There is deliberately no backfill: filling with today's litho would falsely assert every existing column is current.

.. CG-EXPLANATION-END id=module-header

Function ``def upgrade``
------------------------

.. CG-BLOCK id=function:upgrade lines=72-83

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/e7f8a9b0c1d2_geotech_litho_provenance_digests.py
   :language: python
   :lines: 72-83
   :lineno-match:

.. CG-EXPLANATION-START id=function:upgrade

**What this does.** Adds the nullable ``derived_from_litho_digests`` JSONB column to the geological-model table.

**Why it is here.** The docstring states that a null value means unknown provenance, which reads as not stale, so no existing project raises a false alarm and the signal starts telling the truth from the next press onward.

.. CG-EXPLANATION-END id=function:upgrade

Function ``def downgrade``
--------------------------

.. CG-BLOCK id=function:downgrade lines=84-86

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/e7f8a9b0c1d2_geotech_litho_provenance_digests.py
   :language: python
   :lines: 84-86
   :lineno-match:

.. CG-EXPLANATION-START id=function:downgrade

**What this does.** Drops the provenance-map column.

**Why it is here.** With the column gone the staleness signal goes silent, as the docstring notes; this reverses the addition cleanly.

.. CG-EXPLANATION-END id=function:downgrade

