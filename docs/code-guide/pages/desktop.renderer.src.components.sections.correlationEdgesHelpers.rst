desktop.renderer.src.components.sections.correlationEdgesHelpers
================================================================

.. CG-PAGE source=desktop/src/renderer/src/components/sections/correlationEdgesHelpers.ts complete=true

*Source file:* ``desktop/src/renderer/src/components/sections/correlationEdgesHelpers.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-17

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/correlationEdgesHelpers.ts
   :language: typescript
   :lines: 1-17
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Names the file and imports its inputs. It holds the pure band and screen-map helpers for the ``CorrelationEdgesOverlay`` — the overlay that draws correlation ties as ribbons — pulled out verbatim from that component. It imports the contact and formation data types, the shared anchor helpers, and the ``PlacedColumn`` shape.

**Why it is here.** The docstring records this as a debt #201 extraction: the helpers are lifted out with no React so the overlay component file stays smaller and under the god-component watch.

.. CG-EXPLANATION-END id=module-header

``const CONTACT_EDGE_COLOR``
----------------------------

.. CG-BLOCK id=const:CONTACT_EDGE_COLOR lines=18-21

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/correlationEdgesHelpers.ts
   :language: typescript
   :lines: 18-21
   :lineno-match:

.. CG-EXPLANATION-START id=const:CONTACT_EDGE_COLOR

**What this does.** A fixed colour, emerald-500, used to stroke contact-level correlation edges.

