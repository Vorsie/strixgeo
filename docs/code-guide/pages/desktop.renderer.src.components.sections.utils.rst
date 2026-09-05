desktop.renderer.src.components.sections.utils
==============================================

.. CG-PAGE source=desktop/src/renderer/src/components/sections/utils.ts complete=true

*Source file:* ``desktop/src/renderer/src/components/sections/utils.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-39

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/utils.ts
   :language: typescript
   :lines: 1-39
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The shared primitives for the cross-section panel, in three groups: pure tick helpers, the layout constants and types, and a small element-size hook.

**Why it is here.** Keeping these names in one place means the orchestrator and all the extracted sub-components reference the same coordinate vocabulary so their transforms stay in sync. The element-size hook lives here rather than in a shared hooks folder because no other module needs it yet, to be promoted on the second copy per the duplication rule.

.. CG-EXPLANATION-END id=module-header

``const STRAT_OBS_TYPES_FOR_SNAP``
----------------------------------

.. CG-BLOCK id=const:STRAT_OBS_TYPES_FOR_SNAP lines=40-56

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/utils.ts
   :language: typescript
   :lines: 40-56
   :lineno-match:

.. CG-EXPLANATION-START id=const:STRAT_OBS_TYPES_FOR_SNAP

**What this does.** The set of borehole observation types whose layer top and base depths feed the snap-to-stratigraphy interaction. The comment after describes the depth-collecting helper.

**Why it is here.** One shared set across the click path and the drag path keeps the two consumers in sync, and adding a third stratigraphy stream later becomes a one-line change here.

.. CG-EXPLANATION-END id=const:STRAT_OBS_TYPES_FOR_SNAP

``function collectSnapDepths``
------------------------------

.. CG-BLOCK id=function:collectSnapDepths lines=57-74

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/utils.ts
   :language: typescript
   :lines: 57-74
   :lineno-match:

.. CG-EXPLANATION-START id=function:collectSnapDepths

**What this does.** Returns the deduplicated layer top and base depths from a single borehole's stratigraphy observations.

**Why it is here.** It is the snap-target set the editor uses for both single-test click placement and section-wide drag; duplicate depths (where the base of one layer is the top of the next) collapse to a single entry.

.. CG-EXPLANATION-END id=function:collectSnapDepths

``const MARGIN``
----------------

.. CG-BLOCK id=const:MARGIN lines=75-79

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/utils.ts
   :language: typescript
   :lines: 75-79
   :lineno-match:

.. CG-EXPLANATION-START id=const:MARGIN

**What this does.** The pixel margins reserved around the plot for axis labels and ticks.

**Why it is here.** They are kept tight so the drawing area does not visibly shrink on small viewports.

.. CG-EXPLANATION-END id=const:MARGIN

``const DEFAULT_LEVEL_RANGE``
-----------------------------

.. CG-BLOCK id=const:DEFAULT_LEVEL_RANGE lines=80-85

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/utils.ts
   :language: typescript
   :lines: 80-85
   :lineno-match:

.. CG-EXPLANATION-START id=const:DEFAULT_LEVEL_RANGE

**What this does.** The default vertical window, minus forty to plus twenty, for a fresh section with no data overlaid.

**Why it is here.** It is just the initial framing so the canvas is not empty; the engineer can then pan and zoom freely.

.. CG-EXPLANATION-END id=const:DEFAULT_LEVEL_RANGE

``const VEX_MIN``
-----------------

.. CG-BLOCK id=const:VEX_MIN lines=86-86

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/utils.ts
   :language: typescript
   :lines: 86-86
   :lineno-match:

.. CG-EXPLANATION-START id=const:VEX_MIN

**What this does.** The lowest vertical-exaggeration value, 0.5.

**Why it is here.** Deep soundings of two hundred metres or more sometimes run this low.

.. CG-EXPLANATION-END id=const:VEX_MIN

``const VEX_MAX``
-----------------

.. CG-BLOCK id=const:VEX_MAX lines=87-87

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/utils.ts
   :language: typescript
   :lines: 87-87
   :lineno-match:

.. CG-EXPLANATION-START id=const:VEX_MAX

**What this does.** The highest vertical-exaggeration value, fifty.

**Why it is here.** Shallow profiles want strong vertical exaggeration to read clearly.

.. CG-EXPLANATION-END id=const:VEX_MAX

``const VEX_DEFAULT``
---------------------

.. CG-BLOCK id=const:VEX_DEFAULT lines=88-92

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/utils.ts
   :language: typescript
   :lines: 88-92
   :lineno-match:

