groundmodel.infrastructure.parsers.dov.dov_gml_location
=======================================================

.. CG-PAGE source=src/groundmodel/infrastructure/parsers/dov/dov_gml_location.py complete=true

*Source file:* ``src/groundmodel/infrastructure/parsers/dov/dov_gml_location.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-28

.. literalinclude:: ../../../src/groundmodel/infrastructure/parsers/dov/dov_gml_location.py
   :language: python
   :lines: 1-28
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** A docstring, then the imports for a shared helper that pulls x, y, z out of the GML point inside a DOV location element.

**Why it is here.** Both the CPT and the borehole DOV parsers read a position from the exact same nested structure and hit the same handful of failure cases. The structural walk is shared here so both read it the same way; each caller keeps only its own way of *reporting* a failure. This helper does no logging and no input or output of its own — it is pure — so it is easy to test. The docstring records a real quirk: DOV labels the point with one coordinate code but the numbers are actually Belgian Lambert 72, confirmed against the WFS properties.

.. CG-EXPLANATION-END id=module-header

Class ``GmlPointLocation``
--------------------------

.. CG-BLOCK id=class:GmlPointLocation lines=29-61

.. literalinclude:: ../../../src/groundmodel/infrastructure/parsers/dov/dov_gml_location.py
   :language: python
   :lines: 29-61
   :lineno-match:

.. CG-EXPLANATION-START id=class:GmlPointLocation

**What this does.** A small, unchangeable data-holder for the outcome of one location parse: the x, y, z (any of which may be blank), plus enough detail to explain a failure — a human-readable reason, how many coordinate components were found, and the raw text of a z that would not read as a number.

**Why it is here.** Returning a rich outcome object, rather than just three numbers, lets each caller phrase its own message — the CPT parser logs a warning, the borehole parser also emits validation findings — from the same underlying facts.

.. CG-EXPLANATION-END id=class:GmlPointLocation

Function ``def parse_gml_point_location``
-----------------------------------------

.. CG-BLOCK id=function:parse_gml_point_location lines=62-125

.. literalinclude:: ../../../src/groundmodel/infrastructure/parsers/dov/dov_gml_location.py
   :language: python
   :lines: 62-125
   :lineno-match:

.. CG-EXPLANATION-START id=function:parse_gml_point_location

**What this does.** Walks down from the location element to the GML point to the position text, splits the space-separated x y z, and returns them. At each of the five steps, if something is missing or unreadable it returns an outcome that names exactly which step broke. The z is optional.

**Why it is here.** Naming the exact failing step turns a vague "no coordinates" into an actionable message, and keeping the walk in one shared function means the CPT and borehole parsers can never drift apart on how they read a position.

.. CG-EXPLANATION-END id=function:parse_gml_point_location