**Why it is here.** The comment notes the same colour is reused as the body-chip halo ring (a #133 Phase 1 choice), so the two read as one colour language.

.. CG-EXPLANATION-END id=const:CONTACT_EDGE_COLOR

``const CONTACT_SELECT_NEAR_PX``
--------------------------------

.. CG-BLOCK id=const:CONTACT_SELECT_NEAR_PX lines=22-28

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/correlationEdgesHelpers.ts
   :language: typescript
   :lines: 22-28
   :lineno-match:

.. CG-EXPLANATION-START id=const:CONTACT_SELECT_NEAR_PX

**What this does.** A fixed number of pixels within a boundary line that arm it for selection on a tall band.

**Why it is here.** The comment records the 2026-05-29 dogfeed reason: the middle of a tall band is deliberately inert, so only the near-boundary zones respond.

.. CG-EXPLANATION-END id=const:CONTACT_SELECT_NEAR_PX

``const BASE_LINE_GRAB_PX``
---------------------------

.. CG-BLOCK id=const:BASE_LINE_GRAB_PX lines=29-60

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/correlationEdgesHelpers.ts
   :language: typescript
   :lines: 29-60
   :lineno-match:

.. CG-EXPLANATION-START id=const:BASE_LINE_GRAB_PX

**What this does.** A small fixed number of pixels above a thin band's base line that arm the boundary below it.

**Why it is here.** The comment records why it is small: an interior strike a few pixels low must still mean the band's own top (the 2026-08-05 one-band-low mis-click), while a deliberate click on the base line arms the base — the owner's 2026-08-07 report that a correlation drew from the top when he clicked the bottom of a clay unit.

.. CG-EXPLANATION-END id=const:BASE_LINE_GRAB_PX

``function correlateBandZones``
-------------------------------

.. CG-BLOCK id=function:correlateBandZones lines=61-81

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/correlationEdgesHelpers.ts
   :language: typescript
   :lines: 61-81
   :lineno-match:

.. CG-EXPLANATION-START id=function:correlateBandZones

**What this does.** Splits a correlate-mode band into a top-arming zone, an inert middle, and a base-arming zone, following the rule that the boundary line always wins. It handles three cases: a tall band (near-boundary zones with an inert middle), a thin band with a deeper neighbour (the interior arms the top, a small strip at the base arms the boundary below), and a thin deepest band (a generous midpoint split).

**Why it is here.** The docstring cites the 2026-05-29 dogfeed for the tall-band zones, the 2026-08-05 protection for the thin-band interior arming the top, and the owner's 2026-08-07 request for the base strip; the deepest-band case is generous because its base tie has no twin target below it.

.. CG-EXPLANATION-END id=function:correlateBandZones

``const anchorId``
------------------

.. CG-BLOCK id=const:anchorId lines=82-88

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/correlationEdgesHelpers.ts
   :language: typescript
   :lines: 82-88
   :lineno-match:

.. CG-EXPLANATION-START id=const:anchorId

**What this does.** Re-exports the shared ``contactAnchorId`` helper under a local name.

**Why it is here.** The comment notes it is the same shape used elsewhere — the anchor pair (borehole or CPT) is an exclusive-or.

.. CG-EXPLANATION-END id=const:anchorId

``interface BandEntry``
-----------------------

.. CG-BLOCK id=interface:BandEntry lines=89-98

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/correlationEdgesHelpers.ts
   :language: typescript
   :lines: 89-98
   :lineno-match:

.. CG-EXPLANATION-START id=interface:BandEntry

**What this does.** Describes one band on an investigation — its top and bottom in absolute metres TAW, and the formation it represents.

**Why it is here.** The comment records that entries are keyed by contact id, not formation id, so two contacts pointing at the same formation at different depths each get a distinct entry; the old formation-id key collapsed them, drawing the shallower band's hit-rectangle at the deeper band's depth (manual-correlate dogfeed 2026-05-31).

.. CG-EXPLANATION-END id=interface:BandEntry

``type BandMap``
----------------

.. CG-BLOCK id=type:BandMap lines=99-133

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/correlationEdgesHelpers.ts
   :language: typescript
   :lines: 99-133
   :lineno-match:

.. CG-EXPLANATION-START id=type:BandMap

**What this does.** The two-level lookup shape: an outer Map keyed by investigation id, whose values are inner Maps keyed by contact id.

**Why it is here.** Keyed by contact id at the inner level for the same reason as ``BandEntry`` — so a repeated formation on one column gets its own entry rather than being collapsed onto another band's depth.

.. CG-EXPLANATION-END id=type:BandMap

``function buildBandMap``
-------------------------

.. CG-BLOCK id=function:buildBandMap lines=134-191

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/correlationEdgesHelpers.ts
   :language: typescript
   :lines: 134-191
   :lineno-match:

.. CG-EXPLANATION-START id=function:buildBandMap

**What this does.** Builds the band map from a section's contacts and columns. For each contact it sets the band top from its own depth and the band bottom from the next-shallower contact's top, and for the deepest band it closes at the investigation's own maximum depth, falling back to the plot floor only when that depth field is absent.

**Why it is here.** The docstring records this prevents the deepest band from extending past the actual data column down to the section-view floor (debt #120), and repeats the keyed-by-contact-id reason so repeated formations render at their own depths.

.. CG-EXPLANATION-END id=function:buildBandMap

``function bandRect``
---------------------

.. CG-BLOCK id=function:bandRect lines=192-236

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/correlationEdgesHelpers.ts
   :language: typescript
   :lines: 192-236
   :lineno-match:

.. CG-EXPLANATION-START id=function:bandRect

**What this does.** Returns the screen rectangle (top Y and bottom Y) for a contact's own band, clamped to the plot area, or nothing when the rectangle would collapse.

**Why it is here.** It is looked up by contact id so two contacts on one investigation that reference the same formation get distinct rectangles rather than one shared position.

.. CG-EXPLANATION-END id=function:bandRect

``function buildContactScreenMap``
----------------------------------

.. CG-BLOCK id=function:buildContactScreenMap lines=237-304

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/correlationEdgesHelpers.ts
   :language: typescript
   :lines: 237-304
   :lineno-match:

.. CG-EXPLANATION-START id=function:buildContactScreenMap

**What this does.** Builds a map from each contact to its screen X, its along-section distance in metres, its top and bottom screen Y, and its half-width, for the contacts whose column is on this section.

**Why it is here.** The comment records that it carries the along-section metres so a tie spanning intervening columns can bend at each one and meet the fill exactly. Under non-uniform column spacing a straight screen segment between two columns does not pass through the intervening columns where the fill does, and the fill then appears to cross the tie (dogfeed 2026-07-10) — this is the section-view spacing modifier trap that every section overlay must respect.

.. CG-EXPLANATION-END id=function:buildContactScreenMap

``function warpAwareEdgePoints``
--------------------------------

.. CG-BLOCK id=function:warpAwareEdgePoints lines=305-339

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/correlationEdgesHelpers.ts
   :language: typescript
   :lines: 305-339
   :lineno-match:

.. CG-EXPLANATION-START id=function:warpAwareEdgePoints

**What this does.** Returns the points string for an SVG polyline of a correlation edge that may span intervening columns — a line that bends at each column and runs flat across that column's width. SVG (Scalable Vector Graphics) is the drawing language the section is painted in, and a polyline is a connected run of straight segments.

**Why it is here.** The docstring records the reason: a correlation surface is straight in along-distance-and-elevation space, but the columns it spans are not placed proportionally to along-distance because of the spacing nudge and scroll, so a single straight screen segment misses the intervening columns where the per-gap fill sits and the fill appears to cross the edge (dogfeed 2026-07-10). Bending at each column matches the fill exactly.

.. CG-EXPLANATION-END id=function:warpAwareEdgePoints

``function warpAwareEdgeVertices``
----------------------------------

.. CG-BLOCK id=function:warpAwareEdgeVertices lines=340-390

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/correlationEdgesHelpers.ts
   :language: typescript
   :lines: 340-390
   :lineno-match:

.. CG-EXPLANATION-START id=function:warpAwareEdgeVertices

**What this does.** The same polyline as the helper above, but returned as an array of vertices from A to B, two per intervening column so the line is flat across each column's width.

**Why it is here.** The docstring records that a closed outline — the pending proposal's dashed shape — needs its top and bottom boundaries as arrays so it can walk one forward and the other back; and it must bend at the columns a jump tie crosses exactly as the accepted seam does, because an outline and a seam are the same claim about the same surface and drawing them differently would suggest the tie moves when accepted.

.. CG-EXPLANATION-END id=function:warpAwareEdgeVertices

``function warpAwareRibbonOutline``
-----------------------------------

.. CG-BLOCK id=function:warpAwareRibbonOutline lines=391-432

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/correlationEdgesHelpers.ts
   :language: typescript
   :lines: 391-432
   :lineno-match:

.. CG-EXPLANATION-START id=function:warpAwareRibbonOutline

**What this does.** Returns a closed, warp-aware points string for a ribbon-shaped edge overlay: it walks the top boundary from A to B, then the bottom boundary from B back to A, both bent at every intervening column.

**Why it is here.** The docstring records that one shape is used by both the pending proposal's dashed outline and the right-click hit polygon, so the clickable target can never drift off the drawing.

.. CG-EXPLANATION-END id=function:warpAwareRibbonOutline

``function contactStripeColors``
--------------------------------

.. CG-BLOCK id=function:contactStripeColors lines=433-451

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/correlationEdgesHelpers.ts
   :language: typescript
   :lines: 433-451
   :lineno-match:

.. CG-EXPLANATION-START id=function:contactStripeColors

**What this does.** Resolves, for each contact, the lithology colour above it and the colour below it, for the gradient correlation ribbon.

**Why it is here.** The docstring records that a contact marks the top of its formation, so the colour below is its own formation's colour and the colour above is the next-shallower contact's colour on the same investigation, with null above when the contact is the topmost (#131-c).

.. CG-EXPLANATION-END id=function:contactStripeColors

