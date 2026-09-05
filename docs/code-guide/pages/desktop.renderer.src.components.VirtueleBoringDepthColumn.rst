desktop.renderer.src.components.VirtueleBoringDepthColumn
=========================================================

.. CG-PAGE source=desktop/src/renderer/src/components/VirtueleBoringDepthColumn.tsx complete=true

*Source file:* ``desktop/src/renderer/src/components/VirtueleBoringDepthColumn.tsx``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-31

.. literalinclude:: ../../../desktop/src/renderer/src/components/VirtueleBoringDepthColumn.tsx
   :language: tsx
   :lines: 1-31
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The docstring and imports for the Virtuele Boring depth column — a thin drawn strip that shows DOV's predicted subsurface layers beside a single investigation's data. The docstring explains it takes the active prediction(s) and the visible depth window, converts DOV's absolute elevations to depth-below-surface using the investigation's surface level, clips to the visible window and the user's depth cap, and draws one labelled column per active model. The imports bring in ``useRef``, the prediction data shapes, three label-wrapping helpers, an element-size hook, and the translator.

**Why it is here.** The Virtuele Boring ("virtual borehole") is DOV's model-predicted soil column at a point. This version is deliberately separate from its section-view sibling (per the docstring): the CPT chart and borehole log think in metres below surface for one investigation, while the section view works in absolute elevation across dozens of investigations, so each gets a column drawn in its own coordinate frame rather than one component bent to serve both.

.. CG-EXPLANATION-END id=module-header

``const COLUMN_WIDTH_PX``
-------------------------

.. CG-BLOCK id=const:COLUMN_WIDTH_PX lines=32-32

.. literalinclude:: ../../../desktop/src/renderer/src/components/VirtueleBoringDepthColumn.tsx
   :language: tsx
   :lines: 32-32
   :lineno-match:

.. CG-EXPLANATION-START id=const:COLUMN_WIDTH_PX

**What this does.** The width of one model's column, 48 pixels.

**Why it is here.** A fixed column width keeps the ghost strip a predictable size beside the data tracks.

.. CG-EXPLANATION-END id=const:COLUMN_WIDTH_PX

``const COLUMN_GAP_PX``
-----------------------

.. CG-BLOCK id=const:COLUMN_GAP_PX lines=33-33

.. literalinclude:: ../../../desktop/src/renderer/src/components/VirtueleBoringDepthColumn.tsx
   :language: tsx
   :lines: 33-33
   :lineno-match:

.. CG-EXPLANATION-START id=const:COLUMN_GAP_PX

**What this does.** The gap between two models' columns, 4 pixels.

**Why it is here.** A small gap separates the two models' columns when both are shown.

.. CG-EXPLANATION-END id=const:COLUMN_GAP_PX

``const LABEL_FONT_SIZE``
-------------------------

.. CG-BLOCK id=const:LABEL_FONT_SIZE lines=34-34

.. literalinclude:: ../../../desktop/src/renderer/src/components/VirtueleBoringDepthColumn.tsx
   :language: tsx
   :lines: 34-34
   :lineno-match:

.. CG-EXPLANATION-START id=const:LABEL_FONT_SIZE

**What this does.** The text size for a layer's label, 9 pixels.

**Why it is here.** A small size so a layer name fits inside a thin column band.

.. CG-EXPLANATION-END id=const:LABEL_FONT_SIZE

``const GHOST_OPACITY``
-----------------------

.. CG-BLOCK id=const:GHOST_OPACITY lines=35-35

.. literalinclude:: ../../../desktop/src/renderer/src/components/VirtueleBoringDepthColumn.tsx
   :language: tsx
   :lines: 35-35
   :lineno-match:

.. CG-EXPLANATION-START id=const:GHOST_OPACITY

**What this does.** How see-through a layer band is drawn, at 0.55.

**Why it is here.** The band is semi-transparent so it reads as a faint "ghost" prediction laid beside the real data, not as measured fact.

.. CG-EXPLANATION-END id=const:GHOST_OPACITY

``const HEADER_FONT_SIZE``
--------------------------

.. CG-BLOCK id=const:HEADER_FONT_SIZE lines=36-37

.. literalinclude:: ../../../desktop/src/renderer/src/components/VirtueleBoringDepthColumn.tsx
   :language: tsx
   :lines: 36-37
   :lineno-match:

.. CG-EXPLANATION-START id=const:HEADER_FONT_SIZE

**What this does.** The text size for the model-code header above each column, 9 pixels.

**Why it is here.** Matches the small label size so the header sits neatly over its column.

.. CG-EXPLANATION-END id=const:HEADER_FONT_SIZE

``interface Props``
-------------------

.. CG-BLOCK id=interface:Props lines=38-60

