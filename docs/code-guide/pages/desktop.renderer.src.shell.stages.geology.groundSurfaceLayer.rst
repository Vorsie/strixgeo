desktop.renderer.src.shell.stages.geology.groundSurfaceLayer
============================================================

.. CG-PAGE source=desktop/src/renderer/src/shell/stages/geology/groundSurfaceLayer.ts complete=true

*Source file:* ``desktop/src/renderer/src/shell/stages/geology/groundSurfaceLayer.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-31

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/geology/groundSurfaceLayer.ts
   :language: typescript
   :lines: 1-31
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Opens the ground-surface layer file — the legend row for the DEM ground surface (the terrain the model sits under) and the one number the file exists to make legible. Its notes recall that the DEM ground TIN (a TIN is a triangulated surface, a sheet of triangles; a DEM is a digital elevation model of the terrain) has been drawn since the G7 milestone, translucent and non-occluding so the model shows through, but that what was missing was the READING: with the grey sheet floating above the interpreted model top, the engineer could not tell whether the gap was 0.2 m or 2 m, nor whether a column poking THROUGH the terrain was a drawing artefact or a real data conflict. It notes the file is deliberately pure maths (Cesium colour plus arithmetic) so it runs in tests without a graphics context.

**Why it is here.** The model top is the interpreted top, not the ground — on the dev project 47 of 58 tests have their shallowest interpreted contact below their own collar — so that daylight is real and is exactly what the surface makes visible; this file turns it into a number and names the columns where the model instead breaks up through the terrain. Elevation trust underlies the reading: a surveyed collar outranks the DEM, and 0 m TAW is a real value, never a stand-in for missing data.

.. CG-EXPLANATION-END id=module-header

``const DAYLIGHT_FLUSH_EPS_M``
------------------------------

.. CG-BLOCK id=const:DAYLIGHT_FLUSH_EPS_M lines=32-34

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/geology/groundSurfaceLayer.ts
   :language: typescript
   :lines: 32-34
   :lineno-match:

.. CG-EXPLANATION-START id=const:DAYLIGHT_FLUSH_EPS_M

**What this does.** Holds one millimetre — the vertical gap below which the terrain and the model top are treated as the same level.

**Why it is here.** One millimetre is the project's geometry precision floor (litho layer depths are clamped to 0.001 m on the server), so anything tighter is noise from the surface interpolation rather than a real gap.

.. CG-EXPLANATION-END id=const:DAYLIGHT_FLUSH_EPS_M

``interface DaylightColumn``
----------------------------

.. CG-BLOCK id=interface:DaylightColumn lines=35-48

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/geology/groundSurfaceLayer.ts
   :language: typescript
   :lines: 35-48
   :lineno-match:

.. CG-EXPLANATION-START id=interface:DaylightColumn

**What this does.** Names one place to read the gap at — an investigation's plan position: an optional label plus its x and y. When the label is missing, the readout falls back to the coordinate pair so a record is never anonymous.

**Why it is here.** Reading at investigation positions is what ties the number to a named borehole or CPT the engineer recognises, and the coordinate fallback keeps every reading attributable.

.. CG-EXPLANATION-END id=interface:DaylightColumn

``interface DaylightRecord``
----------------------------

.. CG-BLOCK id=interface:DaylightRecord lines=49-62

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/geology/groundSurfaceLayer.ts
   :language: typescript
   :lines: 49-62
   :lineno-match:

.. CG-EXPLANATION-START id=interface:DaylightRecord

**What this does.** Names what the terrain and the model say at one column: the label and position, the DEM terrain elevation, the shallowest model-surface elevation, the signed gap between them (``daylightM``), and a ``status`` of ``daylight``, ``flush`` or ``above_ground``. A positive gap means the model top sits BELOW the terrain — the normal case; a negative gap means it sits ABOVE the terrain, which is a data conflict, not a smaller gap.

**Why it is here.** Keeping the gap signed and naming the three cases lets the caller tell normal daylight from a genuine model-above-ground conflict, instead of collapsing an error into a small positive number.

.. CG-EXPLANATION-END id=interface:DaylightRecord

``interface DaylightSummary``
-----------------------------

.. CG-BLOCK id=interface:DaylightSummary lines=63-82

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/geology/groundSurfaceLayer.ts
   :language: typescript
   :lines: 63-82
   :lineno-match:

.. CG-EXPLANATION-START id=interface:DaylightSummary

**What this does.** Names the one-line reading for the legend: how many columns had both a terrain and a model top (``counted``), how many of those have the model below the terrain (``withDaylight``), how many have it above (``aboveGround`` — a conflict), the largest gap found (``maxDaylightM``, or null), and which column that was (``maxLabel``).

