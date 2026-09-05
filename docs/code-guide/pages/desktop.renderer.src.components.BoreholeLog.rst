desktop.renderer.src.components.BoreholeLog
===========================================

.. CG-PAGE source=desktop/src/renderer/src/components/BoreholeLog.tsx complete=true

*Source file:* ``desktop/src/renderer/src/components/BoreholeLog.tsx``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-76

.. literalinclude:: ../../../desktop/src/renderer/src/components/BoreholeLog.tsx
   :language: tsx
   :lines: 1-76
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The imports and the module comment. It brings in the React hooks, ``createPortal``, the toolbar icons, the API-client types, the label-wrapping helpers, the soil-hatch patterns, the contact-overlay type, the DOV catalogue hook, a keyboard helper, the translation helper, the lab-test panel, the hidden-tracks hook, the borelog layout constants, the layout helpers and the pixels-per-metre context, and the many track sub-components (the header, drill-method, field-log, groundwater, legend, mTAW axis, observation, samples, selected-sample and track-header pieces). The comment describes a full-feature borehole log modelled on DOV's public 'Rapport BoorProfiel': an HTML header strip, one big SVG canvas of vertical tracks, an HTML legend, and a lab-test slide-in.

**Why it is here.** The whole borehole is drawn as one SVG element so the soil-hatch patterns, the click-targets and the groundwater line all share a single coordinate space, and the layout is computed once by ``computeLayout`` so the track x-offsets stay aligned (comment). It is modelled on DOV's report so engineers used to the public viewer read it at once, it draws with SVG (vector) for the same reasons as the CptChart, and its data arrive through the API-client types.

.. CG-EXPLANATION-END id=module-header

``interface Props``
-------------------

.. CG-BLOCK id=interface:Props lines=77-115

.. literalinclude:: ../../../desktop/src/renderer/src/components/BoreholeLog.tsx
   :language: tsx
   :lines: 77-115
   :lineno-match:

.. CG-EXPLANATION-START id=interface:Props

**What this does.** The inputs: the borehole detail; an optional ``onElevationChange`` save handler; the DOV Virtuele Boring overlay inputs (the prediction, the active models, a max depth, whether it is shown, a toggle handler, a per-pane model override with its change handler, and a loading flag); and the ``contactOverlays`` list. It also opens the comment for the DOV column-width constant below.

**Why it is here.** The same props pattern as the ``desktop.renderer.src.components.CptChart`` page — the handlers are optional so read-only and test call sites can mount the log without wiring an API path. Elevation edits go through the shared elevation editor, so the frontend still goes through the API. The contact overlays are painted last so the faint formation and litho contact lines sit on top of the soil patterns without obscuring them (comment), and they are informative-only.

.. CG-EXPLANATION-END id=interface:Props

``const VB_COLUMN_WIDTH``
-------------------------

.. CG-BLOCK id=const:VB_COLUMN_WIDTH lines=116-116

.. literalinclude:: ../../../desktop/src/renderer/src/components/BoreholeLog.tsx
   :language: tsx
   :lines: 116-116
   :lineno-match:

.. CG-EXPLANATION-START id=const:VB_COLUMN_WIDTH

**What this does.** The width of one DOV ghost column inside the log, 50 pixels.

**Why it is here.** Uses the same vocabulary as the section view and the CPT depth column so the DOV rail looks consistent across all three (comment).

.. CG-EXPLANATION-END id=const:VB_COLUMN_WIDTH

``const VB_COLUMN_GAP``
-----------------------

.. CG-BLOCK id=const:VB_COLUMN_GAP lines=117-117

.. literalinclude:: ../../../desktop/src/renderer/src/components/BoreholeLog.tsx
   :language: tsx
   :lines: 117-117
   :lineno-match:

.. CG-EXPLANATION-START id=const:VB_COLUMN_GAP

**What this does.** The 4-pixel gap between adjacent DOV ghost columns.

**Why it is here.** Part of the same DOV-rail layout set as ``VB_COLUMN_WIDTH``.

.. CG-EXPLANATION-END id=const:VB_COLUMN_GAP

``const VB_GAP_FROM_TRACKS``
----------------------------

.. CG-BLOCK id=const:VB_GAP_FROM_TRACKS lines=118-118

.. literalinclude:: ../../../desktop/src/renderer/src/components/BoreholeLog.tsx
   :language: tsx
   :lines: 118-118
   :lineno-match:

.. CG-EXPLANATION-START id=const:VB_GAP_FROM_TRACKS

**What this does.** The 8-pixel gap between the data tracks and the DOV rail.

