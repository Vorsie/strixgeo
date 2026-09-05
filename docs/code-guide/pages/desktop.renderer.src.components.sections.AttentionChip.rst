desktop.renderer.src.components.sections.AttentionChip
======================================================

.. CG-PAGE source=desktop/src/renderer/src/components/sections/AttentionChip.tsx complete=true

*Source file:* ``desktop/src/renderer/src/components/sections/AttentionChip.tsx``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-36

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/AttentionChip.tsx
   :language: tsx
   :lines: 1-36
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** This is the top of a source file (a *module*, one file of program code). The long comment is documentation for the reader. This file draws a small amber pill — a *chip* — on the section toolbar that says something needs the engineer's eye: 'N pending here' for packing ties still to accept, 'N tests excluded' after a build that left some out, or a stale-column notice. The one line of real code sets a shared style string used by both forms the chip can take.

**Why it is here.** The comment records the history. The owner named it on 2026-08-31 as the one place the toolbar says 'look here', renamed from ``PendingTieChip`` because three of its four uses have nothing to do with ties. On the 2026-08-25 dogfeed the owner asked to make it clickable so it jumps to the pending tie; so the chip can act, but only when a caller gives it something to do. It was pulled out into its own file because the toolbar file it came from is already past the size where it should be split (debt #201).

.. CG-EXPLANATION-END id=module-header

``const CHIP_CLASS``
--------------------

.. CG-BLOCK id=const:CHIP_CLASS lines=37-40

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/AttentionChip.tsx
   :language: tsx
   :lines: 37-40
   :lineno-match:

.. CG-EXPLANATION-START id=const:CHIP_CLASS

**What this does.** Defines a *constant* — a fixed value given a name so it can be reused. Here the value is a string of styling instructions (colours, padding, a rounded border, amber text) that decide how the chip looks.

**Why it is here.** Both forms of the chip — a plain label and a clickable button — share this one style string so the label reads identically whichever form is shown. Naming it once means the two forms can never drift apart in appearance.

.. CG-EXPLANATION-END id=const:CHIP_CLASS

``interface Props``
-------------------

.. CG-BLOCK id=interface:Props lines=41-85

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/AttentionChip.tsx
   :language: tsx
   :lines: 41-85
   :lineno-match:

.. CG-EXPLANATION-START id=interface:Props

**What this does.** Declares an *interface* — a named description of the shape of some data, listing each field and its kind. This one describes the *props*: the inputs this chip is handed when it is drawn. The fields are the words on the chip, the hover tooltip, an optional 'reveal the next one' action, and optional overrides for the test id and the extra hint sentences.

**Why it is here.** The reveal action is deliberately optional. The docstring spells out the rule: with it, the chip becomes a real button that can be pressed with the keyboard; without it, it stays a plain passive label. A chip that swallowed a click without doing anything would be worse than the label it replaces, so it never advertises an action it cannot carry out.

.. CG-EXPLANATION-END id=interface:Props

``function AttentionChip``
--------------------------

.. CG-BLOCK id=function:AttentionChip lines=86-116

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/AttentionChip.tsx
   :language: tsx
   :lines: 86-116
   :lineno-match:

.. CG-EXPLANATION-START id=function:AttentionChip

**What this does.** Defines a *React component* — a function that returns a small piece of the screen. This one returns a plain ``<span>`` (an inert label) when no reveal action was supplied, and a ``<button>`` (pressable, keyboard-reachable, with a focus ring) when one was. The default test id and hint wording match the original pending-tie chip.

**Why it is here.** This is the passive-unless-it-can-act contract in code, the same one ``CrossingTieWarningChip`` next door already shipped. Making it a real ``<button>`` when interactive gives keyboard support and a focus ring for free, which the accessibility floor (WCAG 2.2 AA) requires; leaving it a ``<span>`` when passive means it never becomes a focus stop it cannot honour.

.. CG-EXPLANATION-END id=function:AttentionChip

