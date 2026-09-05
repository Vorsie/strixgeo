desktop.renderer.src.utils.partitionFillV2.emitEnclosingFlood
=============================================================

.. CG-PAGE source=desktop/src/renderer/src/utils/partitionFillV2/emitEnclosingFlood.ts complete=true

*Source file:* ``desktop/src/renderer/src/utils/partitionFillV2/emitEnclosingFlood.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-51

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/emitEnclosingFlood.ts
   :language: typescript
   :lines: 1-51
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** This is a module (one source file) in the litho fill engine, and it does the FILL step. First, the ideas it rests on. The engine draws the cross-section as a planar arrangement: it lays down a set of lines (each one it calls a curve) in a space that runs along-section metres across and elevation in metres TAW up the page, then lets the closed tiles those lines bound (each tile is a face) become the coloured soil regions. Between two neighbouring investigation columns is a gap. A correlation, or tie, is a line the engineer drew joining one column's soil contact to the next. The engine's central idea is the 2/1/0 rule: a soil unit that has both its top and base contact tied across a gap runs straight across as a band, one tie makes it an onlap that follows the tie and pinches on the free side, and no ties make it a lens that closes inside the gap. Earlier passes have already drawn every such termination. What is left for this module is pure fill: for each gap, and for each vertical slice between two correlation lines (an interval), it lays down the interval's top and base bracket lines so the enclosing soil closes into a proper face, and, only where the two columns show DIFFERENT enclosing soils, a vertical seam down the middle so each half is coloured from its own column. The lines this file writes carry no colour of their own; the column edges do the colouring. The import lines at the top pull in the helper modules it leans on (the band collector, the free-draw bend and declared-meeting helpers, the corr-0 lens-diamond detour, and the shared data shapes).

**Why it is here.** The module docstring pins the design to owner ruling 8f (2026-07-15): once the model is correlated correctly you can simply fill the void with the dominant lithology between correlations. The docstring also records why this is a full rebuild (the MODE-B version): an earlier version emitted no bracket line when both columns shared one enclosing soil, trusting the pre-existing column edges to close the tile; but the termination pass carves those tiles, so their top and base edges were left open and 560 holes appeared. So this version ALWAYS emits each interval's top and base bracket lines, and the column edges still stamp the colour.

.. CG-EXPLANATION-END id=module-header

``const ELEV_EPS``
------------------

.. CG-BLOCK id=const:ELEV_EPS lines=52-54

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/emitEnclosingFlood.ts
   :language: typescript
   :lines: 52-54
   :lineno-match:

.. CG-EXPLANATION-START id=const:ELEV_EPS

**What this does.** A constant (a fixed, named number): one millionth of a metre, used as a slack when two elevations are compared for equality.

**Why it is here.** Elevation comparisons happen before the engine snaps every point to its 1 mm grid, so a hair of floating-point noise must not read as a real difference between two contacts.

.. CG-EXPLANATION-END id=const:ELEV_EPS

``interface FloodBracket``
--------------------------

.. CG-BLOCK id=interface:FloodBracket lines=55-74

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/emitEnclosingFlood.ts
   :language: typescript
   :lines: 55-74
   :lineno-match:

.. CG-EXPLANATION-START id=interface:FloodBracket

**What this does.** A type (a named shape for a piece of data): one bracket line running across a gap, described by its elevation on the left column, its elevation on the right column, and a ``kind`` tag saying where the line came from — the top-band line, a tie, a band edge, or the shallow-TD floor.

