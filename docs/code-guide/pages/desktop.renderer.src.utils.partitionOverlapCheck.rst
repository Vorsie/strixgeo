desktop.renderer.src.utils.partitionOverlapCheck
================================================

.. CG-PAGE source=desktop/src/renderer/src/utils/partitionOverlapCheck.ts complete=true

*Source file:* ``desktop/src/renderer/src/utils/partitionOverlapCheck.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-31

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionOverlapCheck.ts
   :language: typescript
   :lines: 1-31
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** This file holds a checker that proves the section fill is a true partition: inside one gap (the space between two neighbouring columns), no two ordinary regions may share any area. For every pair of regions it works out the EXACT overlapping area by cleaning each shape, cutting it into triangles, and adding up the triangle-against-triangle overlaps. A shape too tangled to cut into triangles falls back to a dense grid count instead.

**Why it is here.** The comment records why exact area beats sampling here (debt #228): the older CS1 gate rasterises each gap at 120×320 with a 30-cell floor, which is blind to hairline slivers — proven on the real CS1 gap 0 in 2026-07-06, where thin sand-clay and silt-sand overlaps hid below its resolution. Measuring exact area catches a sliver of any thinness with no threshold to tune. Lens regions are left out on purpose: a lens is an overlay that deliberately sits on top of its band (the 0 = LENS case of the 2/1/0 contact-correlation model in ``docs/design/section-fill.md``). Regions are only compared inside the same gap because the fraction axis is gap-local, so two gaps' coordinates are not comparable.

.. CG-EXPLANATION-END id=module-header

``interface OverlapRegionRef``
------------------------------

.. CG-BLOCK id=interface:OverlapRegionRef lines=32-40

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionOverlapCheck.ts
   :language: typescript
   :lines: 32-40
   :lineno-match:

.. CG-EXPLANATION-START id=interface:OverlapRegionRef

**What this does.** A declared data shape naming one region inside an overlap report: its position in the input list, its formation id, its body id (which may be empty), and its kind.

**Why it is here.** The comment records that the full ids are kept for diagnostics rather than shortened — the memory rule is never to trust a truncated id, because two different ids can share a short prefix.

.. CG-EXPLANATION-END id=interface:OverlapRegionRef

``interface OverlapReport``
---------------------------

.. CG-BLOCK id=interface:OverlapReport lines=41-52

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionOverlapCheck.ts
   :language: typescript
   :lines: 41-52
   :lineno-match:

.. CG-EXPLANATION-START id=interface:OverlapReport

**What this does.** The shape of one reported overlap: the gap it happened in, references to the two regions, the shared area in fraction-times-metre units, whether that area is exact or sampled, and the area-weighted centre of the shared patch.

**Why it is here.** It records everything a person needs to find and judge the sliver on screen: where it is, how big it is, and — through the method field — whether the number is exact or the fallback estimate.

.. CG-EXPLANATION-END id=interface:OverlapReport

``interface OverlapCheckOptions``
---------------------------------

.. CG-BLOCK id=interface:OverlapCheckOptions lines=53-62

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionOverlapCheck.ts
   :language: typescript
   :lines: 53-62
   :lineno-match:

.. CG-EXPLANATION-START id=interface:OverlapCheckOptions

**What this does.** A small options bag with one setting, ``minAreaFracM`` — the area below which a pair is treated as merely touching and not reported.

**Why it is here.** The comment explains the floor separates "touching" (two regions sharing only an edge, zero real area) from "overlapping" (real shared area). The default sits far above the roundoff noise of the maths and far below any sliver large enough to see, so it hides no real defect.

.. CG-EXPLANATION-END id=interface:OverlapCheckOptions

``const DEFAULT_MIN_AREA``
--------------------------

.. CG-BLOCK id=const:DEFAULT_MIN_AREA lines=63-64

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionOverlapCheck.ts
   :language: typescript
   :lines: 63-64
   :lineno-match:

.. CG-EXPLANATION-START id=const:DEFAULT_MIN_AREA

**What this does.** The default area floor: 0.000000001 (1e-9) fraction-metres.

**Why it is here.** This is the value the options comment above justifies — well above float roundoff noise (about 1e-14) and well below any renderable sliver (about 1e-4).

.. CG-EXPLANATION-END id=const:DEFAULT_MIN_AREA

``const SAMPLE_GRID``
---------------------

.. CG-BLOCK id=const:SAMPLE_GRID lines=65-66

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionOverlapCheck.ts
   :language: typescript
   :lines: 65-66
   :lineno-match:

.. CG-EXPLANATION-START id=const:SAMPLE_GRID

**What this does.** The grid size, per axis, of the sampling fallback: 64 points across and 64 down.

**Why it is here.** The comment records this is the resolution used only when a shape cannot be cut into triangles and the code must estimate the overlap by counting grid points instead.

.. CG-EXPLANATION-END id=const:SAMPLE_GRID

``type Tri``
------------

.. CG-BLOCK id=type:Tri lines=67-68

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionOverlapCheck.ts
   :language: typescript
   :lines: 67-68
   :lineno-match:

.. CG-EXPLANATION-START id=type:Tri

**What this does.** A *type alias* naming a triangle as exactly three section points.

**Why it is here.** Naming the triangle shape once keeps the clipping and area maths below readable and lets the type-checker confirm a triangle always has three corners.

.. CG-EXPLANATION-END id=type:Tri

``interface Bbox``
------------------

.. CG-BLOCK id=interface:Bbox lines=69-76

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionOverlapCheck.ts
   :language: typescript
   :lines: 69-76
   :lineno-match:

.. CG-EXPLANATION-START id=interface:Bbox

**What this does.** The shape of a bounding box: the lowest and highest fraction (``f0``, ``f1``) and the lowest and highest elevation (``e0``, ``e1``) of a region.

**Why it is here.** A bounding box is a cheap rectangle test: if two regions' rectangles do not overlap they cannot share area, so the expensive exact clip is skipped.

.. CG-EXPLANATION-END id=interface:Bbox

``function signedArea2``
------------------------

.. CG-BLOCK id=function:signedArea2 lines=77-87

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionOverlapCheck.ts
   :language: typescript
   :lines: 77-87
   :lineno-match:

.. CG-EXPLANATION-START id=function:signedArea2

**What this does.** Computes twice the signed area of a ring by the shoelace sum; a positive result means the ring is wound counter-clockwise.

**Why it is here.** The comment records that the sign is load-bearing, not just the size — the triangulation needs to know which way a ring turns so it can flip a clockwise ring to counter-clockwise before cutting it.

.. CG-EXPLANATION-END id=function:signedArea2

``function cross``
------------------

.. CG-BLOCK id=function:cross lines=88-96

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionOverlapCheck.ts
   :language: typescript
   :lines: 88-96
   :lineno-match:

.. CG-EXPLANATION-START id=function:cross

**What this does.** The 2-D cross product of two edges leaving point ``a``: it is positive when the three points ``a``, ``b``, ``c`` turn left and negative when they turn right.

**Why it is here.** This left-or-right test is the building block for everything below — deciding whether a corner is an "ear" that can be clipped off, and whether a point sits inside a triangle.

.. CG-EXPLANATION-END id=function:cross

``function cleanRing``
----------------------

.. CG-BLOCK id=function:cleanRing lines=97-142

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionOverlapCheck.ts
   :language: typescript
   :lines: 97-142
   :lineno-match:

.. CG-EXPLANATION-START id=function:cleanRing

**What this does.** Tidies a ring before it is cut into triangles: it drops points that repeat the previous point (including the wrap from last back to first), then removes points that lie exactly on the straight line between their two neighbours, repeating until nothing more can be removed.

**Why it is here.** The comment records that these zero-area detours stall the ear-clipper without changing the shape's area, and that removing one straightened point can leave its neighbour straightened too — which is why the removal loops until the ring is stable.

.. CG-EXPLANATION-END id=function:cleanRing

``function inClosedTriangle``
-----------------------------

.. CG-BLOCK id=function:inClosedTriangle lines=143-153

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionOverlapCheck.ts
   :language: typescript
   :lines: 143-153
   :lineno-match:

.. CG-EXPLANATION-START id=function:inClosedTriangle

**What this does.** Tests whether a point lies inside a triangle OR exactly on its edge (the "closed" triangle), by checking the point turns the same way against all three sides.

**Why it is here.** The long comment records why the on-edge case matters: a valid shape can have a deep concave comb whose inner corners sit exactly on a shared column line (several lens darts returning to x=0). A strict inside-only test would miss those on-edge corners, let the clipper swallow a comb tooth, and double-cover — after which the area no longer adds up and the whole shape is wrongly rejected. Counting the boundary as blocking keeps the clipper honest on such combs.

.. CG-EXPLANATION-END id=function:inClosedTriangle

``function triangulate``
------------------------

.. CG-BLOCK id=function:triangulate lines=154-202

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionOverlapCheck.ts
   :language: typescript
   :lines: 154-202
   :lineno-match:

.. CG-EXPLANATION-START id=function:triangulate

**What this does.** Cuts a simple ring into triangles by the ear-clipping method: repeatedly it finds a corner that forms a triangle with no other point inside, snips it off, and continues until three points remain. It returns nothing (``null``) if it can never find such a corner (the ring is not simple) or if the triangle areas do not add back up to the ring's own area.

**Why it is here.** The comment records the honesty rule: returning ``null`` rather than a wrong set of triangles means the caller falls back to counting grid points instead of trusting a bad area. The iteration guard stops a pathological ring from looping forever, and the final area check catches a silent mis-cut that would otherwise double-cover part of the shape.

.. CG-EXPLANATION-END id=function:triangulate

``function clipTriTri``
-----------------------

.. CG-BLOCK id=function:clipTriTri lines=203-228

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionOverlapCheck.ts
   :language: typescript
   :lines: 203-228
   :lineno-match:

.. CG-EXPLANATION-START id=function:clipTriTri

**What this does.** Cuts one triangle down to just the part that lies inside a second triangle, using the Sutherland-Hodgman method: it trims the first triangle against each of the second triangle's three edges in turn, keeping only what stays on the inner side.

**Why it is here.** The comment records that the exact overlap of two triangles is precisely this convex clip; adding up the clip over every pair of triangles gives the exact shared area of two whole regions.

.. CG-EXPLANATION-END id=function:clipTriTri

``function lerpAt``
-------------------

.. CG-BLOCK id=function:lerpAt lines=229-237

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionOverlapCheck.ts
   :language: typescript
   :lines: 229-237
   :lineno-match:

.. CG-EXPLANATION-START id=function:lerpAt

**What this does.** Finds the exact point where a segment crosses a clip line, by sliding from one end to the other in proportion to how far each end is from the line.

**Why it is here.** It is the helper the triangle clip uses to place a new corner exactly on the cutting edge when a segment crosses from inside to outside.

.. CG-EXPLANATION-END id=function:lerpAt

``function inPolygon``
----------------------

.. CG-BLOCK id=function:inPolygon lines=238-253

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionOverlapCheck.ts
   :language: typescript
   :lines: 238-253
   :lineno-match:

.. CG-EXPLANATION-START id=function:inPolygon

**What this does.** The nonzero-winding point-in-polygon test — the same one introduced on the ``partitionFillV2.parityCoverage`` page: it decides whether a point sits inside a shape by counting how the boundary winds around it.

**Why it is here.** The comment records it uses the same rule as the SVG renderer, so "inside" here means exactly what the browser paints. Here it serves the sampling fallback, deciding whether each grid point lands inside both shapes.

.. CG-EXPLANATION-END id=function:inPolygon

``function bboxOf``
-------------------

.. CG-BLOCK id=function:bboxOf lines=254-267

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionOverlapCheck.ts
   :language: typescript
   :lines: 254-267
   :lineno-match:

.. CG-EXPLANATION-START id=function:bboxOf

**What this does.** Walks a ring's points and returns its bounding box — the smallest and largest fraction and elevation.

**Why it is here.** It builds the cheap rectangle that lets the main check skip any pair of regions whose rectangles do not even overlap, before spending effort on the exact clip.

.. CG-EXPLANATION-END id=function:bboxOf

``interface PairMeasure``
-------------------------

.. CG-BLOCK id=interface:PairMeasure lines=268-274

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionOverlapCheck.ts
   :language: typescript
   :lines: 268-274
   :lineno-match:

.. CG-EXPLANATION-START id=interface:PairMeasure

**What this does.** An internal shape bundling the result of measuring one pair: the shared area, its centre point, and whether the number is exact or sampled.

**Why it is here.** It carries the measurement together with how it was obtained, so the caller can label the report honestly.

.. CG-EXPLANATION-END id=interface:PairMeasure

``function exactPairArea``
--------------------------

.. CG-BLOCK id=function:exactPairArea lines=275-307

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionOverlapCheck.ts
   :language: typescript
   :lines: 275-307
   :lineno-match:

.. CG-EXPLANATION-START id=function:exactPairArea

**What this does.** Adds up the exact shared area of two regions that have both been cut into triangles: for every triangle of the first against every triangle of the second it clips them together and sums the clip areas, also tracking the area-weighted centre of all the overlaps.

**Why it is here.** This is the exact-measurement path. The shoelace-weighted centre gives the diagnostic a point to aim at — the middle of the offending sliver — so a person can find it on screen.

.. CG-EXPLANATION-END id=function:exactPairArea

``function sampledPairArea``
----------------------------

.. CG-BLOCK id=function:sampledPairArea lines=308-351

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionOverlapCheck.ts
   :language: typescript
   :lines: 308-351
   :lineno-match:

.. CG-EXPLANATION-START id=function:sampledPairArea

**What this does.** The fallback measurement: over the rectangle where the two regions' bounding boxes overlap it lays a dense grid, counts the points that fall inside both shapes, and turns that count into an area and a rough centre.

**Why it is here.** The module comment records that a region should never fail to triangulate in practice, but if one does the instrument must not lie by throwing an error — so it degrades to this approximate count and marks the report as sampled rather than crashing the whole check.

.. CG-EXPLANATION-END id=function:sampledPairArea

``function findNonLensOverlaps``
--------------------------------

.. CG-BLOCK id=function:findNonLensOverlaps lines=352-440

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionOverlapCheck.ts
   :language: typescript
   :lines: 352-440
   :lineno-match:

.. CG-EXPLANATION-START id=function:findNonLensOverlaps

**What this does.** The main entry point. It groups the ordinary (non-lens) regions by gap, keeping their original positions for the report. It sets up lazy caches so each region's cleaned ring, bounding box and triangulation are computed at most once. Then, for every pair of regions in the same gap, it intersects their bounding boxes, skips the pair when they do not overlap, measures the shared area exactly when both regions triangulated and by sampling otherwise, drops anything below the area floor, and records a report for the rest. Reports come out ordered by gap and then by first region.

**Why it is here.** The docstring records that the caches are filled only for regions that reach a bounding-box-overlapping pair, so most regions are never triangulated at all — the check stays cheap on a clean section. Sorting by gap and region gives the diagnostic a stable, repeatable order.

.. CG-EXPLANATION-END id=function:findNonLensOverlaps

``function formatOverlapReports``
---------------------------------

.. CG-BLOCK id=function:formatOverlapReports lines=441-449

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionOverlapCheck.ts
   :language: typescript
   :lines: 441-449
   :lineno-match:

.. CG-EXPLANATION-START id=function:formatOverlapReports

**What this does.** Turns each overlap report into a single readable diagnostic line: the gap, the two regions' kinds and formation ids, the area in scientific notation, whether it was exact or sampled, the centre point, and the region and body ids.

**Why it is here.** The comment records that the full ids are printed deliberately, following the memory rule never to trust a truncated id when telling two regions apart.

.. CG-EXPLANATION-END id=function:formatOverlapReports

