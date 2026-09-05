groundmodel.infrastructure.db.models.organic_content_orm
========================================================

.. CG-PAGE source=src/groundmodel/infrastructure/db/models/organic_content_orm.py complete=true

*Source file:* ``src/groundmodel/infrastructure/db/models/organic_content_orm.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-15

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/models/organic_content_orm.py
   :language: python
   :lines: 1-15
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The description line and the standard lab-test toolbox: ``Date``, ``Double``, ``ForeignKey``, ``Index``, ``String``, the Postgres ``UUID`` type, ``Mapped`` / ``mapped_column`` / ``relationship``, ``Base`` and the loader-strategy constant.

**Why it is here.** The ordinary building blocks for a lab-test table with a sample foreign key.

.. CG-EXPLANATION-END id=module-header

Class ``OrganicContentOrm``
---------------------------

.. CG-BLOCK id=class:OrganicContentOrm lines=16-53

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/models/organic_content_orm.py
   :language: python
   :lines: 16-53
   :lineno-match:

.. CG-EXPLANATION-START id=class:OrganicContentOrm

**What this does.** Defines the ``organic_content`` table: an ``id``, a ``sample_id`` foreign key (cascade-delete), a ``dov_permkey``, the independent ``carbon_pct`` and ``matter_pct`` columns, method and date, and a ``relationship`` back to the sample.

**Why it is here.** The stored form of the organic-content measurement. Carbon and matter are two independent columns, never derived from each other, because the textbook conversion between them is empirical and soil-type dependent (Data-Integrity rule 3) — storing a derived value would fabricate data a consumer could not tell from a measurement.

.. CG-EXPLANATION-END id=class:OrganicContentOrm

