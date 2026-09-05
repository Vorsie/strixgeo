desktop.renderer.src.utils.sectionFromSolids
============================================

.. CG-PAGE source=desktop/src/renderer/src/utils/sectionFromSolids.ts complete=true

*Source file:* ``desktop/src/renderer/src/utils/sectionFromSolids.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-24

.. literalinclude:: ../../../desktop/src/renderer/src/utils/sectionFromSolids.ts
   :language: typescript
   :lines: 1-24
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** This module ray-samples 3-D body solids to produce 2-D column segments (called Mode A). A *mesh* is a solid shape described by triangles; a *watertight* mesh is a fully-closed one with no gaps. Given one such mesh per litho body and a list of test locations on a cross-section, it casts a straight vertical ray at each test's (x, y) position and intersects it with every mesh to produce the depth intervals — pairs of top and base elevation — where that body is present at that column. It then documents the mesh type below.

**Why it is here.** The docstring records the purpose: a section overlay uses the output to render body fill bands that are geometrically consistent with the 3-D solid model, so the 2-D section and the 3-D model tell the same story.

.. CG-EXPLANATION-END id=module-header

``interface SolidMesh``
-----------------------

.. CG-BLOCK id=interface:SolidMesh lines=25-41

.. literalinclude:: ../../../desktop/src/renderer/src/utils/sectionFromSolids.ts
   :language: typescript
   :lines: 25-41
   :lineno-match:

.. CG-EXPLANATION-START id=interface:SolidMesh

**What this does.** A closed, watertight triangle mesh for one litho body: its body id, its formation id, a render colour, its list of [x, y, z] vertex positions in the map CRS, and its list of [i, j, k] triples that name three vertices each as one triangle. It is followed by the section-test docstring.

**Why it is here.** This is the 3-D solid the sampler and the slicer both read; being watertight is what makes the even-crossing pairing below reliable.

.. CG-EXPLANATION-END id=interface:SolidMesh

``interface SectionTest``
-------------------------

.. CG-BLOCK id=interface:SectionTest lines=42-58

.. literalinclude:: ../../../desktop/src/renderer/src/utils/sectionFromSolids.ts
   :language: typescript
   :lines: 42-58
   :lineno-match:

.. CG-EXPLANATION-START id=interface:SectionTest

**What this does.** A test location projected onto a cross-section: an id, its map x/y (the same CRS as the mesh vertices), and ``alongM`` — the distance along the section, used as the column's key in the rendered section. It is followed by the column-segment docstring.

**Why it is here.** Names the query points the vertical ray is cast at, and carries the along-section position each column is drawn at.

.. CG-EXPLANATION-END id=interface:SectionTest

``interface ColumnSegment``
---------------------------

.. CG-BLOCK id=interface:ColumnSegment lines=59-73

.. literalinclude:: ../../../desktop/src/renderer/src/utils/sectionFromSolids.ts
   :language: typescript
   :lines: 59-73
   :lineno-match:

.. CG-EXPLANATION-START id=interface:ColumnSegment

**What this does.** One depth interval where a specific body is present at a test column: its body id, formation id, colour, top elevation (the shallower end) and base elevation (the deeper end). It is followed by the solid-column docstring.

**Why it is here.** This is the per-body interval the ray-cast produces; the elevations are in the mesh's vertical CRS.

.. CG-EXPLANATION-END id=interface:ColumnSegment

``interface SolidColumn``
-------------------------

.. CG-BLOCK id=interface:SolidColumn lines=74-102

.. literalinclude:: ../../../desktop/src/renderer/src/utils/sectionFromSolids.ts
   :language: typescript
   :lines: 74-102
   :lineno-match:

.. CG-EXPLANATION-START id=interface:SolidColumn

**What this does.** All the body segments present at one test column: the test id, the along-section position, and the segments ordered shallowest-first. It is followed by the public-API comment and the sampler's docstring, which lays out the six-step ray-cast algorithm.

**Why it is here.** The docstring records the crucial dedup step: because a closed mesh shares edges between neighbouring triangles, a point sitting on a shared edge registers once in each neighbour, producing a duplicate crossing elevation that would corrupt the pairing — so near-equal crossings are collapsed before the crossings are paired into intervals.

