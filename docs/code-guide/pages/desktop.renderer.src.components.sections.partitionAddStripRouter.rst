desktop.renderer.src.components.sections.partitionAddStripRouter
================================================================

.. CG-PAGE source=desktop/src/renderer/src/components/sections/partitionAddStripRouter.ts complete=true

*Source file:* ``desktop/src/renderer/src/components/sections/partitionAddStripRouter.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-37

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/partitionAddStripRouter.ts
   :language: typescript
   :lines: 1-37
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Names the file: it routes clicks for the partition freedraw add-strips. The litho partition overlay draws one transparent 14-pixel-wide hit-strip per body edge — a hit-strip is an invisible clickable band laid over a drawn line — and where thin stacked pinch lenses converge, several bodies' strips overlap at one click point.

**Why it is here.** The docstring records the history: when each strip fired its own click, the winner was decided purely by SVG paint order, so a click on the sand/silt interface silently grabbed a distant lens painted above it. The S70 fix picked the nearest segment; the S71 fix used region containment, which cured the distant steal but let a click anywhere inside a band grab that band's edge ('i can literally click in the middle of a band', owner dogfeed 2026-07-24). The owner's model is edge-only: only the visible line between two fills is grabbable, and an interior click is a no-op. The point-in-polygon test survives only for the ghost-barrier no-op.

.. CG-EXPLANATION-END id=module-header

``interface RouterPoint``
-------------------------

.. CG-BLOCK id=interface:RouterPoint lines=38-56

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/partitionAddStripRouter.ts
   :language: typescript
   :lines: 38-56
   :lineno-match:

.. CG-EXPLANATION-START id=interface:RouterPoint

**What this does.** Describes a point in SVG screen coordinates — an x and a y.

**Why it is here.** A small shared shape for a click or an endpoint.

.. CG-EXPLANATION-END id=interface:RouterPoint

``interface AddStripCandidate``
-------------------------------

.. CG-BLOCK id=interface:AddStripCandidate lines=57-77

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/partitionAddStripRouter.ts
   :language: typescript
   :lines: 57-77
   :lineno-match:

.. CG-EXPLANATION-START id=interface:AddStripCandidate

**What this does.** Describes one clickable add-strip — one or more screen segments it covers, an opaque payload naming which handler to invoke, and an optional screen ring of the body's partition region. A polygon here is a closed ring of points.

**Why it is here.** The docstring records the segments are a list so a multi-node lens or boundary edge that is a polyline can report the true minimum distance to any of its links; the region ring is retained on the type but unused for grab targeting since the router no longer grabs by containment.

.. CG-EXPLANATION-END id=interface:AddStripCandidate

``function pointInPolygon``
---------------------------

.. CG-BLOCK id=function:pointInPolygon lines=78-103

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/partitionAddStripRouter.ts
   :language: typescript
   :lines: 78-103
   :lineno-match:

.. CG-EXPLANATION-START id=function:pointInPolygon

**What this does.** An even-odd ray-casting test answering whether a point lies inside a polygon ring.

**Why it is here.** The docstring records a point exactly on an edge counts as inside for at least one incident region — good enough for click targeting — and that this survives only for the ghost-barrier no-op; the containment grab path is retired.

.. CG-EXPLANATION-END id=function:pointInPolygon

``function distSqToSegment``
----------------------------

.. CG-BLOCK id=function:distSqToSegment lines=104-122

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/partitionAddStripRouter.ts
   :language: typescript
   :lines: 104-122
   :lineno-match:

.. CG-EXPLANATION-START id=function:distSqToSegment

**What this does.** Returns the squared distance from a point to a line segment, clamped to the segment's ends.

**Why it is here.** The docstring records it is squared, not rooted, because it is only used for comparison, so the monotone square is enough and avoids a needless square root per candidate.

.. CG-EXPLANATION-END id=function:distSqToSegment

``function candidateDistSq``
----------------------------

.. CG-BLOCK id=function:candidateDistSq lines=123-145

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/partitionAddStripRouter.ts
   :language: typescript
   :lines: 123-145
   :lineno-match:

.. CG-EXPLANATION-START id=function:candidateDistSq

**What this does.** Returns the smallest squared distance from a click to any of a candidate's segments.

**Why it is here.** It gives a polyline edge's true nearest link, not just its overall endpoints.

.. CG-EXPLANATION-END id=function:candidateDistSq

``function edgePointAtX``
-------------------------

.. CG-BLOCK id=function:edgePointAtX lines=146-181

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/partitionAddStripRouter.ts
   :language: typescript
   :lines: 146-181
   :lineno-match:

.. CG-EXPLANATION-START id=function:edgePointAtX

