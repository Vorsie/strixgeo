desktop.renderer.src.utils.geotechHierarchicalFill.constructive.fillGap
=======================================================================

.. CG-PAGE source=desktop/src/renderer/src/utils/geotechHierarchicalFill/constructive/fillGap.ts complete=true

*Source file:* ``desktop/src/renderer/src/utils/geotechHierarchicalFill/constructive/fillGap.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-50

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechHierarchicalFill/constructive/fillGap.ts
   :language: typescript
   :lines: 1-50
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Opens the per-gap fill, executed in exactly four steps: LINES (every line the law calls for plus the litho cover, into one planar arrangement), LOOPS (the closed loops those lines make), FILL (each loop asked once at an interior point — lens, then onlap, then dominant mass), and MERGE (same-mass touching faces weld into one region). It imports the whole constructive toolkit.

**Why it is here.** Owner 2026-08-19, quoted verbatim: 'we said first draw all lines, lenses, onlaps, vertical lines, this makes closed loops, then we fill everything and merge it', with the fill order and the fill sweep spelled out in the same ruling. Drawing every line into one arrangement means no line is drawn 'after' another, so no emission order exists to depend on.

.. CG-EXPLANATION-END id=module-header

``const EXTEND``
----------------

.. CG-BLOCK id=const:EXTEND lines=51-62

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechHierarchicalFill/constructive/fillGap.ts
   :language: typescript
   :lines: 51-62
   :lineno-match:

.. CG-EXPLANATION-START id=const:EXTEND

**What this does.** A constant, 0.02 — how far construct lines are drawn past the gap's edges so they cross it cleanly. The block also shows the comment for the next constant, which introduces the degenerate-area floor below which a loop holds no ground.

**Why it is here.** Lines are drawn a little beyond the gap so they intersect the litho cover cleanly instead of ending exactly on an edge, where the arrangement could miss the crossing.

.. CG-EXPLANATION-END id=const:EXTEND

``const DEGENERATE_AREA_M2``
----------------------------

.. CG-BLOCK id=const:DEGENERATE_AREA_M2 lines=63-65

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechHierarchicalFill/constructive/fillGap.ts
   :language: typescript
   :lines: 63-65
   :lineno-match:

.. CG-EXPLANATION-START id=const:DEGENERATE_AREA_M2

**What this does.** A constant, 1e-9 m squared — below this a loop holds no ground and is not treated as a region.

**Why it is here.** The comment shown just above calls it a floor, not a sliver filter, deliberately: the arrangement also mints genuine hairlines at the cover's inset edge, and sweeping those away pulled six real regions off their own column, so they are kept as debt #228. This only refuses a loop with no area at all, which is not a body under any reading.

.. CG-EXPLANATION-END id=const:DEGENERATE_AREA_M2

``interface GapFillInput``
--------------------------

.. CG-BLOCK id=interface:GapFillInput lines=66-107

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechHierarchicalFill/constructive/fillGap.ts
   :language: typescript
   :lines: 66-107
   :lineno-match:

.. CG-EXPLANATION-START id=interface:GapFillInput

**What this does.** Everything one family-and-gap fill needs: the gap index, the two frame positions, this family's litho cover, all litho paint in draw order, the run's two banded tests or null, the packing ties, the litho cover ties, the family's columns, the section-wide stacks, the mass-of-a-band function, the run-wide closure bars, and the engineer's separated pairs.

**Why it is here.** The field comments pin two: the closure bars carry each band's closures run-wide so a closed loop never answers remainder ground past its own bar; and the separated pairs (owner 2026-08-31, debt #278 R5) are absent-safe, leaving the fill byte-identical when there are none.

.. CG-EXPLANATION-END id=interface:GapFillInput

``interface GapFillResult``
---------------------------

.. CG-BLOCK id=interface:GapFillResult lines=108-135

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechHierarchicalFill/constructive/fillGap.ts
   :language: typescript
   :lines: 108-135
   :lineno-match:

.. CG-EXPLANATION-START id=interface:GapFillResult

