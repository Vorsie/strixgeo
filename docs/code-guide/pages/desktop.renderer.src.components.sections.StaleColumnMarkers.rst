desktop.renderer.src.components.sections.StaleColumnMarkers
===========================================================

.. CG-PAGE source=desktop/src/renderer/src/components/sections/StaleColumnMarkers.tsx complete=true

*Source file:* ``desktop/src/renderer/src/components/sections/StaleColumnMarkers.tsx``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-26

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/StaleColumnMarkers.tsx
   :language: tsx
   :lines: 1-26
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The top of the file that draws amber 'these bands are out of date' marks on the geotech axis. It imports the placed-column type and the translation helper.

**Why it is here.** The docstring records the reason (debt #266): a packing band is derived from the litho stack beneath it, and editing that stack leaves the band drawn at the old depths with nothing on screen to say so — the risk being a client-facing export of silently stale packing. It states the design rules it follows: amber never red (the project's dirty-not-wrong colour), never colour alone (each mark carries an exclamation glyph and a tooltip so it survives monochrome print and colour-blindness, WCAG 2.2 1.4.1), and pointer-inert so the mark cannot swallow the drag gesture it warns about.

.. CG-EXPLANATION-END id=module-header

``const MARK_OFFSET_Y_PX``
--------------------------

.. CG-BLOCK id=const:MARK_OFFSET_Y_PX lines=27-28

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/StaleColumnMarkers.tsx
   :language: tsx
   :lines: 27-28
   :lineno-match:

.. CG-EXPLANATION-START id=const:MARK_OFFSET_Y_PX

**What this does.** How far below the plot's top edge the mark sits, in pixels.

**Why it is here.** Positions the badge just inside the top of the plot so it labels the column without intruding on the bands.

.. CG-EXPLANATION-END id=const:MARK_OFFSET_Y_PX

``const MARK_RADIUS_PX``
------------------------

.. CG-BLOCK id=const:MARK_RADIUS_PX lines=29-30

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/StaleColumnMarkers.tsx
   :language: tsx
   :lines: 29-30
   :lineno-match:

.. CG-EXPLANATION-START id=const:MARK_RADIUS_PX

**What this does.** The radius of the amber disc, in pixels.

**Why it is here.** The comment says it matches the lens badge on the same axis so the two marks read as one family.

.. CG-EXPLANATION-END id=const:MARK_RADIUS_PX

``const MARK_RING_COLOR``
-------------------------

.. CG-BLOCK id=const:MARK_RING_COLOR lines=31-32

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/StaleColumnMarkers.tsx
   :language: tsx
   :lines: 31-32
   :lineno-match:

.. CG-EXPLANATION-START id=const:MARK_RING_COLOR

**What this does.** The ring colour drawn around the disc, a darker amber (amber-700).

**Why it is here.** The comment says the ring is the contrast lift the disc needs to be legible; the full reason is spelled out at the circle itself.

.. CG-EXPLANATION-END id=const:MARK_RING_COLOR

``interface Props``
-------------------

.. CG-BLOCK id=interface:Props lines=33-48

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/StaleColumnMarkers.tsx
   :language: tsx
   :lines: 33-48
   :lineno-match:

.. CG-EXPLANATION-START id=interface:Props

**What this does.** The inputs: the placed columns in post-nudge screen coordinates, the set of investigation ids whose bands are out of date, and the screen y of the plot's top edge.

**Why it is here.** The set of stale ids is what decides which columns get a mark; the post-nudge coordinates are required because the mark must sit on the column's drawn centre, not its raw projected position.

.. CG-EXPLANATION-END id=interface:Props

``function StaleColumnMarkers``
-------------------------------

.. CG-BLOCK id=function:StaleColumnMarkers lines=49-91

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/StaleColumnMarkers.tsx
   :language: tsx
   :lines: 49-91
   :lineno-match:

.. CG-EXPLANATION-START id=function:StaleColumnMarkers

**What this does.** The component. It keeps only the columns whose id is in the stale set, returns nothing when there are none, and draws one amber disc with an exclamation glyph per stale column, positioned at the column's drawn centre (nudgedX) just below the plot top, each carrying a tooltip naming the column. The whole group ignores the mouse.

**Why it is here.** The docstring on the function stresses it positions on nudgedX, the column's drawn centre after the spacing pass — never the raw projected position, which is a different x whenever columns crowd (the section-view spacing rule). The ring comment cites WCAG 2.2 1.4.11: amber alone is about 2.1:1 on the light plot, under the 3:1 floor for a meaningful graphic, so the darker ring lifts it over the line.

.. CG-EXPLANATION-END id=function:StaleColumnMarkers

