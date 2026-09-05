desktop.renderer.src.utils.sliceTin
===================================

.. CG-PAGE source=desktop/src/renderer/src/utils/sliceTin.ts complete=true

*Source file:* ``desktop/src/renderer/src/utils/sliceTin.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-25

.. literalinclude:: ../../../desktop/src/renderer/src/utils/sliceTin.ts
   :language: typescript
   :lines: 1-25
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Cuts a TIN surface with a section line, in the browser. A *TIN* is a surface built from triangles (a triangulated surface). The comment gives the algorithm: project each triangle vertex onto the section line (getting an along-distance and a signed sideways offset), find which triangle edges cross the line (an offset sign change), interpolate the along-distance and elevation of each crossing point, and sort the crossings by along-distance to form the cut polyline. It imports the surface-response type.

**Why it is here.** The comment records why this lives in the renderer rather than the backend: it mirrors the Python ``slice_tin`` one-to-one, but the section editor needs sub-millisecond slicing on every render frame, and a backend round-trip per pan or zoom would kill interactivity. It also notes the payoff: an off-line pick still contributes through its triangle's intersection with the line — something the older "connect the projected picks" render could not deliver.

.. CG-EXPLANATION-END id=module-header

``interface SectionLine2D``
---------------------------

.. CG-BLOCK id=interface:SectionLine2D lines=26-33

.. literalinclude:: ../../../desktop/src/renderer/src/utils/sliceTin.ts
   :language: typescript
   :lines: 26-33
   :lineno-match:

.. CG-EXPLANATION-START id=interface:SectionLine2D

**What this does.** The section's two endpoints in the project's horizontal CRS, followed by the docstring for a slice point below.

**Why it is here.** The slice maths works in the project's projected metric CRS, so the endpoints are supplied in that system.

.. CG-EXPLANATION-END id=interface:SectionLine2D

``interface SlicePoint``
------------------------

.. CG-BLOCK id=interface:SlicePoint lines=34-59

.. literalinclude:: ../../../desktop/src/renderer/src/utils/sliceTin.ts
   :language: typescript
   :lines: 34-59
   :lineno-match:

.. CG-EXPLANATION-START id=interface:SlicePoint

**What this does.** One point on the cut polyline — its along-distance, its elevation, and an optional triangle index — followed by the docstring for the slice function.

**Why it is here.** The comment records why the triangle index is carried (debt #28): two consecutive points in the sorted polyline are the entry and exit crossings of the same triangle, so its index identifies which segment they bound and lets a per-segment confidence value be read; it is optional so callers that do not need that band split stay backwards-compatible.

.. CG-EXPLANATION-END id=interface:SlicePoint

``function sliceTin``
---------------------

.. CG-BLOCK id=function:sliceTin lines=60-129

.. literalinclude:: ../../../desktop/src/renderer/src/utils/sliceTin.ts
   :language: typescript
   :lines: 60-129
   :lineno-match:

.. CG-EXPLANATION-START id=function:sliceTin

**What this does.** Cuts the TIN with a vertical plane along the line and returns the polyline. It returns an empty list for a surface with no triangles or a zero-length line. Otherwise it builds the line's unit direction and its left-perpendicular, projects every vertex to an along-distance, a sideways offset and an elevation, then for each triangle checks its three edges: an edge with both ends on the line is skipped, an edge with both ends on the same side is skipped, an end exactly on the line is recorded as a crossing, and a genuine side-to-side crossing is found by linearly interpolating the along-distance and elevation; finally it sorts every crossing by along-distance.

**Why it is here.** The docstring records that the polyline is returned sorted by along-distance, which is load-bearing for the SVG path drawn downstream, and that the empty results are defensive: a surface below the geological minimum of three non-collinear contacts has no triangles, and a zero-length section line guards against a UI bug.

.. CG-EXPLANATION-END id=function:sliceTin

