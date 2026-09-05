desktop.renderer.src.shell.stages.parameters.UnitPsdPanel
=========================================================

.. CG-PAGE source=desktop/src/renderer/src/shell/stages/parameters/UnitPsdPanel.tsx complete=true

*Source file:* ``desktop/src/renderer/src/shell/stages/parameters/UnitPsdPanel.tsx``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-30

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/parameters/UnitPsdPanel.tsx
   :language: tsx
   :lines: 1-30
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Names the file (all of the unit's grain-size curves on one graph) and imports its pieces: React state, the pooled-curve types, the per-sample colour helper, the translation hook, a shared right-click menu, and the shared grain-size geometry (the fixed particle-size window and the polyline builder). Grain-size distribution (PSD, Dutch "korrelverdeling") is the cumulative percent-passing curve against particle diameter.

**Why it is here.** Owner ruling S5 (2026-08-27): "I'm missing all PSD's on one graph." The axis is deliberately the section hover card's own convention — a fixed window from 63 down to 0.001 mm, drawn on a logarithmic scale and INVERTED so coarse is on the left (owner, 2026-08-14: "the PSD x-axis should be inverted") — so a curve read here and the same curve on the section look identical. A log axis spaces each ten-fold change in diameter equally, which is how sieve sizes are conventionally read. The geometry is shared with the hover card (one maths, two surfaces). The percent-passing runs 0 at the bottom to 100 at the top, with the conventional sieve boundaries labelled. A unit with no drawable curve renders nothing at all (no empty jars).

.. CG-EXPLANATION-END id=module-header

``const PLOT_W``
----------------

.. CG-BLOCK id=const:PLOT_W lines=31-31

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/parameters/UnitPsdPanel.tsx
   :language: tsx
   :lines: 31-31
   :lineno-match:

.. CG-EXPLANATION-START id=const:PLOT_W

**What this does.** The plot box width in drawing units, 100.

**Why it is here.** The graph is drawn in a fixed 100-wide space and then stretched to the row width; a named constant keeps that width in one place for the geometry.

.. CG-EXPLANATION-END id=const:PLOT_W

``const PLOT_H``
----------------

.. CG-BLOCK id=const:PLOT_H lines=32-32

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/parameters/UnitPsdPanel.tsx
   :language: tsx
   :lines: 32-32
   :lineno-match:

.. CG-EXPLANATION-START id=const:PLOT_H

**What this does.** The plot box height in drawing units, 60.

**Why it is here.** Same fixed drawing space as the width; a named constant keeps the height in one place.

.. CG-EXPLANATION-END id=const:PLOT_H

``const GRID``
--------------

.. CG-BLOCK id=const:GRID lines=33-35

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/parameters/UnitPsdPanel.tsx
   :language: tsx
   :lines: 33-35
   :lineno-match:

.. CG-EXPLANATION-START id=const:GRID

**What this does.** The gridline colour, read from a theme variable so it follows light and dark mode.

**Why it is here.** Reading the colour from a CSS variable lets the grid adapt to the viewer's theme automatically instead of being hard-coded.

.. CG-EXPLANATION-END id=const:GRID

``const SIEVE_ANCHORS``
-----------------------

.. CG-BLOCK id=const:SIEVE_ANCHORS lines=36-38

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/parameters/UnitPsdPanel.tsx
   :language: tsx
   :lines: 36-38
   :lineno-match:

.. CG-EXPLANATION-START id=const:SIEVE_ANCHORS

**What this does.** The five conventional particle diameters that get a labelled gridline: 63, 2, 0.2, 0.063 and 0.002 mm.

**Why it is here.** These are the standard fraction boundaries (gravel/sand, sand/silt, silt/clay) plus the 0.2 mm fine/medium-sand sieve, so the labelled lines match how an engineer reads a grading curve.

.. CG-EXPLANATION-END id=const:SIEVE_ANCHORS

``const PCT_TICKS``
-------------------

.. CG-BLOCK id=const:PCT_TICKS lines=39-41

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/parameters/UnitPsdPanel.tsx
   :language: tsx
   :lines: 39-41
   :lineno-match:

.. CG-EXPLANATION-START id=const:PCT_TICKS

**What this does.** The percent-passing gridline and label positions: 0, 25, 50, 75, 100.

**Why it is here.** Quartered percent lines give the curve a familiar reference grid without crowding the axis.

.. CG-EXPLANATION-END id=const:PCT_TICKS

``function anchorFraction``
---------------------------

.. CG-BLOCK id=function:anchorFraction lines=42-48

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/parameters/UnitPsdPanel.tsx
   :language: tsx
   :lines: 42-48
   :lineno-match:

.. CG-EXPLANATION-START id=function:anchorFraction

**What this does.** Converts a particle diameter in millimetres into its left-to-right position on the plot, as a fraction from 0 to 1, using the fixed log window and inverting it so a coarse (large) diameter sits toward the left.

**Why it is here.** Positions on a logarithmic, inverted axis are not linear in millimetres, so this single conversion places every gridline, label and (indirectly) curve point consistently on the same convention the hover card uses.

.. CG-EXPLANATION-END id=function:anchorFraction

``function anchorLabel``
------------------------

.. CG-BLOCK id=function:anchorLabel lines=49-72

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/parameters/UnitPsdPanel.tsx
   :language: tsx
   :lines: 49-72
   :lineno-match:

.. CG-EXPLANATION-START id=function:anchorLabel

**What this does.** Formats an anchor diameter for its label: a whole number at or above 1 mm, its plain value down to 0.01, and three decimals below that.

**Why it is here.** The sub-millimetre sieves need their decimals shown to be legible, while the coarse anchors read cleanest as whole numbers — so the format is chosen by size.

.. CG-EXPLANATION-END id=function:anchorLabel

``function UnitPsdPanel``
-------------------------

.. CG-BLOCK id=function:UnitPsdPanel lines=73-325

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/parameters/UnitPsdPanel.tsx
   :language: tsx
   :lines: 73-325
   :lineno-match:

.. CG-EXPLANATION-START id=function:UnitPsdPanel

**What this does.** The graph component. It shows nothing when the unit has no curves. Otherwise it draws a header with the curve count (and any skipped-count), a labelled percent-passing axis up the side, the fraction-zone names across the top, the percent and sieve gridlines, and one polyline per grain-size test — each inked by its sample and carrying a tooltip that names the borehole, sample and depth. When a reveal handler is supplied it also wires a right-click menu ("go to the sample on a cross-section") onto each curve, with a wide transparent stroke so the right-click reliably lands on the thin line.

**Why it is here.** The fixed, inverted log axis and the shared polyline maths keep this graph identical to the section hover card, so the same curve is the same picture in both places. Each curve wears its sample's colour so the scatter dots above and the two grain-size records of one sample (sieve plus hydrometer) all match. The state hook is declared before the early "no curves" return so the hook order stays stable either way (the rules of hooks). The right-click menu is offered only when a reveal handler exists, so the panel never advertises an action nothing can honour; the reveal itself is the shell's job, and this panel only names the sample and hands the curve up. The menu reuses the shared context-menu so Escape and an outside click dismiss it, like every other right-click menu in the app.

.. CG-EXPLANATION-END id=function:UnitPsdPanel

