desktop.renderer.src.utils.partitionFillV2.snap
===============================================

.. CG-PAGE source=desktop/src/renderer/src/utils/partitionFillV2/snap.ts complete=true

*Source file:* ``desktop/src/renderer/src/utils/partitionFillV2/snap.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-19

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/snap.ts
   :language: typescript
   :lines: 1-19
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** This module rounds points to a fixed 1 mm integer grid and provides the helpers that compare and key those snapped points. A snapped point is kept as whole grid units (metres divided by the grid size, rounded), so two points within a millimetre collapse to the same cell and equality is exact.

**Why it is here.** The docstring states the whole numerical-robustness strategy: perform ONE snapping pass mapping every input vertex and every computed intersection to the 1 mm grid, then do all arrangement walking as exact integer arithmetic on the snapped graph — so no floating-point epsilon comparisons cascade downstream (design §3).

.. CG-EXPLANATION-END id=module-header

``interface GridPoint``
-----------------------

.. CG-BLOCK id=interface:GridPoint lines=20-37

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/snap.ts
   :language: typescript
   :lines: 20-37
   :lineno-match:

.. CG-EXPLANATION-START id=interface:GridPoint

**What this does.** The shape of a snapped point: its x and elevation as whole grid units.

**Why it is here.** Because the coordinates are integers, equality is exact and the pair forms a reliable vertex key — the property the whole exact-arithmetic strategy rests on.

.. CG-EXPLANATION-END id=interface:GridPoint

``function snapPoint``
----------------------

.. CG-BLOCK id=function:snapPoint lines=38-57

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/snap.ts
   :language: typescript
   :lines: 38-57
   :lineno-match:

.. CG-EXPLANATION-START id=function:snapPoint

**What this does.** Rounds a real metres-by-elevation point to the nearest 1 mm grid cell, in integer grid units.

**Why it is here.** It is the single snapping operation the one-pass strategy applies to every point.

.. CG-EXPLANATION-END id=function:snapPoint

``function unsnapPoint``
------------------------

.. CG-BLOCK id=function:unsnapPoint lines=58-74

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/snap.ts
   :language: typescript
   :lines: 58-74
   :lineno-match:

.. CG-EXPLANATION-START id=function:unsnapPoint

**What this does.** Converts a snapped grid point back to real metres.

**Why it is here.** Once walking is done on the integer graph, output geometry must be expressed in metres again; this reverses the snap.

.. CG-EXPLANATION-END id=function:unsnapPoint

``function gridKey``
--------------------

.. CG-BLOCK id=function:gridKey lines=75-89

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/snap.ts
   :language: typescript
   :lines: 75-89
   :lineno-match:

.. CG-EXPLANATION-START id=function:gridKey

**What this does.** Builds a stable text key from a grid point's two integer coordinates.

**Why it is here.** For deduplicating and indexing vertices — two equal grid points produce the same exact key.

.. CG-EXPLANATION-END id=function:gridKey

``function gridEqual``
----------------------

.. CG-BLOCK id=function:gridEqual lines=90-116

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/snap.ts
   :language: typescript
   :lines: 90-116
   :lineno-match:

.. CG-EXPLANATION-START id=function:gridEqual

**What this does.** Returns whether two grid points are the same cell, by exact integer equality.

**Why it is here.** Exact integer equality is the reliable same-vertex test the snapped graph is built to allow.

.. CG-EXPLANATION-END id=function:gridEqual

``function segmentDegenerate``
------------------------------

.. CG-BLOCK id=function:segmentDegenerate lines=117-119

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/snap.ts
   :language: typescript
   :lines: 117-119
   :lineno-match:

.. CG-EXPLANATION-START id=function:segmentDegenerate

**What this does.** Returns whether a segment collapses to a single point once snapped — its two endpoints land in the same 1 mm cell.

**Why it is here.** The docstring explains a zero-extent curve is a malformed input: a closing flank whose apex snaps onto its own corner in a sub-millimetre gap would leave the lens loop half-open (the CS1 gap21 class). An emission path must test this before pushing a closing so no output curve has zero extent in both axes; skipping such a lens with its partner flank keeps holes and overlaps at zero (a documented no-op in a sub-snap gap).

.. CG-EXPLANATION-END id=function:segmentDegenerate

