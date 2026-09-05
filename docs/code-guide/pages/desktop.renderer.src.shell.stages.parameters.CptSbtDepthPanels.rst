desktop.renderer.src.shell.stages.parameters.CptSbtDepthPanels
==============================================================

.. CG-PAGE source=desktop/src/renderer/src/shell/stages/parameters/CptSbtDepthPanels.tsx complete=true

*Source file:* ``desktop/src/renderer/src/shell/stages/parameters/CptSbtDepthPanels.tsx``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-39

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/parameters/CptSbtDepthPanels.tsx
   :language: tsx
   :lines: 1-39
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Opens the tall, depth-synced panel stack for one CPT: a qc curve, a combined fs-and-Rf curve, an Ic curve, and both Robertson soil-behaviour-type strips side by side. It imports the translator, the API types, the shared Robertson axis and zone spec, the pure geometry helpers, and the Ic and zone fill tables. SVG is Scalable Vector Graphics — shapes described by numbers that stay crisp at any zoom.

**Why it is here.** The owner's 2026-08-03 dogfeed called the old inline Ic chart 'all horizontal and squished'; a depth series reads TALL (the CptChart convention), so this draws a fixed number of pixels per metre down a scrollable column instead of squeezing the whole hole into one viewport, and every panel shares one depth scale so a feature at 7.4 m lines up across all five. Ruling 4 shows BOTH classifiers — the full normalised Robertson-2015 pipeline on the left and the non-normalised one on the right — because where they disagree is exactly what the engineer needs to see, so neither is hidden behind a toggle. It is plain SVG rather than Recharts because five roughly 90 px panels in a 420 px inspector is a layout Recharts' responsive container fights, and only a polyline, a band rectangle and a run of fills are needed. Method: Robertson (2009 / 2015).

.. CG-EXPLANATION-END id=module-header

``const PX_PER_METRE``
----------------------

.. CG-BLOCK id=const:PX_PER_METRE lines=40-40

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/parameters/CptSbtDepthPanels.tsx
   :language: tsx
   :lines: 40-40
   :lineno-match:

.. CG-EXPLANATION-START id=const:PX_PER_METRE

**What this does.** The vertical scale: 28 pixels per metre of depth.

**Why it is here.** 28 px per metre puts a 30 m CPT at 840 px — about two inspector heights — so the panel scrolls rather than compressing, and deep holes stay legible.

.. CG-EXPLANATION-END id=const:PX_PER_METRE

``const MIN_CONTENT_H``
-----------------------

.. CG-BLOCK id=const:MIN_CONTENT_H lines=41-44

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/parameters/CptSbtDepthPanels.tsx
   :language: tsx
   :lines: 41-44
   :lineno-match:

.. CG-EXPLANATION-START id=const:MIN_CONTENT_H

**What this does.** A floor of 420 pixels on the panel height.

**Why it is here.** So a shallow hole (a 2 m CPT) is not drawn as a postage stamp.

.. CG-EXPLANATION-END id=const:MIN_CONTENT_H

``const RULER_W``
-----------------

.. CG-BLOCK id=const:RULER_W lines=45-45

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/parameters/CptSbtDepthPanels.tsx
   :language: tsx
   :lines: 45-45
   :lineno-match:

.. CG-EXPLANATION-START id=const:RULER_W

**What this does.** The width of the depth-ruler column, 34 px.

**Why it is here.** Fixes the ruler column width so the header row and the body row line up.

.. CG-EXPLANATION-END id=const:RULER_W

``const STRIP_W``
-----------------

.. CG-BLOCK id=const:STRIP_W lines=46-48

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/parameters/CptSbtDepthPanels.tsx
   :language: tsx
   :lines: 46-48
   :lineno-match:

.. CG-EXPLANATION-START id=const:STRIP_W

**What this does.** The width of each categorical zone strip, 22 px.

**Why it is here.** The strips are narrow on purpose: they are categorical, so they carry no axis and need only enough width to read as a colour run.

.. CG-EXPLANATION-END id=const:STRIP_W

``const QC_CLR``
----------------

.. CG-BLOCK id=const:QC_CLR lines=49-49

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/parameters/CptSbtDepthPanels.tsx
   :language: tsx
   :lines: 49-49
   :lineno-match:

.. CG-EXPLANATION-START id=const:QC_CLR

**What this does.** The qc curve colour, a CSS variable with a blue fallback.

**Why it is here.** A CSS variable from index.css so the colour works in both dark and light themes.

