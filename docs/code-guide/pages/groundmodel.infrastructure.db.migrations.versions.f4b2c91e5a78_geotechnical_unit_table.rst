groundmodel.infrastructure.db.migrations.versions.f4b2c91e5a78_geotechnical_unit_table
======================================================================================

.. CG-PAGE source=src/groundmodel/infrastructure/db/migrations/versions/f4b2c91e5a78_geotechnical_unit_table.py complete=true

*Source file:* ``src/groundmodel/infrastructure/db/migrations/versions/f4b2c91e5a78_geotechnical_unit_table.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-34

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/f4b2c91e5a78_geotechnical_unit_table.py
   :language: python
   :lines: 1-34
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Header for the migration (revision ``f4b2c91e5a78``, following ``8a3f2c91d456``) that creates a ``geotechnical_unit`` table holding only structure — name, code, colour, display order, notes — for subdividing a formation.

**Why it is here.** The docstring records that a single geological formation often contains several geotechnical units with different parameters, and that this migration lands the v1.0 subdivide deliverable without committing to a parameter shape this early; per-unit parameter values are Phase 5 work. (Note: this table was later dropped once subdivision shipped through the model-kind design — see revision ``v6w7x8y9z0a1``.)

.. CG-EXPLANATION-END id=module-header

Function ``def upgrade``
------------------------

.. CG-BLOCK id=function:upgrade lines=35-80

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/f4b2c91e5a78_geotechnical_unit_table.py
   :language: python
   :lines: 35-80
   :lineno-match:

.. CG-EXPLANATION-START id=function:upgrade

**What this does.** Creates the ``geotechnical_unit`` table with its columns and two indexes — one by project, one by parent formation.

**Why it is here.** The comments note the project id is copied onto the row so list and filter queries need no join, and the cascade means deleting a formation removes every unit beneath it.

.. CG-EXPLANATION-END id=function:upgrade

Function ``def downgrade``
--------------------------

.. CG-BLOCK id=function:downgrade lines=81-85

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/f4b2c91e5a78_geotechnical_unit_table.py
   :language: python
   :lines: 81-85
   :lineno-match:

.. CG-EXPLANATION-START id=function:downgrade

**What this does.** Drops the two indexes and then the ``geotechnical_unit`` table.

**Why it is here.** The reverse of the create, in dependency order.

.. CG-EXPLANATION-END id=function:downgrade

