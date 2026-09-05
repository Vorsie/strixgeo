desktop.renderer.src.sheet.sheetConstants
=========================================

.. CG-PAGE source=desktop/src/renderer/src/sheet/sheetConstants.ts complete=false

*Source file:* ``desktop/src/renderer/src/sheet/sheetConstants.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-7

.. literalinclude:: ../../../desktop/src/renderer/src/sheet/sheetConstants.ts
   :language: typescript
   :lines: 1-7
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** A documentation comment saying this file holds every paper dimension of the sheet, in millimetres, plus the one conversion the drawing needs, and that the numbers come from the design spec's ``The sheet`` section.

**Why it is here.** The whole sheet is measured in millimetres on paper, and the project convention is that such fixed numbers live in one dedicated constants file rather than being scattered through the code. Keeping them together, each with a comment on why it was chosen, means a change to the paper layout touches this one place. A *millimetre* here is a real distance on the printed page, kept separate from *metres in the ground*, which the section is measured in.

.. CG-EXPLANATION-END id=module-header

``const PX_PER_MM``
-------------------

.. CG-BLOCK id=const:PX_PER_MM lines=8-10

.. literalinclude:: ../../../desktop/src/renderer/src/sheet/sheetConstants.ts
   :language: typescript
   :lines: 8-10
   :lineno-match:

.. CG-EXPLANATION-START id=const:PX_PER_MM

**What this does.** Sets the number of screen pixels in one millimetre at Chromium's print resolution: 96 dots per inch divided by 25.4 millimetres per inch.

**Why it is here.** The layout is worked out in millimetres for paper, but the browser draws in pixels (screen dots). This one factor converts between the two. 96 dots per inch is the resolution Chromium uses when it turns the page into a PDF, so using it here makes the on-screen preview and the printed page line up exactly.

.. CG-EXPLANATION-END id=const:PX_PER_MM

``const PAPER_HEIGHT_MM``
-------------------------

.. CG-BLOCK id=const:PAPER_HEIGHT_MM lines=11-12

.. literalinclude:: ../../../desktop/src/renderer/src/sheet/sheetConstants.ts
   :language: typescript
   :lines: 11-12
   :lineno-match:

.. CG-EXPLANATION-START id=const:PAPER_HEIGHT_MM

**What this does.** Sets the sheet's fixed height to 297 mm — the short side of an A3 page — used in fit mode.

**Why it is here.** The owner ruled ``go for a3 height``. A3 is a standard 297 by 420 mm sheet; the drawing is laid landscape, so its height is A3's short side, 297 mm.

.. CG-EXPLANATION-END id=const:PAPER_HEIGHT_MM

``const PAPER_MIN_WIDTH_MM``
----------------------------

.. CG-BLOCK id=const:PAPER_MIN_WIDTH_MM lines=13-14

.. literalinclude:: ../../../desktop/src/renderer/src/sheet/sheetConstants.ts
   :language: typescript
   :lines: 13-14
   :lineno-match:

.. CG-EXPLANATION-START id=const:PAPER_MIN_WIDTH_MM

**What this does.** Sets the sheet's minimum width to 420 mm — the long side of an A3 page.

**Why it is here.** So that even a short section still prints on a full A3-size sheet rather than a cramped strip; the width grows beyond this only when the profile is longer.

.. CG-EXPLANATION-END id=const:PAPER_MIN_WIDTH_MM

``const PAPER_MAX_WIDTH_MM``
----------------------------

.. CG-BLOCK id=const:PAPER_MAX_WIDTH_MM lines=15-16

.. literalinclude:: ../../../desktop/src/renderer/src/sheet/sheetConstants.ts
   :language: typescript
   :lines: 15-16
   :lineno-match:

.. CG-EXPLANATION-START id=const:PAPER_MAX_WIDTH_MM

**What this does.** Sets the largest allowed sheet width to 5000 mm.

**Why it is here.** Chromium refuses to make a PDF page wider than 200 inches; past this width the preview says so and export is refused, so the tool never produces a file the printer cannot make.

.. CG-EXPLANATION-END id=const:PAPER_MAX_WIDTH_MM

``const MARGIN_MM``
-------------------

.. CG-BLOCK id=const:MARGIN_MM lines=17-18

