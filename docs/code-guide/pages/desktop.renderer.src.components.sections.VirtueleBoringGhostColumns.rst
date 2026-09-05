desktop.renderer.src.components.sections.VirtueleBoringGhostColumns
===================================================================

.. CG-PAGE source=desktop/src/renderer/src/components/sections/VirtueleBoringGhostColumns.tsx complete=true

*Source file:* ``desktop/src/renderer/src/components/sections/VirtueleBoringGhostColumns.tsx``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-49

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/VirtueleBoringGhostColumns.tsx
   :language: tsx
   :lines: 1-49
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The top of the file that draws slim labelled 'ghost' columns of DOV Virtuele Boring (virtual-borehole) predictions next to each investigation on the section. It imports the prediction data types, the label-wrapping helpers, the shared multi-line label, and the placed-column type.

**Why it is here.** The docstring records that this overlay is informative only — it never contributes to contact placement and never gates the Build — so engineers can use it to inform their manual picks ('DOV thinks Boom starts at -14 here'). It notes the layout (own band, then model A ghost, then model B ghost), that layer colour comes from DOV's own per-unit colour, and that a 0.55 opacity plus a thin stroke keeps the ghost reading as 'DOV predicts' rather than ground truth.

.. CG-EXPLANATION-END id=module-header

``const GHOST_COLUMN_WIDTH_PX``
-------------------------------

.. CG-BLOCK id=const:GHOST_COLUMN_WIDTH_PX lines=50-50

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/VirtueleBoringGhostColumns.tsx
   :language: tsx
   :lines: 50-50
   :lineno-match:

.. CG-EXPLANATION-START id=const:GHOST_COLUMN_WIDTH_PX

**What this does.** The drawn width of one ghost column, 44 px.

**Why it is here.** The comment: wide enough for a short label like 'Fm Boom', narrow enough that two side-by-side ghosts do not double the column footprint. It is exported so the panel's layout can fold the ghost rail width into each column's collision width.

.. CG-EXPLANATION-END id=const:GHOST_COLUMN_WIDTH_PX

``const GHOST_COLUMN_GAP_PX``
-----------------------------

.. CG-BLOCK id=const:GHOST_COLUMN_GAP_PX lines=51-51

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/VirtueleBoringGhostColumns.tsx
   :language: tsx
   :lines: 51-51
   :lineno-match:

.. CG-EXPLANATION-START id=const:GHOST_COLUMN_GAP_PX

**What this does.** The gap between two side-by-side ghost columns, 4 px.

**Why it is here.** Separates model A's ghost from model B's so the two stacks are distinct.

.. CG-EXPLANATION-END id=const:GHOST_COLUMN_GAP_PX

``const GHOST_GAP_FROM_BAND_PX``
--------------------------------

.. CG-BLOCK id=const:GHOST_GAP_FROM_BAND_PX lines=52-52

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/VirtueleBoringGhostColumns.tsx
   :language: tsx
   :lines: 52-52
   :lineno-match:

.. CG-EXPLANATION-START id=const:GHOST_GAP_FROM_BAND_PX

**What this does.** The gap between the investigation's own data band and the first ghost column, 6 px.

**Why it is here.** Sets the ghost rail off from the real data band so the two are not confused.

.. CG-EXPLANATION-END id=const:GHOST_GAP_FROM_BAND_PX

``const GHOST_OPACITY``
-----------------------

.. CG-BLOCK id=const:GHOST_OPACITY lines=53-53

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/VirtueleBoringGhostColumns.tsx
   :language: tsx
   :lines: 53-53
   :lineno-match:

.. CG-EXPLANATION-START id=const:GHOST_OPACITY

**What this does.** The see-through level of every ghost rectangle, 0.55.

**Why it is here.** The docstring: makes the ghost read as a prediction rather than ground truth, so the engineer's own picks keep visual priority.

.. CG-EXPLANATION-END id=const:GHOST_OPACITY

``const LABEL_FONT_SIZE``
-------------------------

.. CG-BLOCK id=const:LABEL_FONT_SIZE lines=54-54

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/VirtueleBoringGhostColumns.tsx
   :language: tsx
   :lines: 54-54
   :lineno-match:

.. CG-EXPLANATION-START id=const:LABEL_FONT_SIZE

**What this does.** The font size for the layer label inside a ghost rectangle.

**Why it is here.** Sized to fit inside a narrow ghost column.

.. CG-EXPLANATION-END id=const:LABEL_FONT_SIZE

``const HEADER_FONT_SIZE``
--------------------------

