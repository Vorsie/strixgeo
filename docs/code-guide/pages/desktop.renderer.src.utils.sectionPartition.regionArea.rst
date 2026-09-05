desktop.renderer.src.utils.sectionPartition.regionArea
======================================================

.. CG-PAGE source=desktop/src/renderer/src/utils/sectionPartition/regionArea.ts complete=true

*Source file:* ``desktop/src/renderer/src/utils/sectionPartition/regionArea.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-25

.. literalinclude:: ../../../desktop/src/renderer/src/utils/sectionPartition/regionArea.ts
   :language: typescript
   :lines: 1-25
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Opens the file with the one shoelace-area helper (the shoelace formula computes a polygon's area from its corner coordinates) and its two wrappers. It imports the point and region shapes.

**Why it is here.** The comment records it was extracted 2026-08-26 when the gapless gate needed a FOURTH copy — past CLAUDE.md's extract-on-the-second-copy rule; three private copies already existed, differing only in whether the caller had the gap's width in hand. It lives next to ``SectionRegion`` rather than in the geotech package because litho code is just as likely to want a region's area.

.. CG-EXPLANATION-END id=module-header

``function ringAreaM2``
-----------------------

.. CG-BLOCK id=function:ringAreaM2 lines=26-36

.. literalinclude:: ../../../desktop/src/renderer/src/utils/sectionPartition/regionArea.ts
   :language: typescript
   :lines: 26-36
   :lineno-match:

.. CG-EXPLANATION-START id=function:ringAreaM2

**What this does.** Computes a closed ring's area with the shoelace formula and scales it to square metres. The ring is in fraction-by-elevation space, so the raw result is a fraction-times-metre quantity; multiplying by the gap's width in metres turns it into an area.

**Why it is here.** The shoelace sum is exact for a simple polygon, and the single width multiply is the one step that converts the section's fraction axis into real metres. Naming it once removes the four near-duplicate copies the header describes.

.. CG-EXPLANATION-END id=function:ringAreaM2

``function regionAreaM2``
-------------------------

.. CG-BLOCK id=function:regionAreaM2 lines=37-47

.. literalinclude:: ../../../desktop/src/renderer/src/utils/sectionPartition/regionArea.ts
   :language: typescript
   :lines: 37-47
   :lineno-match:

.. CG-EXPLANATION-START id=function:regionAreaM2

**What this does.** A thin wrapper that measures a region's polygon in square metres when the caller already knows the gap's width.

**Why it is here.** Most callers hold the width directly, so this saves them re-deriving it; it just forwards the polygon and width to ``ringAreaM2``.

.. CG-EXPLANATION-END id=function:regionAreaM2

``function regionAreaM2FromAlongM``
-----------------------------------

.. CG-BLOCK id=function:regionAreaM2FromAlongM lines=48-55

.. literalinclude:: ../../../desktop/src/renderer/src/utils/sectionPartition/regionArea.ts
   :language: typescript
   :lines: 48-55
   :lineno-match:

.. CG-EXPLANATION-START id=function:regionAreaM2FromAlongM

**What this does.** Measures a region's area when the caller instead has the along-section metre positions: it derives the gap's width from the two column positions around the region's gap, and returns 0 if that width is not a finite number.

**Why it is here.** The docstring records the 0-return guards an out-of-range gap index so it cannot throw — the guard the original ``familyFill`` copy carried, preserved verbatim when the copies were merged.

.. CG-EXPLANATION-END id=function:regionAreaM2FromAlongM

