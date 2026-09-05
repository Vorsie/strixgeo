desktop.renderer.src.utils.partitionFillV2.emitContinuation
===========================================================

.. CG-PAGE source=desktop/src/renderer/src/utils/partitionFillV2/emitContinuation.ts complete=true

*Source file:* ``desktop/src/renderer/src/utils/partitionFillV2/emitContinuation.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-34

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/emitContinuation.ts
   :language: typescript
   :lines: 1-34
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** This file encodes the law that a column which READ NOTHING is not a boundary. A termination is a statement about where a unit meets what a facing test read; a column with no unit at any of the unit's own levels (ground below its TD, or above its first log) read nothing, so the unit passes straight through it and pinches against the first column that DID read that ground -- one gap away or several. Only where nothing in that direction ever read it does the unit run to the section edge, closed flat.

**Why it is here.** The docstring records the owner's words (2026-08-21) about S7's interbeds drawn as phantom pinches around the short S7A, and that this is the litho arm's half of a law the geotech arm already carries -- the two must read a short log the same way or the geotech frame paints a shape the litho engine invented. It notes ruling 8v later superseded the 0-tie continuation (0 ties always lens), leaving this for the tied cases. Pure module.

.. CG-EXPLANATION-END id=module-header

``const OVERLAP_EPS``
---------------------

.. CG-BLOCK id=const:OVERLAP_EPS lines=35-37

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/emitContinuation.ts
   :language: typescript
   :lines: 35-37
   :lineno-match:

.. CG-EXPLANATION-START id=const:OVERLAP_EPS

**What this does.** A tiny vertical-overlap threshold below which a facing unit is a contact touch, not a reading.

**Why it is here.** A hair's-width overlap is a shared contact, not evidence the facing column read that ground.

.. CG-EXPLANATION-END id=const:OVERLAP_EPS

``interface TerminationRun``
----------------------------

.. CG-BLOCK id=interface:TerminationRun lines=38-55

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/emitContinuation.ts
   :language: typescript
   :lines: 38-55
   :lineno-match:

.. CG-EXPLANATION-START id=interface:TerminationRun

**What this does.** A type describing what a termination measures against: the first column in a direction that read the unit's levels (or the section edge when none did), a flag saying which, and the gap range the run crosses.

**Why it is here.** It packages the answer to what does this unit pinch against, crossing blind columns, for the emitter.

.. CG-EXPLANATION-END id=interface:TerminationRun

``function terminationRun``
---------------------------

.. CG-BLOCK id=function:terminationRun lines=56-84

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/emitContinuation.ts
   :language: typescript
   :lines: 56-84
   :lineno-match:

.. CG-EXPLANATION-START id=function:terminationRun

**What this does.** Walks columns in the look direction from the unit's own column, returning the first one whose units overlap the unit's elevation window (an ordinary pinch measures against it), or the outermost column when none does (the unit runs to the edge).

**Why it is here.** This is the search that crosses blind columns to find the first reading column, so a short intervening test never interrupts a band that should run continuous.

.. CG-EXPLANATION-END id=function:terminationRun

``function runGapTies``
-----------------------

.. CG-BLOCK id=function:runGapTies lines=85-105

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/emitContinuation.ts
   :language: typescript
   :lines: 85-105
   :lineno-match:

.. CG-EXPLANATION-START id=function:runGapTies

**What this does.** Filters a set of ties to those whose gaps the run crosses.

**Why it is here.** A relocated lens diamond can meet a tie in an intervening gap; this gives the reach shortener the ties it must respect.

.. CG-EXPLANATION-END id=function:runGapTies

``function emitContinuation``
-----------------------------

.. CG-BLOCK id=function:emitContinuation lines=106-139

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/emitContinuation.ts
   :language: typescript
   :lines: 106-139
   :lineno-match:

.. CG-EXPLANATION-START id=function:emitContinuation

**What this does.** Runs a unit to the SECTION EDGE at full thickness -- the one case with nothing to pinch at: it emits the top contact, a curtain on the edge column, and the base contact, forming a closed rectangle with the unit's own vertical. Only the curtain names the unit; it returns false on a degenerate window.

**Why it is here.** The docstring explains only the curtain names the unit because the two carried contacts are SHARED with the units above and below (naming one would hand a neighbour's face this unit's soil -- measured on CS1 gap 17), exactly as the band contours carry no label; a sub-snap side makes the whole rectangle a no-op so a half-open loop is never emitted.

.. CG-EXPLANATION-END id=function:emitContinuation

