desktop.renderer.src.utils.partitionFillV2.emitIntervals
========================================================

.. CG-PAGE source=desktop/src/renderer/src/utils/partitionFillV2/emitIntervals.ts complete=true

*Source file:* ``desktop/src/renderer/src/utils/partitionFillV2/emitIntervals.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-44

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/emitIntervals.ts
   :language: typescript
   :lines: 1-44
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** This module is the seam-based interval tiler: it fills the space between two tie-anchored bands by laying the untied units of each interval side by side, meeting at a vertical seam. For each interval it draws a seam line at the meeting fraction (splitting the interval into a left-claim cell and a right-claim cell) and horizontal sub-seam lines from each column to the seam at every boundary between stacked units, so every untied unit gets its own tile. A one-sided interval is filled entirely by the present side. Important: this is the older seam engine, kept as a frozen fallback — the live app uses the newer terminations-first path (the hoist) instead, and never reaches this file.

**Why it is here.** The docstring records that this expresses v1's two-pieces-plus-filler tiling as arrangement curves, keeping v1's rules: a mismatched matrix bracketed above and below meets at the straight midpoint (the owner-validated no-auto-facies rule), otherwise the seam is thickness-weighted. A code note records the flag-ON product path routes through the termination sweep instead, so this file only runs as the flag-OFF safety line.

.. CG-EXPLANATION-END id=module-header

``const ELEV_EPS``
------------------

.. CG-BLOCK id=const:ELEV_EPS lines=45-46

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/emitIntervals.ts
   :language: typescript
   :lines: 45-46
   :lineno-match:

.. CG-EXPLANATION-START id=const:ELEV_EPS

**What this does.** The one-millionth-of-a-metre elevation slack, as elsewhere.

**Why it is here.** Floating-point noise must not read as a real elevation difference before the 1 mm snap.

.. CG-EXPLANATION-END id=const:ELEV_EPS

``const FRAC_EPS``
------------------

.. CG-BLOCK id=const:FRAC_EPS lines=47-49

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/emitIntervals.ts
   :language: typescript
   :lines: 47-49
   :lineno-match:

.. CG-EXPLANATION-START id=const:FRAC_EPS

**What this does.** A tiny fraction slack: a seam this close to a column edge is treated as a no-op.

**Why it is here.** A seam coinciding with a column edge has zero width and must be skipped rather than emitted.

.. CG-EXPLANATION-END id=const:FRAC_EPS

``interface TiedContacts``
--------------------------

.. CG-BLOCK id=interface:TiedContacts lines=50-60

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/emitIntervals.ts
   :language: typescript
   :lines: 50-60
   :lineno-match:

.. CG-EXPLANATION-START id=interface:TiedContacts

**What this does.** A type holding, per side, the sets of layer ids whose top contact and whose base contact are tied across the gap.

**Why it is here.** The tiler needs to know which of a boundary unit's two contacts is tied to decide onlap versus lens; this shape carries that answer as two id sets.

.. CG-EXPLANATION-END id=interface:TiedContacts

``interface Bracket``
---------------------

.. CG-BLOCK id=interface:Bracket lines=61-97

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/emitIntervals.ts
   :language: typescript
   :lines: 61-97
   :lineno-match:

.. CG-EXPLANATION-START id=interface:Bracket

**What this does.** A type for one interval bracket line: its elevation on the left column, its elevation on the right column, and an ``anchor`` flag saying whether it is a real tie or bridge (as opposed to the surface or the TD floor).

**Why it is here.** The docstring records that only an interval bounded by anchors on BOTH sides is bracketed in v1's sense, which is where the midpoint no-auto-facies seam fires; a surface- or floor-bounded pair keeps the thickness weight instead.

.. CG-EXPLANATION-END id=interface:Bracket

``function emitIntervalCurves``
-------------------------------

.. CG-BLOCK id=function:emitIntervalCurves lines=98-146

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/emitIntervals.ts
   :language: typescript
   :lines: 98-146
   :lineno-match:

.. CG-EXPLANATION-START id=function:emitIntervalCurves

**What this does.** The entry point for the seam tiler: for every gap it collects the matched-pair bands, computes the per-side 2/1/0 correlation counts once, and hands the gap to ``emitGapIntervals``. It sets up three id counters — ``close`` for the seam and sub-seam lines, ``flood`` for the lone-pinch wedge lines, and ``bandc`` for band-contour lines.