**What this does.** What one gap produced: the classed, welded regions; the 'correlate me' hatch residual; the area the dominant-mass step answered; the count of loops where the vertical line decided the owner; and the pre-merge loops, each carrying its single owning band and a role of construct or fill.

**Why it is here.** The field comment records that the audit measures balloons on construct loops only, where any violation is a constructor bug — the owner's words, 'there shouldn't be pre merge ballooning anywhere'.

.. CG-EXPLANATION-END id=interface:GapFillResult

``function painterOrder``
-------------------------

.. CG-BLOCK id=function:painterOrder lines=136-140

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechHierarchicalFill/constructive/fillGap.ts
   :language: typescript
   :lines: 136-140
   :lineno-match:

.. CG-EXPLANATION-START id=function:painterOrder

**What this does.** Orders regions the way the render stacks them: everything that is not a lens first, then the lenses last.

**Why it is here.** Lenses are overlays drawn on top, so the last region containing a point is the one actually seen; ordering the list this way makes a last-wins scan match what the eye reads.

.. CG-EXPLANATION-END id=function:painterOrder

``function coverAt``
--------------------

.. CG-BLOCK id=function:coverAt lines=141-155

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechHierarchicalFill/constructive/fillGap.ts
   :language: typescript
   :lines: 141-155
   :lineno-match:

.. CG-EXPLANATION-START id=function:coverAt

**What this does.** Returns the LAST region of a paint list that contains a sample point, or nothing.

**Why it is here.** Last-wins matches the painter order, so the topmost region — the one actually drawn over that point — is the one returned.

.. CG-EXPLANATION-END id=function:coverAt

``function ringSpanAt``
-----------------------

.. CG-BLOCK id=function:ringSpanAt lines=156-187

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechHierarchicalFill/constructive/fillGap.ts
   :language: typescript
   :lines: 156-187
   :lineno-match:

.. CG-EXPLANATION-START id=function:ringSpanAt

**What this does.** Returns the elevation span a ring occupies on the vertical at a given fraction — a scanline through it — falling back to the ring's whole range where the vertical misses it.

**Why it is here.** The dominant-mass step must measure a loop's extent at the sample's own vertical, not across its whole width, because a loop between two dipping tie lines is one band's ground at one end and the facing band's at the other.

.. CG-EXPLANATION-END id=function:ringSpanAt

``function fillGap``
--------------------

.. CG-BLOCK id=function:fillGap lines=188-930

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechHierarchicalFill/constructive/fillGap.ts
   :language: typescript
   :lines: 188-930
   :lineno-match:

.. CG-EXPLANATION-START id=function:fillGap

**What this does.** Fills one family's cover in one gap. LINES: it builds the constructs, decides whether this is a stacked seam and where its drape falls, and draws every line the law calls for — the tie lines, the seam vertical, the onlap free-contact flanks, the lens flanks, the carried flanks, and each band's own flat level wherever no tie or flank already states that contact — into one line set. LOOPS: the arrangement cuts the cover at every line into closed loops. FILL: each loop is sampled once and taken by a construct (lens, then onlap, then spanning) or, failing that, by the dominant mass through the remainder ladder, or by a stacked-seam half. POCKETS: no face may be an island detached from its band's own ground. LEFTOVER: whatever is still unclassed goes to the least dense mass that bounds it. MERGE: same-mass touching faces weld into one region carrying every contributing band's layer ids.

**Why it is here.** This is the whole engine, and the owner's rulings are threaded through it as comments: the termination clause; the onlap-flank line that fixes the gap-0 sand painted at its own test; the stale-flat suppression for both onlap and mirrored-lens shapes (dogfeed 2026-08-25); the stacked-seam 'keep mtaw lvl' (2026-08-25); the closed-loop-goes-to-the-open-mass rule (2026-08-21); the pocket rule ('it should all be one dense sand body'); the least-dense leftover (2026-08-26); and the fill sweep merge ('it becomes one body'). The final whose-paint-is-this attribution makes a band that emitted nothing still appear, because the 2/1/0 audit would otherwise read it as a construct that failed to exist.

.. CG-EXPLANATION-END id=function:fillGap

