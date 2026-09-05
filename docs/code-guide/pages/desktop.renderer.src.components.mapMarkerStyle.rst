desktop.renderer.src.components.mapMarkerStyle
==============================================

.. CG-PAGE source=desktop/src/renderer/src/components/mapMarkerStyle.ts complete=true

*Source file:* ``desktop/src/renderer/src/components/mapMarkerStyle.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-9

.. literalinclude:: ../../../desktop/src/renderer/src/components/mapMarkerStyle.ts
   :language: typescript
   :lines: 1-9
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The file's opening comment. It declares this module as a set of pure marker-draw helpers for the map — the hover/selection ring decision and the tooltip content — and it has no imports.

**Why it is here.** A *pure function* is one whose output depends only on its inputs, with no side effects, so it is safe to test on its own. These helpers are pulled out of the map so the ring rule and the tooltip text can be tested without mounting a live Leaflet map, and so the marker-drawing code stays small enough to use one shared tooltip (M7a).

.. CG-EXPLANATION-END id=module-header

``const RADIUS``
----------------

.. CG-BLOCK id=const:RADIUS lines=10-11

.. literalinclude:: ../../../desktop/src/renderer/src/components/mapMarkerStyle.ts
   :language: typescript
   :lines: 10-11
   :lineno-match:

.. CG-EXPLANATION-START id=const:RADIUS

**What this does.** The default CPT dot radius, 4 pixels.

**Why it is here.** The plain marker size, kept here as the single source shared with the square-icon sizing over on the ``desktop.renderer.src.components.MapView`` page.

.. CG-EXPLANATION-END id=const:RADIUS

``const RADIUS_SELECTED``
-------------------------

.. CG-BLOCK id=const:RADIUS_SELECTED lines=12-14

.. literalinclude:: ../../../desktop/src/renderer/src/components/mapMarkerStyle.ts
   :language: typescript
   :lines: 12-14
   :lineno-match:

.. CG-EXPLANATION-START id=const:RADIUS_SELECTED

**What this does.** The enlarged radius, 7 pixels, for a marker that is selected or hovered.

**Why it is here.** The emphasis size so a picked or pointed-at marker reads at a glance on a busy map.

.. CG-EXPLANATION-END id=const:RADIUS_SELECTED

``interface MarkerRingState``
-----------------------------

.. CG-BLOCK id=interface:MarkerRingState lines=15-24

.. literalinclude:: ../../../desktop/src/renderer/src/components/mapMarkerStyle.ts
   :language: typescript
   :lines: 15-24
   :lineno-match:

.. CG-EXPLANATION-START id=interface:MarkerRingState

**What this does.** The shape describing a marker's visual state: ``selected`` (the single primary pick), ``ringed`` (a marquee pick or a list-row hover), and ``enlarged`` (selected or hovered).

**Why it is here.** Names the three flags the ring rule reads, so the decision is written down in one place instead of scattered per marker.

.. CG-EXPLANATION-END id=interface:MarkerRingState

``interface MarkerRingStyle``
-----------------------------

.. CG-BLOCK id=interface:MarkerRingStyle lines=25-47

.. literalinclude:: ../../../desktop/src/renderer/src/components/mapMarkerStyle.ts
   :language: typescript
   :lines: 25-47
   :lineno-match:

.. CG-EXPLANATION-START id=interface:MarkerRingStyle

**What this does.** The path style a circle marker needs back — a radius, a stroke colour and a stroke weight — followed by the documentation for the ``markerRingStyle`` function below.

**Why it is here.** Names the return shape and records the rule in the doc: enlarged uses the bigger radius; selected is dark blue, ringed is blue, otherwise neutral; selected or ringed thickens the stroke.

.. CG-EXPLANATION-END id=interface:MarkerRingStyle

``function markerRingStyle``
----------------------------

.. CG-BLOCK id=function:markerRingStyle lines=48-56

.. literalinclude:: ../../../desktop/src/renderer/src/components/mapMarkerStyle.ts
   :language: typescript
   :lines: 48-56
   :lineno-match:

