groundmodel.infrastructure.db.models.sample_orm
===============================================

.. CG-PAGE source=src/groundmodel/infrastructure/db/models/sample_orm.py complete=true

*Source file:* ``src/groundmodel/infrastructure/db/models/sample_orm.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-15

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/models/sample_orm.py
   :language: python
   :lines: 1-15
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The description line and the toolbox: ``Date``, ``Double``, ``ForeignKey``, ``Index``, ``Integer``, ``String``, ``Text``, the Postgres ``UUID`` type, ``Mapped`` / ``mapped_column`` / ``relationship``, ``Base`` and the loader-strategy constant.

**Why it is here.** The building blocks for the sample table and its many lab-test relationships.

.. CG-EXPLANATION-END id=module-header

Class ``SampleOrm``
-------------------

.. CG-BLOCK id=class:SampleOrm lines=16-158

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/models/sample_orm.py
   :language: python
   :lines: 16-158
   :lineno-match:

.. CG-EXPLANATION-START id=class:SampleOrm

**What this does.** Defines the ``sample`` table — material taken from a borehole at a depth interval, and the hub linking a borehole to its lab tests. It carries the ``borehole_id`` foreign key (cascade-delete), a ``dov_permkey``, the depth interval and source-vocabulary metadata, three geotech-assignment columns, and a reverse ``relationship`` to each of the six lab-test families plus the borehole. A ``geotech_body_id`` foreign key (set-null) ties a sample to its packing body group.

**Why it is here.** A sample is the bridge to lab tests, and the direction is deliberate: a test hard-keys to its sample, but the sample has no stored 'tests performed' list — that would duplicate the lab tables and drift (Data-Integrity rule 4), so the six links are reverse-only, each loaded with one eager fetch and no join. The ``geotech_body_id`` gained a real foreign key (set-null) after an audit found a body deletion left a dangling id on every sample it grouped; set-null (not cascade) keeps the material while dropping only its grouping label. Equal top and base depths are stored faithfully for a spot sample.

.. CG-EXPLANATION-END id=class:SampleOrm