**What this does.** Returns the point on a segment directly at the click's horizontal position — a vertical projection that keeps the user's chosen x and reads the edge's y there — or nothing when the segment does not span that x.

**Why it is here.** The docstring records the node must ride the boundary at the along-position the engineer aimed at; a vertical segment is treated as spanning only its own x, and its y is clamped into the segment's range so the node stays on the strip.

.. CG-EXPLANATION-END id=function:edgePointAtX

``function projectClickToCandidate``
------------------------------------

.. CG-BLOCK id=function:projectClickToCandidate lines=182-242

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/partitionAddStripRouter.ts
   :language: typescript
   :lines: 182-242
   :lineno-match:

.. CG-EXPLANATION-START id=function:projectClickToCandidate

**What this does.** Projects a click onto a candidate's boundary so a new node is stored ON the line at the user's chosen x, rather than floating in the region interior: it prefers the segment the click sits above or below and, among several, the one whose edge is nearest the click; if no segment spans the click's x it falls back to the nearest endpoint.

**Why it is here.** The docstring records the S72 fix (owner dogfeed 2026-07-22, 'i managed to get a point without grabbing a boundary'): storing the raw cursor position dropped the node in free space as floating dots, so the projection keeps the click's x and takes its elevation from the boundary at that x.

.. CG-EXPLANATION-END id=function:projectClickToCandidate

``function applyReachFloorOnSegment``
-------------------------------------

.. CG-BLOCK id=function:applyReachFloorOnSegment lines=243-290

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/partitionAddStripRouter.ts
   :language: typescript
   :lines: 243-290
   :lineno-match:

.. CG-EXPLANATION-START id=function:applyReachFloorOnSegment

**What this does.** Applies the visible-reach floor to an already-projected on-segment point without knocking it off the boundary: it clamps the along-x to the floor, then re-reads the segment's y at the clamped x, and handles the two edge cases — a near-vertical column-face segment (keep the elevation, move x into the gap) and a near-degenerate lens whose whole edge sits inside the floor band (snap to the interior tip).

**Why it is here.** The docstring records the S72 free-draw repair (Fact A): the reach floor keeps a lens's apex a minimum distance from its anchored source column so a click near the column face cannot pinch the lens to a hairline; the pre-repair code clamped the x but kept the projected y, which on a sloping edge put the stored node off the segment as a floating handle.

.. CG-EXPLANATION-END id=function:applyReachFloorOnSegment

``function routeNearestAddStrip``
---------------------------------

.. CG-BLOCK id=function:routeNearestAddStrip lines=291-339

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/partitionAddStripRouter.ts
   :language: typescript
   :lines: 291-339
   :lineno-match:

.. CG-EXPLANATION-START id=function:routeNearestAddStrip

**What this does.** Picks the add-strip candidate whose segment is nearest a click, regardless of SVG paint order, with ties going to the earlier candidate in the list.

**Why it is here.** The docstring records this is the global arbitration that fixes the stacked-lens mis-targeting — with every overlapping strip routed through one pick, the boundary the engineer visually aimed at wins.

.. CG-EXPLANATION-END id=function:routeNearestAddStrip

``function routeAddStripByEdgeProximity``
-----------------------------------------

.. CG-BLOCK id=function:routeAddStripByEdgeProximity lines=340-366

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/partitionAddStripRouter.ts
   :language: typescript
   :lines: 340-366
   :lineno-match:

.. CG-EXPLANATION-START id=function:routeAddStripByEdgeProximity

**What this does.** Picks the candidate whose edge the click lands ON, but only when that nearest edge is within the hit tolerance; a click in open band interior is a no-op, and a click inside a suppressed ghost region is a no-op even when a live edge grazes the tolerance.

**Why it is here.** The docstring records this as the edge-only invariant (owner dogfeed 2026-07-24): only the visible litho line between two fills is grabbable, replacing the S71 region-containment grab that let a click anywhere in a band interior grab that band's edge.

.. CG-EXPLANATION-END id=function:routeAddStripByEdgeProximity

``function nearestAddStripWithinTolerance``
-------------------------------------------

.. CG-BLOCK id=function:nearestAddStripWithinTolerance lines=367-389

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/partitionAddStripRouter.ts
   :language: typescript
   :lines: 367-389
   :lineno-match:

.. CG-EXPLANATION-START id=function:nearestAddStripWithinTolerance

**What this does.** Returns the add-strip candidate whose edge the click lands on within the hit tolerance, or nothing when the click is in open interior or inside a suppressed ghost region.

**Why it is here.** The docstring records it is shared by the grab and the hover preview, so keeping the nearest-edge-within-tolerance test in one place keeps the two in exact agreement — the preview dot shows exactly where a click would grab.

.. CG-EXPLANATION-END id=function:nearestAddStripWithinTolerance

