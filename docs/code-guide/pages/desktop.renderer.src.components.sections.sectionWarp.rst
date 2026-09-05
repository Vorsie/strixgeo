desktop.renderer.src.components.sections.sectionWarp
====================================================

.. CG-PAGE source=desktop/src/renderer/src/components/sections/sectionWarp.ts complete=true

*Source file:* ``desktop/src/renderer/src/components/sections/sectionWarp.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-20

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/sectionWarp.ts
   :language: typescript
   :lines: 1-20
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The section's horizontal warp and its inverse: the map between along-section distance (real metres from the start of the line) and screen X (pixels), once the Spacing slider and the collision nudge have moved each column off its true projected position. The columns are NOT drawn at their true metre spacing; a user-adjustable spacing warps the horizontal axis.

**Why it is here.** The docstring is the trap warning. The forward map places along-distance content at the screen X interpolated through each column's anchor pair of true along-distance and actual drawn X. The inverse answers the wheel-zoom question the reverse way: the cursor is at pixel px, which along-distance is drawn there. Without this warp-aware inverse, zoom-to-cursor would invert the plain straight-line map instead and anchor on the wrong feature whenever spacing is below one or columns collide, so the content drifts out from under the mouse. This is the section-view spacing trap that has bitten three times, and the standing rule is that EVERY overlay must use the warp-aware transform, never the raw one.

.. CG-EXPLANATION-END id=module-header

``interface WarpAnchor``
------------------------

.. CG-BLOCK id=interface:WarpAnchor lines=21-42

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/sectionWarp.ts
   :language: typescript
   :lines: 21-42
   :lineno-match:

.. CG-EXPLANATION-START id=interface:WarpAnchor

**What this does.** One placed column's warp anchor: its true along-distance in world metres and the screen X it was actually drawn at (its nudged X). The comment after is the lead-in to the forward map.

**Why it is here.** The pair of true along-distance and actual drawn X is exactly what the piecewise map interpolates through to place any content between the columns.

.. CG-EXPLANATION-END id=interface:WarpAnchor

``function warpedAlongToScreenX``
---------------------------------

.. CG-BLOCK id=function:warpedAlongToScreenX lines=43-89

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/sectionWarp.ts
   :language: typescript
   :lines: 43-89
   :lineno-match:

.. CG-EXPLANATION-START id=function:warpedAlongToScreenX

**What this does.** The forward map: given an along-distance and the sorted anchors, it returns the screen X. Before the first column and after the last it extrapolates at the true scale; inside the range it finds the segment whose along-range contains the value and interpolates the drawn X linearly between the two anchors.

**Why it is here.** This is the exact map ``SectionPanel`` renders through (as ``warpedXToScreen``), so every overlay lands on the same warped position. A guard against two tests projected to the same along-distance falls back to the first anchor's X rather than dividing by zero.

.. CG-EXPLANATION-END id=function:warpedAlongToScreenX

``function warpedScreenXToAlong``
---------------------------------

.. CG-BLOCK id=function:warpedScreenXToAlong lines=90-120

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/sectionWarp.ts
   :language: typescript
   :lines: 90-120
   :lineno-match:

.. CG-EXPLANATION-START id=function:warpedScreenXToAlong

**What this does.** The inverse: given a cursor pixel and the anchors, it returns the along-distance drawn there, mirroring the forward map exactly, extrapolating outside the anchor range and interpolating within it.

**Why it is here.** The round trip must be stable so the wheel zoom pins the cursor's world point. The drawn X is non-decreasing because the packed layout preserves left-to-right order, which is what makes the map invertible; a guard against two columns nudged to the same X falls back to one anchor's along-distance rather than dividing by zero.

.. CG-EXPLANATION-END id=function:warpedScreenXToAlong

