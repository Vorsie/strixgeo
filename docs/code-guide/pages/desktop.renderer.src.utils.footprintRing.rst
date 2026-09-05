desktop.renderer.src.utils.footprintRing
========================================

.. CG-PAGE source=desktop/src/renderer/src/utils/footprintRing.ts complete=true

*Source file:* ``desktop/src/renderer/src/utils/footprintRing.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-28

.. literalinclude:: ../../../desktop/src/renderer/src/utils/footprintRing.ts
   :language: typescript
   :lines: 1-28
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** A comment describing the model footprint ring — the closed boundary that says "the model ends here" — and what this module does and does not do.

**Why it is here.** The comment records that the ring exists because the 3-D viewer paints only where the build put material, so an alpha-hull trim would otherwise show as a ragged hole indistinguishable from a genuine gap; that truthfulness is the whole point, so the polygon is NOT derived here — it comes from the backend, which replays the persisted build through the same hull the build used, because a hull re-derived in the front end would be a second source of truth that could draw a boundary the geometry does not have; and that the coordinates are projected project-CRS metres (EPSG 31370 or 28992), with the conversion to latitude/longitude happening at render time elsewhere.

.. CG-EXPLANATION-END id=module-header

``const FOOTPRINT_RING_LIFT_M``
-------------------------------

.. CG-BLOCK id=const:FOOTPRINT_RING_LIFT_M lines=29-56

.. literalinclude:: ../../../desktop/src/renderer/src/utils/footprintRing.ts
   :language: typescript
   :lines: 29-56
   :lineno-match:

.. CG-EXPLANATION-START id=const:FOOTPRINT_RING_LIFT_M

**What this does.** The vertical clearance between the ring and the top of the model: one metre.

**Why it is here.** The docstring records that the ring is a line primitive, so sitting it exactly on the surface makes it flicker and stipple as the camera moves; one metre reads as "on the ground" at every camera distance while staying clear of that depth-buffer noise.

.. CG-EXPLANATION-END id=const:FOOTPRINT_RING_LIFT_M

``function footprintRingPositions``
-----------------------------------

.. CG-BLOCK id=function:footprintRingPositions lines=57-101

.. literalinclude:: ../../../desktop/src/renderer/src/utils/footprintRing.ts
   :language: typescript
   :lines: 57-101
   :lineno-match:

.. CG-EXPLANATION-START id=function:footprintRingPositions

**What this does.** Turns a footprint polygon into a closed ring of 3-D points: it strips any repeated closing vertex, returns nothing if fewer than three distinct vertices remain, otherwise places every vertex at the given elevation and repeats the first at the end to close the loop.

**Why it is here.** The docstring records that the polygon is passed through verbatim — same vertices and winding, no simplification — because it is the exact boundary the build clipped to, and that an under-three-vertex polygon returns empty (draw nothing) because a two-point ring would render as a stray segment reading as an artefact rather than a boundary.

.. CG-EXPLANATION-END id=function:footprintRingPositions

``function resolveFootprintRingElevation``
------------------------------------------

.. CG-BLOCK id=function:resolveFootprintRingElevation lines=102-115

.. literalinclude:: ../../../desktop/src/renderer/src/utils/footprintRing.ts
   :language: typescript
   :lines: 102-115
   :lineno-match:

.. CG-EXPLANATION-START id=function:resolveFootprintRingElevation

**What this does.** Chooses the single elevation to draw the ring at: the top of the DEM ground surface when present, otherwise the top of the body solids, each lifted by the clearance; and nothing when neither is rendered.

**Why it is here.** The docstring records that the ring is deliberately flat rather than draped, because a flat closed loop reads unambiguously as an extent boundary and draping would need trustworthy elevation samples exactly where the hull sits outside the data (least trustworthy); and that it returns nothing rather than zero because a model sitting well below sea level would otherwise get a ring floating in empty space that reads as a second, wrong model edge. The inputs are streamed so a caller need not flatten tens of thousands of vertices on every render.

.. CG-EXPLANATION-END id=function:resolveFootprintRingElevation

``function stripClosingVertex``
-------------------------------

.. CG-BLOCK id=function:stripClosingVertex lines=116-125

.. literalinclude:: ../../../desktop/src/renderer/src/utils/footprintRing.ts
   :language: typescript
   :lines: 116-125
   :lineno-match:

.. CG-EXPLANATION-START id=function:stripClosingVertex

**What this does.** Drops a trailing vertex that merely repeats the first one, leaving the polygon unchanged otherwise.

**Why it is here.** The backend returns the ring without a repeated last vertex, but one that repeats it anyway is accepted and not doubled — so the closure step can add exactly one closing vertex either way.

.. CG-EXPLANATION-END id=function:stripClosingVertex

``function maxFiniteElevation``
-------------------------------

.. CG-BLOCK id=function:maxFiniteElevation lines=126-136

.. literalinclude:: ../../../desktop/src/renderer/src/utils/footprintRing.ts
   :language: typescript
   :lines: 126-136
   :lineno-match:

.. CG-EXPLANATION-START id=function:maxFiniteElevation

**What this does.** Returns the highest finite height across a set of vertices, or nothing when there is none, skipping any non-finite value.

**Why it is here.** The comment records that a degenerate mesh can carry a not-a-number vertex, and a naive maximum would propagate it and silently take the ring out of the scene — so non-finite heights are skipped.

.. CG-EXPLANATION-END id=function:maxFiniteElevation

