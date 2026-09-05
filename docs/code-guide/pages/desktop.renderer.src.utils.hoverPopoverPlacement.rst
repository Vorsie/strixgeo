desktop.renderer.src.utils.hoverPopoverPlacement
================================================

.. CG-PAGE source=desktop/src/renderer/src/utils/hoverPopoverPlacement.ts complete=true

*Source file:* ``desktop/src/renderer/src/utils/hoverPopoverPlacement.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-15

.. literalinclude:: ../../../desktop/src/renderer/src/utils/hoverPopoverPlacement.ts
   :language: typescript
   :lines: 1-15
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** This file holds the pure placement maths for a small card that follows the cursor on hover. The comment explains the goals: the card sits just off the hovered element so it does not cover it, never hangs off the panel it lives in, and near the right edge flips to the other side of the anchor rather than sliding — because sliding would park the card on top of what the user is pointing at.

**Why it is here.** The comment records the coordinate convention that makes the maths simple: everything is in container-local pixels, and because the section drawing surface uses a view box matched one-to-one to its pixel size, a drawing position and an absolutely-positioned HTML offset inside the same container are the same number. This is a *pure function* module — placement in, coordinates out, no drawing — so it can be tested directly.

.. CG-EXPLANATION-END id=module-header

``interface PopoverPlacementInput``
-----------------------------------

.. CG-BLOCK id=interface:PopoverPlacementInput lines=16-35

.. literalinclude:: ../../../desktop/src/renderer/src/utils/hoverPopoverPlacement.ts
   :language: typescript
   :lines: 16-35
   :lineno-match:

.. CG-EXPLANATION-START id=interface:PopoverPlacementInput

**What this does.** Describes the inputs: where the hovered element is, how big the card is, how big the panel is, and optional spacing values for the gap to the anchor and the minimum gap to the panel edges.

**Why it is here.** The placement needs the anchor position, both sizes and the spacing to decide where the card fits, so all of it is gathered into one input shape with sensible optional defaults.

.. CG-EXPLANATION-END id=interface:PopoverPlacementInput

``interface PopoverPlacement``
------------------------------

.. CG-BLOCK id=interface:PopoverPlacement lines=36-42

.. literalinclude:: ../../../desktop/src/renderer/src/utils/hoverPopoverPlacement.ts
   :language: typescript
   :lines: 36-42
   :lineno-match:

.. CG-EXPLANATION-START id=interface:PopoverPlacement

**What this does.** Describes the result: the card's top-left corner as left and top pixel values.

**Why it is here.** The caller positions the card by its top-left corner, so that is exactly what the function returns.

.. CG-EXPLANATION-END id=interface:PopoverPlacement

``const DEFAULT_OFFSET``
------------------------

.. CG-BLOCK id=const:DEFAULT_OFFSET lines=43-43

.. literalinclude:: ../../../desktop/src/renderer/src/utils/hoverPopoverPlacement.ts
   :language: typescript
   :lines: 43-43
   :lineno-match:

.. CG-EXPLANATION-START id=const:DEFAULT_OFFSET

**What this does.** The default gap between the anchor and the card: 14 pixels.

**Why it is here.** A small standing gap so the card sits clearly off the hovered element without drifting too far from it.

.. CG-EXPLANATION-END id=const:DEFAULT_OFFSET

``const DEFAULT_MARGIN``
------------------------

.. CG-BLOCK id=const:DEFAULT_MARGIN lines=44-51

.. literalinclude:: ../../../desktop/src/renderer/src/utils/hoverPopoverPlacement.ts
   :language: typescript
   :lines: 44-51
   :lineno-match:

.. CG-EXPLANATION-START id=const:DEFAULT_MARGIN

**What this does.** The default minimum gap between the card and the panel edges: 4 pixels.

**Why it is here.** A small margin so the card never sits flush against the panel border.

.. CG-EXPLANATION-END id=const:DEFAULT_MARGIN

``function clampPopoverPosition``
---------------------------------

.. CG-BLOCK id=function:clampPopoverPosition lines=52-78

.. literalinclude:: ../../../desktop/src/renderer/src/utils/hoverPopoverPlacement.ts
   :language: typescript
   :lines: 52-78
   :lineno-match:

.. CG-EXPLANATION-START id=function:clampPopoverPosition

**What this does.** Places the card near the anchor without letting it leave the panel. It first tries the right of the anchor, and flips to the left when the card would spill past the panel's right edge; it puts the top just below the anchor; then it clamps both left and top so the card stays inside the panel margins.

**Why it is here.** The comments record two deliberate choices: it flips sides rather than sliding because sliding would cover the very element being pointed at, and in the final clamp the lower-bound wins over the upper bound so a card larger than the panel pins to the top-left margin rather than to a negative off-screen coordinate.

.. CG-EXPLANATION-END id=function:clampPopoverPosition

