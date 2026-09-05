desktop.renderer.src.utils.partitionFillV2.emitLenses
=====================================================

.. CG-PAGE source=desktop/src/renderer/src/utils/partitionFillV2/emitLenses.ts complete=true

*Source file:* ``desktop/src/renderer/src/utils/partitionFillV2/emitLenses.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-38

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/emitLenses.ts
   :language: typescript
   :lines: 1-38
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** This module draws the closing lines for enclosed lenses. An enclosed lens is a thin unit sitting inside one continuous matrix band on its own column; its two closing lines (top to apex, apex to base), together with the matrix edge over the lens's range, form a closed loop — a hole in the matrix band traced as its own face. The lens is drawn into whichever adjacent gap has room (into both by default), so its shape shows on both sides matching v1.

**Why it is here.** The docstring pins this to design section 2 (the uncorrelated same-lithology unit enclosed in its own lithology is still a closed loop, still a face), and notes per-body apex overrides and freedraw nodes replace the synthesized apex.

.. CG-EXPLANATION-END id=module-header

``interface LensLabel``
-----------------------

.. CG-BLOCK id=interface:LensLabel lines=39-57

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/emitLenses.ts
   :language: typescript
   :lines: 39-57
   :lineno-match:

.. CG-EXPLANATION-START id=interface:LensLabel

**What this does.** A type carrying the colour identity a synthesized lens line hands to the face it helps bound: its soil formation, its body id, and optionally the lens unit's own layer id when the label names a real drilled unit.