.. CG-EXPLANATION-END id=interface:SolidColumn

``function sampleSolidColumns``
-------------------------------

.. CG-BLOCK id=function:sampleSolidColumns lines=103-155

.. literalinclude:: ../../../desktop/src/renderer/src/utils/sectionFromSolids.ts
   :language: typescript
   :lines: 103-155
   :lineno-match:

.. CG-EXPLANATION-START id=function:sampleSolidColumns

**What this does.** Samples each body at each test. For every test it collects the vertical ray's crossings with each mesh, skips any body the ray misses entirely, pairs the crossings into base/top intervals, and finally sorts the column's segments shallowest-first. It is followed by the Mode B comment and the section-plane-line docstring.

**Why it is here.** The comment records the watertight assumption: a closed mesh always yields an even crossing count after dedup, so an odd count means a non-manifold or flagged solid and the trailing crossing is silently dropped — the caller must therefore filter to watertight meshes (is_flagged = false) before sampling.

.. CG-EXPLANATION-END id=function:sampleSolidColumns

``interface SectionPlaneLine``
------------------------------

.. CG-BLOCK id=interface:SectionPlaneLine lines=156-189

.. literalinclude:: ../../../desktop/src/renderer/src/utils/sectionFromSolids.ts
   :language: typescript
   :lines: 156-189
   :lineno-match:

.. CG-EXPLANATION-START id=interface:SectionPlaneLine

**What this does.** A 2-D section line in map XY, given by its two endpoints. For the plane test the line is treated as extending infinitely; the endpoints only fix its direction and the along-section origin. It is followed by the section-polygon docstring.

**Why it is here.** The docstring records that Mode B slices bodies with a vertical plane standing on this line, rather than ray-sampling at each column as Mode A does.

.. CG-EXPLANATION-END id=interface:SectionPlaneLine

``interface SectionPoly``
-------------------------

.. CG-BLOCK id=interface:SectionPoly lines=190-235

.. literalinclude:: ../../../desktop/src/renderer/src/utils/sectionFromSolids.ts
   :language: typescript
   :lines: 190-235
   :lineno-match:

.. CG-EXPLANATION-START id=interface:SectionPoly

**What this does.** A closed polygon produced by slicing one body with the section plane: its body id, formation id, colour, an ordered ring of (alongM, elev) points, and optional inner holes. It is followed by the public-API comment and the plane-slice docstring, which lays out the five-step algorithm.

**Why it is here.** The docstring records two facts: winding is not guaranteed, so the renderer uses ``fill-rule: nonzero``; and holes are never set by the raw slicer — they are introduced only by the later resolution stage (``resolveModelFillPolys``) when a lower-priority body encloses a higher-priority one, for example a clay lens inside a sand slab, so the sand is emitted as a donut. That enclosed-lens case is the 0-tie LENS of the 2/1/0 contact-correlation model.

.. CG-EXPLANATION-END id=interface:SectionPoly

``function sliceSolidsAtPlane``
-------------------------------

.. CG-BLOCK id=function:sliceSolidsAtPlane lines=236-292

.. literalinclude:: ../../../desktop/src/renderer/src/utils/sectionFromSolids.ts
   :language: typescript
   :lines: 236-292
   :lineno-match:

.. CG-EXPLANATION-START id=function:sliceSolidsAtPlane

**What this does.** Slices each body with the vertical plane through the section line, producing one closed polygon per loop. It guards against a zero-length line, builds the unit direction, and for each mesh collects the triangle cut-segments and chains them into ordered closed rings, emitting one polygon per ring of at least three points. It is followed by the perpendicular-epsilon docstring.

**Why it is here.** The comment records why every loop is emitted: a body can slice into more than one closed loop when it pinches out and reappears (interfingering, or a lens — common with voxel bodies), and chaining only the first loop would silently drop the rest.

.. CG-EXPLANATION-END id=function:sliceSolidsAtPlane

``const PLANE_PERPENDICULAR_EPS``
---------------------------------

.. CG-BLOCK id=const:PLANE_PERPENDICULAR_EPS lines=293-314

.. literalinclude:: ../../../desktop/src/renderer/src/utils/sectionFromSolids.ts
   :language: typescript
   :lines: 293-314
   :lineno-match:

