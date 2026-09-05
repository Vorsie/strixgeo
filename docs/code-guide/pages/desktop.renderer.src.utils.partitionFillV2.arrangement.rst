desktop.renderer.src.utils.partitionFillV2.arrangement
======================================================

.. CG-PAGE source=desktop/src/renderer/src/utils/partitionFillV2/arrangement.ts complete=true

*Source file:* ``desktop/src/renderer/src/utils/partitionFillV2/arrangement.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-42

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/arrangement.ts
   :language: typescript
   :lines: 1-42
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** This file is the pure-geometry heart of the second-generation fill engine. It takes a set of input curves -- polylines, which are just chains of points -- that live in a space measured across the section in real metres (horizontal) and elevation (vertical), and turns them into a planar arrangement: the set of tiles you get when you drop all those lines onto a flat sheet and let them cut it into closed pieces. Each closed piece is a face. The steps are: round every point to a fixed 1 mm grid (called snap-rounding, so tiny rounding differences cannot make two points that should be equal look different), find where segments cross and split them there, build a bookkeeping structure that knows which edge follows which around every corner, and finally walk that structure to trace each face.

**Why it is here.** The module docstring notes this is the pure-geometry core only; labelling the faces with a soil, cutting them at the column lines, and the domain wrapper all live in other files. It stresses determinism -- no clock, no randomness, and every ordering step sorts by coordinates or ids -- so the same curves in a shuffled order always produce the identical arrangement. This is what lets the whole v2 approach promise no holes and no overlaps by construction (design note section 1).

.. CG-EXPLANATION-END id=module-header

``function buildArrangement``
-----------------------------

.. CG-BLOCK id=function:buildArrangement lines=43-85

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/arrangement.ts
   :language: typescript
   :lines: 43-85
   :lineno-match:

.. CG-EXPLANATION-START id=function:buildArrangement

**What this does.** The one function the file exposes. In five numbered steps it breaks every input polyline into single snapped edges (dropping any that collapse to zero length), intersects and splits the edges so they only ever meet at their endpoints, builds the doubly-connected edge list (a table of directed edge-halves wired to their neighbours -- see the ``dcel`` page), traces the closed faces by walking that table, and converts the snapped integer grid points back into real metres for the result it returns.

**Why it is here.** The numbered comments pin two load-bearing decisions. There is exactly one snapping pass for the input points here (intersection points snap later, inside the split step) -- the design's one-snapping-pass-then-exact-walking rule that avoids a cascade of tolerances. And synthesized ``closing`` curves are registered with exact-only cutting, because their historical trimming behaviour is what the shipped output depends on (debt #271); changing it belongs to a separate cut-over.

.. CG-EXPLANATION-END id=function:buildArrangement

