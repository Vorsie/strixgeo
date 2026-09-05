desktop.renderer.src.components.CptChart
========================================

.. CG-PAGE source=desktop/src/renderer/src/components/CptChart.tsx complete=true

*Source file:* ``desktop/src/renderer/src/components/CptChart.tsx``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-29

.. literalinclude:: ../../../desktop/src/renderer/src/components/CptChart.tsx
   :language: tsx
   :lines: 1-29
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The imports for the CPT depth chart. In order they bring in: three React building blocks — ``useState`` (remember a value between redraws), ``useEffect`` (run a side task after a redraw) and ``useRef`` (hold a value that survives redraws without triggering one); a database icon; nine drawing parts from Recharts, the charting library this chart is built on (the chart frame, a line trace, the two axes, the grid, the hover tooltip, a reference line and a shaded reference band, and a container that resizes the chart to fit its box); three declared data shapes from the app's API client that describe the engine's plot reply; the inline elevation editor; the shared axis-scale numbers and tick lists; two helpers that name the vertical datum (mTAW or NAP); the DOV ghost-column component and the hook that fetches its model catalogue; the contact-overlay data shape; and the translation helper ``useT``.

**Why it is here.** This file is one *component* — a reusable piece of on-screen interface, written as a function that returns what to draw. This component is the CPT chart: it draws the cone-resistance (qc), sleeve-friction (fs), friction-ratio (Rf) and pore-pressure (u) traces down a depth axis. It is built on Recharts, which draws with *SVG* — a vector-drawing format, where the picture is described as shapes (lines, rectangles, text) so it stays crisp at any zoom — as opposed to *canvas*, which draws by colouring a fixed grid of pixels. The plot numbers are never read from the database directly; they arrive as a typed reply from the Python engine through the app's API client (the frontend always goes through the API — CLAUDE.md), and the axis scales are imported from one shared file so the per-unit distribution panels can promise 'the same axes as the CPT plot'. Text is translated through ``useT`` because translation happens at the presentation boundary, never in the engine (CLAUDE.md).

.. CG-EXPLANATION-END id=module-header

``interface Props``
-------------------

.. CG-BLOCK id=interface:Props lines=30-77

.. literalinclude:: ../../../desktop/src/renderer/src/components/CptChart.tsx
   :language: tsx
   :lines: 30-77
   :lineno-match:

.. CG-EXPLANATION-START id=interface:Props

**What this does.** The shape of the inputs this chart accepts. ``plot`` is the depth-series reply (the qc/fs/Rf/u arrays); ``name`` is the CPT's label; ``detail`` (optional) carries the header — elevation, datum, pre-drill depth and CPT type. ``onElevationChange`` (optional) is the save handler for the inline elevation editor. The block of ``virtueleBoring…`` inputs drive the optional DOV ghost column: the prediction data, which models are active, a maximum depth, whether the overlay is shown, a toggle handler, a per-pane model override plus its change handler, and a loading flag. ``contactOverlays`` (optional) is the list of faint depth lines marking every formation top and litho-unit top anchored at this CPT.

**Why it is here.** *props* are the inputs a component is given. Almost every input here is marked optional (the ``?``) on purpose: the source comments record that a read-only dashboard or a snapshot test renders the chart without a save handler and without DOV predictions, and those call sites must keep working — which also matches the additive-only API rule that new fields arrive optional (docs/api.md). An *overlay* here means an extra drawing layer painted on top of the traces — the faint contact lines and the DOV ghost column are both overlays. The comments spell out the domain contracts: all four DOV props must be present for the overlay to draw, and when the project's coordinate system is not Belgian Lambert 72 (EPSG:31370, one specific coordinate reference system) the toggle button stays disabled; the chart is informative-only and never lets the engineer edit these context lines.

.. CG-EXPLANATION-END id=interface:Props

``const Y_W``
-------------

.. CG-BLOCK id=const:Y_W lines=78-78

.. literalinclude:: ../../../desktop/src/renderer/src/components/CptChart.tsx
   :language: tsx
   :lines: 78-78
   :lineno-match:

