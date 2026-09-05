desktop.renderer.src.components.MapView
=======================================

.. CG-PAGE source=desktop/src/renderer/src/components/MapView.tsx complete=true

*Source file:* ``desktop/src/renderer/src/components/MapView.tsx``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-64

.. literalinclude:: ../../../desktop/src/renderer/src/components/MapView.tsx
   :language: tsx
   :lines: 1-64
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The imports for the project map. It brings in five React building blocks (``useCallback``, ``useEffect``, ``useMemo``, ``useRef``, ``useState``); one shared pane z-order constant; three icons; the Leaflet map parts the app uses (the map container, a circle marker, a square marker, a drawing pane, a rectangle, the two tile layers, and ``useMap``) from the app's Leaflet wrapper ``../lib/streaflet``, plus Leaflet itself and its stylesheet; the marker-style and tooltip helpers; the data shapes from the API client; the WGS84 projection helpers; the marker builders and the EPSG resolver; the offline banner and its online-status hook; the pending-pin and DEM types; the basemap sources; the bbox and section-line drawers; the section and tie overlays; and the translation helper. Two comments explain why circle markers are used and how the curated colour table works.

**Why it is here.** This component is the project map: it draws every CPT and borehole as a marker on a Leaflet 'slippy' map, with a layer control, a legend, an optional terrain hillshade, and draw modes for importing by box and for placing cross-section lines. Map positions use a *projection* — turning the stored survey coordinates from the project's own *coordinate reference system* (CRS) into WGS84, the latitude/longitude system Leaflet draws in; an *EPSG* number names a specific CRS (EPSG:31370 is Belgian Lambert 72, EPSG:28992 is the Dutch system). The marker data are API-client types because the frontend always goes through the API (CLAUDE.md). Circle markers are used instead of Leaflet's default pins because at high density (200+ in a small box) pins overlap into an unreadable stack; the projection and marker-building logic is pulled into ``mapMarkers`` so the CRS rule can be tested without mounting a live map.

.. CG-EXPLANATION-END id=module-header

``const KNOWN_COLORS``
----------------------

.. CG-BLOCK id=const:KNOWN_COLORS lines=65-84

.. literalinclude:: ../../../desktop/src/renderer/src/components/MapView.tsx
   :language: tsx
   :lines: 65-84
   :lineno-match:

.. CG-EXPLANATION-START id=const:KNOWN_COLORS

**What this does.** A table mapping a small set of known category tokens — CPT types (CPTU, CPTE, CPTM) and common DOV drill methods (kernboring, spoelboring, …) — to fixed hex colours.

**Why it is here.** This is a curated *colour lookup* — a table that maps a known text token to a fixed colour so the same category always shows the same hue on the map and in the legend. The CPT-type colours are kept in step with the CptChart panel colours. The raw Dutch DOV tokens are the keys because the engine returns raw upstream tokens and the desktop owns their display (translate at the presentation boundary); anything not in this table falls through to a hash-derived colour (``hashColor`` below).

.. CG-EXPLANATION-END id=const:KNOWN_COLORS

``const UNKNOWN_COLOR``
-----------------------

.. CG-BLOCK id=const:UNKNOWN_COLOR lines=85-86

.. literalinclude:: ../../../desktop/src/renderer/src/components/MapView.tsx
   :language: tsx
   :lines: 85-86
   :lineno-match:

.. CG-EXPLANATION-START id=const:UNKNOWN_COLOR

**What this does.** A neutral grey used for a null or empty category value.

**Why it is here.** The fallback colour so a marker whose category is missing still gets a stable, muted dot rather than no colour.

.. CG-EXPLANATION-END id=const:UNKNOWN_COLOR

``interface Props``
-------------------

.. CG-BLOCK id=interface:Props lines=87-193

.. literalinclude:: ../../../desktop/src/renderer/src/components/MapView.tsx
   :language: tsx
   :lines: 87-193
   :lineno-match:

.. CG-EXPLANATION-START id=interface:Props