**Why it is here.** The docstring records this replaces the old per-unit triangle closings (which left the vacated space between apexes empty, the 274 above-TD holes) with a full tiling that meets at a seam, and that the correlation arithmetic is the shared source the conformance gate also consumes.

.. CG-EXPLANATION-END id=function:emitIntervalCurves

``function tiedContacts``
-------------------------

.. CG-BLOCK id=function:tiedContacts lines=147-179

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/emitIntervals.ts
   :language: typescript
   :lines: 147-179
   :lineno-match:

.. CG-EXPLANATION-START id=function:tiedContacts

**What this does.** Returns, per unit on one side, which of its two contacts (top or base) are tied toward the facing column, starting from the shared direct/derived tie flags and then adding the bridge-anchor extension: a deep-to-deep bridge carrying a unit's contact ties it exactly as a drawn correlation would.

**Why it is here.** The docstring records the base pass is the shared ``tiedFlags`` (the single source the conformance gate also uses, ruling 8c) and this function only layers the engine-only bridge extension on top, with the same top-is-also-the-unit-above's-base sharing.

.. CG-EXPLANATION-END id=function:tiedContacts

``function emitGapIntervals``
-----------------------------

.. CG-BLOCK id=function:emitGapIntervals lines=180-338

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/emitIntervals.ts
   :language: typescript
   :lines: 180-338
   :lineno-match:

.. CG-EXPLANATION-START id=function:emitGapIntervals

**What this does.** Tiles one gap. It computes each unit's tied contacts, marks the banded units, builds the ordered bracket list (the top-band line, every tie and bridge anchor, each band's own top and base contour, and the shallow-TD floor), de-duplicates it, then walks each neighbouring pair as an interval and calls ``tileInterval``. It also emits each band's contour lines and a floor line where a tiled interval or a band reaches the shallow TD.

**Why it is here.** The docstring cites the band-first tiling of design increment 7: adding each band's contour as a bracket confines a facing untied unit's fill to the residue outside the band, so it cannot overrun the band interior (the cs1bandauthority gate). It cites ruling 5-revised for the top bracket (each column's first litho boundary, not the ground surface, so the strip above the first data point stays empty) and owner Q3 for the floor (below the shallow TD stays empty).

.. CG-EXPLANATION-END id=function:emitGapIntervals

``function collectAnchorLines``
-------------------------------

.. CG-BLOCK id=function:collectAnchorLines lines=339-389

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/emitIntervals.ts
   :language: typescript
   :lines: 339-389
   :lineno-match:

.. CG-EXPLANATION-START id=function:collectAnchorLines

**What this does.** Collects every tie and bridge anchor line across the gap as bracket lines: each tie contributes its own left-to-right line, and each bridge that passes through the gap contributes a line reconstructed from the anchored contacts on both columns, paired deepest first.

**Why it is here.** The docstring notes the deepest bridge lines matter for the interval floor; the brackets are what divide the gap into intervals, so every anchor across the gap must appear as one.

.. CG-EXPLANATION-END id=function:collectAnchorLines

``function tileInterval``
-------------------------

.. CG-BLOCK id=function:tileInterval lines=390-529

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/emitIntervals.ts
   :language: typescript
   :lines: 390-529
   :lineno-match:

.. CG-EXPLANATION-START id=function:tileInterval

**What this does.** Tiles one interval. It first extracts enclosed minorities on each side (giving a lone side the facing column's full soil set as reach context), then routes a genuine lone-side pinch to ``routeLoneSidePinch`` and returns if handled. If a single left and single right unit share a soil it draws no seam (a geometric same-soil band). Otherwise it computes the meeting fraction, forces the seam strictly outside any lens apex, draws each extracted lens, and finally draws the seam and the horizontal sub-seams — anchoring the seam endpoints exactly onto the bracket lines so they attach as grid-exact junctions.

**Why it is here.** The docstring cites the enclosed-minority carve (v1's carveOverlays, done here by widening the cell so a 0.45 apex stays a hole inside its own matrix and never touches the seam — the mandatory LENS_MARGIN, because an apex exactly on the seam leaves a triangle uncovered). The seam-anchor step fixes the TS6 VEEN full-width band: a plain interpolation of a sloping bracket dangled after the grid snap, so the seam is placed on the exact collinear lattice point instead.

.. CG-EXPLANATION-END id=function:tileInterval

