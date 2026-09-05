desktop.renderer.src.utils.cptAxisScales
========================================

.. CG-PAGE source=desktop/src/renderer/src/utils/cptAxisScales.ts complete=true

*Source file:* ``desktop/src/renderer/src/utils/cptAxisScales.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-23

.. literalinclude:: ../../../desktop/src/renderer/src/utils/cptAxisScales.ts
   :language: typescript
   :lines: 1-23
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** A comment establishing this file as the single source of the standard CPT plot axis scales — the ranges and tick positions every surface that promises "the same axes as the CPT plot" reads from.

**Why it is here.** The comment records the owner's ruling (2026-08-27) that qc, fs and Rf start at zero and reuse the CPT-plot axes; that the values were extracted from the chart when the per-unit distribution panels became the second consumer (extract-on-the-second-copy); and, importantly, that the scales are fixed rather than data-driven because every printed sounding in Flanders uses these same ranges, so an engineer's eye is calibrated to them and a fixed scale is what makes two plots comparable at a glance. It also records what is deliberately NOT unified here: the section column's own channel scales, which are a different call for a different surface.

.. CG-EXPLANATION-END id=module-header

``const QC_AXIS_MAX_MPA``
-------------------------

.. CG-BLOCK id=const:QC_AXIS_MAX_MPA lines=24-25

.. literalinclude:: ../../../desktop/src/renderer/src/utils/cptAxisScales.ts
   :language: typescript
   :lines: 24-25
   :lineno-match:

.. CG-EXPLANATION-START id=const:QC_AXIS_MAX_MPA

**What this does.** The cone-resistance axis top: 40 MPa.

**Why it is here.** The DOV report convention for qc, per the header.

.. CG-EXPLANATION-END id=const:QC_AXIS_MAX_MPA

``const QC_AXIS_TICKS_MPA``
---------------------------

.. CG-BLOCK id=const:QC_AXIS_TICKS_MPA lines=26-28

.. literalinclude:: ../../../desktop/src/renderer/src/utils/cptAxisScales.ts
   :language: typescript
   :lines: 26-28
   :lineno-match:

.. CG-EXPLANATION-START id=const:QC_AXIS_TICKS_MPA

**What this does.** The qc tick positions in MPa, every 5 up to 40.

**Why it is here.** The fixed tick marks matching the DOV qc convention.

.. CG-EXPLANATION-END id=const:QC_AXIS_TICKS_MPA

``const FS_AXIS_MAX_MPA``
-------------------------

.. CG-BLOCK id=const:FS_AXIS_MAX_MPA lines=29-30

.. literalinclude:: ../../../desktop/src/renderer/src/utils/cptAxisScales.ts
   :language: typescript
   :lines: 29-30
   :lineno-match:

.. CG-EXPLANATION-START id=const:FS_AXIS_MAX_MPA

**What this does.** The sleeve-friction axis top: 1 MPa.

**Why it is here.** The DOV report convention for fs, per the header.

.. CG-EXPLANATION-END id=const:FS_AXIS_MAX_MPA

``const FS_AXIS_TICKS_MPA``
---------------------------

.. CG-BLOCK id=const:FS_AXIS_TICKS_MPA lines=31-33

.. literalinclude:: ../../../desktop/src/renderer/src/utils/cptAxisScales.ts
   :language: typescript
   :lines: 31-33
   :lineno-match:

.. CG-EXPLANATION-START id=const:FS_AXIS_TICKS_MPA

**What this does.** The fs tick positions in MPa, every 0.2 up to 1.0.

**Why it is here.** The fixed tick marks matching the DOV fs convention.

.. CG-EXPLANATION-END id=const:FS_AXIS_TICKS_MPA

``const RF_AXIS_MAX_PCT``
-------------------------

.. CG-BLOCK id=const:RF_AXIS_MAX_PCT lines=34-35

.. literalinclude:: ../../../desktop/src/renderer/src/utils/cptAxisScales.ts
   :language: typescript
   :lines: 34-35
   :lineno-match:

.. CG-EXPLANATION-START id=const:RF_AXIS_MAX_PCT

**What this does.** The friction-ratio axis top: 10 percent.

**Why it is here.** The DOV report convention for Rf, per the header.

.. CG-EXPLANATION-END id=const:RF_AXIS_MAX_PCT

``const RF_AXIS_TICKS_PCT``
---------------------------

.. CG-BLOCK id=const:RF_AXIS_TICKS_PCT lines=36-38