.. CG-EXPLANATION-START id=const:Y_W

**What this does.** Sets the width — 52 pixels — used by every Y-axis in the chart, real or invisible.

**Why it is here.** Every Y-axis shares one width so the grid lines of the side-by-side panels line up exactly, as the comment states. A *ghost* axis (used below) is an invisible axis kept only to reserve this same gutter width.

.. CG-EXPLANATION-END id=const:Y_W

``const QC_MAX``
----------------

.. CG-BLOCK id=const:QC_MAX lines=79-79

.. literalinclude:: ../../../desktop/src/renderer/src/components/CptChart.tsx
   :language: tsx
   :lines: 79-79
   :lineno-match:

.. CG-EXPLANATION-START id=const:QC_MAX

**What this does.** Gives a short local name to the cone-resistance axis maximum, in MPa.

**Why it is here.** The real value lives in the shared ``cptAxisScales`` file so every surface that promises the same axes shares one source (the comment above); the local alias just keeps this file's axis wiring readable.

.. CG-EXPLANATION-END id=const:QC_MAX

``const FS_MAX``
----------------

.. CG-BLOCK id=const:FS_MAX lines=80-80

.. literalinclude:: ../../../desktop/src/renderer/src/components/CptChart.tsx
   :language: tsx
   :lines: 80-80
   :lineno-match:

.. CG-EXPLANATION-START id=const:FS_MAX

**What this does.** Gives a short local name to the sleeve-friction axis maximum, in MPa.

**Why it is here.** Same shared-source reason as ``QC_MAX`` above.

.. CG-EXPLANATION-END id=const:FS_MAX

``const RF_MAX``
----------------

.. CG-BLOCK id=const:RF_MAX lines=81-81

.. literalinclude:: ../../../desktop/src/renderer/src/components/CptChart.tsx
   :language: tsx
   :lines: 81-81
   :lineno-match:

.. CG-EXPLANATION-START id=const:RF_MAX

**What this does.** Gives a short local name to the friction-ratio axis maximum, in percent.

**Why it is here.** Same shared-source reason as ``QC_MAX``.

.. CG-EXPLANATION-END id=const:RF_MAX

``const U2_MIN``
----------------

.. CG-BLOCK id=const:U2_MIN lines=82-82

.. literalinclude:: ../../../desktop/src/renderer/src/components/CptChart.tsx
   :language: tsx
   :lines: 82-82
   :lineno-match:

.. CG-EXPLANATION-START id=const:U2_MIN

**What this does.** Gives a short local name to the pore-pressure axis minimum, in kPa.

**Why it is here.** Same shared-source reason as ``QC_MAX``; pore pressure can read negative, so its axis needs a minimum as well as a maximum.

.. CG-EXPLANATION-END id=const:U2_MIN

``const U2_MAX``
----------------

.. CG-BLOCK id=const:U2_MAX lines=83-90

.. literalinclude:: ../../../desktop/src/renderer/src/components/CptChart.tsx
   :language: tsx
   :lines: 83-90
   :lineno-match:

.. CG-EXPLANATION-START id=const:U2_MAX

**What this does.** Gives a short local name to the pore-pressure axis maximum (kPa), and opens the comment that explains the curve colours below: they are CSS custom properties — named colours defined once in ``index.css`` — with light-theme values equal to the old hard-coded colours and dark-theme values corrected for contrast.

**Why it is here.** The colours live in CSS variables so each curve keeps its hue but switches to a contrast-safe value on the dark background, clearing WCAG 2.2 AA; the comment notes Recharts passes these ``var(--…)`` strings straight into the SVG ``stroke``/``fill`` attributes, which resolve because the chart is drawn in the page and inherits the theme.

.. CG-EXPLANATION-END id=const:U2_MAX

``const GRID``
--------------

.. CG-BLOCK id=const:GRID lines=91-91

.. literalinclude:: ../../../desktop/src/renderer/src/components/CptChart.tsx
   :language: tsx
   :lines: 91-91
   :lineno-match:

