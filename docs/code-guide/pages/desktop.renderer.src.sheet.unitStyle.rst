desktop.renderer.src.sheet.unitStyle
====================================

.. CG-PAGE source=desktop/src/renderer/src/sheet/unitStyle.ts complete=false

*Source file:* ``desktop/src/renderer/src/sheet/unitStyle.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-31

.. literalinclude:: ../../../desktop/src/renderer/src/sheet/unitStyle.ts
   :language: typescript
   :lines: 1-31
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** A documentation comment and one import. The comment explains this is the one place the sheet decides a unit's colour and label by axis: on the litho and geological axes a region shows its stored formation colour and name, but on the geotech axis it shows its NAD packing-class colour and compact label, because a litho unit is subdivided into packing classes there and the stored formation colour is only the inherited litho hue — so painting with it would make every packing class of one lithology look identical. It records the owner's Dutch finding of 2026-09-03 asking why the PDF colours did not change with the packing. The import brings in the geotech colour and compact-label helpers from the shared NAD-classes module the section canvas also uses.

**Why it is here.** Colours and labels must be decided in exactly one place so the sheet and the on-screen canvas never disagree and no second copy of the packing-colour ramp exists. Reusing the same NAD-classes module the canvas uses guarantees that. NAD packing class is the Belgian characterisation output per NBN EN 1997-1 ANB Tabel 2.1.

.. CG-EXPLANATION-END id=module-header

``function unitFillColour``
---------------------------

.. CG-BLOCK id=function:unitFillColour lines=32-50

.. literalinclude:: ../../../desktop/src/renderer/src/sheet/unitStyle.ts
   :language: typescript
   :lines: 32-50
   :lineno-match:

.. CG-EXPLANATION-START id=function:unitFillColour

**What this does.** Returns the colour a unit's region is drawn in. On the geotech axis, when the unit carries packing-class information, it uses the geotech colour (the engineer's own pick where he made one, otherwise the packing-density ramp — the same rule the canvas follows). On every other axis, or for a unit with no packing information, it uses the stored formation colour.

**Why it is here.** This is the fix for the owner's finding that the PDF did not colour geotech units by packing. Deferring to the canvas's own colour rule means the printed fill matches the screen exactly, packing class by packing class.

.. CG-EXPLANATION-END id=function:unitFillColour

``function unitLabel``
----------------------

.. CG-BLOCK id=function:unitLabel lines=51-58

.. literalinclude:: ../../../desktop/src/renderer/src/sheet/unitStyle.ts
   :language: typescript
   :lines: 51-58
   :lineno-match:

.. CG-EXPLANATION-START id=function:unitLabel

**What this does.** Returns the label a unit shows inside its fill and in the legend. On the geotech axis with packing information it uses the compact ``SOIL·packing`` label (such as ``ZAND·MD``), matching the on-screen band labels, and falls back to the stored name while the unit is still unclassified. On every other axis it uses the stored name.

**Why it is here.** So the printed labels read the way the engineer sees them on screen — full formation names on the litho axis, compact packing codes on the geotech axis — with a sensible fallback to the plain name for a not-yet-classified unit.

.. CG-EXPLANATION-END id=function:unitLabel

``interface UnitLegendEntry``
-----------------------------

.. CG-BLOCK id=interface:UnitLegendEntry lines=59-76

.. literalinclude:: ../../../desktop/src/renderer/src/sheet/unitStyle.ts
   :language: typescript
   :lines: 59-76
   :lineno-match:

.. CG-EXPLANATION-START id=interface:UnitLegendEntry

**What this does.** Declares one legend row: a stable key, its swatch colour, and its label.

**Why it is here.** A small named shape so the legend can be built once and simply printed, each row already carrying the colour and text it needs.

.. CG-EXPLANATION-END id=interface:UnitLegendEntry

``function unitLegendEntries``
------------------------------

.. CG-BLOCK id=function:unitLegendEntries lines=77-99

.. literalinclude:: ../../../desktop/src/renderer/src/sheet/unitStyle.ts
   :language: typescript
   :lines: 77-99
   :lineno-match:

.. CG-EXPLANATION-START id=function:unitLegendEntries

**What this does.** Builds the legend rows for a sheet, in display order. It keeps only the units that actually have a region on the sheet and sorts them by display order. On the litho and geological axes it makes one row per formation. On the geotech axis it makes one row per packing class present: two different litho units subdivided into the same packing class collapse to a single row, so each class is listed exactly once (an unclassified unit counts as its own single class).

**Why it is here.** The legend must name only what is drawn, and on the geotech axis it must list each packing class once rather than repeating it for every litho parent that produced it — matching how the engineer thinks about the geotech model. The existing legend is a simple wrapped list, so no litho-parent grouping is applied here beyond that per-class collapse.

.. CG-EXPLANATION-END id=function:unitLegendEntries

