groundmodel.infrastructure.db.migrations.versions.a26b3df9c041_observation_admixture_sample_schema
==================================================================================================

.. CG-PAGE source=src/groundmodel/infrastructure/db/migrations/versions/a26b3df9c041_observation_admixture_sample_schema.py complete=true

*Source file:* ``src/groundmodel/infrastructure/db/migrations/versions/a26b3df9c041_observation_admixture_sample_schema.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-31

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/a26b3df9c041_observation_admixture_sample_schema.py
   :language: python
   :lines: 1-31
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** A migration that adds the four borehole child tables: observations, observation layers, admixtures, and samples.

**Why it is here.** The docstring records this is phase A2 of borehole imports, building on the borehole foundation from an earlier migration. Each observation belongs to a borehole; each layer belongs to an observation and carries its soil codes and description; each admixture belongs to a layer and lives in its own table so a query like "find layers with glauconite" can use an index; each sample belongs to a borehole. All four cascade-delete from their parent so removing a borehole cleans up everything beneath it.

.. CG-EXPLANATION-END id=module-header

Function ``def upgrade``
------------------------

.. CG-BLOCK id=function:upgrade lines=32-111

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/a26b3df9c041_observation_admixture_sample_schema.py
   :language: python
   :lines: 32-111
   :lineno-match:

.. CG-EXPLANATION-START id=function:upgrade

**What this does.** Creates the observation, observation-layer, admixture and sample tables, each with the indexes that speed lookups by parent and by key fields (observation type, admixture soil code).

**Why it is here.** The child tables complete the borehole data model; the indexes back the common by-parent and by-attribute queries.

.. CG-EXPLANATION-END id=function:upgrade

Function ``def downgrade``
--------------------------

.. CG-BLOCK id=function:downgrade lines=112-125

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/a26b3df9c041_observation_admixture_sample_schema.py
   :language: python
   :lines: 112-125
   :lineno-match:

.. CG-EXPLANATION-START id=function:downgrade

**What this does.** Drops the four tables and their indexes in reverse dependency order (sample and admixture first, then layer, then observation).

**Why it is here.** So the chain can step backwards; the order respects the foreign-key dependencies.

.. CG-EXPLANATION-END id=function:downgrade

