desktop.renderer.src.utils.partitionFillV2.types
================================================

.. CG-PAGE source=desktop/src/renderer/src/utils/partitionFillV2/types.ts complete=true

*Source file:* ``desktop/src/renderer/src/utils/partitionFillV2/types.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-20

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/types.ts
   :language: typescript
   :lines: 1-20
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** This module defines the geometry types for the planar-arrangement core — the closed-loop, face-tracing model at the heart of the v2 engine. A planar arrangement is what you get when a set of lines is laid down together and the plane is split into the tiled regions (faces) they bound. It also fixes the coordinate space: a point's x is along-section metres (the real spacing) and its y is elevation in metres TAW.

**Why it is here.** The docstring pins that this layer is PURE GEOMETRY — it snaps input polylines into an arrangement and traces its faces, with no soil logic (labelling, slicing, and the public wrapper come later, design §3). It stresses the x axis is real along-metres, never uniform column spacing, because uniform diverges (memory ``feedback_partitionfill_needs_alongm``); the per-gap fraction output space is a later slicing concern.

.. CG-EXPLANATION-END id=module-header

``interface Point``
-------------------

.. CG-BLOCK id=interface:Point lines=21-37

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/types.ts
   :language: typescript
   :lines: 21-37
   :lineno-match:

.. CG-EXPLANATION-START id=interface:Point

**What this does.** The shape of a point: x in along-section metres, y in elevation metres TAW.

**Why it is here.** It is the single coordinate the arrangement works in; the comments name the units so the two axes are never confused.

.. CG-EXPLANATION-END id=interface:Point

``type CurveKind``
------------------

.. CG-BLOCK id=type:CurveKind lines=38-45

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/types.ts
   :language: typescript
   :lines: 38-45
   :lineno-match:

.. CG-EXPLANATION-START id=type:CurveKind

**What this does.** A type naming the four kinds of input curve: a column-vertical (a footprint edge), a contact (a unit top or base along its column), a tie (a correlation edge across a gap), or a closing (a synthesized pinch, apex, or substrate bridge).

**Why it is here.** The four kinds mirror design §2; the kind is carried opaquely through the arrangement so a later step can label faces from the curve ids that bound them.

.. CG-EXPLANATION-END id=type:CurveKind

``interface InputCurve``
------------------------

.. CG-BLOCK id=interface:InputCurve lines=46-70

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/types.ts
   :language: typescript
   :lines: 46-70
   :lineno-match:

.. CG-EXPLANATION-START id=interface:InputCurve

**What this does.** The shape of one input curve: a stable id, its kind, and its ordered polyline points (at least two).

**Why it is here.** The id is used for deterministic ordering and for face-boundary provenance (which curve gave which edge); a closing curve may repeat its first point, but closure emerges from the trace rather than being required.

.. CG-EXPLANATION-END id=interface:InputCurve

``interface Face``
------------------

.. CG-BLOCK id=interface:Face lines=71-90

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/types.ts
   :language: typescript
   :lines: 71-90
   :lineno-match:

.. CG-EXPLANATION-START id=interface:Face

**What this does.** The shape of one traced face: its counter-clockwise outer ring, the ids of the curves bounding it, any inner hole rings it encloses, and its signed area.

**Why it is here.** The docstring records the hole representation as a documented choice: the arrangement traces EVERY bounded face, so a nested loop appears both as its own standalone face AND as a hole in the annulus around it. This keeps every face a simple partition cell while still exposing containment, which the slicer needs to cut a lens out of its matrix.

.. CG-EXPLANATION-END id=interface:Face

``interface Arrangement``
-------------------------

.. CG-BLOCK id=interface:Arrangement lines=91-107

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/types.ts
   :language: typescript
   :lines: 91-107
   :lineno-match:

.. CG-EXPLANATION-START id=interface:Arrangement

**What this does.** The shape of the whole arrangement: the traced faces, the snapped deduplicated vertices, and the half-edge records.

**Why it is here.** The half-edges are exposed for the later steps (slicing at column verticals, face adjacency for nested-body render); a consumer of the faces alone can ignore them.

.. CG-EXPLANATION-END id=interface:Arrangement

``interface HalfEdge``
----------------------

.. CG-BLOCK id=interface:HalfEdge lines=108-129

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/types.ts
   :language: typescript
   :lines: 108-129
   :lineno-match:

.. CG-EXPLANATION-START id=interface:HalfEdge

**What this does.** The shape of one directed half-edge of the edge structure: its origin and target vertex indices, its twin (the same segment the other way), its next edge around the face on its left, and the curve ids that contributed the segment. Every undirected segment is two twin half-edges pointing opposite ways.

**Why it is here.** This is the standard doubly-connected edge-list record the arrangement is walked on; the ``next`` links are what let the tracer walk a face's boundary, and the curve ids carry the per-segment provenance the seed classifier recovers.

.. CG-EXPLANATION-END id=interface:HalfEdge

``const SNAP_GRID_M``
---------------------

.. CG-BLOCK id=const:SNAP_GRID_M lines=130-130

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/types.ts
   :language: typescript
   :lines: 130-130
   :lineno-match:

.. CG-EXPLANATION-START id=const:SNAP_GRID_M

**What this does.** The 1 mm snap grid, applied on both axes at the arrangement level.

**Why it is here.** One snapping pass to this grid before tracing, then all walking is exact on the snapped integer graph so no epsilon cascades downstream. The comment warns this is a DIFFERENT grid from the design's 1e-6 fraction grid, which applies later at output slicing, not here.

.. CG-EXPLANATION-END id=const:SNAP_GRID_M

