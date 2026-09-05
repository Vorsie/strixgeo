desktop.renderer.src.utils.partitionFillV2.bothSidesClosed
==========================================================

.. CG-PAGE source=desktop/src/renderer/src/utils/partitionFillV2/bothSidesClosed.ts complete=true

*Source file:* ``desktop/src/renderer/src/utils/partitionFillV2/bothSidesClosed.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-44

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/bothSidesClosed.ts
   :language: typescript
   :lines: 1-44
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** This file answers one narrow question: when the two columns facing each other across a gap BOTH close off all their soil bodies before the middle -- each one's units pinch or lap out and none runs across -- who owns the ground left in the middle? The answer it supports is the owner's: a plain vertical line down the middle, the left half continuing the left column's soils and the right half the right column's.

**Why it is here.** The docstring records the owner's ruling (2026-08-24: yes in this case i would rather have a vertical line) and the reasoning: a body that closed its own loop has said nothing about the ground past its pinch, so when nobody runs through, no single soil may flood the leftover -- it splits at a seam. The docstring is equally careful about what this must NOT do: if even one unit on either side is an open band (two ties, draws nothing, runs straight through), that open body fills through and there is no line, so the test asks about every unit of both columns and a single open one answers no. It reuses the engine's own definition of closed (would ``drawTermination`` draw a termination here) rather than re-deciding it, so the check and the drawing can never disagree. Pure module.

.. CG-EXPLANATION-END id=module-header

``const ELEV_EPS``
------------------

.. CG-BLOCK id=const:ELEV_EPS lines=45-47

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/bothSidesClosed.ts
   :language: typescript
   :lines: 45-47
   :lineno-match:

.. CG-EXPLANATION-START id=const:ELEV_EPS

**What this does.** A tiny elevation tolerance (one millionth of a metre). A contact that merely grazes the top or bottom of the window is treated as not really inside it.

**Why it is here.** Floating-point elevations never land exactly on a boundary, so the epsilon keeps a hair's-width touch from counting as a real overlap.

.. CG-EXPLANATION-END id=const:ELEV_EPS

``interface SideClosure``
-------------------------

.. CG-BLOCK id=interface:SideClosure lines=48-55

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/bothSidesClosed.ts
   :language: typescript
   :lines: 48-55
   :lineno-match:

.. CG-EXPLANATION-START id=interface:SideClosure

**What this does.** A type (a named shape for a bundle of data) describing one side of a gap: the column itself, the column it faces, whether it is the left or right side, and that column's per-unit 2/1/0 tie arithmetic.

**Why it is here.** It groups everything the closure test needs for one side, so the test can be asked symmetrically about the left and the right.

.. CG-EXPLANATION-END id=interface:SideClosure

``interface GapClosure``
------------------------

.. CG-BLOCK id=interface:GapClosure lines=56-83

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/bothSidesClosed.ts
   :language: typescript
   :lines: 56-83
   :lineno-match:

.. CG-EXPLANATION-START id=interface:GapClosure

**What this does.** A type bundling both sides' ``SideClosure`` for one gap, computed once per gap.

**Why it is here.** The two sides are always needed together (both must close), so pairing them once avoids recomputing either.

.. CG-EXPLANATION-END id=interface:GapClosure

``function buildGapClosure``
----------------------------

.. CG-BLOCK id=function:buildGapClosure lines=84-111

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/bothSidesClosed.ts
   :language: typescript
   :lines: 84-111
   :lineno-match:

.. CG-EXPLANATION-START id=function:buildGapClosure

**What this does.** Builds the ``GapClosure`` for a gap: it runs the shared 2/1/0 arithmetic (``effectiveCorrForSide``) once for the left side looking right and once for the right side looking left, and packages the two columns with their results.

**Why it is here.** The docstring notes it uses the SAME ``effectiveCorrForSide`` source the termination-drawing sweep uses, so this predicate and the actual drawing cannot disagree about who closed. It also threads the jump-tie bridge anchor set, because a drawn correlation counts as a tie regardless of how far it reaches, so a bridge-anchored contact reads tied here exactly as it does in the sweep.

.. CG-EXPLANATION-END id=function:buildGapClosure

``function unitCloses``
-----------------------

.. CG-BLOCK id=function:unitCloses lines=112-131

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/bothSidesClosed.ts
   :language: typescript
   :lines: 112-131
   :lineno-match:

.. CG-EXPLANATION-START id=function:unitCloses

**What this does.** Answers, for one unit on one side, would the sweep draw a termination for it here. A unit with two ties (a band) runs through and does not close; a unit with zero ties always closes (it lenses); a unit with one tie closes unless following that tie to the facing column finds the same soil there, in which case the two merge and the unit runs through.

**Why it is here.** The docstring explains this deliberately mirrors ``drawTermination``'s own contract -- corr-0 always lenses (ruling 8i(e)), corr-1 follows the tie and merges on same soil (ruling 8m), corr-2 is a band that emits nothing -- rather than re-deriving it, so a deleted tie is never resurrected as a band.

.. CG-EXPLANATION-END id=function:unitCloses

``function sideCloses``
-----------------------

.. CG-BLOCK id=function:sideCloses lines=132-166

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/bothSidesClosed.ts
   :language: typescript
   :lines: 132-166
   :lineno-match:

.. CG-EXPLANATION-START id=function:sideCloses

**What this does.** Answers whether one column puts a fully closed package into the window: every one of its units that sits inside the window must begin and end inside it and terminate before the middle. It returns false if the column has nothing in the window at all, and false the moment any unit runs on past a bracket.

**Why it is here.** The docstring gives the geological reasoning: a side that read nothing has made no statement to meet, and a unit that runs past a bracket is the ground the window is cut out of (the owner's CS1 gap-7 clay), not a package inside it -- so neither counts as closed.

.. CG-EXPLANATION-END id=function:sideCloses

``function bothSidesCloseAtTheMiddle``
--------------------------------------

.. CG-BLOCK id=function:bothSidesCloseAtTheMiddle lines=167-177

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/bothSidesClosed.ts
   :language: typescript
   :lines: 167-177
   :lineno-match:

.. CG-EXPLANATION-START id=function:bothSidesCloseAtTheMiddle

**What this does.** The public test: true only when both facing packages close over the window, meaning nobody runs through, so the leftover in the middle is split by a vertical line instead of flooded by one soil.

**Why it is here.** This is the direct implementation of the owner's in this case i would rather have a vertical line ruling; the parameters take each bracket's elevation on each column separately because the brackets slope, so each column reads its own end of them.

.. CG-EXPLANATION-END id=function:bothSidesCloseAtTheMiddle

