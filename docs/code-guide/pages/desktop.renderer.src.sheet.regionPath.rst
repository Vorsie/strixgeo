desktop.renderer.src.sheet.regionPath
=====================================

.. CG-PAGE source=desktop/src/renderer/src/sheet/regionPath.ts complete=false

*Source file:* ``desktop/src/renderer/src/sheet/regionPath.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-2

.. literalinclude:: ../../../desktop/src/renderer/src/sheet/regionPath.ts
   :language: typescript
   :lines: 1-2
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** A one-line comment saying this file turns a region's fraction polygons into pixel paths, with the numbers rounded to two decimals of a pixel.

**Why it is here.** The fills arrive as polygons whose horizontal position is stored as a *fraction* (0 to 1) of the gap between two columns, not as a fixed pixel position. Keeping them as fractions is what lets the spacing slider re-lay the same shapes without recomputing any fill; this file is where a fraction becomes an actual pixel outline at draw time. Rounding keeps the drawing data small and stable.

.. CG-EXPLANATION-END id=module-header

``interface FractionRegion``
----------------------------

.. CG-BLOCK id=interface:FractionRegion lines=3-7

.. literalinclude:: ../../../desktop/src/renderer/src/sheet/regionPath.ts
   :language: typescript
   :lines: 3-7
   :lineno-match:

.. CG-EXPLANATION-START id=interface:FractionRegion

**What this does.** Declares the shape of one region: which gap between two columns it sits in (``gap_index``), and a polygon whose points are pairs of a horizontal fraction and an elevation in metres.

**Why it is here.** This is the minimal description the drawing needs of one partition piece. Storing the horizontal position as a fraction of the gap (rather than a fixed distance) is the key idea that makes the fill independent of column spacing.

.. CG-EXPLANATION-END id=interface:FractionRegion

``function r2``
---------------

.. CG-BLOCK id=function:r2 lines=8-11

.. literalinclude:: ../../../desktop/src/renderer/src/sheet/regionPath.ts
   :language: typescript
   :lines: 8-11
   :lineno-match:

.. CG-EXPLANATION-START id=function:r2

**What this does.** Rounds a number to two decimal places and returns it as text.

**Why it is here.** Path coordinates are written into the drawing as text; two decimals of a pixel is more than precise enough and keeps the path strings short and tidy.

.. CG-EXPLANATION-END id=function:r2

``function resolveRegionPoints``
--------------------------------

.. CG-BLOCK id=function:resolveRegionPoints lines=12-21

.. literalinclude:: ../../../desktop/src/renderer/src/sheet/regionPath.ts
   :language: typescript
   :lines: 12-21
   :lineno-match:

.. CG-EXPLANATION-START id=function:resolveRegionPoints

**What this does.** Turns a region's polygon into real pixel points. For each corner it takes the horizontal fraction and places it between the region's left column and its right column, and turns the elevation into a vertical pixel position using the supplied level-to-pixel converter.

**Why it is here.** This is the step that resolves the stored fractions to pixels using the current column positions, so moving the spacing slider (which moves the columns) re-places the same polygon without touching the fill data — exactly the design goal that ``a slider move never recomputes a fill``.

.. CG-EXPLANATION-END id=function:resolveRegionPoints

``function regionPathD``
------------------------

.. CG-BLOCK id=function:regionPathD lines=22-31

.. literalinclude:: ../../../desktop/src/renderer/src/sheet/regionPath.ts
   :language: typescript
   :lines: 22-31
   :lineno-match:

.. CG-EXPLANATION-START id=function:regionPathD

**What this does.** Builds the actual SVG path string for a region: it resolves the points, then writes a ``move-to`` for the first point, ``line-to`` for the rest, and closes the shape.

**Why it is here.** An SVG *path* is a shape described by a short string of drawing commands. This produces that string for one filled region, the form the browser needs to paint the polygon.

.. CG-EXPLANATION-END id=function:regionPathD

``function regionBounds``
-------------------------

.. CG-BLOCK id=function:regionBounds lines=32-40

.. literalinclude:: ../../../desktop/src/renderer/src/sheet/regionPath.ts
   :language: typescript
   :lines: 32-40
   :lineno-match:

.. CG-EXPLANATION-START id=function:regionBounds

**What this does.** Resolves a region's points and returns the smallest and largest pixel x and y — the bounding box that contains the region.

**Why it is here.** The drawing uses this box to decide whether a region is big enough to hold its unit name and where to centre that label; a region too small simply drops its label rather than overlapping a neighbour.

.. CG-EXPLANATION-END id=function:regionBounds

