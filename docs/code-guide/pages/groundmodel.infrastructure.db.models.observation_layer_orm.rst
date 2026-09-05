groundmodel.infrastructure.db.models.observation_layer_orm
==========================================================

.. CG-PAGE source=src/groundmodel/infrastructure/db/models/observation_layer_orm.py complete=true

*Source file:* ``src/groundmodel/infrastructure/db/models/observation_layer_orm.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-15

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/models/observation_layer_orm.py
   :language: python
   :lines: 1-15
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The description line and the toolbox: ``Double``, ``ForeignKey``, ``Index``, ``Integer``, ``String``, ``Text``, the Postgres ``ARRAY`` and ``UUID`` types, ``Mapped`` / ``mapped_column`` / ``relationship``, ``Base`` and the loader-strategy constant.

**Why it is here.** ``ARRAY`` is here because a layer's main-soil codes are stored as a list in one column.

.. CG-EXPLANATION-END id=module-header

Class ``ObservationLayerOrm``
-----------------------------

.. CG-BLOCK id=class:ObservationLayerOrm lines=16-105

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/models/observation_layer_orm.py
   :language: python
   :lines: 16-105
   :lineno-match:

.. CG-EXPLANATION-START id=class:ObservationLayerOrm

**What this does.** Defines the ``observation_layer`` table: one depth interval inside an observation. It holds the ``observation_id`` foreign key (cascade-delete), the interval, an optional ``color``, a ``main_soil_codes`` array, a ``description``, a ``layer_index``, and relationships back to the observation and out to its admixtures.

**Why it is here.** The docstring explains a deliberate single-table design: the same row serves both lithology layers (which fill colour, soil codes and admixtures) and stratigraphy layers (which fill the description), discriminated by the parent observation's type. Keeping both in one table is simpler than two — the domain shape already unifies them, one relationship beats two, and a ninth DOV observation type tomorrow is absorbed cleanly. ``description`` is ``Text`` (uncapped) because DOV's geotechnical-coding streams ship long descriptions that blew past a previous length cap on real data. ``admixtures`` is a separate related table rather than a JSON blob so the soil-code index can answer 'find every layer with glauconite'.

.. CG-EXPLANATION-END id=class:ObservationLayerOrm