.. CG-EXPLANATION-START id=const:GRID

**What this does.** Names the grid-line colour as a CSS variable.

**Why it is here.** Part of the theme-aware colour set described in the comment above ``U2_MAX``.

.. CG-EXPLANATION-END id=const:GRID

``const QC_CLR``
----------------

.. CG-BLOCK id=const:QC_CLR lines=92-92

.. literalinclude:: ../../../desktop/src/renderer/src/components/CptChart.tsx
   :language: tsx
   :lines: 92-92
   :lineno-match:

.. CG-EXPLANATION-START id=const:QC_CLR

**What this does.** Names the qc trace colour as a CSS variable.

**Why it is here.** Same theme-aware colour set as ``GRID``.

.. CG-EXPLANATION-END id=const:QC_CLR

``const FS_CLR``
----------------

.. CG-BLOCK id=const:FS_CLR lines=93-93

.. literalinclude:: ../../../desktop/src/renderer/src/components/CptChart.tsx
   :language: tsx
   :lines: 93-93
   :lineno-match:

.. CG-EXPLANATION-START id=const:FS_CLR

**What this does.** Names the fs trace colour as a CSS variable.

**Why it is here.** Same theme-aware colour set as ``GRID``.

.. CG-EXPLANATION-END id=const:FS_CLR

``const RF_CLR``
----------------

.. CG-BLOCK id=const:RF_CLR lines=94-94

.. literalinclude:: ../../../desktop/src/renderer/src/components/CptChart.tsx
   :language: tsx
   :lines: 94-94
   :lineno-match:

.. CG-EXPLANATION-START id=const:RF_CLR

**What this does.** Names the Rf trace colour as a CSS variable.

**Why it is here.** Same theme-aware colour set as ``GRID``.

.. CG-EXPLANATION-END id=const:RF_CLR

``const U2_CLR``
----------------

.. CG-BLOCK id=const:U2_CLR lines=95-95

.. literalinclude:: ../../../desktop/src/renderer/src/components/CptChart.tsx
   :language: tsx
   :lines: 95-95
   :lineno-match:

.. CG-EXPLANATION-START id=const:U2_CLR

**What this does.** Names the pore-pressure trace colour as a CSS variable.

**Why it is here.** Same theme-aware colour set as ``GRID``.

.. CG-EXPLANATION-END id=const:U2_CLR

``const QT_CLR``
----------------

.. CG-BLOCK id=const:QT_CLR lines=96-96

.. literalinclude:: ../../../desktop/src/renderer/src/components/CptChart.tsx
   :language: tsx
   :lines: 96-96
   :lineno-match:

.. CG-EXPLANATION-START id=const:QT_CLR

**What this does.** Names the total-resistance (Qt) trace colour as a CSS variable.

**Why it is here.** Same theme-aware colour set as ``GRID``.

.. CG-EXPLANATION-END id=const:QT_CLR

``const PD_CLR``
----------------

.. CG-BLOCK id=const:PD_CLR lines=97-100

.. literalinclude:: ../../../desktop/src/renderer/src/components/CptChart.tsx
   :language: tsx
   :lines: 97-100
   :lineno-match:

.. CG-EXPLANATION-START id=const:PD_CLR

**What this does.** Names the pre-drill colour as a CSS variable, and opens a comment noting that the next two colours are chrome — axis and grid decoration — not measurement curves.

**Why it is here.** Same theme-aware colour set; the comment flags that even these decorative colours need dark-surface contrast.

.. CG-EXPLANATION-END id=const:PD_CLR

``const SURFACE_REF_CLR``
-------------------------

.. CG-BLOCK id=const:SURFACE_REF_CLR lines=101-101

.. literalinclude:: ../../../desktop/src/renderer/src/components/CptChart.tsx
   :language: tsx
   :lines: 101-101
   :lineno-match:

.. CG-EXPLANATION-START id=const:SURFACE_REF_CLR

**What this does.** Names the colour of the surface-level reference line.

**Why it is here.** A chrome colour, part of the same theme-aware set.

.. CG-EXPLANATION-END id=const:SURFACE_REF_CLR

