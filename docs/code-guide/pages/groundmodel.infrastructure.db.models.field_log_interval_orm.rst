groundmodel.infrastructure.db.models.field_log_interval_orm
===========================================================

.. CG-PAGE source=src/groundmodel/infrastructure/db/models/field_log_interval_orm.py complete=true

*Source file:* ``src/groundmodel/infrastructure/db/models/field_log_interval_orm.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-14

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/models/field_log_interval_orm.py
   :language: python
   :lines: 1-14
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The description line and the same small toolbox as the drill-segment table: ``Double``, ``ForeignKey``, ``Index``, ``String``, the Postgres ``UUID`` type, ``Mapped`` / ``mapped_column`` / ``relationship``, ``Base`` and the loader-strategy constant.

**Why it is here.** A child table with one foreign key to its borehole.

.. CG-EXPLANATION-END id=module-header

Class ``FieldLogIntervalOrm``
-----------------------------

.. CG-BLOCK id=class:FieldLogIntervalOrm lines=15-58

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/models/field_log_interval_orm.py
   :language: python
   :lines: 15-58
   :lineno-match:

.. CG-EXPLANATION-START id=class:FieldLogIntervalOrm

**What this does.** Defines the ``field_log_interval`` table: one depth interval of one field-recorded property — a ``borehole_id`` foreign key (cascade-delete), ``top_m`` / ``base_m``, a ``kind`` (color / moisture / consistency) and a raw ``value``, and a ``relationship`` back to the borehole. Indexed on borehole and on kind.

**Why it is here.** ``kind`` is stored as a plain string rather than a Postgres enum type so that adding a new kind is an application change, not a database migration — the ``FieldLogKind`` enum in the domain is the authoritative allow-list. ``value`` is stored in the raw source vocabulary (``groenbruin``, ``vochtig``) and translated only at the presentation boundary.

.. CG-EXPLANATION-END id=class:FieldLogIntervalOrm

