desktop.renderer.src.utils.partitionFillV2.dcel
===============================================

.. CG-PAGE source=desktop/src/renderer/src/utils/partitionFillV2/dcel.ts complete=true

*Source file:* ``desktop/src/renderer/src/utils/partitionFillV2/dcel.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-19

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/dcel.ts
   :language: typescript
   :lines: 1-19
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** This file builds the doubly-connected edge list (DCEL), the bookkeeping structure the face tracer walks. It takes the snapped, endpoint-only-touching sub-segments from the intersection step and produces a de-duplicated list of corner points plus a set of directed half-edges -- each undirected segment becomes two half-edges pointing opposite ways -- wired with a ``twin`` pointer (the same segment the other way) and a ``next`` pointer (the following edge around a face).

**Why it is here.** The docstring states the ``next`` rule is the standard planar-arrangement one: at each corner, sort the outgoing half-edges by angle and set ``next`` to the clockwise-nearest, which makes every ``next`` cycle trace one face keeping the face on its left. This is what lets the face tracer simply follow ``next`` chains.

.. CG-EXPLANATION-END id=module-header

``interface DcelHalfEdge``
--------------------------

.. CG-BLOCK id=interface:DcelHalfEdge lines=20-29

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/dcel.ts
   :language: typescript
   :lines: 20-29
   :lineno-match:

.. CG-EXPLANATION-START id=interface:DcelHalfEdge

**What this does.** A type for one half-edge: the indices of its start and end corner, its twin, its next, and the input-curve ids that contributed the segment.

**Why it is here.** The curve ids ride along because the face tracer later reads them to label a face by what kind of curve bounds it.

.. CG-EXPLANATION-END id=interface:DcelHalfEdge

``interface Dcel``
------------------

.. CG-BLOCK id=interface:Dcel lines=30-52

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/dcel.ts
   :language: typescript
   :lines: 30-52
   :lineno-match:

.. CG-EXPLANATION-START id=interface:Dcel

**What this does.** A type for the assembled structure: the de-duplicated corner list and the half-edge list.

**Why it is here.** It is the single bundle ``buildDcel`` returns for the tracer to consume.

.. CG-EXPLANATION-END id=interface:Dcel

``function buildDcel``
----------------------

.. CG-BLOCK id=function:buildDcel lines=53-109

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/dcel.ts
   :language: typescript
   :lines: 53-109
   :lineno-match:

.. CG-EXPLANATION-START id=function:buildDcel

**What this does.** Builds the DCEL in steps: de-duplicate the corners into a deterministically ordered list, merge coincident undirected segments into one (unioning their curve ids), emit two twin half-edges per segment, then wire the ``next`` pointers.

**Why it is here.** The docstring notes merging coincident segments into one twin pair deduplicates any collinear-overlap output so no zero-area doubled edge survives -- the mechanism that lets, for example, a lens flank drawn coincident with a band contour collapse to one shared edge.

.. CG-EXPLANATION-END id=function:buildDcel

``function wireNextPointers``
-----------------------------

.. CG-BLOCK id=function:wireNextPointers lines=110-148

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/dcel.ts
   :language: typescript
   :lines: 110-148
   :lineno-match:

.. CG-EXPLANATION-START id=function:wireNextPointers

**What this does.** Sets each half-edge's ``next`` pointer: it groups outgoing half-edges by their corner, sorts each corner's edges counter-clockwise by angle, and sets ``next`` of an incoming edge to the clockwise-neighbour of its twin.

**Why it is here.** The docstring explains this angular rule is what keeps the traced face on the left of each edge, so following ``next`` yields correct face boundaries; ties (impossible after dedup, guarded anyway) break by target index for determinism.

.. CG-EXPLANATION-END id=function:wireNextPointers

``function edgeAngle``
----------------------

.. CG-BLOCK id=function:edgeAngle lines=149-153

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/dcel.ts
   :language: typescript
   :lines: 149-153
   :lineno-match:

.. CG-EXPLANATION-START id=function:edgeAngle

**What this does.** Returns the direction angle from one corner to another.

**Why it is here.** The angular sort key for the ``next`` wiring.

.. CG-EXPLANATION-END id=function:edgeAngle

``function compareGridKey``
---------------------------

.. CG-BLOCK id=function:compareGridKey lines=154-158

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/dcel.ts
   :language: typescript
   :lines: 154-158
   :lineno-match:

.. CG-EXPLANATION-START id=function:compareGridKey

**What this does.** Compares two x-comma-y grid keys numerically, x then y.

**Why it is here.** Gives the corners a deterministic order so the whole structure is reproducible run to run.

.. CG-EXPLANATION-END id=function:compareGridKey

