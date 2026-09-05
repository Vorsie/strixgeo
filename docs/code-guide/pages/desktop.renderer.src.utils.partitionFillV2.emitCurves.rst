desktop.renderer.src.utils.partitionFillV2.emitCurves
=====================================================

.. CG-PAGE source=desktop/src/renderer/src/utils/partitionFillV2/emitCurves.ts complete=true

*Source file:* ``desktop/src/renderer/src/utils/partitionFillV2/emitCurves.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-62

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/emitCurves.ts
   :language: typescript
   :lines: 1-62
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** This file is curve emission -- it turns the litho columns and approved correlations into the four families of input curves the planar arrangement traces: column verticals (each investigation's footprint edge), contact segments (each unit's top and base along its column), ties (an approved correlation spanning a gap), and closing curves (the synthesized vacancy-closure geometry that tiles the space past a pinch or lens apex).

**Why it is here.** The docstring lays out the pipeline order and the load-bearing choices: real along-metres (uniform spacing diverges), a contact segment is the column vertical split at each contact so ties attach to real vertices, crossing approved ties are a hard conflict dropped from emission (owner section 8 question 4), and deep-to-deep bridges run before the closings so a bridge-anchored deep unit skips its interval tiling. Pure module.

.. CG-EXPLANATION-END id=module-header

``interface ResolvedTie``
-------------------------

.. CG-BLOCK id=interface:ResolvedTie lines=63-100

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/emitCurves.ts
   :language: typescript
   :lines: 63-100
   :lineno-match:

.. CG-EXPLANATION-START id=interface:ResolvedTie

**What this does.** A type for a tie resolved to concrete geometry across one gap: the two facing endpoints, each one's contact side and unit index, the curve id, and optionally the bent polyline the tie became when a free-draw override bent it.

**Why it is here.** The docstring explains ``bentPoints`` is undefined on the no-override path so an onlap lapping the tie reads the straight endpoints byte-identically, and when present an onlap re-derives its apex elevation along the bent line (session 109 -- the onlap rides the bent contact).

.. CG-EXPLANATION-END id=interface:ResolvedTie

``type TieConflict``
--------------------

.. CG-BLOCK id=type:TieConflict lines=101-103

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/emitCurves.ts
   :language: typescript
   :lines: 101-103
   :lineno-match:

.. CG-EXPLANATION-START id=type:TieConflict

**What this does.** The crossing-tie conflict type, re-exported from ``crossingConflicts``.

**Why it is here.** The docstring notes the canonical shape now carries the suspended edges' order-invariant keys in addition to the historical gap index and tie ids (backward compatible).

.. CG-EXPLANATION-END id=type:TieConflict

``interface EmittedCurves``
---------------------------

.. CG-BLOCK id=interface:EmittedCurves lines=104-143

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/emitCurves.ts
   :language: typescript
   :lines: 104-143
   :lineno-match:

.. CG-EXPLANATION-START id=interface:EmittedCurves

**What this does.** A type for the result of emission: the curves for the arrangement, the detected conflicts, the surviving active ties, the lens-label map (which curve id carries which soil for its traced face), the bracketed jump-tie strips, and the directional bridge-anchor set.

**Why it is here.** The docstring explains why each rides along -- the lens labels because an enclosed-lens face is bounded by the matrix column vertical too, so its label must come from the lens's own soil; the bracket strips because a face between two bracketing jump ties is a band; and the bridge-anchor set so the conformance gate reproduces the engine's bridge-fed arithmetic from the same source (no drift).

.. CG-EXPLANATION-END id=interface:EmittedCurves

``function emitCurves``
-----------------------

.. CG-BLOCK id=function:emitCurves lines=144-395

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/emitCurves.ts
   :language: typescript
   :lines: 144-395
   :lineno-match:

.. CG-EXPLANATION-START id=function:emitCurves

**What this does.** The public routine: it emits the column verticals and the top-band surface curves, runs the single crossing-conflict pass and drops suspended edges, resolves the surviving ties (bending any a free-draw override targets), emits the deep-to-deep bridges, then -- with the two-sided flag on -- runs the unconditional termination sweep (every lens and onlap first), the enclosing flood (fill behind them), the enclosed-lens curves, the flat-floor substrate and the sub-TD hugging lenses; with the flag off it runs the older seam-based tiler instead. It returns all the curves plus the conflicts, ties, labels and anchor sets.

**Why it is here.** The docstring and comments carry the whole paint-bucket order (owner: given line art, then generated ties, then fill), the safe-reach detour collection (ruling 8s stage B -- corr-0 diamonds gathered so the flood detours around them), the deletion of the asymmetric ruled-band pass (finding F1 -- it invented band contours from formation overlap and drew a band diagonally across a real band), and the free-draw contact bends (design section 8 -- a bent shared contour re-traces both faces). It emphasises the flag-off path stays byte-identical to the frozen seam baseline.

.. CG-EXPLANATION-END id=function:emitCurves

``function emitColumnVerticals``
--------------------------------

.. CG-BLOCK id=function:emitColumnVerticals lines=396-457

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/emitCurves.ts
   :language: typescript
   :lines: 396-457
   :lineno-match:

.. CG-EXPLANATION-START id=function:emitColumnVerticals

