desktop.renderer.src.utils.partitionFillV2.slice
================================================

.. CG-PAGE source=desktop/src/renderer/src/utils/partitionFillV2/slice.ts complete=true

*Source file:* ``desktop/src/renderer/src/utils/partitionFillV2/slice.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-25

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/slice.ts
   :language: typescript
   :lines: 1-25
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** This module cuts the labelled arrangement faces at the column verticals and emits the per-gap fill regions the engine's output contract promises. A single face can span several gaps (a band tied across many columns), so each face is clipped to every column strip it overlaps, each non-empty clip becoming one region whose polygon is in that gap's fraction-by-elevation space and whose kind follows the face class (band becomes a quad, onlap becomes a pinch, lens becomes a lens).

**Why it is here.** The output contract (design §3 output step and §5) is per-gap fraction-by-elevation regions, and consumers downstream — geotech refinement, the voxel builder, DXF export — assume simple polygons, so the slicing, snapping, and simplicity work all lives here. Pure module.

.. CG-EXPLANATION-END id=module-header

``const FRACTION_SNAP``
-----------------------

.. CG-BLOCK id=const:FRACTION_SNAP lines=26-28

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/slice.ts
   :language: typescript
   :lines: 26-28
   :lineno-match:

.. CG-EXPLANATION-START id=const:FRACTION_SNAP

**What this does.** The output fraction snap grid, 1e-6.

**Why it is here.** Design §3's numerical-robustness rule for the output fraction axis.

.. CG-EXPLANATION-END id=const:FRACTION_SNAP

``const ELEV_SNAP_M``
---------------------

.. CG-BLOCK id=const:ELEV_SNAP_M lines=29-30

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/slice.ts
   :language: typescript
   :lines: 29-30
   :lineno-match:

.. CG-EXPLANATION-START id=const:ELEV_SNAP_M

**What this does.** The 1 mm elevation snap grid.

**Why it is here.** It is the same 1 mm grid the arrangement uses; snapping clip-interpolation float noise collapses a shared contact to one canonical vertex so the ring stays simple.

.. CG-EXPLANATION-END id=const:ELEV_SNAP_M

``const MIN_SLICE_AREA``
------------------------

.. CG-BLOCK id=const:MIN_SLICE_AREA lines=31-33

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/slice.ts
   :language: typescript
   :lines: 31-33
   :lineno-match:

.. CG-EXPLANATION-START id=const:MIN_SLICE_AREA

**What this does.** The minimum area below which a sliced region is dropped.

**Why it is here.** A near-zero-area sliver is float noise, not a real region, and would only clutter the output.

.. CG-EXPLANATION-END id=const:MIN_SLICE_AREA

``const MIN_FRACTION_WIDTH``
----------------------------

.. CG-BLOCK id=const:MIN_FRACTION_WIDTH lines=34-50

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/slice.ts
   :language: typescript
   :lines: 34-50
   :lineno-match:

.. CG-EXPLANATION-START id=const:MIN_FRACTION_WIDTH

**What this does.** The minimum fraction width a sliced region must span.

**Why it is here.** A region whose whole width is sub-pixel and pinned against a column vertical is a float-noise slice near fraction 1.0 (the B6 gap2 slivers, design §4 increment-16); a real region spans a meaningful width.

.. CG-EXPLANATION-END id=const:MIN_FRACTION_WIDTH

``function sliceFaces``
-----------------------

.. CG-BLOCK id=function:sliceFaces lines=51-166

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/slice.ts
   :language: typescript
   :lines: 51-166
   :lineno-match:

.. CG-EXPLANATION-START id=function:sliceFaces

**What this does.** The slicer. For each labelled face it maps the class to a kind, then for each gap strip it clips the face's outer ring to the strip; for a holed face (a matrix annulus around lens faces) it also clips each hole and splits the annulus into simple pieces so the matrix never overpaints a lens. It converts each clipped ring to fraction-by-elevation space, splits any self-crossing or self-touching ring into strictly simple sub-rings, drops sub-area and sub-width slivers, and emits a region carrying the face's soil, body, kind, gap, and (when present) its fallback flag and producing layer ids. Finally it sorts the output deterministically.

**Why it is here.** The docstring pins the tricky parts: the annulus split replaces the keyhole removed in increment 6 (its self-touching slit broke the area and containment checks); the strip-clip-FIRST handles a lens straddling a column vertical (ruling-8e Milestone-2), turning each gap's hole into a clean triangle so the box split covers it exactly; and the two simplicity passes are needed because a face simple in metres can slice to a weakly-simple or genuinely self-crossing ring (the CS2 gap15 figure-8), which downstream consumers cannot accept.

.. CG-EXPLANATION-END id=function:sliceFaces

``function toFractionSpace``
----------------------------

.. CG-BLOCK id=function:toFractionSpace lines=167-216

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/slice.ts
   :language: typescript
   :lines: 167-216
   :lineno-match:

.. CG-EXPLANATION-START id=function:toFractionSpace

**What this does.** Maps a strip-clipped metres polygon into that gap's fraction-by-elevation space, snapping the fraction to the 1e-6 grid and the elevation to the 1 mm grid, and dropping consecutive and closing duplicate points.

**Why it is here.** The strip clip interpolates crossing points as float noise, which would leave two near-identical vertices on a shared contact and make the ring weakly non-simple; snapping both axes collapses each to one canonical vertex, and dropping duplicates keeps the ring simple.

.. CG-EXPLANATION-END id=function:toFractionSpace

``function splitAtRepeatedPoints``
----------------------------------

.. CG-BLOCK id=function:splitAtRepeatedPoints lines=217-233

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/slice.ts
   :language: typescript
   :lines: 217-233
   :lineno-match:

.. CG-EXPLANATION-START id=function:splitAtRepeatedPoints

**What this does.** Splits a fraction-space ring that touches itself at a repeated vertex into simple sub-rings, recursing until none repeat.

**Why it is here.** It is the fraction-space twin of the metres-space repeat splitter: a face simple in metres can slice to a weakly simple ring when two distinct metres vertices collapse onto one fraction (both on a column vertical) or a lobe pinches to a seam apex on the strip edge.

.. CG-EXPLANATION-END id=function:splitAtRepeatedPoints

``function snapFraction``
-------------------------

.. CG-BLOCK id=function:snapFraction lines=234-239

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/slice.ts
   :language: typescript
   :lines: 234-239
   :lineno-match:

.. CG-EXPLANATION-START id=function:snapFraction

**What this does.** Rounds a fraction to the 1e-6 grid and clamps it into 0 to 1.

**Why it is here.** Keeps every output vertex on the contract's fraction grid and inside a valid gap.

.. CG-EXPLANATION-END id=function:snapFraction

``function polygonAbsArea``
---------------------------

.. CG-BLOCK id=function:polygonAbsArea lines=240-248

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/slice.ts
   :language: typescript
   :lines: 240-248
   :lineno-match:

.. CG-EXPLANATION-START id=function:polygonAbsArea

**What this does.** Returns the absolute area of a fraction-by-elevation ring via the shoelace formula.

**Why it is here.** It is the measure the min-area sliver drop compares against.

.. CG-EXPLANATION-END id=function:polygonAbsArea

