desktop.renderer.src.utils.partitionFillV2.mergeTouchingBodies
==============================================================

.. CG-PAGE source=desktop/src/renderer/src/utils/partitionFillV2/mergeTouchingBodies.ts complete=true

*Source file:* ``desktop/src/renderer/src/utils/partitionFillV2/mergeTouchingBodies.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-66

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/mergeTouchingBodies.ts
   :language: typescript
   :lines: 1-66
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** This is a module — one source file the program loads as a unit — and it holds the LAST step of the section fill: after the engine has painted every soil patch, this pass looks for patches of the SAME soil that physically TOUCH and stamps them as one body. A ``body`` is the product's name for one continuous mass of soil; a filled patch is a ``SectionRegion`` (a region for short) and it carries its soil (``formationId``), the body it belongs to (``bodyId``), a shape (``polygon`` — a closed ring of fraction-across-the-gap and elevation-in-metres-TAW points), and which gap it sits in. The ``import`` lines at the top pull in the column geometry type, the three helpers that enforce a user's ``Separate`` ruling, the shared 1 mm snap grid constant, and the region type. The rest of the file is: helpers that test whether two polygons touch on exact geometry, and two public entry points — the plain ``mergeTouchingBodies`` and a richer ``mergeTouchingBodiesWithGroups`` that also reports the merge as groups of layer ids.

**Why it is here.** Owner ruling 8j, ``MERGE AFTER FILL`` (2026-07-17, verbatim: "you merge after everything is fucking filled!"): the fill sweep never suppresses a soil boundary in anticipation of a merge — a unit lenses or onlaps first, the fill runs, and only THEN do touching same-soil regions weld into one body here. This is the staged body model's first stage (per-section geometric connect); a body starts as its own unit and grows by connection only after the geometry exists. The module doc pins the safety property: this pass reassigns ONLY ``bodyId`` — never a vertex, a kind, a formation, or a gap — so it can never introduce a hole or an overlap and is invisible to the formation-based conformance gate. Touching is decided on EXACT snapped geometry, never a display raster (audit item 8, S37: a raster once false-merged two sands a real metre apart because their lit pixels abutted).

.. CG-EXPLANATION-END id=module-header

``const ELEV_TOUCH_EPS``
------------------------

.. CG-BLOCK id=const:ELEV_TOUCH_EPS lines=67-71

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/mergeTouchingBodies.ts
   :language: typescript
   :lines: 67-71
   :lineno-match:

.. CG-EXPLANATION-START id=const:ELEV_TOUCH_EPS

**What this does.** A ``constant`` (a fixed named value): the elevation tolerance for deciding two vertices touch vertically — half of the 1 mm arrangement grid.

**Why it is here.** The docstring's reason: two vertices snapped to the SAME 1 mm cell must count as touching, while a real vertical gap of centimetres never does. Half a cell is the exact boundary between those two cases.

.. CG-EXPLANATION-END id=const:ELEV_TOUCH_EPS

``const FRACTION_SNAP``
-----------------------

.. CG-BLOCK id=const:FRACTION_SNAP lines=72-74

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/mergeTouchingBodies.ts
   :language: typescript
   :lines: 72-74
   :lineno-match:

.. CG-EXPLANATION-START id=const:FRACTION_SNAP

**What this does.** The fallback horizontal tolerance (in gap-fraction units) used only when the real gap width is unknown — that is, in unit tests that call the merge with no columns.

**Why it is here.** Docstring: exact shared vertices are byte-equal after snapping so 1e-6 still catches them, while the sub-cell counterexample (two sands 0.002 fraction apart) is two thousand times larger and correctly never welds under it.

.. CG-EXPLANATION-END id=const:FRACTION_SNAP

``function ufFind``
-------------------

.. CG-BLOCK id=function:ufFind lines=75-86

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/mergeTouchingBodies.ts
   :language: typescript
   :lines: 75-86
   :lineno-match:

.. CG-EXPLANATION-START id=function:ufFind

**What this does.** The ``find`` step of a union-find. Union-find is a way to group things that are linked, directly or through a chain: every region points at a parent, and following the parents leads to the group's single representative. This function follows those pointers up to the representative and, on the way back, rewrites each one to point straight at it.

**Why it is here.** That rewrite is path compression — it keeps the chains almost flat so the many lookups the two adjacency scans make stay fast. It is the standard, well-understood union-find primitive.

.. CG-EXPLANATION-END id=function:ufFind

``function extent``
-------------------

