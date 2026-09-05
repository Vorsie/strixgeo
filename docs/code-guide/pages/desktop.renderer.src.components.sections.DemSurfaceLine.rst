desktop.renderer.src.components.sections.DemSurfaceLine
=======================================================

.. CG-PAGE source=desktop/src/renderer/src/components/sections/DemSurfaceLine.tsx complete=true

*Source file:* ``desktop/src/renderer/src/components/sections/DemSurfaceLine.tsx``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-18

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/DemSurfaceLine.tsx
   :language: tsx
   :lines: 1-18
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The top of the file that draws the ground-surface elevation profile on the cross-section as a single thin brown line, from the terrain-model samples. The imports pull in React's memory hook, the sample data type, and the translation helper.

**Why it is here.** The DEM (digital elevation model) line gives terrain context beneath the columns. Where samples are missing (NoData) the line breaks into separate pieces rather than bridging straight across, because engineers expect a gap over missing data, not an invented surface.

.. CG-EXPLANATION-END id=module-header

``const DEM_STROKE``
--------------------

.. CG-BLOCK id=const:DEM_STROKE lines=19-19

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/DemSurfaceLine.tsx
   :language: tsx
   :lines: 19-19
   :lineno-match:

.. CG-EXPLANATION-START id=const:DEM_STROKE

**What this does.** A constant — the earthy brown colour of the surface line.

**Why it is here.** An earth tone reads as terrain context without competing with the investigation columns for attention.

.. CG-EXPLANATION-END id=const:DEM_STROKE

``const DEM_STROKE_WIDTH``
--------------------------

.. CG-BLOCK id=const:DEM_STROKE_WIDTH lines=20-21

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/DemSurfaceLine.tsx
   :language: tsx
   :lines: 20-21
   :lineno-match:

.. CG-EXPLANATION-START id=const:DEM_STROKE_WIDTH

**What this does.** A constant — the width of the surface line in pixels.

**Why it is here.** A thin line so the terrain profile stays subordinate.

.. CG-EXPLANATION-END id=const:DEM_STROKE_WIDTH

``function DemSurfaceLine``
---------------------------

.. CG-BLOCK id=function:DemSurfaceLine lines=22-93

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/DemSurfaceLine.tsx
   :language: tsx
   :lines: 22-93
   :lineno-match:

.. CG-EXPLANATION-START id=function:DemSurfaceLine

**What this does.** The component. It walks the samples and builds an SVG path, opening a new sub-path each time it crosses a missing sample or a point outside the plot rectangle, and clamping the pen state so a lone in-bounds sample does not draw a stray one-point move. It renders the path as a thin brown line at 60 percent opacity with a tooltip, or nothing when the path is empty.

**Why it is here.** The path is recomputed only when its inputs change (a memo). Points outside the plot rectangle are skipped so the surface line stays inside the canvas and does not bleed into the axis margins. The break-on-NoData behaviour keeps the line honest over data gaps.

.. CG-EXPLANATION-END id=function:DemSurfaceLine

