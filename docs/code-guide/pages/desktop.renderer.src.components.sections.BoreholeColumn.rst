desktop.renderer.src.components.sections.BoreholeColumn
=======================================================

.. CG-PAGE source=desktop/src/renderer/src/components/sections/BoreholeColumn.tsx complete=true

*Source file:* ``desktop/src/renderer/src/components/sections/BoreholeColumn.tsx``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-54

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/BoreholeColumn.tsx
   :language: tsx
   :lines: 1-54
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The top of the file that draws a borehole's logged soil as one or more vertical strips inside its column on the cross-section — one strip per interpretation stream the engineer has switched on (coded lithology, geotechnical coding, formal or Quaternary stratigraphy). The comment describes the layout and the imports pull in the data types, a click-timing helper, the soil-pattern lookup, the channel definitions, the floating readout card, and shared geometry helpers.

**Why it is here.** This mirrors the DOV 'lengteprofiel' report layout, where a borehole reads as side-by-side strips, so an engineer reading the section interprets it the same way they read the official report. The band auto-widens with the number of switched-on streams so neighbouring tests get pushed aside proportionally.

.. CG-EXPLANATION-END id=module-header

``const LITHOLOGY_OBS_TYPES``
-----------------------------

.. CG-BLOCK id=const:LITHOLOGY_OBS_TYPES lines=55-55

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/BoreholeColumn.tsx
   :language: tsx
   :lines: 55-55
   :lineno-match:

.. CG-EXPLANATION-START id=const:LITHOLOGY_OBS_TYPES

**What this does.** A constant naming the two observation kinds — coded lithology and geotechnical coding — that are drawn with patterned, coloured soil fills.

**Why it is here.** These streams carry soil codes, so the standard soil pattern (dots for sand, hatching for clay, and so on) can be painted; the split mirrors the same rule ``BoreholeLog`` uses in the detail panel.

.. CG-EXPLANATION-END id=const:LITHOLOGY_OBS_TYPES

``const CARD_STYLE_OBS_TYPES``
------------------------------

.. CG-BLOCK id=const:CARD_STYLE_OBS_TYPES lines=56-61

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/BoreholeColumn.tsx
   :language: tsx
   :lines: 56-61
   :lineno-match:

.. CG-EXPLANATION-START id=const:CARD_STYLE_OBS_TYPES

**What this does.** A constant naming the observation kinds — lithological description and the stratigraphy streams — that are drawn instead as plain labelled cards rather than patterned soil.

**Why it is here.** These streams carry no soil codes, so a pattern fill would be a blank stroke; a soft off-white card with the formation name or description written in it is the honest presentation.

.. CG-EXPLANATION-END id=const:CARD_STYLE_OBS_TYPES

``const CARD_FILL``
-------------------

.. CG-BLOCK id=const:CARD_FILL lines=62-63

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/BoreholeColumn.tsx
   :language: tsx
   :lines: 62-63
   :lineno-match:

.. CG-EXPLANATION-START id=const:CARD_FILL

**What this does.** A single colour value — slate-50, a near-white — used as the background of the card-style strips.

**Why it is here.** It matches the stratigraphy background in ``BoreholeLog`` so the card strips read consistently between the section view and the detail panel.

.. CG-EXPLANATION-END id=const:CARD_FILL

``interface Props``
-------------------

.. CG-BLOCK id=interface:Props lines=64-135

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/BoreholeColumn.tsx
   :language: tsx
   :lines: 64-135
   :lineno-match:

.. CG-EXPLANATION-START id=interface:Props

**What this does.** The shape of everything this component is handed: the borehole detail, which streams are on, the column's screen position and strip width, the surface elevation, the plot bounds, the elevation-to-screen converter, and a set of optional behaviours — commit a picked depth, snap to a stratigraphy boundary, dim the log under an overlaying band, show a hover readout, and forward a double-click to open detail.

**Why it is here.** The many optional fields let one component serve several situations. The docstrings record why: the click-to-place path drives a contact's provenance (a snapped depth is high-confidence, debt #22/#23); the reduced fill opacity stops the driller's log from making an overlaying interpretation band look like it stops at the borehole; and the double-click passthrough is needed because the pick overlay is a sibling of the column glyph, not a child, so the glyph never sees the double-click on its own.

.. CG-EXPLANATION-END id=interface:Props

``function BoreholeColumn``
---------------------------

.. CG-BLOCK id=function:BoreholeColumn lines=136-422

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/BoreholeColumn.tsx
   :language: tsx
   :lines: 136-422
   :lineno-match:

.. CG-EXPLANATION-START id=function:BoreholeColumn

**What this does.** The component itself. It remembers the cursor's Y position while hovering, walks the switched-on streams in fixed order picking up each one's matching observation, then computes the band's screen geometry (surface at top, total depth at the bottom, clamped to the visible area). It handles clicks (place a formation contact at the clicked depth, snapping to a nearby stratigraphy boundary when asked), double-clicks (open the detail panel), and hover (a ghost line plus a small depth and elevation readout). Finally it draws each stream's layers as patterned or card-style rectangles.

**Why it is here.** The single-versus-double-click gate and the hover-state hook are declared before any early exit on purpose: React requires the same hooks to run in the same order every render, and moving them below an exit would crash the first frame a borehole gains its first stream (the Temporal-Dead-Zone rule in CLAUDE.md). Empty strips still reserve their slot so one stream reads vertically straight across the whole section even where a borehole lacks it. Clicking while Shift is held bails so the section-wide box-select can take the gesture instead.

.. CG-EXPLANATION-END id=function:BoreholeColumn

