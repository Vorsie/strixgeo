groundmodel.infrastructure.gis.section_projection
=================================================

.. CG-PAGE source=src/groundmodel/infrastructure/gis/section_projection.py complete=true

*Source file:* ``src/groundmodel/infrastructure/gis/section_projection.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-47

.. literalinclude:: ../../../src/groundmodel/infrastructure/gis/section_projection.py
   :language: python
   :lines: 1-47
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Opens the backend copy of the section-line projection maths, imports the maths library, and sets the length below which a section counts as having zero length.

**Why it is here.** The docstring records that the desktop already projects investigations onto a section line in its own code, and this file mirrors that maths exactly so server-side exports need not receive pre-projected coordinates from the frontend. It defines the two outputs: *along* (distance forward from the section start) and *offset* (signed perpendicular distance from the line). The degenerate-length threshold matches the frontend's so both sides behave identically for the same input.

.. CG-EXPLANATION-END id=module-header

Class ``SectionEndpoints``
--------------------------

.. CG-BLOCK id=class:SectionEndpoints lines=48-57

.. literalinclude:: ../../../src/groundmodel/infrastructure/gis/section_projection.py
   :language: python
   :lines: 48-57
   :lineno-match:

.. CG-EXPLANATION-START id=class:SectionEndpoints

**What this does.** A frozen data holder for the four numbers that define a section line: the start and end coordinates.

**Why it is here.** Bundling the four numbers into one named shape keeps the projection functions tidy and makes it clear they operate on a whole line.

.. CG-EXPLANATION-END id=class:SectionEndpoints

Class ``ProjectionResult``
--------------------------

.. CG-BLOCK id=class:ProjectionResult lines=58-71

.. literalinclude:: ../../../src/groundmodel/infrastructure/gis/section_projection.py
   :language: python
   :lines: 58-71
   :lineno-match:

.. CG-EXPLANATION-START id=class:ProjectionResult

**What this does.** A frozen data holder for the result of projecting one point onto a line: its distance along the line and its signed distance to the side of the line.

**Why it is here.** These two numbers place a point relative to the section: how far along, and how far off to one side. A positive offset means the point lies to the left of the line's direction, matching the frontend's convention.

.. CG-EXPLANATION-END id=class:ProjectionResult

Function ``def project_point_onto_line``
----------------------------------------

.. CG-BLOCK id=function:project_point_onto_line lines=72-106

.. literalinclude:: ../../../src/groundmodel/infrastructure/gis/section_projection.py
   :language: python
   :lines: 72-106
   :lineno-match:

.. CG-EXPLANATION-START id=function:project_point_onto_line

**What this does.** Projects a point onto the section line, returning its along-distance and signed offset, or nothing when the section has zero length.

**Why it is here.** This is the shared maths that decides where a borehole or CPT sits relative to a drawn section. Returning nothing for a zero-length line is defensive; the interface already refuses to create such a section.

.. CG-EXPLANATION-END id=function:project_point_onto_line

Function ``def section_length``
-------------------------------

.. CG-BLOCK id=function:section_length lines=107-113

.. literalinclude:: ../../../src/groundmodel/infrastructure/gis/section_projection.py
   :language: python
   :lines: 107-113
   :lineno-match:

.. CG-EXPLANATION-START id=function:section_length

**What this does.** Returns the straight-line length of the section, in metres.

**Why it is here.** Needed both on its own and by the corridor test below to know where the line ends.

.. CG-EXPLANATION-END id=function:section_length

Function ``def project_onto_section_corridor``
----------------------------------------------

.. CG-BLOCK id=function:project_onto_section_corridor lines=114-156

.. literalinclude:: ../../../src/groundmodel/infrastructure/gis/section_projection.py
   :language: python
   :lines: 114-156
   :lineno-match:

.. CG-EXPLANATION-START id=function:project_onto_section_corridor

**What this does.** Projects a point and keeps it only when it is genuinely on the section: inside the sideways corridor AND between the two drawn endpoints; otherwise returns nothing.

**Why it is here.** The docstring calls this the single definition of "this investigation is on this section", and warns that a consumer filtering on sideways distance alone would treat an investigation past the end of the line as one of the section's columns — and so correlate or merge it on a section where it was never drawn. It mirrors the frontend function that produces the columns the engineer actually sees.

.. CG-EXPLANATION-END id=function:project_onto_section_corridor

