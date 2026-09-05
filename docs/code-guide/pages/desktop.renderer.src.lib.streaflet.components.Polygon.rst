desktop.renderer.src.lib.streaflet.components.Polygon
=====================================================

.. CG-PAGE source=desktop/src/renderer/src/lib/streaflet/components/Polygon.tsx complete=true

*Source file:* ``desktop/src/renderer/src/lib/streaflet/components/Polygon.tsx``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-4

.. literalinclude:: ../../../desktop/src/renderer/src/lib/streaflet/components/Polygon.tsx
   :language: tsx
   :lines: 1-4
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Imports Leaflet under ``L`` and the vector-shape factory (``createPathComponent``) with its shared inputs type.

**Why it is here.** A near-identical shape wrapper; needs only Leaflet and the shape factory (see the ``createPathComponent`` page).

.. CG-EXPLANATION-END id=module-header

``interface PolygonProps``
--------------------------

.. CG-BLOCK id=interface:PolygonProps lines=5-9

.. literalinclude:: ../../../desktop/src/renderer/src/lib/streaflet/components/Polygon.tsx
   :language: tsx
   :lines: 5-9
   :lineno-match:

.. CG-EXPLANATION-START id=interface:PolygonProps

**What this does.** Declares its own inputs on top of the shared shape inputs: ``positions`` — either a single ring of points, or an array of rings so the outer ring can enclose holes.

**Why it is here.** A polygon is defined by its corner points; allowing an array of rings lets a shape carry holes (for example a formation footprint with a gap punched out).

.. CG-EXPLANATION-END id=interface:PolygonProps

``const Polygon``
-----------------

.. CG-BLOCK id=const:Polygon lines=10-15

.. literalinclude:: ../../../desktop/src/renderer/src/lib/streaflet/components/Polygon.tsx
   :language: tsx
   :lines: 10-15
   :lineno-match:

.. CG-EXPLANATION-START id=const:Polygon

**What this does.** Builds the component by giving the shape factory a create step (make a Leaflet polygon from the points and style) and an update step (re-set the points if they changed).

**Why it is here.** Built by the ``createPathComponent`` factory pattern — see that page. Only the two polygon-specific lines live here.

.. CG-EXPLANATION-END id=const:Polygon