.. CG-EXPLANATION-START id=function:markerRingStyle

**What this does.** Turns a marker's state into its ring style — enlarged picks the bigger radius; selected gives a dark-blue stroke, ringed a blue stroke, otherwise a neutral one; selected or ringed thickens the line. It also opens the comment for the tooltip lines below.

**Why it is here.** A single, tested source for the ring rule, so 'the hover ring still works' is one decision rather than three colour/size choices repeated at every marker (docstring). It is a pure function.

.. CG-EXPLANATION-END id=function:markerRingStyle

``interface TooltipLines``
--------------------------

.. CG-BLOCK id=interface:TooltipLines lines=57-62

.. literalinclude:: ../../../desktop/src/renderer/src/components/mapMarkerStyle.ts
   :language: typescript
   :lines: 57-62
   :lineno-match:

.. CG-EXPLANATION-START id=interface:TooltipLines

**What this does.** The shape of a marker tooltip's two lines — a bold ``title`` and a muted ``subtitle`` — plus the doc for ``formatDepth`` below.

**Why it is here.** The small record every marker tooltip is built from, shared by the CPT and borehole builders.

.. CG-EXPLANATION-END id=interface:TooltipLines

``function formatDepth``
------------------------

.. CG-BLOCK id=function:formatDepth lines=63-67

.. literalinclude:: ../../../desktop/src/renderer/src/components/mapMarkerStyle.ts
   :language: typescript
   :lines: 63-67
   :lineno-match:

.. CG-EXPLANATION-START id=function:formatDepth

**What this does.** Formats a depth as one decimal place plus ``m``, or an em dash when the depth is missing. It also opens the comment for the CPT tooltip builder below.

**Why it is here.** One depth-formatting helper reused by both tooltip builders so the subtitles read identically.

.. CG-EXPLANATION-END id=function:formatDepth

``function cptTooltipLines``
----------------------------

.. CG-BLOCK id=function:cptTooltipLines lines=68-76

.. literalinclude:: ../../../desktop/src/renderer/src/components/mapMarkerStyle.ts
   :language: typescript
   :lines: 68-76
   :lineno-match:

.. CG-EXPLANATION-START id=function:cptTooltipLines

**What this does.** Builds the two tooltip lines for a CPT marker: the name as the title, and ``type · depth`` as the subtitle.

**Why it is here.** The CPT tooltip content as a pure helper, testable without the map.

.. CG-EXPLANATION-END id=function:cptTooltipLines

``function boreholeTooltipLines``
---------------------------------

.. CG-BLOCK id=function:boreholeTooltipLines lines=77-105

.. literalinclude:: ../../../desktop/src/renderer/src/components/mapMarkerStyle.ts
   :language: typescript
   :lines: 77-105
   :lineno-match:

.. CG-EXPLANATION-START id=function:boreholeTooltipLines

**What this does.** Builds the two tooltip lines for a borehole marker: the name as the title, and ``drill method · depth`` as the subtitle (a dash when the method is missing). It also opens the doc for ``markerTooltipElement`` below.

**Why it is here.** The borehole tooltip content, for the same pure-helper reason as ``cptTooltipLines``.

.. CG-EXPLANATION-END id=function:boreholeTooltipLines

``function markerTooltipElement``
---------------------------------

.. CG-BLOCK id=function:markerTooltipElement lines=106-116

.. literalinclude:: ../../../desktop/src/renderer/src/components/mapMarkerStyle.ts
   :language: typescript
   :lines: 106-116
   :lineno-match:

.. CG-EXPLANATION-START id=function:markerTooltipElement

**What this does.** Builds the tooltip's on-screen element — a ``<div>`` holding the bold title and, when there is one, the subtitle on a second line.

**Why it is here.** It returns a built DOM element rather than an HTML string, so a marker name from a GEF or DOV file that contains ``<`` or ``&`` is inserted as plain text and never parsed as markup (docstring) — a deliberate guard against a name that would otherwise be read as HTML.

.. CG-EXPLANATION-END id=function:markerTooltipElement

