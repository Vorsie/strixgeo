desktop.renderer.src.utils.tieToLatLngLine
==========================================

.. CG-PAGE source=desktop/src/renderer/src/utils/tieToLatLngLine.ts complete=true

*Source file:* ``desktop/src/renderer/src/utils/tieToLatLngLine.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-12

.. literalinclude:: ../../../desktop/src/renderer/src/utils/tieToLatLngLine.ts
   :language: typescript
   :lines: 1-12
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** This file converts a proposed tie-section's two endpoints from the project's own flat map coordinates into the pair of latitude/longitude points the map library (Leaflet) needs to draw a line. It imports the projection helper and the type that describes a proposed tie.

**Why it is here.** The docstring records the reason a conversion is needed: the map draws in WGS84 (degrees of latitude and longitude), while the tie's endpoints are in the project's *projected CRS* — a coordinate reference system whose units are metres. Turning one into the other is a *projection*, named by an EPSG number. The helper is deliberately pure, with no React and no Leaflet, so it is easy to test.

.. CG-EXPLANATION-END id=module-header

``function tieToLatLngLine``
----------------------------

.. CG-BLOCK id=function:tieToLatLngLine lines=13-18

.. literalinclude:: ../../../desktop/src/renderer/src/utils/tieToLatLngLine.ts
   :language: typescript
   :lines: 13-18
   :lineno-match:

.. CG-EXPLANATION-START id=function:tieToLatLngLine

**What this does.** Projects the tie's start point and end point to WGS84 in the given EPSG and returns the two ``[lat, lng]`` pairs as a list.

**Why it is here.** The map overlay can only place a line in latitude/longitude, and the ``epsg`` argument names the project's horizontal CRS (for example 31370 for Belgium, 28992 for the Netherlands) so the two points land in the right place on the map.

.. CG-EXPLANATION-END id=function:tieToLatLngLine

