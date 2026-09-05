desktop.renderer.src.components.mapMarkers
==========================================

.. CG-PAGE source=desktop/src/renderer/src/components/mapMarkers.ts complete=true

*Source file:* ``desktop/src/renderer/src/components/mapMarkers.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-17

.. literalinclude:: ../../../desktop/src/renderer/src/components/mapMarkers.ts
   :language: typescript
   :lines: 1-17
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The opening comment and the imports — the WGS84 projection helper and the CPT / borehole list types from the API client.

**Why it is here.** This is a Leaflet-free module holding the pure marker projection, kept separate so the coordinate-system rule can be unit-tested without mounting the map (a live map needs a real browser page). The comment records the rule seen on the ``desktop.renderer.src.components.MapView`` page: project-owned rows project through the PROJECT's own CRS, while DOV pending pins are a separate, explicitly Lambert-72 source built elsewhere.

.. CG-EXPLANATION-END id=module-header

``interface CptMapMarker``
--------------------------

.. CG-BLOCK id=interface:CptMapMarker lines=18-27

.. literalinclude:: ../../../desktop/src/renderer/src/components/mapMarkers.ts
   :language: typescript
   :lines: 18-27
   :lineno-match:

.. CG-EXPLANATION-START id=interface:CptMapMarker

**What this does.** The shape of a finished CPT marker — id, latitude, longitude, name, type and depth — ready for a Leaflet circle marker.

**Why it is here.** Names the projected record the map draws, so the projection step and the drawing step agree on one shape.

.. CG-EXPLANATION-END id=interface:CptMapMarker

``interface BoreholeMapMarker``
-------------------------------

.. CG-BLOCK id=interface:BoreholeMapMarker lines=28-57

.. literalinclude:: ../../../desktop/src/renderer/src/components/mapMarkers.ts
   :language: typescript
   :lines: 28-57
   :lineno-match:

.. CG-EXPLANATION-START id=interface:BoreholeMapMarker

**What this does.** The shape of a finished borehole marker — id, latitude, longitude, name, the active axis value, drill method, borehole type and depth — ready for a Leaflet square-icon marker; plus the doc for ``resolveProjectEpsg`` below.

**Why it is here.** Names the projected borehole record; the doc explains the EPSG clamp that follows.

.. CG-EXPLANATION-END id=interface:BoreholeMapMarker

``function resolveProjectEpsg``
-------------------------------

.. CG-BLOCK id=function:resolveProjectEpsg lines=58-62

.. literalinclude:: ../../../desktop/src/renderer/src/components/mapMarkers.ts
   :language: typescript
   :lines: 58-62
   :lineno-match:

.. CG-EXPLANATION-START id=function:resolveProjectEpsg

**What this does.** Clamps any project EPSG to one the projection helpers support — 28992 for a Netherlands project, 31370 (Belgian Lambert 72) for everything else. It also opens the comment for ``boreholeAxisValue`` below.

**Why it is here.** The projection helper handles only those two horizontal systems and throws for anything else; a ``null`` on a fresh project, or a future CRS not yet wired, falls back to Belgian Lambert 72 — the platform's historical default — so marker projection degrades to the old behaviour instead of crashing the map (docstring).

.. CG-EXPLANATION-END id=function:resolveProjectEpsg

``function boreholeAxisValue``
------------------------------

.. CG-BLOCK id=function:boreholeAxisValue lines=63-83

.. literalinclude:: ../../../desktop/src/renderer/src/components/mapMarkers.ts
   :language: typescript
   :lines: 63-83
   :lineno-match:

.. CG-EXPLANATION-START id=function:boreholeAxisValue

**What this does.** Returns the category a borehole falls under for the active filter axis — its drill method or its borehole type — or a dash when that value is empty. It also opens the doc for ``buildCptMarkers`` below.

**Why it is here.** One place that reads the axis value, so the marker colour, the filter checkbox and the legend all bucket a borehole the same way.

.. CG-EXPLANATION-END id=function:boreholeAxisValue

``function buildCptMarkers``
----------------------------

.. CG-BLOCK id=function:buildCptMarkers lines=84-117

.. literalinclude:: ../../../desktop/src/renderer/src/components/mapMarkers.ts
   :language: typescript
   :lines: 84-117
   :lineno-match:

.. CG-EXPLANATION-START id=function:buildCptMarkers

**What this does.** Builds the visible CPT markers: it drops the hidden types, projects each remaining CPT's stored x/y to WGS84 through the project's CRS, and drops any that project to a non-finite position. It also opens the doc for ``buildBoreholeMarkers`` below.

**Why it is here.** Produces exactly the CPT markers the map draws from the API-client list; projecting through the project's CRS is the Codex 2 rule, and the finite check guards against a bad stored coordinate becoming an off-world dot.

.. CG-EXPLANATION-END id=function:buildCptMarkers

``function buildBoreholeMarkers``
---------------------------------

.. CG-BLOCK id=function:buildBoreholeMarkers lines=118-144

.. literalinclude:: ../../../desktop/src/renderer/src/components/mapMarkers.ts
   :language: typescript
   :lines: 118-144
   :lineno-match:

.. CG-EXPLANATION-START id=function:buildBoreholeMarkers

**What this does.** The borehole equivalent: it drops the hidden axis values, projects each remaining borehole to WGS84 through the project's CRS, drops any non-finite position, and tags each marker with its axis value and its attributes.

**Why it is here.** Same Codex 2 projection rule and same finite-position guard as ``buildCptMarkers``, producing the borehole markers the map draws.

.. CG-EXPLANATION-END id=function:buildBoreholeMarkers