**What this does.** The inputs the map accepts: the CPT and borehole lists; the selected ids and their select handlers; the hidden-value sets, the borehole filter axis and their toggle handlers; the bbox draw mode and its handlers; the viewport-change and camera-change callbacks plus an initial camera; the DEM source, overlay state and change handler; the cross-section draw mode and its handlers; the drawn sections with select handler; the marquee-selection set and handler; the hovered test id; the project's EPSG; the pending DOV pins; and the tie-suggestion ghosts with their EPSG and accept/reject handlers.

**Why it is here.** The same *props* pattern introduced on the ``desktop.renderer.src.components.CptChart`` page — most inputs are optional so existing call sites keep working and new fields stay additive (docs/api.md). The comments record the load-bearing decisions: visibility is tracked as HIDDEN sets, not visible sets, so an empty set means 'show everything' and there is no first-render flash; the parent owns that state so the sidebar can read it too; ``projectEpsg`` makes project-owned rows project through the project's own CRS, so a Netherlands (EPSG:28992) project's markers land in the Netherlands instead of being read as Belgian Lambert 72 (EPSG:31370, the fallback), while DOV pending pins carry explicit Lambert-72 fields and stay 31370; and the reported viewport bounds are in WGS84, Leaflet's own system.

.. CG-EXPLANATION-END id=interface:Props

``type OpenCategory``
---------------------

.. CG-BLOCK id=type:OpenCategory lines=194-201

.. literalinclude:: ../../../desktop/src/renderer/src/components/MapView.tsx
   :language: tsx
   :lines: 194-201
   :lineno-match:

.. CG-EXPLANATION-START id=type:OpenCategory

**What this does.** Names a small type for which layer-control section is currently expanded: ``'cpt'``, ``'borehole'``, ``'terrain'``, ``'basemap'`` or ``null``.

**Why it is here.** A *union* lists the allowed values. It records that the layer control opens one section at a time (Option B, mutually exclusive), with ``null`` meaning all closed.

.. CG-EXPLANATION-END id=type:OpenCategory

``function ViewportTracker``
----------------------------

.. CG-BLOCK id=function:ViewportTracker lines=202-230

.. literalinclude:: ../../../desktop/src/renderer/src/components/MapView.tsx
   :language: tsx
   :lines: 202-230
   :lineno-match:

.. CG-EXPLANATION-START id=function:ViewportTracker

**What this does.** An invisible helper component mounted inside the map. On mount, and after every ``moveend`` (the end of a pan or zoom), it reports the map's current visible bounds and camera — centre and zoom — back to the parent.

**Why it is here.** It lives inside ``MapContainer`` so ``useMap()`` resolves to the real Leaflet instance (comment). Its reports drive the sidebar's filter-to-viewport feature and let the App remember the last camera. Leaflet fires ``moveend`` only after the user releases the mouse, so the cost is tied to real motion and no debounce is needed. It returns ``null`` because it draws nothing — it only wires an event.

.. CG-EXPLANATION-END id=function:ViewportTracker

``function FitOnLoad``
----------------------

.. CG-BLOCK id=function:FitOnLoad lines=231-294

.. literalinclude:: ../../../desktop/src/renderer/src/components/MapView.tsx
   :language: tsx
   :lines: 231-294
   :lineno-match:

.. CG-EXPLANATION-START id=function:FitOnLoad

**What this does.** Another invisible child. Once, on first mount when no camera was saved and there are markers, it frames the map to fit all the markers. It re-arms when the project switches, defers to an animation frame, and retries for up to 30 frames until the map container actually has a size, then fits with padding and a zoom cap of 17.

**Why it is here.** The map fresh-mounts on every visit, so this can run before the layout has given the container its real size; fitting a zero-size container computes a wrong world-scale zoom that then gets saved as the camera — the 'auto-zoom to tests fails sometimes' dogfeed. Deferring and retrying until the container is sized fixes it; a ``useRef`` flag (which never causes a redraw) guards against firing twice under React's development double-mount and is set only on a real fit. It skips silently on an empty project so a blank project stays on the Belgium fallback.

.. CG-EXPLANATION-END id=function:FitOnLoad

``function FlyToSelected``
--------------------------

.. CG-BLOCK id=function:FlyToSelected lines=295-353

.. literalinclude:: ../../../desktop/src/renderer/src/components/MapView.tsx
   :language: tsx
   :lines: 295-353
   :lineno-match:

