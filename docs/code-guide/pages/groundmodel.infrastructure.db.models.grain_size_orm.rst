groundmodel.infrastructure.db.models.grain_size_orm
===================================================

.. CG-PAGE source=src/groundmodel/infrastructure/db/models/grain_size_orm.py complete=true

*Source file:* ``src/groundmodel/infrastructure/db/models/grain_size_orm.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-16

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/models/grain_size_orm.py
   :language: python
   :lines: 1-16
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The description line and the toolbox: ``Boolean``, ``Date``, ``ForeignKey``, ``Index``, ``String``, the Postgres ``ARRAY`` / ``DOUBLE_PRECISION`` and ``UUID`` types, ``Mapped`` / ``mapped_column`` / ``relationship``, ``Base`` and the loader-strategy constant.

**Why it is here.** The array types are here because a grain-size curve is stored as two parallel number arrays.

.. CG-EXPLANATION-END id=module-header

Class ``GrainSizeOrm``
----------------------

.. CG-BLOCK id=class:GrainSizeOrm lines=17-89

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/models/grain_size_orm.py
   :language: python
   :lines: 17-89
   :lineno-match:

.. CG-EXPLANATION-START id=class:GrainSizeOrm

**What this does.** Defines the ``grain_size`` table: the cumulative grain-size curve for a sample as two parallel Postgres arrays (``diameters_mm`` and ``pct_larger``), plus a ``dov_permkey``, the method and date, and the two pre-treatment flags. Foreign-keyed to its sample (cascade-delete).

**Why it is here.** The curve is stored as arrays — one row per test, one round-trip for the whole curve — mirroring the CPT series pattern, because a consumer needs the full curve atomically anyway (Data-Integrity rule 4). The docstring notes the honest trade-off: cross-sample aggregates (median percent-passing 0.063 mm across the project) are harder because each row's array indices differ, so that interpolation belongs in a domain service, never at ingest where it would store derived data and lose source fidelity (Data-Integrity rule 1).

.. CG-EXPLANATION-END id=class:GrainSizeOrm

