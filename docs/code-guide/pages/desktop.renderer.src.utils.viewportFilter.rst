desktop.renderer.src.utils.viewportFilter
=========================================

.. CG-PAGE source=desktop/src/renderer/src/utils/viewportFilter.ts complete=true

*Source file:* ``desktop/src/renderer/src/utils/viewportFilter.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-39

.. literalinclude:: ../../../desktop/src/renderer/src/utils/viewportFilter.ts
   :language: typescript
   :lines: 1-39
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** This file finds which records — CPTs and boreholes — have their map marker currently outside the visible part of the map. It imports Leaflet's type for map bounds, the projection helper, and the helper that clamps a project's EPSG to a supported one.

**Why it is here.** The docstring records the trap it guards against: the map's bounds are in WGS84 degrees, but each record is stored in the project's own horizontal CRS, so every record is projected to WGS84 with the project's effective EPSG before the inside/outside test, making it an apples-to-apples comparison. A Netherlands (28992) project read as Belgium Lambert-72 would put its rows hundreds of kilometres away and dim rows that are actually on screen (Codex 2). The EPSG is clamped to a supported CRS so the projection can never throw.

.. CG-EXPLANATION-END id=module-header

``function idsOutsideBounds``
-----------------------------

.. CG-BLOCK id=function:idsOutsideBounds lines=40-53

.. literalinclude:: ../../../desktop/src/renderer/src/utils/viewportFilter.ts
   :language: typescript
   :lines: 40-53
   :lineno-match:

.. CG-EXPLANATION-START id=function:idsOutsideBounds

**What this does.** Returns the set of ids whose projected marker falls outside the given bounds. If there are no bounds yet it returns an empty set. Otherwise it resolves the EPSG to a supported one, projects each record to latitude/longitude, and collects the ids that Leaflet reports as not contained in the bounds.

**Why it is here.** The docstring records why an empty set is returned before the first bounds arrive: on the very first render, before Leaflet has reported its initial viewport, treating every record as on-screen stops the sidebar from briefly shoving all rows into the dimmed "out of viewport" group.

.. CG-EXPLANATION-END id=function:idsOutsideBounds

