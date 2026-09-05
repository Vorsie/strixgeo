desktop.renderer.src.utils.partitionFillV2.drawTermination
==========================================================

.. CG-PAGE source=desktop/src/renderer/src/utils/partitionFillV2/drawTermination.ts complete=true

*Source file:* ``desktop/src/renderer/src/utils/partitionFillV2/drawTermination.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-70

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/drawTermination.ts
   :language: typescript
   :lines: 1-70
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** This file is the DRAWING half of ruling 8i's three-function spec: given a unit's tie count on a side (0, 1 or 2), it draws the right termination -- a lens for zero ties, an onlap for one, nothing for two (a band is given line art). The classifying half (how many ties) lives in ``effectiveCorr``; this file consumes that verdict and draws.

**Why it is here.** The docstring quotes ruling 8i (2026-07-17) verbatim and ruling 8m (follow the tie, and skip the flank when the matched facing soil is the same -- the two merge into one body). It records that this literal draw logic replaced every earlier run-existence heuristic: corr-0 always lenses (only physical collapse suppresses it), corr-1 follows its tie, corr-2 draws nothing. Pure module.

.. CG-EXPLANATION-END id=module-header

``const ELEV_EPS``
------------------

.. CG-BLOCK id=const:ELEV_EPS lines=71-77

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/drawTermination.ts
   :language: typescript
   :lines: 71-77
   :lineno-match:

.. CG-EXPLANATION-START id=const:ELEV_EPS

**What this does.** A tiny elevation tolerance for comparisons before the 1 mm snap.

**Why it is here.** Standard hair's-width margin.

.. CG-EXPLANATION-END id=const:ELEV_EPS

``const MATCH_OFFSET``
----------------------

.. CG-BLOCK id=const:MATCH_OFFSET lines=78-85

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/drawTermination.ts
   :language: typescript
   :lines: 78-85
   :lineno-match:

.. CG-EXPLANATION-START id=const:MATCH_OFFSET

**What this does.** A 1 mm offset used to sample the facing unit just below a top tie or just above a base tie.

**Why it is here.** The docstring explains it follows ruling 8m's below-for-top, above-for-bottom rule and is small enough to land inside a real facing unit yet well above the snap grid.

.. CG-EXPLANATION-END id=const:MATCH_OFFSET

``function tieRefFarElev``
--------------------------

.. CG-BLOCK id=function:tieRefFarElev lines=86-105

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/drawTermination.ts
   :language: typescript
   :lines: 86-105
   :lineno-match:

.. CG-EXPLANATION-START id=function:tieRefFarElev

**What this does.** Returns a resolved tie's FACING endpoint elevation for a look side -- the far end, since the near end is on our own column.

**Why it is here.** This is the exact geometry of the unit's own edge, so following it needs no elevation guessing (audit item 6).

.. CG-EXPLANATION-END id=function:tieRefFarElev

``function elevAtXAlong``
-------------------------

.. CG-BLOCK id=function:elevAtXAlong lines=106-141

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/drawTermination.ts
   :language: typescript
   :lines: 106-141
   :lineno-match:

.. CG-EXPLANATION-START id=function:elevAtXAlong

**What this does.** Returns the elevation at a given along-section metre position along a polyline ordered by x, interpolating the segment that spans it -- so a bent three-point tie yields the bent elevation there, not the straight chord.

**Why it is here.** The docstring (session 109) explains an onlap that laps a bent tie must ride the bend; working in absolute metres keeps it look-side-agnostic so left or right orientation never matters.

.. CG-EXPLANATION-END id=function:elevAtXAlong

``function tieRefFarSide``
--------------------------

.. CG-BLOCK id=function:tieRefFarSide lines=142-176

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/drawTermination.ts
   :language: typescript
   :lines: 142-176
   :lineno-match:

.. CG-EXPLANATION-START id=function:tieRefFarSide

**What this does.** Returns the FACING endpoint's contact side (top or base) of a resolved tie for a look side.

**Why it is here.** The docstring explains for a symmetric top-top or base-base tie this equals the unit's own tied side, but for a mixed base-top tie it differs, and only the facing side lands the correct matched unit; it exists for ruling 8m correctness on mixed ties.

.. CG-EXPLANATION-END id=function:tieRefFarSide

``function matchedFacingSameLitho``
-----------------------------------

.. CG-BLOCK id=function:matchedFacingSameLitho lines=177-193

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/drawTermination.ts
   :language: typescript
   :lines: 177-193
   :lineno-match:

.. CG-EXPLANATION-START id=function:matchedFacingSameLitho

**What this does.** Answers whether, following a corr-1 unit's tie to the matched facing contact (below a top tie, above a base tie), the facing soil is the SAME as the unit's own -- in which case the onlap flank is skipped, because the tie bounds the space and the post-fill merge welds the two into one body.

**Why it is here.** The docstring is ruling 8m: same soil skips (the flank would only be an interior seam of the identical final body); different draws the onlap. It samples the exact far endpoint of the unit's own tie (audit item 6), not the first tie at a shared elevation, which was the wrong-tie bug.

