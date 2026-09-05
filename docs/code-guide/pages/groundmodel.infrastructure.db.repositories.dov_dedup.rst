groundmodel.infrastructure.db.repositories.dov_dedup
====================================================

.. CG-PAGE source=src/groundmodel/infrastructure/db/repositories/dov_dedup.py complete=true

*Source file:* ``src/groundmodel/infrastructure/db/repositories/dov_dedup.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-29

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/repositories/dov_dedup.py
   :language: python
   :lines: 1-29
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** A module docstring plus a small toolbox: ``Iterable`` and ``UUID`` types, ``select`` (SQLAlchemy's query builder) and ``AsyncSession`` (an open, awaitable database connection). The docstring explains that these two helpers support the DOV refresh-on-duplicate import path.

**Why it is here.** When a map area is re-imported, the import runs for every borehole in the area — both new and already-stored. These helpers answer 'which of these upstream records do we already have?' by their stable DOV *permkey* (a permanent upstream key), so existing children are kept and only the genuinely-missing rows are added.

.. CG-EXPLANATION-END id=module-header

Function ``async def existing_dov_permkeys``
--------------------------------------------

.. CG-BLOCK id=function:existing_dov_permkeys lines=30-65

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/repositories/dov_dedup.py
   :language: python
   :lines: 30-65
   :lineno-match:

.. CG-EXPLANATION-START id=function:existing_dov_permkeys

**What this does.** An *async* function (one that can pause while it waits for the database) that returns the set of DOV permkeys already stored for a group of parent rows. It returns an empty set at once when there are no parents (so no pointless query is sent), and it ignores rows whose permkey is empty.

**Why it is here.** It is the 'skip this one' check for the persisters that only need to know whether a permkey already exists. NULL permkeys — legacy rows from before this upstream identity was recorded — are filtered out because they can never take part in de-duplication.

.. CG-EXPLANATION-END id=function:existing_dov_permkeys

Function ``async def existing_dov_permkey_to_id``
-------------------------------------------------

.. CG-BLOCK id=function:existing_dov_permkey_to_id lines=66-88

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/repositories/dov_dedup.py
   :language: python
   :lines: 66-88
   :lineno-match:

.. CG-EXPLANATION-START id=function:existing_dov_permkey_to_id

**What this does.** The sister helper: instead of a set it returns a map from each existing permkey to that row's id.

**Why it is here.** The sample persister needs more than a yes/no — it needs the existing sample's id, so that later lab-test import phases can attach new tests to a sample that is already in the database rather than making a duplicate.

.. CG-EXPLANATION-END id=function:existing_dov_permkey_to_id

