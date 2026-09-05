desktop.renderer.src.sheet.sheetGeometry
========================================

.. CG-PAGE source=desktop/src/renderer/src/sheet/sheetGeometry.ts complete=true

*Source file:* ``desktop/src/renderer/src/sheet/sheetGeometry.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-17

.. literalinclude:: ../../../desktop/src/renderer/src/sheet/sheetGeometry.ts
   :language: typescript
   :lines: 1-17
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** A documentation comment and imports for the geometry calculator. The comment says this file works out the paper size and where each column sits, following the spec's ``Scale modes`` section, and that it is pure — millimetres in, millimetres out — and reuses the screen's own column-layout function so the spacing slider means the same thing on paper as on screen. The imports bring in that shared layout function, the paper constants, and the scale-mode type.

**Why it is here.** A *pure* function only turns its inputs into a result with no side effects, which makes the paper size easy to test and predictable. Reusing the on-screen ``layoutColumnsHorizontally`` is the decision that keeps the print faithful: the same slider that spreads or packs the columns on screen spreads or packs them on paper in the same way.

.. CG-EXPLANATION-END id=module-header

``function minAdjacentGapMm``
-----------------------------

.. CG-BLOCK id=function:minAdjacentGapMm lines=18-28

.. literalinclude:: ../../../desktop/src/renderer/src/sheet/sheetGeometry.ts
   :language: typescript
   :lines: 18-28
   :lineno-match:

.. CG-EXPLANATION-START id=function:minAdjacentGapMm

**What this does.** Given the on-paper positions of the columns, it sorts them and returns the smallest gap between two neighbours, or nothing when there are fewer than two columns.

**Why it is here.** The drawn column width follows the on-paper spacing, so the calculator first needs to know how close the closest pair of columns is. With fewer than two columns there is no spacing to measure, so it returns nothing and the width falls back to its minimum.

.. CG-EXPLANATION-END id=function:minAdjacentGapMm

``interface SheetGeometryInput``
--------------------------------

.. CG-BLOCK id=interface:SheetGeometryInput lines=29-40

.. literalinclude:: ../../../desktop/src/renderer/src/sheet/sheetGeometry.ts
   :language: typescript
   :lines: 29-40
   :lineno-match:

.. CG-EXPLANATION-START id=interface:SheetGeometryInput

**What this does.** Declares what the calculator is given: the highest and lowest level to draw, the columns (each an id and its true distance along the section), the scale mode, the two explicit-scale denominators, the vertical exaggeration, and the column spacing.

**Why it is here.** Naming the input shape once makes clear exactly which facts drive the paper size, and separates them from everything else in the payload the drawing does not need to size the page.

.. CG-EXPLANATION-END id=interface:SheetGeometryInput

``interface SheetGeometry``
---------------------------

.. CG-BLOCK id=interface:SheetGeometry lines=41-61

.. literalinclude:: ../../../desktop/src/renderer/src/sheet/sheetGeometry.ts
   :language: typescript
   :lines: 41-61
   :lineno-match:

.. CG-EXPLANATION-START id=interface:SheetGeometry

**What this does.** Declares everything the calculator returns: the paper width and height, the drawing height, the drawing's left edge and top and width, where the right column starts, the horizontal and vertical scales (millimetres per ground metre), the printed scale denominators, the effective vertical exaggeration, each column's position in millimetres, the drawn column half-width, and a flag saying the paper is over the width cap.

**Why it is here.** This is the single bundle of measurements every part of the sheet reads from, so the profile, the legend, the map column and the scale line all lay themselves out from one agreed set of numbers. A *print scale* written ``1:N`` means one length on paper stands for N of the same lengths on the ground; *vertical exaggeration* is how many times taller than true the vertical scale is drawn, so thin layers are visible.

.. CG-EXPLANATION-END id=interface:SheetGeometry

``function computeSheetGeometry``
---------------------------------

.. CG-BLOCK id=function:computeSheetGeometry lines=62-130

.. literalinclude:: ../../../desktop/src/renderer/src/sheet/sheetGeometry.ts
   :language: typescript
   :lines: 62-130
   :lineno-match:

.. CG-EXPLANATION-START id=function:computeSheetGeometry

**What this does.** The calculator itself. It measures the elevation range, then sets the vertical and horizontal scales. In explicit mode it converts the engineer's typed ``1:N`` scales into millimetres per ground metre and sets the drawing height from the range (never below the 60 mm floor). In fit mode it fits the drawing to the A3 height, deriving the vertical scale from the range and the horizontal scale from the vertical one divided by the exaggeration. It then lays the columns out twice with the shared screen function: once at the minimum width to read the real on-paper spacing, then it sets each column's drawn width to a fraction of the nearest-neighbour spacing (clamped between the min and max), and lays them out again at that width so the packing, the first-column offset and the trailing edge all use the true width. Finally it works out the profile's right edge, the natural paper width (floored at 420 mm), where the right column starts, the printed scales rounded to whole ``1:N`` numbers, and whether the paper exceeds the 5000 mm cap.

**Why it is here.** This is the heart of the two scale modes the owner asked to keep: fit mode (the default) makes the whole section fill the A3 sheet at the app's current exaggeration and spacing, and explicit mode lets the engineer type exact ``1:N`` scales and lets the sheet grow instead of clipping. Laying the columns out with the screen's own function, and resolving the drawn width from the real spacing in a second pass, is what fixed the ``hairline columns`` finding and keeps the printed spacing identical to the screen. The printed scales are always shown as whole ``1:N`` numbers, and going over the width cap is flagged rather than silently producing a file the printer would reject. These behaviours — fit derives the scales from the range, width floors at 420, explicit grows past 297, the 5000 cap, and the ``1:N`` rounding — are exactly what the unit tests pin.

.. CG-EXPLANATION-END id=function:computeSheetGeometry

