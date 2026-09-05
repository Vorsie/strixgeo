desktop.renderer.src.utils.polygonTriangulate
=============================================

.. CG-PAGE source=desktop/src/renderer/src/utils/polygonTriangulate.ts complete=true

*Source file:* ``desktop/src/renderer/src/utils/polygonTriangulate.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-11

.. literalinclude:: ../../../desktop/src/renderer/src/utils/polygonTriangulate.ts
   :language: typescript
   :lines: 1-11
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** This file cuts a flat shape (a ring of points) into triangles by the ear-clipping method, and hands back the triangles as triples of positions into the input list. It copes with both bulging (convex) and notched (concave) shapes, works whichever way round the ring is wound, and returns an empty list for a shape with fewer than three points or no real area.

**Why it is here.** The comment records why it must be concave-safe: a carved-lens matrix region has a notch, and the simpler fan method would wrongly fill that notch in. Cutting into triangles is needed because 3-D drawing surfaces draw triangles, not arbitrary shapes.

.. CG-EXPLANATION-END id=module-header

``interface Vec2``
------------------

.. CG-BLOCK id=interface:Vec2 lines=12-17

.. literalinclude:: ../../../desktop/src/renderer/src/utils/polygonTriangulate.ts
   :language: typescript
   :lines: 12-17
   :lineno-match:

.. CG-EXPLANATION-START id=interface:Vec2

**What this does.** A declared shape for one point in the section's flat plane: ``x`` along the section (the fraction axis) and ``y`` up (elevation).

**Why it is here.** It names the two-number point the triangulator works in, so the maths below reads in the section's own axes rather than raw screen pixels.

.. CG-EXPLANATION-END id=interface:Vec2

``function signedArea2``
------------------------

.. CG-BLOCK id=function:signedArea2 lines=18-28

.. literalinclude:: ../../../desktop/src/renderer/src/utils/polygonTriangulate.ts
   :language: typescript
   :lines: 18-28
   :lineno-match:

.. CG-EXPLANATION-START id=function:signedArea2

**What this does.** Computes twice the signed area of a ring by the shoelace sum; a result above zero means the ring is wound counter-clockwise.

**Why it is here.** The sign is what matters as much as the size: the triangulator needs to know which way the ring turns so it can flip it to counter-clockwise before the corner tests, which all assume that direction.

.. CG-EXPLANATION-END id=function:signedArea2

``function pointInTriangle``
----------------------------

.. CG-BLOCK id=function:pointInTriangle lines=29-37

.. literalinclude:: ../../../desktop/src/renderer/src/utils/polygonTriangulate.ts
   :language: typescript
   :lines: 29-37
   :lineno-match:

.. CG-EXPLANATION-START id=function:pointInTriangle

**What this does.** Tests whether a point lies inside a triangle, edge included, by checking it falls on the same side of all three edges.

**Why it is here.** It is the ear test's guard: a candidate corner can only be snipped off if no other point of the shape lies inside the triangle it would form.

.. CG-EXPLANATION-END id=function:pointInTriangle

``function triangulatePolygon2D``
---------------------------------

.. CG-BLOCK id=function:triangulatePolygon2D lines=38-113

.. literalinclude:: ../../../desktop/src/renderer/src/utils/polygonTriangulate.ts
   :language: typescript
   :lines: 38-113
   :lineno-match:

.. CG-EXPLANATION-START id=function:triangulatePolygon2D

**What this does.** The triangulator itself. It walks the ring (first flipped to counter-clockwise), looks for a bulging corner whose triangle holds no other point — an "ear" — snips that ear off as a triangle, and repeats until three points remain. If it ever gets stuck, it drops one point that lies exactly on the straight line between its neighbours and tries again. At the end it emits the final triangle only if it has real area.

**Why it is here.** The long comment records the bug this guards against: carved-matrix regions carry runs of points along a straight column edge, and a point in the middle of such a run is neither bulging nor notched, so the ear test skips it forever, the loop stalls, the shape is left half-triangulated, and the 3-D fence shows a hole (dogfeed 2026-06-10). Dropping such a straight-line point changes nothing about the shape, so it is safe. The final area check stops a fully-straight three-point ring from emitting a zero-area triangle instead of nothing.

.. CG-EXPLANATION-END id=function:triangulatePolygon2D

