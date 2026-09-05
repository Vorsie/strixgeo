desktop.renderer.src.utils.partitionFillV2.emitSubstrate
========================================================

.. CG-PAGE source=desktop/src/renderer/src/utils/partitionFillV2/emitSubstrate.ts complete=true

*Source file:* ``desktop/src/renderer/src/utils/partitionFillV2/emitSubstrate.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-40

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/emitSubstrate.ts
   :language: typescript
   :lines: 1-40
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** This module draws the deep-to-deep substrate bridge lines. Below a shallow test's drilled depth there is no data; where the engineer drew a jump tie (a correlation spanning two or more columns), that tie is turned into a bridge line — a polyline from the left anchor's contact, through every intervening column at the interpolated elevation, to the right anchor's contact. The arrangement then traces the deep bands below the shallow TDs from these bridge lines and the deep columns' edges. A deep strip with no jump tie bracketing it stays empty.

**Why it is here.** The docstring pins this to owner ruling Q3 (bridge-less strips stay empty) and records it is the v2 replacement for v1's spanning bands, expressed as curves the arrangement consumes rather than pre-clipped polygons, with the same fill-only-between-bracketing-deep-anchors behaviour interpolated by real along-section metres.

.. CG-EXPLANATION-END id=module-header

``function bridgeAnchorKey``
----------------------------

.. CG-BLOCK id=function:bridgeAnchorKey lines=41-58

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/emitSubstrate.ts
   :language: typescript
   :lines: 41-58
   :lineno-match:

.. CG-EXPLANATION-START id=function:bridgeAnchorKey

**What this does.** Builds the direction-blind key for a bridge-anchored contact: column index, unit index, and top or base.

**Why it is here.** The docstring records the interval tiler must not tile a competing lens or onlap for a unit that owns an anchored contact, or the deep anchor units would pinch into the gap instead of banding across the bridge (the CS1 gap-7 sub-TD lens-vacancy bug); this key is that suppression lookup.

.. CG-EXPLANATION-END id=function:bridgeAnchorKey

``function bridgeGapAnchorKey``
-------------------------------

.. CG-BLOCK id=function:bridgeGapAnchorKey lines=59-98

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/emitSubstrate.ts
   :language: typescript
   :lines: 59-98
   :lineno-match:

.. CG-EXPLANATION-START id=function:bridgeGapAnchorKey

**What this does.** Builds the directional key for a bridge-anchored contact, scoped to the gap and side the bridge spans toward: gap index, side, unit index, and top or base.

**Why it is here.** The docstring cites ruling 8i(e): a jump tie ties its two anchored endpoints toward each other, so the low anchor is tied looking right and the high anchor looking left; this directional key feeds the 2/1/0 arithmetic so a bridge-anchored contact reads tied (onlap) only on the side the bridge spans toward, and pass-through columns stay untied.

.. CG-EXPLANATION-END id=function:bridgeGapAnchorKey

``interface BracketStrip``
--------------------------

.. CG-BLOCK id=interface:BracketStrip lines=99-113

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/emitSubstrate.ts
   :language: typescript
   :lines: 99-113
   :lineno-match:

.. CG-EXPLANATION-START id=interface:BracketStrip

**What this does.** A type describing the band a bracketed pair of jump ties defines: the soil, the body, the two anchor units' layers, the left and right x, and the upper and lower line elevations at each end.

**Why it is here.** The docstring records the strip is claimed by GEOMETRY (every vertex between the lines within the x-range), never by which curve bounds it, because at the anchor columns the bridge coincides with the columns' own contact curves and the arrangement may hand the boundary to either id.

.. CG-EXPLANATION-END id=interface:BracketStrip

``function emitSubstrateBridges``
---------------------------------

.. CG-BLOCK id=function:emitSubstrateBridges lines=114-239

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/emitSubstrate.ts
   :language: typescript
   :lines: 114-239
   :lineno-match:

.. CG-EXPLANATION-START id=function:emitSubstrateBridges

**What this does.** Draws a bridge line for every jump tie. For each correlation edge whose two endpoints sit on non-adjacent columns it finds the low and high anchor, marks both anchored contacts (and the derived base of the unit above a top anchor), samples the straight bridge line at every intervening column, and pushes it as a tie curve. It then detects bracketed pairs: two bridges over the same column pair that run along the top and the base of one same-soil unit define a bracket strip band.

**Why it is here.** The docstring cites the owner ruling of 2026-08-18 (2/1/0 is still the basis of the model — that VD quad has a top and a bottom correlation so it should be there): two bridges bracketing a unit make the strip between them a band of that soil straight through every pass-through column, which outranks a lone bridge's onlap because two correlations were never anything but a band.

.. CG-EXPLANATION-END id=function:emitSubstrateBridges

