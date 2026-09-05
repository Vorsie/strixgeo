desktop.renderer.src.utils.resolveModelFillPolys
================================================

.. CG-PAGE source=desktop/src/renderer/src/utils/resolveModelFillPolys.ts complete=true

*Source file:* ``desktop/src/renderer/src/utils/resolveModelFillPolys.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-70

.. literalinclude:: ../../../desktop/src/renderer/src/utils/resolveModelFillPolys.ts
   :language: typescript
   :lines: 1-70
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** This file takes the raw shapes produced when the 3-D litho bodies are sliced by a section plane, and works them into a clean set of non-overlapping shapes for the model-fill *overlay* (a drawing layer painted over the section). It uses a robust geometry library (jsts) to do the shape arithmetic, and follows one ownership rule: the thinner body is drawn on top. The imports pull in the jsts factory, coordinate and precision helpers and the polygonizer, plus the section-shape type.

**Why it is here.** The comment records the problem it solves: the 3-D bodies are meant to be mutually exclusive but on real voxel-built solids they overlap (measured double-covered samples on four real section lines), so drawing them in list order buries a thin clay block under a broad sand slab and stacks two see-through fills into a darker patch. The fix makes coverage at most 1 everywhere, with ownership derived from the geometry (thinner on top) and independent of list order, so the picture is stable frame to frame. Holes are kept on purpose: a clay lens fully inside a sand slab becomes a ring with a hole so the enclosed body shows through — dropping the hole would repaint the sand solid and the overlap would return. The odd jsts import is noted because that library ships its overlay operations as patches applied only by the full package entry.

.. CG-EXPLANATION-END id=module-header

``const RESOLVE_TOLERANCE_M``
-----------------------------

.. CG-BLOCK id=const:RESOLVE_TOLERANCE_M lines=71-73

.. literalinclude:: ../../../desktop/src/renderer/src/utils/resolveModelFillPolys.ts
   :language: typescript
   :lines: 71-73
   :lineno-match:

.. CG-EXPLANATION-START id=const:RESOLVE_TOLERANCE_M

**What this does.** One tolerance value in metres — 0.0001 m, a tenth of a millimetre — for the whole resolution stage.

**Why it is here.** The comment records that a single value is used everywhere (the snapping grid, the sliver-cleaning radius, and the minimum-area cutoff) so there is no cascade of slightly-different epsilons; a tenth of a millimetre is far below any real geometry yet above the numeric noise of double-precision arithmetic.

.. CG-EXPLANATION-END id=const:RESOLVE_TOLERANCE_M

``const MIN_VISIBLE_AREA``
--------------------------

.. CG-BLOCK id=const:MIN_VISIBLE_AREA lines=74-78

.. literalinclude:: ../../../desktop/src/renderer/src/utils/resolveModelFillPolys.ts
   :language: typescript
   :lines: 74-78
   :lineno-match:

.. CG-EXPLANATION-START id=const:MIN_VISIBLE_AREA

**What this does.** The smallest area worth keeping: the tolerance squared.

**Why it is here.** The comment records that anything smaller is a resolution crumb left over from the shape arithmetic and is dropped rather than drawn.

.. CG-EXPLANATION-END id=const:MIN_VISIBLE_AREA

``const PRECISION``
-------------------

.. CG-BLOCK id=const:PRECISION lines=79-79

.. literalinclude:: ../../../desktop/src/renderer/src/utils/resolveModelFillPolys.ts
   :language: typescript
   :lines: 79-79
   :lineno-match:

.. CG-EXPLANATION-START id=const:PRECISION

**What this does.** A fixed-precision model that snaps coordinates to the tolerance grid.

**Why it is here.** The comment records this is the geometry library's recommended way to make the boolean operations robust against the near-duplicate vertices the mesh slicer produces — rounding to a grid first removes them.

.. CG-EXPLANATION-END id=const:PRECISION

``const GF``
------------

.. CG-BLOCK id=const:GF lines=80-87

.. literalinclude:: ../../../desktop/src/renderer/src/utils/resolveModelFillPolys.ts
   :language: typescript
   :lines: 80-87
   :lineno-match:

.. CG-EXPLANATION-START id=const:GF

**What this does.** The geometry factory that builds every jsts shape, using the snapping precision model. The block ends with the documentation for the minimal jsts typing below.

**Why it is here.** It ties every shape this module creates to the same snap grid, so all the arithmetic happens at one consistent precision.

.. CG-EXPLANATION-END id=const:GF

``interface JstsRing``
----------------------

.. CG-BLOCK id=interface:JstsRing lines=88-92

.. literalinclude:: ../../../desktop/src/renderer/src/utils/resolveModelFillPolys.ts
   :language: typescript
   :lines: 88-92
   :lineno-match:

.. CG-EXPLANATION-START id=interface:JstsRing

