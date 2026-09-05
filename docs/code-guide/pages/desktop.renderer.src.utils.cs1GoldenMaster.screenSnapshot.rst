desktop.renderer.src.utils.cs1GoldenMaster.screenSnapshot
=========================================================

.. CG-PAGE source=desktop/src/renderer/src/utils/cs1GoldenMaster/screenSnapshot.tsx complete=true

*Source file:* ``desktop/src/renderer/src/utils/cs1GoldenMaster/screenSnapshot.tsx``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-35

.. literalinclude:: ../../../desktop/src/renderer/src/utils/cs1GoldenMaster/screenSnapshot.tsx
   :language: tsx
   :lines: 1-35
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Opens the second half of the golden master: what actually reaches the SCREEN. It renders the real section-fill overlay for CS1 on the geotech axis into a headless browser (jsdom, an in-memory browser page with no window) and freezes every painted SVG element — the dissolved fill groups with their colour and opacity, the self-colour seam strokes, the litho outline paths, the litho fallback fills and the un-banded hatch.

**Why it is here.** Owner 2026-08-23, quoted: "not only what is in DB also what is rendered on screen". The docstring gives the evidence: on 2026-08-22 the engine output was byte-identical from session start to end while three separate render layers changed what the user saw, so an engine-only snapshot would have called that night a no-op. The projection is fixed here so the snapshot is a statement about the render's geometry, not about a window size.

.. CG-EXPLANATION-END id=module-header

``const PLOT``
--------------

.. CG-BLOCK id=const:PLOT lines=36-37

.. literalinclude:: ../../../desktop/src/renderer/src/utils/cs1GoldenMaster/screenSnapshot.tsx
   :language: tsx
   :lines: 36-37
   :lineno-match:

.. CG-EXPLANATION-START id=const:PLOT

**What this does.** The fixed drawing rectangle (top, bottom, left, right in pixels) the snapshot renders into.

**Why it is here.** A fixed rectangle, rather than the app's live viewport, keeps the frozen picture a statement about geometry rather than about whatever size the window happened to be.

.. CG-EXPLANATION-END id=const:PLOT

``const PX_PER_M``
------------------

.. CG-BLOCK id=const:PX_PER_M lines=38-38

.. literalinclude:: ../../../desktop/src/renderer/src/utils/cs1GoldenMaster/screenSnapshot.tsx
   :language: tsx
   :lines: 38-38
   :lineno-match:

.. CG-EXPLANATION-START id=const:PX_PER_M

**What this does.** How many screen pixels represent one metre of elevation (twenty).

**Why it is here.** It fixes the vertical scale so the frozen coordinates are reproducible.

.. CG-EXPLANATION-END id=const:PX_PER_M

``const TOP_ELEV_M``
--------------------

.. CG-BLOCK id=const:TOP_ELEV_M lines=39-40

.. literalinclude:: ../../../desktop/src/renderer/src/utils/cs1GoldenMaster/screenSnapshot.tsx
   :language: tsx
   :lines: 39-40
   :lineno-match:

.. CG-EXPLANATION-START id=const:TOP_ELEV_M

**What this does.** The elevation in metres that sits at the top of the drawing rectangle (fifteen).

**Why it is here.** It fixes where the elevation axis starts, so a level converts to the same pixel every run.

.. CG-EXPLANATION-END id=const:TOP_ELEV_M

``const PX_PER_ALONG``
----------------------

.. CG-BLOCK id=const:PX_PER_ALONG lines=41-42

.. literalinclude:: ../../../desktop/src/renderer/src/utils/cs1GoldenMaster/screenSnapshot.tsx
   :language: tsx
   :lines: 41-42
   :lineno-match:

.. CG-EXPLANATION-START id=const:PX_PER_ALONG

**What this does.** How many screen pixels represent one along-section metre (1.2).

**Why it is here.** It fixes the horizontal scale, the companion of the vertical one, so the whole projection is reproducible.

.. CG-EXPLANATION-END id=const:PX_PER_ALONG

