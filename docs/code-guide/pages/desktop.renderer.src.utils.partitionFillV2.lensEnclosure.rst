desktop.renderer.src.utils.partitionFillV2.lensEnclosure
========================================================

.. CG-PAGE source=desktop/src/renderer/src/utils/partitionFillV2/lensEnclosure.ts complete=true

*Source file:* ``desktop/src/renderer/src/utils/partitionFillV2/lensEnclosure.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-55

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/lensEnclosure.ts
   :language: typescript
   :lines: 1-55
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** This module finds the enclosing soil of a no-tie lens by reading the lens's OWN column, not the far facing column. A lens pinches inside its enclosing soil, which flows around the pinch and reconnects; the space past the apex belongs to that soil. This walks the own-column stack outward from the lens and finds the soil that appears nearest on both the up-walk and the down-walk — the one that wraps the whole pinch.

**Why it is here.** The docstring cites owner ruling 8n(b) (2026-07-18, on x=646.74): the sand filling past col18's thin SILT/VEEN lens apexes was wrong because it sampled col19's ZAND 78 m away — it should be silt and veen in the lens and there is no sand adjacency. When the up-walk and down-walk share no soil (the 8g same-litho invariant fails) it returns nothing and the caller must ask the owner rather than invent a preference.

.. CG-EXPLANATION-END id=module-header

``function lensEnclosingMatrix``
--------------------------------

.. CG-BLOCK id=function:lensEnclosingMatrix lines=56-88

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/lensEnclosure.ts
   :language: typescript
   :lines: 56-88
   :lineno-match:

.. CG-EXPLANATION-START id=function:lensEnclosingMatrix

**What this does.** Returns the enclosing-matrix soil of the lens at a given unit index, read from the lens's own column. It records the nearest occurrence of each soil above the lens, then walks below and returns the soil with the smallest combined up-and-down distance — the shared enclosure — or nothing when the two walks share no soil.

**Why it is here.** The docstring records this walks past sibling minorities in the same pinching stack to the soil that wraps the whole pinch (both flood wedges carry this one label because the wrap is one soil by the 8g closed-shape invariant), and returns nothing at the genuine rule gap where no common enclosure exists — the ask-first case.

.. CG-EXPLANATION-END id=function:lensEnclosingMatrix