.. CG-EXPLANATION-START id=function:FlyToSelected

**What this does.** An invisible child that animates the camera to the selected investigation. When the selected CPT or borehole id changes, it finds that row, projects its stored x/y to WGS84 through the project's CRS, and flies there at zoom 17 or the user's current zoom, whichever is closer in.

**Why it is here.** The fly-to target is a project-owned row, so it projects through the same CRS as its marker (Codex 2). ``Math.max`` keeps the animation from ever zooming out past the user's current detail — clicking a marker while at street-level zoom stays there — and only pushes the zoom up to site level (17) when the user is currently zoomed out.

.. CG-EXPLANATION-END id=function:FlyToSelected

``function ShiftDragMarquee``
-----------------------------

.. CG-BLOCK id=function:ShiftDragMarquee lines=354-455

.. literalinclude:: ../../../desktop/src/renderer/src/components/MapView.tsx
   :language: tsx
   :lines: 354-455
   :lineno-match:

.. CG-EXPLANATION-START id=function:ShiftDragMarquee

**What this does.** An invisible child that adds Shift+drag rectangle multi-select. It keeps the live drag rectangle in state and refs to the latest marker lists and callback. A native ``mousedown`` listener on the Leaflet container starts a drag only when Shift is held, turns off Leaflet's pan, tracks the rectangle on ``mousemove``, and on ``mouseup`` collects every marker whose WGS84 position falls inside the rectangle and reports that id set. While dragging it draws a dashed blue rectangle pinned to the high draw-overlay pane.

**Why it is here.** Shift+drag is chosen because plain drag is Leaflet's pan and Shift is the universal 'extend selection' modifier (ux.md). The mousedown is attached with ``addEventListener`` rather than a React ``onMouseDown`` because React's mouse handler is passive and could not stop the event from also triggering Leaflet's pan — the same native-listener rule seen on the CptChart wheel-zoom. The refs let the listener read the latest marker lists without being torn down and re-attached on every render. The ``eslint-disable`` here carries its required ``reason:`` — the map instance is stable for the map's lifetime and all changing data is read through refs, so listing more dependencies would be wrong. The rectangle is pinned to the ``draw-overlay`` pane because the default overlay pane renders under the Geopunt reference overlay and would hide the box.

.. CG-EXPLANATION-END id=function:ShiftDragMarquee

``function MapView``
--------------------

.. CG-BLOCK id=function:MapView lines=456-987

.. literalinclude:: ../../../desktop/src/renderer/src/components/MapView.tsx
   :language: tsx
   :lines: 456-987
   :lineno-match:

.. CG-EXPLANATION-START id=function:MapView

**What this does.** The main map component. It reads translation and online status, and the saved basemap choice (seeded once from the current theme). It works out the start camera (restored, or Belgium as a fallback), the open-category state, the per-type and per-axis counts (cached with ``useMemo``, which remembers a computed value between redraws), the filtered-and-projected CPT and borehole marker lists, and the legend of currently-visible values. It keeps a ref to the Leaflet map so the fit-to-data button (a sibling of the map, not a child) can call ``fitBounds``, and one shared tooltip that marker hovers open and close directly. It then returns a box holding the ``MapContainer`` — with canvas rendering turned on, the basemap tile layer, an optional overlay layer and the DEM hillshade layer, a stack of explicitly z-ordered panes, the invisible helper children, and the CPT, borehole and pending-pin markers — followed by a screen-reader count, the layer control, the legend, the fit-to-data button and the offline banner.

**Why it is here.** The basemap is read from ``localStorage`` and seeded once from the theme, never re-read while drawing, because re-reading it on each redraw would re-couple the basemap to the theme and bring back the tile-flash 'shiver' fixed in the dark-mode pass — and ``localStorage`` holds only screen preferences, not project decisions. Canvas rendering is switched on because drawing thousands of circle markers as individual SVG elements makes panning stutter; here *canvas* (pixel drawing) is chosen over *SVG* (vector drawing) purely for speed at high marker counts (M7a). The one shared tooltip is driven imperatively through refs, not state, so a hover never redraws the whole marker layer (M7a). The panes are pinned to explicit z-order numbers so markers, tooltips and the draw box always sit above the Geopunt reference overlay, which the default panes did not. Each marker's fill comes from the ``KNOWN_COLORS`` lookup or the hash fallback, with rings added for selection, hover and marquee; project-owned rows project through the project CRS (Codex 2); ``fitBounds`` refreshes the container size first and caps at zoom 17 to avoid the stale-size wrong-zoom. The basemap attribution is passed as raw HTML, which is safe only while basemap definitions stay hardcoded constants (debt #113). The map's view actions — switching basemap, toggling a layer, fitting to data — are all reversible and fire immediately with no confirmation.

