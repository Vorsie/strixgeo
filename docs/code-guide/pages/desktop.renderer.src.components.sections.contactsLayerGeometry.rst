desktop.renderer.src.components.sections.contactsLayerGeometry
==============================================================

.. CG-PAGE source=desktop/src/renderer/src/components/sections/contactsLayerGeometry.ts complete=true

*Source file:* ``desktop/src/renderer/src/components/sections/contactsLayerGeometry.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-42

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/contactsLayerGeometry.ts
   :language: typescript
   :lines: 1-42
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Names the file and brings in the tools it borrows. This is one code file, called a module, and every export in it is a pure function or a plain data shape. A pure function is one that only reads its inputs and returns an answer, touching no screen, no network and nothing stored elsewhere, so the same inputs always give the same result. The docstring at the top lists the data shapes and helper functions the file makes available to other files, and the imports pull in the formation and contact data types from the API client, the lithology and NAD-class label lookups, the section-line type, and the ``PlacedColumn`` shape plus two small geometry helpers.

**Why it is here.** This module is a deliberate zero-React extraction from the big ``ContactsLayer`` component. React is the library that actually paints the screen, so keeping this file React-free means it does no drawing at all; it only prepares the data and numbers the drawing needs. The docstring records the reason: pulled out this way, every helper can be tested on its own, and the parent component file stays focused on the stateful drag behaviour instead of geometry arithmetic.

.. CG-EXPLANATION-END id=module-header

``const APPROX_GLYPH_WIDTH_PX``
-------------------------------

.. CG-BLOCK id=const:APPROX_GLYPH_WIDTH_PX lines=43-48

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/contactsLayerGeometry.ts
   :language: typescript
   :lines: 43-48
   :lineno-match:

.. CG-EXPLANATION-START id=const:APPROX_GLYPH_WIDTH_PX

**What this does.** A single fixed number, 5 — the average width in screen pixels of one text character at the small font size the band labels use.

**Why it is here.** The label-shortening helper below needs a way to guess how many characters fit inside a given pixel width; naming that estimate once, with a comment saying it is the average glyph width at font size 9, keeps the guess in one place.

.. CG-EXPLANATION-END id=const:APPROX_GLYPH_WIDTH_PX

``const COLUMN_ATTRACTION_PX``
------------------------------

.. CG-BLOCK id=const:COLUMN_ATTRACTION_PX lines=49-67

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/contactsLayerGeometry.ts
   :language: typescript
   :lines: 49-67
   :lineno-match:

.. CG-EXPLANATION-START id=const:COLUMN_ATTRACTION_PX

**What this does.** A fixed number, 15 pixels — the extra reach, beyond a column's own visible width, within which a drag still counts as pointing at that column.

**Why it is here.** The comment records the trade-off: this hysteresis band is tight enough that crossing to a neighbouring column reads as intentional, yet loose enough that a pixel or two of hand jitter at a band edge does not flicker the drag onto the wrong column.

.. CG-EXPLANATION-END id=const:COLUMN_ATTRACTION_PX

``interface LayerSlabData``
---------------------------

.. CG-BLOCK id=interface:LayerSlabData lines=68-87

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/contactsLayerGeometry.ts
   :language: typescript
   :lines: 68-87
   :lineno-match:

.. CG-EXPLANATION-START id=interface:LayerSlabData

**What this does.** Describes the shape of one data-only slab. An interface in TypeScript is just a named description of a piece of data — which fields it carries and what type each field is, with no behaviour attached. A slab here is a per-column block for one soil layer, and this shape holds everything needed to draw that block EXCEPT the up-and-down screen positions: the contact id, the anchoring investigation id and kind, the formation id, name and colour, the top and bottom depth in metres, the surface elevation, and the horizontal extent plus label position.

