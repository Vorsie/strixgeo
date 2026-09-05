desktop.renderer.src.components.SectionOverlays
===============================================

.. CG-PAGE source=desktop/src/renderer/src/components/SectionOverlays.tsx complete=true

*Source file:* ``desktop/src/renderer/src/components/SectionOverlays.tsx``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-40

.. literalinclude:: ../../../desktop/src/renderer/src/components/SectionOverlays.tsx
   :language: tsx
   :lines: 1-40
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The file's docstring and imports. The docstring explains that this draws each project cross-section on the map as a line plus a translucent buffer-corridor polygon, with selection and hover living on a fat transparent hit-band along the section line. The imports bring in ``Fragment`` and ``useMemo``, Leaflet, the pane z-order constants, the Leaflet parts (Pane, Polygon, Polyline, Tooltip), the API-client types, the WGS84 projection helper, and two section-projection helpers.

**Why it is here.** The buffer fill is deliberately made non-interactive so it never swallows a click meant for an overlay crossing it — such as a tie-section ghost — and the click target is the line's hit-band instead (dogfeed 2026-06-10). The corridor echoes DOV's green 'lengteprofiel' so engineers used to the public viewer read it at once. The corridor corners are computed by offsetting the endpoints perpendicular to the line by ±B metres in the section's own metric CRS and only then projecting to WGS84 for Leaflet — that coordinate choice is what makes the corridor a true buffer (docstring, and the same projection concept introduced on the ``desktop.renderer.src.components.MapView`` page).

.. CG-EXPLANATION-END id=module-header

``interface Props``
-------------------

.. CG-BLOCK id=interface:Props lines=41-55

.. literalinclude:: ../../../desktop/src/renderer/src/components/SectionOverlays.tsx
   :language: tsx
   :lines: 41-55
   :lineno-match:

.. CG-EXPLANATION-START id=interface:Props

**What this does.** The inputs: the list of sections, the selected section id, an ``onSelect`` handler, and optional CPT and borehole lists. It also opens the comment for the ``MAX_OVERLAYS`` cap below.

**Why it is here.** The same props pattern as the ``desktop.renderer.src.components.CptChart`` page. The optional investigation lists, when supplied together with a selected section, drive the thin grey leader lines from each in-corridor investigation's true position to its projection foot on the section line — making the projection's truth-loss visible on the map (comment).

.. CG-EXPLANATION-END id=interface:Props

``const MAX_OVERLAYS``
----------------------

.. CG-BLOCK id=const:MAX_OVERLAYS lines=56-63

.. literalinclude:: ../../../desktop/src/renderer/src/components/SectionOverlays.tsx
   :language: tsx
   :lines: 56-63
   :lineno-match:

.. CG-EXPLANATION-START id=const:MAX_OVERLAYS

**What this does.** Caps rendering at 200 sections in one pass. It also opens the comment for the section-overlay pane below.

**Why it is here.** Projects with hundreds of sections are not realistic for v1, and each SVG layer Leaflet renders is not free (comment).

.. CG-EXPLANATION-END id=const:MAX_OVERLAYS

``const SECTION_PANE``
----------------------

.. CG-BLOCK id=const:SECTION_PANE lines=64-68

.. literalinclude:: ../../../desktop/src/renderer/src/components/SectionOverlays.tsx
   :language: tsx
   :lines: 64-68
   :lineno-match:

.. CG-EXPLANATION-START id=const:SECTION_PANE

**What this does.** Names the drawing layer the section line and corridor sit in. It also opens the comment for the leader-line pane below.

**Why it is here.** That pane sits above the basemap and DEM overlay panes so the section line and corridor always show over them, and below the marker and tooltip panes so marker clicks and hover tooltips still win (comment; the numbers live on the ``desktop.renderer.src.components.mapPanes`` page).

.. CG-EXPLANATION-END id=const:SECTION_PANE

``const LEADER_PANE``
---------------------

.. CG-BLOCK id=const:LEADER_PANE lines=69-70

.. literalinclude:: ../../../desktop/src/renderer/src/components/SectionOverlays.tsx
   :language: tsx
   :lines: 69-70
   :lineno-match:

.. CG-EXPLANATION-START id=const:LEADER_PANE

**What this does.** Names the drawing layer the leader lines sit in.

**Why it is here.** It sits below the section-overlay pane so a leader never draws over, or steals a click from, the section line itself (comment).

.. CG-EXPLANATION-END id=const:LEADER_PANE

``function SectionOverlays``
----------------------------

.. CG-BLOCK id=function:SectionOverlays lines=71-226

