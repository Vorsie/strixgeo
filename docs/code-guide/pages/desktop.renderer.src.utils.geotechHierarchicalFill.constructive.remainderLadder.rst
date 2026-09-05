desktop.renderer.src.utils.geotechHierarchicalFill.constructive.remainderLadder
===============================================================================

.. CG-PAGE source=desktop/src/renderer/src/utils/geotechHierarchicalFill/constructive/remainderLadder.ts complete=true

*Source file:* ``desktop/src/renderer/src/utils/geotechHierarchicalFill/constructive/remainderLadder.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-42

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechHierarchicalFill/constructive/remainderLadder.ts
   :language: typescript
   :lines: 1-42
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** This module is the whole of the fill's last step — "then fill in the rest with the dominant lithology". Once every construct the law drew has been asked and none of them claims a piece of ground, that ground still belongs to somebody; this file decides which bands may be asked, in what widening order, and how one of them wins. It imports the construct and tie shapes and the claim test, a helper that asks whether a facing test bottomed out, and the wall machinery from the neighbouring module.

**Why it is here.** Two owner rules shape it. 2026-08-21: "the remainder of each closed loop goes to the OPEN mass" — a band that already drew a lens or onlap has closed its loop and takes no leftover, so open masses are asked first. 2026-08-24: "yes in this case i'd rather have a vertical line" — when both facing packages closed at the middle, the leftover splits at the seam and each half continues its own test's masses, and no column that does not even border the gap floods it. It was pulled out of the fill file when the second landed, because that file had passed the 500-line limit (debt #201) and this is a self-contained decision: candidates in, one winner out.

.. CG-EXPLANATION-END id=module-header

``const COVER_EPS``
-------------------

.. CG-BLOCK id=const:COVER_EPS lines=43-54

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechHierarchicalFill/constructive/remainderLadder.ts
   :language: typescript
   :lines: 43-54
   :lineno-match:

.. CG-EXPLANATION-START id=const:COVER_EPS

**What this does.** A constant: the smallest overlap, one micrometre, that counts as a band actually covering a piece of ground.

**Why it is here.** Two contacts at the same elevation arrive from different arithmetic, so a shared boundary overlaps by a millionth of a millionth of a metre rather than exactly nothing. The docstring measures the bug it stops: on CS2 gap 0 a sand whose base IS the loop's top "covered" it by that noise and took the whole face below its own base. Contacts live on a millimetre grid, so a micrometre is far below anything real and far above the noise.

.. CG-EXPLANATION-END id=const:COVER_EPS

``type Relevance``
------------------

.. CG-BLOCK id=type:Relevance lines=55-57

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechHierarchicalFill/constructive/remainderLadder.ts
   :language: typescript
   :lines: 55-57
   :lineno-match:

.. CG-EXPLANATION-START id=type:Relevance

**What this does.** A named set of three settings for how hard a rung tests its winner against the sample's own elevation: ``off`` (take whatever scored highest), ``relate`` (the winner must own the level, cover the loop, or lie directly against one of the band's own contacts), and ``own`` (own the level or cover the loop and nothing else — the wall-less last rung).

**Why it is here.** The ladder widens its search in stages and each stage needs a different strictness, so naming the three keeps the rung table readable.

.. CG-EXPLANATION-END id=type:Relevance

``interface RemainderInput``
----------------------------

.. CG-BLOCK id=interface:RemainderInput lines=58-105

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechHierarchicalFill/constructive/remainderLadder.ts
   :language: typescript
   :lines: 58-105
   :lineno-match:

.. CG-EXPLANATION-START id=interface:RemainderInput

**What this does.** The data shape carrying everything one remainder decision needs: the gap's own two tests' bands, every band the family has on the section, which bands closed in this gap, where the gap's middle is, the loop's elevation extent and the sample point, plus the mass-identity function, the drawn ties, each band's own-contact ties, where each band's closures stand, each band's own onlap shape, and every column's full stack.

**Why it is here.** A remainder decision draws on a great deal of context, and gathering it into one shape keeps the two decision functions' signatures manageable. The last field — every packing band per column whatever family — is asked one question only: did the facing test measure this ground at all.

.. CG-EXPLANATION-END id=interface:RemainderInput

``function pickDominant``
-------------------------

.. CG-BLOCK id=function:pickDominant lines=106-309

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechHierarchicalFill/constructive/remainderLadder.ts
   :language: typescript
   :lines: 106-309
   :lineno-match:

.. CG-EXPLANATION-START id=function:pickDominant

**What this does.** The scorer. Given a set of candidate bands and a wall scope, it discards any band that would be handed ground past its own closure, past its own onlap's shadow, across a drawn correlation, or on the far side of a mid-gap seam it has no business crossing — then ranks the survivors by whether the sample sits in the band's own elevation window, then the nearer test, then the biggest mass, and returns the winner (noting when the mid-gap vertical had to decide between two equal masses).

**Why it is here.** It carries several owner rulings as explicit guards, each documented with the scene that forced it. "Where a band's own construct speaks, it speaks completely" (2026-08-22) stops an onlap re-taking the wedge directly above its own pinching top and squaring its triangle back into a rectangle — scoped to onlaps only, inside the band's own window only, and only where somebody else can speak for the ground; the hatch this leaves on CS1 gap 19 the owner accepted ("hatch is fine, leave it") and it is frozen into the golden master. The class-may-never-cross-a-correlation absolute and the closed-statement-ends-at-the-middle rule are here too, the latter also barring a test standing entirely outside the gap from flooding it (the CS2 gap 0 case where a whole sand package welded 69 m left across another test's closed constructs). The dominant is the thickest mass among the tests that read this ground — "fill in the rest with the dominant lithology" — which is what tells a 5.6 m silt from a 0.5 m interbed.

.. CG-EXPLANATION-END id=function:pickDominant

``function pickRemainder``
--------------------------

.. CG-BLOCK id=function:pickRemainder lines=310-447

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechHierarchicalFill/constructive/remainderLadder.ts
   :language: typescript
   :lines: 310-447
   :lineno-match:

.. CG-EXPLANATION-START id=function:pickRemainder

**What this does.** The ladder. It asks the ground in widening circles — the two flanks first, then the whole family, open masses before closed ones — and stops at the first circle that produces a winner relating to the sample's own levels, dropping the walls only on the final circle. It returns the winning band (or none, which renders as the "correlate me" hatch) and whether the mid-gap vertical decided it.

**Why it is here.** Every rung is an owner ruling. Rung 1 is the open fill-through (the SF-silt ruling of 2026-08-21) and comes first untouched. Rung 2 is both-packages-closed-at-the-middle (2026-08-24, "yes in this case i'd rather have a vertical line"): the leftover between two closed loops goes left-half to the left column's masses, right-half to the right's. No circle may answer by mere elimination — a winner must relate to the sample's own levels — because ranking on nearest-thing-left once let an undivided head above a tie pick up a class that exists only below it. The final circle drops the drawn walls (measured: 345 cells of clay went to hatch without that last resort) but keeps the candidate's own boundary, honouring "i don't want the VD sand to spill below that bottom tie".

.. CG-EXPLANATION-END id=function:pickRemainder

