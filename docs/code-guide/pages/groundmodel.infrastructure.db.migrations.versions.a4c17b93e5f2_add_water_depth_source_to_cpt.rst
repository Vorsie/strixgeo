groundmodel.infrastructure.db.migrations.versions.a4c17b93e5f2_add_water_depth_source_to_cpt
============================================================================================

.. CG-PAGE source=src/groundmodel/infrastructure/db/migrations/versions/a4c17b93e5f2_add_water_depth_source_to_cpt.py complete=true

*Source file:* ``src/groundmodel/infrastructure/db/migrations/versions/a4c17b93e5f2_add_water_depth_source_to_cpt.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-54

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/a4c17b93e5f2_add_water_depth_source_to_cpt.py
   :language: python
   :lines: 1-54
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** A migration that adds a ``water_depth_source`` provenance column to the CPT table.

**Why it is here.** The docstring records why (data-integrity rule 1 — where did this number come from?): the Parameters stage lets the engineer type the water table a CPT is normalised against, so once a second writer exists the water-depth value alone cannot say whether it was parsed from the file or typed by the engineer, and the refresh-on-import path cannot tell judgement from an overwritable value. The column carries that provenance as a token; empty means no water table is recorded at all and the consumer falls back to a default and labels it assumed. There is deliberately no "assumed" token — an assumption is the absence of a record. Hand-written, not auto-generated, for the recorded drift reason.

.. CG-EXPLANATION-END id=module-header

Function ``def upgrade``
------------------------

.. CG-BLOCK id=function:upgrade lines=55-62

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/a4c17b93e5f2_add_water_depth_source_to_cpt.py
   :language: python
   :lines: 55-62
   :lineno-match:

.. CG-EXPLANATION-START id=function:upgrade

**What this does.** Adds the nullable provenance column and backfills every row that has a water depth as parsed from the file.

**Why it is here.** Today the GEF parser is the only writer of the water-depth column, so a stored depth can only have come from a file — the backfill reflects that fact.

.. CG-EXPLANATION-END id=function:upgrade

Function ``def downgrade``
--------------------------

.. CG-BLOCK id=function:downgrade lines=63-65

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/a4c17b93e5f2_add_water_depth_source_to_cpt.py
   :language: python
   :lines: 63-65
   :lineno-match:

.. CG-EXPLANATION-START id=function:downgrade

**What this does.** Drops the provenance column, at which point a parsed and a typed depth become indistinguishable.

**Why it is here.** So the chain can step backwards; the docstring notes the lost distinction is acceptable only because backwards-compat is suspended pre-ship.

.. CG-EXPLANATION-END id=function:downgrade

