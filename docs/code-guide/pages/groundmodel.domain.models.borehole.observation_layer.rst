groundmodel.domain.models.borehole.observation_layer
====================================================

.. CG-PAGE source=src/groundmodel/domain/models/borehole/observation_layer.py complete=true

*Source file:* ``src/groundmodel/domain/models/borehole/observation_layer.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-10

.. literalinclude:: ../../../src/groundmodel/domain/models/borehole/observation_layer.py
   :language: python
   :lines: 1-10
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The description line and the toolbox: ``dataclass`` / ``field``, ``UUID`` / ``uuid7``, and the ``Admixture`` value object (a secondary soil component within a layer).

**Why it is here.** A layer can list several admixtures, so it imports that shape.

.. CG-EXPLANATION-END id=module-header

Class ``ObservationLayer`` — header
-----------------------------------

.. CG-BLOCK id=class:ObservationLayer lines=11-71

.. literalinclude:: ../../../src/groundmodel/domain/models/borehole/observation_layer.py
   :language: python
   :lines: 11-71
   :lineno-match:

.. CG-EXPLANATION-START id=class:ObservationLayer

**What this does.** Defines an ``ObservationLayer``: one depth interval within an observation stream. A single shape serves two uses — a lithology layer fills ``color``, ``main_soil_codes`` and ``admixtures``; a stratigraphy layer fills ``description`` (a formation code such as ``HyEg - Lid van Egem`` = Member of Egem) and leaves the lithology fields empty. It also carries ``layer_index``, its zero-based position in the parent stream, and its own ``id``.

**Why it is here.** ``main_soil_codes`` is a *list* because DOV's ``hoofdnaam`` (main name) element can repeat — a layer may have two equally-dominant soil types, e.g. ``XZ`` + ``KL``. ``layer_index`` is stored so the ordering survives a round-trip through any storage that does not itself guarantee insertion order. The raw DOV tokens are kept as written; translating them to English is a job for the presentation layer, never for ingest (the CLAUDE.md store-the-raw-token rule).

.. CG-EXPLANATION-END id=class:ObservationLayer

Method ``ObservationLayer``. ``def __post_init__``
--------------------------------------------------

.. CG-BLOCK id=method:ObservationLayer.__post_init__ lines=72-76

.. literalinclude:: ../../../src/groundmodel/domain/models/borehole/observation_layer.py
   :language: python
   :lines: 72-76
   :lineno-match:

.. CG-EXPLANATION-START id=method:ObservationLayer.__post_init__

**What this does.** Runs right after the layer is built; rejects a negative top depth and a negative layer index, raising ``ValueError``.

**Why it is here.** Single-field guards only. The base-deeper-than-top rule is left to ``DovInterpretationParser`` as an ``INVALID_INTERVAL`` ``ValidationIssue`` (CLAUDE.md Data-Integrity rule 5). Debt #15.

.. CG-EXPLANATION-END id=method:ObservationLayer.__post_init__