.. CG-BLOCK id=function:extent lines=87-113

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/mergeTouchingBodies.ts
   :language: typescript
   :lines: 87-113
   :lineno-match:

.. CG-EXPLANATION-START id=function:extent

**What this does.** Returns the bounding box of a polygon ring: the lowest and highest fraction and the lowest and highest elevation among its points.

**Why it is here.** A cheap rectangle used as a quick reject — two regions whose boxes are clearly apart cannot touch, so the expensive edge-by-edge test is skipped for them.

.. CG-EXPLANATION-END id=function:extent

``function pointOnSegment``
---------------------------

.. CG-BLOCK id=function:pointOnSegment lines=114-143

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/mergeTouchingBodies.ts
   :language: typescript
   :lines: 114-143
   :lineno-match:

.. CG-EXPLANATION-START id=function:pointOnSegment

**What this does.** Tests whether a point lies ON a segment within tolerance, in two steps: first the point must sit inside the segment's tolerance-inflated bounding box, then its perpendicular distance from the segment's infinite line must be within one tolerance unit.

**Why it is here.** Fraction runs 0 to 1 while elevation is in metres, so the two axes have very different scales; the docstring's fix is to divide each axis by its own tolerance so they become comparable before the cross-product distance is taken. A shared corner passes trivially; a T-junction (the point on the interior of the edge) passes through the perpendicular test.

.. CG-EXPLANATION-END id=function:pointOnSegment

``function orient``
-------------------

.. CG-BLOCK id=function:orient lines=144-163

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/mergeTouchingBodies.ts
   :language: typescript
   :lines: 144-163
   :lineno-match:

.. CG-EXPLANATION-START id=function:orient

**What this does.** Returns the turn direction — left, right, or straight — of the ordered triple of points, measured in the same tolerance-normalised units as ``pointOnSegment``.

**Why it is here.** It is the standard cross-product sign that the proper-crossing branch of ``segmentsTouch`` needs to decide whether two segments straddle each other's line.

.. CG-EXPLANATION-END id=function:orient

``function segmentsTouch``
--------------------------

.. CG-BLOCK id=function:segmentsTouch lines=164-188

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/mergeTouchingBodies.ts
   :language: typescript
   :lines: 164-188
   :lineno-match:

.. CG-EXPLANATION-START id=function:segmentsTouch

**What this does.** Whether two segments meet in any way: a shared endpoint, a T-junction (an endpoint of one lying on the other), a proper crossing, or a collinear overlap.

**Why it is here.** The docstring lists these as every way two polygon boundaries can meet — the merge must catch all of them so no genuine touch is missed and no false one invented.

.. CG-EXPLANATION-END id=function:segmentsTouch

``function polygonsTouch``
--------------------------

.. CG-BLOCK id=function:polygonsTouch lines=189-228

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/mergeTouchingBodies.ts
   :language: typescript
   :lines: 189-228
   :lineno-match:

.. CG-EXPLANATION-START id=function:polygonsTouch

**What this does.** Whether two polygon rings touch, by comparing every edge of one against every edge of the other with ``segmentsTouch``.

**Why it is here.** The docstring notes the rings are small (a handful of vertices), so the exhaustive edge-pair scan is both simple and cheap — no cleverness needed.

.. CG-EXPLANATION-END id=function:polygonsTouch

``function gapEdgeFractionTol``
-------------------------------

.. CG-BLOCK id=function:gapEdgeFractionTol lines=229-245

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/mergeTouchingBodies.ts
   :language: typescript
   :lines: 229-245
   :lineno-match:

.. CG-EXPLANATION-START id=function:gapEdgeFractionTol

**What this does.** Returns the width of one 1 mm snap cell expressed in a gap's fraction units: it takes the gap's real width in metres from the two column x positions and divides 1 mm by it, floored at the fraction-snap value. It is exported so other code can reuse it.

**Why it is here.** The docstring insists this is a TRUE snap-cell tolerance, not a display epsilon — a millimetre means a different fraction on a narrow gap than on a wide one. It is exported so the identity augmentation samples column edges with exactly this tolerance, keeping ONE notion of "reaches the column", never two that could disagree.

.. CG-EXPLANATION-END id=function:gapEdgeFractionTol

``function edgeElevInterval``
-----------------------------

.. CG-BLOCK id=function:edgeElevInterval lines=246-287

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/mergeTouchingBodies.ts
   :language: typescript
   :lines: 246-287
   :lineno-match:

.. CG-EXPLANATION-START id=function:edgeElevInterval

