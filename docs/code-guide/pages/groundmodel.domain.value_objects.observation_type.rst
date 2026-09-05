groundmodel.domain.value_objects.observation_type
=================================================

.. CG-PAGE source=src/groundmodel/domain/value_objects/observation_type.py complete=true

*Source file:* ``src/groundmodel/domain/value_objects/observation_type.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-5

.. literalinclude:: ../../../src/groundmodel/domain/value_objects/observation_type.py
   :language: python
   :lines: 1-5
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The description line and one import of ``StrEnum``.

**Why it is here.** The observation type is stored as text, so a string-valued enum fits.

.. CG-EXPLANATION-END id=module-header

Class ``ObservationType``
-------------------------

.. CG-BLOCK id=class:ObservationType lines=6-33

.. literalinclude:: ../../../src/groundmodel/domain/value_objects/observation_type.py
   :language: python
   :lines: 6-33
   :lineno-match:

.. CG-EXPLANATION-START id=class:ObservationType

**What this does.** Defines ``ObservationType``, a StrEnum listing the eight kinds of interpretation stream a borehole can carry — from ``CODED_LITHOLOGY`` and ``GEOTECHNICAL_CODING`` through the several stratigraphy and hydrogeology variants.

**Why it is here.** Each member matches a separate DOV interpretation stream, and several can coexist on one borehole (a driller's coded lithology, an engineer's geotechnical re-coding, and a formal stratigraphic reading are all common) — each becomes its own ``Observation`` entity. Fixing the set as an enum keeps those streams distinct and typo-proof.

.. CG-EXPLANATION-END id=class:ObservationType