``const SURFACE_LABEL_CLR``
---------------------------

.. CG-BLOCK id=const:SURFACE_LABEL_CLR lines=102-108

.. literalinclude:: ../../../desktop/src/renderer/src/components/CptChart.tsx
   :language: tsx
   :lines: 102-108
   :lineno-match:

.. CG-EXPLANATION-START id=const:SURFACE_LABEL_CLR

**What this does.** Names the colour of the surface-level reference label, and includes the divider comment that introduces the depth-gap handling below.

**Why it is here.** The label colour is the last of the theme-aware chrome colours; the divider marks the start of the depth-gap code.

.. CG-EXPLANATION-END id=const:SURFACE_LABEL_CLR

``interface CptDataPoint``
--------------------------

.. CG-BLOCK id=interface:CptDataPoint lines=109-141

.. literalinclude:: ../../../desktop/src/renderer/src/components/CptChart.tsx
   :language: tsx
   :lines: 109-141
   :lineno-match:

.. CG-EXPLANATION-START id=interface:CptDataPoint

**What this does.** Declares the shape of one row of chart data: a ``depth`` plus five measurement channels — qc, fs, rf, u2 (in kPa) and qt — each of which may be a real number or ``null``. The long comment that follows is the documentation for the ``injectDepthGaps`` function below.

**Why it is here.** Every channel is allowed to be ``null`` so a 'sentinel' row — a depth with all channels empty — can force the trace lines to break across a genuine no-data interval instead of drawing a straight line through it. The documented case: a DOV CPT pushed to refusal and then continued by a drilled borehole, where the drilled interval has depths but no qc, and the correct picture is a broken line, not an interpolation. The comment explains the gap is detected here in the chart rather than by changing the engine's stored array, because making the stored qc array allow gaps would ripple through the ORM, the persist step and the API schema.

.. CG-EXPLANATION-END id=interface:CptDataPoint

``function injectDepthGaps``
----------------------------

.. CG-BLOCK id=function:injectDepthGaps lines=142-167

.. literalinclude:: ../../../desktop/src/renderer/src/components/CptChart.tsx
   :language: tsx
   :lines: 142-167
   :lineno-match:

.. CG-EXPLANATION-START id=function:injectDepthGaps

**What this does.** The gap-inserter. With fewer than two rows it returns them unchanged. Otherwise it walks the rows in depth order and, whenever two neighbours jump apart by more than the threshold (0.20 m by default), inserts one sentinel row at the midpoint with every channel null, then keeps the real row.

**Why it is here.** The default threshold is ten times the typical 2 cm DOV sampling step, so ordinary variable sampling never trips it but a real 0.5–5 m handoff gap does; the midpoint keeps any axis label sensible, and the all-null sentinel makes every trace line break there. The break is actually drawn because every ``Line`` in the chart sets ``connectNulls={false}``.

.. CG-EXPLANATION-END id=function:injectDepthGaps

``function makeLevelFmt``
-------------------------

.. CG-BLOCK id=function:makeLevelFmt lines=168-173

.. literalinclude:: ../../../desktop/src/renderer/src/components/CptChart.tsx
   :language: tsx
   :lines: 168-173
   :lineno-match:

.. CG-EXPLANATION-START id=function:makeLevelFmt

**What this does.** A *factory* that builds a number-formatting function. Given the surface elevation, it returns a *formatter* — a function that turns a depth into an absolute-level string (elevation minus depth, shown with a sign and one decimal) — or, when there is no elevation, one that just shows the depth.

**Why it is here.** *a factory* is a function that builds and returns another function; *a formatter* is a pure function that turns a value into display text. Producing the formatter once with the elevation baked in lets the axis and the tooltip reuse it per tick without repeating the arithmetic; the leading ``+`` marks positive levels so a value above datum is unmistakable.

.. CG-EXPLANATION-END id=function:makeLevelFmt

``const fmtDepth``
------------------

.. CG-BLOCK id=const:fmtDepth lines=174-176

