desktop.renderer.src.shell.stages.parameters.UnitDistributionChannelRow
=======================================================================

.. CG-PAGE source=desktop/src/renderer/src/shell/stages/parameters/UnitDistributionChannelRow.tsx complete=true

*Source file:* ``desktop/src/renderer/src/shell/stages/parameters/UnitDistributionChannelRow.tsx``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-36

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/parameters/UnitDistributionChannelRow.tsx
   :language: tsx
   :lines: 1-36
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Opens the file for one channel's row of the distribution panel — its axis, box, whisker, sample strip and numeric read-outs. The comment explains the colour choice, and the imports pull in ``useMemo``, the fixed CPT axis scales and tick helpers, the translator, the shared ``AxisTickRow`` and the statistics types.

**Why it is here.** The comment records why it was split from ``UnitDistributionPanels`` (the second-dogfeed rulings pushed the panel past the 500-line gate, debt #201) and why the three channel colours are the same ones the depth panels use — the same measurement wears the same ink directly above in the same inspector. Those three hues fail the categorical-palette validator's separation checks, but that check exists to tell two series apart INSIDE one chart, and here every chart has exactly one series named by its own title; the check that does matter for a single mark, contrast against the surface, passes in both light and dark.

.. CG-EXPLANATION-END id=module-header

``const PLOT_W``
----------------

.. CG-BLOCK id=const:PLOT_W lines=37-37

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/parameters/UnitDistributionChannelRow.tsx
   :language: tsx
   :lines: 37-37
   :lineno-match:

.. CG-EXPLANATION-START id=const:PLOT_W

**What this does.** The plot's user-space width, 100.

**Why it is here.** The row draws in a 0-to-100 box stretched to the real width by a non-uniform viewBox, the same trick the depth panels use, so the geometry stays in percentages and never needs the pixel width of the inspector.

.. CG-EXPLANATION-END id=const:PLOT_W

``const PLOT_H``
----------------

.. CG-BLOCK id=const:PLOT_H lines=38-39

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/parameters/UnitDistributionChannelRow.tsx
   :language: tsx
   :lines: 38-39
   :lineno-match:

.. CG-EXPLANATION-START id=const:PLOT_H

**What this does.** The plot's user-space height, 34.

**Why it is here.** Fixes the vertical extent of the drawing box the box, whisker and strip are placed within.

.. CG-EXPLANATION-END id=const:PLOT_H

``const AXIS_Y``
----------------

.. CG-BLOCK id=const:AXIS_Y lines=40-41

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/parameters/UnitDistributionChannelRow.tsx
   :language: tsx
   :lines: 40-41
   :lineno-match:

.. CG-EXPLANATION-START id=const:AXIS_Y

**What this does.** The vertical centre line of the box and whisker, at y 13.

**Why it is here.** A single constant so the whisker, the box and the median line all share one centre line.

.. CG-EXPLANATION-END id=const:AXIS_Y

``const BOX_HALF_H``
--------------------

.. CG-BLOCK id=const:BOX_HALF_H lines=42-43

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/parameters/UnitDistributionChannelRow.tsx
   :language: tsx
   :lines: 42-43
   :lineno-match:

.. CG-EXPLANATION-START id=const:BOX_HALF_H

**What this does.** Half the height of the box rectangle, 6 user-space units.

**Why it is here.** The box is drawn from the centre line up and down by this amount, so one value sets its full height.

.. CG-EXPLANATION-END id=const:BOX_HALF_H

``const STRIP_TOP``
-------------------

.. CG-BLOCK id=const:STRIP_TOP lines=44-44

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/parameters/UnitDistributionChannelRow.tsx
   :language: tsx
   :lines: 44-44
   :lineno-match:

.. CG-EXPLANATION-START id=const:STRIP_TOP

**What this does.** The top of the band the jittered sample dots occupy, at y 22 — below the box.

**Why it is here.** Places the raw-dot strip clear of the box so the two do not overlap.

.. CG-EXPLANATION-END id=const:STRIP_TOP

``const STRIP_H``
-----------------

.. CG-BLOCK id=const:STRIP_H lines=45-55

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/parameters/UnitDistributionChannelRow.tsx
   :language: tsx
   :lines: 45-55
   :lineno-match:

.. CG-EXPLANATION-START id=const:STRIP_H

**What this does.** The height of the dot strip, 10 user-space units.

**Why it is here.** Bounds the vertical band the jitter scatters the dots across.

.. CG-EXPLANATION-END id=const:STRIP_H

``const MAX_STRIP_DOTS``
------------------------

.. CG-BLOCK id=const:MAX_STRIP_DOTS lines=56-69

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/parameters/UnitDistributionChannelRow.tsx
   :language: tsx
   :lines: 56-69
   :lineno-match:

.. CG-EXPLANATION-START id=const:MAX_STRIP_DOTS

**What this does.** The most sample dots the strip will draw, 400.

**Why it is here.** A 30 m unit sampled every 2 cm is about 1500 readings per band, and three channels of those would be thousands of on-screen nodes for a picture that stops changing long before that. It subsamples EVENLY over the sorted samples, which preserves the shape of the distribution — a systematic sample of the order statistics, not a random or head-first cut — and the reported count is always the true count.

.. CG-EXPLANATION-END id=const:MAX_STRIP_DOTS

``const CHANNEL_SPEC``
----------------------

.. CG-BLOCK id=const:CHANNEL_SPEC lines=70-98

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/parameters/UnitDistributionChannelRow.tsx
   :language: tsx
   :lines: 70-98
   :lineno-match:

.. CG-EXPLANATION-START id=const:CHANNEL_SPEC

**What this does.** A per-channel table of how each row presents: its title key, its unit string, its colour, its decimal places and its axis maximum. qc and fs are in MPa, Rf in percent, each with the CPT plot's own full-scale maximum.

**Why it is here.** The axis maxima are the DOV standard fixed ranges from ``utils/cptAxisScales.ts``, the one source ``CptChart`` also reads (owner 2026-08-27, verbatim: 'Qc/fs/rf should start at zero, u can use the same axes as the cpt plot'). A fixed zero-anchored axis is what makes two units — and a unit against its own CPT chart — comparable at a glance; the observed-range axis it replaced made every unit's box look the same width.

.. CG-EXPLANATION-END id=const:CHANNEL_SPEC

``const GRID``
--------------

.. CG-BLOCK id=const:GRID lines=99-101

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/parameters/UnitDistributionChannelRow.tsx
   :language: tsx
   :lines: 99-101
   :lineno-match:

.. CG-EXPLANATION-START id=const:GRID

**What this does.** The gridline colour, a CSS variable with a light-grey fallback.

**Why it is here.** A CSS variable so the gridlines follow the theme; the fallback keeps them visible if the variable is ever missing.

.. CG-EXPLANATION-END id=const:GRID

``function ChannelRow``
-----------------------

.. CG-BLOCK id=function:ChannelRow lines=102-363

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/parameters/UnitDistributionChannelRow.tsx
   :language: tsx
   :lines: 102-363
   :lineno-match:

.. CG-EXPLANATION-START id=function:ChannelRow

**What this does.** Draws one channel's whole row. It picks the axis maximum (the fixed CPT scale, or in fit mode zero to the pooled maximum rounded up to a tick), splits the samples into on-axis and off-axis sets, evenly subsamples the on-axis dots, and works out which summary marks the axis cannot place. It then renders an SVG with tick gridlines, the P5-to-P95 whisker, the Q1-to-Q3 box, the median line and the jittered dots — each mark drawn only when the axis can place it whole — followed by the shared tick-label row, the axis title, an off-axis notifier, and a wrap-around table of the numeric statistics.

**Why it is here.** The fit toggle (S1) trades cross-unit comparability for resolution on demand and reverts exactly. Off-axis readings are the S2 ruling (owner 2026-08-27): nothing is clamped to the wall — a reading past the axis end, or a negative artefact a zero-anchored axis cannot place, is excluded from the strip and counted for the notifier instead, while the numeric read-outs still report the true values. A summary mark that spans off-axis values is never dropped silently; the notifier names which mark went missing and why (audit F6). The dots carry a deterministic pseudo-jitter keyed on their index so a re-render draws the identical picture — a strip that dances is a strip nobody trusts. The table exists because the plot is never the only way to read the numbers, and it is what an engineer copies into a report.

.. CG-EXPLANATION-END id=function:ChannelRow

``function Stat``
-----------------

.. CG-BLOCK id=function:Stat lines=364-385

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/parameters/UnitDistributionChannelRow.tsx
   :language: tsx
   :lines: 364-385
   :lineno-match:

.. CG-EXPLANATION-START id=function:Stat

**What this does.** A tiny component for one labelled number in the read-out row: a muted label followed by the formatted value, tagged with a stable test id.

**Why it is here.** The test id stays English across locales so the end-to-end test selectors do not move when the display label is translated.

.. CG-EXPLANATION-END id=function:Stat

``function fmt``
----------------

.. CG-BLOCK id=function:fmt lines=386-396

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/parameters/UnitDistributionChannelRow.tsx
   :language: tsx
   :lines: 386-396
   :lineno-match:

.. CG-EXPLANATION-START id=function:fmt

**What this does.** Formats a possibly-absent statistic — an em dash when the value is null, otherwise the number to the given number of decimal places.

**Why it is here.** So a missing statistic reads as a clear dash rather than as a stand-in number.

.. CG-EXPLANATION-END id=function:fmt

``function jitter``
-------------------

.. CG-BLOCK id=function:jitter lines=397-400

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/parameters/UnitDistributionChannelRow.tsx
   :language: tsx
   :lines: 397-400
   :lineno-match:

.. CG-EXPLANATION-START id=function:jitter

**What this does.** Returns a deterministic pseudo-random number between 0 and 1 from a dot's index, used to spread the strip dots vertically.

**Why it is here.** A hash of the index rather than ``Math.random`` so a re-render redraws the identical picture; the multiplier is an arbitrary constant whose only job is to decorrelate neighbouring indices.

.. CG-EXPLANATION-END id=function:jitter

