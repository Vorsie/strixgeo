desktop.renderer.src.utils.tinConfidence
========================================

.. CG-PAGE source=desktop/src/renderer/src/utils/tinConfidence.ts complete=true

*Source file:* ``desktop/src/renderer/src/utils/tinConfidence.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-30

.. literalinclude:: ../../../desktop/src/renderer/src/utils/tinConfidence.ts
   :language: typescript
   :lines: 1-30
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Computes a per-triangle interpolation confidence, from 0 to 1, for a TIN surface (a surface built from triangles). The comment describes the two ingredients: hull-edge triangles — any triangle with an edge that belongs to only one triangle is on the outer boundary and fans out into data-sparse periphery, so it gets a fixed-confidence floor — and an edge-length gradient, where an interior triangle's confidence falls with its longest edge measured against the median edge length across the whole surface (median → 1.0, twice the median → 0.5, clamped at the floor). It then documents the floor constant below.

**Why it is here.** The comment records that this is a cheap interim shape: the geological model uses plain Delaunay triangulation today, so ground far from any contact looks identical to data-backed ground even though the surface is pure extrapolation there. The confidence drives a fade in the 3-D viewer and the section editor's TIN slice; both signals derive purely from the vertices and triangles, so there is no schema change, and the whole helper is retired when a variance-based interpolator lands in Phase 5.

.. CG-EXPLANATION-END id=module-header

``const CONFIDENCE_FLOOR``
--------------------------

.. CG-BLOCK id=const:CONFIDENCE_FLOOR lines=31-37

.. literalinclude:: ../../../desktop/src/renderer/src/utils/tinConfidence.ts
   :language: typescript
   :lines: 31-37
   :lineno-match:

.. CG-EXPLANATION-START id=const:CONFIDENCE_FLOOR

**What this does.** The floor confidence, 0.3, used for hull-edge triangles and as the gradient's lower bound. It is followed by the threshold docstring.

**Why it is here.** The docstring records that it was picked so the visual difference is clear at 0.3× rendered opacity while the band stays readable as the same formation.

.. CG-EXPLANATION-END id=const:CONFIDENCE_FLOOR

``const CONFIDENCE_THRESHOLD``
------------------------------

.. CG-BLOCK id=const:CONFIDENCE_THRESHOLD lines=38-46

.. literalinclude:: ../../../desktop/src/renderer/src/utils/tinConfidence.ts
   :language: typescript
   :lines: 38-46
   :lineno-match:

.. CG-EXPLANATION-START id=const:CONFIDENCE_THRESHOLD

**What this does.** The threshold, 0.7, separating a "data-backed" band from an "extrapolation" band: at or above it a triangle renders at full opacity, below it at the low multiplier. It is followed by the multiplier docstring.

**Why it is here.** The docstring records that this is the cut between "trust this" and "this is extrapolation".

.. CG-EXPLANATION-END id=const:CONFIDENCE_THRESHOLD

``const LOW_CONFIDENCE_ALPHA_MULTIPLIER``
-----------------------------------------

.. CG-BLOCK id=const:LOW_CONFIDENCE_ALPHA_MULTIPLIER lines=47-48

.. literalinclude:: ../../../desktop/src/renderer/src/utils/tinConfidence.ts
   :language: typescript
   :lines: 47-48
   :lineno-match:

.. CG-EXPLANATION-START id=const:LOW_CONFIDENCE_ALPHA_MULTIPLIER

**What this does.** The opacity multiplier, 0.25, applied to low-confidence triangles in both the 3-D viewer and the section editor.

**Why it is here.** The docstring records that the same value is used on both surfaces for visual parity, and that hull-edge and interior-low-density triangles deliberately land at the same band so the engineer reads the cue as "less to trust here", not as a two-way classification.

.. CG-EXPLANATION-END id=const:LOW_CONFIDENCE_ALPHA_MULTIPLIER

``function _median``
--------------------

.. CG-BLOCK id=function:_median lines=49-57

.. literalinclude:: ../../../desktop/src/renderer/src/utils/tinConfidence.ts
   :language: typescript
   :lines: 49-57
   :lineno-match:

.. CG-EXPLANATION-START id=function:_median

**What this does.** A private helper that returns the median of a list of numbers (0 for an empty list), sorting a copy and averaging the two middle values when the count is even.

**Why it is here.** The median edge length is the reference the gradient normalises against; sorting a copy avoids disturbing the caller's array.

.. CG-EXPLANATION-END id=function:_median

``function _edgeKey``
---------------------

.. CG-BLOCK id=function:_edgeKey lines=58-63