``const levelToScreen``
-----------------------

.. CG-BLOCK id=const:levelToScreen lines=43-43

.. literalinclude:: ../../../desktop/src/renderer/src/utils/cs1GoldenMaster/screenSnapshot.tsx
   :language: tsx
   :lines: 43-43
   :lineno-match:

.. CG-EXPLANATION-START id=const:levelToScreen

**What this does.** Converts an elevation in metres to a vertical screen pixel using the fixed top elevation and vertical scale.

**Why it is here.** The overlay needs a level-to-pixel function; fixing it here pins the render geometry.

.. CG-EXPLANATION-END id=const:levelToScreen

``const screenToLevel``
-----------------------

.. CG-BLOCK id=const:screenToLevel lines=44-44

.. literalinclude:: ../../../desktop/src/renderer/src/utils/cs1GoldenMaster/screenSnapshot.tsx
   :language: tsx
   :lines: 44-44
   :lineno-match:

.. CG-EXPLANATION-START id=const:screenToLevel

**What this does.** The inverse of ``levelToScreen``: converts a vertical pixel back to an elevation in metres.

**Why it is here.** The overlay needs the inverse to interpret pointer positions; it is frozen for the same reproducibility reason.

.. CG-EXPLANATION-END id=const:screenToLevel

``const alongToScreenX``
------------------------

.. CG-BLOCK id=const:alongToScreenX lines=45-45

.. literalinclude:: ../../../desktop/src/renderer/src/utils/cs1GoldenMaster/screenSnapshot.tsx
   :language: tsx
   :lines: 45-45
   :lineno-match:

.. CG-EXPLANATION-START id=const:alongToScreenX

**What this does.** Converts an along-section metre position to a horizontal screen pixel using the fixed horizontal scale.

**Why it is here.** It is the horizontal companion of ``levelToScreen`` in the fixed projection.

.. CG-EXPLANATION-END id=const:alongToScreenX

``const screenXToAlong``
------------------------

.. CG-BLOCK id=const:screenXToAlong lines=46-48

.. literalinclude:: ../../../desktop/src/renderer/src/utils/cs1GoldenMaster/screenSnapshot.tsx
   :language: tsx
   :lines: 46-48
   :lineno-match:

.. CG-EXPLANATION-START id=const:screenXToAlong

**What this does.** The inverse of ``alongToScreenX``: converts a horizontal pixel back to an along-section metre.

**Why it is here.** The overlay needs the inverse for pointer maths; it is frozen with the rest of the projection.

.. CG-EXPLANATION-END id=const:screenXToAlong

``const round2``
----------------

.. CG-BLOCK id=const:round2 lines=49-50

.. literalinclude:: ../../../desktop/src/renderer/src/utils/cs1GoldenMaster/screenSnapshot.tsx
   :language: tsx
   :lines: 49-50
   :lineno-match:

.. CG-EXPLANATION-START id=const:round2

**What this does.** Rounds a number to two decimal places.

**Why it is here.** The docstring notes two decimals match what the component itself emits into an SVG path, so the frozen path data lines up with the real output.

.. CG-EXPLANATION-END id=const:round2

``function toRows``
-------------------

.. CG-BLOCK id=function:toRows lines=51-84

.. literalinclude:: ../../../desktop/src/renderer/src/utils/cs1GoldenMaster/screenSnapshot.tsx
   :language: tsx
   :lines: 51-84
   :lineno-match:

.. CG-EXPLANATION-START id=function:toRows

**What this does.** Turns the scene's columns into the litho-layer database-row shape the overlay expects, giving each unit an accepted status, a manual source, and fixed timestamps.

**Why it is here.** The overlay is written to consume real API row shapes, so the fixture must be dressed up as those rows for the render path to run unchanged — again so the snapshot is of the shipped code.

.. CG-EXPLANATION-END id=function:toRows

``function toEdgeRows``
-----------------------

.. CG-BLOCK id=function:toEdgeRows lines=85-105

