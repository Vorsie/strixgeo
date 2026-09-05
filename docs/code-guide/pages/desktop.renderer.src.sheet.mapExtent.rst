desktop.renderer.src.sheet.mapExtent
====================================

.. CG-PAGE source=desktop/src/renderer/src/sheet/mapExtent.ts complete=false

*Source file:* ``desktop/src/renderer/src/sheet/mapExtent.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-3

.. literalinclude:: ../../../desktop/src/renderer/src/sheet/mapExtent.ts
   :language: typescript
   :lines: 1-3
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** A one-line comment and the import of the map-shape constants: the padding fraction, the minimum span, the box aspect ratio, and the list of allowed scale-bar lengths.

**Why it is here.** This file computes the ground area the map box shows (its *extent*) and picks the scale-bar length, following the spec's ``The map — Extent`` rules. Reading the numbers from the shared constants file keeps every measurement in one place.

.. CG-EXPLANATION-END id=module-header

``interface Extent``
--------------------

.. CG-BLOCK id=interface:Extent lines=4-5

.. literalinclude:: ../../../desktop/src/renderer/src/sheet/mapExtent.ts
   :language: typescript
   :lines: 4-5
   :lineno-match:

.. CG-EXPLANATION-START id=interface:Extent

**What this does.** Declares the shape of a map extent: the smallest and largest east (x) and north (y) values, in projected metres.

**Why it is here.** Naming this box shape once lets the extent be passed around and returned with a clear, checked meaning — a rectangle on the ground measured in metres.

.. CG-EXPLANATION-END id=interface:Extent

``function computeMapExtent``
-----------------------------

.. CG-BLOCK id=function:computeMapExtent lines=6-19

.. literalinclude:: ../../../desktop/src/renderer/src/sheet/mapExtent.ts
   :language: typescript
   :lines: 6-19
   :lineno-match:

.. CG-EXPLANATION-START id=function:computeMapExtent

**What this does.** Given the points to show (the section ends and the on-profile investigations), it finds the smallest box that contains them, widens it by the padding fraction on each side, and never lets either side fall below the minimum span. It then widens (never shrinks) the box so it matches the map box's 8:7 shape, and returns the box centred on the points.

**Why it is here.** The map must frame the section comfortably: padded so nothing sits on the edge, never so tight that a short section fills the whole box, and stretched to the box's aspect so the picture is not distorted. Widening rather than shrinking guarantees every point stays inside the frame. These are exactly the padding, minimum-span and aspect rules the spec lists, and the unit tests pin them.

.. CG-EXPLANATION-END id=function:computeMapExtent

``function pickScaleBarM``
--------------------------

.. CG-BLOCK id=function:pickScaleBarM lines=20-27

.. literalinclude:: ../../../desktop/src/renderer/src/sheet/mapExtent.ts
   :language: typescript
   :lines: 20-27
   :lineno-match:

.. CG-EXPLANATION-START id=function:pickScaleBarM

**What this does.** Given the ground width the box currently shows, it aims for a scale bar about a third of that width and returns whichever of the allowed lengths (50, 100, 200, 500, 1000, 2000 m) is closest to that target.

**Why it is here.** A scale bar should be a round number and take up roughly a third of the map, so it reads at a glance without dominating the picture. Choosing from a fixed list of round lengths keeps the printed bar tidy, as the spec requires.

.. CG-EXPLANATION-END id=function:pickScaleBarM

