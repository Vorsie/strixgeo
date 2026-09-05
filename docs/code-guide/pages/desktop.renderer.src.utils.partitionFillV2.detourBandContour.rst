desktop.renderer.src.utils.partitionFillV2.detourBandContour
============================================================

.. CG-PAGE source=desktop/src/renderer/src/utils/partitionFillV2/detourBandContour.ts complete=true

*Source file:* ``desktop/src/renderer/src/utils/partitionFillV2/detourBandContour.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-48

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/detourBandContour.ts
   :language: typescript
   :lines: 1-48
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** This file reroutes a matched-pair band's base (or top) contour AROUND a zero-tie lens diamond it would otherwise cut through -- ruling 8s, 0.45 stands, the matrix detours. When a lens sits just below a band's near corner, the band's descending contour would dive across the lens's diamond and the two would double-cover a sliver; instead the band contour rides around the lens apex, wrapping the lens as a hole.

**Why it is here.** The docstring records that an earlier fix crushed the lens to fit below the contour, and ruling 8s deletes that crush: the lens keeps its full 0.45 reach and the BAND reroutes, so overlap is impossible by construction. It is the same detour mechanism as the onlap-flank detour, generalised from flanks to band contours, and it rides collinear with the exact emitted lens flanks (so the arrangement unions them). Pure module.

.. CG-EXPLANATION-END id=module-header

``interface Corr0Diamond``
--------------------------

.. CG-BLOCK id=interface:Corr0Diamond lines=49-83

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/detourBandContour.ts
   :language: typescript
   :lines: 49-83
   :lineno-match:

.. CG-EXPLANATION-START id=interface:Corr0Diamond

**What this does.** A type recording one zero-tie lens diamond exactly as its emitter drew it: the gap, the lens's top corner, its apex tip in the gap, and its base corner.

**Why it is here.** The docstring notes the diamonds are the exact ones the emitter drew (collected as drawn), so the detour rides collinear with the real lens line art rather than a re-derived approximation that could miss the emitted apex.

.. CG-EXPLANATION-END id=interface:Corr0Diamond

``function detourBandContourAroundLenses``
------------------------------------------

.. CG-BLOCK id=function:detourBandContourAroundLenses lines=84-125

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/detourBandContour.ts
   :language: typescript
   :lines: 84-125
   :lineno-match:

.. CG-EXPLANATION-START id=function:detourBandContourAroundLenses

**What this does.** Reroutes a straight band contour around every zero-tie diamond in its gap that it cuts through: for each diamond where the contour meets the boundary in exactly two places bracketing the apex, it replaces the straight span between them with cross-in, apex, cross-out. It returns the contour unchanged when it crosses none, and de-duplicates coincident vertices.

**Why it is here.** The docstring explains a cut-through is exactly two boundary meetings bracketing the apex -- each meeting either an interior flank crossing or a shared corner -- and the inserted ride is collinear with the emitted lens flanks, so the arrangement unions them and the lens closes as a hole while the band wraps it. Rides are inserted in ascending order along the contour so the rebuilt polyline stays monotone.

.. CG-EXPLANATION-END id=function:detourBandContourAroundLenses

``function dedupeConsecutive``
------------------------------

.. CG-BLOCK id=function:dedupeConsecutive lines=126-136

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/detourBandContour.ts
   :language: typescript
   :lines: 126-136
   :lineno-match:

.. CG-EXPLANATION-START id=function:dedupeConsecutive

**What this does.** Drops consecutive vertices that snap to the same 1 mm cell.

**Why it is here.** A shared-corner ride starts at the contour endpoint, which would otherwise repeat that point; dropping it keeps the polyline non-degenerate.

.. CG-EXPLANATION-END id=function:dedupeConsecutive

``const CORNER_SNAP_M``
-----------------------

.. CG-BLOCK id=const:CORNER_SNAP_M lines=137-145

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/detourBandContour.ts
   :language: typescript
   :lines: 137-145
   :lineno-match:

.. CG-EXPLANATION-START id=const:CORNER_SNAP_M

**What this does.** The 1 mm arrangement grid distance; a contour endpoint within this of a diamond corner shares it.

**Why it is here.** This is the tolerance for recognising a shared corner rather than an interior crossing.

.. CG-EXPLANATION-END id=const:CORNER_SNAP_M

``function diamondBoundaryMeetings``
------------------------------------

.. CG-BLOCK id=function:diamondBoundaryMeetings lines=146-198

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/detourBandContour.ts
   :language: typescript
   :lines: 146-198
   :lineno-match:

.. CG-EXPLANATION-START id=function:diamondBoundaryMeetings

**What this does.** Returns where the contour meets a diamond's boundary -- an interior crossing of the top or base flank, or a shared corner where the contour endpoint sits on the diamond's corner -- de-duplicated, returning 0, 1 or 2 meetings.

**Why it is here.** The docstring explains the band-base case shares the lens's top corner (the interbed's top is the band's base) rather than crossing it, so a shared corner counts as a meeting; the caller wraps only on exactly two meetings, and a meeting on the apex tip (a graze) is skipped.

.. CG-EXPLANATION-END id=function:diamondBoundaryMeetings

``function collectEnclosedLensDiamonds``
----------------------------------------

.. CG-BLOCK id=function:collectEnclosedLensDiamonds lines=199-250

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/detourBandContour.ts
   :language: typescript
   :lines: 199-250
   :lineno-match:

.. CG-EXPLANATION-START id=function:collectEnclosedLensDiamonds

**What this does.** Re-derives the ENCLOSED-lens diamonds (from the enclosed-lens emitter) as ``Corr0Diamond`` records and appends them to the shared collection, mirroring that emitter's per-column, per-gap loop exactly.

**Why it is here.** The docstring explains the enclosed-lens emitter runs AFTER the enclosing flood, so the flood cannot read its diamonds directly; this re-derives them from the same diamond call the emitter makes, so the flood can detour around them without a reorder. It mirrors the emitter's per-gap restriction (ruling 8v -- a per-gap lens is drawn only into its untied gaps) and skips freedraw-override lenses and sub-snap-degenerate diamonds so it never detours around a diamond the emitter did not draw.

.. CG-EXPLANATION-END id=function:collectEnclosedLensDiamonds