.. CG-EXPLANATION-END id=function:matchedFacingSameLitho

``function tiedContactSide``
----------------------------

.. CG-BLOCK id=function:tiedContactSide lines=194-245

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/drawTermination.ts
   :language: typescript
   :lines: 194-245
   :lineno-match:

.. CG-EXPLANATION-START id=function:tiedContactSide

**What this does.** Returns which contact (top or base) carries a corr-1 unit's single tie; when both or neither flag is set it defaults to base.

**Why it is here.** The docstring notes base is the common onlap-riding-the-band-below case, the safe default for an ambiguous derived edge.

.. CG-EXPLANATION-END id=function:tiedContactSide

``function drawTermination``
----------------------------

.. CG-BLOCK id=function:drawTermination lines=246-368

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/drawTermination.ts
   :language: typescript
   :lines: 246-368
   :lineno-match:

.. CG-EXPLANATION-START id=function:drawTermination

**What this does.** The dispatcher: for one unit into one gap on one side, it draws nothing for a band (corr-2), a lens for corr-0, and for corr-1 it follows the tie and either skips (same facing soil) or draws an onlap. It returns whether a termination was emitted.

**Why it is here.** The docstring and inline comments carry the full ruling stack: corr-0 lenses always with only physical suppression (8i(e)), corr-1 follows its tie (8m, superseding the blanket always-onlaps), and the onlap draws just ONE flank because the tie is already line art (8i(d)). It picks the onlap's tied side from the EFFECTIVE tied contact (so a derived-band-tied unit rides the band contour, not the wrong free side), and notes the safe-default repair now demotes a flooded unit to corr-0 upstream so the same-litho skip stays unconditional here.

.. CG-EXPLANATION-END id=function:drawTermination

``function emitLens``
---------------------

.. CG-BLOCK id=function:emitLens lines=369-508

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/drawTermination.ts
   :language: typescript
   :lines: 369-508
   :lineno-match:

.. CG-EXPLANATION-START id=function:emitLens

**What this does.** Emits a zero-tie lens: the two closing flanks from the unit's top and base corners to an apex at the unit's own mid-elevation, plus a flood wedge that fills the vacated width past the apex with the facing enclosing soil. It honours a free-draw apex override, caps the reach at 0.45 (shortening only on a tie collision), records the emitted diamond, and returns whether anything was drawn.

**Why it is here.** The inline comments carry rulings 8b-rev (default reach 0.45, the thickness cap applies only on a tie collision), 8s (the facing-sample cap is deleted -- the matrix detours around the wedge instead), and 8n(b) (the wrap past the apex is the enclosing matrix read from the lens's OWN column, never the far facing column 78 m away, which once painted a phantom sand lens). The recorded diamond lets a crossing band contour detour around it (8s stage B); the flood wedge is clamped to stay inside the gap's ties (8n, stay inside the lines).

.. CG-EXPLANATION-END id=function:emitLens

``function emitOnlap``
----------------------

.. CG-BLOCK id=function:emitOnlap lines=509-641

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/drawTermination.ts
   :language: typescript
   :lines: 509-641
   :lineno-match:

.. CG-EXPLANATION-START id=function:emitOnlap

**What this does.** Emits a one-tie onlap: a single closing flank from the unit's free contact to a tip at fraction 0.5 on the tied contact's line, plus a flood wedge filling the width past the tip. The apex elevation always rides the tie line (or the bent tie, if a free-draw override bent it); it detours the flank around any enclosed or sibling lens it would cross, and returns whether anything was drawn.

**Why it is here.** The docstring is ruling 8i(d): an onlap is ONE extra line, because the tie itself is existing line art bounding the other side -- a second flank riding the tie would duplicate it (the recorded source of the onlap-rendered-as-lens confusion) and is forbidden. The inline comments carry the free-draw override (moves only the reach, never off the tie, so the flank stays joined to the tie), the session-109 bent-tie ride, and rulings 8g and 8t (the flank and its flood boundary detour around a crossed lens diamond so the lens closes as a hole in both).

.. CG-EXPLANATION-END id=function:emitOnlap

``function facingElevAt``
-------------------------

.. CG-BLOCK id=function:facingElevAt lines=642-656

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/drawTermination.ts
   :language: typescript
   :lines: 642-656
   :lineno-match:

.. CG-EXPLANATION-START id=function:facingElevAt

**What this does.** Returns the facing-column elevation of the unit spanning a target elevation, falling back to the nearest contact when none spans it.

**Why it is here.** The tie anchor fallback for a derived or implicit tie whose own curve does not live on this unit's contact.

.. CG-EXPLANATION-END id=function:facingElevAt

``function segmentDeg``
-----------------------

.. CG-BLOCK id=function:segmentDeg lines=657-662

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/drawTermination.ts
   :language: typescript
   :lines: 657-662
   :lineno-match:

.. CG-EXPLANATION-START id=function:segmentDeg

**What this does.** Reports whether two points snap to the same 1 mm cell.

**Why it is here.** The physical degenerate guard, written inline to avoid a dependency cycle with the snap module.

.. CG-EXPLANATION-END id=function:segmentDeg

