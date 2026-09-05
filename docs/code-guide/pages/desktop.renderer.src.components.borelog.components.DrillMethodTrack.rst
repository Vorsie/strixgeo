desktop.renderer.src.components.borelog.components.DrillMethodTrack
===================================================================

.. CG-PAGE source=desktop/src/renderer/src/components/borelog/components/DrillMethodTrack.tsx complete=true

*Source file:* ``desktop/src/renderer/src/components/borelog/components/DrillMethodTrack.tsx``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-14

.. literalinclude:: ../../../desktop/src/renderer/src/components/borelog/components/DrillMethodTrack.tsx
   :language: tsx
   :lines: 1-14
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The file's imports and its documentation comment. It imports the drill-segment response type, the ``drillMethodStyle`` colour lookup, and two helpers from the borelog utilities — ``truncate`` and ``usePxPerM``. The comment says this draws the vertical track showing the driller's recorded method for each depth segment, each as a coloured rectangle keyed off the method name, with the label inside when there is room and the full method and depth range in a hover tooltip.

**Why it is here.** One of the borehole-log tracks introduced on the ``desktop.renderer.src.components.borelog.components.AdmixtureChips`` page: a vertical SVG column drawn at true depth. ``drillMethodStyle`` maps the raw method token to a fixed colour at the presentation boundary, so the engine keeps the driller's original wording while the desktop chooses how it looks.

.. CG-EXPLANATION-END id=module-header

``function DrillMethodTrack``
-----------------------------

.. CG-BLOCK id=function:DrillMethodTrack lines=15-82

.. literalinclude:: ../../../desktop/src/renderer/src/components/borelog/components/DrillMethodTrack.tsx
   :language: tsx
   :lines: 15-82
   :lineno-match:

.. CG-EXPLANATION-START id=function:DrillMethodTrack

**What this does.** The track component. It reads the shared pixels-per-metre scale, draws a background rectangle spanning the full depth, then one rectangle per segment placed at its top depth and sized by its thickness, filled with the method's colour. When a segment is tall enough it prints the (shortened) method name centred inside, and every segment carries a hover tooltip with its exact depth range and method.

**Why it is here.** ``usePxPerM`` supplies the same mTAW-to-pixel scale every track uses (the shared rail from the anchor page), so a segment at a given depth lines up across all tracks. The comment records the deliberate near-black label colour: it stays legible on the mid-brightness method fills in both themes, whereas the lighter badge-text colour is meant for pills on dark backgrounds and would not read here. Labels are drawn only in tall-enough segments so short segments do not show clipped text; the tooltip carries the full detail regardless.

.. CG-EXPLANATION-END id=function:DrillMethodTrack

