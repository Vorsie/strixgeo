desktop.renderer.src.components.sections.LithoSuggestionLayer
=============================================================

.. CG-PAGE source=desktop/src/renderer/src/components/sections/LithoSuggestionLayer.tsx complete=true

*Source file:* ``desktop/src/renderer/src/components/sections/LithoSuggestionLayer.tsx``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-20

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/LithoSuggestionLayer.tsx
   :language: tsx
   :lines: 1-20
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The top of the file that draws ONE suggested lithostratigraphic layer as a coloured, semi-transparent rectangle in a ghost column. It brings in (imports) the suggestion data type, the label and colour helpers, the shared multi-line label, the text-wrapping helpers, and the lithology colour table.

**Why it is here.** The docstring records that this was lifted verbatim out of the larger ghost-column file so each suggested layer's drawing lives in its own small, pure piece. Pure here means it only draws from its inputs and holds no remembered state of its own.

.. CG-EXPLANATION-END id=module-header

``const GHOST_OPACITY_DEFAULT``
-------------------------------

.. CG-BLOCK id=const:GHOST_OPACITY_DEFAULT lines=21-21

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/LithoSuggestionLayer.tsx
   :language: tsx
   :lines: 21-21
   :lineno-match:

.. CG-EXPLANATION-START id=const:GHOST_OPACITY_DEFAULT

**What this does.** Three see-through levels for the ghost rectangle: a pending suggestion is fairly faint, an accepted one is more solid, and a rejected one is barely there.

**Why it is here.** The transparency itself is the signal — a suggestion the engineer has not decided on yet must read as provisional, an accepted one as nearly committed, so the eye can tell the three states apart at a glance.

.. CG-EXPLANATION-END id=const:GHOST_OPACITY_DEFAULT

``const GHOST_OPACITY_ACCEPTED``
--------------------------------

.. CG-BLOCK id=const:GHOST_OPACITY_ACCEPTED lines=22-22

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/LithoSuggestionLayer.tsx
   :language: tsx
   :lines: 22-22
   :lineno-match:

.. CG-EXPLANATION-START id=const:GHOST_OPACITY_ACCEPTED

**What this does.** Same block as above — the accepted opacity value.

**Why it is here.** Same reason as the pending value above: opacity encodes decision state.

.. CG-EXPLANATION-END id=const:GHOST_OPACITY_ACCEPTED

``const GHOST_OPACITY_REJECTED``
--------------------------------

.. CG-BLOCK id=const:GHOST_OPACITY_REJECTED lines=23-24

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/LithoSuggestionLayer.tsx
   :language: tsx
   :lines: 23-24
   :lineno-match:

.. CG-EXPLANATION-START id=const:GHOST_OPACITY_REJECTED

**What this does.** Same block as above — the rejected opacity value.

**Why it is here.** Same reason as the pending value above: opacity encodes decision state.

.. CG-EXPLANATION-END id=const:GHOST_OPACITY_REJECTED

``const LABEL_FONT_SIZE``
-------------------------

.. CG-BLOCK id=const:LABEL_FONT_SIZE lines=25-27

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/LithoSuggestionLayer.tsx
   :language: tsx
   :lines: 25-27
   :lineno-match:

.. CG-EXPLANATION-START id=const:LABEL_FONT_SIZE

**What this does.** The font size, in pixels, for the label written inside each ghost rectangle.

**Why it is here.** A ghost column is narrow, so its inline label is kept small enough to fit inside a typical layer band.

.. CG-EXPLANATION-END id=const:LABEL_FONT_SIZE

``function lithoFill``
----------------------

.. CG-BLOCK id=function:lithoFill lines=28-35

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/LithoSuggestionLayer.tsx
   :language: tsx
   :lines: 28-35
   :lineno-match:

.. CG-EXPLANATION-START id=function:lithoFill

**What this does.** A tiny helper that turns a lithology name into its fill colour by looking it up in the shared colour table, using a neutral fallback colour when the lithology is unknown.

**Why it is here.** Every part of the app that colours soil reads the one shared table, so a suggested layer and its eventual committed band always paint the same colour.

.. CG-EXPLANATION-END id=function:lithoFill

``function LithoSuggestionLayer``
---------------------------------

.. CG-BLOCK id=function:LithoSuggestionLayer lines=36-358

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/LithoSuggestionLayer.tsx
   :language: tsx
   :lines: 36-358
   :lineno-match:

.. CG-EXPLANATION-START id=function:LithoSuggestionLayer

**What this does.** The component that draws a single suggested layer. It converts the suggestion's depths-below-surface into absolute elevations in metres TAW (the Belgian height datum, where 0 m TAW is a real elevation, never a missing marker) using the investigation's surface elevation, then maps those to screen y positions and clamps them to the visible plot. It skips drawing entirely for a rejected layer or a collapsed near-zero-height layer, draws a near-zero 'sentinel' layer as a dashed outline only, and otherwise draws the filled rectangle, a rich tooltip carrying the NAD packing class, qc and Dr, an amber dashed border when the suggestion straddles a formation boundary, a small reject cross in the corner, a diagonal hatch marking 'still a suggestion', and the wrapped label. It wires the gestures: double-click accepts, shift-click rejects, right-click opens a menu, plain single-click is inert, and Alt-mousedown arms a copy-of-composition drag.

**Why it is here.** The interaction rules cite the owner directive of 22 May 2026: accept was moved OFF the plain single click so that a misclick while aiming for a drag handle or a boundary strip can no longer commit a contact. Rejected layers render nothing at all (dogfeed 31 May 2026 — no band, no cross-out, no undo button, to remove clutter) while surviving in memory so the drag walkers still see them. Accepted and rejected rectangles let clicks fall through to the pick bar underneath so a new contact can be placed without first dismissing the ghost (dogfeed 20 May 2026). The straddle border and auto-split note reflect that the backend splits such an interval into two contacts on accept.

.. CG-EXPLANATION-END id=function:LithoSuggestionLayer