**Why it is here.** The docstring records that ``kind`` decides whether a midpoint seam is drawn as visible line art or kept as an invisible fill scaffold (owner dogfeed 2026-07-20, on 10/170-s8: only the ruled top-band band pair's seam is real line art; every other mismatched closure keeps the invisible ``flood`` id, so the paint tool does not draw it).

.. CG-EXPLANATION-END id=interface:FloodBracket

``function tieLandsOn``
-----------------------

.. CG-BLOCK id=function:tieLandsOn lines=75-109

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/emitEnclosingFlood.ts
   :language: typescript
   :lines: 75-109
   :lineno-match:

.. CG-EXPLANATION-START id=function:tieLandsOn

**What this does.** A small yes/no function: does a given tie touch unit number ``ui`` on the named side's column? A tie on a unit's top contact is also the base of the unit above it, so it can land on both.

**Why it is here.** The docstring notes this mirrors the same top/base sharing rule the engine's correlation arithmetic uses everywhere, so that declared to meet means exactly the same thing here as it does in the rest of the engine.

.. CG-EXPLANATION-END id=function:tieLandsOn

``function emitEnclosingFlood``
-------------------------------

.. CG-BLOCK id=function:emitEnclosingFlood lines=110-146

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/emitEnclosingFlood.ts
   :language: typescript
   :lines: 110-146
   :lineno-match:

.. CG-EXPLANATION-START id=function:emitEnclosingFlood

**What this does.** The entry point. It walks every gap in the section, collects that gap's matched-pair bands and any free-draw contact bends, and hands each gap to ``emitGapFlood``. It also sets up the three id counters that name the lines this file writes — a ``flood`` counter for the invisible fill scaffold, a ``bandc`` counter for band-authority contour lines, and a ``bandseam`` counter for the one ruled visible midpoint seam.

**Why it is here.** The docstring records that band contours still emit so a matched-pair band face closes, and that the ruled mismatched-first-unit midpoint seam (owner ruling 8d, 2026-07-20) is real line art: its ``bandseam`` prefix routes it to a paint-tool role so it is drawn, whereas a ``flood`` prefix would mark it as fill scaffold that paint would leak across the sand/clay boundary.

.. CG-EXPLANATION-END id=function:emitEnclosingFlood

``function emitGapFlood``
-------------------------

.. CG-BLOCK id=function:emitGapFlood lines=147-281

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/emitEnclosingFlood.ts
   :language: typescript
   :lines: 147-281
   :lineno-match:

.. CG-EXPLANATION-START id=function:emitGapFlood

**What this does.** Fills one gap. It works out the shallow TD (the higher of the two columns' deepest drilled bases), draws each band's own top and base contour line but ONLY where a real tie runs along it, adds a special contour for a hand-grabbed clay base, then builds the ordered list of interval brackets — the top-band line, every tie line, every band edge, and the TD floor — de-duplicates them, and walks each neighbouring pair as one interval, calling ``closeInterval``. Finally it closes the fill from below with a flat line along the shallow TD, because the space under the TD belongs to the deep-to-deep substrate pass, not to this fill.

**Why it is here.** The dense comments cite owner ruling 8l (corr is the literal count): a band built from a single tie is not authoritative on the contact that tie does not cover, so a band-authority contour is emitted only where a real gap tie actually rides it, and a promotion contour is dropped so the emergent band forms by paint-bucket fill instead. Contours are clamped above the TD because the substrate owns the deep zone and a duplicate contour there would sliver the deep band.

.. CG-EXPLANATION-END id=function:emitGapFlood

``function emitBandContourWithDetour``
--------------------------------------

.. CG-BLOCK id=function:emitBandContourWithDetour lines=282-321

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/emitEnclosingFlood.ts
   :language: typescript
   :lines: 282-321
   :lineno-match:

.. CG-EXPLANATION-START id=function:emitBandContourWithDetour

**What this does.** Draws one band's top or base contour line, clipped to stay above the shallow TD, and if a no-tie (corr-0) lens diamond sits in the contour's path it routes the line around that diamond's apex rather than cutting straight through it.

**Why it is here.** The docstring cites owner ruling 8s stage B (2026-07-19): rather than crush a lens that pokes into a descending band base, the contour detours around it so the lens closes cleanly as a hole inside the band face and overlap between them is impossible by construction. A hand-drawn free-draw bend on the same contact takes precedence over the detour (Item A); with no override the contour is byte-identical to before.

.. CG-EXPLANATION-END id=function:emitBandContourWithDetour

``function closeInterval``
--------------------------

.. CG-BLOCK id=function:closeInterval lines=322-427

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/emitEnclosingFlood.ts
   :language: typescript
   :lines: 322-427
   :lineno-match:

.. CG-EXPLANATION-START id=function:closeInterval

**What this does.** Closes ONE interval between two bracket lines. It reads the enclosing soil on each column at the interval's mid-elevation. If both sides are the same soil, or either is a band formation, it draws nothing and the interval becomes one full-width face. If the two sides are DIFFERENT soils it draws a vertical seam down the interval — but only when a meeting between the two masses was actually declared (a correlation ties them, or it is the ruled top-band pair, or every mass on both columns closes inside this window), placing the seam at the midpoint (or at a hand-moved fraction).

**Why it is here.** The long comments record the rule the seam obeys: a mid-gap fence stands only where the two masses were DECLARED to meet, never where an interval was merely left over. The owner ruled the keep case (2026-08-19, MD sand over MF clay with a top and bottom tie), the second justification where both packages close at the middle (2026-08-24: yes in this case I would rather have a vertical line), and the drop case on CS1 gap 7 (the loose sand should onlap, the clay should fill the gaps) — where nobody declared a meeting the 2/1/0 terminations already drew the real boundary and the remaining mass floods around them. This is the no-auto-facies rule.

.. CG-EXPLANATION-END id=function:closeInterval

``function enclosingFormationAt``
---------------------------------

.. CG-BLOCK id=function:enclosingFormationAt lines=428-439

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/emitEnclosingFlood.ts
   :language: typescript
   :lines: 428-439
   :lineno-match:

.. CG-EXPLANATION-START id=function:enclosingFormationAt

**What this does.** Given a column and an elevation, returns the unit whose top-to-base span contains that elevation — the lateral matrix soil that floods this interval on that side — or nothing when no unit spans it (below the TD or above the surface).

**Why it is here.** ``closeInterval`` needs to know which soil encloses each side of the interval to decide whether the two sides match; this small helper answers that from the raw column stack.

.. CG-EXPLANATION-END id=function:enclosingFormationAt

