desktop.renderer.src.components.sections.CrossingTieWarningChip
===============================================================

.. CG-PAGE source=desktop/src/renderer/src/components/sections/CrossingTieWarningChip.tsx complete=true

*Source file:* ``desktop/src/renderer/src/components/sections/CrossingTieWarningChip.tsx``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-17

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/CrossingTieWarningChip.tsx
   :language: tsx
   :lines: 1-17
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The top of the file for a small persistent amber badge that warns when correlation ties cross each other on the section. The only import is the translation helper.

**Why it is here.** It exists because of the owner's crossing-tie ruling (partition-engine section 8, Q4): two crossing approved ties are a hard conflict, neither one bands, and the engineer gets a visual warning until one is deleted. It is a passive chip — it never steals focus, opens no dialog, and does not intercept clicks — and was pulled into its own file rather than growing the partition overlay (debt #201).

.. CG-EXPLANATION-END id=module-header

``const AMBER``
---------------

.. CG-BLOCK id=const:AMBER lines=18-19

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/CrossingTieWarningChip.tsx
   :language: tsx
   :lines: 18-19
   :lineno-match:

.. CG-EXPLANATION-START id=const:AMBER

**What this does.** A constant — the amber warning colour of the chip.

**Why it is here.** Amber is the project's warning colour and is legible on both light and dark section backgrounds; it is kept as an explicit value because this chip renders in SVG, which cannot use the colour utility classes.

.. CG-EXPLANATION-END id=const:AMBER

``const CHIP_TEXT``
-------------------

.. CG-BLOCK id=const:CHIP_TEXT lines=20-20

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/CrossingTieWarningChip.tsx
   :language: tsx
   :lines: 20-20
   :lineno-match:

.. CG-EXPLANATION-START id=const:CHIP_TEXT

**What this does.** A constant — the dark slate text colour on the amber chip.

**Why it is here.** Dark text on amber meets the contrast floor (WCAG AA) so the warning is readable.

.. CG-EXPLANATION-END id=const:CHIP_TEXT

``const CHIP_H``
----------------

.. CG-BLOCK id=const:CHIP_H lines=21-21

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/CrossingTieWarningChip.tsx
   :language: tsx
   :lines: 21-21
   :lineno-match:

.. CG-EXPLANATION-START id=const:CHIP_H

**What this does.** A constant — the chip's height in pixels.

**Why it is here.** A fixed height for the small warning pill.

.. CG-EXPLANATION-END id=const:CHIP_H

``const CHIP_PAD_X``
--------------------

.. CG-BLOCK id=const:CHIP_PAD_X lines=22-23

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/CrossingTieWarningChip.tsx
   :language: tsx
   :lines: 22-23
   :lineno-match:

.. CG-EXPLANATION-START id=const:CHIP_PAD_X

**What this does.** A constant — the horizontal padding inside the chip.

**Why it is here.** It sets the breathing room on each side of the text when the chip width is computed.

.. CG-EXPLANATION-END id=const:CHIP_PAD_X

``const CHAR_W``
----------------

.. CG-BLOCK id=const:CHAR_W lines=24-24

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/CrossingTieWarningChip.tsx
   :language: tsx
   :lines: 24-24
   :lineno-match:

.. CG-EXPLANATION-START id=const:CHAR_W

**What this does.** A constant — an approximate character width as a fraction of the font size.

**Why it is here.** It lets the chip estimate its own width from the label length, since SVG text does not auto-size a background box.

.. CG-EXPLANATION-END id=const:CHAR_W

``const FONT``
--------------

.. CG-BLOCK id=const:FONT lines=25-27

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/CrossingTieWarningChip.tsx
   :language: tsx
   :lines: 25-27
   :lineno-match:

.. CG-EXPLANATION-START id=const:FONT

**What this does.** A constant — the chip's text size in pixels.

**Why it is here.** A small size to match the compact warning pill.

.. CG-EXPLANATION-END id=const:FONT

``interface Props``
-------------------

.. CG-BLOCK id=interface:Props lines=28-63

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/CrossingTieWarningChip.tsx
   :language: tsx
   :lines: 28-63
   :lineno-match:

.. CG-EXPLANATION-START id=interface:Props

**What this does.** The inputs: how many crossing-tie conflicts there are, the plot-area top-left anchor, and an optional jump-to-next-conflict callback.

**Why it is here.** The chip shows only when the count is above zero. The jump is optional and follows the same passive-unless-it-can-act contract as ``AttentionChip``: with it, the chip becomes clickable and centres the next conflict (owner ask 2026-08-23); without it, it stays a passive label that never advertises an action it cannot honour.

.. CG-EXPLANATION-END id=interface:Props

``function CrossingTieWarningChip``
-----------------------------------

.. CG-BLOCK id=function:CrossingTieWarningChip lines=64-133

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/CrossingTieWarningChip.tsx
   :language: tsx
   :lines: 64-133
   :lineno-match:

.. CG-EXPLANATION-START id=function:CrossingTieWarningChip

**What this does.** The component. It returns nothing when there are no conflicts; otherwise it builds the warning phrase, estimates its own width from the label length, and draws an amber rounded rectangle with the text at the plot's top-left. When a jump callback is given it becomes a keyboard-reachable button; otherwise it ignores pointer events entirely.

**Why it is here.** The tail of the message differs by mode on purpose — passive, it says what to do; clickable, it says the affordance is there, because nothing about an SVG chip says 'press me'. An SVG group gets none of a real button's keyboard behaviour, so Enter and Space are wired by hand to meet the keyboard-reachability floor (WCAG 2.2 AA) on this keyboard-driven editor.

.. CG-EXPLANATION-END id=function:CrossingTieWarningChip