.. literalinclude:: ../../../desktop/src/renderer/src/sheet/sheetConstants.ts
   :language: typescript
   :lines: 17-18
   :lineno-match:

.. CG-EXPLANATION-START id=const:MARGIN_MM

**What this does.** Sets the blank margin all around the sheet to 10 mm.

**Why it is here.** A standard clear border so nothing is drawn to the very edge of the paper, matching the spec's ``Margins`` rule.

.. CG-EXPLANATION-END id=const:MARGIN_MM

``const AXIS_GUTTER_MM``
------------------------

.. CG-BLOCK id=const:AXIS_GUTTER_MM lines=19-20

.. literalinclude:: ../../../desktop/src/renderer/src/sheet/sheetConstants.ts
   :language: typescript
   :lines: 19-20
   :lineno-match:

.. CG-EXPLANATION-START id=const:AXIS_GUTTER_MM

**What this does.** Sets a 14 mm gutter on the left of the drawing for the elevation-axis labels.

**Why it is here.** The metres-TAW numbers down the left need room to sit without touching the drawing; this reserves that space.

.. CG-EXPLANATION-END id=const:AXIS_GUTTER_MM

``const TOP_BAND_MM``
---------------------

.. CG-BLOCK id=const:TOP_BAND_MM lines=21-22

.. literalinclude:: ../../../desktop/src/renderer/src/sheet/sheetConstants.ts
   :language: typescript
   :lines: 21-22
   :lineno-match:

.. CG-EXPLANATION-START id=const:TOP_BAND_MM

**What this does.** Sets a 10 mm band above the drawing for the ``A`` / ``A′`` end labels and the column codes.

**Why it is here.** The section-end letters and the short codes above each column need a clear strip above the fills; this reserves it.

.. CG-EXPLANATION-END id=const:TOP_BAND_MM

``const ALONG_BAND_MM``
-----------------------

.. CG-BLOCK id=const:ALONG_BAND_MM lines=23-24

.. literalinclude:: ../../../desktop/src/renderer/src/sheet/sheetConstants.ts
   :language: typescript
   :lines: 23-24
   :lineno-match:

.. CG-EXPLANATION-START id=const:ALONG_BAND_MM

**What this does.** Sets an 8 mm band under the drawing for the along-section distance labels.

**Why it is here.** The distances from A (in metres) printed under the drawing need their own strip; this reserves it.

.. CG-EXPLANATION-END id=const:ALONG_BAND_MM

``const UNIT_LEGEND_MM``
------------------------

.. CG-BLOCK id=const:UNIT_LEGEND_MM lines=25-26

.. literalinclude:: ../../../desktop/src/renderer/src/sheet/sheetConstants.ts
   :language: typescript
   :lines: 25-26
   :lineno-match:

.. CG-EXPLANATION-START id=const:UNIT_LEGEND_MM

**What this does.** Sets a 14 mm strip under the profile for the unit legend (colour swatch plus unit name).

**Why it is here.** The legend that names each coloured unit needs room under the drawing; this reserves it, and it may wrap onto more than one line within that strip.

.. CG-EXPLANATION-END id=const:UNIT_LEGEND_MM

``const DRAWING_HEIGHT_FIT_MM``
-------------------------------

.. CG-BLOCK id=const:DRAWING_HEIGHT_FIT_MM lines=27-29

.. literalinclude:: ../../../desktop/src/renderer/src/sheet/sheetConstants.ts
   :language: typescript
   :lines: 27-29
   :lineno-match:

.. CG-EXPLANATION-START id=const:DRAWING_HEIGHT_FIT_MM

**What this does.** Computes the drawing's height in fit mode by subtracting all the reserved bands from the paper height: 297 minus the two 10 mm margins, the 10 mm top band, the 8 mm along-section band and the 14 mm unit legend — 245 mm.

**Why it is here.** In fit mode the whole section must fit the A3 height, so the drawing gets exactly the vertical space left over once every other band is reserved. Deriving it from the other constants means changing any band automatically corrects this one.

.. CG-EXPLANATION-END id=const:DRAWING_HEIGHT_FIT_MM

``const VERTICAL_CHROME_MM``
----------------------------

.. CG-BLOCK id=const:VERTICAL_CHROME_MM lines=30-32

.. literalinclude:: ../../../desktop/src/renderer/src/sheet/sheetConstants.ts
   :language: typescript
   :lines: 30-32
   :lineno-match:

