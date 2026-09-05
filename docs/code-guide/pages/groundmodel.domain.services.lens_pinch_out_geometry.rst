groundmodel.domain.services.lens_pinch_out_geometry
===================================================

.. CG-PAGE source=src/groundmodel/domain/services/lens_pinch_out_geometry.py complete=true

*Source file:* ``src/groundmodel/domain/services/lens_pinch_out_geometry.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-32

.. literalinclude:: ../../../src/groundmodel/domain/services/lens_pinch_out_geometry.py
   :language: python
   :lines: 1-32
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Introduces the file and imports its tools — ``math`` for the
distance calculation, ``Sequence`` (a type meaning "any ordered run of items"),
the ``dataclass`` decorator, and ``Literal`` (a type that pins a value to a fixed
set of words). It pulls in the two thresholds from the constants file. The
docstring states the job: work out where a pinching soil layer's top surface
meets the top surface of the target layer beneath it.

**Why it is here.** This is the "section-local at mark-time" geometry for a lens
pinch-out (debt #101, slice 2). Everything is pure 2-D geometry in section
coordinates — along-section distance and elevation — with no TIN (a triangulated
surface), no database and no deferred resolve, so the wedge tip is computed once,
where the engineer marks the lens, and never revisited after a 3-D Build. The
docstring pins that design so the reader knows the wedge is a drawing on one
section, not a surface in space.

.. CG-EXPLANATION-END id=module-header

Class ``LensPinchTip``
----------------------

.. CG-BLOCK id=class:LensPinchTip lines=33-53

.. literalinclude:: ../../../src/groundmodel/domain/services/lens_pinch_out_geometry.py
   :language: python
   :lines: 33-53
   :lineno-match:

.. CG-EXPLANATION-START id=class:LensPinchTip

**What this does.** A small read-only record for the computed wedge tip of one
side of a lens: its along-section distance from the section start, and its
elevation above the datum. ``@dataclass(frozen=True)`` makes it a fixed bundle of
two numbers that cannot be changed once made.

**Why it is here.** The tip is a single point in section-2-D space, and giving
its two coordinates clear names is safer than returning a bare pair of numbers
whose order the caller has to remember. Freezing it guarantees a computed tip is
never edited by accident further down the line.

.. CG-EXPLANATION-END id=class:LensPinchTip

Class ``LensPinchGeometryError``
--------------------------------

.. CG-BLOCK id=class:LensPinchGeometryError lines=54-68

.. literalinclude:: ../../../src/groundmodel/domain/services/lens_pinch_out_geometry.py
   :language: python
   :lines: 54-68
   :lineno-match:

.. CG-EXPLANATION-START id=class:LensPinchGeometryError

**What this does.** Defines a dedicated error type — an "exception", an object
that is raised to stop the calculation and report a problem — for the case where
the wedge tip cannot be computed.

**Why it is here.** The docstring says the messages are written to be shown to
the engineer word for word and to be actionable ("add a contact closer to the
absent column, or check that the target lithology is present on this section").
A dedicated type lets the use-case layer catch exactly this failure and surface
its message, without confusing it with an ordinary programming bug.

.. CG-EXPLANATION-END id=class:LensPinchGeometryError

Function ``def _gradient_from_two_points``
------------------------------------------

.. CG-BLOCK id=function:_gradient_from_two_points lines=69-104

.. literalinclude:: ../../../src/groundmodel/domain/services/lens_pinch_out_geometry.py
   :language: python
   :lines: 69-104
   :lineno-match:

.. CG-EXPLANATION-START id=function:_gradient_from_two_points

**What this does.** Computes the dip (the slope of a surface: change in elevation divided by distance along the section) between two contacts. It raises the geometry error when the two points sit at almost the same along-distance, which would make the slope meaningless.

**Why it is here.** A reliable dip needs two contacts a real distance apart. The docstring's sign convention (positive rises to the right) keeps the slope's meaning unambiguous. The coincident-contact guard exists because dividing by a near-zero distance produces an enormous, unstable slope, which the comments trace to duplicate contacts at the same anchor investigation.

.. CG-EXPLANATION-END id=function:_gradient_from_two_points

Function ``def _target_gradient_at``
------------------------------------

.. CG-BLOCK id=function:_target_gradient_at lines=105-175

.. literalinclude:: ../../../src/groundmodel/domain/services/lens_pinch_out_geometry.py
   :language: python
   :lines: 105-175
   :lineno-match:

.. CG-EXPLANATION-START id=function:_target_gradient_at

**What this does.** Estimates the local slope of the underlying target surface near a given along-distance, by picking the segment of that surface which brackets the point (or the nearest end segment when the point is beyond its extent). It raises the geometry error when the target has fewer than two contacts.

**Why it is here.** This is the fallback dip used when the pinching side has only one contact, so no slope can be measured directly. The docstring justifies it geologically: a pinching unit drapes over the unit below at roughly the same angle, so borrowing the target's local slope is a defensible first approximation at the edge of the data.

.. CG-EXPLANATION-END id=function:_target_gradient_at

Function ``def compute_lens_pinch_tip``
---------------------------------------

.. CG-BLOCK id=function:compute_lens_pinch_tip lines=176-435

.. literalinclude:: ../../../src/groundmodel/domain/services/lens_pinch_out_geometry.py
   :language: python
   :lines: 176-435
   :lineno-match:

.. CG-EXPLANATION-START id=function:compute_lens_pinch_tip

**What this does.** The public calculation. It sorts the contacts, picks the two nearest present contacts on the approach side, measures the pinching surface's dip from them (or borrows the target's dip when only one contact exists), then extends a straight ray toward the missing column and finds where it crosses the target surface. It validates that the crossing lies between the data and the missing column before returning the tip; otherwise it raises a specific, actionable error.

**Why it is here.** The docstring lays out all five steps and every failure it guards. The central rule is that the wedge tip must land INSIDE the bracket of real data, not past the declared missing column: a tip beyond it means the lens is wider than claimed, which points to a wrong missing-column assignment rather than a valid pinch-out. Each raised error names the concrete fix, in keeping with the file's promise that messages are shown to the engineer verbatim.

.. CG-EXPLANATION-END id=function:compute_lens_pinch_tip

Function ``def project_along_to_world``
---------------------------------------

.. CG-BLOCK id=function:project_along_to_world lines=436-484

.. literalinclude:: ../../../src/groundmodel/domain/services/lens_pinch_out_geometry.py
   :language: python
   :lines: 436-484
   :lineno-match:

.. CG-EXPLANATION-START id=function:project_along_to_world

**What this does.** Converts a distance measured along the section line back into a real map position (x, y) in the project coordinate system. It builds a unit direction vector from the section's start and end points and steps along it. It refuses a zero-length section, which has no direction.

**Why it is here.** The wedge tip is computed in the flat along-and-elevation world of the section; to draw or store it on the map it must be turned back into ground coordinates. The zero-length guard prevents dividing by a section that starts and ends at the same point, which cannot define a direction.

.. CG-EXPLANATION-END id=function:project_along_to_world