**What this does.** Returns the elevation interval a region covers right at a column edge (fraction 0 or 1): it runs a scanline just inside that edge, collects where the polygon crosses it, and returns the lowest and highest crossing, or nothing when the region does not reach the edge.

**Why it is here.** The cross-gap weld needs to know whether a region reaches the shared column and, if so, over what elevation range, so two same-soil regions on facing sides of that column can be tested for a continuous overlap. Sampling just inside the edge (at the edge tolerance) still catches a polygon edge sitting exactly on the column.

.. CG-EXPLANATION-END id=function:edgeElevInterval

``function mergeTouchingBodies``
--------------------------------

.. CG-BLOCK id=function:mergeTouchingBodies lines=288-295

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/mergeTouchingBodies.ts
   :language: typescript
   :lines: 288-295
   :lineno-match:

.. CG-EXPLANATION-START id=function:mergeTouchingBodies

**What this does.** The plain public entry point: it runs the full merge and hands back only the relabelled regions, discarding the merge groups.

**Why it is here.** It delegates to ``mergeTouchingBodiesWithGroups`` with default options, so its behaviour is byte-identical to the original merge for the many callers that do not need the groups.

.. CG-EXPLANATION-END id=function:mergeTouchingBodies

``interface MergeTouchingBodiesOptions``
----------------------------------------

.. CG-BLOCK id=interface:MergeTouchingBodiesOptions lines=296-361

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/mergeTouchingBodies.ts
   :language: typescript
   :lines: 296-361
   :lineno-match:

.. CG-EXPLANATION-START id=interface:MergeTouchingBodiesOptions

**What this does.** An ``interface`` (a named shape for data) listing the three optional inputs to the richer merge. ``excludeFallback`` keeps substrate- and flood-painted regions out of both adjacency scans; ``identityKeyOf`` maps a formation id to the identity two masses are compared on; ``separatedPairs`` is the set of user ``Separate`` rulings expressed as canonical layer-id pairs the weld must not cross.

**Why it is here.** Each carries a specific ruling. ``excludeFallback`` stops inferred fill from welding two drilled bodies into one persisted identity. ``identityKeyOf`` exists because the geotech model keeps one formation row per (class, litho parent, geological parent), yet the owner ruled the identity is the CLASS (2026-08-21, "one mass one body"), so masses must be compared class-first. ``separatedPairs`` threads the owner's durable ``Separate`` statement (2026-08-31, debt #278 R5) in as a cannot-link. The docstring pins that with all three at their defaults the weld is byte-identical to the pre-change merge.

.. CG-EXPLANATION-END id=interface:MergeTouchingBodiesOptions

``function mergeTouchingBodiesWithGroups``
------------------------------------------

.. CG-BLOCK id=function:mergeTouchingBodiesWithGroups lines=362-529

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/mergeTouchingBodies.ts
   :language: typescript
   :lines: 362-529
   :lineno-match:

.. CG-EXPLANATION-START id=function:mergeTouchingBodiesWithGroups

**What this does.** The full merge. It starts every region as its own union-find group, reads the ``Separate`` rulings into a per-group record of which side of each split each group holds, and defines a ``union`` step that joins two groups UNLESS that join would place both sides of a separated pair under one root. It then runs two adjacency scans. The first, bucketed by gap and by soil identity, welds any two same-soil regions of one gap whose polygon boundaries touch (quick-rejecting by bounding box first, then calling ``polygonsTouch``). The second welds across a shared column: a region reaching the right edge of gap ``g`` and a same-soil region reaching the left edge of gap ``g+1`` over overlapping elevations become one continuous body. Finally it collects each connected group, picks its body id deterministically (the existing non-null id of the smallest-ordered member, else null), and returns the relabelled regions plus the layer-id groups (only components carrying two or more distinct layers).

**Why it is here.** Ruling 8j drives the weld; the determinism (fixed iteration order, smallest-ordered representative) is required so the same geometry always assigns the same body id across separate processes. The groups are returned in LAYER-id space, never body-id space, because body-id groups could not survive their own success — a merge relabelled every region to the merged id, the next payload's evidence collapsed to singletons, and the facts flapped in production (dogfeed 2026-08-12). Point contact welds on purpose: two facing onlaps meeting at the 0.5 apex (the emergent band, ruling 8l) share that vertex and must join, while a real vacant sub-cell strip stays split (S37). The ``Separate`` cannot-link mirrors the backend's constrained union-find exactly, so the paint seam the engineer drew stays visible.

.. CG-EXPLANATION-END id=function:mergeTouchingBodiesWithGroups