.. literalinclude:: ../../../desktop/src/renderer/src/components/SectionOverlays.tsx
   :language: tsx
   :lines: 71-226
   :lineno-match:

.. CG-EXPLANATION-START id=function:SectionOverlays

**What this does.** The component. It makes an SVG renderer pinned to the section pane, builds one overlay record per section (capped, skipping any it cannot project), and builds leader segments for the selected section only. It then returns the two custom panes, the leader polylines, and — for each section — a stack of layers: the buffer corridor as two polygons (a white casing under a navy accent), the section line as two polylines (white casing under a navy or bright-blue accent), and one fat, almost-invisible hit-band polyline that carries the click handler and the hover tooltip (name, length, buffer width).

**Why it is here.** The section vectors are drawn as SVG (vector) paths rather than on the marker canvas because a canvas takes clicks across its whole area, so a section line drawn on it was unclickable; an SVG stroke takes the click only where it is painted (owner ruling 2026-09-04). The hit-band uses opacity 0.01, not 0, because an SVG stroke receives a click only when it is actually painted, so a fully transparent band would not be clickable (comment). Leaders are limited to the selected section so the map does not clutter, and the corridor is non-interactive so it never swallows clicks meant for crossing overlays. ``useMemo`` caches the built items and leaders so they are recomputed only when the sections or the selection change.

.. CG-EXPLANATION-END id=function:SectionOverlays

``interface OverlayItem``
-------------------------

.. CG-BLOCK id=interface:OverlayItem lines=227-245

.. literalinclude:: ../../../desktop/src/renderer/src/components/SectionOverlays.tsx
   :language: tsx
   :lines: 227-245
   :lineno-match:

.. CG-EXPLANATION-START id=interface:OverlayItem

**What this does.** The shape of one built section overlay — id, name, length in metres, buffer half-width, the section line's two WGS84 points, and the four buffer-corner WGS84 points.

**Why it is here.** Names the finished record the render loop draws; the length and buffer width are carried through so the tooltip can help the user tell several sections apart (comment).

.. CG-EXPLANATION-END id=interface:OverlayItem

``function buildOverlay``
-------------------------

.. CG-BLOCK id=function:buildOverlay lines=246-294

.. literalinclude:: ../../../desktop/src/renderer/src/components/SectionOverlays.tsx
   :language: tsx
   :lines: 246-294
   :lineno-match:

.. CG-EXPLANATION-START id=function:buildOverlay

**What this does.** Computes one section's geometry: the direction and length between its endpoints, the perpendicular unit vector, then the four buffer corners offset ±B metres and walked start-left → end-left → end-right → start-right so the polygon does not self-intersect; it projects all four corners and both endpoints to WGS84 and returns the record, or null for a zero-length section or an unsupported CRS.

**Why it is here.** The corners are offset perpendicular in the section's own metric CRS and projected to WGS84 only afterwards, so the drawn corridor is a true ±B-metre band (docstring). It returns null instead of crashing the whole map when the section's EPSG is unsupported — the section panel still works without WGS84.

.. CG-EXPLANATION-END id=function:buildOverlay

``interface LeaderSegment``
---------------------------

.. CG-BLOCK id=interface:LeaderSegment lines=295-306

.. literalinclude:: ../../../desktop/src/renderer/src/components/SectionOverlays.tsx
   :language: tsx
   :lines: 295-306
   :lineno-match:

.. CG-EXPLANATION-START id=interface:LeaderSegment

**What this does.** The shape of one leader line — an id plus its from-point and to-point in WGS84.

**Why it is here.** The investigation id alone is a sufficient React key because at most one leader exists per investigation per render (comment).

.. CG-EXPLANATION-END id=interface:LeaderSegment

``function buildLeaders``
-------------------------

.. CG-BLOCK id=function:buildLeaders lines=307-340

.. literalinclude:: ../../../desktop/src/renderer/src/components/SectionOverlays.tsx
   :language: tsx
   :lines: 307-340
   :lineno-match:

.. CG-EXPLANATION-START id=function:buildLeaders

**What this does.** Builds the leader segments for a section's in-corridor investigations: it drops the section's excluded ids, finds each remaining investigation's projection along the line, and for each makes a segment from its true position to its foot on the line; it returns an empty list on an unsupported CRS or a zero-length section.

**Why it is here.** The leaders draw the projection's truth-loss — the gap between where an investigation really sits and where it lands on the section — as a faint dashed line, shown only for the selected section so the map stays readable.

.. CG-EXPLANATION-END id=function:buildLeaders