.. CG-EXPLANATION-END id=const:QC_CLR

``const FS_CLR``
----------------

.. CG-BLOCK id=const:FS_CLR lines=50-50

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/parameters/CptSbtDepthPanels.tsx
   :language: tsx
   :lines: 50-50
   :lineno-match:

.. CG-EXPLANATION-START id=const:FS_CLR

**What this does.** The fs curve colour, a CSS variable with a green fallback.

**Why it is here.** A theme-driven CSS variable, the same friction colour used elsewhere in the app.

.. CG-EXPLANATION-END id=const:FS_CLR

``const RF_CLR``
----------------

.. CG-BLOCK id=const:RF_CLR lines=51-51

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/parameters/CptSbtDepthPanels.tsx
   :language: tsx
   :lines: 51-51
   :lineno-match:

.. CG-EXPLANATION-START id=const:RF_CLR

**What this does.** The Rf curve colour, a CSS variable with an orange fallback.

**Why it is here.** A theme-driven CSS variable for the friction-ratio curve.

.. CG-EXPLANATION-END id=const:RF_CLR

``const IC_CLR``
----------------

.. CG-BLOCK id=const:IC_CLR lines=52-52

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/parameters/CptSbtDepthPanels.tsx
   :language: tsx
   :lines: 52-52
   :lineno-match:

.. CG-EXPLANATION-START id=const:IC_CLR

**What this does.** The Ic curve colour, a CSS variable with a purple fallback.

**Why it is here.** A theme-driven CSS variable for the derived Ic curve.

.. CG-EXPLANATION-END id=const:IC_CLR

``const GRID``
--------------

.. CG-BLOCK id=const:GRID lines=53-55

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/parameters/CptSbtDepthPanels.tsx
   :language: tsx
   :lines: 53-55
   :lineno-match:

.. CG-EXPLANATION-START id=const:GRID

**What this does.** The gridline colour, a CSS variable with a light-grey fallback.

**Why it is here.** A CSS variable so the depth gridlines follow the theme.

.. CG-EXPLANATION-END id=const:GRID

``const UNCLASSIFIED_FILL``
---------------------------

.. CG-BLOCK id=const:UNCLASSIFIED_FILL lines=56-57

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/parameters/CptSbtDepthPanels.tsx
   :language: tsx
   :lines: 56-57
   :lineno-match:

.. CG-EXPLANATION-START id=const:UNCLASSIFIED_FILL

**What this does.** The fill for a depth point neither classifier could evaluate — transparent.

**Why it is here.** An unclassifiable point (no sleeve friction) is an absence; painting it a colour would read as a soil.

.. CG-EXPLANATION-END id=const:UNCLASSIFIED_FILL

``interface Props``
-------------------

.. CG-BLOCK id=interface:Props lines=58-80

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/parameters/CptSbtDepthPanels.tsx
   :language: tsx
   :lines: 58-80
   :lineno-match:

.. CG-EXPLANATION-START id=interface:Props

**What this does.** Declares the stack's inputs: the raw depth series from the plot endpoint, and both SBT classifications (null while the profile is still loading).

**Why it is here.** A null profile lets the curve panels render alone rather than blocking them, because the raw measurements are already fetched and useful on their own.

.. CG-EXPLANATION-END id=interface:Props

``function CptSbtDepthPanels``
------------------------------

.. CG-BLOCK id=function:CptSbtDepthPanels lines=81-219

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/parameters/CptSbtDepthPanels.tsx
   :language: tsx
   :lines: 81-219
   :lineno-match:

.. CG-EXPLANATION-START id=function:CptSbtDepthPanels

**What this does.** Draws the stack. It reads the depths, works out the content height from the deepest sample (floored), computes each curve's axis maximum from its own data, chooses a depth-grid step, and collapses each SBT strip into contiguous colour runs. It then lays out aligned column headers, a scrollable body holding the depth ruler, the qc / fs-and-Rf / Ic curve panels and the two zone strips, a legend of only the zones this hole contains, and a provenance line naming which water table fed the strips.

**Why it is here.** The strips are collapsed to runs (memoised on the profile identity) because a 2 cm-sampled 30 m hole is about 1500 points per strip, almost all sharing a zone with the sample above — one rectangle per run draws the identical picture from the few intervals that actually exist. The Ic band background travels with the curve from the shared fill table so the chart and the classifier cannot disagree at a zone edge. The water table's source is shown because provenance attaches to the derived thing itself (Data Integrity Rule 1).