.. CG-EXPLANATION-START id=const:VERTICAL_CHROME_MM

**What this does.** Computes everything on the page that is not the drawing, measured vertically: the paper height minus the fit-mode drawing height — 52 mm.

**Why it is here.** In explicit mode the drawing height is set by the scale and the sheet grows to fit; this figure is the fixed extra height the bands and margins always add on top of the drawing, so the paper height can be worked out from the drawing height alone.

.. CG-EXPLANATION-END id=const:VERTICAL_CHROME_MM

``const RIGHT_COLUMN_MM``
-------------------------

.. CG-BLOCK id=const:RIGHT_COLUMN_MM lines=33-33

.. literalinclude:: ../../../desktop/src/renderer/src/sheet/sheetConstants.ts
   :language: typescript
   :lines: 33-33
   :lineno-match:

.. CG-EXPLANATION-START id=const:RIGHT_COLUMN_MM

**What this does.** Sets the right-hand column — holding the map, the project legend and the title block — to 100 mm wide.

**Why it is here.** The owner asked for the map on the right ``the same width as the box on the right bottom``; fixing the whole right column at one width keeps the map, legend and title block aligned in a tidy stack.

.. CG-EXPLANATION-END id=const:RIGHT_COLUMN_MM

``const GUTTER_MM``
-------------------

.. CG-BLOCK id=const:GUTTER_MM lines=34-35

.. literalinclude:: ../../../desktop/src/renderer/src/sheet/sheetConstants.ts
   :language: typescript
   :lines: 34-35
   :lineno-match:

.. CG-EXPLANATION-START id=const:GUTTER_MM

**What this does.** Sets the 8 mm gap between the profile drawing and the right-hand column.

**Why it is here.** A clear separation so the drawing and the map-and-title stack do not run together.

.. CG-EXPLANATION-END id=const:GUTTER_MM

``const MAP_HEIGHT_MM``
-----------------------

.. CG-BLOCK id=const:MAP_HEIGHT_MM lines=36-36

.. literalinclude:: ../../../desktop/src/renderer/src/sheet/sheetConstants.ts
   :language: typescript
   :lines: 36-36
   :lineno-match:

.. CG-EXPLANATION-START id=const:MAP_HEIGHT_MM

**What this does.** Sets the map box height to 87.5 mm, which gives the 100 mm-wide box an 8:7 width-to-height shape.

**Why it is here.** The owner wanted a tidier map pane; an 8:7 box (the aspect used in the mockup) is a pleasant near-square that frames the section well. *Aspect* just means the ratio of width to height.

.. CG-EXPLANATION-END id=const:MAP_HEIGHT_MM

``const MAP_LEGEND_GAP_MM``
---------------------------

.. CG-BLOCK id=const:MAP_LEGEND_GAP_MM lines=37-37

.. literalinclude:: ../../../desktop/src/renderer/src/sheet/sheetConstants.ts
   :language: typescript
   :lines: 37-37
   :lineno-match:

.. CG-EXPLANATION-START id=const:MAP_LEGEND_GAP_MM

**What this does.** Sets a 3 mm gap between the map box and the project legend under it.

**Why it is here.** The owner asked for the legend ``flush under the map``; a small 3 mm gap keeps them visually joined without touching.

.. CG-EXPLANATION-END id=const:MAP_LEGEND_GAP_MM

``const TITLE_BLOCK_MM``
------------------------

.. CG-BLOCK id=const:TITLE_BLOCK_MM lines=38-38

.. literalinclude:: ../../../desktop/src/renderer/src/sheet/sheetConstants.ts
   :language: typescript
   :lines: 38-38
   :lineno-match:

.. CG-EXPLANATION-START id=const:TITLE_BLOCK_MM

**What this does.** Sets the four-field title block height to 40 mm.

**Why it is here.** Enough height for four readable rows of label-and-value in the DOV length-profile style the owner asked to copy.

.. CG-EXPLANATION-END id=const:TITLE_BLOCK_MM

``const SCALE_LINE_MM``
-----------------------

.. CG-BLOCK id=const:SCALE_LINE_MM lines=39-46

.. literalinclude:: ../../../desktop/src/renderer/src/sheet/sheetConstants.ts
   :language: typescript
   :lines: 39-46
   :lineno-match:

