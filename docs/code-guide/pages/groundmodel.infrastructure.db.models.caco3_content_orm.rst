groundmodel.infrastructure.db.models.caco3_content_orm
======================================================

.. CG-PAGE source=src/groundmodel/infrastructure/db/models/caco3_content_orm.py complete=true

*Source file:* ``src/groundmodel/infrastructure/db/models/caco3_content_orm.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-15

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/models/caco3_content_orm.py
   :language: python
   :lines: 1-15
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The description line and the standard lab-test toolbox: ``Date``, ``Double``, ``ForeignKey``, ``Index``, ``String``, the Postgres ``UUID`` type, ``Mapped`` / ``mapped_column`` / ``relationship``, ``Base`` and the loader-strategy constant.

**Why it is here.** The ordinary building blocks for a lab-test table with a sample foreign key.

.. CG-EXPLANATION-END id=module-header

Class ``CaCO3ContentOrm``
-------------------------

.. CG-BLOCK id=class:CaCO3ContentOrm lines=16-51

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/models/caco3_content_orm.py
   :language: python
   :lines: 16-51
   :lineno-match:

.. CG-EXPLANATION-START id=class:CaCO3ContentOrm

**What this does.** Defines the ``caco3_content`` table: an ``id``, a ``sample_id`` foreign key (cascade-delete), a ``dov_permkey``, the ``content_pct`` percentage, method and date, and a ``relationship`` back to the sample.

**Why it is here.** The stored form of a lime-content measurement. It is one row per test hanging off a sample, matching every other typed lab family; the ``dov_permkey`` gives the re-import refresh its stable key.

.. CG-EXPLANATION-END id=class:CaCO3ContentOrm

