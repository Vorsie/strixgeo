desktop.renderer.src.shell.stages.parameters.depthPanelGeometry
===============================================================

.. CG-PAGE source=desktop/src/renderer/src/shell/stages/parameters/depthPanelGeometry.ts complete=true

*Source file:* ``desktop/src/renderer/src/shell/stages/parameters/depthPanelGeometry.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-7

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/parameters/depthPanelGeometry.ts
   :language: typescript
   :lines: 1-7
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Opens the pure geometry-and-shaping helpers for the Parameters depth panels — the maths that turns depths and values into positions and paths, with no drawing of its own.

**Why it is here.** Split out of ``CptSbtDepthPanels.tsx`` under the god-component pressure (debt #201): none of it touches React, all of it is worth unit-testing directly, and the panel is its only consumer today.

.. CG-EXPLANATION-END id=module-header

``function finite``
-------------------

.. CG-BLOCK id=function:finite lines=8-12

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/parameters/depthPanelGeometry.ts
   :language: typescript
   :lines: 8-12
   :lineno-match:

.. CG-EXPLANATION-START id=function:finite

**What this does.** Filters a possibly-nullable number array down to just its finite numbers.

**Why it is here.** So an axis maximum or a curve can be computed from real readings without a null or an infinity poisoning the result.

.. CG-EXPLANATION-END id=function:finite

``interface ZoneRun``
---------------------

.. CG-BLOCK id=interface:ZoneRun lines=13-47

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/parameters/depthPanelGeometry.ts
   :language: typescript
   :lines: 13-47
   :lineno-match:

.. CG-EXPLANATION-START id=interface:ZoneRun

**What this does.** The shape of one drawable strip interval: a top depth, a base depth, and the Robertson chart zone (1 to 9) painted over the whole run. The lines that follow are the documentation comment for ``zoneRuns``.

**Why it is here.** One rectangle is drawn per run rather than per sample, so the run is the drawable unit; the trailing doc-comment explains how the runs are built.

.. CG-EXPLANATION-END id=interface:ZoneRun

``function zoneRuns``
---------------------

.. CG-BLOCK id=function:zoneRuns lines=48-68

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/parameters/depthPanelGeometry.ts
   :language: typescript
   :lines: 48-68
   :lineno-match:

.. CG-EXPLANATION-START id=function:zoneRuns

**What this does.** Collapses a per-sample zone array into contiguous runs: it walks the depths, skips unclassifiable (null) points, and extends the open run only when the next sample is the SAME zone and touches the run's base — otherwise it starts a new run. The deepest sample is given the same depth increment as its predecessor so the strip reaches the bottom of the hole.

**Why it is here.** A 2 cm-sampled 30 m CPT is about 1500 points per strip, almost all the same colour as the one above; one rectangle per run draws the identical picture from the few intervals that actually exist. A null zone breaks the run and emits nothing, because an unclassifiable point is an absence and painting it would read as a soil — and a classification gap must stay a gap, not be bridged.

.. CG-EXPLANATION-END id=function:zoneRuns

``function depthToY``
---------------------

.. CG-BLOCK id=function:depthToY lines=69-79

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/parameters/depthPanelGeometry.ts
   :language: typescript
   :lines: 69-79
   :lineno-match:

.. CG-EXPLANATION-START id=function:depthToY

**What this does.** Maps a depth in metres to a y position in the panel's user space, with ground surface at 0 and the deepest sample at the full content height.

**Why it is here.** The one shared depth-to-y mapping every panel and the ruler use, so a feature lines up across the whole stack; it guards against a zero or negative maximum depth.

.. CG-EXPLANATION-END id=function:depthToY

``function chooseGridStep``
---------------------------

.. CG-BLOCK id=function:chooseGridStep lines=80-87

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/parameters/depthPanelGeometry.ts
   :language: typescript
   :lines: 80-87
   :lineno-match:

.. CG-EXPLANATION-START id=function:chooseGridStep

**What this does.** Picks a gridline spacing in metres for a hole of a given depth, stepping through 1, 2, 5, 10, 20, 50 until the count of lines is 15 or fewer.

**Why it is here.** It aims at roughly 8 to 15 lines — enough to read a depth off the panel without a ruler, few enough not to stripe the curve out of visibility.

.. CG-EXPLANATION-END id=function:chooseGridStep

``function gridTicks``
----------------------

.. CG-BLOCK id=function:gridTicks lines=88-113

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/parameters/depthPanelGeometry.ts
   :language: typescript
   :lines: 88-113
   :lineno-match:

.. CG-EXPLANATION-START id=function:gridTicks

**What this does.** Lists the gridline depths from 0 up to the hole's maximum at the chosen step, rounding each to kill floating-point drift.

**Why it is here.** So both the ruler and every curve panel draw their gridlines at the identical depths.

.. CG-EXPLANATION-END id=function:gridTicks

``function buildPath``
----------------------

.. CG-BLOCK id=function:buildPath lines=114-135

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/parameters/depthPanelGeometry.ts
   :language: typescript
   :lines: 114-135
   :lineno-match:

.. CG-EXPLANATION-START id=function:buildPath

**What this does.** Builds the SVG path string for one depth series: it walks the parallel depth and value arrays, and for each finite reading appends a move-or-line command at the value's x and the depth's y; a null reading lifts the pen so the next point begins a fresh subpath.

**Why it is here.** A null measurement ends the current subpath rather than being bridged, because connecting across a void would draw a measurement nobody took; the x is clamped to the 0-to-100 box.

.. CG-EXPLANATION-END id=function:buildPath