.. CG-EXPLANATION-START id=const:SCALE_LINE_MM

**What this does.** Sets a 6 mm strip at the very bottom of the right column for the printed scale line. The comment lines shown after it document the next constant, the minimum drawn column width.

**Why it is here.** The printed scales (``H 1:N   V 1:N   exaggeration N×``) need a fixed strip at the foot of the right column; 6 mm holds one line of text.

.. CG-EXPLANATION-END id=const:SCALE_LINE_MM

``const COLUMN_HALF_WIDTH_MM``
------------------------------

.. CG-BLOCK id=const:COLUMN_HALF_WIDTH_MM lines=47-50

.. literalinclude:: ../../../desktop/src/renderer/src/sheet/sheetConstants.ts
   :language: typescript
   :lines: 47-50
   :lineno-match:

.. CG-EXPLANATION-START id=const:COLUMN_HALF_WIDTH_MM

**What this does.** Sets the minimum half-width of a drawn column on paper to 5 mm — half the narrowest a column's qc trace or log strip is ever drawn. The comment shown after it documents the next constant, the width cap.

**Why it is here.** As the comment explains, the actual drawn width grows with the on-paper column spacing so widely-spaced columns read as legible strips rather than tall hairlines; this 5 mm is the floor below which a column is never drawn.

.. CG-EXPLANATION-END id=const:COLUMN_HALF_WIDTH_MM

``const COLUMN_HALF_WIDTH_MAX_MM``
----------------------------------

.. CG-BLOCK id=const:COLUMN_HALF_WIDTH_MAX_MM lines=51-57

.. literalinclude:: ../../../desktop/src/renderer/src/sheet/sheetConstants.ts
   :language: typescript
   :lines: 51-57
   :lineno-match:

.. CG-EXPLANATION-START id=const:COLUMN_HALF_WIDTH_MAX_MM

**What this does.** Sets the largest half-width a drawn column may reach to 18 mm. The comment shown after it documents the next constant, the spacing fraction.

**Why it is here.** As the comment says, this cap stops a very wide sheet from ballooning a column into a solid slab, and it is chosen below half the smallest spacing it can apply at, so two adjacent columns can never overlap.

.. CG-EXPLANATION-END id=const:COLUMN_HALF_WIDTH_MAX_MM

``const COLUMN_WIDTH_SPACING_FRACTION``
---------------------------------------

.. CG-BLOCK id=const:COLUMN_WIDTH_SPACING_FRACTION lines=58-64

.. literalinclude:: ../../../desktop/src/renderer/src/sheet/sheetConstants.ts
   :language: typescript
   :lines: 58-64
   :lineno-match:

.. CG-EXPLANATION-START id=const:COLUMN_WIDTH_SPACING_FRACTION

**What this does.** Sets the drawn column half-width to 0.42 of the distance to its nearest neighbour on paper (before the min and max clamps). The comment shown after it documents the next constant, the header threshold.

**Why it is here.** Making the width follow the spacing is what fixed the owner's ``hairline columns`` finding of 2026-09-04; the fraction is kept below one half so two columns, each reaching out to either side by this amount, can never touch.

.. CG-EXPLANATION-END id=const:COLUMN_WIDTH_SPACING_FRACTION

``const COLUMN_HEADER_MIN_HALF_WIDTH_MM``
-----------------------------------------

.. CG-BLOCK id=const:COLUMN_HEADER_MIN_HALF_WIDTH_MM lines=65-66

.. literalinclude:: ../../../desktop/src/renderer/src/sheet/sheetConstants.ts
   :language: typescript
   :lines: 65-66
   :lineno-match:

.. CG-EXPLANATION-START id=const:COLUMN_HEADER_MIN_HALF_WIDTH_MM

**What this does.** Sets the width a drawn column must reach — 8 mm half-width — before its qc / Rf scale header is printed. The comment shown after it documents the next constant, the edge gap.

**Why it is here.** As the comment records, a column narrower than this cannot hold the right-anchored ``full-scale MPa`` label without it overrunning the interior 2 and 10 marks, so the header is dropped for crowded columns, exactly as the on-screen panel drops its scale labels when columns pack tightly.

.. CG-EXPLANATION-END id=const:COLUMN_HEADER_MIN_HALF_WIDTH_MM

``const COLUMN_EDGE_GAP_MM``
----------------------------

