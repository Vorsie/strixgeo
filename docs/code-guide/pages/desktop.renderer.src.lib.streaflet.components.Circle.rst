desktop.renderer.src.lib.streaflet.components.Circle
====================================================

.. CG-PAGE source=desktop/src/renderer/src/lib/streaflet/components/Circle.tsx complete=true

*Source file:* ``desktop/src/renderer/src/lib/streaflet/components/Circle.tsx``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-4

.. literalinclude:: ../../../desktop/src/renderer/src/lib/streaflet/components/Circle.tsx
   :language: tsx
   :lines: 1-4
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Imports Leaflet under ``L`` and the vector-shape factory (``createPathComponent``) with its shared inputs type.

**Why it is here.** Circle is one of the near-identical shape wrappers; it needs only Leaflet and the shape factory (see the ``createPathComponent`` page).

.. CG-EXPLANATION-END id=module-header

``interface CircleProps``
-------------------------

.. CG-BLOCK id=interface:CircleProps lines=5-10

.. literalinclude:: ../../../desktop/src/renderer/src/lib/streaflet/components/Circle.tsx
   :language: tsx
   :lines: 5-10
   :lineno-match:

.. CG-EXPLANATION-START id=interface:CircleProps

**What this does.** Declares this shape's own inputs on top of the shared shape inputs: a ``center`` point and a ``radius`` given in metres.

**Why it is here.** A circle needs a centre and a real-world radius; everything else (style, events, pane) comes from the shared shape inputs, so only these two are listed here.

.. CG-EXPLANATION-END id=interface:CircleProps

``const Circle``
----------------

.. CG-BLOCK id=const:Circle lines=11-17

.. literalinclude:: ../../../desktop/src/renderer/src/lib/streaflet/components/Circle.tsx
   :language: tsx
   :lines: 11-17
   :lineno-match:

.. CG-EXPLANATION-START id=const:Circle

**What this does.** Builds the circle component by handing the shape factory a create step (make a Leaflet circle at the centre with the metre radius) and an update step (move it if the centre changed, resize it if the radius changed).

**Why it is here.** Built by the ``createPathComponent`` factory pattern — see that page for how create-once, mutate-in-place, styling, event binding and removal all work; here the file only supplies the two circle-specific lines.

.. CG-EXPLANATION-END id=const:Circle

