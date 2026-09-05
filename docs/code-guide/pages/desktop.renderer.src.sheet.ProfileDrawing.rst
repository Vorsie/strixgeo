desktop.renderer.src.sheet.ProfileDrawing
=========================================

.. CG-PAGE source=desktop/src/renderer/src/sheet/ProfileDrawing.tsx complete=false

*Source file:* ``desktop/src/renderer/src/sheet/ProfileDrawing.tsx``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-21

.. literalinclude:: ../../../desktop/src/renderer/src/sheet/ProfileDrawing.tsx
   :language: tsx
   :lines: 1-21
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** A documentation comment describing the file, followed by a list of ``import`` lines. The comment says this file draws the profile as an SVG: the coloured fills (the same partition polygons the Sections stage draws on screen), the seams between them, one thin vertical line per investigation carrying either the CPT cone-resistance trace or the borehole lithology strip drawn on top of the fill, the two axes, the ``A`` / ``A′`` end labels and the short column codes. The imports pull in the on-screen borehole-column and CPT-column drawing pieces, the helpers that read which data tracks are switched on, the project-colour lookup, the region-to-path helpers, the paper dimensions, and the unit colour-and-label helpers.

**Why it is here.** An *SVG* is a vector-drawing format the browser understands: a picture described by coordinates and shapes rather than a grid of dots, so it prints crisp at any size. The comment records the key decision behind the whole PDF feature: this one drawing is used unchanged for both the on-screen preview and the printed page (the design note's ``the print DOM is the preview DOM``). It also notes that the geometry arrives already worked out in millimetres and is turned into on-screen pixels once, here. Reusing the exact ``BoreholeColumn`` and ``CptDataColumn`` pieces the section editor uses is what keeps the print a faithful copy of the screen.

.. CG-EXPLANATION-END id=module-header

``const INK``
-------------

.. CG-BLOCK id=const:INK lines=22-39

.. literalinclude:: ../../../desktop/src/renderer/src/sheet/ProfileDrawing.tsx
   :language: tsx
   :lines: 22-39
   :lineno-match:

.. CG-EXPLANATION-START id=const:INK

**What this does.** Sets a fixed named value ``INK`` to a dark blue-grey colour (written as the hex code ``#1f2933``) that every line and text label on the drawing is coloured with. The block also carries the documentation comment for the ``ColumnScaleHeader`` helper that follows it, explaining that the helper prints the small qc / Rf scale ticks above each CPT column.

**Why it is here.** One ink colour kept in a single named constant, so every stroke and label on the sheet reads as the same consistent dark tone against white paper. The attached comment records the owner's finding of 2026-09-04 that the printed sheet was missing a per-column header saying ``what is what``, and that the tick values and the left-right reading direction are copied straight from the on-screen section header so the printed labels and the traces sit on the same scale.

.. CG-EXPLANATION-END id=const:INK

``function ColumnScaleHeader``
------------------------------

.. CG-BLOCK id=function:ColumnScaleHeader lines=40-63

.. literalinclude:: ../../../desktop/src/renderer/src/sheet/ProfileDrawing.tsx
   :language: tsx
   :lines: 40-63
   :lineno-match:

.. CG-EXPLANATION-START id=function:ColumnScaleHeader

**What this does.** A small drawing helper for the scale labels printed just above one CPT column. Cone resistance (qc) reads to the right: it places a ``2`` and a ``10`` at the paper positions that match 2 and 10 MPa, and the section-wide full-scale value in MPa at the right edge. Friction ratio (Rf) reads mirrored to the left, with ``2%`` and ``4%`` marks. Each label is drawn only when that track is switched on. It returns a small group of SVG text elements.

**Why it is here.** The owner found on 2026-09-04 that the printed sheet did not say what each track was. This header labels the qc and Rf axes with the same numbers (2 and 10 MPa, 2 % and 4 %) and the same rightward-qc / leftward-Rf reading direction as the on-screen ``CptDataColumn``, so the engineer reads the paper the way he reads the screen. It is drawn small, in the sheet's ink, so it stays legible on white.

.. CG-EXPLANATION-END id=function:ColumnScaleHeader

``function ProfileDrawing``
---------------------------

.. CG-BLOCK id=function:ProfileDrawing lines=64-172

.. literalinclude:: ../../../desktop/src/renderer/src/sheet/ProfileDrawing.tsx
   :language: tsx
   :lines: 64-172
   :lineno-match:

.. CG-EXPLANATION-START id=function:ProfileDrawing

**What this does.** The main function that builds the whole profile picture. It first converts the millimetre geometry into on-screen pixels once (a pixels-per-millimetre factor), builds a small converter that turns an elevation in metres TAW into a vertical pixel position, and works out each column's horizontal pixel position. It then decides how wide each column's trace is drawn on paper (the ``half-width``), whether the columns are wide enough to carry the scale header, and picks one section-wide qc full scale so every CPT column shares the same axis. It chooses the elevation-axis tick spacing (1, 2, 5, 10 or 20 m, so there are never more than 14 ticks) and the along-section tick spacing. Finally it returns the SVG: the coloured fill polygons first (the partition, seams shared, outlined in ink), then unit names centred inside regions big enough to hold a label, then for each column a hairline vertical line with the CPT trace or borehole strip drawn on top of the fill, the per-column scale header, and the short code in the project colour; then the elevation axis with its ticks and the ``m TAW`` caption, the along-section axis, and the red ``A`` and ``A′`` labels at the two ends.

**Why it is here.** This is the faithful render the owner asked for. It draws the very same partition polygons the screen draws, filled continuously across the columns, with the logs drawn on the fill rather than inside a white box (the design note: ``the fill runs continuously across the columns; a column is a hairline axis ... no white mask``). Elevation is drawn as absolute level in metres TAW exactly as on screen, never as depth below the surface, which is why the old exporter had to be replaced. The drawn column half-width follows the on-paper spacing because, as the in-code comment says, a fixed paper width made every column a tall hairline on a wide sheet; and the scale header is dropped for tightly-packed columns, mirroring how the on-screen panel drops its labels when columns crowd. A unit name is left out rather than allowed to overlap when its region is too small to hold it.

.. CG-EXPLANATION-END id=function:ProfileDrawing

