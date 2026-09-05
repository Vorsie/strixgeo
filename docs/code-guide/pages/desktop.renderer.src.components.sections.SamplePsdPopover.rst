desktop.renderer.src.components.sections.SamplePsdPopover
=========================================================

.. CG-PAGE source=desktop/src/renderer/src/components/sections/SamplePsdPopover.tsx complete=true

*Source file:* ``desktop/src/renderer/src/components/sections/SamplePsdPopover.tsx``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-35

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/SamplePsdPopover.tsx
   :language: tsx
   :lines: 1-35
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The top of the floating grain-size preview card shown while a lab-sample marker is hovered. It imports the sample type, the clamp-into-panel placement helper, the organic-content helper, and the particle-size curve helpers.

**Why it is here.** The docstring records the two shapes: with grain-size tests it draws a mini particle-size distribution chart on a FIXED log axis 63 down to 0.001 mm, coarse on the left (owner 14 August 2026: 'a fixed axis scale so it is always easy to see sand/silt/clay fraction' — every card is directly comparable and the fraction boundaries never move); without them it shows a compact card with an explicit 'no grain-size test' line rather than an empty frame that would read as a failed render. It notes the card ignores the mouse and clamps itself inside the panel, and that an SVG coordinate and a container CSS offset are the same number because the section SVG's view box is matched 1:1 to its pixel size.

.. CG-EXPLANATION-END id=module-header

``const CARD_PADDING``
----------------------

.. CG-BLOCK id=const:CARD_PADDING lines=36-37

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/SamplePsdPopover.tsx
   :language: tsx
   :lines: 36-37
   :lineno-match:

.. CG-EXPLANATION-START id=const:CARD_PADDING

**What this does.** The inner padding of the card, 8 px.

**Why it is here.** Gives the card content breathing room inside its border.

.. CG-EXPLANATION-END id=const:CARD_PADDING

``const CHART_WIDTH``
---------------------

.. CG-BLOCK id=const:CHART_WIDTH lines=38-39

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/SamplePsdPopover.tsx
   :language: tsx
   :lines: 38-39
   :lineno-match:

.. CG-EXPLANATION-START id=const:CHART_WIDTH

**What this does.** The plot width of the mini chart, 184 px.

**Why it is here.** Sizes the small chart to fit inside the hover card.

.. CG-EXPLANATION-END id=const:CHART_WIDTH

``const CHART_HEIGHT``
----------------------

.. CG-BLOCK id=const:CHART_HEIGHT lines=40-41

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/SamplePsdPopover.tsx
   :language: tsx
   :lines: 40-41
   :lineno-match:

.. CG-EXPLANATION-START id=const:CHART_HEIGHT

**What this does.** The plot height of the mini chart, 80 px.

**Why it is here.** Sizes the small chart to fit inside the hover card.

.. CG-EXPLANATION-END id=const:CHART_HEIGHT

``const CARD_WIDTH``
--------------------

.. CG-BLOCK id=const:CARD_WIDTH lines=42-43

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/SamplePsdPopover.tsx
   :language: tsx
   :lines: 42-43
   :lineno-match:

.. CG-EXPLANATION-START id=const:CARD_WIDTH

**What this does.** The card width — the chart width plus padding on both sides.

**Why it is here.** Derived from the chart width so the two never drift apart.

.. CG-EXPLANATION-END id=const:CARD_WIDTH

``const HEADER_HEIGHT``
-----------------------

.. CG-BLOCK id=const:HEADER_HEIGHT lines=44-45

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/SamplePsdPopover.tsx
   :language: tsx
   :lines: 44-45
   :lineno-match:

.. CG-EXPLANATION-START id=const:HEADER_HEIGHT

**What this does.** The height of the two-line header block, 30 px.

**Why it is here.** Reserves space for the sample label and the borehole-and-depth line.

.. CG-EXPLANATION-END id=const:HEADER_HEIGHT

``const AXIS_LABEL_HEIGHT``
---------------------------

.. CG-BLOCK id=const:AXIS_LABEL_HEIGHT lines=46-53

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/SamplePsdPopover.tsx
   :language: tsx
   :lines: 46-53
   :lineno-match:

.. CG-EXPLANATION-START id=const:AXIS_LABEL_HEIGHT

**What this does.** The height of the axis-label strip under the chart, 13 px.

**Why it is here.** Reserves space for the coarse and fine diameter labels and the 'finer by weight' caption.

.. CG-EXPLANATION-END id=const:AXIS_LABEL_HEIGHT

``const ORGANIC_LINE_HEIGHT``
-----------------------------

.. CG-BLOCK id=const:ORGANIC_LINE_HEIGHT lines=54-60

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/SamplePsdPopover.tsx
   :language: tsx
   :lines: 54-60
   :lineno-match:

.. CG-EXPLANATION-START id=const:ORGANIC_LINE_HEIGHT

**What this does.** The height of the optional organic-content line under the header, 12 px.

**Why it is here.** The docstring: added to the measured card height whenever the line renders, so the same number feeds the clamp helper and a card that grew a line still clamps inside the panel instead of hanging off the bottom.

.. CG-EXPLANATION-END id=const:ORGANIC_LINE_HEIGHT

``const HINT_LINE_HEIGHT``
--------------------------

.. CG-BLOCK id=const:HINT_LINE_HEIGHT lines=61-62

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/SamplePsdPopover.tsx
   :language: tsx
   :lines: 61-62
   :lineno-match:

.. CG-EXPLANATION-START id=const:HINT_LINE_HEIGHT