.. literalinclude:: ../../../desktop/src/renderer/src/utils/cptAxisScales.ts
   :language: typescript
   :lines: 36-38
   :lineno-match:

.. CG-EXPLANATION-START id=const:RF_AXIS_TICKS_PCT

**What this does.** The Rf tick positions in percent, every 2 up to 10.

**Why it is here.** The fixed tick marks matching the DOV Rf convention.

.. CG-EXPLANATION-END id=const:RF_AXIS_TICKS_PCT

``const U2_AXIS_MIN_KPA``
-------------------------

.. CG-BLOCK id=const:U2_AXIS_MIN_KPA lines=39-40

.. literalinclude:: ../../../desktop/src/renderer/src/utils/cptAxisScales.ts
   :language: typescript
   :lines: 39-40
   :lineno-match:

.. CG-EXPLANATION-START id=const:U2_AXIS_MIN_KPA

**What this does.** The pore-pressure axis lower bound: minus 100 kPa.

**Why it is here.** The comment records that suction reads negative, so the axis extends below zero unlike the others.

.. CG-EXPLANATION-END id=const:U2_AXIS_MIN_KPA

``const U2_AXIS_MAX_KPA``
-------------------------

.. CG-BLOCK id=const:U2_AXIS_MAX_KPA lines=41-42

.. literalinclude:: ../../../desktop/src/renderer/src/utils/cptAxisScales.ts
   :language: typescript
   :lines: 41-42
   :lineno-match:

.. CG-EXPLANATION-START id=const:U2_AXIS_MAX_KPA

**What this does.** The pore-pressure axis upper bound: 300 kPa.

**Why it is here.** The DOV report convention for u2, per the header.

.. CG-EXPLANATION-END id=const:U2_AXIS_MAX_KPA

``const U2_AXIS_TICKS_KPA``
---------------------------

.. CG-BLOCK id=const:U2_AXIS_TICKS_KPA lines=43-51

.. literalinclude:: ../../../desktop/src/renderer/src/utils/cptAxisScales.ts
   :language: typescript
   :lines: 43-51
   :lineno-match:

.. CG-EXPLANATION-START id=const:U2_AXIS_TICKS_KPA

**What this does.** The u2 tick positions in kPa: minus 100 through 300 in steps of 100.

**Why it is here.** The fixed tick marks matching the DOV u2 convention.

.. CG-EXPLANATION-END id=const:U2_AXIS_TICKS_KPA

``const MAX_TICK_LABELS``
-------------------------

.. CG-BLOCK id=const:MAX_TICK_LABELS lines=52-53

.. literalinclude:: ../../../desktop/src/renderer/src/utils/cptAxisScales.ts
   :language: typescript
   :lines: 52-53
   :lineno-match:

.. CG-EXPLANATION-START id=const:MAX_TICK_LABELS

**What this does.** The hard cap on how many labelled ticks an axis may show: nine.

**Why it is here.** The comment records the owner's ruling S3 wish for more sub-labels but "not too many", so nine is the ceiling.

.. CG-EXPLANATION-END id=const:MAX_TICK_LABELS

``const MIN_TICK_LABELS``
-------------------------

.. CG-BLOCK id=const:MIN_TICK_LABELS lines=54-62

.. literalinclude:: ../../../desktop/src/renderer/src/utils/cptAxisScales.ts
   :language: typescript
   :lines: 54-62
   :lineno-match:

.. CG-EXPLANATION-START id=const:MIN_TICK_LABELS

**What this does.** The floor on labelled ticks: three, below which an axis reads as unlabelled.

**Why it is here.** The comment records that the tick step is derived once from the axis span (aiming for roughly five to nine labels) so the fixed axes, the fit-to-data axes and the elevation axes all label the same way; three is the minimum that still reads as a labelled axis.

.. CG-EXPLANATION-END id=const:MIN_TICK_LABELS

``function niceCeil``
---------------------

.. CG-BLOCK id=function:niceCeil lines=63-73

.. literalinclude:: ../../../desktop/src/renderer/src/utils/cptAxisScales.ts
   :language: typescript
   :lines: 63-73
   :lineno-match:

.. CG-EXPLANATION-START id=function:niceCeil

**What this does.** Returns the smallest "nice" step — a 1, 2 or 5 times a power of ten — that is at least the given number.

**Why it is here.** The docstring records that it rounds up rather than to nearest so a span divided by the target count can never produce more labels than allowed, and notes this is exactly how the DOV tick conventions above fall out of the rule.

