desktop.renderer.src.components.sections.SectionGrid
====================================================

.. CG-PAGE source=desktop/src/renderer/src/components/sections/SectionGrid.tsx complete=true

*Source file:* ``desktop/src/renderer/src/components/sections/SectionGrid.tsx``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-11

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/SectionGrid.tsx
   :language: tsx
   :lines: 1-11
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The top of the file that draws the static backdrop of the cross-section plot — the vertical and horizontal gridlines and their axis tick labels. It imports the plot margin constant.

**Why it is here.** The docstring says it was split out of the main section panel as a render-only unit that owns no interaction — it is a pure function of the geometry passed in. It also notes the gridline colours come from CSS variable tokens because SVG attributes cannot use the app's usual dark-mode utility classes.

.. CG-EXPLANATION-END id=module-header

``interface SectionGridProps``
------------------------------

.. CG-BLOCK id=interface:SectionGridProps lines=12-39

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/SectionGrid.tsx
   :language: tsx
   :lines: 12-39
   :lineno-match:

.. CG-EXPLANATION-START id=interface:SectionGridProps

**What this does.** The inputs: the along-distance tick positions and level (elevation) tick positions in world units, the warp-aware along-to-screen mapping, the elevation-to-screen mapping, and the plot width and height in pixels.

**Why it is here.** The comment on the warp-aware mapping is the load-bearing one: gridlines and x-axis labels must track the packed test positions at low column spacing, using the same warp the ground-surface line uses, while the label values themselves stay at their true along-distance.

.. CG-EXPLANATION-END id=interface:SectionGridProps

``function SectionGrid``
------------------------

.. CG-BLOCK id=function:SectionGrid lines=40-110

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/SectionGrid.tsx
   :language: tsx
   :lines: 40-110
   :lineno-match:

.. CG-EXPLANATION-START id=function:SectionGrid

**What this does.** The component. It draws one vertical line plus a rounded distance label for each along-distance tick, positioning each with the warp-aware transform, then one horizontal line plus an elevation label for each level tick, showing one decimal only when the step is sub-metre.

**Why it is here.** Using the warp-aware transform keeps the grid aligned with the crowded columns whenever spacing compresses the axis — the section-view spacing rule that every overlay must obey. The sub-metre decimal keeps a label like -12.5 from collapsing to -13.

.. CG-EXPLANATION-END id=function:SectionGrid