**What this does.** The height of the optional 'click to highlight packing body' hint line, 12 px.

**Why it is here.** The docstring: same treatment as the organic line — measured whenever it renders so the grown card still clamps inside the panel.

.. CG-EXPLANATION-END id=const:HINT_LINE_HEIGHT

``const CARD_HEIGHT_WITH_CHART``
--------------------------------

.. CG-BLOCK id=const:CARD_HEIGHT_WITH_CHART lines=63-65

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/SamplePsdPopover.tsx
   :language: tsx
   :lines: 63-65
   :lineno-match:

.. CG-EXPLANATION-START id=const:CARD_HEIGHT_WITH_CHART

**What this does.** The card height when a chart is drawn — padding plus header plus chart plus axis labels.

**Why it is here.** Composed from the pieces so the placement maths knows the exact height of the chart shape.

.. CG-EXPLANATION-END id=const:CARD_HEIGHT_WITH_CHART

``const CARD_HEIGHT_COMPACT``
-----------------------------

.. CG-BLOCK id=const:CARD_HEIGHT_COMPACT lines=66-74

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/SamplePsdPopover.tsx
   :language: tsx
   :lines: 66-74
   :lineno-match:

.. CG-EXPLANATION-START id=const:CARD_HEIGHT_COMPACT

**What this does.** The card height for the compact 'no grain-size test' shape — padding plus header plus axis labels, without the chart.

**Why it is here.** Composed from the pieces so the placement maths knows the exact height of the compact shape.

.. CG-EXPLANATION-END id=const:CARD_HEIGHT_COMPACT

``const SERIES_COLORS``
-----------------------

.. CG-BLOCK id=const:SERIES_COLORS lines=75-82

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/SamplePsdPopover.tsx
   :language: tsx
   :lines: 75-82
   :lineno-match:

.. CG-EXPLANATION-START id=const:SERIES_COLORS

**What this does.** The four colours cycled one per grain-size test curve.

**Why it is here.** The docstring: reuses the existing chart-curve tokens rather than minting new hues, because each already carries a contrast-corrected dark value, so the curves stay legible in the theme the owner works in.

.. CG-EXPLANATION-END id=const:SERIES_COLORS

``function formatDiameter``
---------------------------

.. CG-BLOCK id=function:formatDiameter lines=83-91

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/SamplePsdPopover.tsx
   :language: tsx
   :lines: 83-91
   :lineno-match:

.. CG-EXPLANATION-START id=function:formatDiameter

**What this does.** Formats a grain diameter for the axis-end labels: whole numbers for large sizes, one decimal for around 1 mm, three decimals for sub-millimetre, and scientific notation below that.

**Why it is here.** The comment: the fixed window's fine wall is 0.001 mm, kept as a decimal rather than shown as 1e-3, which is unreadable on an axis label.

.. CG-EXPLANATION-END id=function:formatDiameter

``interface SamplePsdPopoverProps``
-----------------------------------

.. CG-BLOCK id=interface:SamplePsdPopoverProps lines=92-119

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/SamplePsdPopover.tsx
   :language: tsx
   :lines: 92-119
   :lineno-match:

.. CG-EXPLANATION-START id=interface:SamplePsdPopoverProps

**What this does.** The inputs: the hovered sample, the borehole name, the marker's container-local x and y, the panel width and height (so the card clamps inside), and whether clicking would highlight the packing body.

**Why it is here.** The comment on the last field: it comes straight from the overlay's own verdict and defaults to false, so the card never invents an affordance nobody told it about.

.. CG-EXPLANATION-END id=interface:SamplePsdPopoverProps

``function SamplePsdPopover``
-----------------------------

.. CG-BLOCK id=function:SamplePsdPopover lines=120-346

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/SamplePsdPopover.tsx
   :language: tsx
   :lines: 120-346
   :lineno-match:

.. CG-EXPLANATION-START id=function:SamplePsdPopover

**What this does.** The component. It turns each grain-size test into a curve, decides whether any curve has points, reads the organic content, and re-checks the click hint against the sample's body id. It clamps its position inside the panel using the height that matches the shape it took plus any optional lines. It then draws the header, the optional organic line, and either the chart — a frame, a midline, one decade gridline per power of ten, the fixed sand/silt/clay boundary lines and zone labels, and one polyline per test curve — or the compact 'no grain-size test' line, followed by the optional click hint.

**Why it is here.** The comments record the reasons: the axis is fixed and inverted (coarse left) per the owner so every card is directly comparable and the boundaries never move; the click affordance moved off the marker's native tooltip onto the card because the tooltip covered the chart, and the body id is re-checked here so the card never promises a highlight on a sample the subdivision never reached; the organic line renders only when the sample was actually tested, never an empty row that would read as 'measured, and it was zero'; and narrow zones (like clay, only about 0.3 decade wide) stay line-only so their label does not collide with the frame.

.. CG-EXPLANATION-END id=function:SamplePsdPopover

``function decadeTicks``
------------------------

.. CG-BLOCK id=function:decadeTicks lines=347-358

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/SamplePsdPopover.tsx
   :language: tsx
   :lines: 347-358
   :lineno-match:

.. CG-EXPLANATION-START id=function:decadeTicks

**What this does.** Returns the powers of ten strictly inside a log domain, used as the chart's vertical gridlines.

**Why it is here.** The comment: a wide domain would fill the card with lines, so it caps defensively, though the mini chart only ever spans a handful of decades in practice.

.. CG-EXPLANATION-END id=function:decadeTicks