**Why it is here.** The docstring explains substrate and flood labels (inferred fill carrying a neighbour's soil) leave the layer id unset because fallback paint names no layer, whereas an enclosed lens sets it because its minority unit was spliced out of the column stack by the matrix merge, so no bounding column reference could otherwise resolve it.

.. CG-EXPLANATION-END id=interface:LensLabel

``function emitEnclosedLensCurves``
-----------------------------------

.. CG-BLOCK id=function:emitEnclosedLensCurves lines=58-92

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/emitLenses.ts
   :language: typescript
   :lines: 58-92
   :lineno-match:

.. CG-EXPLANATION-START id=function:emitEnclosedLensCurves

**What this does.** Draws the closing lines for every enclosed lens on every column, into each adjacent gap, and records in a shared map which soil each synthesized line carries. For each column it emits its lenses into the gap on the right (as that gap's left column) and the gap on the left (as its right column), each gated by whether the lens is allowed to emit into that gap.

**Why it is here.** The docstring notes the recorded label is what lets the traced lens FACE be coloured by the lens's own soil rather than the matrix edge that also bounds it.

.. CG-EXPLANATION-END id=function:emitEnclosedLensCurves

``function emitGapAllowed``
---------------------------

.. CG-BLOCK id=function:emitGapAllowed lines=93-122

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/emitLenses.ts
   :language: typescript
   :lines: 93-122
   :lineno-match:

.. CG-EXPLANATION-START id=function:emitGapAllowed

**What this does.** A yes/no test: may an enclosed lens draw its flank into a given gap? An ordinary lens with no gap restriction may emit into both adjacent gaps; a per-gap-restricted lens (the S22 sand) emits its flank only into its untied gap(s).

**Why it is here.** The docstring cites owner ruling 8v (2026-09-04, the edged minority): a same-soil-enclosed minority that is tied in one adjacent gap and untied in the other must lens in the untied gap and band in the tied gap, so in its tied gap the flank is suppressed and the ties plus the seed close a band by construction.

.. CG-EXPLANATION-END id=function:emitGapAllowed

``function shouldEmitLens``
---------------------------

.. CG-BLOCK id=function:shouldEmitLens lines=123-139

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/emitLenses.ts
   :language: typescript
   :lines: 123-139
   :lineno-match:

.. CG-EXPLANATION-START id=function:shouldEmitLens

**What this does.** A yes/no test that now always returns true: every enclosed lens gets its lens regardless of what the facing column carries.

**Why it is here.** The docstring cites owner ruling 8h phases 1-2 (emit unconditionally): the earlier gate wrongly dropped an interbed whose facing carries a different soil, leaving it absent. The 8b reach cap plus the own-column matrix continuity keep the emission hole-safe, so no facing-soil gate is needed.

.. CG-EXPLANATION-END id=function:shouldEmitLens

``function emitOne``
--------------------

.. CG-BLOCK id=function:emitOne lines=140-235

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/emitLenses.ts
   :language: typescript
   :lines: 140-235
   :lineno-match:

.. CG-EXPLANATION-START id=function:emitOne

**What this does.** Draws one enclosed lens into one gap. For a hand-drawn lens it emits the drawn polyline verbatim between the raw column corners. Otherwise it finds the termination target (the first column that actually read the lens's levels, crossing any blind column that read nothing there), and if that direction reads nothing it draws a flat continuation to the section edge; else it builds the lens diamond (top corner, apex, base corner) and draws the two flanks, dropping both if a flank collapses to a grid cell.

**Why it is here.** The docstring cites owner ruling of 2026-08-21 (a column that read nothing is not a boundary — it should be a continuous band starting from S7 but is interrupted at S7A's column): a lens crosses a blind column and pinches against the first column that did read it, the same law the corr-0 sweep applies. A hand-drawn lens is exempt from the auto-geometry corrections because explicit user nodes are never auto-corrected.

.. CG-EXPLANATION-END id=function:emitOne

``function enclosedLensDiamond``
--------------------------------

.. CG-BLOCK id=function:enclosedLensDiamond lines=236-322

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/emitLenses.ts
   :language: typescript
   :lines: 236-322
   :lineno-match:

.. CG-EXPLANATION-START id=function:enclosedLensDiamond

**What this does.** Computes an enclosed lens's diamond (top corner, apex, base corner) in one gap. It clamps the lens base up to the substrate floor, works out the apex fraction from the reach helper (or a user override), and pins the apex elevation to the lens's OWN mid-elevation — landing it on the floor only when that level is itself below the floor. This is extracted so the onlap-flank detour consumer can ride the exact same apex the emitter draws.

**Why it is here.** The docstring cites two owner rulings. The substrate-floor clamp (2026-07-26, CS1 g21) keeps a lens whose base dips just below the band floor a clean interior hole the detour can carve, so the drilled minority does not vanish. And (2026-08-19) the apex elevation stays the lens's own level, because taking it from the clamped extent moved the closing up and let the enclosing matrix paint under the lens over ground the test read as the lens itself.

.. CG-EXPLANATION-END id=function:enclosedLensDiamond

``function enclosingMatrixFid``
-------------------------------

.. CG-BLOCK id=function:enclosingMatrixFid lines=323-350

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/emitLenses.ts
   :language: typescript
   :lines: 323-350
   :lineno-match:

.. CG-EXPLANATION-START id=function:enclosingMatrixFid

**What this does.** Returns the soil that encloses an enclosed lens on its own column — the band that contains both the lens's top and its base elevation (a hair inside) — or nothing when the units above and below disagree. It falls back to the exact-contact neighbours for a lens the extraction left un-merged.

**Why it is here.** The docstring explains the extraction merges the matrix above and below into one continuous band, so the enclosing matrix is the band containing both lens contacts; this direct-adjacency read is enough for the 8b-rev test of whether the facing is the matrix or a competitor.

.. CG-EXPLANATION-END id=function:enclosingMatrixFid

``function gapLocalToDist``
---------------------------

.. CG-BLOCK id=function:gapLocalToDist lines=351-354

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/emitLenses.ts
   :language: typescript
   :lines: 351-354
   :lineno-match:

.. CG-EXPLANATION-START id=function:gapLocalToDist

**What this does.** Converts a gap-local fraction (0 at the left column, 1 at the right) into a distance from the emitting column, mirroring for a right-side emit.

**Why it is here.** A one-line helper so the apex placement reads the same for a left-column and a right-column emit.

.. CG-EXPLANATION-END id=function:gapLocalToDist

``interface OverrideShape``
---------------------------

.. CG-BLOCK id=interface:OverrideShape lines=355-364

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/emitLenses.ts
   :language: typescript
   :lines: 355-364
   :lineno-match:

.. CG-EXPLANATION-START id=interface:OverrideShape

**What this does.** A small type for a resolved apex override: an optional fraction and elevation, or a freedraw shape with upper and lower node lists.

**Why it is here.** The lookup returns either a simple moved apex or a full hand-drawn shape, so one type covers both.

.. CG-EXPLANATION-END id=interface:OverrideShape

``function lookupOverride``
---------------------------

.. CG-BLOCK id=function:lookupOverride lines=365-377

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/emitLenses.ts
   :language: typescript
   :lines: 365-377
   :lineno-match:

.. CG-EXPLANATION-START id=function:lookupOverride

**What this does.** Looks up a per-body-per-gap apex or freedraw override for an enclosed lens, returning the freedraw shape when node lists are present, else the simple fraction-and-elevation.

**Why it is here.** A single lookup shared by the emitter and the diamond helper so both consult the same override under the same key.

.. CG-EXPLANATION-END id=function:lookupOverride

