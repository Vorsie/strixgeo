desktop.renderer.src.components.sections.CorrelationEdgesMenus
==============================================================

.. CG-PAGE source=desktop/src/renderer/src/components/sections/CorrelationEdgesMenus.tsx complete=true

*Source file:* ``desktop/src/renderer/src/components/sections/CorrelationEdgesMenus.tsx``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-12

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/CorrelationEdgesMenus.tsx
   :language: tsx
   :lines: 1-12
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The top of the file holding the small chip and menu pieces used by the correlation overlay: the body ordinal chip, the body-level right-click menu, and the edge-level right-click menu. The imports pull in the generic menu, the correlation-edge data type, and the shared edge colour.

**Why it is here.** These were pulled out verbatim from the correlation overlay file to keep it from growing past the size threshold (debt #201, round 2). Grouping the chip and the two menus here keeps the overlay file focused on the drawing and gesture logic.

.. CG-EXPLANATION-END id=module-header

``const CHIP_BG``
-----------------

.. CG-BLOCK id=const:CHIP_BG lines=13-14

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/CorrelationEdgesMenus.tsx
   :language: tsx
   :lines: 13-14
   :lineno-match:

.. CG-EXPLANATION-START id=const:CHIP_BG

**What this does.** A constant — the background colour of the body ordinal chip, a dark slate-blue.

**Why it is here.** It matches the earlier edge badge so the chip reads consistently with what came before.

.. CG-EXPLANATION-END id=const:CHIP_BG

``const CHIP_FG``
-----------------

.. CG-BLOCK id=const:CHIP_FG lines=15-16

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/CorrelationEdgesMenus.tsx
   :language: tsx
   :lines: 15-16
   :lineno-match:

.. CG-EXPLANATION-START id=const:CHIP_FG

**What this does.** A constant — the text colour of the chip, an off-white.

**Why it is here.** It pairs with the dark background so the ``#N`` reads clearly against it.

.. CG-EXPLANATION-END id=const:CHIP_FG

``const CHIP_FONT_SIZE``
------------------------

.. CG-BLOCK id=const:CHIP_FONT_SIZE lines=17-18

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/CorrelationEdgesMenus.tsx
   :language: tsx
   :lines: 17-18
   :lineno-match:

.. CG-EXPLANATION-START id=const:CHIP_FONT_SIZE

**What this does.** A constant — the chip's text size in pixels.

**Why it is here.** It is sized to sit legibly inside the compact chip, which the width constant below notes is dimensioned to fit a two-digit ordinal comfortably.

.. CG-EXPLANATION-END id=const:CHIP_FONT_SIZE

``const CHIP_WIDTH``
--------------------

.. CG-BLOCK id=const:CHIP_WIDTH lines=19-19

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/CorrelationEdgesMenus.tsx
   :language: tsx
   :lines: 19-19
   :lineno-match:

.. CG-EXPLANATION-START id=const:CHIP_WIDTH

**What this does.** A constant — the chip's width in pixels.

**Why it is here.** It is dimensioned to fit a ``#NN`` ordinal comfortably, as the comment states.

.. CG-EXPLANATION-END id=const:CHIP_WIDTH

``const CHIP_HEIGHT``
---------------------

.. CG-BLOCK id=const:CHIP_HEIGHT lines=20-21

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/CorrelationEdgesMenus.tsx
   :language: tsx
   :lines: 20-21
   :lineno-match:

.. CG-EXPLANATION-START id=const:CHIP_HEIGHT

**What this does.** A constant — the chip's height in pixels.

**Why it is here.** Same as the width — sized so the ``#NN`` ordinal fits comfortably.

.. CG-EXPLANATION-END id=const:CHIP_HEIGHT

``const CHIP_INSET``
--------------------

.. CG-BLOCK id=const:CHIP_INSET lines=22-23

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/CorrelationEdgesMenus.tsx
   :language: tsx
   :lines: 22-23
   :lineno-match:

.. CG-EXPLANATION-START id=const:CHIP_INSET

**What this does.** A constant — the gap in pixels between the chip and the top-right corner of the band it sits in.

**Why it is here.** It insets the chip slightly from the band corner so it does not touch the edges.

.. CG-EXPLANATION-END id=const:CHIP_INSET

``const CHIP_MIN_BAND_HEIGHT``
------------------------------

.. CG-BLOCK id=const:CHIP_MIN_BAND_HEIGHT lines=24-25

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/CorrelationEdgesMenus.tsx
   :language: tsx
   :lines: 24-25
   :lineno-match:

.. CG-EXPLANATION-START id=const:CHIP_MIN_BAND_HEIGHT

**What this does.** A constant — the smallest band height that can still hold a chip, computed from the chip height plus its insets.

**Why it is here.** Below this height the chip would overflow the band, so the chip is skipped.

.. CG-EXPLANATION-END id=const:CHIP_MIN_BAND_HEIGHT

``const CHIP_HALO_WIDTH``
-------------------------

.. CG-BLOCK id=const:CHIP_HALO_WIDTH lines=26-31

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/CorrelationEdgesMenus.tsx
   :language: tsx
   :lines: 26-31
   :lineno-match:

.. CG-EXPLANATION-START id=const:CHIP_HALO_WIDTH

**What this does.** A constant — the stroke width of the ring drawn around a chip when its body is hovered.

**Why it is here.** It sets how thick the 'this body is hovered' halo ring reads.

.. CG-EXPLANATION-END id=const:CHIP_HALO_WIDTH

``interface BodyChipProps``
---------------------------

.. CG-BLOCK id=interface:BodyChipProps lines=32-52

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/CorrelationEdgesMenus.tsx
   :language: tsx
   :lines: 32-52
   :lineno-match:

.. CG-EXPLANATION-START id=interface:BodyChipProps

**What this does.** The inputs to one body chip: its top-left position, the body ordinal to show, whether the whole body is currently hovered (which lights the halo), the mouse enter/leave and right-click callbacks, and a test id.

**Why it is here.** The hovered flag is passed in rather than tracked locally so every chip of the same body can light its halo together — the connection reads visually before the edge lines themselves animate in. The test id lets a test target one specific chip directly.

.. CG-EXPLANATION-END id=interface:BodyChipProps

``function BodyChip``
---------------------

.. CG-BLOCK id=function:BodyChip lines=53-114

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/CorrelationEdgesMenus.tsx
   :language: tsx
   :lines: 53-114
   :lineno-match:

.. CG-EXPLANATION-START id=function:BodyChip

**What this does.** The component for one chip. It draws the halo ring first (when hovered) so the chip body paints over it, then the rounded chip background, then the ``#N`` text.

**Why it is here.** Drawing the ring first makes it read as an outline around the chip rather than covering it. The chip is the always-on 'this is the same body' signal and the surface the engineer hovers to reveal the edge lines.

.. CG-EXPLANATION-END id=function:BodyChip

``interface BodyContextMenuState``
----------------------------------

.. CG-BLOCK id=interface:BodyContextMenuState lines=115-126

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/CorrelationEdgesMenus.tsx
   :language: tsx
   :lines: 115-126
   :lineno-match:

.. CG-EXPLANATION-START id=interface:BodyContextMenuState

**What this does.** The shape of an open body-chip menu: its screen position, the body ordinal, and the chip's own formation id used as the seed for the admixture editor.

**Why it is here.** The ordinal finds every edge in this body's graph for the 'remove all correlations' action, and the seed formation is where the admixture editor starts and propagates from — a graph walk reaches the whole body from any seed.

.. CG-EXPLANATION-END id=interface:BodyContextMenuState

``interface BodyContextMenuProps``
----------------------------------

.. CG-BLOCK id=interface:BodyContextMenuProps lines=127-134

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/CorrelationEdgesMenus.tsx
   :language: tsx
   :lines: 127-134
   :lineno-match:

.. CG-EXPLANATION-START id=interface:BodyContextMenuProps

**What this does.** The inputs to the body menu: the open-menu state, an edit-admixtures callback, an optional inspect callback, and a close callback.

**Why it is here.** The inspect action is optional so callers that do not need the inspect panel do not have to supply it, per the no-affordance pattern.

.. CG-EXPLANATION-END id=interface:BodyContextMenuProps

``function BodyContextMenu``
----------------------------

.. CG-BLOCK id=function:BodyContextMenu lines=135-166

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/CorrelationEdgesMenus.tsx
   :language: tsx
   :lines: 135-166
   :lineno-match:

.. CG-EXPLANATION-START id=function:BodyContextMenu

**What this does.** The component. It renders the generic menu at the stored position with two possible rows: 'Inspect lens body…' when wired, and 'Edit admixtures for this body'.

**Why it is here.** Inspect appears only when a caller provides it (#101 Blocker 1); Edit admixtures is always offered because it is the body menu's core purpose.

.. CG-EXPLANATION-END id=function:BodyContextMenu

``interface EdgeContextMenuState``
----------------------------------

.. CG-BLOCK id=interface:EdgeContextMenuState lines=167-172

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/CorrelationEdgesMenus.tsx
   :language: tsx
   :lines: 167-172
   :lineno-match:

.. CG-EXPLANATION-START id=interface:EdgeContextMenuState

**What this does.** The shape of an open edge menu: its screen position and the correlation edge it is about.

**Why it is here.** It carries the exact edge so the accept, confirm, and delete actions all operate on the right tie.

.. CG-EXPLANATION-END id=interface:EdgeContextMenuState

``interface EdgeContextMenuProps``
----------------------------------

.. CG-BLOCK id=interface:EdgeContextMenuProps lines=173-197

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/CorrelationEdgesMenus.tsx
   :language: tsx
   :lines: 173-197
   :lineno-match:

.. CG-EXPLANATION-START id=interface:EdgeContextMenuProps

**What this does.** The inputs to the edge menu: the open-menu state, a delete callback, optional accept and confirm-review callbacks, an optional accept-row wording, and a close callback.

**Why it is here.** Accept appears only for a still-pending edge (an approved edge has nothing to accept); confirm appears only for a rebuild-flagged edge (nothing to clear otherwise). The wording is a prop because the geotech axis calls a correlation a 'tie' everywhere else, so a menu row saying 'Accept correlation' beside 'Accept all ties' would look like a different verb.

.. CG-EXPLANATION-END id=interface:EdgeContextMenuProps

``function EdgeContextMenu``
----------------------------

.. CG-BLOCK id=function:EdgeContextMenu lines=198-256

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/CorrelationEdgesMenus.tsx
   :language: tsx
   :lines: 198-256
   :lineno-match:

.. CG-EXPLANATION-START id=function:EdgeContextMenu

**What this does.** The component. It builds the row list in order — Accept first (when pending), Confirm next (when flagged), Delete last (danger-styled) — and renders the generic menu, sizing its height to the number of rows it actually shows.

**Why it is here.** The positive actions sit above the destructive one because Accept and Confirm are the engineer's non-destructive answer to the same question Delete answers destructively. The height is computed from the visible rows so the menu never clips a row it decided to show.

.. CG-EXPLANATION-END id=function:EdgeContextMenu

