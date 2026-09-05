desktop.renderer.src.lib.streaflet.components.Rectangle
=======================================================

.. CG-PAGE source=desktop/src/renderer/src/lib/streaflet/components/Rectangle.tsx complete=true

*Source file:* ``desktop/src/renderer/src/lib/streaflet/components/Rectangle.tsx``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-4

.. literalinclude:: ../../../desktop/src/renderer/src/lib/streaflet/components/Rectangle.tsx
   :language: tsx
   :lines: 1-4
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Imports Leaflet under ``L`` and the vector-shape factory (``createPathComponent``) with its shared inputs type.

**Why it is here.** A near-identical shape wrapper; needs only Leaflet and the shape factory (see the ``createPathComponent`` page).

.. CG-EXPLANATION-END id=module-header

``interface RectangleProps``
----------------------------

.. CG-BLOCK id=interface:RectangleProps lines=5-9

.. literalinclude:: ../../../desktop/src/renderer/src/lib/streaflet/components/Rectangle.tsx
   :language: tsx
   :lines: 5-9
   :lineno-match:

.. CG-EXPLANATION-START id=interface:RectangleProps

**What this does.** Declares its own inputs on top of the shared shape inputs: ``bounds`` — the south-west and north-east corner pair that defines the box.

**Why it is here.** A rectangle is fully described by its two opposite corners, so the corner-pair box is all it adds.

.. CG-EXPLANATION-END id=interface:RectangleProps

``const Rectangle``
-------------------

.. CG-BLOCK id=const:Rectangle lines=10-15

.. literalinclude:: ../../../desktop/src/renderer/src/lib/streaflet/components/Rectangle.tsx
   :language: tsx
   :lines: 10-15
   :lineno-match:

.. CG-EXPLANATION-START id=const:Rectangle

**What this does.** Builds the component by giving the shape factory a create step (make a Leaflet rectangle from the box and style) and an update step (re-set the box if it changed).

**Why it is here.** Built by the ``createPathComponent`` factory pattern — see that page. Only the two rectangle-specific lines live here.

.. CG-EXPLANATION-END id=const:Rectangle

