desktop.renderer.src.components.sections.HoverReadoutCard
=========================================================

.. CG-PAGE source=desktop/src/renderer/src/components/sections/HoverReadoutCard.tsx complete=true

*Source file:* ``desktop/src/renderer/src/components/sections/HoverReadoutCard.tsx``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-25

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/HoverReadoutCard.tsx
   :language: tsx
   :lines: 1-25
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The top of the file for the small floating card the section's hover overlays use to show depth, elevation, and CPT values. It has no imports beyond what the render needs; the comment sets out the exact render contract.

**Why it is here.** It was originally inlined in the CPT pick affordance, and the borehole focus-mode readout became a second user — the 'extract on the second copy' rule — so the card geometry and its position clamping live here as one source of truth. The card is anchored so it is vertically centred on the cursor, clamped so it never escapes the canvas, and auto-sizes to its line count so the same card serves a two-line borehole readout and a four-line CPT readout.

.. CG-EXPLANATION-END id=module-header

``interface HoverLine``
-----------------------

.. CG-BLOCK id=interface:HoverLine lines=26-35

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/HoverReadoutCard.tsx
   :language: tsx
   :lines: 26-35
   :lineno-match:

.. CG-EXPLANATION-START id=interface:HoverLine

**What this does.** The shape of one line in the card: the pre-formatted text and an optional text colour override.

**Why it is here.** The card does not know what 'depth' or 'qc' means — the caller pre-formats each line — so a per-line colour override lets the CPT card colour qc and Rf to make the values pop, while the card stays ignorant of the content.

.. CG-EXPLANATION-END id=interface:HoverLine

``interface Props``
-------------------

.. CG-BLOCK id=interface:Props lines=36-49

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/HoverReadoutCard.tsx
   :language: tsx
   :lines: 36-49
   :lineno-match:

.. CG-EXPLANATION-START id=interface:Props

**What this does.** The inputs: the card's top-left X, the Y it centres on, the lines to render, the plot's top and bottom bounds, and an optional width.

**Why it is here.** The Y and the plot bounds together let the card clamp itself inside the canvas; the line count drives the height; the width defaults to the CPT card's width so callers rarely set it.

.. CG-EXPLANATION-END id=interface:Props

``const DEFAULT_TEXT_COLOR``
----------------------------

.. CG-BLOCK id=const:DEFAULT_TEXT_COLOR lines=50-50

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/HoverReadoutCard.tsx
   :language: tsx
   :lines: 50-50
   :lineno-match:

.. CG-EXPLANATION-START id=const:DEFAULT_TEXT_COLOR

**What this does.** A constant — the default line text colour, a dark slate.

**Why it is here.** It is the fallback colour a line uses when it does not override it.

.. CG-EXPLANATION-END id=const:DEFAULT_TEXT_COLOR

``const PADDING_TOP``
---------------------

.. CG-BLOCK id=const:PADDING_TOP lines=51-51

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/HoverReadoutCard.tsx
   :language: tsx
   :lines: 51-51
   :lineno-match:

.. CG-EXPLANATION-START id=const:PADDING_TOP

**What this does.** A constant — the space above the first line of text.

**Why it is here.** It is calibrated for the card's 9-pixel text so the first line's baseline sits right.

.. CG-EXPLANATION-END id=const:PADDING_TOP

``const LINE_HEIGHT``
---------------------

.. CG-BLOCK id=const:LINE_HEIGHT lines=52-52

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/HoverReadoutCard.tsx
   :language: tsx
   :lines: 52-52
   :lineno-match:

.. CG-EXPLANATION-START id=const:LINE_HEIGHT

**What this does.** A constant — the vertical spacing between lines.

**Why it is here.** It is calibrated for the 9-pixel text so lines stack evenly and the card height scales linearly with the line count.

.. CG-EXPLANATION-END id=const:LINE_HEIGHT

``const PADDING_BOTTOM``
------------------------

.. CG-BLOCK id=const:PADDING_BOTTOM lines=53-54

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/HoverReadoutCard.tsx
   :language: tsx
   :lines: 53-54
   :lineno-match:

.. CG-EXPLANATION-START id=const:PADDING_BOTTOM

**What this does.** A constant — the space below the last line.

**Why it is here.** A small bottom pad so the last line does not touch the card edge.

.. CG-EXPLANATION-END id=const:PADDING_BOTTOM

``function HoverReadoutCard``
-----------------------------

.. CG-BLOCK id=function:HoverReadoutCard lines=55-99

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/HoverReadoutCard.tsx
   :language: tsx
   :lines: 55-99
   :lineno-match:

.. CG-EXPLANATION-START id=function:HoverReadoutCard

**What this does.** The component. It computes the card height from the line count and the padding constants, centres the card vertically on the given Y but clamps it to stay inside the plot bounds, and draws a white rounded rectangle with a red border and the lines of text.

**Why it is here.** The height grows linearly with the line count so the one component renders both the short borehole card and the taller CPT card without per-line bookkeeping. The white fill and red border mirror the original CPT card so the feedback reads consistently across both kinds.

.. CG-EXPLANATION-END id=function:HoverReadoutCard

