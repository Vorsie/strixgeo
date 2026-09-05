desktop.renderer.src.utils.geotechHierarchicalFill.constructive.mergeFaces
==========================================================================

.. CG-PAGE source=desktop/src/renderer/src/utils/geotechHierarchicalFill/constructive/mergeFaces.ts complete=true

*Source file:* ``desktop/src/renderer/src/utils/geotechHierarchicalFill/constructive/mergeFaces.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-29

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechHierarchicalFill/constructive/mergeFaces.ts
   :language: typescript
   :lines: 1-29
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Opens Phase 3, THE MERGE. It welds loops that carry the same class AND the same band identity and touch along a shared edge into one region with no internal seam. It imports the separation-constraint helpers that let the engineer's 'Separate' ruling keep a seam alive.

**Why it is here.** Owner 2026-08-19: 'the merge is to reduce the dimensions to a manageable level'. The arrangement cuts the cover at every line, so one class routinely returns as several loops that mean one thing. Nothing moves in the weld — the union is exactly the loops' own ground — so the merge can neither add nor lose paint; it only stops the render drawing seams that say nothing. A component whose boundary walk does not close into exactly one simple ring keeps its loops unmerged, because an honest mosaic is better than a wrong outline.

.. CG-EXPLANATION-END id=module-header

``interface FacePoint``
-----------------------

.. CG-BLOCK id=interface:FacePoint lines=30-35

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechHierarchicalFill/constructive/mergeFaces.ts
   :language: typescript
   :lines: 30-35
   :lineno-match:

.. CG-EXPLANATION-START id=interface:FacePoint

**What this does.** A point of a face ring, in one gap's fraction space — a fraction across the gap and an elevation.

**Why it is here.** It is the vertex unit the whole merge works on.

.. CG-EXPLANATION-END id=interface:FacePoint

``interface LabelledFace``
--------------------------

.. CG-BLOCK id=interface:LabelledFace lines=36-49

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechHierarchicalFill/constructive/mergeFaces.ts
   :language: typescript
   :lines: 36-49
   :lineno-match:

.. CG-EXPLANATION-START id=interface:LabelledFace

**What this does.** One labelled loop ready to be merged: the key (everything that must match for two loops to weld — class and identity), the payload label carried onto the emitted region, and the ring.

**Why it is here.** Two loops weld only when their keys match, and the label is what travels onto the merged region so the caller keeps each contributor's identity.

.. CG-EXPLANATION-END id=interface:LabelledFace

``interface MergeFacesOptions``
-------------------------------

.. CG-BLOCK id=interface:MergeFacesOptions lines=50-57

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechHierarchicalFill/constructive/mergeFaces.ts
   :language: typescript
   :lines: 50-57
   :lineno-match:

.. CG-EXPLANATION-START id=interface:MergeFacesOptions

**What this does.** Options threading the engineer's 'Separate' cannot-link into the merge: a function reading a label's layer ids, and the set of separated pairs.

**Why it is here.** Owner 2026-08-31 (debt #278 R5): two loops whose combined layer ids carry both sides of a standing separation are kept in different components so their shared seam survives and the paint shows the split the engineer drew. Absent or empty, this leaves the merge byte-identical.

.. CG-EXPLANATION-END id=interface:MergeFacesOptions

``const GRID``
--------------

.. CG-BLOCK id=const:GRID lines=58-59

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechHierarchicalFill/constructive/mergeFaces.ts
   :language: typescript
   :lines: 58-59
   :lineno-match:

.. CG-EXPLANATION-START id=const:GRID

**What this does.** A constant, 1e7 — the quantised vertex grid the arrangement's snapped vertices land on.

**Why it is here.** Using the arrangement's own grid means its snapped vertices land exactly on a key, so meant-to-be-equal points compare equal.

.. CG-EXPLANATION-END id=const:GRID

``const vertexKey``
-------------------

.. CG-BLOCK id=const:vertexKey lines=60-63

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechHierarchicalFill/constructive/mergeFaces.ts
   :language: typescript
   :lines: 60-63
   :lineno-match:

.. CG-EXPLANATION-START id=const:vertexKey

**What this does.** Turns a face point into a string key on the grid.

**Why it is here.** Quantising makes two meant-to-be-equal vertices share one key despite float noise.

.. CG-EXPLANATION-END id=const:vertexKey

``function signedArea2``
------------------------

.. CG-BLOCK id=function:signedArea2 lines=64-74

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechHierarchicalFill/constructive/mergeFaces.ts
   :language: typescript
   :lines: 64-74
   :lineno-match:

.. CG-EXPLANATION-START id=function:signedArea2

**What this does.** Returns a ring's signed doubled area; a positive result means the ring runs counter-clockwise.

**Why it is here.** It is how the code learns a ring's winding, so every ring can be oriented the same way before comparison.

.. CG-EXPLANATION-END id=function:signedArea2

``function normalise``
----------------------

.. CG-BLOCK id=function:normalise lines=75-94

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechHierarchicalFill/constructive/mergeFaces.ts
   :language: typescript
   :lines: 75-94
   :lineno-match:

.. CG-EXPLANATION-START id=function:normalise

**What this does.** Drops repeated consecutive vertices from a ring and orients it counter-clockwise.

**Why it is here.** So rings compare and weld consistently regardless of the winding they arrived in.

.. CG-EXPLANATION-END id=function:normalise

``function mergeFaces``
-----------------------

.. CG-BLOCK id=function:mergeFaces lines=95-187

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechHierarchicalFill/constructive/mergeFaces.ts
   :language: typescript
   :lines: 95-187
   :lineno-match:

.. CG-EXPLANATION-START id=function:mergeFaces

**What this does.** Welds same-class touching loops. It normalises the rings, groups them by key, and within each group unites loops that share an edge using union-find — honouring any standing separation so a split pair stays apart — then for each component of more than one loop welds them into a single outline (keeping the mosaic when the walk does not close), carrying every member's label.

**Why it is here.** The docstring records that the weld is by boundary walk and that a component IS one mass, so every piece carries the whole component's identities. The separation cannot-link keeps a seam the engineer deliberately drew from being cancelled (owner 2026-08-31, debt #278 R5).

.. CG-EXPLANATION-END id=function:mergeFaces

``function weld``
-----------------

.. CG-BLOCK id=function:weld lines=188-237

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechHierarchicalFill/constructive/mergeFaces.ts
   :language: typescript
   :lines: 188-237
   :lineno-match:

.. CG-EXPLANATION-START id=function:weld

**What this does.** Returns the outline of a set of edge-sharing loops, or nothing when it is not one simple ring. Every edge stated in both directions is interior and cancels; the surviving boundary edges chain into one ring, and it refuses where a vertex has more than one outgoing edge — a pinch point where the walk could branch either way.

**Why it is here.** A ring with a hole cannot be expressed as one polygon, and a pinch point could take either branch, so it refuses rather than guess and the caller keeps the loops as an honest mosaic.

.. CG-EXPLANATION-END id=function:weld