.. CG-EXPLANATION-START id=const:PLANE_PERPENDICULAR_EPS

**What this does.** A tiny perpendicular offset (0.2 mm) applied to the section line before slicing, so a plane exactly aligned to voxel or mesh faces never lands on a vertex or edge. It is followed by the robust-slice docstring.

**Why it is here.** The comment records the exact-plane bug it fixes: the cut-segment collector only registers a crossing on a strict sign change, but at a 2 m voxel grid a real section line frequently coincides with a body's wall, where every vertex has side zero — so no crossing fires and the whole body vanishes (measured: an exactly-aligned plane returned 0 polygons, a 1 cm parallel offset returned 312). Nudging the line by a fixed sub-millimetre epsilon turns every on-plane vertex into an unambiguous positive or negative side; 0.2 mm is far below any real geometry resolution yet far above SLICE_EPS, so the nudge is always decisive.

.. CG-EXPLANATION-END id=const:PLANE_PERPENDICULAR_EPS

``function sliceSolidsAtPlaneRobust``
-------------------------------------

.. CG-BLOCK id=function:sliceSolidsAtPlaneRobust lines=315-351

.. literalinclude:: ../../../desktop/src/renderer/src/utils/sectionFromSolids.ts
   :language: typescript
   :lines: 315-351
   :lineno-match:

.. CG-EXPLANATION-START id=function:sliceSolidsAtPlaneRobust

**What this does.** The same slice as above, but the cutting line is first nudged perpendicular by that epsilon. It defers a degenerate line to the raw slicer's own guard, computes the unit perpendicular, shifts both endpoints by the same offset (a translation, not a rotation), and slices the nudged line. It is followed by the zigzag-test docstring.

**Why it is here.** The docstring records that this is the variant the renderer MUST use for the model-fill overlay, because at a metre-scale voxel grid a real line routinely coincides with mesh faces and the raw slicer would silently drop plane-coincident vertices, making whole bodies disappear; shifting both endpoints equally preserves the along-section origin and scale so only the perpendicular classification changes, and the raw function is left untouched for diagnostics.

.. CG-EXPLANATION-END id=function:sliceSolidsAtPlaneRobust

``interface ZigzagTest``
------------------------

.. CG-BLOCK id=interface:ZigzagTest lines=352-368

.. literalinclude:: ../../../desktop/src/renderer/src/utils/sectionFromSolids.ts
   :language: typescript
   :lines: 352-368
   :lineno-match:

.. CG-EXPLANATION-START id=interface:ZigzagTest

