groundmodel.domain.value_objects.admixture
==========================================

.. CG-PAGE source=src/groundmodel/domain/value_objects/admixture.py complete=true

*Source file:* ``src/groundmodel/domain/value_objects/admixture.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-5

.. literalinclude:: ../../../src/groundmodel/domain/value_objects/admixture.py
   :language: python
   :lines: 1-5
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The description line and one import of ``dataclass``.

**Why it is here.** The smallest possible toolbox for a one-class value object.

.. CG-EXPLANATION-END id=module-header

Class ``Admixture`` — header
----------------------------

.. CG-BLOCK id=class:Admixture lines=6-38

.. literalinclude:: ../../../src/groundmodel/domain/value_objects/admixture.py
   :language: python
   :lines: 6-38
   :lineno-match:

.. CG-EXPLANATION-START id=class:Admixture

**What this does.** Defines ``Admixture``, a frozen value object for one *secondary* soil component within a layer: its source-vocabulary ``soil_code`` (``GL`` = glauconite, ``KL`` = clay), an ``amount`` qualifier (``Z`` = weak, ``M`` = medium, ``S`` = strong, ``V`` = much), and a ``locally`` flag saying whether it appears only in patches of the interval.

**Why it is here.** A layer's *main* soil type lives on the parent ``ObservationLayer.main_soil_codes``; this shape holds only the admixtures, which DOV writes in the ``<bijmenging>`` (admixture) element. The raw codes are kept as-is — translating them to a readable label is a parser or presentation concern.

.. CG-EXPLANATION-END id=class:Admixture

Method ``Admixture``. ``def __post_init__``
-------------------------------------------

.. CG-BLOCK id=method:Admixture.__post_init__ lines=39-42

.. literalinclude:: ../../../src/groundmodel/domain/value_objects/admixture.py
   :language: python
   :lines: 39-42
   :lineno-match:

.. CG-EXPLANATION-START id=method:Admixture.__post_init__

**What this does.** Runs right after the admixture is built; rejects an empty ``soil_code``, raising ``ValueError``.

**Why it is here.** An admixture with no soil code names nothing, so it is refused at construction.

.. CG-EXPLANATION-END id=method:Admixture.__post_init__

Method ``Admixture``. ``def canonical_key``
-------------------------------------------

.. CG-BLOCK id=method:Admixture.canonical_key lines=43-57

.. literalinclude:: ../../../src/groundmodel/domain/value_objects/admixture.py
   :language: python
   :lines: 43-57
   :lineno-match:

.. CG-EXPLANATION-START id=method:Admixture.canonical_key

**What this does.** Returns a short, deterministic string that identifies the admixture's *composition* — the soil code and amount joined by a colon, e.g. ``KL:Z``. The ``locally`` flag is deliberately left out of the key.

**Why it is here.** This key is used to build the admixture signature that the litho Accept step matches on when it decides whether a suggested unit already exists (its find-or-create key). Leaving ``locally`` out is a recorded owner decision: two admixtures that differ only in whether they occur in patches should count as the same composition for that grouping — composition buckets, not presence-within-layer detail.

.. CG-EXPLANATION-END id=method:Admixture.canonical_key

