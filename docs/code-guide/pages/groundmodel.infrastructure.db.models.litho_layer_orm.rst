groundmodel.infrastructure.db.models.litho_layer_orm
====================================================

.. CG-PAGE source=src/groundmodel/infrastructure/db/models/litho_layer_orm.py complete=true

*Source file:* ``src/groundmodel/infrastructure/db/models/litho_layer_orm.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-24

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/models/litho_layer_orm.py
   :language: python
   :lines: 1-24
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The description line and the toolbox: ``CheckConstraint``, the column types (``Double``, ``String``, ``Text``), ``ForeignKey`` / ``Index``, ``func``, the Postgres ``UUID`` type, ``Mapped`` / ``mapped_column`` / ``relationship``, ``Base`` and the loader-strategy constant.

**Why it is here.** The building blocks for the litho-layer table, which carries several database-level check constraints.

.. CG-EXPLANATION-END id=module-header

Class ``LithoLayerOrm``
-----------------------

.. CG-BLOCK id=class:LithoLayerOrm lines=25-220

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/models/litho_layer_orm.py
   :language: python
   :lines: 25-220
   :lineno-match:

.. CG-EXPLANATION-START id=class:LithoLayerOrm

**What this does.** Defines the ``litho_layer`` table — one lithology interval on one investigation, the primitive of the lithostratigraphic model. It carries the model and formation ids, a two-way anchor (exactly one of borehole or CPT), the ``depth_top_m`` / ``depth_base_m`` interval, a lifecycle ``status`` (pending / accepted / rejected), a ``source`` and ``confidence``, optional observation backlinks, a geo-coupling link, a ``body_id`` (stamped by the resolver), and a self-referential ``parent_litho_layer_id`` linking a geotech band to the litho band it subdivides. Several ``CheckConstraint`` rules enforce the anchor XOR, the depth ordering, and the allowed status / source / confidence strings.

**Why it is here.** This is the layer-centric primitive that replaced the old per-boundary representation for litho models (docs/domain-model.md): boundaries between adjacent layers are simply each row's top and base, so no separate boundary table is needed. The ``status`` drives the lifecycle — pending renders hatched with accept/reject, accepted renders in the formation colour, rejected stays in the table for audit but is ignored. The check constraints are defence in depth so a typo in any write path cannot slip a bad status or an anchorless layer past the database. The ``body_id`` is filled in by the resolver and set-null on body delete so a layer survives a body reshuffle.

.. CG-EXPLANATION-END id=class:LithoLayerOrm