.. literalinclude:: ../../../desktop/src/renderer/src/utils/tinConfidence.ts
   :language: typescript
   :lines: 58-63
   :lineno-match:

.. CG-EXPLANATION-START id=function:_edgeKey

**What this does.** Builds a canonical key for an undirected edge — the two vertex indices written smallest-first.

**Why it is here.** The comment records the reason: so an edge listed as (a, b) in one triangle and (b, a) in its neighbour hash to the same bucket for the hull-edge counter.

.. CG-EXPLANATION-END id=function:_edgeKey

``function _edgeLengthXY``
--------------------------

.. CG-BLOCK id=function:_edgeLengthXY lines=64-95

.. literalinclude:: ../../../desktop/src/renderer/src/utils/tinConfidence.ts
   :language: typescript
   :lines: 64-95
   :lineno-match:

.. CG-EXPLANATION-START id=function:_edgeLengthXY

**What this does.** Returns the horizontal-plane distance between two vertices, using their x and y only. It then documents the main confidence function below.

**Why it is here.** The comment records why the height is ignored: the surface's "spread" is its horizontal footprint, while the elevation difference is the signal being rendered, not the data-sparsity measure — otherwise two vertices stacked vertically would look like a wide gap.

.. CG-EXPLANATION-END id=function:_edgeLengthXY

``function computeTriangleConfidence``
--------------------------------------

.. CG-BLOCK id=function:computeTriangleConfidence lines=96-207

.. literalinclude:: ../../../desktop/src/renderer/src/utils/tinConfidence.ts
   :language: typescript
   :lines: 96-207
   :lineno-match:

.. CG-EXPLANATION-START id=function:computeTriangleConfidence

**What this does.** The main computation. Empty input gives empty output. Step 1 counts how many triangles each edge appears in (an edge in just one triangle is a hull edge). It then checks whether any interior triangle exists (all three edges shared); if none does, everything renders at full confidence. Step 2 collects each unique edge's length for the median. Step 3, per triangle: if any edge is a hull edge the triangle gets the floor, otherwise its confidence falls linearly with its longest-edge-to-median ratio, clamped between the floor and 1. It then documents the alpha-multiplier function below.

**Why it is here.** The comments record each decision: the escape hatch renders everything at full confidence when there is no interior triangle, so a freshly-built three-contact surface does not look perpetually faded until a fourth contact lands; iterating the unique-edge set avoids double-counting a shared interior edge in the median; and the gradient is calibrated so the median edge is 1.0, twice the median is 0.5, and anything longer clamps to the floor.

.. CG-EXPLANATION-END id=function:computeTriangleConfidence

``function confidenceToAlphaMultiplier``
----------------------------------------

.. CG-BLOCK id=function:confidenceToAlphaMultiplier lines=208-243

.. literalinclude:: ../../../desktop/src/renderer/src/utils/tinConfidence.ts
   :language: typescript
   :lines: 208-243
   :lineno-match:

.. CG-EXPLANATION-START id=function:confidenceToAlphaMultiplier

**What this does.** Maps a triangle's confidence to its render opacity multiplier — a straight blend from the low multiplier at the floor up to 1.0 at full confidence, with out-of-range inputs clamped. It then documents the per-vertex function below.

**Why it is here.** The docstring records that the per-vertex gradient renderers use it to compute a smooth opacity that tracks the distance-to-data signal; the caller multiplies its base (fresh or stale) opacity by this result.

.. CG-EXPLANATION-END id=function:confidenceToAlphaMultiplier

``function computeVertexConfidence``
------------------------------------

.. CG-BLOCK id=function:computeVertexConfidence lines=244-271

.. literalinclude:: ../../../desktop/src/renderer/src/utils/tinConfidence.ts
   :language: typescript
   :lines: 244-271
   :lineno-match:

.. CG-EXPLANATION-START id=function:computeVertexConfidence

**What this does.** Computes a per-vertex confidence by averaging the confidence of every triangle that touches each vertex. Empty vertices give empty output. It reuses a supplied per-triangle confidence or computes one, adds each triangle's confidence into its three vertices, and divides by the count; a vertex with no triangles gets 1.0.

**Why it is here.** The docstring records the effect: hull vertices touch more low-confidence triangles and average down, deep vertices average up, giving a smooth per-vertex opacity the GPU can interpolate across each triangle; an orphan vertex gets 1.0 as a safe default because it does not render anyway. Accepting a pre-computed per-triangle confidence lets the caller skip recomputing that pass when it already has it.

.. CG-EXPLANATION-END id=function:computeVertexConfidence