.. CG-BLOCK id=const:HEADER_FONT_SIZE lines=55-61

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/VirtueleBoringGhostColumns.tsx
   :language: tsx
   :lines: 55-61
   :lineno-match:

.. CG-EXPLANATION-START id=const:HEADER_FONT_SIZE

**What this does.** The font size for the small model-code header above each ghost column.

**Why it is here.** A ghost column is narrow, so its header is smaller than the layer labels.

.. CG-EXPLANATION-END id=const:HEADER_FONT_SIZE

``function virtueleBoringGhostRailWidth``
-----------------------------------------

.. CG-BLOCK id=function:virtueleBoringGhostRailWidth lines=62-70

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/VirtueleBoringGhostColumns.tsx
   :language: tsx
   :lines: 62-70
   :lineno-match:

.. CG-EXPLANATION-START id=function:virtueleBoringGhostRailWidth

**What this does.** Computes the total horizontal footprint, in pixels, of the ghost rail for a given number of active models, returning zero when none are active.

**Why it is here.** The comment: returning zero for no active models lets callers skip the collision-padding branch entirely, and the panel's layout uses the width to avoid columns overlapping the ghost rail.

.. CG-EXPLANATION-END id=function:virtueleBoringGhostRailWidth

``interface VirtueleBoringGhostColumnsProps``
---------------------------------------------

.. CG-BLOCK id=interface:VirtueleBoringGhostColumnsProps lines=71-96

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/VirtueleBoringGhostColumns.tsx
   :language: tsx
   :lines: 71-96
   :lineno-match:

.. CG-EXPLANATION-START id=interface:VirtueleBoringGhostColumnsProps

**What this does.** The inputs: the placed columns (carrying the nudged x), the ordered list of active model codes, the per-investigation predictions map, the elevation-to-screen transform, the plot bounds for clamping, the data-band half-width, and the optional depth cap below each surface.

**Why it is here.** The predictions and active-model list decide what is drawn; the depth cap lets the engineer trim DOV's full crustal column to the shallow part they care about; an empty active-model list short-circuits to no render.

.. CG-EXPLANATION-END id=interface:VirtueleBoringGhostColumnsProps

``function VirtueleBoringGhostColumns``
---------------------------------------

.. CG-BLOCK id=function:VirtueleBoringGhostColumns lines=97-158

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/VirtueleBoringGhostColumns.tsx
   :language: tsx
   :lines: 97-158
   :lineno-match:

.. CG-EXPLANATION-START id=function:VirtueleBoringGhostColumns

**What this does.** The top-level component. It returns nothing when no model is active or no predictions exist, then for each column looks up its prediction, computes the depth cap once, and for each active model draws a ghost column: a header with the model code and a stack of layer rectangles, placed to the right of the data band and offset per model index.

**Why it is here.** Computing the depth cap once per investigation means every layer of that column shares the same lower bound, and offsetting by the model index lays model A and model B side by side without overlap.

.. CG-EXPLANATION-END id=function:VirtueleBoringGhostColumns

``function GhostColumnHeader``
------------------------------

.. CG-BLOCK id=function:GhostColumnHeader lines=159-188

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/VirtueleBoringGhostColumns.tsx
   :language: tsx
   :lines: 159-188
   :lineno-match:

.. CG-EXPLANATION-START id=function:GhostColumnHeader

**What this does.** A small component that draws the model-code text just above the plot top so each ghost column is labelled with which model it came from.

**Why it is here.** The comment: it mounts above the plot with its baseline ending at the plot top so the label reads as 'this column equals X' without intruding on the level axis; DOV's model codes are short so truncation is rarely needed.

.. CG-EXPLANATION-END id=function:GhostColumnHeader

``function VirtueleBoringGhostLayer``
-------------------------------------

.. CG-BLOCK id=function:VirtueleBoringGhostLayer lines=189-258

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/VirtueleBoringGhostColumns.tsx
   :language: tsx
   :lines: 189-258
   :lineno-match:

.. CG-EXPLANATION-START id=function:VirtueleBoringGhostLayer

**What this does.** A small component that draws one predicted layer rectangle. It applies the depth cap (dropping a layer wholly below it and clipping one that straddles it), converts top and base elevations to clamped screen y, skips a collapsed rectangle, fills with DOV's layer colour, builds a tooltip of the depth range and thickness, wraps a label to as many lines as fit, and draws the rectangle plus label.

**Why it is here.** The comments explain the depth cap is applied before clamping to the plot so a layer below the cap is dropped and a straddling one is clipped at it, and that the label falls back to tooltip-only when the rectangle is too thin so it never renders a partial-letter clipped label.

.. CG-EXPLANATION-END id=function:VirtueleBoringGhostLayer