**Why it is here.** This is the compact shape the legend caption is built from, keeping the normal-daylight tally separate from the conflict tally so the caption can report both.

.. CG-EXPLANATION-END id=interface:DaylightSummary

``interface LegendEntry``
-------------------------

.. CG-BLOCK id=interface:LegendEntry lines=83-96

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/geology/groundSurfaceLayer.ts
   :language: typescript
   :lines: 83-96
   :lineno-match:

.. CG-EXPLANATION-START id=interface:LegendEntry

**What this does.** Names one legend row: an id, a label, and a solid CSS colour string for the little swatch (with transparency dropped).

**Why it is here.** The note records that the viewer currently hardcodes the swatch colour in one place while the mesh takes its colour from a constant, so the two agree only by careful maintenance; deriving the swatch from the same colour makes drift impossible. The transparency is dropped because a 45 %-transparent swatch on a panel background reads as a different hue than the mesh.

.. CG-EXPLANATION-END id=interface:LegendEntry

``function cesiumColorToCss``
-----------------------------

.. CG-BLOCK id=function:cesiumColorToCss lines=97-102

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/geology/groundSurfaceLayer.ts
   :language: typescript
   :lines: 97-102
   :lineno-match:

.. CG-EXPLANATION-START id=function:cesiumColorToCss

**What this does.** Converts a Cesium colour into an opaque CSS ``rgb(...)`` string, rounding each channel to the 0–255 range and discarding transparency.

**Why it is here.** Transparency is dropped on purpose — the legend swatch is an identity marker, not a preview of how see-through the mesh is.

.. CG-EXPLANATION-END id=function:cesiumColorToCss

``const GROUND_SURFACE_LEGEND``
-------------------------------

.. CG-BLOCK id=const:GROUND_SURFACE_LEGEND lines=103-127

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/geology/groundSurfaceLayer.ts
   :language: typescript
   :lines: 103-127
   :lineno-match:

.. CG-EXPLANATION-START id=const:GROUND_SURFACE_LEGEND

**What this does.** Holds the single ground-surface legend row: id ``ground-surface``, label ``Ground surface``, and a swatch colour derived from the mesh's own ``GROUND_SURFACE_COLOR`` through the converter above. The block also carries the next function's docstring.

**Why it is here.** Deriving the swatch from the very colour the mesh uses is the drift-proofing the ``LegendEntry`` note calls for — the legend dot always matches the terrain in the scene.

.. CG-EXPLANATION-END id=const:GROUND_SURFACE_LEGEND

``function computeGroundDaylight``
----------------------------------

.. CG-BLOCK id=function:computeGroundDaylight lines=128-176

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/geology/groundSurfaceLayer.ts
   :language: typescript
   :lines: 128-176
   :lineno-match:

.. CG-EXPLANATION-START id=function:computeGroundDaylight

**What this does.** Reads the vertical gap between the DEM terrain and the interpreted model top at every column. For each column it samples the terrain elevation and the shallowest model surface present there, computes ground minus model-top, labels it flush, daylight or above-ground, and returns one record per column. A column is skipped entirely — not reported as zero — when either the terrain or any model surface is missing there.

**Why it is here.** Reporting a fabricated zero where a surface is absent would read as flush ground, which is exactly the wrong conclusion; skipping keeps the reading honest. The shallowest model surface present is the right top because that is what the engineer sees first looking down.

.. CG-EXPLANATION-END id=function:computeGroundDaylight

``function summariseDaylight``
------------------------------

.. CG-BLOCK id=function:summariseDaylight lines=177-206

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/geology/groundSurfaceLayer.ts
   :language: typescript
   :lines: 177-206
   :lineno-match:

.. CG-EXPLANATION-START id=function:summariseDaylight

**What this does.** Collapses the per-column records into the single summary line: it counts the columns with daylight and with an above-ground conflict, and tracks the largest gap and its column. On a tie for the largest, it keeps the first column encountered.

**Why it is here.** Keeping the first on a tie makes the caption stable across redraws rather than flickering between two equally-deep columns.

.. CG-EXPLANATION-END id=function:summariseDaylight

``function formatDaylightCaption``
----------------------------------

.. CG-BLOCK id=function:formatDaylightCaption lines=207-221

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/geology/groundSurfaceLayer.ts
   :language: typescript
   :lines: 207-221
   :lineno-match:

.. CG-EXPLANATION-START id=function:formatDaylightCaption

**What this does.** Turns the summary into the legend's secondary line — for example the fraction of columns below ground, the largest gap and where it is, and a separate note of any columns above ground — or returns ``null`` when there is nothing to say.

**Why it is here.** Returning ``null`` lets the caller omit the line entirely rather than print a meaningless 0 of 0.

.. CG-EXPLANATION-END id=function:formatDaylightCaption

