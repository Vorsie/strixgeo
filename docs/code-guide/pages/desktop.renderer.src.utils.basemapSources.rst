desktop.renderer.src.utils.basemapSources
=========================================

.. CG-PAGE source=desktop/src/renderer/src/utils/basemapSources.ts complete=true

*Source file:* ``desktop/src/renderer/src/utils/basemapSources.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-35

.. literalinclude:: ../../../desktop/src/renderer/src/utils/basemapSources.ts
   :language: typescript
   :lines: 1-35
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** A comment describing this file as the registry of basemap tile layers — the background maps the map view can show — where each entry is a self-contained descriptor (its tile-URL template, attribution, optional subdomains, and a stable id).

**Why it is here.** The comment records the design rules (CLAUDE.md, docs/ux.md map conventions): only free, key-free providers whose usage policy was checked; the exact tile-ordering quirks per provider (Esri inverts the row and column order, Geopunt uses a specific request syntax against the EPSG:3857 tile grid — a coordinate reference system named by its EPSG number, here the web-mapping standard); that the basemap choice is deliberately decoupled from the app theme so a theme toggle never switches the map after the user's first explicit pick; and that the choice is stored in localStorage — a small per-user store the browser keeps on this one computer — as UI chrome only, never in the project bundle.

.. CG-EXPLANATION-END id=module-header

``type BasemapId``
------------------

.. CG-BLOCK id=type:BasemapId lines=36-45

.. literalinclude:: ../../../desktop/src/renderer/src/utils/basemapSources.ts
   :language: typescript
   :lines: 36-45
   :lineno-match:

.. CG-EXPLANATION-START id=type:BasemapId

**What this does.** Names the fixed set of basemap identifiers the app supports (OpenStreetMap, two CARTO styles, two Esri styles, and two Geopunt aerial styles).

**Why it is here.** Pinning the ids to this list means every basemap reference and the stored preference can only be one of the real basemaps, so a stale or hand-edited value is caught.

.. CG-EXPLANATION-END id=type:BasemapId

``interface BasemapOverlay``
----------------------------

.. CG-BLOCK id=interface:BasemapOverlay lines=46-53

.. literalinclude:: ../../../desktop/src/renderer/src/utils/basemapSources.ts
   :language: typescript
   :lines: 46-53
   :lineno-match:

.. CG-EXPLANATION-START id=interface:BasemapOverlay

**What this does.** Describes an optional transparent layer drawn above a base tile layer: its tile-URL template and its attribution.

**Why it is here.** Needed for the hybrid basemaps where a reference or line layer is composited over an aerial photo base, so the overlay is described separately from the opaque base.

.. CG-EXPLANATION-END id=interface:BasemapOverlay

``interface BasemapSource``
---------------------------

.. CG-BLOCK id=interface:BasemapSource lines=54-93

.. literalinclude:: ../../../desktop/src/renderer/src/utils/basemapSources.ts
   :language: typescript
   :lines: 54-93
   :lineno-match:

.. CG-EXPLANATION-START id=interface:BasemapSource

**What this does.** Describes one basemap provider fully: its id, the name shown in the dropdown, the base tile-URL template, the attribution, optional subdomains, a loading background colour, and an optional overlay.

**Why it is here.** The comments record that the loading background keeps the blank-to-tiled transition less jarring, and that the optional overlay is used by hybrid basemaps whose overlay must serve transparent images so it composites over the base.

.. CG-EXPLANATION-END id=interface:BasemapSource

``const GEOPUNT_ORTHO_URL``
---------------------------

.. CG-BLOCK id=const:GEOPUNT_ORTHO_URL lines=94-99

.. literalinclude:: ../../../desktop/src/renderer/src/utils/basemapSources.ts
   :language: typescript
   :lines: 94-99
   :lineno-match:

.. CG-EXPLANATION-START id=const:GEOPUNT_ORTHO_URL

**What this does.** The tile-URL template for the Flemish orthophoto (aerial) layer, built as a request against the Geopunt tile service.

**Why it is here.** The comment records that the endpoint, the tile-grid, and a sample tile were verified live on 2026-05-15, so the exact request parameters are known-good rather than guessed.

.. CG-EXPLANATION-END id=const:GEOPUNT_ORTHO_URL

``const GEOPUNT_GRB_SEL_URL``
-----------------------------

.. CG-BLOCK id=const:GEOPUNT_GRB_SEL_URL lines=100-105

.. literalinclude:: ../../../desktop/src/renderer/src/utils/basemapSources.ts
   :language: typescript
   :lines: 100-105
   :lineno-match:

.. CG-EXPLANATION-START id=const:GEOPUNT_GRB_SEL_URL

**What this does.** The tile-URL template for the Geopunt reference-overlay layer, built the same way as the orthophoto URL.

**Why it is here.** The comment records that this layer serves transparent images so it composites cleanly over the opaque aerial base; verified in the same 2026-05-15 check.

.. CG-EXPLANATION-END id=const:GEOPUNT_GRB_SEL_URL

``const GEOPUNT_ATTRIBUTION``
-----------------------------

.. CG-BLOCK id=const:GEOPUNT_ATTRIBUTION lines=106-110

.. literalinclude:: ../../../desktop/src/renderer/src/utils/basemapSources.ts
   :language: typescript
   :lines: 106-110
   :lineno-match:

.. CG-EXPLANATION-START id=const:GEOPUNT_ATTRIBUTION

**What this does.** The attribution text (with links) required for the Geopunt layers.

