desktop.renderer.src.utils.partitionFillV2.channelMatrix
========================================================

.. CG-PAGE source=desktop/src/renderer/src/utils/partitionFillV2/channelMatrix.ts complete=true

*Source file:* ``desktop/src/renderer/src/utils/partitionFillV2/channelMatrix.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-64

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/channelMatrix.ts
   :language: typescript
   :lines: 1-64
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** This file decides who owns the width that a set of pinched-out units vacates inside a tie-bounded channel. When units terminate, the arrangement leaves one flood face covering the space they emptied, and the naive rule paints that face from whatever thin surviving edge still touches it -- so a 0.38 m band could end up painting a whole 1 m channel. This module instead paints such a face with the channel's DOMINANT soil: the unit of that same column that actually sits at the face's elevation.

**Why it is here.** The docstring records the owner's two CS1 scenes (2026-08-18) that motivated it -- a thin dense silt ballooning to fill a channel, and a thin loose sand crust flooding 2.8 m over dense sand (a very dense sand appearing out of nowhere; extrapolate the md dense sand to the tie and let it fill all). It restores, at the labelling stage, the owner's earlier 8f intent (fill the void with the dominant lithology between correlations) without changing the emission rule (every unit still terminates). It is self-limiting: when the surviving edge already IS the dominant mass, nothing changes, and it never reads across to the facing column (the never-read-across-a-tie lesson). Pure module.

.. CG-EXPLANATION-END id=module-header

``const OWN_FLANK_PREFIXES``
----------------------------

.. CG-BLOCK id=const:OWN_FLANK_PREFIXES lines=65-67

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/channelMatrix.ts
   :language: typescript
   :lines: 65-67
   :lineno-match:

.. CG-EXPLANATION-START id=const:OWN_FLANK_PREFIXES

**What this does.** The two id prefixes (``term`` and ``oflank``) that mark a curve as some unit's OWN termination flank -- the line it drew as it pinched or lapped out.

**Why it is here.** The comment explains the careful exclusions: the flood wedge, the sub-TD substrate curves, an enclosed lens's own loop, and all the given line art are deliberately left out, because none of those is a unit pinching out, and including some of them (measured) wrongly flipped whole sub-TD sand bands to a thin clay.

.. CG-EXPLANATION-END id=const:OWN_FLANK_PREFIXES

``const CHANNEL_SAMPLE_INSET``
------------------------------

.. CG-BLOCK id=const:CHANNEL_SAMPLE_INSET lines=68-70

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/channelMatrix.ts
   :language: typescript
   :lines: 68-70
   :lineno-match:

.. CG-EXPLANATION-START id=const:CHANNEL_SAMPLE_INSET

**What this does.** A one-millimetre offset used to sample a hair below the top of the face's window, clear of the snap grid.

**Why it is here.** Sampling exactly on the bounding line would let the band whose base IS that line win; a hair inside picks the band that actually flooded in.

.. CG-EXPLANATION-END id=const:CHANNEL_SAMPLE_INSET

``interface DominantUnit``
--------------------------

.. CG-BLOCK id=interface:DominantUnit lines=71-97

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/channelMatrix.ts
   :language: typescript
   :lines: 71-97
   :lineno-match:

.. CG-EXPLANATION-START id=interface:DominantUnit

**What this does.** A small type holding the matrix unit chosen for a window, plus which column and unit it is and how much of the window it occupies.

**Why it is here.** It is the return shape of the lookup -- enough for the caller to relabel and to know how strong the match was.

.. CG-EXPLANATION-END id=interface:DominantUnit

``function isEnclosingFloodFace``
---------------------------------

.. CG-BLOCK id=function:isEnclosingFloodFace lines=98-122

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/channelMatrix.ts
   :language: typescript
   :lines: 98-122
   :lineno-match:

.. CG-EXPLANATION-START id=function:isEnclosingFloodFace

**What this does.** Decides whether a face is a flood face left by OTHER units pinching out -- true when at least one termination flank of a DIFFERENT soil bounds it. If a flank of the face's own soil bounds it, the face is that band's own lens or onlap wedge and the function returns false so it is left alone.