.. CG-EXPLANATION-END id=function:niceCeil

``function niceStepDown``
-------------------------

.. CG-BLOCK id=function:niceStepDown lines=74-105

.. literalinclude:: ../../../desktop/src/renderer/src/utils/cptAxisScales.ts
   :language: typescript
   :lines: 74-105
   :lineno-match:

.. CG-EXPLANATION-START id=function:niceStepDown

**What this does.** Returns the next nice step one notch finer than the given one (5 to 2 to 1 to 0.5 and so on).

**Why it is here.** Used to refine a step that left too few labelled ticks, one nice notch at a time.

.. CG-EXPLANATION-END id=function:niceStepDown

``function axisTickValues``
---------------------------

.. CG-BLOCK id=function:axisTickValues lines=106-128

.. literalinclude:: ../../../desktop/src/renderer/src/utils/cptAxisScales.ts
   :language: typescript
   :lines: 106-128
   :lineno-match:

.. CG-EXPLANATION-START id=function:axisTickValues

**What this does.** Computes the labelled tick values for an axis: it starts from a nice step derived from the span and the target interval count, then, if that step left fewer than three ticks in range, refines it one notch at a time until the axis is actually labelled — but never past the nine-label cap. A degenerate or reversed span yields no ticks.

**Why it is here.** The docstring records that the target-intervals argument is a density knob the panel geometry sets (wide rows take the default, cramped axes pass less), and that the refinement handles short un-anchored spans like a thin unit's elevation axis that would otherwise show too few labels.

.. CG-EXPLANATION-END id=function:axisTickValues

``function ticksForStep``
-------------------------

.. CG-BLOCK id=function:ticksForStep lines=129-161

.. literalinclude:: ../../../desktop/src/renderer/src/utils/cptAxisScales.ts
   :language: typescript
   :lines: 129-161
   :lineno-match:

.. CG-EXPLANATION-START id=function:ticksForStep

**What this does.** Lists the multiples of a given step that fall inside a range, rounding each to the step's own decimal precision.

**Why it is here.** The comment records that the precision rounding is what turns a computed 0.6000000000000001 back into 0.6, which the label formatter depends on.

.. CG-EXPLANATION-END id=function:ticksForStep

``function fitAxisMax``
-----------------------

.. CG-BLOCK id=function:fitAxisMax lines=162-171

.. literalinclude:: ../../../desktop/src/renderer/src/utils/cptAxisScales.ts
   :language: typescript
   :lines: 162-171
   :lineno-match:

.. CG-EXPLANATION-START id=function:fitAxisMax

**What this does.** Computes a fit-to-data axis top: the pooled maximum rounded up to the nice tick step its own magnitude implies, so the fitted axis always ends on a labelled tick. No data (or nonsense) falls back to the fixed axis top.

**Why it is here.** The docstring records the owner's ruling S1 (2026-08-27) that the axis should rescale to fit the data while zero stays the minimum, and that the fixed fallback is also what a revert restores.

.. CG-EXPLANATION-END id=function:fitAxisMax

``function formatTickLabel``
----------------------------

.. CG-BLOCK id=function:formatTickLabel lines=172-181

.. literalinclude:: ../../../desktop/src/renderer/src/utils/cptAxisScales.ts
   :language: typescript
   :lines: 172-181
   :lineno-match:

.. CG-EXPLANATION-START id=function:formatTickLabel

**What this does.** A *formatter* — a pure function that turns a value into display text. It renders one tick label with just the decimals its step needs: plain zero for the anchor, no decimals for a whole-number step, otherwise as many decimals as the step's magnitude implies.

**Why it is here.** The docstring records the goal: show "0.2" for a 0.2 step and "5" for an integer step, never a long floating-point tail like "0.20000000000000001".

.. CG-EXPLANATION-END id=function:formatTickLabel

``function tickStepOf``
-----------------------

.. CG-BLOCK id=function:tickStepOf lines=182-184

.. literalinclude:: ../../../desktop/src/renderer/src/utils/cptAxisScales.ts
   :language: typescript
   :lines: 182-184
   :lineno-match:

.. CG-EXPLANATION-START id=function:tickStepOf

**What this does.** Returns the gap between the first two ticks in a list, or one when there are fewer than two.

**Why it is here.** The docstring records that this gives the label formatter the step it needs, falling back to integer formatting for a single or empty tick list.

.. CG-EXPLANATION-END id=function:tickStepOf