**Why it is here.** Naming it once means both Geopunt basemaps and the overlay credit the provider identically, as the tile usage policy requires.

.. CG-EXPLANATION-END id=const:GEOPUNT_ATTRIBUTION

``const BASEMAP_SOURCES``
-------------------------

.. CG-BLOCK id=const:BASEMAP_SOURCES lines=111-186

.. literalinclude:: ../../../desktop/src/renderer/src/utils/basemapSources.ts
   :language: typescript
   :lines: 111-186
   :lineno-match:

.. CG-EXPLANATION-START id=const:BASEMAP_SOURCES

**What this does.** The full list of supported basemaps in display order, each a complete descriptor: OpenStreetMap, CARTO Voyager, Esri satellite, CARTO dark, Esri world topo, the Geopunt aerial, and the Geopunt aerial-plus-reference hybrid.

**Why it is here.** The per-entry comments record the tile-ordering per provider (standard order for OSM and CARTO, inverted for the Esri MapServer entries), that all providers are free and verified, and that the Flemish layers cover Flanders only (tiles outside it are blank, not an error) — so this single list is the authority every map surface reads its basemap facts from.

.. CG-EXPLANATION-END id=const:BASEMAP_SOURCES

``function basemapById``
------------------------

.. CG-BLOCK id=function:basemapById lines=187-190

.. literalinclude:: ../../../desktop/src/renderer/src/utils/basemapSources.ts
   :language: typescript
   :lines: 187-190
   :lineno-match:

.. CG-EXPLANATION-START id=function:basemapById

**What this does.** Looks up a basemap descriptor by its id, returning nothing when the id is unknown.

**Why it is here.** A single lookup so callers turn a stored or selected id into its full descriptor in one place.

.. CG-EXPLANATION-END id=function:basemapById

``const STORAGE_KEY``
---------------------

.. CG-BLOCK id=const:STORAGE_KEY lines=191-191

.. literalinclude:: ../../../desktop/src/renderer/src/utils/basemapSources.ts
   :language: typescript
   :lines: 191-191
   :lineno-match:

.. CG-EXPLANATION-START id=const:STORAGE_KEY

**What this does.** The name under which the chosen basemap is stored in localStorage: ``groundmodel.map.basemap``.

**Why it is here.** Naming the storage slot once means the read and the write can never drift onto different names; it follows the app's ``groundmodel.<area>.<thing>`` preference-naming convention.

.. CG-EXPLANATION-END id=const:STORAGE_KEY

``const DEFAULT_BASEMAP_ID_LIGHT``
----------------------------------

.. CG-BLOCK id=const:DEFAULT_BASEMAP_ID_LIGHT lines=192-192

.. literalinclude:: ../../../desktop/src/renderer/src/utils/basemapSources.ts
   :language: typescript
   :lines: 192-192
   :lineno-match:

.. CG-EXPLANATION-START id=const:DEFAULT_BASEMAP_ID_LIGHT

**What this does.** The first-run default basemap for a light theme: OpenStreetMap.

**Why it is here.** A sensible plain default when nothing is stored and the theme is light.

.. CG-EXPLANATION-END id=const:DEFAULT_BASEMAP_ID_LIGHT

``const DEFAULT_BASEMAP_ID_DARK``
---------------------------------

.. CG-BLOCK id=const:DEFAULT_BASEMAP_ID_DARK lines=193-220

.. literalinclude:: ../../../desktop/src/renderer/src/utils/basemapSources.ts
   :language: typescript
   :lines: 193-220
   :lineno-match:

.. CG-EXPLANATION-START id=const:DEFAULT_BASEMAP_ID_DARK

**What this does.** The first-run default basemap for a dark theme: the Geopunt hybrid.

**Why it is here.** A dark-friendly default when nothing is stored and the theme is dark — chosen once at first run, never re-applied on a later theme toggle.

.. CG-EXPLANATION-END id=const:DEFAULT_BASEMAP_ID_DARK

``function readBasemapId``
--------------------------

.. CG-BLOCK id=function:readBasemapId lines=221-242

.. literalinclude:: ../../../desktop/src/renderer/src/utils/basemapSources.ts
   :language: typescript
   :lines: 221-242
   :lineno-match:

.. CG-EXPLANATION-START id=function:readBasemapId

**What this does.** Reads the stored basemap id from localStorage. If a value is stored and is a real basemap, it is returned regardless of theme; otherwise it returns the theme-appropriate first-run default (dark gets the hybrid, light gets OSM). The whole read is guarded so an unavailable localStorage falls back to the default.

**Why it is here.** The docstring records the strong rule: the user's explicit choice always wins, so the theme is only consulted on first run; and it must be called exactly once as the map view's lazy state initialiser, never on the render path or a theme change, because re-coupling the basemap to the theme would reintroduce the tile-layer "shiver" fixed in the S4 dark pass.

.. CG-EXPLANATION-END id=function:readBasemapId

``function writeBasemapId``
---------------------------

.. CG-BLOCK id=function:writeBasemapId lines=243-250

.. literalinclude:: ../../../desktop/src/renderer/src/utils/basemapSources.ts
   :language: typescript
   :lines: 243-250
   :lineno-match:

.. CG-EXPLANATION-START id=function:writeBasemapId

**What this does.** Saves the chosen basemap id to localStorage, doing nothing if localStorage is unavailable.

**Why it is here.** The docstring records that a failed write is harmless because the in-memory state already reflects the change, so the UI stays consistent even when the preference cannot be persisted (a full quota or a private-browsing mode).

.. CG-EXPLANATION-END id=function:writeBasemapId

