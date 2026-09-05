groundmodel.infrastructure.db.models.observation_orm
====================================================

.. CG-PAGE source=src/groundmodel/infrastructure/db/models/observation_orm.py complete=true

*Source file:* ``src/groundmodel/infrastructure/db/models/observation_orm.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-15

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/models/observation_orm.py
   :language: python
   :lines: 1-15
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The description line and the toolbox: ``Date``, ``ForeignKey``, ``Index``, ``String``, the Postgres ``UUID`` type, ``Mapped`` / ``mapped_column`` / ``relationship``, ``Base`` and the loader-strategy constant.

**Why it is here.** The building blocks for the observation-stream table.

.. CG-EXPLANATION-END id=module-header

Class ``ObservationOrm``
------------------------

.. CG-BLOCK id=class:ObservationOrm lines=16-80

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/models/observation_orm.py
   :language: python
   :lines: 16-80
   :lineno-match:

.. CG-EXPLANATION-START id=class:ObservationOrm

**What this does.** Defines the ``observation`` table: one interpretation stream on a borehole. It carries the ``borehole_id`` foreign key (cascade-delete), a ``dov_permkey``, an ``observation_type``, the source-vocabulary metadata (author, date, quality ratings), and relationships back to the borehole and out to its layers. Indexed on borehole and on type.

**Why it is here.** A borehole can carry several observations of different type (the driller's coded lithology plus an engineer's re-coding), each its own row. ``observation_type`` is a plain string, not a Postgres enum, so a new type is an application change rather than a migration — the ``ObservationType`` enum is the authoritative allow-list. The type index supports queries like 'show only the formal stratigraphy across the project'.

.. CG-EXPLANATION-END id=class:ObservationOrm