**Why it is here.** The vertical screen positions are deliberately left out so this data can stay cached (kept from a previous calculation) while the user pans or zooms up and down — only the vertical transform changes then, not this data (debt #29). A ``bottomDepthM`` of null means the deepest contact has no recorded bottom, which the projection step later draws as extending to the plot floor.

.. CG-EXPLANATION-END id=interface:LayerSlabData

``interface PolylineVertexData``
--------------------------------

.. CG-BLOCK id=interface:PolylineVertexData lines=88-97

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/contactsLayerGeometry.ts
   :language: typescript
   :lines: 88-97
   :lineno-match:

.. CG-EXPLANATION-START id=interface:PolylineVertexData

**What this does.** Describes one point (a vertex) of a cross-column formation line, in data-only form — the contact and formation ids, the top depth, the surface elevation, the screen X, and a sort key — before the screen Y is worked out.

**Why it is here.** Same split as the slab above: the screen Y depends on the vertical transform and is added later in the projection step, so this data half stays cacheable across vertical pan and zoom.

.. CG-EXPLANATION-END id=interface:PolylineVertexData

``interface PolylineDataLine``
------------------------------

.. CG-BLOCK id=interface:PolylineDataLine lines=98-111

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/contactsLayerGeometry.ts
   :language: typescript
   :lines: 98-111
   :lineno-match:

.. CG-EXPLANATION-START id=interface:PolylineDataLine

**What this does.** Describes one formation's cross-column line — its formation id, colour, name, and its list of vertices.

**Why it is here.** One of these is built per formation so the render step can draw each formation's contact line as a single stroke; the vertices are sorted left-to-right and in stratigraphic order when the line is finished.

.. CG-EXPLANATION-END id=interface:PolylineDataLine

``interface RenderedLayer``
---------------------------

.. CG-BLOCK id=interface:RenderedLayer lines=112-139

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/contactsLayerGeometry.ts
   :language: typescript
   :lines: 112-139
   :lineno-match:

.. CG-EXPLANATION-START id=interface:RenderedLayer

**What this does.** Describes the projected, screen-space slab — the same facts as the data slab plus the actual screen positions (segment Y, body top and bottom Y), the per-column pixels-per-metre rate, the surface Y, and the original un-dragged depth.

**Why it is here.** The docstring records why the anchor metadata is copied onto the layer: the drag handler reads the pixels-per-metre rate and surface Y straight off the layer to compute a live depth, instead of re-walking every placed column on each mouse move. The original depth is kept so a release at the same depth can quietly do nothing.

.. CG-EXPLANATION-END id=interface:RenderedLayer

``interface PolylineVertex``
----------------------------

.. CG-BLOCK id=interface:PolylineVertex lines=140-167

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/contactsLayerGeometry.ts
   :language: typescript
   :lines: 140-167
   :lineno-match:

.. CG-EXPLANATION-START id=interface:PolylineVertex

**What this does.** Describes a projected polyline vertex — a contact id, the screen X, the screen Y, and a sort key.

**Why it is here.** Same shape as the data-only vertex above, with the screen Y now added for the render step.

.. CG-EXPLANATION-END id=interface:PolylineVertex

``function clamp``
------------------

.. CG-BLOCK id=function:clamp lines=168-189

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/contactsLayerGeometry.ts
   :language: typescript
   :lines: 168-189
   :lineno-match:

.. CG-EXPLANATION-START id=function:clamp

**What this does.** A tiny function — a named recipe that takes inputs and returns a result — that forces a number to stay between a lower and an upper bound.

**Why it is here.** A one-line utility reused wherever a value must be kept inside a range rather than allowed to run past it.

.. CG-EXPLANATION-END id=function:clamp

``function truncateToWidth``
----------------------------

.. CG-BLOCK id=function:truncateToWidth lines=190-219

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/contactsLayerGeometry.ts
   :language: typescript
   :lines: 190-219
   :lineno-match:

.. CG-EXPLANATION-START id=function:truncateToWidth

**What this does.** Shortens a text label so it fits inside a given pixel width, adding an ellipsis when it has to cut it. It estimates how many characters fit using the average glyph width, reserving a little padding on each side.

**Why it is here.** Band labels must not spill past the band they sit in, so a long formation name is trimmed to the band width rather than overflowing onto the drawing.

.. CG-EXPLANATION-END id=function:truncateToWidth

``function columnUnderCursor``
------------------------------

.. CG-BLOCK id=function:columnUnderCursor lines=220-258

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/contactsLayerGeometry.ts
   :language: typescript
   :lines: 220-258
   :lineno-match:

.. CG-EXPLANATION-START id=function:columnUnderCursor

**What this does.** Finds the column whose centre is nearest the cursor, but returns it only when the cursor is within that column's half-width plus the attraction band; it returns null when the cursor is in the dead space between columns.

**Why it is here.** Used both by the cross-column drag (to know which column is being targeted right now) and by the box-select hit-test. The attraction band is the hysteresis that keeps the target from flickering when the cursor hovers near a band edge.

.. CG-EXPLANATION-END id=function:columnUnderCursor

``function surfaceYForColumn``
------------------------------

.. CG-BLOCK id=function:surfaceYForColumn lines=259-298

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/contactsLayerGeometry.ts
   :language: typescript
   :lines: 259-298
   :lineno-match:

.. CG-EXPLANATION-START id=function:surfaceYForColumn

**What this does.** Works out a column's surface screen Y, its pixels-per-metre rate, and its surface elevation, by wrapping the shared ``depthAxisAtSurface`` helper and adding a guard for a column with no known elevation.

**Why it is here.** It keeps the depth-to-pixel rate coming from one single source. The null-elevation guard matters because 0 metres TAW (the Belgian height datum) is a real elevation, never a stand-in for missing — so an unknown elevation is treated as genuinely absent, not as zero.

.. CG-EXPLANATION-END id=function:surfaceYForColumn

``function subtractGhosts``
---------------------------

.. CG-BLOCK id=function:subtractGhosts lines=299-387

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/contactsLayerGeometry.ts
   :language: typescript
   :lines: 299-387
   :lineno-match:

.. CG-EXPLANATION-START id=function:subtractGhosts

**What this does.** Cuts one or more pending-ghost depth ranges out of a band's top-to-base interval and returns the surviving pieces, in top-to-base order (empty when the ghosts cover the whole band). It is plain interval subtraction in depth-metres.

**Why it is here.** Recorded in the docstring as a debt #151 dogfeed refinement from 2026-05-27: when a ghost suggestion is being inserted into an accepted band, the band is split around it so the ghost shows on top rather than being hidden underneath.

.. CG-EXPLANATION-END id=function:subtractGhosts

``function formationDisplayLabel``
----------------------------------

.. CG-BLOCK id=function:formationDisplayLabel lines=388-418

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/contactsLayerGeometry.ts
   :language: typescript
   :lines: 388-418
   :lineno-match:

.. CG-EXPLANATION-START id=function:formationDisplayLabel

**What this does.** Chooses the label a formation band shows, by a fixed order of preference: a NAD-classed geotech formation shows its NAD packing name; otherwise a litho unit shows its translated lithology name; otherwise the curated name (or the raw regional reference as a last resort).

**Why it is here.** The docstring records why the NAD branch must come first: a geotech formation inherits its soil code from the litho unit it subdivides, so without that first branch the litho rule would label it by lithology alone and the packing class would never reach the band. The litho branch translates the raw token because the auto-generated code must not leak onto the band (debt #96), following the project rule to translate at the presentation boundary.

.. CG-EXPLANATION-END id=function:formationDisplayLabel

``function geotechDisplayFormation``
------------------------------------

.. CG-BLOCK id=function:geotechDisplayFormation lines=419-451

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/contactsLayerGeometry.ts
   :language: typescript
   :lines: 419-451
   :lineno-match:

.. CG-EXPLANATION-START id=function:geotechDisplayFormation

**What this does.** The geotech-axis display override: on the geotechnical axis a classified formation shows its NAD packing-class name and its geotech colour; on every other axis the stored name and colour pass through unchanged.

**Why it is here.** It is the single source of the NAD name-and-colour rule shared by the band labels and the per-column band maps. The comment records owner ruling 2026-08-26 that the colour comes from ``geotechUnitColor`` so a colour the engineer picked on the units pane wins here too — otherwise the section would disagree with the pane he picked it on.

.. CG-EXPLANATION-END id=function:geotechDisplayFormation

``function contactAnchorId``
----------------------------

.. CG-BLOCK id=function:contactAnchorId lines=452-476

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/contactsLayerGeometry.ts
   :language: typescript
   :lines: 452-476
   :lineno-match:

.. CG-EXPLANATION-START id=function:contactAnchorId

**What this does.** Returns a contact's anchoring investigation id — either its borehole id or its CPT id.

**Why it is here.** The docstring records that exactly one of the two is set on every contact row by contract (an exclusive-or), so the read order does not matter; a malformed anchorless row returns null.

.. CG-EXPLANATION-END id=function:contactAnchorId

``function groupContactsByAnchor``
----------------------------------

.. CG-BLOCK id=function:groupContactsByAnchor lines=477-493

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/contactsLayerGeometry.ts
   :language: typescript
   :lines: 477-493
   :lineno-match:

.. CG-EXPLANATION-START id=function:groupContactsByAnchor

**What this does.** Buckets contacts by their anchoring investigation id into a Map (a lookup table from a key to a value), with each bucket sorted shallowest-first by top depth. Anchorless contacts are skipped.

**Why it is here.** The docstring notes the shape of bucketing by anchor and sorting by depth recurs across the section overlays; this is the single shared copy of it, following the project's extract-on-the-second-copy rule.

.. CG-EXPLANATION-END id=function:groupContactsByAnchor

``function computeSlabsAndPolylines``
-------------------------------------

.. CG-BLOCK id=function:computeSlabsAndPolylines lines=494-676

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/contactsLayerGeometry.ts
   :language: typescript
   :lines: 494-676
   :lineno-match:

.. CG-EXPLANATION-START id=function:computeSlabsAndPolylines

**What this does.** The Stage-A classification pass. It walks each placed column's contacts and produces two things: one slab per column-and-contact pair carrying the horizontal extent and label, and a per-formation accumulator of polyline vertices. It first indexes all contacts by anchor id for speed, then loops the columns to build slabs and gather vertices in the same pass, then folds in synthetic lens-tip contacts (contacts with no borehole or CPT anchor whose world position is projected onto the section line), and finally sorts the polylines by stratigraphic display order so older formations paint first and younger ones on top.

**Why it is here.** The docstring states it deliberately takes no vertical-axis inputs so callers can keep its result cached across vertical pan and zoom. The pre-indexing by anchor drops the inner work on a large project from about a hundred thousand iterations per pan to a few hundred. The comment on the display label records the 2026-05-18 revision to prefer the resolved name over the raw formal code, so the same section never mixes a code and a full name. The synthetic tips are the #101 lens-tip feature.

.. CG-EXPLANATION-END id=function:computeSlabsAndPolylines

