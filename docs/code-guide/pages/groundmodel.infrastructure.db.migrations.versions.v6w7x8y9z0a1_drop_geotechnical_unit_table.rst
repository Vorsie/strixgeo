groundmodel.infrastructure.db.migrations.versions.v6w7x8y9z0a1_drop_geotechnical_unit_table
===========================================================================================

.. CG-PAGE source=src/groundmodel/infrastructure/db/migrations/versions/v6w7x8y9z0a1_drop_geotechnical_unit_table.py complete=true

*Source file:* ``src/groundmodel/infrastructure/db/migrations/versions/v6w7x8y9z0a1_drop_geotechnical_unit_table.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-32

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/v6w7x8y9z0a1_drop_geotechnical_unit_table.py
   :language: python
   :lines: 1-32
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Header for the migration (revision ``v6w7x8y9z0a1``, following ``fce0b6dcb273``) that drops the ``geotechnical_unit`` table.

**Why it is here.** The docstring records owner decision #237.4: geotech subdivision shipped instead through the three-level model-kind design, where geotech units are formation rows under a geotech-kind model materialised as layers; the ``geotechnical_unit`` table created for the retired CRUD flow never gained a production writer, so it is dropped together with its model and bundle key. Backwards-compatibility is suspended pre-ship, so the bundle key is removed without a format bump.

.. CG-EXPLANATION-END id=module-header

Function ``def upgrade``
------------------------

.. CG-BLOCK id=function:upgrade lines=33-39

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/v6w7x8y9z0a1_drop_geotechnical_unit_table.py
   :language: python
   :lines: 33-39
   :lineno-match:

.. CG-EXPLANATION-START id=function:upgrade

**What this does.** Drops the two indexes and then the ``geotechnical_unit`` table.

**Why it is here.** The table held no production rows, so dropping it loses nothing.

.. CG-EXPLANATION-END id=function:upgrade

Function ``def downgrade``
--------------------------

.. CG-BLOCK id=function:downgrade lines=40-83

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/v6w7x8y9z0a1_drop_geotechnical_unit_table.py
   :language: python
   :lines: 40-83
   :lineno-match:

.. CG-EXPLANATION-START id=function:downgrade

**What this does.** Recreates the ``geotechnical_unit`` table in the exact shape of the migration that first made it, with no data.

**Why it is here.** The docstring notes data is not restored because the table held no production rows; the reverse only re-establishes the shape.

.. CG-EXPLANATION-END id=function:downgrade

