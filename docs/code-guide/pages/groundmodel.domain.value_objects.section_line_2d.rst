groundmodel.domain.value_objects.section_line_2d
================================================

.. CG-PAGE source=src/groundmodel/domain/value_objects/section_line_2d.py complete=true

*Source file:* ``src/groundmodel/domain/value_objects/section_line_2d.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-9

.. literalinclude:: ../../../src/groundmodel/domain/value_objects/section_line_2d.py
   :language: python
   :lines: 1-9
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The description line, ``from __future__ import annotations``, ``dataclass``, and NumPy imported as ``np`` (a numerical library used here only for one distance calculation).

**Why it is here.** NumPy is imported because the length property below uses its hypotenuse helper.

.. CG-EXPLANATION-END id=module-header

Class ``SectionLine2D`` — header
--------------------------------

.. CG-BLOCK id=class:SectionLine2D lines=10-23

.. literalinclude:: ../../../src/groundmodel/domain/value_objects/section_line_2d.py
   :language: python
   :lines: 10-23
   :lineno-match:

.. CG-EXPLANATION-START id=class:SectionLine2D

**What this does.** Defines ``SectionLine2D``, a frozen value object holding a cross-section's two endpoints in the project's horizontal coordinate system: ``start_x`` / ``start_y`` and ``end_x`` / ``end_y``.

**Why it is here.** A cross-section is a straight line drawn on the map; slice queries project a surface onto this line and return a polyline of (distance-along, elevation) points. This shape is that line, with nothing but the two ends.

.. CG-EXPLANATION-END id=class:SectionLine2D

Method ``SectionLine2D``. ``def length_m``
------------------------------------------

.. CG-BLOCK id=method:SectionLine2D.length_m lines=24-27

.. literalinclude:: ../../../src/groundmodel/domain/value_objects/section_line_2d.py
   :language: python
   :lines: 24-27
   :lineno-match:

.. CG-EXPLANATION-START id=method:SectionLine2D.length_m

**What this does.** A property that returns the straight-line horizontal length of the section, using NumPy's ``hypot`` (which computes the square root of the sum of the squares of the two side lengths — the hypotenuse).

**Why it is here.** The along-section distance axis needs the line's total length; computing it on read from the endpoints means it can never disagree with them.

.. CG-EXPLANATION-END id=method:SectionLine2D.length_m