.. literalinclude:: ../../../desktop/src/renderer/src/components/CptChart.tsx
   :language: tsx
   :lines: 174-176
   :lineno-match:

.. CG-EXPLANATION-START id=const:fmtDepth

**What this does.** A tiny formatter that shows a depth to one decimal place.

**Why it is here.** A plain fixed-format helper reused by the right-hand length (drilled-depth) axis.

.. CG-EXPLANATION-END id=const:fmtDepth

``function yLevel``
-------------------

.. CG-BLOCK id=function:yLevel lines=177-186

.. literalinclude:: ../../../desktop/src/renderer/src/components/CptChart.tsx
   :language: tsx
   :lines: 177-186
   :lineno-match:

.. CG-EXPLANATION-START id=function:yLevel

**What this does.** Builds the left-hand Y-axis showing level or depth. It returns a Recharts ``<YAxis>`` set to the given depth range, eleven ticks, the passed formatter and axis label, at the shared width.

**Why it is here.** A component describes what to draw as *JSX* — the markup-like syntax where each tag such as ``<YAxis …/>`` is one drawing part with its settings. Pulling the axis into a small builder lets the four side-by-side panels each request an identical left axis instead of repeating the same tag.

.. CG-EXPLANATION-END id=function:yLevel

``function yLength``
--------------------

.. CG-BLOCK id=function:yLength lines=187-196

.. literalinclude:: ../../../desktop/src/renderer/src/components/CptChart.tsx
   :language: tsx
   :lines: 187-196
   :lineno-match:

.. CG-EXPLANATION-START id=function:yLength

**What this does.** Builds the right-hand Y-axis showing drilled length (depth below the CPT start), using the plain depth formatter.

**Why it is here.** The mirror of ``yLevel`` for the right side, so one panel can show absolute level on the left and drilled length on the right at once; the shared width keeps the panels aligned.

.. CG-EXPLANATION-END id=function:yLength

``function yGhostLeft``
-----------------------

.. CG-BLOCK id=function:yGhostLeft lines=197-203

.. literalinclude:: ../../../desktop/src/renderer/src/components/CptChart.tsx
   :language: tsx
   :lines: 197-203
   :lineno-match:

.. CG-EXPLANATION-START id=function:yGhostLeft

**What this does.** Builds an invisible left Y-axis — correct depth range and width, but no ticks, no line and no labels.

**Why it is here.** The middle and right panels must reserve the same left gutter as the leftmost panel so every panel's plot area starts at the same x; a *ghost* axis holds that width without repeating the tick labels.

.. CG-EXPLANATION-END id=function:yGhostLeft

``function yGhostRight``
------------------------

.. CG-BLOCK id=function:yGhostRight lines=204-212

.. literalinclude:: ../../../desktop/src/renderer/src/components/CptChart.tsx
   :language: tsx
   :lines: 204-212
   :lineno-match:

.. CG-EXPLANATION-START id=function:yGhostRight

**What this does.** Builds an invisible right Y-axis, the mirror of ``yGhostLeft``.

**Why it is here.** Same gutter-reservation reason for the right side, so panels that are not the rightmost still leave room for the length axis and stay aligned.

.. CG-EXPLANATION-END id=function:yGhostRight

``function CptChart``
---------------------

.. CG-BLOCK id=function:CptChart lines=213-726

.. literalinclude:: ../../../desktop/src/renderer/src/components/CptChart.tsx
   :language: tsx
   :lines: 213-726
   :lineno-match:

.. CG-EXPLANATION-START id=function:CptChart

