desktop.renderer.src.shell.stages.parameters.icBands
====================================================

.. CG-PAGE source=desktop/src/renderer/src/shell/stages/parameters/icBands.ts complete=true

*Source file:* ``desktop/src/renderer/src/shell/stages/parameters/icBands.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-16

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/parameters/icBands.ts
   :language: typescript
   :lines: 1-16
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Opens the file holding the Robertson Ic band fill colours — the drawing half of the shared soil-behaviour-type table. It imports the band breakpoints and labels from ``utils/robertsonSbt.ts``.

**Why it is here.** The breakpoints and labels live in one shared table for every renderer that uses them, held to a cross-boundary contract file by a parity test; only the hues live here, because a hue is a drawing concern. Method: Robertson (2009).

.. CG-EXPLANATION-END id=module-header

``const IC_ZONE_FILL_BY_LABEL``
-------------------------------

.. CG-BLOCK id=const:IC_ZONE_FILL_BY_LABEL lines=17-27

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/parameters/icBands.ts
   :language: typescript
   :lines: 17-27
   :lineno-match:

.. CG-EXPLANATION-START id=const:IC_ZONE_FILL_BY_LABEL

**What this does.** A table mapping each soil label — Gravelly sand, Sand, Sand mix, Silt mix, Clay, Organic — to its fill colour.

**Why it is here.** Keyed by label, not by band index, on purpose: the rule ux.md protects is the label-to-hue pairing (blue reads as clay everywhere in the app), not the hue's numeric Ic range. When the 2026-08-02 audit corrected the labels every soil shifted down one band; an index-keyed list would have painted 'Clay' amber and 'Silt mix' blue, so the hues travel with their soils instead.

.. CG-EXPLANATION-END id=const:IC_ZONE_FILL_BY_LABEL

``const IC_ZONE_FILL_FALLBACK``
-------------------------------

.. CG-BLOCK id=const:IC_ZONE_FILL_FALLBACK lines=28-30

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/parameters/icBands.ts
   :language: typescript
   :lines: 28-30
   :lineno-match:

.. CG-EXPLANATION-START id=const:IC_ZONE_FILL_FALLBACK

**What this does.** A neutral grey fill for any band the label table does not name.

**Why it is here.** So a future breakpoint change cannot silently render a transparent band.

.. CG-EXPLANATION-END id=const:IC_ZONE_FILL_FALLBACK

``interface IcZone``
--------------------

.. CG-BLOCK id=interface:IcZone lines=31-39

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/parameters/icBands.ts
   :language: typescript
   :lines: 31-39
   :lineno-match:

.. CG-EXPLANATION-START id=interface:IcZone

**What this does.** The shape of one drawable Ic band: the half-open interval from x1 up to x2, its fill, and its full and short labels.

**Why it is here.** The interval plus the fill is what the curve panel paints as a background band; the labels feed the tooltips and the legend.

.. CG-EXPLANATION-END id=interface:IcZone

``const IC_ZONES``
------------------

.. CG-BLOCK id=const:IC_ZONES lines=40-48

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/parameters/icBands.ts
   :language: typescript
   :lines: 40-48
   :lineno-match:

.. CG-EXPLANATION-START id=const:IC_ZONES

**What this does.** Builds the ordered list of Ic bands by pairing each shared-table band's Ic range and labels with its fill from the label table (or the fallback).

**Why it is here.** So the drawing side has one ready list of bands-with-colours derived from the single shared breakpoint table, never a second copy of the ranges that could drift.

.. CG-EXPLANATION-END id=const:IC_ZONES

``const IC_ZONE_BOUNDARIES``
----------------------------

.. CG-BLOCK id=const:IC_ZONE_BOUNDARIES lines=49-67

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/parameters/icBands.ts
   :language: typescript
   :lines: 49-67
   :lineno-match:

.. CG-EXPLANATION-START id=const:IC_ZONE_BOUNDARIES

**What this does.** The interior band boundaries — every band's start Ic value except the first. The lines that follow are the documentation comment for the zone-fill table below.

**Why it is here.** The first band has no interior boundary to draw, so it is dropped; the trailing doc-comment introduces the strip zone fills.

.. CG-EXPLANATION-END id=const:IC_ZONE_BOUNDARIES

``const SBT_ZONE_FILL``
-----------------------

.. CG-BLOCK id=const:SBT_ZONE_FILL lines=68-78

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/parameters/icBands.ts
   :language: typescript
   :lines: 68-78
   :lineno-match:

.. CG-EXPLANATION-START id=const:SBT_ZONE_FILL

**What this does.** A table of fill colours for the Robertson (2009) chart zones 1 to 9 — the colours the two SBT strips paint. Clay zones are blue, silt green, sand yellow, gravel purple; zone 2 (organic and peat) is a dark peat brown; and zones 1, 8 and 9 take neutral tones.

**Why it is here.** It lives beside the Ic fills because it is the same kind of hue table, and keeping both in one module lets a single parity test hold both to the contract file. The colours match the label-to-hue pairing ux.md protects. Zone 2 is the documented exception — painted a distinct dark brown so its run is findable on a 22 px strip — and zones 1, 8 and 9 have no Ic band at all (they are read off the Qtn-Fr chart) so they take neutral tones.

.. CG-EXPLANATION-END id=const:SBT_ZONE_FILL