.. CG-EXPLANATION-END id=function:MapView

``function LayerControl``
-------------------------

.. CG-BLOCK id=function:LayerControl lines=988-1184

.. literalinclude:: ../../../desktop/src/renderer/src/components/MapView.tsx
   :language: tsx
   :lines: 988-1184
   :lineno-match:

.. CG-EXPLANATION-START id=function:LayerControl

**What this does.** The dropdown panel at the top-right. Given the counts, hidden sets, toggles, the borehole axis, and the DEM and basemap state, it renders up to four collapsible categories — Basemap (a radio list of tile providers), CPT (a checkbox per type), Borehole (an axis toggle plus a checkbox per value), and Terrain (the hillshade controls) — with only one open at a time. It stops mouse, wheel and click events from reaching the map underneath.

**Why it is here.** One-open-at-a-time is the panel's Option-B design. Basemap is always present so the user can switch tiles before any data is loaded; the CPT and Borehole categories appear only when such data exists; Terrain always renders when the parent wires its handler — even when the project's CRS has no hillshade source — so the feature stays discoverable, because hiding it made it unfindable on fresh projects (comment). The event-stopping handlers keep a click inside the panel from panning or zooming the map. Every toggle here is a reversible project-local hide, so it takes effect immediately.

.. CG-EXPLANATION-END id=function:LayerControl

``function TerrainSection``
---------------------------

.. CG-BLOCK id=function:TerrainSection lines=1185-1261

.. literalinclude:: ../../../desktop/src/renderer/src/components/MapView.tsx
   :language: tsx
   :lines: 1185-1261
   :lineno-match:

.. CG-EXPLANATION-START id=function:TerrainSection

**What this does.** The body of the Terrain category. When the project has a DEM source it shows an enable checkbox and an opacity slider; when it has none it shows a hint naming which CRS codes (31370 for Belgium, 28992 for the Netherlands) have hillshade and pointing the user to the metadata editor. The slider keeps a local copy of its value and commits it to the parent only when the drag is released.

**Why it is here.** The slider mirrors its value locally so dragging stays smooth: committing every pixel of travel would round-trip through a ``PATCH /view-state`` call and lag, so it commits on release (mouse-up / touch-end / key-up). The no-source hint routes a user on an unsupported CRS to the metadata editor to fix it. The overlay's enabled/opacity state is a project decision that round-trips through the .gmproj bundle, while the slider's in-progress position is transient screen state.

.. CG-EXPLANATION-END id=function:TerrainSection

``function CategoryHeader``
---------------------------

.. CG-BLOCK id=function:CategoryHeader lines=1262-1292

.. literalinclude:: ../../../desktop/src/renderer/src/components/MapView.tsx
   :language: tsx
   :lines: 1262-1292
   :lineno-match:

.. CG-EXPLANATION-START id=function:CategoryHeader

**What this does.** One collapsible section header — a chevron, a label, and a right-aligned badge — rendered as a button that toggles the section open or closed.

**Why it is here.** The badge slot holds a number for the CPT and Borehole categories (an item count) and a string for Terrain (the active provider name, empty when off) — the same slot with different meaning, kept uniform so all headers line up (comment).

.. CG-EXPLANATION-END id=function:CategoryHeader

``function CheckboxRow``
------------------------

.. CG-BLOCK id=function:CheckboxRow lines=1293-1338

.. literalinclude:: ../../../desktop/src/renderer/src/components/MapView.tsx
   :language: tsx
   :lines: 1293-1338
   :lineno-match:

.. CG-EXPLANATION-START id=function:CheckboxRow