**What this does.** The chart component itself. It unpacks its props (with safe defaults), lazily fetches the DOV model catalogue only when the override dropdown is present, and reads elevation, datum, pre-drill and CPT type from ``detail``. It maps the plot arrays into one row per depth (qc/fs/Rf, pore pressure converted MPa→kPa, and the total-resistance qt), then runs ``injectDepthGaps`` to break the lines across no-data gaps, and works out the deepest point. It keeps two remembered values with ``useState`` — the zoom window and a drag flag — and a ``useRef`` copy of the zoom window so the mouse listeners always see the latest one. One effect resets the zoom whenever a new CPT is loaded; a second effect attaches native mouse listeners to the panels box: the wheel zooms in on the depth under the cursor, and click-drag pans up and down when zoomed. It then computes which channels exist (fs, Rf, u2, qt), the level/datum labels, and the data trimmed to the visible window, and defines small helper builders for the pre-drill band, the surface-level line, the faint contact overlays and the three data panels (u2, qc/fs, Rf). Finally it returns the whole chart: a header with the run summary and the inline elevation editor, a legend with zoom buttons and the DOV overlay toggle plus its model dropdown, and the side-by-side panels — each a resizing Recharts chart — ending with the optional DOV depth column.

**Why it is here.** The zoom and pan are wired with native ``addEventListener('wheel', …, { passive: false })`` rather than React's own handlers because React's wheel handler is passive — its ``preventDefault`` does nothing — so intercepting the page scroll to zoom needs the native listener (CLAUDE.md). The ``useRef`` copy of the zoom window exists so those listeners read the current value without being torn down and re-attached on every zoom, and the reset-on-new-CPT effect keeps a fresh CPT from opening at the previous one's zoom. The row builder keeps qc as the raw measurement and takes qt from the separate ``q_total_mpa`` column: total resistance (CPTM) and corrected qc (CPTU) are physically different quantities stored in distinct columns and never both present, so they are never auto-derived from each other (project_qt_vs_qtotal). Ic is deliberately absent — Ic and the SBT zones are interpretation, a characterisation output that lives in the Parameters stage, not a raw measurement shown here (debt #22). The contact and DOV overlays are informative-only; zoom is a reversible view change, so it fires immediately and offers a Reset button rather than any confirmation, and every user-facing string goes through ``t`` at the presentation boundary.

.. CG-EXPLANATION-END id=function:CptChart

``interface LabelEntry``
------------------------

.. CG-BLOCK id=interface:LabelEntry lines=727-728

.. literalinclude:: ../../../desktop/src/renderer/src/components/CptChart.tsx
   :language: tsx
   :lines: 727-728
   :lineno-match:

.. CG-EXPLANATION-START id=interface:LabelEntry

**What this does.** A two-field shape — a colour and a text — describing one corner label drawn over a panel.

**Why it is here.** Names the small record the ``ChartLabel`` overlay uses for each of its up-to-two labels.

.. CG-EXPLANATION-END id=interface:LabelEntry

``function ChartLabel``
-----------------------

.. CG-BLOCK id=function:ChartLabel lines=729-744

.. literalinclude:: ../../../desktop/src/renderer/src/components/CptChart.tsx
   :language: tsx
   :lines: 729-744
   :lineno-match:

.. CG-EXPLANATION-START id=function:ChartLabel

**What this does.** A small component that draws a channel caption in the bottom corners of a panel — the left caption always, the right one when given. It is positioned absolutely, inset by the axis width on each side, and set to ignore the mouse.

**Why it is here.** This is an *overlay* — a drawing layer painted on top of the chart, here the coloured 'qc (MPa)' / 'fs (MPa)' captions. It is inset by ``Y_W`` on each side so the text lines up under the plot area, not the axis gutters, and lifted 46 px to clear the chart's bottom axis (the comment records the arithmetic); ``pointer-events-none`` lets clicks and the zoom/pan gestures pass straight through to the chart beneath.

.. CG-EXPLANATION-END id=function:ChartLabel

``function LegendItem``
-----------------------

.. CG-BLOCK id=function:LegendItem lines=745-752

.. literalinclude:: ../../../desktop/src/renderer/src/components/CptChart.tsx
   :language: tsx
   :lines: 745-752
   :lineno-match:

.. CG-EXPLANATION-START id=function:LegendItem

**What this does.** A tiny component that draws one legend row: a short coloured rule (dashed when asked) followed by its label.

**Why it is here.** Factored out so the legend line at the top can list each visible channel with its matching curve colour in one consistent shape.

.. CG-EXPLANATION-END id=function:LegendItem

