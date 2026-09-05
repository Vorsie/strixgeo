groundmodel.infrastructure.db.migrations.versions.fce0b6dcb273_sample_geotech_assignment
========================================================================================

.. CG-PAGE source=src/groundmodel/infrastructure/db/migrations/versions/fce0b6dcb273_sample_geotech_assignment.py complete=true

*Source file:* ``src/groundmodel/infrastructure/db/migrations/versions/fce0b6dcb273_sample_geotech_assignment.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-25

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/fce0b6dcb273_sample_geotech_assignment.py
   :language: python
   :lines: 1-25
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Header for the migration (revision ``fce0b6dcb273``, following ``c120996a504d``) that adds three nullable columns to the ``sample`` table.

**Why it is here.** The docstring records the purpose: the divide-boreholes use case stamps each lab sample with the geotech body it belongs to, its NAD packing class, and the provenance tier of the matched band.

.. CG-EXPLANATION-END id=module-header

Function ``def upgrade``
------------------------

.. CG-BLOCK id=function:upgrade lines=26-50

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/fce0b6dcb273_sample_geotech_assignment.py
   :language: python
   :lines: 26-50
   :lineno-match:

.. CG-EXPLANATION-START id=function:upgrade

**What this does.** Adds the geotech-body id, NAD-class number and assignment-source columns to ``sample``, and an index on the body id.

**Why it is here.** The columns record the sample's geotech assignment; the index supports finding all samples assigned to a given body.

.. CG-EXPLANATION-END id=function:upgrade

Function ``def downgrade``
--------------------------

.. CG-BLOCK id=function:downgrade lines=51-56

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/fce0b6dcb273_sample_geotech_assignment.py
   :language: python
   :lines: 51-56
   :lineno-match:

.. CG-EXPLANATION-START id=function:downgrade

**What this does.** Drops the index and the three geotech-assignment columns.

**Why it is here.** The reverse of the addition, index first.

.. CG-EXPLANATION-END id=function:downgrade