.. CG-EXPLANATION-END id=function:CptSbtDepthPanels

``function ColumnHeader``
-------------------------

.. CG-BLOCK id=function:ColumnHeader lines=220-230

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/parameters/CptSbtDepthPanels.tsx
   :language: tsx
   :lines: 220-230
   :lineno-match:

.. CG-EXPLANATION-START id=function:ColumnHeader

**What this does.** A small component for one column header — a label with a hover hint giving that column's numeric range.

**Why it is here.** Sharing the body row's widths keeps the headers aligned over their columns, and the hint carries the axis range without spending vertical space on a full axis.

.. CG-EXPLANATION-END id=function:ColumnHeader

``function DepthRuler``
-----------------------

.. CG-BLOCK id=function:DepthRuler lines=231-256

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/parameters/CptSbtDepthPanels.tsx
   :language: tsx
   :lines: 231-256
   :lineno-match:

.. CG-EXPLANATION-START id=function:DepthRuler

**What this does.** Draws the shared depth ruler: a label every grid-step metres, placed down the column by the same depth-to-y mapping every panel uses.

**Why it is here.** One ruler shared by all panels is what lets a depth be read off the stack without a per-panel axis; the small upward lift places each label on its own gridline rather than below it.

.. CG-EXPLANATION-END id=function:DepthRuler

``interface CurveSpec``
-----------------------

.. CG-BLOCK id=interface:CurveSpec lines=257-269

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/parameters/CptSbtDepthPanels.tsx
   :language: tsx
   :lines: 257-269
   :lineno-match:

.. CG-EXPLANATION-START id=interface:CurveSpec

**What this does.** The shape of one curve to draw: its per-depth values, its axis maximum, and its colour.

**Why it is here.** So one panel can take one or two curves — qc alone, or fs and Rf together — described uniformly.

.. CG-EXPLANATION-END id=interface:CurveSpec

``function CurvePanel``
-----------------------

.. CG-BLOCK id=function:CurvePanel lines=270-339

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/parameters/CptSbtDepthPanels.tsx
   :language: tsx
   :lines: 270-339
   :lineno-match:

.. CG-EXPLANATION-START id=function:CurvePanel

**What this does.** Draws one vertical curve panel: an optional set of Ic band-background rectangles, the depth gridlines, and one or two depth series as SVG paths.

**Why it is here.** ``preserveAspectRatio='none'`` lets the 0-to-100 user-space X map onto whatever pixel width flexbox gives the column, and ``vectorEffect='non-scaling-stroke'`` keeps that non-uniform stretch from distorting the line weight.

.. CG-EXPLANATION-END id=function:CurvePanel

``function ZoneStrip``
----------------------

.. CG-BLOCK id=function:ZoneStrip lines=340-390

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/parameters/CptSbtDepthPanels.tsx
   :language: tsx
   :lines: 340-390
   :lineno-match:

.. CG-EXPLANATION-START id=function:ZoneStrip

**What this does.** Draws one categorical SBT strip as a stack of coloured rectangles, one per zone run, each carrying a hover title with its depth span and its zone label.

**Why it is here.** A null zone is left transparent rather than coloured, because an unclassifiable point (no sleeve friction) is an absence and painting it would read as a soil.

.. CG-EXPLANATION-END id=function:ZoneStrip

``function ZoneLegend``
-----------------------

.. CG-BLOCK id=function:ZoneLegend lines=391-431

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/parameters/CptSbtDepthPanels.tsx
   :language: tsx
   :lines: 391-431
   :lineno-match:

.. CG-EXPLANATION-START id=function:ZoneLegend

**What this does.** Draws the colour key, but only for the zones actually present across both strips of this CPT — a swatch and a short label per zone, sorted.

**Why it is here.** So a three-zone hole does not carry a nine-row key.

.. CG-EXPLANATION-END id=function:ZoneLegend

``default default``
-------------------

.. CG-BLOCK id=default:default lines=432-432

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/parameters/CptSbtDepthPanels.tsx
   :language: tsx
   :lines: 432-432
   :lineno-match:

.. CG-EXPLANATION-START id=default:default

**What this does.** Exports the stack wrapped in React's ``memo``.

**Why it is here.** Without memo, every keystroke in the water-table draft above the panel rebuilt the whole SVG tree; its two props change identity only when a real fetch lands, which is exactly the shape memo wants.

.. CG-EXPLANATION-END id=default:default