.. CG-BLOCK id=const:COLUMN_EDGE_GAP_MM lines=67-68

.. literalinclude:: ../../../desktop/src/renderer/src/sheet/sheetConstants.ts
   :language: typescript
   :lines: 67-68
   :lineno-match:

.. CG-EXPLANATION-START id=const:COLUMN_EDGE_GAP_MM

**What this does.** Sets the 2 mm gap the column-placement nudge keeps between neighbouring columns.

**Why it is here.** When columns are packed together they are nudged apart so they never sit right on top of each other; this is the minimum clear gap that nudge preserves.

.. CG-EXPLANATION-END id=const:COLUMN_EDGE_GAP_MM

``const PROFILE_TRAILING_MM``
-----------------------------

.. CG-BLOCK id=const:PROFILE_TRAILING_MM lines=69-70

.. literalinclude:: ../../../desktop/src/renderer/src/sheet/sheetConstants.ts
   :language: typescript
   :lines: 69-70
   :lineno-match:

.. CG-EXPLANATION-START id=const:PROFILE_TRAILING_MM

**What this does.** Sets a 6 mm trailing space after the last column before the gutter.

**Why it is here.** So the rightmost column and its trace are not cut off at the drawing's edge; a little clear space follows the final column.

.. CG-EXPLANATION-END id=const:PROFILE_TRAILING_MM

``const LEVEL_PAD_M``
---------------------

.. CG-BLOCK id=const:LEVEL_PAD_M lines=71-72

.. literalinclude:: ../../../desktop/src/renderer/src/sheet/sheetConstants.ts
   :language: typescript
   :lines: 71-72
   :lineno-match:

.. CG-EXPLANATION-START id=const:LEVEL_PAD_M

**What this does.** Sets a 0.5 m padding above the highest and below the lowest level shown.

**Why it is here.** So the top collar and the deepest layer base are not drawn hard against the top and bottom of the frame; half a metre of breathing space is added at each end. This is measured in real ground metres, not paper millimetres.

.. CG-EXPLANATION-END id=const:LEVEL_PAD_M

``const MIN_DRAWING_HEIGHT_MM``
-------------------------------

.. CG-BLOCK id=const:MIN_DRAWING_HEIGHT_MM lines=73-75

.. literalinclude:: ../../../desktop/src/renderer/src/sheet/sheetConstants.ts
   :language: typescript
   :lines: 73-75
   :lineno-match:

.. CG-EXPLANATION-START id=const:MIN_DRAWING_HEIGHT_MM

**What this does.** Sets the smallest a drawing may ever be in explicit mode to 60 mm.

**Why it is here.** In explicit mode the engineer types the scales and the drawing height follows from them; this floor stops a very small chosen scale from collapsing the drawing to nothing.

.. CG-EXPLANATION-END id=const:MIN_DRAWING_HEIGHT_MM

``const MAP_PAD_FRACTION``
--------------------------

.. CG-BLOCK id=const:MAP_PAD_FRACTION lines=76-76

.. literalinclude:: ../../../desktop/src/renderer/src/sheet/sheetConstants.ts
   :language: typescript
   :lines: 76-76
   :lineno-match:

.. CG-EXPLANATION-START id=const:MAP_PAD_FRACTION

**What this does.** Sets the map padding to 0.25 — 25 % added on each side of the points the map must show.

**Why it is here.** So the section and its investigations sit comfortably inside the map box rather than on its edge, as the spec's ``Extent`` rule requires.

.. CG-EXPLANATION-END id=const:MAP_PAD_FRACTION

``const MAP_MIN_SPAN_M``
------------------------

.. CG-BLOCK id=const:MAP_MIN_SPAN_M lines=77-77

.. literalinclude:: ../../../desktop/src/renderer/src/sheet/sheetConstants.ts
   :language: typescript
   :lines: 77-77
   :lineno-match:

.. CG-EXPLANATION-START id=const:MAP_MIN_SPAN_M

**What this does.** Sets the smallest ground width the map box will show to 200 m.

**Why it is here.** So a very short section does not zoom the map in absurdly close; the map always shows at least 200 m of ground across.

.. CG-EXPLANATION-END id=const:MAP_MIN_SPAN_M

``const MAP_ASPECT``
--------------------

.. CG-BLOCK id=const:MAP_ASPECT lines=78-79