.. literalinclude:: ../../../desktop/src/renderer/src/utils/cs1GoldenMaster/screenSnapshot.tsx
   :language: tsx
   :lines: 85-105
   :lineno-match:

.. CG-EXPLANATION-START id=function:toEdgeRows

**What this does.** Turns the scene's correlation edges into the approved correlation-edge database-row shape, defaulting each side to top and marking each user-approved.

**Why it is here.** Like ``toRows``, it presents the fixture edges in the exact shape the overlay reads, so no test-only path is exercised.

.. CG-EXPLANATION-END id=function:toEdgeRows

``const CARD_W``
----------------

.. CG-BLOCK id=const:CARD_W lines=106-106

.. literalinclude:: ../../../desktop/src/renderer/src/utils/cs1GoldenMaster/screenSnapshot.tsx
   :language: tsx
   :lines: 106-106
   :lineno-match:

.. CG-EXPLANATION-START id=const:CARD_W

**What this does.** The width in pixels of a column's card (eighteen).

**Why it is here.** The fill's horizontal extent is measured from card edges, so the card width is needed to place the columns the way the app does.

.. CG-EXPLANATION-END id=const:CARD_W

``const MIN_PITCH``
-------------------

.. CG-BLOCK id=const:MIN_PITCH lines=107-120

.. literalinclude:: ../../../desktop/src/renderer/src/utils/cs1GoldenMaster/screenSnapshot.tsx
   :language: tsx
   :lines: 107-120
   :lineno-match:

.. CG-EXPLANATION-START id=const:MIN_PITCH

**What this does.** The smallest allowed centre-to-centre spacing between two column cards — the card width plus a margin.

**Why it is here.** It is the minimum spacing the collision nudge must keep so that every gap stays wide enough to paint.

.. CG-EXPLANATION-END id=const:MIN_PITCH

``function toPlaced``
---------------------

.. CG-BLOCK id=function:toPlaced lines=121-144

.. literalinclude:: ../../../desktop/src/renderer/src/utils/cs1GoldenMaster/screenSnapshot.tsx
   :language: tsx
   :lines: 121-144
   :lineno-match:

.. CG-EXPLANATION-START id=function:toPlaced

**What this does.** Places the columns the way the app does, WITH the collision nudge: it puts each card at its true along-position but pushes it right if it would come closer than the minimum pitch to the previous one, and records both the nudged and true positions.

**Why it is here.** The docstring records why this matters: the fill's x comes from each card's nudged edges, and the overlay drops any gap under one pixel as degenerate. Real CS1 has columns 0.17 m apart, so placing cards at raw along-position would silently drop about ten of the twenty-three gaps and freeze a picture with holes — a gate blind to a third of the section. The app avoids this with its spacing nudge, so the harness must too.

.. CG-EXPLANATION-END id=function:toPlaced

``interface FrozenElement``
---------------------------

.. CG-BLOCK id=interface:FrozenElement lines=145-171

.. literalinclude:: ../../../desktop/src/renderer/src/utils/cs1GoldenMaster/screenSnapshot.tsx
   :language: tsx
   :lines: 145-171
   :lineno-match:

.. CG-EXPLANATION-START id=interface:FrozenElement