**What this does.** A test location on the section, ordered by ``alongM`` ascending: its map x/y and its projected distance along the STRAIGHT section line (the section view's horizontal axis). It is followed by the minimum-segment docstring.

**Why it is here.** The docstring records that ``alongM`` is the projected distance on the straight section axis, which is the position the zigzag fill remaps each leg onto — the section-view spacing rule that fill must land on the section along-axis, not on a raw world distance.

.. CG-EXPLANATION-END id=interface:ZigzagTest

``const ZIGZAG_MIN_SEG_M``
--------------------------

.. CG-BLOCK id=const:ZIGZAG_MIN_SEG_M lines=369-391

.. literalinclude:: ../../../desktop/src/renderer/src/utils/sectionFromSolids.ts
   :language: typescript
   :lines: 369-391
   :lineno-match:

.. CG-EXPLANATION-START id=const:ZIGZAG_MIN_SEG_M

**What this does.** The minimum leg length (and along-section span) — 1 mm — below which a consecutive test pair is treated as coincident and skipped. It is followed by the ring-clip docstring.

**Why it is here.** The comment records why: two near-coincident boreholes, or two tests that project to the same along-section distance, would make a zero-length leg, and the remap divides by the leg's world length, so the leg is skipped; the threshold sits well above SLICE_EPS yet far below any real borehole spacing, so genuine legs are never dropped.

.. CG-EXPLANATION-END id=const:ZIGZAG_MIN_SEG_M

``function clipRingToAlongBand``
--------------------------------

.. CG-BLOCK id=function:clipRingToAlongBand lines=392-430

.. literalinclude:: ../../../desktop/src/renderer/src/utils/sectionFromSolids.ts
   :language: typescript
   :lines: 392-430
   :lineno-match:

.. CG-EXPLANATION-START id=function:clipRingToAlongBand

**What this does.** Clips a closed ring (in (alongM, elev) space) to the vertical along-section band between a lower and an upper bound, using the Sutherland–Hodgman algorithm: it clips against the lower bound keeping points at or above it, then against the upper bound keeping points at or below it, interpolating the elevation at each band-edge crossing. It is followed by the crossing-point docstring.

**Why it is here.** The docstring records why it is needed: the robust slicer cuts an INFINITE plane, so a body whose footprint extends past a leg's endpoints projects to along-distances outside the leg's own range; clipping each ring to the leg's band before remapping keeps each leg filling exactly its own sub-range and preserves the invariant that legs occupy disjoint ranges and so never overlap.

.. CG-EXPLANATION-END id=function:clipRingToAlongBand

``function intersectAtAlong``
-----------------------------

.. CG-BLOCK id=function:intersectAtAlong lines=431-478

.. literalinclude:: ../../../desktop/src/renderer/src/utils/sectionFromSolids.ts
   :language: typescript
   :lines: 431-478
   :lineno-match:

.. CG-EXPLANATION-START id=function:intersectAtAlong

**What this does.** Interpolates the point where a segment crosses the vertical line at a given along-distance bound, linearly interpolating the elevation by the along fraction; when both endpoints share the same along-distance the segment cannot cross the bound, so it returns the first endpoint clamped to the bound. It is followed by the zigzag-slice docstring.

**Why it is here.** The clip helper's crossing-point primitive; the degenerate-edge guard avoids a divide-by-zero on a vertical-in-along edge.

.. CG-EXPLANATION-END id=function:intersectAtAlong

``function sliceSolidsAlongZigzag``
-----------------------------------

.. CG-BLOCK id=function:sliceSolidsAlongZigzag lines=479-579

.. literalinclude:: ../../../desktop/src/renderer/src/utils/sectionFromSolids.ts
   :language: typescript
   :lines: 479-579
   :lineno-match:

.. CG-EXPLANATION-START id=function:sliceSolidsAlongZigzag

**What this does.** Slices bodies along a continuous zigzag path that threads test to test through their real (x, y) positions, producing a gap-free section fill. Each consecutive test pair is one straight leg, plane-sliced on its own; each slice point's local along-leg distance is then remapped onto the section along-axis so the leg fills exactly its own [alongM_i, alongM_i+1] range. It precomputes each mesh's footprint box once, skips near-coincident legs, slices only bodies whose box overlaps the leg, clips each ring to the leg's band, remaps to the section axis, and resolves per leg. It is followed by the private-helpers comment and the dedup-epsilon docstring.

**Why it is here.** The comments record two performance decisions and one correctness one: the footprint boxes are precomputed once so each leg does not re-scan every body's triangles (37 legs × 80 bodies × ~11k triangles on the real model); resolving per leg is valid because legs occupy disjoint along-ranges, so cross-leg overlap is impossible and per-leg resolution equals resolving the whole set while keeping the resolver's claimed area tiny per leg (roughly 1 s versus 18 s on the real model); and clipping each ring to the leg's band stops a body extending past a leg from bleeding into the neighbouring leg's range. Remapping every leg onto the section along-axis is the section-view spacing rule in its zigzag form.

.. CG-EXPLANATION-END id=function:sliceSolidsAlongZigzag

``const DEDUP_EPS``
-------------------

.. CG-BLOCK id=const:DEDUP_EPS lines=580-582

.. literalinclude:: ../../../desktop/src/renderer/src/utils/sectionFromSolids.ts
   :language: typescript
   :lines: 580-582
   :lineno-match:

.. CG-EXPLANATION-START id=const:DEDUP_EPS

**What this does.** The epsilon (1e-6 m) below which two z-crossing values are treated as the same, followed by the zero-area-guard docstring.

**Why it is here.** This is the tolerance the ray-crossing dedup uses to collapse the duplicate elevation a shared edge produces.

.. CG-EXPLANATION-END id=const:DEDUP_EPS

``const AREA_EPS``
------------------

.. CG-BLOCK id=const:AREA_EPS lines=583-597

.. literalinclude:: ../../../desktop/src/renderer/src/utils/sectionFromSolids.ts
   :language: typescript
   :lines: 583-597
   :lineno-match:

.. CG-EXPLANATION-START id=const:AREA_EPS

**What this does.** The epsilon for the zero-area guard in the 2-D point-in-triangle test (in squared metres, because the value it compares is twice the signed 2-D area). It is followed by the crossing-collection docstring.

**Why it is here.** The comment records that a triangle whose doubled area is below this is a degenerate sliver — such as a vertical wall whose XY projection collapses to a line — which must be rejected rather than treated as a real triangle.

.. CG-EXPLANATION-END id=const:AREA_EPS

``function collectCrossings``
-----------------------------

.. CG-BLOCK id=function:collectCrossings lines=598-637

.. literalinclude:: ../../../desktop/src/renderer/src/utils/sectionFromSolids.ts
   :language: typescript
   :lines: 598-637
   :lineno-match:

.. CG-EXPLANATION-START id=function:collectCrossings

**What this does.** Collects every z-crossing of the vertical ray at (px, py) with the mesh: for each triangle whose 2-D projection contains the point it interpolates the crossing elevation, then sorts the raw values and deduplicates them within DEDUP_EPS. It is followed by the point-in-triangle docstring.

**Why it is here.** The docstring records that the dedup is the key robustness step: shared edges between neighbouring triangles can each fire when the point sits exactly on them, duplicating the same z, and a closed mesh must have an even crossing count after dedup for the pairing to be correct; vertical-wall triangles have zero 2-D area and are skipped by the guard so they never pollute the list.

.. CG-EXPLANATION-END id=function:collectCrossings

``function pointInTriangle2D``
------------------------------

.. CG-BLOCK id=function:pointInTriangle2D lines=638-678

.. literalinclude:: ../../../desktop/src/renderer/src/utils/sectionFromSolids.ts
   :language: typescript
   :lines: 638-678
   :lineno-match:

.. CG-EXPLANATION-START id=function:pointInTriangle2D

**What this does.** A 2-D point-in-triangle test by the sign-of-cross-product method: the point is inside or on the boundary when the three edge cross products all share a sign (or are zero). A zero-area guard returns false for a degenerate triangle. It is followed by the z-interpolation docstring.

**Why it is here.** The docstring records that the test is edge-inclusive, so a point exactly on an edge counts as inside, and that the zero-area guard stops a vertical wall — whose XY projection collapses to a line — from making any point appear to be inside a degenerate sliver.

.. CG-EXPLANATION-END id=function:pointInTriangle2D

``function interpZ``
--------------------

.. CG-BLOCK id=function:interpZ lines=679-710

.. literalinclude:: ../../../desktop/src/renderer/src/utils/sectionFromSolids.ts
   :language: typescript
   :lines: 679-710
   :lineno-match:

.. CG-EXPLANATION-START id=function:interpZ

**What this does.** Interpolates the elevation at (px, py) from the triangle's three vertices using barycentric coordinates — it works out how strongly the point is pulled toward each of the three corners in 2-D, then blends the three corners' z by those same weights. It is followed by the dedup-sorted docstring.

**Why it is here.** The docstring records that the caller has already guaranteed the triangle is non-degenerate (the zero-area guard filtered it out), so dividing by the area is safe; the barycentric blend gives the exact elevation where the ray crosses that triangle.

.. CG-EXPLANATION-END id=function:interpZ

``function dedupSorted``
------------------------

.. CG-BLOCK id=function:dedupSorted lines=711-730

.. literalinclude:: ../../../desktop/src/renderer/src/utils/sectionFromSolids.ts
   :language: typescript
   :lines: 711-730
   :lineno-match:

.. CG-EXPLANATION-START id=function:dedupSorted

**What this does.** Removes duplicates from an already-sorted array within a given epsilon, collapsing adjacent within-epsilon values to their first representative. It is followed by the Mode B private-helpers comment and the slice-epsilon docstring.

**Why it is here.** The docstring records that this is the dedup step that makes the even-count pairing reliable on manifold meshes, where a shared edge fires twice for the same crossing elevation.

.. CG-EXPLANATION-END id=function:dedupSorted

``const SLICE_EPS``
-------------------

.. CG-BLOCK id=const:SLICE_EPS lines=731-733

.. literalinclude:: ../../../desktop/src/renderer/src/utils/sectionFromSolids.ts
   :language: typescript
   :lines: 731-733
   :lineno-match:

.. CG-EXPLANATION-START id=const:SLICE_EPS

**What this does.** The epsilon (1e-6 m) for plane-side sign tests and endpoint matching in Mode B, followed by the cut-segment docstring.

**Why it is here.** The docstring records why it is kept separate from DEDUP_EPS: the two serve different geometry — DEDUP_EPS is a z-only tolerance for ray crossings, while SLICE_EPS is used in XY for side-distance classification and in (alongM, elev) space for matching segment endpoints.

.. CG-EXPLANATION-END id=const:SLICE_EPS

``interface CutSegment``
------------------------

.. CG-BLOCK id=interface:CutSegment lines=734-755

.. literalinclude:: ../../../desktop/src/renderer/src/utils/sectionFromSolids.ts
   :language: typescript
   :lines: 734-755
   :lineno-match:

.. CG-EXPLANATION-START id=interface:CutSegment

**What this does.** A single cut segment produced by one triangle intersecting the section plane — its two (alongM, elev) endpoints. It is followed by the plane-side docstring.

**Why it is here.** Names the intermediate piece the slicer later chains into closed rings.

.. CG-EXPLANATION-END id=interface:CutSegment

``function planeSide``
----------------------

.. CG-BLOCK id=function:planeSide lines=756-784

.. literalinclude:: ../../../desktop/src/renderer/src/utils/sectionFromSolids.ts
   :language: typescript
   :lines: 756-784
   :lineno-match:

.. CG-EXPLANATION-START id=function:planeSide

**What this does.** Computes the signed perpendicular distance of a 3-D vertex from the section line in XY, via the 2-D cross product of the line direction with the vector from the line origin to the vertex: positive means left of the line, negative means right, zero means on the line. It is followed by the cut-segment-collection docstring.

**Why it is here.** The docstring records that using the cross product rather than the dot product measures perpendicular distance, not along-line distance, so vertices anywhere along the section are classified onto the correct side of the plane.

.. CG-EXPLANATION-END id=function:planeSide

``function collectCutSegments``
-------------------------------

.. CG-BLOCK id=function:collectCutSegments lines=785-873

.. literalinclude:: ../../../desktop/src/renderer/src/utils/sectionFromSolids.ts
   :language: typescript
   :lines: 785-873
   :lineno-match:

.. CG-EXPLANATION-START id=function:collectCutSegments

**What this does.** Collects every cut segment from intersecting the mesh with the plane. For each triangle it computes each vertex's side value, snaps near-zero values to exactly zero, and for each edge with a strict sign change it interpolates the 3-D crossing point and projects its XY onto the line to get the along-distance; a triangle with exactly two crossings yields one segment. It is followed by the loop-chaining docstring.

**Why it is here.** The comment records the anti-double-counting rule: snapping near-zero sides to zero and only registering a crossing on a strictly positive-to-negative change stops a shared edge being counted twice, and a triangle producing 0 or 1 crossings is degenerate or merely tangent and is skipped.

.. CG-EXPLANATION-END id=function:collectCutSegments

``function chainLoops``
-----------------------

.. CG-BLOCK id=function:chainLoops lines=874-938

.. literalinclude:: ../../../desktop/src/renderer/src/utils/sectionFromSolids.ts
   :language: typescript
   :lines: 874-938
   :lineno-match:

.. CG-EXPLANATION-START id=function:chainLoops

**What this does.** Chains an unordered set of cut segments into all of their ordered closed rings. It works on a mutable copy, starts a ring from the next remaining segment, and repeatedly appends the segment whose endpoint matches the current tail — trying both traversal directions, within SLICE_EPS — closing each ring and then starting a fresh one until the pool is empty.

**Why it is here.** The docstring records the reasoning: a watertight manifold sliced by a plane produces segments that form one or more closed loops (more than one when the body pinches out and reappears — interfingering, or a lens), so every loop must be extracted or disjoint pieces would be lost; each segment can be traversed either way, the inner loop is capped at the remaining pool size to prevent an infinite loop on non-manifold input, and consuming each segment as it is used guarantees the whole routine terminates.

.. CG-EXPLANATION-END id=function:chainLoops