.. CG-EXPLANATION-START id=const:VEX_DEFAULT

**What this does.** The default vertical exaggeration, one, with the slider log-mapped.

**Why it is here.** Engineers typically use five to ten times for shallow profiles, and log-mapping the slider makes both ends reachable with reasonable thumb travel.

.. CG-EXPLANATION-END id=const:VEX_DEFAULT

``const WHEEL_ZOOM_FACTOR``
---------------------------

.. CG-BLOCK id=const:WHEEL_ZOOM_FACTOR lines=93-96

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/utils.ts
   :language: typescript
   :lines: 93-96
   :lineno-match:

.. CG-EXPLANATION-START id=const:WHEEL_ZOOM_FACTOR

**What this does.** The zoom step per wheel tick, 1.15, meaning fifteen percent in or out per detent.

**Why it is here.** It matches Leaflet's default so the user's already-trained map muscle memory transfers.

.. CG-EXPLANATION-END id=const:WHEEL_ZOOM_FACTOR

``const COLUMN_EDGE_GAP_PX``
----------------------------

.. CG-BLOCK id=const:COLUMN_EDGE_GAP_PX lines=97-104

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/utils.ts
   :language: typescript
   :lines: 97-104
   :lineno-match:

.. CG-EXPLANATION-START id=const:COLUMN_EDGE_GAP_PX

**What this does.** The clear gap, four pixels, between two adjacent columns.

**Why it is here.** Four pixels of clear air keeps the tie-back diagonals readable even on tight profiles.

.. CG-EXPLANATION-END id=const:COLUMN_EDGE_GAP_PX

``const FLASH_HIGHLIGHT_MS``
----------------------------

.. CG-BLOCK id=const:FLASH_HIGHLIGHT_MS lines=105-114

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/utils.ts
   :language: typescript
   :lines: 105-114
   :lineno-match:

.. CG-EXPLANATION-START id=const:FLASH_HIGHLIGHT_MS

**What this does.** How long a the-camera-landed-here pulse stays up, two seconds.

**Why it is here.** It is shared by the Ctrl+F column find and the pending-tie chip's reveal, which are the same gesture on two different objects; two seconds is long enough to find on a busy section and short enough that it never reads as a persistent selection.

.. CG-EXPLANATION-END id=const:FLASH_HIGHLIGHT_MS

``const CORRELATED_PAIR_EDGE_GAP_PX``
-------------------------------------

.. CG-BLOCK id=const:CORRELATED_PAIR_EDGE_GAP_PX lines=115-119

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/utils.ts
   :language: typescript
   :lines: 115-119
   :lineno-match:

.. CG-EXPLANATION-START id=const:CORRELATED_PAIR_EDGE_GAP_PX

**What this does.** The wider gap, twenty-four pixels, between two columns that carry a correlation edge.

**Why it is here.** Dogfeed 2026-05-31: the gradient ribbon spans the full gap, and at the four-pixel floor it collapses to an invisible hairline; twenty-four pixels lets both stripes read at the most-packed spacing. It is applied edge-aware, so unrelated columns stay tightly packed and only correlation partners get the extra air.

.. CG-EXPLANATION-END id=const:CORRELATED_PAIR_EDGE_GAP_PX

``const BARE_COLUMN_WIDTH_PX``
------------------------------

.. CG-BLOCK id=const:BARE_COLUMN_WIDTH_PX lines=120-128

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/utils.ts
   :language: typescript
   :lines: 120-128
   :lineno-match:

.. CG-EXPLANATION-START id=const:BARE_COLUMN_WIDTH_PX

**What this does.** The bare column width, fourteen pixels, with no data tracks.

**Why it is here.** It is the floor for both kinds of column; the data tracks grow the width additively as the header toggles flip on.

.. CG-EXPLANATION-END id=const:BARE_COLUMN_WIDTH_PX

``interface Viewport``
----------------------

.. CG-BLOCK id=interface:Viewport lines=129-146

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/utils.ts
   :language: typescript
   :lines: 129-146
   :lineno-match:

.. CG-EXPLANATION-START id=interface:Viewport

**What this does.** The world viewport in section-local coordinates: the along-distance minimum and maximum, and the vertical level minimum and maximum in the project's datum.

**Why it is here.** It is the coordinate window that pan and zoom move around.

.. CG-EXPLANATION-END id=interface:Viewport

``interface CptPlacedColumnInput``
----------------------------------