**What this does.** One painted SVG element reduced to what the eye can tell apart: its family (which layer of paint), its fill, stroke, opacity, stroke-opacity and stroke-width, and its path data with every coordinate rounded to two decimals (or, for a paint definition, that definition's own attributes).

**Why it is here.** Freezing exactly the visible attributes means the on-screen half catches a change to colour, opacity or shape that the engine half cannot see, which is the whole reason this half exists.

.. CG-EXPLANATION-END id=interface:FrozenElement

``interface ScreenSnapshot``
----------------------------

.. CG-BLOCK id=interface:ScreenSnapshot lines=172-178

.. literalinclude:: ../../../desktop/src/renderer/src/utils/cs1GoldenMaster/screenSnapshot.tsx
   :language: tsx
   :lines: 172-178
   :lineno-match:

.. CG-EXPLANATION-START id=interface:ScreenSnapshot

**What this does.** The screen half: the list of painted elements, plus the distinct element families in the order they are painted (first painted first).

**Why it is here.** The docstring explains the elements are sorted by content so a reshuffle inside a layer is not a change, but that erases paint ORDER — which is not cosmetic here: the litho outline is drawn deliberately OVER the packing fills (owner ruling 2026-08-13, "litho boundaries persist"), and an audit once moved it beneath with the gate staying green. So the layer sequence is frozen separately to pin exactly that.

.. CG-EXPLANATION-END id=interface:ScreenSnapshot

``function cs1GeotechProps``
----------------------------

.. CG-BLOCK id=function:cs1GeotechProps lines=179-218

.. literalinclude:: ../../../desktop/src/renderer/src/utils/cs1GoldenMaster/screenSnapshot.tsx
   :language: tsx
   :lines: 179-218
   :lineno-match:

.. CG-EXPLANATION-START id=function:cs1GeotechProps

**What this does.** Builds the props (the inputs a React component is given) for the section-fill overlay exactly as the real section panel wires them on the geotech axis: the litho frame with its layers, edges and colour maps; the geotech layers and edges; the placed columns; the NAD-class colours; and the fixed projection functions.

**Why it is here.** It reproduces the real panel's wiring so the render is the shipped one; the docstring notes on the geotech axis every row is coloured by its NAD class, and the litho colour is the stored soil colour, so the frozen picture matches what the engineer sees.

.. CG-EXPLANATION-END id=function:cs1GeotechProps

``const FAMILIES``
------------------

.. CG-BLOCK id=const:FAMILIES lines=219-228

.. literalinclude:: ../../../desktop/src/renderer/src/utils/cs1GoldenMaster/screenSnapshot.tsx
   :language: tsx
   :lines: 219-228
   :lineno-match:

.. CG-EXPLANATION-START id=const:FAMILIES

**What this does.** The list of which element markers carry visible geometry and the short name each is called by in the snapshot — the fill groups, the two seam-stroke kinds, the litho outline, the litho fallback and the un-banded hatch.

**Why it is here.** It is the whitelist of painted layers the snapshot freezes, so only elements that actually carry visible geometry are captured and named consistently.

.. CG-EXPLANATION-END id=const:FAMILIES

``const roundPath``
-------------------

.. CG-BLOCK id=const:roundPath lines=229-237

.. literalinclude:: ../../../desktop/src/renderer/src/utils/cs1GoldenMaster/screenSnapshot.tsx
   :language: tsx
   :lines: 229-237
   :lineno-match:

.. CG-EXPLANATION-START id=const:roundPath

**What this does.** Rounds every number inside an SVG path's data string to two decimals.

**Why it is here.** It normalises path coordinates to the same grain the component emits, so trivial last-digit differences do not fail the gate.

.. CG-EXPLANATION-END id=const:roundPath

``function computeScreenSnapshot``
----------------------------------

.. CG-BLOCK id=function:computeScreenSnapshot lines=238-298

.. literalinclude:: ../../../desktop/src/renderer/src/utils/cs1GoldenMaster/screenSnapshot.tsx
   :language: tsx
   :lines: 238-298
   :lineno-match:

.. CG-EXPLANATION-START id=function:computeScreenSnapshot

**What this does.** Renders CS1 on the geotech axis into the headless browser and freezes everything painted: it collects each whitelisted element's visible attributes and rounded path, records the layer paint order, then also freezes the paint DEFINITIONS (the hatch patterns under the drawing's defs), and finally sorts the elements by content into a deterministic order.

**Why it is here.** The docstring records why the paint definitions are captured too: a hatch path only says "fill with pattern X", and everything the eye sees of that texture lives in the pattern definition, which carries no marker and was once skipped entirely — changing the hatch ink from slate to magenta left the gate green (audit finding 2026-08-23). A definition is part of the picture, so it is frozen with the rest.

.. CG-EXPLANATION-END id=function:computeScreenSnapshot

