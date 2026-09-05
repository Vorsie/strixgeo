groundmodel.domain.models.borehole.observation
==============================================

.. CG-PAGE source=src/groundmodel/domain/models/borehole/observation.py complete=true

*Source file:* ``src/groundmodel/domain/models/borehole/observation.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-12

.. literalinclude:: ../../../src/groundmodel/domain/models/borehole/observation.py
   :language: python
   :lines: 1-12
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The description line and the toolbox: ``dataclass`` / ``field``, ``date``, ``UUID`` / ``uuid7``, plus two project imports — ``ObservationLayer`` (the layers this stream is made of) and ``ObservationType`` (which kind of stream it is).

**Why it is here.** An observation holds a list of its own layers, so it imports the layer shape; ``field`` is used further down to give that list a fresh, private empty default.

.. CG-EXPLANATION-END id=module-header

Class ``Observation``
---------------------

.. CG-BLOCK id=class:Observation lines=13-60

.. literalinclude:: ../../../src/groundmodel/domain/models/borehole/observation.py
   :language: python
   :lines: 13-60
   :lineno-match:

.. CG-EXPLANATION-START id=class:Observation

**What this does.** Defines an ``Observation``: one interpretation stream attached to a borehole. It carries the ``borehole_id`` foreign key back to the hole, its ``observation_type``, the author and date and several source-vocabulary quality ratings, and a ``layers`` list holding the depth-ordered ``ObservationLayer`` rows that make it up. The ``layers`` and ``id`` fields use ``field(default_factory=...)`` so every new observation gets its own fresh empty list and its own new id.

**Why it is here.** One borehole can carry several observations of different type — for example the driller's original coded lithology plus an engineer's later geotechnical re-coding — so each stream is its own row with its own author and date. ``field(default_factory=list)`` is used instead of a plain ``= []`` default because a bare list default would be *shared* by every observation ever made (a well-known Python trap); the factory hands each one a private list.

.. CG-EXPLANATION-END id=class:Observation