**What this does.** One filter row: a checkbox, a colour swatch (circle or square), a truncated label with a tooltip, and a count.

**Why it is here.** Shared by the CPT and borehole lists; the swatch shape matches the marker shape on the map — a circle for CPT, a square for borehole — so reading a row never requires translating between dot and square. Ticking a row is a reversible project-local hide that fires immediately.

.. CG-EXPLANATION-END id=function:CheckboxRow

``function AxisButton``
-----------------------

.. CG-BLOCK id=function:AxisButton lines=1339-1366

.. literalinclude:: ../../../desktop/src/renderer/src/components/MapView.tsx
   :language: tsx
   :lines: 1339-1366
   :lineno-match:

.. CG-EXPLANATION-START id=function:AxisButton

**What this does.** A small toggle button for choosing which borehole attribute the filter and colours follow — drill method or borehole type — highlighted when active.

**Why it is here.** Lets the borehole category be coloured and filtered by either attribute; the switch is reversible and takes effect immediately.

.. CG-EXPLANATION-END id=function:AxisButton

``interface LegendEntry``
-------------------------

.. CG-BLOCK id=interface:LegendEntry lines=1367-1377

.. literalinclude:: ../../../desktop/src/renderer/src/components/MapView.tsx
   :language: tsx
   :lines: 1367-1377
   :lineno-match:

.. CG-EXPLANATION-START id=interface:LegendEntry

**What this does.** The shape of one legend row: a label, a count, a colour, an optional monospace flag, and a shape (circle or square).

**Why it is here.** The ``shape`` field mirrors the marker shape on the map so reading the legend never means translating between a dot and a square (comment).

.. CG-EXPLANATION-END id=interface:LegendEntry

``function Legend``
-------------------

.. CG-BLOCK id=function:Legend lines=1378-1421

.. literalinclude:: ../../../desktop/src/renderer/src/components/MapView.tsx
   :language: tsx
   :lines: 1378-1421
   :lineno-match:

.. CG-EXPLANATION-START id=function:Legend

**What this does.** The panel at the bottom-right listing every category value currently visible on the map, each with its swatch and count; it also stops mouse events from reaching the map beneath.

**Why it is here.** It shows only the values visible on the map right now, so the user can read the marker colours at a glance regardless of what the layer-control state happens to be (comment).

.. CG-EXPLANATION-END id=function:Legend

``function tally``
------------------

.. CG-BLOCK id=function:tally lines=1422-1430

.. literalinclude:: ../../../desktop/src/renderer/src/components/MapView.tsx
   :language: tsx
   :lines: 1422-1430
   :lineno-match:

.. CG-EXPLANATION-START id=function:tally

**What this does.** A helper that counts a list by a key it extracts from each item, bucketing null or empty keys under the dash ``'—'``.

**Why it is here.** The ``<T>`` makes this a *generic* helper — a placeholder type filled in by the caller so the one function counts boreholes by drill method or by type with a single implementation. The dash bucket keeps items with a missing value visible in the counts rather than dropped.

.. CG-EXPLANATION-END id=function:tally

``function sum``
----------------

.. CG-BLOCK id=function:sum lines=1431-1436

.. literalinclude:: ../../../desktop/src/renderer/src/components/MapView.tsx
   :language: tsx
   :lines: 1431-1436
   :lineno-match:

.. CG-EXPLANATION-START id=function:sum

**What this does.** Adds up an iterable of numbers and returns the total.

**Why it is here.** A one-line helper used for the total CPT count shown in the category header badge.

.. CG-EXPLANATION-END id=function:sum

``function orderedCptTypes``
----------------------------

.. CG-BLOCK id=function:orderedCptTypes lines=1437-1462

.. literalinclude:: ../../../desktop/src/renderer/src/components/MapView.tsx
   :language: tsx
   :lines: 1437-1462
   :lineno-match:

.. CG-EXPLANATION-START id=function:orderedCptTypes

**What this does.** Sorts the CPT type names into a fixed display order — CPTU, then CPTE, then CPTM — with any unknown types alphabetical at the end.

**Why it is here.** Keeps the panel and legend order stable as new types arrive through imports, so the layout does not reshuffle each time (comment).

.. CG-EXPLANATION-END id=function:orderedCptTypes