**Why it is here.** The comment (owner round 3, just emit the closed loops) explains the own-soil immunity: after the order-independent detour change an onlap flank rides collinear with the lens it wraps, so a wedge's boundary can carry a neighbour's flank ids and would otherwise be wrongly repainted out of existence -- measured on the owner's sand crust.

.. CG-EXPLANATION-END id=function:isEnclosingFloodFace

``function elevationWindow``
----------------------------

.. CG-BLOCK id=function:elevationWindow lines=123-141

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/channelMatrix.ts
   :language: typescript
   :lines: 123-141
   :lineno-match:

.. CG-EXPLANATION-START id=function:elevationWindow

**What this does.** Returns the top and bottom elevation of a face -- the highest and lowest points of its polygon.

**Why it is here.** The channel's soil is read at this vertical window, so the extremes are what the lookup needs.

.. CG-EXPLANATION-END id=function:elevationWindow

``function columnsReached``
---------------------------

.. CG-BLOCK id=function:columnsReached lines=142-161

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/channelMatrix.ts
   :language: typescript
   :lines: 142-161
   :lineno-match:

.. CG-EXPLANATION-START id=function:columnsReached

**What this does.** Returns which columns fall inside the face's horizontal span -- the columns the face actually touches.

**Why it is here.** The comment explains a vacancy sits on one column's side of a gap, while a face reaching two columns is a band connecting them (whose soil is its seed's by construction), so only single-column faces are candidates. It compares at the 1 mm grid tolerance, not float-exact, because faces come back snapped and a float-exact test matched nothing and silently disabled the whole rule (measured).

.. CG-EXPLANATION-END id=function:columnsReached

``function columnTd``
---------------------

.. CG-BLOCK id=function:columnTd lines=162-202

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/channelMatrix.ts
   :language: typescript
   :lines: 162-202
   :lineno-match:

.. CG-EXPLANATION-START id=function:columnTd

**What this does.** Returns a column's TD -- the lowest elevation it drilled.

**Why it is here.** Used to refuse relabelling a face that runs deeper than the hole itself: a column cannot speak for space below its own TD.

.. CG-EXPLANATION-END id=function:columnTd

``function matrixUnitForWindow``
--------------------------------

.. CG-BLOCK id=function:matrixUnitForWindow lines=203-265

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/channelMatrix.ts
   :language: typescript
   :lines: 203-265
   :lineno-match:

.. CG-EXPLANATION-START id=function:matrixUnitForWindow

**What this does.** Returns the matrix unit of a channel on one column -- the unit whose own span contains the TOP of the window, i.e. the band sitting at the channel's stratigraphic level. It samples a hair inside the top; if that top is above the column's surface it falls back to the nearest unit.

**Why it is here.** The docstring stresses this is the engine's own matrix rule (the same one ``emitEnclosingFlood`` uses), not a new heuristic, and that it deliberately replaces an earlier largest-mass-in-the-window pick the owner overrode (in my eyes here, the matrix is a md sand -- the band the channel starts in, not the thickest one present). Sampling the top is what makes it the channel's own level, because a vacancy is bounded above by the line that opened it.

.. CG-EXPLANATION-END id=function:matrixUnitForWindow

``function channelMatrixRelabel``
---------------------------------

.. CG-BLOCK id=function:channelMatrixRelabel lines=266-291

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/channelMatrix.ts
   :language: typescript
   :lines: 266-291
   :lineno-match:

.. CG-EXPLANATION-START id=function:channelMatrixRelabel

**What this does.** The public entry: returns the soil a flood face must take, or nothing (leave it alone). It returns nothing unless the face is a flood face, exactly one column reaches it, that column drills deep enough to speak for the window, and its matrix unit differs from the face's current paint.

**Why it is here.** The docstring lists each guard with its measured reason -- the deepest being that a borehole stopping at +4.23 once relabelled a 5 m substrate sand band to its own thin bottom clay on a 2 cm overlap, so a column may never speak below its own TD; the substrate's own bottom-tie authority stays untouched.

.. CG-EXPLANATION-END id=function:channelMatrixRelabel

