groundmodel.infrastructure.db.models.scalar_lab_test_orm
========================================================

.. CG-PAGE source=src/groundmodel/infrastructure/db/models/scalar_lab_test_orm.py complete=true

*Source file:* ``src/groundmodel/infrastructure/db/models/scalar_lab_test_orm.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-15

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/models/scalar_lab_test_orm.py
   :language: python
   :lines: 1-15
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The description line and the toolbox: ``Date``, ``Double``, ``ForeignKey``, ``Index``, ``String``, ``Text``, the Postgres ``UUID`` type, ``Mapped`` / ``mapped_column`` / ``relationship``, ``Base`` and the loader-strategy constant.

**Why it is here.** The building blocks for the catch-all scalar-test table.

.. CG-EXPLANATION-END id=module-header

Class ``ScalarLabTestOrm``
--------------------------

.. CG-BLOCK id=class:ScalarLabTestOrm lines=16-64

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/models/scalar_lab_test_orm.py
   :language: python
   :lines: 16-64
   :lineno-match:

.. CG-EXPLANATION-START id=class:ScalarLabTestOrm

**What this does.** Defines the ``scalar_lab_test`` table: the catch-all for scalar lab results outside the five typed families — a ``parameter_group`` and ``parameter`` (both uncapped ``Text``), a ``value_numeric`` or ``value_text``, a ``unit``, method, date, and a ``detection_condition`` code. Foreign-keyed to its sample (cascade-delete).

**Why it is here.** This is the stored form of the catch-all family from the domain model. Storing group and parameter as ``Text`` and keeping both a numeric and a text value slot lets one table hold anything DOV publishes — a grain density (a number) or an ASTM class (a short code) — so a new scalar parameter is a lookup entry, never a migration (docs/domain-model.md catch-all rule). All the source tokens are stored verbatim; translation is a presentation concern.

.. CG-EXPLANATION-END id=class:ScalarLabTestOrm

