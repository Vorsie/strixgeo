desktop.renderer.src.sheet.sheetMapProjection
=============================================

.. CG-PAGE source=desktop/src/renderer/src/sheet/sheetMapProjection.ts complete=false

*Source file:* ``desktop/src/renderer/src/sheet/sheetMapProjection.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-8

.. literalinclude:: ../../../desktop/src/renderer/src/sheet/sheetMapProjection.ts
   :language: typescript
   :lines: 1-8
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** A comment and two imports. The comment says every point on the sheet's map is converted using the section's own horizontal coordinate system, so a Dutch RD project (EPSG:28992) lands where it belongs, and records that an audit found the map wrongly converting everything as if it were Lambert 72 regardless of the project. The imports bring in the projected-to-WGS84 converter and the map-extent helper.

**Why it is here.** A *coordinate system* (identified by an EPSG number) is the grid a survey's east/north metres are measured on; Belgium's is Lambert 72, the Netherlands' is RD (EPSG:28992). *WGS84* is the latitude/longitude the web map draws in. Converting with the wrong grid puts every point kilometres out of place — the exact bug the audit caught — so this file always uses the section's own EPSG.

.. CG-EXPLANATION-END id=module-header

``function sheetPointToLatLng``
-------------------------------

.. CG-BLOCK id=function:sheetPointToLatLng lines=9-13

.. literalinclude:: ../../../desktop/src/renderer/src/sheet/sheetMapProjection.ts
   :language: typescript
   :lines: 9-13
   :lineno-match:

.. CG-EXPLANATION-START id=function:sheetPointToLatLng

**What this does.** Converts one projected point (east x, north y) in the given coordinate system into a WGS84 latitude and longitude.

**Why it is here.** The web map needs latitude and longitude, but the section's investigations are stored in projected survey metres; this is the single converter that bridges the two, always told which grid the metres are on.

.. CG-EXPLANATION-END id=function:sheetPointToLatLng

``function sheetMapBounds``
---------------------------

.. CG-BLOCK id=function:sheetMapBounds lines=14-23

.. literalinclude:: ../../../desktop/src/renderer/src/sheet/sheetMapProjection.ts
   :language: typescript
   :lines: 14-23
   :lineno-match:

.. CG-EXPLANATION-START id=function:sheetMapBounds

**What this does.** Given the points to show and their coordinate system, it computes the padded map extent in projected metres and returns its south-west and north-east corners converted to WGS84.

**Why it is here.** The map library frames itself from a latitude/longitude box; this produces that box from the same padded extent the scale bar and overlay use, so the framing and the overlay always agree.

.. CG-EXPLANATION-END id=function:sheetMapBounds