**What this does.** Emits one column-vertical curve per unit face on every column (the column line from the unit's top to its base), splitting the vertical at every contact so the arrangement has a vertex there. With the two-sided flag on, it splits a merged host's vertical so the lens sub-segment carries a ``col:lens`` id (the lens's own soil seed) while the host pieces above and below keep the host id.

**Why it is here.** The docstring carries ruling 5-revised (the first unit's vertical returns to its own drilled top, not the ground surface -- that quad is made up, so the strip above stays empty) and ruling 8r / the id-split fix: when the enclosed-lens merge made an interbed an interior hole, one host curve over the whole span made the lens face read the matrix soil, so the lens interval is emitted with its own seed id -- an identity split, not a geometry split, so the traced faces are byte-identical.

.. CG-EXPLANATION-END id=function:emitColumnVerticals

``const LENS_CUT_EPS``
----------------------

.. CG-BLOCK id=const:LENS_CUT_EPS lines=458-464

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/emitCurves.ts
   :language: typescript
   :lines: 458-464
   :lineno-match:

.. CG-EXPLANATION-START id=const:LENS_CUT_EPS

**What this does.** A 1 mm tolerance for the enclosed-lens interval split.

**Why it is here.** Below it a piece is a vertex touch, not a real sub-segment.

.. CG-EXPLANATION-END id=const:LENS_CUT_EPS

``const CONTOUR_MATCH_EPS``
---------------------------

.. CG-BLOCK id=const:CONTOUR_MATCH_EPS lines=465-476

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/emitCurves.ts
   :language: typescript
   :lines: 465-476
   :lineno-match:

.. CG-EXPLANATION-START id=const:CONTOUR_MATCH_EPS

**What this does.** A 1 mm elevation-match tolerance for pairing a heterogeneous bend to the matrix-top tie it attaches its clay-base ride line to.

**Why it is here.** The tie's own curve is left unbent; only its ride-points (read solely by the riding onlap) take the clay-base line, matched within this tolerance.

.. CG-EXPLANATION-END id=const:CONTOUR_MATCH_EPS

``function emitSurfaceCurves``
------------------------------

.. CG-BLOCK id=function:emitSurfaceCurves lines=477-507

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/emitCurves.ts
   :language: typescript
   :lines: 477-507
   :lineno-match:

.. CG-EXPLANATION-START id=function:emitSurfaceCurves

**What this does.** Emits the top-band curve spanning each gap -- from the left column's first-litho top to the right column's. This band-authority top polyline rides each column's FIRST litho boundary, not the ground surface.

**Why it is here.** The docstring is ruling 5-revised: the strip between this line and the ground stays empty (no invented soil above the first data point), while the line still encloses the top of every gap so a unit pinching out near it leaves a closed vacancy face rather than an open untraced region. The floor is deliberately not emitted -- the sub-TD void stays open until the deep-to-deep substrate bridges it.

.. CG-EXPLANATION-END id=function:emitSurfaceCurves

``function resolveJumpTies``
----------------------------

.. CG-BLOCK id=function:resolveJumpTies lines=508-587

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/emitCurves.ts
   :language: typescript
   :lines: 508-587
   :lineno-match:

.. CG-EXPLANATION-START id=function:resolveJumpTies

**What this does.** Resolves every JUMP tie (a correlation spanning two or more columns) into resolved-tie provenance records -- one per anchored end, keyed to the gap and side the bridge spans toward -- so a sub-TD or bridge onlap can follow the real bridge line.

**Why it is here.** The docstring explains this is distinct from ``resolveTies`` (which emits only adjacent tie curves); it produces the termination plan's provenance so a corr-1 sub-TD plan carries a real resolved tie rather than a null reference (finding F5 -- corr 1 with a null tie reference cannot follow the actual tie).

.. CG-EXPLANATION-END id=function:resolveJumpTies

``interface TieEndpoint``
-------------------------

.. CG-BLOCK id=interface:TieEndpoint lines=588-594

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/emitCurves.ts
   :language: typescript
   :lines: 588-594
   :lineno-match:

.. CG-EXPLANATION-START id=interface:TieEndpoint

**What this does.** A type for a resolved tie endpoint: the surviving column index, that column's top and base elevations, and the unit index -- with minus-1 marking a raw-only endpoint whose picked unit was spliced out of the stack by the enclosed-lens merge.

**Why it is here.** The docstring explains a minus-1 index is harmless because the downstream band and corr consumers all guard against a missing unit, so a spliced-out unit's tie emits as pure line art that splits the faces without reshaping a surviving unit's band structure (ruling 8r).

.. CG-EXPLANATION-END id=interface:TieEndpoint

``function resolveTies``
------------------------

.. CG-BLOCK id=function:resolveTies lines=595-651

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/emitCurves.ts
   :language: typescript
   :lines: 595-651
   :lineno-match:

.. CG-EXPLANATION-START id=function:resolveTies

**What this does.** Resolves every approved edge straddling an ADJACENT gap into concrete tie geometry -- an endpoint on each facing column at the right contact elevation -- using the normalised stack first and, on a miss, the raw picked contact (ruling 8r) so a tie into a merged-away unit still resolves.

**Why it is here.** The docstring notes only adjacent-column edges become tie curves (a jump tie has no facing pair and is left for the substrate bridges), and the raw fallback emits a tie at the elevation the owner drew even after the enclosed-lens merge spliced the unit out.

.. CG-EXPLANATION-END id=function:resolveTies

