desktop.renderer.src.sheet.SheetMap
===================================

.. CG-PAGE source=desktop/src/renderer/src/sheet/SheetMap.tsx complete=false

*Source file:* ``desktop/src/renderer/src/sheet/SheetMap.tsx``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-17

.. literalinclude:: ../../../desktop/src/renderer/src/sheet/SheetMap.tsx
   :language: tsx
   :lines: 1-17
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** A documentation comment and the imports for the map that sits in the sheet's top-right box. The comment explains that the Leaflet library draws the background map tiles, while the overlay (the A - A′ line, the investigation dots and codes, the scale bar and the north arrow) is one SVG laid over the box and redrawn every time the map moves, so it prints as sharp vectors; and that the component reports back once the tiles have loaded or a time limit has passed. The imports bring in Leaflet and its stylesheet, React's building blocks, the projection helpers, the basemap-source lookup, the map-extent and scale-bar helpers, the project-colour lookup, the tile wait time, and the payload type.

**Why it is here.** A *basemap* is the geographic background (streets, aerial imagery) that gives the section its real-world context; *Leaflet* is the mapping library that fetches and draws it in square image *tiles*. The overlay is drawn separately as an SVG so the printed line, dots and labels stay crisp vectors rather than being baked into a blurry image, which the design note requires (``SVG in the Leaflet overlay pane, so it prints as vectors``).

.. CG-EXPLANATION-END id=module-header

``const INK``
-------------

.. CG-BLOCK id=const:INK lines=18-18

.. literalinclude:: ../../../desktop/src/renderer/src/sheet/SheetMap.tsx
   :language: tsx
   :lines: 18-18
   :lineno-match:

.. CG-EXPLANATION-START id=const:INK

**What this does.** Sets the dark ink colour used for the map's dots, codes, scale bar and north arrow (the same dark blue-grey as the profile).

**Why it is here.** Keeps the map overlay in the same single ink tone as the rest of the sheet, so the whole page reads as one consistent drawing.

.. CG-EXPLANATION-END id=const:INK

``const LINE``
--------------

.. CG-BLOCK id=const:LINE lines=19-21

.. literalinclude:: ../../../desktop/src/renderer/src/sheet/SheetMap.tsx
   :language: tsx
   :lines: 19-21
   :lineno-match:

.. CG-EXPLANATION-START id=const:LINE

**What this does.** Sets a warm red colour used for the section line on the map and its ``A`` / ``A′`` end labels.

**Why it is here.** The section line and its end markers are drawn in the same red the profile uses for ``A`` and ``A′``, so the eye ties the line on the map to the drawing beside it.

.. CG-EXPLANATION-END id=const:LINE

``function attributionText``
----------------------------

.. CG-BLOCK id=function:attributionText lines=22-25

.. literalinclude:: ../../../desktop/src/renderer/src/sheet/SheetMap.tsx
   :language: tsx
   :lines: 22-25
   :lineno-match:

.. CG-EXPLANATION-START id=function:attributionText

**What this does.** Takes the tile provider's attribution (which arrives as a small piece of web markup, possibly with links) and strips out every tag and extra space, leaving plain text.

**Why it is here.** Map tile providers such as OpenStreetMap require their credit to be shown, but a printed page has no links to click, so the credit is reduced to plain readable text and printed as a small caption inside the box. This is a licence requirement, noted in the design spec.

.. CG-EXPLANATION-END id=function:attributionText

``function SheetMap``
---------------------

.. CG-BLOCK id=function:SheetMap lines=26-127

.. literalinclude:: ../../../desktop/src/renderer/src/sheet/SheetMap.tsx
   :language: tsx
   :lines: 26-127
   :lineno-match:

.. CG-EXPLANATION-START id=function:SheetMap

**What this does.** The map component. It creates a Leaflet map inside the box with every interaction turned off (no dragging, zooming or scrolling — it is a print, not a tool), adds the chosen basemap's tile layer, and watches for the tiles to finish loading; if they fail or a time limit passes it marks the map ``offline``. It fits the view to the padded extent of the section line and the on-profile investigations, converting every point with the section's own coordinate system. Then it draws the SVG overlay: the red section line with ``A`` and ``A′``, one dot per investigation (full colour and code for those on the profile, half-faded for the others), a two-segment scale bar labelled 0 / half / full, a north arrow with ``N``, and — when offline — a caption saying the basemap is unavailable. Any required tile-provider credit is printed as a small caption in the corner.

**Why it is here.** This is the location map the owner asked for beside the section. Turning off all interaction and redrawing the overlay on every map move is what lets the same component serve as both the on-screen preview and the vector print. The comment on the coordinate conversion records a real fix: the map must use the section's own coordinate system, because a Dutch RD project (EPSG:28992) is not the Belgian Lambert 72 grid, and converting with the wrong one puts every point in the wrong place. Faded dots for off-profile investigations and full colour for on-profile ones match the design spec, and the offline caption means a print never blocks or fails just because the internet map did not load (the export waits at most a few seconds for tiles). The one place the linter is silenced carries a written reason: the map is built once per payload, and re-running it on other changes would tear down the tiles mid-load.

.. CG-EXPLANATION-END id=function:SheetMap