**Why it is here.** Part of the same DOV-rail layout set as ``VB_COLUMN_WIDTH``.

.. CG-EXPLANATION-END id=const:VB_GAP_FROM_TRACKS

``const VB_LABEL_FONT_SIZE``
----------------------------

.. CG-BLOCK id=const:VB_LABEL_FONT_SIZE lines=119-120

.. literalinclude:: ../../../desktop/src/renderer/src/components/BoreholeLog.tsx
   :language: tsx
   :lines: 119-120
   :lineno-match:

.. CG-EXPLANATION-START id=const:VB_LABEL_FONT_SIZE

**What this does.** The 9-pixel label font used in the DOV rail.

**Why it is here.** Part of the same DOV-rail layout set, kept beside the other three.

.. CG-EXPLANATION-END id=const:VB_LABEL_FONT_SIZE

``function BoreholeLog``
------------------------

.. CG-BLOCK id=function:BoreholeLog lines=121-766

.. literalinclude:: ../../../desktop/src/renderer/src/components/BoreholeLog.tsx
   :language: tsx
   :lines: 121-766
   :lineno-match:

.. CG-EXPLANATION-START id=function:BoreholeLog

**What this does.** The component. It reads translation and the DOV catalogue, and holds the selected-sample id, the vertical zoom factor (shared through the pixels-per-metre context), the hidden-tracks set (saved to localStorage), and the columns-dropdown open state and position. It works out which tracks this borehole actually has and how many are hidden, guards against hiding every track, and closes the dropdown on an outside click. It returns the toolbar (zoom buttons, a portalled Columns dropdown, the DOV toggle and model picker), then one big SVG holding the mTAW axis, one track per observation stream, the drill-method / field-log / samples tracks, the groundwater line, the contact overlays and the optional DOV rail — followed by the HTML legend and, when a sample is clicked, the lab-test slide-in panel.

**Why it is here.** The zoom factor is broadcast through a *context* so deeply-nested track components need not have it passed down by hand (comment). The hidden-tracks set is kept in ``localStorage`` because it is a screen preference, not a project decision, and it is deliberately global so a column choice survives across projects. The can't-hide-all guard is computed against the state updater's own previous set, not the render-frame snapshot, because batched updates can move past the snapshot and let the guard be bypassed (comment). The Columns menu is drawn with a *portal* — React drawing into a different part of the page, here the document body — so it escapes any ``overflow:hidden`` ancestor in the toolbar (comment). The comment also records that the dropdown is the canonical keyboard-operable control, so the SVG track headers are not added to the tab order. The contact overlays are painted last, and elevation edits go through the API.

.. CG-EXPLANATION-END id=function:BoreholeLog

``function VirtueleBoringBorelogRail``
--------------------------------------

.. CG-BLOCK id=function:VirtueleBoringBorelogRail lines=767-830

.. literalinclude:: ../../../desktop/src/renderer/src/components/BoreholeLog.tsx
   :language: tsx
   :lines: 767-830
   :lineno-match:

.. CG-EXPLANATION-START id=function:VirtueleBoringBorelogRail

**What this does.** Draws the informative DOV overlay inside the borelog SVG — one column per active model, each labelled with its model code and filled with that model's predicted layers; when there is no prediction or no surface elevation it draws a small 'no data' note instead.

**Why it is here.** It is rendered inside the same SVG as the tracks so it scrolls with them (comment), and it is informative-only. It needs the surface elevation to place the layers, so without it the rail degrades to the note rather than drawing wrongly.

.. CG-EXPLANATION-END id=function:VirtueleBoringBorelogRail

``function BorelogRailLayer``
-----------------------------

.. CG-BLOCK id=function:BorelogRailLayer lines=831-911

.. literalinclude:: ../../../desktop/src/renderer/src/components/BoreholeLog.tsx
   :language: tsx
   :lines: 831-911
   :lineno-match:

.. CG-EXPLANATION-START id=function:BorelogRailLayer

**What this does.** Draws one predicted DOV layer as a filled rectangle with a wrapped label and a hover tooltip. It converts the layer's top and base from mTAW to depth below the surface, clips them to the prediction's max depth and to the borehole's total depth, skips any layer that falls outside the log or is too thin to see, and wraps the label to as many lines as fit the rectangle.

**Why it is here.** The layer positions are stored in mTAW (absolute level) and converted to depth-below-surface using the surface elevation before drawing, then clipped so a much-deeper DOV layer never paints below the real lithology tracks (comment). The label wrapping keeps the text inside the narrow column.

.. CG-EXPLANATION-END id=function:BorelogRailLayer

