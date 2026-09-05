desktop.renderer.src.components.mapPanes
========================================

.. CG-PAGE source=desktop/src/renderer/src/components/mapPanes.ts complete=true

*Source file:* ``desktop/src/renderer/src/components/mapPanes.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-7

.. literalinclude:: ../../../desktop/src/renderer/src/components/mapPanes.ts
   :language: typescript
   :lines: 1-7
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The file's comment. It is the single place for the z-order numbers the map's custom drawing layers stack by, and it lists Leaflet's built-in defaults (tiles 200, overlay 400, shadow 500, markers 600, tooltip 650, popup 700).

**Why it is here.** A *pane* is one of Leaflet's stacking layers, and its z-number decides what draws on top. The numbers are kept together because the stacking order IS the click order: a canvas pane captures pointer events across its whole area, so anything below a canvas pane cannot be clicked (owner ruling 2026-09-04, section lines).

.. CG-EXPLANATION-END id=module-header

``const BASEMAP_OVERLAY_PANE_Z``
--------------------------------

.. CG-BLOCK id=const:BASEMAP_OVERLAY_PANE_Z lines=8-9

.. literalinclude:: ../../../desktop/src/renderer/src/components/mapPanes.ts
   :language: typescript
   :lines: 8-9
   :lineno-match:

.. CG-EXPLANATION-START id=const:BASEMAP_OVERLAY_PANE_Z

**What this does.** z = 210, for the Geopunt reference and other basemap overlay tiles.

**Why it is here.** Just above the opaque base tiles so reference lines are visible, and well below the markers.

.. CG-EXPLANATION-END id=const:BASEMAP_OVERLAY_PANE_Z

``const DEM_OVERLAY_PANE_Z``
----------------------------

.. CG-BLOCK id=const:DEM_OVERLAY_PANE_Z lines=10-11

.. literalinclude:: ../../../desktop/src/renderer/src/components/mapPanes.ts
   :language: typescript
   :lines: 10-11
   :lineno-match:

.. CG-EXPLANATION-START id=const:DEM_OVERLAY_PANE_Z

**What this does.** z = 250, for the hillshade / DEM overlay tiles.

**Why it is here.** Above the basemap overlay but below the markers, so turning on terrain never hides a CPT or borehole.

.. CG-EXPLANATION-END id=const:DEM_OVERLAY_PANE_Z

``const LEADER_PANE_Z``
-----------------------

.. CG-BLOCK id=const:LEADER_PANE_Z lines=12-13

.. literalinclude:: ../../../desktop/src/renderer/src/components/mapPanes.ts
   :language: typescript
   :lines: 12-13
   :lineno-match:

.. CG-EXPLANATION-START id=const:LEADER_PANE_Z

**What this does.** z = 350, for the short leader lines that join a marker to its section.

**Why it is here.** Below the section line and below the markers, as the comment states.

.. CG-EXPLANATION-END id=const:LEADER_PANE_Z

``const INVESTIGATION_MARKERS_PANE_Z``
--------------------------------------

.. CG-BLOCK id=const:INVESTIGATION_MARKERS_PANE_Z lines=14-19

.. literalinclude:: ../../../desktop/src/renderer/src/components/mapPanes.ts
   :language: typescript
   :lines: 14-19
   :lineno-match:

.. CG-EXPLANATION-START id=const:INVESTIGATION_MARKERS_PANE_Z

**What this does.** z = 640, for the CPT and borehole markers — drawn on a canvas because there can be thousands of them. It also opens the doc for the section pane below.

**Why it is here.** Above every basemap and DEM pane so markers always show; a canvas layer for speed at thousands of markers.

.. CG-EXPLANATION-END id=const:INVESTIGATION_MARKERS_PANE_Z

``const SECTION_PANE_Z``
------------------------

.. CG-BLOCK id=const:SECTION_PANE_Z lines=20-21

.. literalinclude:: ../../../desktop/src/renderer/src/components/mapPanes.ts
   :language: typescript
   :lines: 20-21
   :lineno-match:

.. CG-EXPLANATION-START id=const:SECTION_PANE_Z

**What this does.** z = 645, for the section line, its corridor and its 14 px click band.

**Why it is here.** Above the markers canvas so a click on a section line reaches it, but drawn with the vector (SVG) renderer so only the painted stroke takes the click and the markers stay clickable everywhere else (docstring).

.. CG-EXPLANATION-END id=const:SECTION_PANE_Z

``const TOOLTIP_PANE_Z``
------------------------

.. CG-BLOCK id=const:TOOLTIP_PANE_Z lines=22-23

.. literalinclude:: ../../../desktop/src/renderer/src/components/mapPanes.ts
   :language: typescript
   :lines: 22-23
   :lineno-match:

.. CG-EXPLANATION-START id=const:TOOLTIP_PANE_Z

**What this does.** z = 650, Leaflet's own tooltip pane for marker hover tooltips.

**Why it is here.** Always above the section line, so a hover box is never hidden behind it.

.. CG-EXPLANATION-END id=const:TOOLTIP_PANE_Z

``const MARKER_TOOLTIPS_PANE_Z``
--------------------------------

.. CG-BLOCK id=const:MARKER_TOOLTIPS_PANE_Z lines=24-25

.. literalinclude:: ../../../desktop/src/renderer/src/components/mapPanes.ts
   :language: typescript
   :lines: 24-25
   :lineno-match:

.. CG-EXPLANATION-START id=const:MARKER_TOOLTIPS_PANE_Z

**What this does.** z = 660, for the single shared hover tooltip the map creates.

**Why it is here.** Above the section line and the markers so the shared tooltip always shows on top.

.. CG-EXPLANATION-END id=const:MARKER_TOOLTIPS_PANE_Z

``const DRAW_OVERLAY_PANE_Z``
-----------------------------

.. CG-BLOCK id=const:DRAW_OVERLAY_PANE_Z lines=26-26

.. literalinclude:: ../../../desktop/src/renderer/src/components/mapPanes.ts
   :language: typescript
   :lines: 26-26
   :lineno-match:

.. CG-EXPLANATION-START id=const:DRAW_OVERLAY_PANE_Z

**What this does.** z = 665, for the box-draw and section-line draw overlay.

**Why it is here.** Above everything else interactive, so the rectangle being drawn is never hidden behind another layer.

.. CG-EXPLANATION-END id=const:DRAW_OVERLAY_PANE_Z

