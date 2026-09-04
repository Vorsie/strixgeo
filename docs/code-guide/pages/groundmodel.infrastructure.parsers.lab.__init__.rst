groundmodel.infrastructure.parsers.lab
======================================

.. CG-PAGE source=src/groundmodel/infrastructure/parsers/lab/__init__.py complete=true

*Source file:* ``src/groundmodel/infrastructure/parsers/lab/__init__.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-9

.. literalinclude:: ../../../src/groundmodel/infrastructure/parsers/lab/__init__.py
   :language: python
   :lines: 1-9
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Marks the lab-test parsers folder as a package, with a note of what belongs here.

**Why it is here.** Laboratory tests on soil samples — grain-size (particle-size distribution), Atterberg limits, carbonate content, organic content, water content — are the third kind of investigation data this platform reads. DOV publishes them all through one shared observations layer, filtered by test type; today only the grain-size parser is built, and the others will follow the same shape.

.. CG-EXPLANATION-END id=module-header

