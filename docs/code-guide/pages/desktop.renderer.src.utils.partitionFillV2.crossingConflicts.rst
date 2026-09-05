desktop.renderer.src.utils.partitionFillV2.crossingConflicts
============================================================

.. CG-PAGE source=desktop/src/renderer/src/utils/partitionFillV2/crossingConflicts.ts complete=true

*Source file:* ``desktop/src/renderer/src/utils/partitionFillV2/crossingConflicts.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-43

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/crossingConflicts.ts
   :language: typescript
   :lines: 1-43
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** This file runs the single pass that detects crossing correlation ties -- two approved lines that geometrically cross in a gap. The owner's ruling is that crossing ties are a hard conflict: neither may band, both units fall back to a pinch or lens, and the section warns the engineer until one is deleted. It canonicalises EVERY approved edge -- both adjacent ties and long jump bridges that span several columns -- into gap-local segments, then checks for crossings across the full set per gap.

**Why it is here.** The docstring explains why this replaced the old check: the old one lived in curve emission and saw only adjacent ties, so a bridge crossing another bridge (or crossing an adjacent tie in a gap it passes through) silently entered the arrangement and invalid input became apparently-valid fill (owner section 8 question 4). Every edge in any crossing is suspended from both emission paths and reported. Pure module.

.. CG-EXPLANATION-END id=module-header

``const ELEV_EPS``
------------------

.. CG-BLOCK id=const:ELEV_EPS lines=44-50

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/crossingConflicts.ts
   :language: typescript
   :lines: 44-50
   :lineno-match:

.. CG-EXPLANATION-START id=const:ELEV_EPS

**What this does.** A tiny (one-millionth-metre) elevation tolerance for comparisons before the 1 mm snap.

**Why it is here.** Standard hair's-width tolerance so a shared endpoint is not misread as a crossing.

.. CG-EXPLANATION-END id=const:ELEV_EPS

``function edgeKey``
--------------------

.. CG-BLOCK id=function:edgeKey lines=51-66

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/crossingConflicts.ts
   :language: typescript
   :lines: 51-66
   :lineno-match:

.. CG-EXPLANATION-START id=function:edgeKey

**What this does.** Builds a stable, order-invariant identity string for an approved edge from its two endpoint layer ids and sides, so the same correlation keys the same regardless of which endpoint was listed first.

**Why it is here.** The docstring notes two edges with the same endpoints and sides are the same correlation; the order-invariant key lets the suspended set recognise it either way.

.. CG-EXPLANATION-END id=function:edgeKey

``interface CrossingConflict``
------------------------------

.. CG-BLOCK id=interface:CrossingConflict lines=67-75

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/crossingConflicts.ts
   :language: typescript
   :lines: 67-75
   :lineno-match:

.. CG-EXPLANATION-START id=interface:CrossingConflict

**What this does.** A type describing one detected conflict: a gap where the crossing was seen, the two conflicting curve or edge ids, and the two edges' order-invariant keys.

**Why it is here.** The docstring notes it stays backward-compatible with the historical conflict shape (gap index plus tie ids) and adds the edge keys so a consumer can identify the suspended correlations without knowing the internal curve-id vocabulary.

.. CG-EXPLANATION-END id=interface:CrossingConflict

``interface EdgeSegment``
-------------------------

.. CG-BLOCK id=interface:EdgeSegment lines=76-108

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/crossingConflicts.ts
   :language: typescript
   :lines: 76-108
   :lineno-match:

.. CG-EXPLANATION-START id=interface:EdgeSegment

**What this does.** A type for one gap-local piece of an approved edge: the gap it spans, its elevation at the left and right column of that gap, the owning edge's key, and a display id.

**Why it is here.** Every edge -- adjacent or bridge -- is reduced to these per-gap segments so one uniform crossing test covers them all.

.. CG-EXPLANATION-END id=interface:EdgeSegment

``function detectCrossingConflicts``
------------------------------------

.. CG-BLOCK id=function:detectCrossingConflicts lines=109-193

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/crossingConflicts.ts
   :language: typescript
   :lines: 109-193
   :lineno-match:

.. CG-EXPLANATION-START id=function:detectCrossingConflicts

**What this does.** The public pass: it maps every layer id to its column, turns each approved edge into one segment per gap it crosses (interpolating the bridge line's elevation at each intervening column), then within each gap checks every pair of segments for a crossing -- opposite elevation order at the two ends -- and returns the suspended edge keys plus the de-duplicated conflict report.

**Why it is here.** The docstring explains the interpolation matches the bridge polyline sampling the substrate uses, shared endpoints are not counted as crossings, and a bridge crossing repeated across several gaps is reported once. An edge whose endpoints do not both resolve in this section is skipped as belonging to another section.

.. CG-EXPLANATION-END id=function:detectCrossingConflicts