.. CG-BLOCK id=interface:CptPlacedColumnInput lines=147-152

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/utils.ts
   :language: typescript
   :lines: 147-152
   :lineno-match:

.. CG-EXPLANATION-START id=interface:CptPlacedColumnInput

**What this does.** The input shape for a CPT column going into the collision pass: its projection, its true screen X, and its width.

**Why it is here.** It is split from the borehole input so every consumer can narrow the projected item automatically by the kind discriminant, with no casts (debt #28).

.. CG-EXPLANATION-END id=interface:CptPlacedColumnInput

``interface BoreholePlacedColumnInput``
---------------------------------------

.. CG-BLOCK id=interface:BoreholePlacedColumnInput lines=153-158

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/utils.ts
   :language: typescript
   :lines: 153-158
   :lineno-match:

.. CG-EXPLANATION-START id=interface:BoreholePlacedColumnInput

**What this does.** The same input shape for a borehole column.

**Why it is here.** Same shape as the CPT input above, for the borehole branch.

.. CG-EXPLANATION-END id=interface:BoreholePlacedColumnInput

``type PlacedColumnInput``
--------------------------

.. CG-BLOCK id=type:PlacedColumnInput lines=159-167

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/utils.ts
   :language: typescript
   :lines: 159-167
   :lineno-match:

.. CG-EXPLANATION-START id=type:PlacedColumnInput

**What this does.** Either of the two input shapes.

**Why it is here.** It is the union the collision pass accepts.

.. CG-EXPLANATION-END id=type:PlacedColumnInput

``interface PlacedColumnBase``
------------------------------

.. CG-BLOCK id=interface:PlacedColumnBase lines=168-181

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/utils.ts
   :language: typescript
   :lines: 168-181
   :lineno-match:

.. CG-EXPLANATION-START id=interface:PlacedColumnBase

**What this does.** The fields every placed column carries out of the collision pass: its true X, its nudged X, its glyph width, and a displaced flag.

**Why it is here.** The displaced flag drives whether the tie-back diagonal is drawn from the nudged position back to the true one.

.. CG-EXPLANATION-END id=interface:PlacedColumnBase

``interface CptPlacedColumn``
-----------------------------

.. CG-BLOCK id=interface:CptPlacedColumn lines=182-185

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/utils.ts
   :language: typescript
   :lines: 182-185
   :lineno-match:

.. CG-EXPLANATION-START id=interface:CptPlacedColumn

**What this does.** A placed CPT column: the base fields plus its CPT projection.

**Why it is here.** It is kind-tagged so consumers narrow the item without casts.

.. CG-EXPLANATION-END id=interface:CptPlacedColumn

``interface BoreholePlacedColumn``
----------------------------------

.. CG-BLOCK id=interface:BoreholePlacedColumn lines=186-189

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/utils.ts
   :language: typescript
   :lines: 186-189
   :lineno-match:

.. CG-EXPLANATION-START id=interface:BoreholePlacedColumn

**What this does.** A placed borehole column: the base fields plus its borehole projection.

**Why it is here.** Same as the CPT placed column above, for boreholes.

.. CG-EXPLANATION-END id=interface:BoreholePlacedColumn

``type PlacedColumn``
---------------------

.. CG-BLOCK id=type:PlacedColumn lines=190-215

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/utils.ts
   :language: typescript
   :lines: 190-215
   :lineno-match:

.. CG-EXPLANATION-START id=type:PlacedColumn

**What this does.** Either placed-column kind. The comment after it describes the paint-through helper.

**Why it is here.** It is the union the renderer consumes.

.. CG-EXPLANATION-END id=type:PlacedColumn

``function columnsBetween``
---------------------------

.. CG-BLOCK id=function:columnsBetween lines=216-242

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/utils.ts
   :language: typescript
   :lines: 216-242
   :lineno-match:

.. CG-EXPLANATION-START id=function:columnsBetween

**What this does.** Returns every placed column whose X lies strictly between a source X and a target X, plus the column at the target itself, with the source excluded, sorted in source-to-target order.

**Why it is here.** It powers the shift-drag paint-through gesture, which stamps the source's contact onto every intervening test and the target. The source is excluded because it already carries the contact, and a half-pixel epsilon stops float drift on the source's cached X from accidentally re-including it.

.. CG-EXPLANATION-END id=function:columnsBetween

``function _interpolatePolylineY``
----------------------------------

.. CG-BLOCK id=function:_interpolatePolylineY lines=243-290

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/utils.ts
   :language: typescript
   :lines: 243-290
   :lineno-match:

.. CG-EXPLANATION-START id=function:_interpolatePolylineY

**What this does.** Linearly interpolates a polyline's Y at a horizontal X, returning nothing when X is outside the polyline's range.

**Why it is here.** Returning nothing lets callers tell the polyline is not defined here (a pinched-out formation) apart from the polyline is defined and Y is the value below.

.. CG-EXPLANATION-END id=function:_interpolatePolylineY

``function buildFillBand``
--------------------------

.. CG-BLOCK id=function:buildFillBand lines=291-338

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/utils.ts
   :language: typescript
   :lines: 291-338
   :lineno-match:

.. CG-EXPLANATION-START id=function:buildFillBand

**What this does.** Builds a closed fill polygon for one geological band: the top comes from the formation's own slice polyline, and the bottom at each X comes from the first older formation defined there, dropping to a floor where none is.

**Why it is here.** The multi-older fallback matters because a formation can pinch out laterally; when the immediate older disappears in the middle of a section, the band must reach the next-existing older, or it would truncate at the missing one's edge and leave a visual gap where the formation geologically continues.

.. CG-EXPLANATION-END id=function:buildFillBand

``interface SectionDepthAxis``
------------------------------

.. CG-BLOCK id=interface:SectionDepthAxis lines=339-362

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/utils.ts
   :language: typescript
   :lines: 339-362
   :lineno-match:

.. CG-EXPLANATION-START id=interface:SectionDepthAxis

**What this does.** One column's depth-to-screen-Y conversions: the surface Y, the downward pixels per metre, and both directions of the conversion.

**Why it is here.** It centralises the depth-axis math (#168) that two sibling components each hand-rolled identically.

.. CG-EXPLANATION-END id=interface:SectionDepthAxis

``function depthAxisAtSurface``
-------------------------------

.. CG-BLOCK id=function:depthAxisAtSurface lines=363-380

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/utils.ts
   :language: typescript
   :lines: 363-380
   :lineno-match:

.. CG-EXPLANATION-START id=function:depthAxisAtSurface

**What this does.** Builds that depth axis for one column from the section's level-to-screen transform and the column's surface elevation, sampling the metres-to-pixels rate at the surface.

**Why it is here.** It reproduces the exact math the two sites it replaces used, so the result is byte-identical and nothing shifts visually.

.. CG-EXPLANATION-END id=function:depthAxisAtSurface

``function niceStep``
---------------------

.. CG-BLOCK id=function:niceStep lines=381-394

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/utils.ts
   :language: typescript
   :lines: 381-394
   :lineno-match:

.. CG-EXPLANATION-START id=function:niceStep

**What this does.** Picks a nice tick spacing: the largest of one, two or five times a power of ten that fits about five to ten ticks across the range.

**Why it is here.** It is the standard chart-library heuristic and reads cleanly for engineers used to surveyed dimensions.

.. CG-EXPLANATION-END id=function:niceStep

``function ticks``
------------------

.. CG-BLOCK id=function:ticks lines=395-421

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/utils.ts
   :language: typescript
   :lines: 395-421
   :lineno-match:

.. CG-EXPLANATION-START id=function:ticks

**What this does.** Generates the tick positions for a range at the nice step, capping the loop at two hundred iterations.

**Why it is here.** The loop cap stops a bad viewport, for example an inverted one, from burning the CPU, because tick generation runs in a render hot path.

.. CG-EXPLANATION-END id=function:ticks

``function columnMaxDepthM``
----------------------------

.. CG-BLOCK id=function:columnMaxDepthM lines=422-435

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/utils.ts
   :language: typescript
   :lines: 422-435
   :lineno-match:

.. CG-EXPLANATION-START id=function:columnMaxDepthM

**What this does.** Returns a placed column's maximum measurement depth, which is the CPT's max depth or the borehole's total depth, or nothing when it is absent.

**Why it is here.** The two kinds record their depth under different field names, and nothing means the column has no depth data yet.

.. CG-EXPLANATION-END id=function:columnMaxDepthM

``function useElementSize``
---------------------------

.. CG-BLOCK id=function:useElementSize lines=436-455

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/utils.ts
   :language: typescript
   :lines: 436-455
   :lineno-match:

.. CG-EXPLANATION-START id=function:useElementSize

**What this does.** A hook that observes a DOM element's size and returns its width and height, updating as the container resizes.

**Why it is here.** It drives the section's SVG view box, and returns nothing on the first render before the resize observer has fired.

.. CG-EXPLANATION-END id=function:useElementSize

