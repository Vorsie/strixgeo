groundmodel.infrastructure.db.migrations.versions.d4f8a92b6c10_lab_test_schema
==============================================================================

.. CG-PAGE source=src/groundmodel/infrastructure/db/migrations/versions/d4f8a92b6c10_lab_test_schema.py complete=true

*Source file:* ``src/groundmodel/infrastructure/db/migrations/versions/d4f8a92b6c10_lab_test_schema.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-31

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/d4f8a92b6c10_lab_test_schema.py
   :language: python
   :lines: 1-31
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** A migration that creates the five typed laboratory-test tables: grain size, Atterberg limits, calcium-carbonate content, organic content and water content. The header carries its revision id and the id it follows.

**Why it is here.** The docstring marks this as the lab step of borehole imports. Each table links to a sample with cascade delete so removing a sample or its borehole cleans up all its lab tests. It also records two data-integrity choices: the plasticity index is computed on read from the two limits and never stored, and organic carbon and organic matter are kept independently with no automatic conversion between them (CLAUDE.md Data Integrity Rule 3).

.. CG-EXPLANATION-END id=module-header

Function ``def _create_simple_test_table``
------------------------------------------

.. CG-BLOCK id=function:_create_simple_test_table lines=32-51

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/d4f8a92b6c10_lab_test_schema.py
   :language: python
   :lines: 32-51
   :lineno-match:

.. CG-EXPLANATION-START id=function:_create_simple_test_table

**What this does.** A helper that builds one lab table sharing the common scaffold — id, sample foreign key, the given value columns, a method, a test date — plus an index on the sample id.

**Why it is here.** The docstring notes four of the five tables share the same scaffold and differ only in their value columns, so wrapping the boilerplate keeps the upgrade readable instead of repeating thirty near-identical lines.

.. CG-EXPLANATION-END id=function:_create_simple_test_table

Function ``def upgrade``
------------------------

.. CG-BLOCK id=function:upgrade lines=52-100

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/d4f8a92b6c10_lab_test_schema.py
   :language: python
   :lines: 52-100
   :lineno-match:

.. CG-EXPLANATION-START id=function:upgrade

**What this does.** Creates ``grain_size`` in full (two parallel arrays plus two pre-treatment flags), then uses the helper for ``atterberg_limits``, ``caco3_content``, ``organic_content`` and ``water_content`` with their specific value columns.

**Why it is here.** Grain size is built directly because it carries extra array and flag columns the others do not. The comments restate the integrity choices: the plasticity index computed on read, organic carbon and matter independent, and water content allowed to exceed 100% for organic soils.

.. CG-EXPLANATION-END id=function:upgrade

Function ``def downgrade``
--------------------------

.. CG-BLOCK id=function:downgrade lines=101-110

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/d4f8a92b6c10_lab_test_schema.py
   :language: python
   :lines: 101-110
   :lineno-match:

.. CG-EXPLANATION-START id=function:downgrade

**What this does.** Drops all five tables and their sample-id indexes, in reverse order.

**Why it is here.** The exact reverse of the upgrade.

.. CG-EXPLANATION-END id=function:downgrade