.. literalinclude:: ../../../desktop/src/renderer/src/components/VirtueleBoringDepthColumn.tsx
   :language: tsx
   :lines: 38-60
   :lineno-match:

.. CG-EXPLANATION-START id=interface:Props

**What this does.** The column's inputs: the prediction for this investigation (or none), the ordered list of active model codes (at most two), the visible depth window, the surface elevation, the project depth cap, and the top and bottom pixel margins to reserve.

**Why it is here.** The comments record two careful choices. When there is no prediction or no surface elevation (for example a point outside Belgian Lambert 72, or one DOV has no model for), the component draws a faint placeholder rather than guessing, so toggling the overlay does not make the layout jump. The top and bottom margins are passed in to match the host chart's own margins so that depth zero in this column lines up exactly with depth zero in the data tracks beside it.

.. CG-EXPLANATION-END id=interface:Props

``function VirtueleBoringDepthColumn``
--------------------------------------

.. CG-BLOCK id=function:VirtueleBoringDepthColumn lines=61-101

.. literalinclude:: ../../../desktop/src/renderer/src/components/VirtueleBoringDepthColumn.tsx
   :language: tsx
   :lines: 61-101
   :lineno-match:

.. CG-EXPLANATION-START id=function:VirtueleBoringDepthColumn

**What this does.** The outer component. It measures its own on-screen box with a ref and a size hook, computes the total width from how many models are active, and draws a bordered container holding an SVG canvas into which the inner ghost is drawn once the size is known.

**Why it is here.** It waits until it has measured its real height before drawing, because the depth-to-pixel conversion inside needs the true pixel height to line the layers up with the host chart; a *ref* holds the element and the size hook reports its measured size.

.. CG-EXPLANATION-END id=function:VirtueleBoringDepthColumn

``function DepthGhost``
-----------------------

.. CG-BLOCK id=function:DepthGhost lines=102-187

.. literalinclude:: ../../../desktop/src/renderer/src/components/VirtueleBoringDepthColumn.tsx
   :language: tsx
   :lines: 102-187
   :lineno-match:

.. CG-EXPLANATION-START id=function:DepthGhost

**What this does.** The inner drawing. It works out the usable top and bottom (inside the reserved margins) and the depth range, decides whether there is anything to draw, and if not shows a small "no data" note. Otherwise it defines a depth-to-pixel function and, for each active model, draws the model-code header and one band per predicted layer.

**Why it is here.** The depth-to-pixel function is the whole geometry: it turns a depth into a vertical position by placing it as a fraction of the way down the usable height, so every layer lands where the host chart would put that depth. The early "no data" note covers the placeholder case the props comment described.

.. CG-EXPLANATION-END id=function:DepthGhost

``function DepthGhostLayer``
----------------------------

.. CG-BLOCK id=function:DepthGhostLayer lines=188-261

.. literalinclude:: ../../../desktop/src/renderer/src/components/VirtueleBoringDepthColumn.tsx
   :language: tsx
   :lines: 188-261
   :lineno-match:

.. CG-EXPLANATION-START id=function:DepthGhostLayer

**What this does.** Draws one predicted layer as a coloured band. It converts the layer's top and base from absolute elevation to depth-below-surface, drops or trims it against the project depth cap, drops it if it falls entirely outside the visible window, clips it to the window, converts to pixel positions, skips it if it would be a hairline, and draws the band with a hover tooltip and — if it fits — a wrapped label.

**Why it is here.** The elevation-to-depth conversion is surface elevation minus the layer's elevation, which is what lets an absolute-elevation prediction sit on a depth-below-surface axis. Clipping to the window and the cap keeps the drawing inside what the user asked to see, and skipping sub-pixel bands avoids drawing invisible slivers. The tooltip keeps the raw absolute-elevation figures and thickness available on hover even though the band is drawn in depth-below-surface — surfacing the underlying numbers so an engineer can check them.

.. CG-EXPLANATION-END id=function:DepthGhostLayer

``function MultiLineSvgLabel``
------------------------------

.. CG-BLOCK id=function:MultiLineSvgLabel lines=262-298

.. literalinclude:: ../../../desktop/src/renderer/src/components/VirtueleBoringDepthColumn.tsx
   :language: tsx
   :lines: 262-298
   :lineno-match:

.. CG-EXPLANATION-START id=function:MultiLineSvgLabel

**What this does.** Draws a layer's label as one or more centred lines of text, vertically centred within the band, with the same tooltip as the band.

**Why it is here.** A drawn label needs its lines positioned by hand (drawn text has no automatic wrapping), so this computes the block height and first baseline to centre the wrapped lines in the band; the label ignores pointer events so hovering still reaches the band's tooltip beneath it.

.. CG-EXPLANATION-END id=function:MultiLineSvgLabel