.. literalinclude:: ../../../desktop/src/renderer/src/sheet/sheetConstants.ts
   :language: typescript
   :lines: 78-79
   :lineno-match:

.. CG-EXPLANATION-START id=const:MAP_ASPECT

**What this does.** Sets the map box's width-to-height ratio to 8:7.

**Why it is here.** The extent is stretched to this same shape as the map box (87.5 mm tall, 100 mm wide) so the map picture is never squashed or stretched out of true.

.. CG-EXPLANATION-END id=const:MAP_ASPECT

``const SCALE_BAR_CANDIDATES_M``
--------------------------------

.. CG-BLOCK id=const:SCALE_BAR_CANDIDATES_M lines=80-81

.. literalinclude:: ../../../desktop/src/renderer/src/sheet/sheetConstants.ts
   :language: typescript
   :lines: 80-81
   :lineno-match:

.. CG-EXPLANATION-START id=const:SCALE_BAR_CANDIDATES_M

**What this does.** Lists the allowed scale-bar lengths: 50, 100, 200, 500, 1000 and 2000 m.

**Why it is here.** The printed scale bar is chosen from this fixed set of round numbers — whichever is nearest a third of the map width — so the bar always reads as a tidy round length.

.. CG-EXPLANATION-END id=const:SCALE_BAR_CANDIDATES_M

``const TILE_WAIT_MS``
----------------------

.. CG-BLOCK id=const:TILE_WAIT_MS lines=82-84

.. literalinclude:: ../../../desktop/src/renderer/src/sheet/sheetConstants.ts
   :language: typescript
   :lines: 82-84
   :lineno-match:

.. CG-EXPLANATION-START id=const:TILE_WAIT_MS

**What this does.** Sets how long the export waits for the background map tiles to arrive to 4000 milliseconds (4 seconds), then prints without them.

**Why it is here.** A print must never hang on a slow or missing internet map; after 4 seconds the sheet prints with the offline caption instead. A *millisecond* is one thousandth of a second.

.. CG-EXPLANATION-END id=const:TILE_WAIT_MS

``const PROJECT_PALETTE``
-------------------------

.. CG-BLOCK id=const:PROJECT_PALETTE lines=85-89

.. literalinclude:: ../../../desktop/src/renderer/src/sheet/sheetConstants.ts
   :language: typescript
   :lines: 85-89
   :lineno-match:

.. CG-EXPLANATION-START id=const:PROJECT_PALETTE

**What this does.** Lists the eight project colours as hex codes — the Okabe–Ito palette — assigned one per project in order of first appearance.

**Why it is here.** Okabe–Ito is a published set of eight hues chosen to stay distinguishable for colour-blind readers, so every project's colour is legible to everyone. A *hex code* is the ``#rrggbb`` way of writing a colour.

.. CG-EXPLANATION-END id=const:PROJECT_PALETTE

``const LABEL_MIN_WIDTH_PX``
----------------------------

.. CG-BLOCK id=const:LABEL_MIN_WIDTH_PX lines=90-90

.. literalinclude:: ../../../desktop/src/renderer/src/sheet/sheetConstants.ts
   :language: typescript
   :lines: 90-90
   :lineno-match:

.. CG-EXPLANATION-START id=const:LABEL_MIN_WIDTH_PX

**What this does.** Sets the smallest region width, 60 pixels, that will still carry its unit name.

**Why it is here.** A region narrower than this cannot hold its label without spilling over its neighbours, so its name is dropped rather than overlapped.

.. CG-EXPLANATION-END id=const:LABEL_MIN_WIDTH_PX

``const LABEL_MIN_HEIGHT_PX``
-----------------------------

.. CG-BLOCK id=const:LABEL_MIN_HEIGHT_PX lines=91-91

.. literalinclude:: ../../../desktop/src/renderer/src/sheet/sheetConstants.ts
   :language: typescript
   :lines: 91-91
   :lineno-match:

.. CG-EXPLANATION-START id=const:LABEL_MIN_HEIGHT_PX

**What this does.** Sets the smallest region height, 14 pixels, that will still carry its unit name.

**Why it is here.** The height counterpart of the width floor above: a region shorter than this drops its label rather than crushing the text.

.. CG-EXPLANATION-END id=const:LABEL_MIN_HEIGHT_PX