``function squareDivIcon``
--------------------------

.. CG-BLOCK id=function:squareDivIcon lines=1463-1498

.. literalinclude:: ../../../desktop/src/renderer/src/components/MapView.tsx
   :language: tsx
   :lines: 1463-1498
   :lineno-match:

.. CG-EXPLANATION-START id=function:squareDivIcon

**What this does.** Builds a Leaflet ``divIcon`` whose content is a small inline SVG square: 9 px normally, 14 px when selected, filled with the given colour and stroked by state (dark-red when selected, blue when marquee-picked, dark-brown otherwise), with an optional dashed blue ring for a marquee pick, centred on the marker's position.

**Why it is here.** Boreholes are drawn square to contrast with the round CPT circles — the shape is the primary CPT-versus-borehole signal and the colour is the secondary filter signal (comment). Leaflet's ``CircleMarker`` is its only built-in fixed-pixel shape, so a square has to be hand-drawn as an *SVG* (vector) icon. The sizes match the CPT radii so both families read at the same visual weight; the stroke is pulled half its width inward so a selection's extra pixels are not clipped by the icon box, and Leaflet's default white icon background and border are dropped so the SVG owns the pixel.

.. CG-EXPLANATION-END id=function:squareDivIcon

``function colorForCategoryValue``
----------------------------------

.. CG-BLOCK id=function:colorForCategoryValue lines=1499-1504

.. literalinclude:: ../../../desktop/src/renderer/src/components/MapView.tsx
   :language: tsx
   :lines: 1499-1504
   :lineno-match:

.. CG-EXPLANATION-START id=function:colorForCategoryValue

**What this does.** Picks a colour for a category value: grey for an empty value or the dash, otherwise the curated ``KNOWN_COLORS`` colour, otherwise the hash fallback.

**Why it is here.** The single place that applies the lookup-then-hash rule, so every borehole category value gets one stable colour used identically on the map and in the legend.

.. CG-EXPLANATION-END id=function:colorForCategoryValue

``function hashColor``
----------------------

.. CG-BLOCK id=function:hashColor lines=1505-1515

.. literalinclude:: ../../../desktop/src/renderer/src/components/MapView.tsx
   :language: tsx
   :lines: 1505-1515
   :lineno-match:

.. CG-EXPLANATION-START id=function:hashColor

**What this does.** Turns any string into a stable colour by hashing it (the djb2 hash) down to a hue, at a fixed saturation and lightness.

**Why it is here.** This is a *hash colour* — mapping a text token to a colour by hashing the text, so a value with no curated colour still always gets the same distinguishable hue. The saturation and lightness are chosen so the colours stay readable at the small marker size and sit well beside the curated palette (comment).

.. CG-EXPLANATION-END id=function:hashColor

``function buildLegend``
------------------------

.. CG-BLOCK id=function:buildLegend lines=1516-1556

.. literalinclude:: ../../../desktop/src/renderer/src/components/MapView.tsx
   :language: tsx
   :lines: 1516-1556
   :lineno-match:

.. CG-EXPLANATION-START id=function:buildLegend

**What this does.** Assembles the legend rows — CPT types in display order, then borehole values by descending count — skipping any that are hidden or have a zero count, and tagging each with its colour and its shape.

**Why it is here.** It produces exactly the 'visible on the map' set the ``Legend`` draws, with colours and shapes matching the markers so the two always agree.

.. CG-EXPLANATION-END id=function:buildLegend

``function SectionDrawHint``
----------------------------

.. CG-BLOCK id=function:SectionDrawHint lines=1557-1570

.. literalinclude:: ../../../desktop/src/renderer/src/components/MapView.tsx
   :language: tsx
   :lines: 1557-1570
   :lineno-match:

.. CG-EXPLANATION-START id=function:SectionDrawHint

**What this does.** A red banner across the top-centre, shown only while the cross-section draw mode is active, with the instruction text and a Cancel button.

**Why it is here.** It sits above the map rather than inside the map container, so its stacking order is simple and a click on Cancel does not also register as a map click (comment); the button mirrors the Escape-key shortcut so a user who does not recall the key still has a visible way out.

.. CG-EXPLANATION-END id=function:SectionDrawHint

