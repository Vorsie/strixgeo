groundmodel.infrastructure.db.models.atterberg_limits_orm
=========================================================

.. CG-PAGE source=src/groundmodel/infrastructure/db/models/atterberg_limits_orm.py complete=true

*Source file:* ``src/groundmodel/infrastructure/db/models/atterberg_limits_orm.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-15

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/models/atterberg_limits_orm.py
   :language: python
   :lines: 1-15
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The description line and the SQLAlchemy toolbox: column types (``Boolean``, ``Date``, ``Double``, ``String``), ``ForeignKey`` / ``Index``, the Postgres ``UUID`` type, ``Mapped`` / ``mapped_column`` / ``relationship``, ``Base``, and the loader-strategy constant.

**Why it is here.** The ordinary building blocks for a lab-test table with a foreign key back to its sample.

.. CG-EXPLANATION-END id=module-header

Class ``AtterbergLimitsOrm``
----------------------------

.. CG-BLOCK id=class:AtterbergLimitsOrm lines=16-62

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/models/atterberg_limits_orm.py
   :language: python
   :lines: 16-62
   :lineno-match:

.. CG-EXPLANATION-START id=class:AtterbergLimitsOrm

**What this does.** Defines the ``atterberg_limits`` table: an ``id``, a ``sample_id`` foreign key (cascade-delete), a ``dov_permkey`` for de-duplication on re-import, the two measured limits and the ``non_plastic`` flag, the method and date, and a ``relationship`` back to the sample.

**Why it is here.** This is the stored form of the domain ``AtterbergLimits``. It stores only the two measured limits — the plasticity index is never a column, because it is derived and computing it on read keeps it from drifting from the limits (Data-Integrity rule 1). The ``dov_permkey`` is the stable upstream id that lets a re-import refresh this exact row rather than create a duplicate (the refresh-on-duplicate contract in CLAUDE.md).

.. CG-EXPLANATION-END id=class:AtterbergLimitsOrm

