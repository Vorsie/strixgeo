desktop.renderer.src.utils.partitionFillV2.emitBands
====================================================

.. CG-PAGE source=desktop/src/renderer/src/utils/partitionFillV2/emitBands.ts complete=true

*Source file:* ``desktop/src/renderer/src/utils/partitionFillV2/emitBands.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-36

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/emitBands.ts
   :language: typescript
   :lines: 1-36
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** This file emits the boundary curves of a matched-pair band -- two facing units of the SAME soil joined by an adjacent top-top or base-base tie. It traces each band's top AND base contour as closing curves so the band face closes by construction, and reports each band's per-column span so the interval tiler can EXCLUDE it -- a neighbouring fill then stops at the band boundary instead of leaking through it.

**Why it is here.** The docstring records the defect it fixes (the band-authority defect, CS1 gaps 11 and 13): before this, a top-tie band whose base was each unit's own untied contact left its base open in the arrangement, so a facing untied unit's fill leaked up into the band's interior. The contour ids start ``bandc`` -- counted as neither a tie nor a closing by the labeller -- so the band still classifies as a band and an adjacent fill face abutting a contour is not mis-promoted to an onlap. Pure module.

.. CG-EXPLANATION-END id=module-header

``const ELEV_EPS``
------------------

.. CG-BLOCK id=const:ELEV_EPS lines=37-46

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/emitBands.ts
   :language: typescript
   :lines: 37-46
   :lineno-match:

.. CG-EXPLANATION-START id=const:ELEV_EPS

**What this does.** A tiny elevation tolerance for comparisons before the snap.

**Why it is here.** Standard hair's-width margin.

.. CG-EXPLANATION-END id=const:ELEV_EPS

``interface GapBand``
---------------------

.. CG-BLOCK id=interface:GapBand lines=47-82

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/emitBands.ts
   :language: typescript
   :lines: 47-82
   :lineno-match:

.. CG-EXPLANATION-START id=interface:GapBand

**What this does.** A type for one matched-pair band across a gap: the two units' indices, each side's own top and base elevation, and the shared soil.

**Why it is here.** It carries the band's full geometry so its top and base contours can be drawn and its span excluded from tiling.

.. CG-EXPLANATION-END id=interface:GapBand

``function collectGapBands``
----------------------------

.. CG-BLOCK id=function:collectGapBands lines=83-136

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/emitBands.ts
   :language: typescript
   :lines: 83-136
   :lineno-match:

.. CG-EXPLANATION-START id=function:collectGapBands

**What this does.** Returns the matched-pair bands in a gap: for each active tie that joins the same side on both ends between two same-soil units, it records a band with each unit's own span, de-duplicated by unit-pair.

**Why it is here.** The docstring notes a mixed top-base tie is an onlap or substrate anchor, not a symmetric band, so it is excluded; the band's span is each unit's own top-to-base extent.

.. CG-EXPLANATION-END id=function:collectGapBands

``function emitBandContours``
-----------------------------

.. CG-BLOCK id=function:emitBandContours lines=137-187

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/emitBands.ts
   :language: typescript
   :lines: 137-187
   :lineno-match:

.. CG-EXPLANATION-START id=function:emitBandContours

**What this does.** Emits each band's top and base contour as a straight closing curve across the gap.

**Why it is here.** The docstring notes this is the same shape v1's band quad used for its top and base, and that emitting both contours (even one coinciding with a tie) keeps the band self-contained regardless of which contact carries the tie -- a duplicate segment is harmless because the DCEL merges coincident edges.

.. CG-EXPLANATION-END id=function:emitBandContours

``function emitBandContourCurve``
---------------------------------

.. CG-BLOCK id=function:emitBandContourCurve lines=188-209

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/emitBands.ts
   :language: typescript
   :lines: 188-209
   :lineno-match:

.. CG-EXPLANATION-START id=function:emitBandContourCurve

**What this does.** Emits one band contour (top or base) as a closing curve, clamped to the portion ABOVE the shallow TD.

**Why it is here.** The docstring explains the sub-TD zone is owned by the deep-to-deep substrate, and a band contour duplicated there splits the deep band into overlapping slivers (a measured regression); a contour straddling the TD is clipped to the crossing so the above-TD part still closes the band.

.. CG-EXPLANATION-END id=function:emitBandContourCurve

``function clipBandContourToTD``
--------------------------------

.. CG-BLOCK id=function:clipBandContourToTD lines=210-266

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/emitBands.ts
   :language: typescript
   :lines: 210-266
   :lineno-match:

.. CG-EXPLANATION-START id=function:clipBandContourToTD

**What this does.** Clips a straight band contour to the part above the shallow TD, returning its two endpoints, or nothing when it is wholly at or below the TD or degenerate.

**Why it is here.** The docstring notes it was extracted as a second copy because the ruling-8s band-contour detour needs the SAME clipped line to reroute around a lens diamond; it returns a fresh array so the detour can use it without mutating the source.

.. CG-EXPLANATION-END id=function:clipBandContourToTD

``function untiedUnitsInInterval``
----------------------------------

.. CG-BLOCK id=function:untiedUnitsInInterval lines=267-322

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/emitBands.ts
   :language: typescript
   :lines: 267-322
   :lineno-match:

.. CG-EXPLANATION-START id=function:untiedUnitsInInterval

**What this does.** Returns the untied units of one column overlapping an interval, clamped to it -- excluding fully-banded units (both contacts tied) and matched-pair band members.

**Why it is here.** The docstring explains the band-first rule: a matched-pair member is excluded wholesale (even if band-tied on only one contact) so a facing untied unit cannot overrun the band's interior; the band's own contours and the interval brackets confine any facing fill.

.. CG-EXPLANATION-END id=function:untiedUnitsInInterval

``function meetFraction``
-------------------------

.. CG-BLOCK id=function:meetFraction lines=323-365

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/emitBands.ts
   :language: typescript
   :lines: 323-365
   :lineno-match:

.. CG-EXPLANATION-START id=function:meetFraction

**What this does.** Returns where two facing sides' units meet across an interval: a lone side fills fully (1 or 0), a mismatched single-versus-single bracketed pair meets at the midpoint 0.5, otherwise a thickness-weighted fraction.

**Why it is here.** The docstring reproduces v1's meeting-fraction rule and pins that the weight uses each unit's OWN full thickness, not the interval-clamped span, because clamping moved the seam off v1's placement (a measured drift); a genuine lone-side pinch is intercepted upstream before this is consulted.

.. CG-EXPLANATION-END id=function:meetFraction

``function emitSideSubSeams``
-----------------------------

.. CG-BLOCK id=function:emitSideSubSeams lines=366-400

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/emitBands.ts
   :language: typescript
   :lines: 366-400
   :lineno-match:

.. CG-EXPLANATION-START id=function:emitSideSubSeams

**What this does.** Emits the internal divider curves between one side's stacked units in a tiled interval, each running from the column edge at the boundary between two units to the corresponding point on the seam, so each stacked unit gets its own face.

**Why it is here.** The docstring notes the seam far endpoint lands exactly on the (possibly slanted) seam polyline for a clean T-junction, and a lone-opposite side (seam coincident with the column) has no cell to sub-divide.

.. CG-EXPLANATION-END id=function:emitSideSubSeams