**What this does.** A tiny declared shape for a jsts ring — just its one method that returns the coordinates.

**Why it is here.** The comment records that jsts ships no type descriptions on the deep import path used here, so the code declares only the slice of the library it actually touches.

.. CG-EXPLANATION-END id=interface:JstsRing

``interface JstsList``
----------------------

.. CG-BLOCK id=interface:JstsList lines=93-97

.. literalinclude:: ../../../desktop/src/renderer/src/utils/resolveModelFillPolys.ts
   :language: typescript
   :lines: 93-97
   :lineno-match:

.. CG-EXPLANATION-START id=interface:JstsList

**What this does.** A tiny declared shape for the java-style list the polygonizer hands back — a size and an index getter.

**Why it is here.** It describes only the two methods used to walk that list, for the same no-types-shipped reason.

.. CG-EXPLANATION-END id=interface:JstsList

``interface JstsGeometry``
--------------------------

.. CG-BLOCK id=interface:JstsGeometry lines=98-125

.. literalinclude:: ../../../desktop/src/renderer/src/utils/resolveModelFillPolys.ts
   :language: typescript
   :lines: 98-125
   :lineno-match:

.. CG-EXPLANATION-START id=interface:JstsGeometry

**What this does.** The slice of the jsts geometry object this module uses — area, emptiness and validity checks, the difference and union operations, buffering, and the ring and coordinate accessors.

**Why it is here.** Same reason: only the parts of the geometry library actually called are declared, since the deep import path carries no types of its own.

.. CG-EXPLANATION-END id=interface:JstsGeometry

``interface RankedPoly``
------------------------

.. CG-BLOCK id=interface:RankedPoly lines=126-132

.. literalinclude:: ../../../desktop/src/renderer/src/utils/resolveModelFillPolys.ts
   :language: typescript
   :lines: 126-132
   :lineno-match:

.. CG-EXPLANATION-START id=interface:RankedPoly

**What this does.** A raw section shape paired with the two numbers that set its drawing priority: its vertical thickness and its area.

**Why it is here.** The comment records that a smaller thickness means higher priority (drawn on top) and that the area is the first tiebreak between two shapes of equal thickness.

.. CG-EXPLANATION-END id=interface:RankedPoly

``function verticalExtent``
---------------------------

.. CG-BLOCK id=function:verticalExtent lines=133-143

.. literalinclude:: ../../../desktop/src/renderer/src/utils/resolveModelFillPolys.ts
   :language: typescript
   :lines: 133-143
   :lineno-match:

.. CG-EXPLANATION-START id=function:verticalExtent

**What this does.** Measures how tall a shape is — the difference between its highest and lowest elevation.

**Why it is here.** It is the priority key: thinner shapes win the top spot.

.. CG-EXPLANATION-END id=function:verticalExtent

``function ringAreaPoints``
---------------------------

.. CG-BLOCK id=function:ringAreaPoints lines=144-152

.. literalinclude:: ../../../desktop/src/renderer/src/utils/resolveModelFillPolys.ts
   :language: typescript
   :lines: 144-152
   :lineno-match:

.. CG-EXPLANATION-START id=function:ringAreaPoints

**What this does.** Computes the area of a ring of points by the shoelace sum, as a positive number.

**Why it is here.** It is the reusable area helper the ranking and the crumb-dropping both lean on.

.. CG-EXPLANATION-END id=function:ringAreaPoints

``function ringArea``
---------------------

.. CG-BLOCK id=function:ringArea lines=153-160

.. literalinclude:: ../../../desktop/src/renderer/src/utils/resolveModelFillPolys.ts
   :language: typescript
   :lines: 153-160
   :lineno-match:

.. CG-EXPLANATION-START id=function:ringArea

**What this does.** Computes the area of a shape's outer ring.

**Why it is here.** It is the tiebreak metric between two shapes that have the same thickness.

.. CG-EXPLANATION-END id=function:ringArea

``function comparePriority``
----------------------------

.. CG-BLOCK id=function:comparePriority lines=161-176

.. literalinclude:: ../../../desktop/src/renderer/src/utils/resolveModelFillPolys.ts
   :language: typescript
   :lines: 161-176
   :lineno-match:

.. CG-EXPLANATION-START id=function:comparePriority

**What this does.** Puts two shapes in priority order: thinner first, then smaller area, then by body id alphabetically.

**Why it is here.** The comment records this ordering is deterministic and independent of the order the shapes arrived in, which is what keeps the render stable frame to frame.

.. CG-EXPLANATION-END id=function:comparePriority

``function ringContains``
-------------------------

.. CG-BLOCK id=function:ringContains lines=177-189

.. literalinclude:: ../../../desktop/src/renderer/src/utils/resolveModelFillPolys.ts
   :language: typescript
   :lines: 177-189
   :lineno-match:

.. CG-EXPLANATION-START id=function:ringContains

**What this does.** Tests whether a point lies inside one ring by the crossing-number rule.

**Why it is here.** The comment records this is deliberately hand-written rather than handed to jsts: the whole point of this pass is that the slicer's rings are not valid polygons, so asking the library whether an invalid polygon contains a point would beg the question, whereas a crossing count is well-defined for any closed ring.

.. CG-EXPLANATION-END id=function:ringContains

``function ringToLine``
-----------------------

.. CG-BLOCK id=function:ringToLine lines=190-231

.. literalinclude:: ../../../desktop/src/renderer/src/utils/resolveModelFillPolys.ts
   :language: typescript
   :lines: 190-231
   :lineno-match:

.. CG-EXPLANATION-START id=function:ringToLine

**What this does.** Turns one ring of points into a closed jsts line, or nothing if the ring collapses to fewer than three points. The block ends with the documentation for the shape-building function below.

**Why it is here.** It produces the line work that the polygonizer needs in order to rebuild valid faces from possibly-invalid rings.

.. CG-EXPLANATION-END id=function:ringToLine

``function toJsts``
-------------------

.. CG-BLOCK id=function:toJsts lines=232-271

.. literalinclude:: ../../../desktop/src/renderer/src/utils/resolveModelFillPolys.ts
   :language: typescript
   :lines: 232-271
   :lineno-match:

.. CG-EXPLANATION-START id=function:toJsts

**What this does.** Builds a valid jsts shape for one section shape without losing any enclosed area: it turns every ring into line work, nodes the lines together so self-crossings become real corners, rebuilds faces from that line work, and keeps a face only when it is enclosed by an odd number of the source rings — the same even-odd rule the overlay draws with.

**Why it is here.** The long comment records why the old approach was wrong and caused the holes the engineer saw: a plane cut through a voxel mesh is staircase geometry whose faces meet at voxel corners, so self-touching rings are routine, and the previous method silently deleted one lobe of every such ring (measured: a self-crossing shape enclosing 8 came back as 4). The even-odd rebuild keeps every face the rings enclose and drops only genuine holes.

.. CG-EXPLANATION-END id=function:toJsts

``function ringToPoints``
-------------------------

.. CG-BLOCK id=function:ringToPoints lines=272-295

.. literalinclude:: ../../../desktop/src/renderer/src/utils/resolveModelFillPolys.ts
   :language: typescript
   :lines: 272-295
   :lineno-match:

.. CG-EXPLANATION-START id=function:ringToPoints

**What this does.** Converts a jsts ring back into a list of section points, dropping the duplicate closing coordinate jsts adds, and returns nothing for a ring with fewer than three distinct corners.

**Why it is here.** It is the reverse conversion, turning a resolved jsts ring back into the app's own point format.

.. CG-EXPLANATION-END id=function:ringToPoints

``function fromJsts``
---------------------

.. CG-BLOCK id=function:fromJsts lines=296-353

.. literalinclude:: ../../../desktop/src/renderer/src/utils/resolveModelFillPolys.ts
   :language: typescript
   :lines: 296-353
   :lineno-match:

.. CG-EXPLANATION-START id=function:fromJsts

**What this does.** Converts a resolved jsts shape (which may be several pieces) back into one or more section shapes carrying the original body's identity and colour, keeping every interior ring as a hole and dropping any sub-tolerance piece or hole.

**Why it is here.** The comment records that the holes must be preserved: when a lower-priority body fully encloses a higher-priority one, the difference is a ring with a hole, and dropping the hole would repaint the lower body as solid and bring the overlap back. Sub-tolerance holes are dropped so a float-noise sliver never punches a spurious transparent gap.

.. CG-EXPLANATION-END id=function:fromJsts

``function resolveModelFillPolys``
----------------------------------

.. CG-BLOCK id=function:resolveModelFillPolys lines=354-395

.. literalinclude:: ../../../desktop/src/renderer/src/utils/resolveModelFillPolys.ts
   :language: typescript
   :lines: 354-395
   :lineno-match:

.. CG-EXPLANATION-START id=function:resolveModelFillPolys

**What this does.** The public entry point. It ranks all the raw shapes by priority, then processes them thinnest-first while keeping a running "claimed" region: each shape is drawn as only the part not already claimed by thinner shapes above it, and the claimed region then grows by the whole shape so later, thicker shapes are clipped against everything above them.

**Why it is here.** The docstring records the guarantees: coverage is at most 1 everywhere (killing the clay-behind-sand occlusion and the stacked-transparency artefact), ownership is geometry-derived and order-independent, uncovered area is never filled, and disconnected bodies are never bridged. Even a fully hidden shape still grows the claimed region, so a later thicker body that overlaps it is clipped consistently.

.. CG-EXPLANATION-END id=function:resolveModelFillPolys

